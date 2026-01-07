const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

admin.initializeApp();

const db = admin.database();
const stripe = new Stripe(functions.config().stripe.secret);

// Admin configuration
const ADMIN_EMAIL = 'ifanifwasafifth@gmail.com';

/* ================= CORS HELPER ================= */
const cors = require('cors')({ origin: true });

/* ================= HELPERS ================= */

function isAdmin(context) {
  return context.auth && context.auth.token.email === ADMIN_EMAIL;
}

function validateUser(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  return context.auth.uid;
}

/* ================= STRIPE PAYMENTS ================= */

exports.createCheckout = functions.https.onCall(async (data, context) => {
  const uid = validateUser(context);
  
  const amount = data.amount || 1500; // $15 by default
  
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Whisper Coin' },
          unit_amount: amount
        },
        quantity: 1
      }],
      success_url: 'https://whisper-chat-live.web.app/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://whisper-chat-live.web.app/',
      metadata: {
        userId: uid
      }
    });

    // Save session info
    await db.ref(`stripe_sessions/${session.id}`).set({
      userId: uid,
      amount: amount,
      status: 'pending',
      createdAt: Date.now()
    });

    return { url: session.url };
  } catch (error) {
    console.error('Stripe error:', error);
    throw new functions.https.HttpsError('internal', 'Payment processing failed');
  }
});

/* ================= CALL SYSTEM ================= */

exports.startCall = functions.https.onCall(async ({ whisperId }, context) => {
  const callerId = validateUser(context);
  
  if (!whisperId) {
    throw new functions.https.HttpsError('invalid-argument', 'Whisper ID is required');
  }
  
  // Check if whisper exists and is available
  const whisperSnap = await db.ref(`users/${whisperId}`).once('value');
  const whisper = whisperSnap.val();
  
  if (!whisper) {
    throw new functions.https.HttpsError('not-found', 'Whisper not found');
  }
  
  if (!whisper.isWhisper || !whisper.isAvailable) {
    throw new functions.https.HttpsError('failed-precondition', 'Whisper is not available');
  }
  
  // Check caller has coins
  const callerSnap = await db.ref(`users/${callerId}`).once('value');
  const caller = callerSnap.val();
  
  if (!caller.coins || caller.coins < 1) {
    throw new functions.https.HttpsError('failed-precondition', 'Not enough coins');
  }
  
  // Deduct coin immediately
  await db.ref(`users/${callerId}`).update({
    coins: (caller.coins || 0) - 1
  });
  
  // Create call record
  const callRef = db.ref('calls').push();
  const callId = callRef.key;
  
  await callRef.set({
    id: callId,
    callerId: callerId,
    whisperId: whisperId,
    callerName: caller.displayName || caller.email,
    whisperName: whisper.displayName || whisper.email,
    status: 'ringing',
    coinsCharged: 1,
    createdAt: Date.now(),
    ringingUntil: Date.now() + 60000 // 60 seconds to answer
  });
  
  return { callId: callId };
});

exports.acceptCall = functions.https.onCall(async ({ callId }, context) => {
  const uid = validateUser(context);
  
  const callRef = db.ref(`calls/${callId}`);
  const callSnap = await callRef.once('value');
  const call = callSnap.val();
  
  if (!call) {
    throw new functions.https.HttpsError('not-found', 'Call not found');
  }
  
  if (call.whisperId !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to accept this call');
  }
  
  if (call.status !== 'ringing') {
    throw new functions.https.HttpsError('failed-precondition', 'Call is not ringing');
  }
  
  await callRef.update({
    status: 'accepted',
    acceptedAt: Date.now()
  });
  
  return { success: true };
});

