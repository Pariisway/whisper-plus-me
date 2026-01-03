const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const { v4: uuidv4 } = require("uuid");
const sgMail = require('@sendgrid/mail');

admin.initializeApp();
if (process.env.FUNCTIONS_EMULATOR) {
    sgMail.setApiKey('test-key');
} else {
    sgMail.setApiKey(functions.config().sendgrid.key);
}

// ========== AGORA TOKEN SERVER (FIXED: Use buildTokenWithAccount) ==========
exports.getAgoraToken = functions.https.onCall((data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be logged in");
    }

    const channel = data.channel;
    const uid = data.uid || context.auth.uid; // Get UID from client
    const agoraCert = functions.config().agora?.cert;

    if (!agoraCert) {
        throw new functions.https.HttpsError("internal", "Server configuration error");
    }

    // FIXED: Use buildTokenWithAccount to match Firebase UID
    const token = RtcTokenBuilder.buildTokenWithAccount(
        "966c8e41da614722a88d4372c3d95dba", // App ID
        agoraCert,
        channel,
        uid.toString(), // Use Firebase UID as account
        RtcRole.PUBLISHER,
        Math.floor(Date.now() / 1000) + 600 // 10 minutes expiration
    );

    return { token };
});

// ========== CALL MANAGEMENT (FIXED: Add pendingCharge field) ==========
exports.startCall = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be logged in");
    }

    const callerId = context.auth.uid;
    const whisperId = data.whisperId;
    const callId = uuidv4();

    // Rate limiting check
    const rateLimitRef = admin.database().ref(`rateLimits/${callerId}`);
    const rateSnap = await rateLimitRef.get();
    const now = Date.now();

    if (rateSnap.exists() && now - rateSnap.val() < 5000) {
        throw new functions.https.HttpsError("resource-exhausted", "Please wait before starting another call");
    }

    await rateLimitRef.set(now);

    // Check caller coins
    const callerRef = admin.database().ref(`users/${callerId}/coins`);
    const callerSnap = await callerRef.get();

    if ((callerSnap.val() || 0) < 1) {
        throw new functions.https.HttpsError("failed-precondition", "Not enough coins");
    }

    // Check whisper availability
    const whisperRef = admin.database().ref(`publicProfiles/${whisperId}/isAvailable`);
    const whisperSnap = await whisperRef.get();

    if (!whisperSnap.val()) {
        throw new functions.https.HttpsError("failed-precondition", "Whisper is not available");
    }

    // FIXED: Deduct coin and mark as pending
    await callerRef.transaction((current) => {
        return (current || 0) - 1;
    });

    // Create call record with pendingCharge flag
    await admin.database().ref(`calls/${callId}`).set({
        callId,
        callerId,
        whisperId,
        status: "ringing",
        startedAt: now,
        coinsCharged: 1,
        pendingCharge: true, // FIXED: Mark charge as pending
        refunded: false
    });

    // Log transaction
    await admin.database().ref(`transactions/${now}_${callId}`).set({
        type: "call_charge",
        userId: callerId,
        amount: -1,
        callId,
        pending: true,
        timestamp: now
    });

    return { callId };
});

// ========== ANSWER CALL (FIXED: Clear pendingCharge) ==========
exports.answerCall = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be logged in");
    }

    const callId = data.callId;
    const userId = context.auth.uid;

    const callRef = admin.database().ref(`calls/${callId}`);
    const callSnap = await callRef.get();
    const call = callSnap.val();

    if (!call) {
        throw new functions.https.HttpsError("not-found", "Call not found");
    }

    if (call.whisperId !== userId) {
        throw new functions.https.HttpsError("permission-denied", "Not authorized to answer this call");
    }

    if (call.status !== "ringing") {
        throw new functions.https.HttpsError("failed-precondition", "Call not in ringing state");
    }

    // FIXED: Mark charge as confirmed (no longer pending)
    await callRef.update({
        status: "active",
        answeredAt: Date.now(),
        pendingCharge: false
    });

    // Update transaction
    await admin.database().ref(`transactions/${call.startedAt}_${callId}`).update({
        pending: false,
        confirmedAt: Date.now()
    });

    return { success: true };
});

