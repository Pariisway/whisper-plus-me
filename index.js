const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.secret_key);
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

admin.initializeApp();

// ============================================
// PHASE 3.1: COINS ARE READ-ONLY ON CLIENT
// ============================================

// Process Stripe webhook with idempotency
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.rawBody,
            sig,
            functions.config().stripe.webhook_secret
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle checkout.session.completed
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const { userId, packageId, coins } = session.metadata;

        try {
            // Idempotency check
            const processedRef = admin.database().ref(`processedSessions/${session.id}`);
            const alreadyProcessed = await processedRef.once('value');
            
            if (alreadyProcessed.exists()) {
                console.log(`Session ${session.id} already processed`);
                return res.json({ received: true });
            }

            // Mark as processed
            await processedRef.set({
                processedAt: admin.database.ServerValue.TIMESTAMP,
                userId: userId
            });

            // Verify payment
            if (session.payment_status === 'paid') {
                // Add coins to user - ONLY SERVER CAN DO THIS
                const userRef = admin.database().ref(`users/${userId}/coins`);
                await userRef.transaction((current) => {
                    return (current || 0) + parseInt(coins);
                });

                // Record transaction
                await admin.database().ref(`transactions/${userId}/${session.id}`).set({
                    sessionId: session.id,
                    packageId: packageId,
                    coins: parseInt(coins),
                    amountPaid: session.amount_total / 100,
                    currency: session.currency,
                    timestamp: admin.database.ServerValue.TIMESTAMP
                });

                console.log(`Added ${coins} coins to user ${userId}`);
            }
        } catch (error) {
            console.error('Error processing webhook:', error);
        }
    }

    res.json({ received: true });
});

// Create Stripe checkout session
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { packageId } = data;
    const userId = context.auth.uid;

    // Get user data
    const userSnapshot = await admin.database().ref(`users/${userId}`).once('value');
    const userData = userSnapshot.val();

    if (!userData) {
        throw new functions.https.HttpsError('not-found', 'User not found');
    }

    // Define coin packages - $15 PER COIN, NO DISCOUNTS
    const packages = {
        'coins_1': { amount: 1500, coins: 1, description: '1 Coin' },
        'coins_2': { amount: 3000, coins: 2, description: '2 Coins' },
        'coins_3': { amount: 4500, coins: 3, description: '3 Coins' },
        'coins_5': { amount: 7500, coins: 5, description: '5 Coins' },
        'coins_10': { amount: 15000, coins: 10, description: '10 Coins' }
    };

    const selectedPackage = packages[packageId];
    if (!selectedPackage) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid package');
    }

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Whisper+me - ${selectedPackage.description}`,
                        description: `Get ${selectedPackage.coins} coins for calling`
                    },
                    unit_amount: selectedPackage.amount,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${functions.config().site.url}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${functions.config().site.url}/?payment=cancelled`,
            metadata: {
                userId: userId,
                packageId: packageId,
                coins: selectedPackage.coins.toString()
            },
            customer_email: userData.email,
        });

        return { sessionId: session.id };
    } catch (error) {
        console.error('Stripe session creation error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to create checkout session');
    }
});

// ============================================
// PHASE 3.3: ESCROW LOGIC
// ============================================

// Deduct coin when call starts (with escrow)
exports.deductCallCoin = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { receiverId } = data;
    const callerId = context.auth.uid;

    if (!receiverId) {
        throw new functions.https.HttpsError('invalid-argument', 'Receiver ID is required');
    }

    try {
        // Verify both users exist
        const [callerSnap, receiverSnap] = await Promise.all([
            admin.database().ref(`users/${callerId}`).once('value'),
            admin.database().ref(`users/${receiverId}`).once('value')
        ]);

        const callerData = callerSnap.val();
        const receiverData = receiverSnap.val();

        if (!callerData || !receiverData) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }

        // Check if receiver is available
        if (receiverData.isAvailable !== true) {
            throw new functions.https.HttpsError('failed-precondition', 'User is not available for calls');
        }

        // Check caller has enough coins
        if (callerData.coins < 1) {
            throw new functions.https.HttpsError('failed-precondition', 'Insufficient coins');
        }

        // Get call price from receiver
        const callPrice = receiverData.callPrice || 1;
        
        if (callerData.coins < callPrice) {
            throw new functions.https.HttpsError('failed-precondition', `Need ${callPrice} coins for this call`);
        }

        // Atomic transaction to deduct coins into escrow
        const callerCoinsRef = admin.database().ref(`users/${callerId}/coins`);
        const result = await callerCoinsRef.transaction((currentCoins) => {
            if (currentCoins === null) return 0;
            if (currentCoins < callPrice) return currentCoins;
            return currentCoins - callPrice;
        });

        if (!result.committed || result.snapshot.val() < 0) {
            throw new functions.https.HttpsError('failed-precondition', 'Insufficient coins after verification');
        }

        // Create call record with escrow
        const callId = `call_${Date.now()}_${callerId}_${receiverId}`;
        const callData = {
            callId,
            callerId,
            callerName: callerData.displayName,
            receiverId,
            receiverName: receiverData.displayName,
            coins: callPrice,
            status: 'ringing',
            coinEscrow: true,
            escrowAmount: callPrice,
            createdAt: admin.database.ServerValue.TIMESTAMP,
            expiresAt: Date.now() + 60000, // 1 minute to answer
            maxDuration: 300000 // 5 minutes max
        };

        await admin.database().ref(`calls/${callId}`).set(callData);

        // Send notification to receiver
        await admin.database().ref(`notifications/${receiverId}`).push({
            type: 'incoming_call',
            callId,
            callerId,
            callerName: callerData.displayName,
            callPrice: callPrice,
            timestamp: Date.now(),
            status: 'unread'
        });

        return {
            success: true,
            callId,
            remainingCoins: result.snapshot.val(),
            callPrice: callPrice
        };

    } catch (error) {
        console.error('Deduct call coin error:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to initiate call');
    }
});