exports.micReady = functions.https.onCall(async ({ callId }, context) => {
  const uid = validateUser(context);
  
  const callRef = db.ref(`calls/${callId}`);
  const callSnap = await callRef.once('value');
  const call = callSnap.val();
  
  if (!call) {
    throw new functions.https.HttpsError('not-found', 'Call not found');
  }
  
  if (call.callerId !== uid && call.whisperId !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not part of this call');
  }
  
  if (call.status !== 'accepted') {
    throw new functions.https.HttpsError('failed-precondition', 'Call not accepted yet');
  }
  
  // Check if both parties are ready
  const participants = call.participantsReady || {};
  participants[uid] = true;
  
  await callRef.update({
    participantsReady: participants
  });
  
  // If both ready, start call
  const readyCount = Object.keys(participants).length;
  if (readyCount >= 2) {
    await callRef.update({
      status: 'active',
      startedAt: Date.now(),
      activeUntil: Date.now() + 300000 // 5 minutes
    });
  }
  
  return { success: true };
});

exports.endCall = functions.https.onCall(async ({ callId }, context) => {
  const uid = validateUser(context);
  
  const callRef = db.ref(`calls/${callId}`);
  const callSnap = await callRef.once('value');
  const call = callSnap.val();
  
  if (!call) {
    throw new functions.https.HttpsError('not-found', 'Call not found');
  }
  
  if (call.callerId !== uid && call.whisperId !== uid && !isAdmin(context)) {
    throw new functions.https.HttpsError('permission-denied', 'Not part of this call');
  }
  
  const now = Date.now();
  const duration = call.startedAt ? now - call.startedAt : 0;
  const minutes = Math.floor(duration / 60000);
  
  await callRef.update({
    status: 'ended',
    endedAt: now,
    duration: duration
  });
  
  // Update whisper earnings if call was long enough
  if (minutes >= 1) { // Only pay for calls over 1 minute
    await db.ref(`users/${call.whisperId}`).update({
      earnings: (call.whisperEarnings || 0) + 1,
      callsCompleted: (call.whisperCallsCompleted || 0) + 1
    });
  } else if (duration < 30000) { // Refund if call too short (< 30s)
    await db.ref(`users/${call.callerId}/coins`).transaction(c => (c || 0) + 1);
    await callRef.update({ flagged: true });
  }
  
  return { success: true };
});

/* ================= AGORA TOKENS ================= */

exports.getAgoraToken = functions.https.onCall(async ({ channel }, context) => {
  validateUser(context);
  
  const appId = functions.config().agora.app_id;
  const appCertificate = functions.config().agora.certificate;
  
  if (!appId || !appCertificate) {
    throw new functions.https.HttpsError('internal', 'Agora configuration missing');
  }
  
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channel,
    0,
    RtcRole.PUBLISHER,
    Math.floor(Date.now() / 1000) + 3600
  );

  return { token };
});

/* ================= ADMIN FUNCTIONS ================= */

exports.adminCheck = functions.https.onCall(async (data, context) => {
  return { isAdmin: isAdmin(context) };
});

exports.adminGiveCoins = functions.https.onCall(async ({ uid, amount }, context) => {
  if (!isAdmin(context)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
  
  if (!uid || !amount || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid parameters');
  }
  
  await db.ref(`users/${uid}/coins`).transaction(c => (c || 0) + amount);
  
  // Log admin action
  await db.ref(`admin_logs`).push().set({
    adminId: context.auth.uid,
    action: 'give_coins',
    targetUserId: uid,
    amount: amount,
    timestamp: Date.now()
  });
  
  return { success: true };
});

exports.adminFreeCall = functions.https.onCall(async ({ uid }, context) => {
  if (!isAdmin(context)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
  
  return { allowed: true };
});

/* ================= STRIPE WEBHOOK ================= */

exports.stripeWebhook = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
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
    
    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        
        // Add coins to user
        const metadata = session.metadata;
        if (metadata && metadata.userId) {
          const amount = session.amount_total / 100; // Convert cents to dollars
          const coins = Math.floor(amount / 15); // $15 per coin
          
          await db.ref(`users/${metadata.userId}/coins`).transaction(c => (c || 0) + coins);
        }
        break;
        
      default:
        console.log(`Unhandled event type ${event.type}`);
    }
    
    res.json({ received: true });
  });
});

/* ================= CORS HANDLER ================= */

exports.corsHandler = functions.https.onRequest((req, res) => {
  return cors(req, res, () => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.send('CORS configured');
  });
});