// ========== CALL WATCHDOGS (FIXED: Refund only if pending) ==========
exports.expireUnansweredCalls = functions.pubsub
    .schedule("every 1 minutes")
    .onRun(async () => {
        const callsRef = admin.database().ref("calls");
        const snapshot = await callsRef
            .orderByChild("status")
            .equalTo("ringing")
            .get();

        const now = Date.now();
        const promises = [];

        snapshot.forEach((call) => {
            const data = call.val();
            if (now - data.startedAt > 60000) { // 60 seconds
                // FIXED: Only refund if charge is still pending
                if (data.pendingCharge === true) {
                    // Refund coin to caller
                    const refundPromise = admin.database()
                        .ref(`users/${data.callerId}/coins`)
                        .transaction((current) => (current || 0) + 1);

                    // Update call status
                    const updatePromise = call.ref.update({
                        status: "expired",
                        refunded: true,
                        endedAt: now,
                        pendingCharge: false
                    });

                    // Log refund
                    const logPromise = admin.database()
                        .ref(`transactions/${now}_${call.key}_refund`)
                        .set({
                            type: "call_refund",
                            userId: data.callerId,
                            amount: 1,
                            callId: call.key,
                            reason: "unanswered",
                            timestamp: now
                        });

                    promises.push(refundPromise, updatePromise, logPromise);
                } else {
                    // Just expire without refund (already handled)
                    promises.push(call.ref.update({
                        status: "expired",
                        endedAt: now
                    }));
                }
            }
        });

        await Promise.all(promises);
        return null;
    });

// FIXED: End expired calls (server authoritative timer)
exports.endExpiredCalls = functions.pubsub
    .schedule("every 30 seconds")
    .onRun(async () => {
        const callsRef = admin.database().ref("calls");
        const snapshot = await callsRef
            .orderByChild("status")
            .equalTo("active")
            .get();

        const now = Date.now();
        const promises = [];

        snapshot.forEach((call) => {
            const data = call.val();
            if (data.answeredAt && (now - data.answeredAt > 300000)) { // 5 minutes
                const duration = Math.floor((now - data.answeredAt) / 1000);
                
                promises.push(call.ref.update({
                    status: "ended",
                    endedAt: now,
                    duration
                }));
                
                // FIXED: Increment abuse stats if call too short
                if (duration < 60) {
                    promises.push(
                        admin.database()
                            .ref(`abuseStats/${data.whisperId}/earlyEnds`)
                            .transaction((current) => (current || 0) + 1)
                    );
                }
            }
        });

        await Promise.all(promises);
        return null;
    });

// ========== CRASH DETECTION (FIXED: Immediate heartbeat on join) ==========
exports.detectCrashes = functions.pubsub
    .schedule("every 30 seconds")
    .onRun(async () => {
        const callsRef = admin.database().ref("calls");
        const snapshot = await callsRef
            .orderByChild("status")
            .equalTo("active")
            .get();

        const now = Date.now();
        const promises = [];

        snapshot.forEach((call) => {
            const data = call.val();
            const callerDead = !data.lastHeartbeatCaller || (now - data.lastHeartbeatCaller > 15000);
            const whisperDead = !data.lastHeartbeatWhisper || (now - data.lastHeartbeatWhisper > 15000);

            if (callerDead || whisperDead) {
                const duration = data.answeredAt ? Math.floor((now - data.answeredAt) / 1000) : 0;
                
                promises.push(call.ref.update({
                    status: "ended",
                    crashDetected: true,
                    endedAt: now,
                    duration
                }));

                // Refund if call was less than 60 seconds and charge was pending
                if (duration < 60 && data.answeredAt && data.pendingCharge === false) {
                    promises.push(
                        admin.database()
                            .ref(`users/${data.callerId}/coins`)
                            .transaction((current) => (current || 0) + 1)
                    );
                    
                    // FIXED: Increment abuse stats
                    promises.push(
                        admin.database()
                            .ref(`abuseStats/${callerDead ? data.whisperId : data.callerId}/crashes`)
                            .transaction((current) => (current || 0) + 1)
                    );
                }
            }
        });

        await Promise.all(promises);
        return null;
    });