// Release or refund coin escrow
exports.handleCallCompletion = functions.database.ref('/calls/{callId}/status')
    .onUpdate(async (change, context) => {
        const newStatus = change.after.val();
        const callId = context.params.callId;
        const callData = (await change.after.ref.once('value')).val();

        // Only process if coin is in escrow
        if (!callData.coinEscrow) return null;

        const { callerId, receiverId, coins } = callData;

        if (newStatus === 'connected') {
            // Wait 30 seconds to ensure call is established
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            // Check if call is still connected
            const updatedCall = (await change.after.ref.once('value')).val();
            if (updatedCall.status !== 'connected') return null;

            // Coin goes to receiver
            const receiverRef = admin.database().ref(`users/${receiverId}`);
            await receiverRef.transaction((user) => {
                if (!user) return user;
                return {
                    ...user,
                    coins: (user.coins || 0) + coins,
                    earnings: (user.earnings || 0) + (coins * 12), // $12 per coin
                    callsCompleted: (user.callsCompleted || 0) + 1
                };
            });

            // Update call to release escrow
            await change.after.ref.update({
                coinEscrow: false,
                coinReleased: true,
                releasedAt: admin.database.ServerValue.TIMESTAMP
            });

            console.log(`Released ${coins} coins from call ${callId} to receiver ${receiverId}`);

        } else if (['declined', 'timeout', 'cancelled'].includes(newStatus)) {
            // Refund coin to caller
            const callerRef = admin.database().ref(`users/${callerId}/coins`);
            await callerRef.transaction((current) => {
                return (current || 0) + coins;
            });

            // Update call to release escrow
            await change.after.ref.update({
                coinEscrow: false,
                coinRefunded: true,
                refundedAt: admin.database.ServerValue.TIMESTAMP
            });

            console.log(`Refunded ${coins} coins from call ${callId} to caller ${callerId}`);
        }

        return null;
    });

// ============================================
// PHASE 4.1: AGORA TOKEN GENERATION
// ============================================

// Generate Agora token server-side
exports.generateAgoraToken = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { channelName } = data;
    const uid = context.auth.uid; // Use Firebase UID as Agora UID
    
    if (!channelName) {
        throw new functions.https.HttpsError('invalid-argument', 'Channel name is required');
    }

    // Verify user has access to this channel (call exists)
    const callSnapshot = await admin.database().ref(`calls/${channelName}`).once('value');
    const callData = callSnapshot.val();
    
    if (!callData) {
        throw new functions.https.HttpsError('permission-denied', 'Call not found');
    }

    if (callData.callerId !== uid && callData.receiverId !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Not authorized for this call');
    }

    const appId = functions.config().agora.app_id;
    const appCertificate = functions.config().agora.app_certificate;
    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
        appId,
        appCertificate,
        channelName,
        uid,
        role,
        privilegeExpiredTs
    );

    return {
        token,
        appId,
        channelName,
        uid: uid.toString()
    };
});

// ============================================
// PHASE 4.2: HARD CALL TIMEOUT
// ============================================

// Auto-end calls at 5 minutes
exports.autoEndCalls = functions.pubsub.schedule('every 1 minutes').onRun(async (context) => {
    const now = Date.now();
    const callsRef = admin.database().ref('calls');
    const snapshot = await callsRef.orderByChild('createdAt').once('value');

    const updates = {};
    
    snapshot.forEach((child) => {
        const call = child.val();
        
        // End calls that have been connected for more than 5 minutes
        if (call.status === 'connected' && call.createdAt) {
            const callDuration = now - call.createdAt;
            if (callDuration > 300000) { // 5 minutes
                updates[`calls/${child.key}/status`] = 'ended';
                updates[`calls/${child.key}/autoEnded`] = true;
                updates[`calls/${child.key}/endedAt`] = now;
                console.log(`Auto-ended call ${child.key} after 5 minutes`);
            }
        }
        
        // Timeout calls that have been ringing for more than 1 minute
        if (call.status === 'ringing' && call.expiresAt && call.expiresAt < now) {
            updates[`calls/${child.key}/status`] = 'timeout';
            console.log(`Timed out call ${child.key}`);
        }
    });

    if (Object.keys(updates).length > 0) {
        await admin.database().ref().update(updates);
    }

    return null;
});

