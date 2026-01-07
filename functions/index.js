const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

admin.initializeApp();

const db = admin.database();
const stripe = new Stripe(functions.config().stripe.secret);

// Admin configuration
const ADMIN_EMAIL = 'ifanifwasafifth@gmail.com';

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
  
  const { amount = 1500 } = data; // $15 by default
  
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
    cancel_url: 'https://whisper-chat-live.web.app/cancel',
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
});

/* ================= CALL SYSTEM ================= */

exports.startCall = functions.https.onCall(async ({ whisperId }, context) => {
  const callerId = validateUser(context);
  
  // Check if whisper exists and is available
  const whisperSnap = await db.ref(`users/${whisperId}`).once('value');
  const whisper = whisperSnap.val();
  
  if (!whisper || !whisper.isWhisper || !whisper.isAvailable) {
    throw new functions.https.HttpsError('failed-precondition', 'Whisper is not available');
  }
  
  // Check caller has coins
  const callerSnap = await db.ref(`users/${callerId}`).once('value');
  const caller = callerSnap.val();
  
  if (!caller.coins || caller.coins < 1) {
    throw new functions.https.HttpsError('failed-precondition', 'Not enough coins');
  }
  
  // Create call record
  const callRef = db.ref('calls').push();
  const callId = callRef.key;
  
  await callRef.set({
    id: callId,
    callerId: callerId,
    whisperId: whisperId,
    status: 'ringing',
    coinsCharged: 1,
    createdAt: Date.now(),
    ringingUntil: Date.now() + 60000 // 60 seconds to answer
  });
  
  // Set up auto-cancel if not answered
  setTimeout(async () => {
    const callSnap = await callRef.once('value');
    const call = callSnap.val();
    
    if (call && call.status === 'ringing') {
      await callRef.update({ 
        status: 'expired',
        endedAt: Date.now()
      });
      
      // Refund coin
      await db.ref(`users/${callerId}/coins`).transaction(c => (c || 0) + 1);
    }
  }, 60000);
  
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
    
    // Set up auto-end timer
    setTimeout(async () => {
      const currentSnap = await callRef.once('value');
      const currentCall = currentSnap.val();
      
      if (currentCall && currentCall.status === 'active') {
        await endCall(callId, currentCall);
      }
    }, 300000);
  }
  
  return { success: true };
});

async function endCall(callId, call) {
  const callRef = db.ref(`calls/${callId}`);
  
  const duration = Date.now() - call.startedAt;
  const minutes = Math.floor(duration / 60000);
  
  await callRef.update({
    status: 'ended',
    endedAt: Date.now(),
    duration: duration,
    flagged: duration < 30000 // Flag calls under 30 seconds
  });
  
  // Update whisper earnings
  if (minutes >= 1) { // Only pay for calls over 1 minute
    await db.ref(`users/${call.whisperId}/earnings`).transaction(e => (e || 0) + 1);
    await db.ref(`users/${call.whisperId}/callsCompleted`).transaction(c => (c || 0) + 1);
  } else {
    // Refund if call too short
    await db.ref(`users/${call.callerId}/coins`).transaction(c => (c || 0) + 1);
    await callRef.update({ flagged: true });
  }
}

exports.endCall = functions.https.onCall(async ({ callId }, context) => {
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
  
  await endCall(callId, call);
  
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

/* ================= WEBHOOKS ================= */

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
  
  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      const sessionId = session.id;
      
      // Update session status
      await db.ref(`stripe_sessions/${sessionId}`).update({
        status: 'completed',
        completedAt: Date.now()
      });
      
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

/* ================= UTILITY FUNCTIONS ================= */

exports.cleanupOldCalls = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
  const now = Date.now();
  const cutoff = now - (30 * 24 * 60 * 60 * 1000); // 30 days
  
  const callsRef = db.ref('calls');
  const snapshot = await callsRef.once('value');
  
  const updates = {};
  snapshot.forEach(child => {
    const call = child.val();
    if (call.createdAt < cutoff) {
      updates[child.key] = null;
    }
  });
  
  await callsRef.update(updates);
  console.log(`Cleaned up ${Object.keys(updates).length} old calls`);
  
  return null;
});

exports.processPendingPayouts = functions.pubsub.schedule('every monday 09:00').onRun(async (context) => {
  const usersRef = db.ref('users');
  const snapshot = await usersRef.once('value');
  
  const payouts = [];
  snapshot.forEach(child => {
    const user = child.val();
    if (user.earnings && user.earnings > 0 && user.paypalEmail) {
      payouts.push({
        userId: child.key,
        email: user.paypalEmail,
        amount: user.earnings * 12, // $12 per coin
        earnings: user.earnings
      });
      
      // Reset earnings
      db.ref(`users/${child.key}`).update({
        earnings: 0,
        pendingEarnings: (user.pendingEarnings || 0) + (user.earnings * 12),
        lastPayout: Date.now()
      });
    }
  });
  
  // Log payouts for manual processing
  await db.ref(`payouts/${Date.now()}`).set({
    timestamp: Date.now(),
    count: payouts.length,
    total: payouts.reduce((sum, p) => sum + p.amount, 0),
    details: payouts
  });
  
  console.log(`Processed ${payouts.length} pending payouts`);
  return null;
});
