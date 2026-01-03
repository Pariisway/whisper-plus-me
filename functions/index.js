const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const { v4: uuidv4 } = require('uuid');

admin.initializeApp();

// Get Agora App Certificate from environment config
const AGORA_APP_ID = '966c8e41da614722a88d4372c3d95dba';
const AGORA_APP_CERTIFICATE = functions.config().agora.cert || '9113b7b993cb442882b983adbc0b950b';

// Utility: Convert string to numeric UID for Agora
function stringToNumericUid(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash) % 1000000;
}

// Generate Agora token
exports.getAgoraToken = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { channelName, uid } = data;
    
    if (!channelName) {
        throw new functions.https.HttpsError('invalid-argument', 'Channel name is required');
    }

    // Generate numeric UID that matches client-side
    const numericUid = stringToNumericUid(uid || context.auth.uid);
    
    const expirationTimeInSeconds = 3600; // 1 hour
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;
    
    const token = RtcTokenBuilder.buildTokenWithUid(
        AGORA_APP_ID,
        AGORA_APP_CERTIFICATE,
        channelName,
        numericUid,
        RtcRole.PUBLISHER,
        privilegeExpiredTs
    );
    
    return { 
        token: token, 
        uid: numericUid,
        appId: AGORA_APP_ID
    };
});

// Start a call
exports.startCall = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { whisperId, whisperName, callPrice = 1 } = data;
    const callerId = context.auth.uid;
    
    if (!whisperId) {
        throw new functions.https.HttpsError('invalid-argument', 'Whisper ID is required');
    }

    try {
        // Get caller data
        const callerRef = admin.database().ref(`users/${callerId}`);
        const callerSnap = await callerRef.once('value');
        const caller = callerSnap.val();
        
        if (!caller) {
            throw new functions.https.HttpsError('not-found', 'Caller not found');
        }
        
        // Check if caller has enough coins
        if ((caller.coins || 0) < callPrice) {
            throw new functions.https.HttpsError('failed-precondition', 'Insufficient coins');
        }
        
        // Get whisper data
        const whisperRef = admin.database().ref(`users/${whisperId}`);
        const whisperSnap = await whisperRef.once('value');
        const whisper = whisperSnap.val();
        
        if (!whisper) {
            throw new functions.https.HttpsError('not-found', 'Whisper not found');
        }
        
        // Check if whisper is available
        const whisperProfileSnap = await admin.database().ref(`publicProfiles/${whisperId}`).once('value');
        const whisperProfile = whisperProfileSnap.val();
        
        if (!whisperProfile || !whisperProfile.isAvailable) {
            throw new functions.https.HttpsError('failed-precondition', 'Whisper is not available');
        }
        
        // Generate call ID
        const callId = uuidv4();
        
        // Create call record
        const call = {
            id: callId,
            callerId: callerId,
            whisperId: whisperId,
            callerName: caller.displayName || caller.email?.split('@')[0] || 'Anonymous',
            whisperName: whisper.displayName || whisperProfile.displayName || whisper.email?.split('@')[0] || 'Anonymous',
            coinsCharged: callPrice,
            status: 'ringing',
            createdAt: Date.now(),
            expiresAt: Date.now() + (60 * 1000) // 60 seconds to answer
        };
        
        // Deduct coins from caller (server-side, secure)
        await callerRef.update({
            coins: Math.max(0, (caller.coins || 0) - callPrice)
        });
        
        // Create call record
        await admin.database().ref(`calls/${callId}`).set(call);
        
        return { 
            success: true, 
            callId: callId,
            message: 'Call initiated successfully'
        };
        
    } catch (error) {
        console.error('Start call error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to start call');
    }
});

// Answer a call
exports.answerCall = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { callId } = data;
    const whisperId = context.auth.uid;
    
    if (!callId) {
        throw new functions.https.HttpsError('invalid-argument', 'Call ID is required');
    }

    try {
        const callRef = admin.database().ref(`calls/${callId}`);
        const callSnap = await callRef.once('value');
        const call = callSnap.val();
        
        if (!call) {
            throw new functions.https.HttpsError('not-found', 'Call not found');
        }
        
        if (call.whisperId !== whisperId) {
            throw new functions.https.HttpsError('permission-denied', 'Not authorized to answer this call');
        }
        
        if (call.status !== 'ringing') {
            throw new functions.https.HttpsError('failed-precondition', 'Call not in ringing state');
        }
        
        // Update call status
        await callRef.update({
            status: 'active',
            answeredAt: Date.now(),
            endsAt: Date.now() + (5 * 60 * 1000) // 5 minute call
        });
        
        return { success: true, message: 'Call answered successfully' };
        
    } catch (error) {
        console.error('Answer call error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to answer call');
    }
});