// ========== ABUSE DETECTION (FIXED: Actually increment stats) ==========
exports.enforceAbuseLimits = functions.pubsub
    .schedule("every 5 minutes")
    .onRun(async () => {
        const abuseRef = admin.database().ref("abuseStats");
        const snapshot = await abuseRef.get();

        const promises = [];

        snapshot.forEach((user) => {
            const stats = user.val();
            
            // Auto-block users with 3+ early ends
            if ((stats.earlyEnds || 0) >= 3) {
                promises.push(
                    admin.database()
                        .ref(`publicProfiles/${user.key}/isAvailable`)
                        .set(false)
                );
                
                promises.push(
                    admin.database()
                        .ref(`adminActions/${Date.now()}_${user.key}`)
                        .set({
                            action: "auto_block",
                            userId: user.key,
                            reason: "excessive_early_ends",
                            timestamp: Date.now()
                        })
                );
                
                // Send admin email
                if (functions.config().sendgrid?.key) {
                    const msg = {
                        to: functions.config().admin.email,
                        from: 'alerts@whisperplus.me',
                        subject: 'User Auto-Blocked for Abuse',
                        text: `User ${user.key} was auto-blocked for ${stats.earlyEnds} early call ends.`
                    };
                    promises.push(sgMail.send(msg).catch(console.error));
                }
            }
        });

        await Promise.all(promises);
        return null;
    });

// ========== ADMIN ACTIONS ==========
exports.adminAdjustCoins = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be logged in");
    }

    // Verify admin status
    const adminSnap = await admin.database()
        .ref(`users/${context.auth.uid}/isAdmin`)
        .get();

    if (!adminSnap.val()) {
        throw new functions.https.HttpsError("permission-denied", "Admin access required");
    }

    const { targetUid, amount, reason } = data;

    if (!targetUid || !amount) {
        throw new functions.https.HttpsError("invalid-argument", "Missing required fields");
    }

    // Adjust coins
    await admin.database()
        .ref(`users/${targetUid}/coins`)
        .transaction((current) => (current || 0) + amount);

    // Log admin action
    await admin.database()
        .ref(`adminActions/${Date.now()}_${context.auth.uid}`)
        .set({
            admin: context.auth.uid,
            action: "adjust_coins",
            target: targetUid,
            amount,
            reason: reason || "manual_adjustment",
            timestamp: Date.now()
        });

    // Log transaction
    await admin.database()
        .ref(`transactions/${Date.now()}_${targetUid}_admin`)
        .set({
            type: amount > 0 ? "admin_credit" : "admin_debit",
            userId: targetUid,
            amount,
            adminId: context.auth.uid,
            reason: reason || "manual_adjustment",
            timestamp: Date.now()
        });

    return { success: true };
});

// ========== UPLOAD PROFILE PICTURE ==========
exports.uploadProfilePicture = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be logged in");
    }

    const { imageData, fileName } = data;
    
    if (!imageData || !fileName) {
        throw new functions.https.HttpsError("invalid-argument", "Missing image data");
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(imageData.split(',')[1], 'base64');
    
    // Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const file = bucket.file(`profile-pictures/${context.auth.uid}/${fileName}`);
    
    await file.save(buffer, {
        metadata: {
            contentType: 'image/jpeg',
            metadata: {
                uploadedBy: context.auth.uid,
                uploadedAt: Date.now()
            }
        }
    });
    
    // Make file public
    await file.makePublic();
    
    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    
    // Update user profile
    await admin.database()
        .ref(`publicProfiles/${context.auth.uid}/profilePhoto`)
        .set(publicUrl);
    
    return { url: publicUrl };
});