// ============================================
// PHASE 4.3: CALL STATE MANAGEMENT
// ============================================

// Update call status (only server should advance states)
exports.updateCallStatus = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callId, status } = data;
    const userId = context.auth.uid;

    if (!callId || !status) {
        throw new functions.https.HttpsError('invalid-argument', 'Call ID and status are required');
    }

    // Get call data
    const callSnapshot = await admin.database().ref(`calls/${callId}`).once('value');
    const callData = callSnapshot.val();

    if (!callData) {
        throw new functions.https.HttpsError('not-found', 'Call not found');
    }

    // Verify user is part of this call
    if (callData.callerId !== userId && callData.receiverId !== userId) {
        throw new functions.https.HttpsError('permission-denied', 'Not authorized for this call');
    }

    // Validate state transitions
    const validTransitions = {
        'ringing': ['answered', 'declined', 'cancelled', 'timeout'],
        'answered': ['connected', 'cancelled'],
        'connected': ['ended'],
        'ended': [] // Final state
    };

    const currentStatus = callData.status;
    const allowedNextStates = validTransitions[currentStatus] || [];

    if (!allowedNextStates.includes(status)) {
        throw new functions.https.HttpsError('failed-precondition', 
            `Invalid state transition: ${currentStatus} -> ${status}`);
    }

    // Update call status
    const updates = {
        status: status,
        updatedAt: admin.database.ServerValue.TIMESTAMP
    };

    if (status === 'answered') {
        updates.answeredAt = admin.database.ServerValue.TIMESTAMP;
        updates.answeredBy = userId;
    } else if (status === 'connected') {
        updates.connectedAt = admin.database.ServerValue.TIMESTAMP;
    } else if (status === 'ended') {
        updates.endedAt = admin.database.ServerValue.TIMESTAMP;
        updates.endedBy = userId;
        
        // Calculate duration
        if (callData.connectedAt) {
            updates.duration = Date.now() - callData.connectedAt;
        }
    }

    await admin.database().ref(`calls/${callId}`).update(updates);

    return { success: true };
});

// ============================================
// PHASE 8.2: RATE LIMITING
// ============================================

// Rate limiting for call initiation
exports.rateLimitCalls = functions.database.ref('/calls/{callId}')
    .onCreate(async (snapshot, context) => {
        const callData = snapshot.val();
        const callerId = callData.callerId;
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);

        // Count calls from this user in the last hour
        const callsSnapshot = await admin.database().ref('calls')
            .orderByChild('callerId')
            .equalTo(callerId)
            .once('value');

        let callCount = 0;
        callsSnapshot.forEach((call) => {
            if (call.val().createdAt > oneHourAgo) {
                callCount++;
            }
        });

        // Limit: 10 calls per hour
        if (callCount > 10) {
            // Delete the call and refund coins
            await snapshot.ref.remove();
            
            // Refund coins
            const callerRef = admin.database().ref(`users/${callerId}/coins`);
            await callerRef.transaction((current) => {
                return (current || 0) + (callData.coins || 1);
            });

            throw new functions.https.HttpsError('resource-exhausted', 
                'Rate limit exceeded: Maximum 10 calls per hour');
        }

        return null;
    });

// ============================================
// ADMIN FUNCTIONS
// ============================================

// Admin function to manually adjust coins
exports.adminAdjustCoins = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Verify admin role
    const adminSnapshot = await admin.database().ref(`users/${context.auth.uid}/role`).once('value');
    if (adminSnapshot.val() !== 'admin') {
        throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }

    const { targetUserId, coinChange, reason } = data;
    
    if (!targetUserId || !coinChange || !reason) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
    }

    const userRef = admin.database().ref(`users/${targetUserId}/coins`);
    const result = await userRef.transaction((current) => {
        return (current || 0) + coinChange;
    });

    // Log admin action
    await admin.database().ref(`admin_logs/${Date.now()}`).set({
        adminId: context.auth.uid,
        targetUserId,
        coinChange,
        reason,
        timestamp: admin.database.ServerValue.TIMESTAMP,
        newBalance: result.snapshot.val()
    });

    return {
        success: true,
        newBalance: result.snapshot.val()
    };
});

// Cleanup old notifications
exports.cleanupOldNotifications = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const notificationsRef = admin.database().ref('notifications');
    const snapshot = await notificationsRef.once('value');

    const updates = {};
    
    snapshot.forEach((userNotifications) => {
        userNotifications.forEach((notification) => {
            if (notification.val().timestamp < oneWeekAgo) {
                updates[`notifications/${userNotifications.key}/${notification.key}`] = null;
            }
        });
    });

    if (Object.keys(updates).length > 0) {
        await admin.database().ref().update(updates);
        console.log(`Cleaned up old notifications`);
    }

    return null;
});