// End a call
exports.endCall = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { callId } = data;
    const userId = context.auth.uid;
    
    if (!callId) {
        throw new functions.https.HttpsError('invalid-argument', 'Call ID is required');
    }

    try {
        const callRef = admin.database().ref(`calls/${callId}`);
        const callSnap = await callRef.once('value');
        const call = callSnap.val();
        
        if (!call) {
            throw new functions.https.HttpsError('not-found', 'Call not found');
        }
        
        if (call.callerId !== userId && call.whisperId !== userId) {
            throw new functions.https.HttpsError('permission-denied', 'Not authorized to end this call');
        }
        
        // Update call status
        await callRef.update({
            status: 'completed',
            endedAt: Date.now(),
            endedBy: userId
        });
        
        // Calculate whisper earnings ($12 per coin)
        const whisperEarnings = (call.coinsCharged || 1) * 12;
        
        // Update whisper's earnings
        await admin.database().ref(`users/${call.whisperId}`).update({
            earnings: admin.database.ServerValue.increment(whisperEarnings),
            callsCompleted: admin.database.ServerValue.increment(1)
        });
        
        // Update whisper's public profile
        await admin.database().ref(`publicProfiles/${call.whisperId}`).update({
            earnings: admin.database.ServerValue.increment(whisperEarnings),
            callsCompleted: admin.database.ServerValue.increment(1),
            lastSeen: Date.now()
        });
        
        // Update caller's call count
        await admin.database().ref(`users/${call.callerId}`).update({
            callsCompleted: admin.database.ServerValue.increment(1)
        });
        
        return { 
            success: true, 
            message: 'Call ended successfully',
            whisperEarned: whisperEarnings
        };
        
    } catch (error) {
        console.error('End call error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to end call');
    }
});

// Cancel a call (before answer)
exports.cancelCall = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { callId } = data;
    const userId = context.auth.uid;
    
    if (!callId) {
        throw new functions.https.HttpsError('invalid-argument', 'Call ID is required');
    }

    try {
        const callRef = admin.database().ref(`calls/${callId}`);
        const callSnap = await callRef.once('value');
        const call = callSnap.val();
        
        if (!call) {
            throw new functions.https.HttpsError('not-found', 'Call not found');
        }
        
        if (call.callerId !== userId) {
            throw new functions.https.HttpsError('permission-denied', 'Not authorized to cancel this call');
        }
        
        if (call.status !== 'ringing') {
            throw new functions.https.HttpsError('failed-precondition', 'Call cannot be cancelled');
        }
        
        // Refund coins to caller
        const callerRef = admin.database().ref(`users/${call.callerId}`);
        const callerSnap = await callerRef.once('value');
        const caller = callerSnap.val();
        
        if (caller) {
            await callerRef.update({
                coins: (caller.coins || 0) + (call.coinsCharged || 1)
            });
        }
        
        // Update call status
        await callRef.update({
            status: 'cancelled',
            cancelledAt: Date.now(),
            cancelledBy: userId
        });
        
        return { success: true, message: 'Call cancelled successfully' };
        
    } catch (error) {
        console.error('Cancel call error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to cancel call');
    }
});

// Buy coins
exports.buyCoins = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { amount, price } = data;
    const userId = context.auth.uid;
    
    if (!amount || amount < 1) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid amount');
    }
    
    try {
        const userRef = admin.database().ref(`users/${userId}`);
        const userSnap = await userRef.once('value');
        const user = userSnap.val();
        
        if (!user) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }
        
        // Add coins
        await userRef.update({
            coins: (user.coins || 0) + amount
        });
        
        // Record transaction
        const transactionId = uuidv4();
        await admin.database().ref(`transactions/${transactionId}`).set({
            userId: userId,
            amount: amount,
            price: price || (amount * 15), // $15 per coin
            coinsAdded: amount,
            status: 'completed',
            createdAt: Date.now()
        });
        
        return { 
            success: true, 
            coinsAdded: amount,
            newBalance: (user.coins || 0) + amount
        };
        
    } catch (error) {
        console.error('Buy coins error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to buy coins');
    }
});

