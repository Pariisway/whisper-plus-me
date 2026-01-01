const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.secret_key);
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const cors = require('cors')({ origin: true });

admin.initializeApp();

// Generate Agora token server-side (CRITICAL: Never expose App Certificate in client)
exports.generateAgoraToken = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { channelName, uid } = data;
  
  if (!channelName || !uid) {
    throw new functions.https.HttpsError('invalid-argument', 'Channel name and UID are required');
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
    uid
  };
});

// Create Stripe Checkout Session
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

  // Define coin packages
  const packages = {
    'coins_100': {
      amount: 999, // $9.99
      coins: 100,
      description: '100 Coins'
    },
    'coins_250': {
      amount: 1999, // $19.99
      coins: 250,
      description: '250 Coins (25% bonus)'
    },
    'coins_500': {
      amount: 3499, // $34.99
      coins: 500,
      description: '500 Coins (40% bonus)'
    },
    'coins_1000': {
      amount: 5999, // $59.99
      coins: 1000,
      description: '1000 Coins (50% bonus)'
    }
  };

  const selectedPackage = packages[packageId];
  if (!selectedPackage) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid package');
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Whisper+me - ${selectedPackage.description}`,
              description: `Get ${selectedPackage.coins} coins for calling`
            },
            unit_amount: selectedPackage.amount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${functions.config().site.url}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${functions.config().site.url}/dashboard?payment=cancelled`,
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

// Stripe webhook handler (CRITICAL: Secure coin crediting)
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

  // Handle the checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId, packageId, coins } = session.metadata;

    try {
      // Verify payment was successful
      if (session.payment_status === 'paid') {
        // Add coins to user's account - SECURE SERVER-SIDE OPERATION
        const userRef = admin.database().ref(`users/${userId}/coins`);
        const snapshot = await userRef.once('value');
        const currentCoins = snapshot.val() || 0;
        
        await userRef.transaction((current) => {
          return (current || 0) + parseInt(coins);
        });

        // Record transaction
        await admin.database().ref(`transactions/${userId}/${Date.now()}`).set({
          amount: parseInt(coins),
          packageId,
          sessionId: session.id,
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

// Secure coin deduction for call initiation
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
    if (receiverData.isAvailable === false) {
      throw new functions.https.HttpsError('failed-precondition', 'User is not available for calls');
    }

    // Check caller has enough coins
    if (callerData.coins < 1) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient coins');
    }

    // Atomic transaction to deduct coin
    const callerCoinsRef = admin.database().ref(`users/${callerId}/coins`);
    const result = await callerCoinsRef.transaction((currentCoins) => {
      if (currentCoins === null) return 0;
      if (currentCoins < 1) return currentCoins;
      return currentCoins - 1;
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
      status: 'ringing',
      coinDeducted: true,
      coinEscrow: true, // Coin held until call connects
      createdAt: admin.database.ServerValue.TIMESTAMP,
      expiresAt: Date.now() + 60000 // 1 minute to answer
    };

    await admin.database().ref(`calls/${callId}`).set(callData);

    // Send notification to receiver
    await admin.database().ref(`notifications/${receiverId}`).push({
      type: 'incoming_call',
      callId,
      callerId,
      callerName: callerData.displayName,
      timestamp: Date.now(),
      status: 'unread'
    });

    return {
      success: true,
      callId,
      remainingCoins: result.snapshot.val()
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

    const { callerId, receiverId } = callData;

    if (newStatus === 'connected') {
      // Coin goes to receiver
      const receiverRef = admin.database().ref(`users/${receiverId}/coins`);
      await receiverRef.transaction((current) => {
        return (current || 0) + 1;
      });

      // Update call to release escrow
      await change.after.ref.update({
        coinEscrow: false,
        coinReleased: true,
        connectedAt: admin.database.ServerValue.TIMESTAMP
      });

      console.log(`Released coin from call ${callId} to receiver ${receiverId}`);

    } else if (newStatus === 'declined' || newStatus === 'timeout' || newStatus === 'cancelled') {
      // Refund coin to caller
      const callerRef = admin.database().ref(`users/${callerId}/coins`);
      await callerRef.transaction((current) => {
        return (current || 0) + 1;
      });

      // Update call to release escrow
      await change.after.ref.update({
        coinEscrow: false,
        coinRefunded: true,
        endedAt: admin.database.ServerValue.TIMESTAMP
      });

      console.log(`Refunded coin from call ${callId} to caller ${callerId}`);
    }

    return null;
  });
}

// Cleanup expired calls
exports.cleanupExpiredCalls = functions.pubsub.schedule('every 5 minutes').onRun(async (context) => {
  const now = Date.now();
  const callsRef = admin.database().ref('calls');
  const snapshot = await callsRef.orderByChild('expiresAt').endAt(now).once('value');

  const updates = {};
  snapshot.forEach((child) => {
    const call = child.val();
    if (call.status === 'ringing' && call.expiresAt < now) {
      updates[`calls/${child.key}/status`] = 'timeout';
    }
  });

  await admin.database().ref().update(updates);
  console.log(`Cleaned up ${Object.keys(updates).length} expired calls`);
  return null;
});

// Admin function to manually adjust coins (for support)
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