// ========== UPDATE PROFILE ==========
exports.updateProfile = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be logged in");
    }

    const { displayName, bio, callPrice, socialLinks } = data;
    
    // Validate data
    if (!displayName || displayName.length < 2 || displayName.length > 50) {
        throw new functions.https.HttpsError("invalid-argument", "Invalid display name");
    }
    
    if (callPrice < 1 || callPrice > 10) {
        throw new functions.https.HttpsError("invalid-argument", "Call price must be 1-10 coins");
    }
    
    // Update profile
    await admin.database()
        .ref(`publicProfiles/${context.auth.uid}`)
        .update({
            displayName,
            bio: bio || '',
            callPrice,
            socialLinks: socialLinks || {},
            updatedAt: Date.now()
        });
    
    return { success: true };
});

// ========== REVIEWS & DISPUTES ==========
exports.submitReview = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Must be logged in");
    }

    const { callId, rating, comment, reportIssue } = data;

    // Get call data
    const callSnap = await admin.database().ref(`calls/${callId}`).get();
    const call = callSnap.val();

    if (!call) {
        throw new functions.https.HttpsError("not-found", "Call not found");
    }

    // Verify user was part of the call
    if (context.auth.uid !== call.callerId && context.auth.uid !== call.whisperId) {
        throw new functions.https.HttpsError("permission-denied", "Not a participant of this call");
    }

    // Save review
    await admin.database().ref(`reviews/${callId}`).set({
        callId,
        reviewerId: context.auth.uid,
        reviewedId: context.auth.uid === call.callerId ? call.whisperId : call.callerId,
        rating,
        comment: comment || "",
        timestamp: Date.now()
    });

    // If rating is low or issue reported, flag for admin review
    if (rating <= 2 || reportIssue) {
        await admin.database().ref(`callDisputes/${callId}`).set({
            callId,
            callerId: call.callerId,
            whisperId: call.whisperId,
            reason: reportIssue ? "user_reported" : "low_rating",
            message: `Rating: ${rating}/5 - ${comment || "No comment"}`,
            createdAt: Date.now(),
            status: "open",
            autoFlag: false
        });
    }

    // Send email notification to admin
    if (functions.config().sendgrid?.key) {
        const msg = {
            to: functions.config().admin.email,
            from: 'reviews@whisperplus.me',
            subject: `New Review: ${rating} stars for call ${callId}`,
            text: `Call: ${callId}\nRating: ${rating}/5\nComment: ${comment || "None"}\nReported: ${reportIssue ? 'Yes' : 'No'}`,
            html: `
                <h3>New Call Review</h3>
                <p><strong>Call ID:</strong> ${callId}</p>
                <p><strong>Rating:</strong> ${'★'.repeat(rating)}${'☆'.repeat(5-rating)}</p>
                <p><strong>Comment:</strong> ${comment || "None"}</p>
                <p><strong>Issue Reported:</strong> ${reportIssue ? 'Yes' : 'No'}</p>
                <p><em>Timestamp: ${new Date().toISOString()}</em></p>
            `
        };

        try {
            await sgMail.send(msg);
        } catch (emailError) {
            console.error('Email send failed:', emailError);
        }
    }

    return { success: true };
});

// ========== AUTOMATIC DISPUTE FLAGGING (FIXED: Increment abuse stats) ==========
exports.flagEarlyEnds = functions.database
    .ref('/calls/{callId}')
    .onUpdate(async (change, context) => {
        const before = change.before.val();
        const after = change.after.val();

        // Check if call just ended and duration is suspicious
        if (before.status === 'active' && after.status === 'ended') {
            const duration = after.duration || 0;
            
            if (duration < 60 && after.answeredAt) { // Less than 60 seconds
                // Create automatic dispute
                await admin.database().ref(`callDisputes/${context.params.callId}`).set({
                    callId: context.params.callId,
                    callerId: after.callerId,
                    whisperId: after.whisperId,
                    reason: "early_termination",
                    message: `Call ended after ${duration} seconds`,
                    createdAt: Date.now(),
                    status: "open",
                    autoFlag: true
                });

                // FIXED: Actually increment abuse counter for whisper
                await admin.database()
                    .ref(`abuseStats/${after.whisperId}/earlyEnds`)
                    .transaction((current) => (current || 0) + 1);
            }
        }

        return null;
    });