// Submit review
exports.submitReview = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const { callId, rating, comment } = data;
    const userId = context.auth.uid;
    
    if (!callId || !rating) {
        throw new functions.https.HttpsError('invalid-argument', 'Call ID and rating are required');
    }
    
    if (rating < 1 || rating > 5) {
        throw new functions.https.HttpsError('invalid-argument', 'Rating must be between 1 and 5');
    }
    
    try {
        const callSnap = await admin.database().ref(`calls/${callId}`).once('value');
        const call = callSnap.val();
        
        if (!call) {
            throw new functions.https.HttpsError('not-found', 'Call not found');
        }
        
        // Determine who is being rated
        const ratedUserId = call.callerId === userId ? call.whisperId : call.callerId;
        
        // Save review
        const reviewId = uuidv4();
        await admin.database().ref(`reviews/${reviewId}`).set({
            callId: callId,
            reviewerId: userId,
            ratedUserId: ratedUserId,
            rating: rating,
            comment: comment || '',
            createdAt: Date.now()
        });
        
        // Calculate average rating for the rated user
        const reviewsSnap = await admin.database().ref('reviews')
            .orderByChild('ratedUserId')
            .equalTo(ratedUserId)
            .once('value');
        
        let totalRating = 0;
        let reviewCount = 0;
        
        reviewsSnap.forEach(review => {
            totalRating += review.val().rating;
            reviewCount++;
        });
        
        const averageRating = reviewCount > 0 ? (totalRating / reviewCount) : 5.0;
        
        // Update user's rating
        await admin.database().ref(`users/${ratedUserId}`).update({
            rating: averageRating.toFixed(1)
        });
        
        // Update public profile rating
        await admin.database().ref(`publicProfiles/${ratedUserId}`).update({
            rating: averageRating.toFixed(1)
        });
        
        return { success: true, message: 'Review submitted successfully' };
        
    } catch (error) {
        console.error('Submit review error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to submit review');
    }
});

// Cleanup expired calls (scheduled function)
exports.cleanupExpiredCalls = functions.pubsub.schedule('every 5 minutes').onRun(async (context) => {
    const now = Date.now();
    
    try {
        const callsRef = admin.database().ref('calls');
        const snapshot = await callsRef.once('value');
        
        const updates = {};
        
        snapshot.forEach((child) => {
            const call = child.val();
            
            // Cleanup ringing calls older than 60 seconds
            if (call.status === 'ringing' && call.expiresAt && call.expiresAt < now) {
                updates[`${child.key}/status`] = 'expired';
                updates[`${child.key}/expiredAt`] = now;
                
                // Refund coins to caller
                const callerRef = admin.database().ref(`users/${call.callerId}`);
                callerRef.transaction((current) => {
                    if (current) {
                        current.coins = (current.coins || 0) + (call.coinsCharged || 1);
                    }
                    return current;
                });
            }
            
            // Cleanup active calls older than 5 minutes
            if (call.status === 'active' && call.endsAt && call.endsAt < now) {
                updates[`${child.key}/status`] = 'auto-ended';
                updates[`${child.key}/endedAt`] = now;
                
                // Process earnings for whisper
                const whisperEarnings = (call.coinsCharged || 1) * 12;
                const whisperRef = admin.database().ref(`users/${call.whisperId}`);
                
                whisperRef.transaction((current) => {
                    if (current) {
                        current.earnings = (current.earnings || 0) + whisperEarnings;
                        current.callsCompleted = (current.callsCompleted || 0) + 1;
                    }
                    return current;
                });
                
                // Update public profile
                const profileRef = admin.database().ref(`publicProfiles/${call.whisperId}`);
                profileRef.transaction((current) => {
                    if (current) {
                        current.earnings = (current.earnings || 0) + whisperEarnings;
                        current.callsCompleted = (current.callsCompleted || 0) + 1;
                        current.lastSeen = Date.now();
                    }
                    return current;
                });
            }
        });
        
        if (Object.keys(updates).length > 0) {
            await callsRef.update(updates);
            console.log(`Cleaned up ${Object.keys(updates).length / 2} expired calls`);
        }
        
    } catch (error) {
        console.error('Cleanup error:', error);
    }
    
    return null;
});

// Update user heartbeat
exports.updateHeartbeat = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }
    
    const userId = context.auth.uid;
    
    try {
        await admin.database().ref(`publicProfiles/${userId}`).update({
            lastSeen: Date.now()
        });
        
        return { success: true };
        
    } catch (error) {
        console.error('Heartbeat error:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

console.log('✅ Firebase Functions Initialized');
