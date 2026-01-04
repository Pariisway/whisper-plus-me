// Cloud Functions for Whisper+me - PRODUCTION SAFE FIXED VERSION
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

admin.initializeApp();
const db = admin.database();

// ============ CONFIGURATION ============
const AGORA_APP_ID = functions.config().agora.app_id;
const AGORA_APP_CERT = functions.config().agora.certificate;
const ROOT_ADMIN_UID = functions.config().admin.root_uid;

// Token settings
const TOKEN_TTL = 60 * 10; // 10 minutes
const TOKEN_RATE_LIMIT_MS = 30 * 1000; // 30 seconds per call per user

// Abuse thresholds
const MAX_CANCELLATIONS_PER_HOUR = 3;
const MAX_SHORT_CALLS_PER_HOUR = 3;

// ============ HELPER FUNCTIONS ============

// Stable Agora UID from Firebase UID
function agoraUidFromFirebaseUid(uid) {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = ((hash << 5) - hash) + uid.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 4294967295;
}

// Check if user is admin
async function isAdmin(context) {
  if (!context.auth) return false;
  if (context.auth.uid === ROOT_ADMIN_UID) return true;
  
  try {
    const user = await admin.auth().getUser(context.auth.uid);
    return !!(user.customClaims && user.customClaims.admin);
  } catch (error) {
    return false;
  }
}

// Check abuse thresholds
async function checkAbuseThreshold(uid, type) {
  const now = Date.now();
  const hourAgo = now - 3600000;
  
  const ref = db.ref(`userMetrics/${uid}/${type}`);
  const snapshot = await ref.orderByChild('timestamp').startAt(hourAgo).once('value');
  
  const count = snapshot.numChildren();
  
  // Record this event
  await ref.push().set({ timestamp: now });
  
  return count >= (type === 'cancellation' ? MAX_CANCELLATIONS_PER_HOUR : MAX_SHORT_CALLS_PER_HOUR);
}

// ============ SCHEDULED WATCHDOGS ============

// Watchdog for expiring ringing calls
exports.expireCalls = functions.pubsub.schedule('every 1 minutes').onRun(async (context) => {
  try {
    const now = Date.now();
    const callsRef = db.ref('calls');
    
    const snapshot = await callsRef
      .orderByChild('status')
      .equalTo('ringing')
      .once('value');
    
    for (const callSnap of snapshot.forEach ? Array.from(snapshot) : []) {
      const call = callSnap.val();
      if (call.expiresAt && call.expiresAt < now) {
        await handleExpiredCall(callSnap.key, call);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error in expireCalls:', error);
    return null;
  }
});

// Watchdog for ending answered calls after 5 minutes
exports.endLongCalls = functions.pubsub.schedule('every 1 minutes').onRun(async (context) => {
  try {
    const now = Date.now();
    const callsRef = db.ref('calls');
    
    const snapshot = await callsRef
      .orderByChild('status')
      .equalTo('answered')
      .once('value');
    
    for (const callSnap of snapshot.forEach ? Array.from(snapshot) : []) {
      const call = callSnap.val();
      const callDuration = now - (call.answeredAt || call.createdAt);
      if (callDuration > 300000) { // 5 minutes
        await endCall(callSnap.key, call, 'auto_ended_duration');
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error in endLongCalls:', error);
    return null;
  }
});

// Reconciliation for stuck calls (runs hourly)
exports.reconcileStuckCalls = functions.pubsub.schedule('every 60 minutes').onRun(async (context) => {
  try {
    const now = Date.now();
    const maxCallAge = 24 * 60 * 60 * 1000; // 24 hours
    
    const callsRef = db.ref('calls');
    const snapshot = await callsRef.once('value');
    
    const stuckCalls = [];
    
    snapshot.forEach((callSnap) => {
      const call = callSnap.val();
      const callAge = now - call.createdAt;
      
      // Close any call older than 24 hours
      if (callAge > maxCallAge && !['ended', 'expired', 'cancelled', 'declined'].includes(call.status)) {
        stuckCalls.push({ callId: callSnap.key, call });
      }
    });
    
    for (const { callId, call } of stuckCalls) {
      await db.ref(`calls/${callId}`).update({
        status: 'auto_closed',
        endedAt: now,
        closeReason: 'stuck_call_reconciliation'
      });
      
      // Refund locked coins if any
      if (call.lockedCoins > 0) {
        const callerRef = db.ref(`users/${call.callerId}/coins`);
        await callerRef.transaction((coins) => (coins || 0) + call.lockedCoins);
        
        await db.ref(`coinTransactions/${Date.now()}`).set({
          userId: call.callerId,
          amount: call.lockedCoins,
          reason: 'Stuck call reconciliation - refund',
          callId,
          timestamp: now
        });
      }
    }
    
    console.log(`Reconciled ${stuckCalls.length} stuck calls`);
    return null;
  } catch (error) {
    console.error('Error in reconcileStuckCalls:', error);
    return null;
  }
});

// ============ CORE CALL FUNCTIONS ============

// Get Agora token - FIXED: Real tokens with rate limiting
exports.getAgoraToken = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }

  const { callId } = data;
  if (!callId) {
    throw new functions.https.HttpsError('invalid-argument', 'callId is required');
  }

  if (!AGORA_APP_CERT) {
    throw new functions.https.HttpsError('failed-precondition', 'Agora App Certificate not configured');
  }

  const uid = context.auth.uid;
  const now = Math.floor(Date.now() / 1000);

  // 🔒 Rate limit per user per call
  const rateLimitRef = db.ref(`agoraRateLimits/${uid}/${callId}`);
  const rateSnap = await rateLimitRef.once('value');
  
  if (rateSnap.exists()) {
    const lastIssued = rateSnap.val().lastIssuedAt;
    if (lastIssued && (Date.now() - lastIssued < TOKEN_RATE_LIMIT_MS)) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Too many token requests. Please wait.'
      );
    }
  }

  // 🔍 Load and validate call
  const callRef = db.ref(`calls/${callId}`);
  const callSnap = await callRef.once('value');
  const call = callSnap.val();

  if (!call) {
    throw new functions.https.HttpsError('not-found', 'Call not found');
  }

  // 👮 Authorization check
  if (call.callerId !== uid && call.whisperId !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'User is not part of this call');
  }

  // ⛔ Prevent tokens for dead calls
  if (call.endedAt || ['ended', 'expired'].includes(call.status)) {
    throw new functions.https.HttpsError('failed-precondition', 'Call has already ended');
  }

  // Allow rejoin if answered but not ended
  if (!['ringing', 'answered'].includes(call.status)) {
    throw new functions.https.HttpsError('failed-precondition', 'Call is not active');
  }

  // 📺 Channel locked to callId
  const channelName = `call_${callId}`;

  // ⏱️ Expiration
  const privilegeExpireTs = now + TOKEN_TTL;

  // 🔑 Generate stable Agora UID (ignore client-provided UID)
  const agoraUid = agoraUidFromFirebaseUid(uid);

  // 🔑 Build real token
  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERT,
    channelName,
    agoraUid,
    RtcRole.PUBLISHER,
    privilegeExpireTs
  );

  // 🧾 Update rate limit
  await rateLimitRef.set({
    lastIssuedAt: Date.now(),
    callId,
    expiresAt: privilegeExpireTs * 1000
  });

  // 📝 Audit trail
  await callRef.child('agoraTokens').push().set({
    issuedTo: uid,
    issuedAt: Date.now(),
    expiresAt: privilegeExpireTs * 1000,
    channel: channelName
  });

  return {
    token,
    appId: AGORA_APP_ID,
    channel: channelName,
    uid: agoraUid,
    expiresAt: privilegeExpireTs * 1000
  };
});

// Start a new call - FIXED: Crash-safe coin locking
exports.startCall = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  const { whisperId } = data;
  if (!whisperId) {
    throw new functions.https.HttpsError('invalid-argument', 'Whisper ID required');
  }

  const callerId = context.auth.uid;
  
  // 1. Check whisper availability FIRST (no coins involved yet)
  const whisperRef = db.ref(`users/${whisperId}`);
  const whisperSnap = await whisperRef.once('value');
  const whisperData = whisperSnap.val();

  if (!whisperData) {
    throw new functions.https.HttpsError('not-found', 'Whisper not found');
  }

  if (!whisperData.isAvailable) {
    throw new functions.https.HttpsError('failed-precondition', 'Whisper is not available');
  }

  // 2. Create call record FIRST
  const callRef = db.ref('calls').push();
  const callId = callRef.key;
  
  const callData = {
    callerId,
    callerName: context.auth.token.name || 'Anonymous',
    whisperId,
    whisperName: whisperData.displayName || 'Anonymous',
    coinsCharged: 1,
    status: 'ringing',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60000 // 60 seconds to answer
  };

  await callRef.set(callData);

  // 3. NOW lock coins with transaction tied to callId
  const callerRef = db.ref(`users/${callerId}`);
  const result = await callerRef.transaction((user) => {
    if (!user) return null;
    
    if ((user.coins || 0) < 1) {
      return user; // Not enough coins - transaction will abort
    }
    
    // Create lock tied to callId
    user.coins = (user.coins || 0) - 1;
    if (!user.lockedCalls) user.lockedCalls = {};
    user.lockedCalls[callId] = true;
    
    return user;
  });

  if (!result.committed) {
    // Clean up call record if coin lock failed
    await callRef.remove();
    throw new functions.https.HttpsError('failed-precondition', 'Insufficient coins');
  }

  // 4. Record transaction
  await db.ref(`coinTransactions/${Date.now()}`).set({
    userId: callerId,
    amount: -1,
    reason: `Call locked to ${whisperData.displayName || 'whisper'}`,
    callId,
    status: 'locked',
    timestamp: Date.now()
  });

  return { callId };
});

// Answer a call - FIXED: Atomic state with validation
exports.answerCall = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  const { callId } = data;
  if (!callId) {
    throw new functions.https.HttpsError('invalid-argument', 'Call ID required');
  }

  const callRef = db.ref(`calls/${callId}`);
  
  // Use transaction for atomic state transition with validation
  const result = await callRef.transaction((call) => {
    if (!call) return null;
    
    // Validate whisper
    if (call.whisperId !== context.auth.uid) return call;
    
    // Validate state
    if (call.status !== 'ringing') return call;
    
    // Update state
    call.status = 'answered';
    call.answeredAt = Date.now();
    
    return call;
  });

  if (!result.committed) {
    throw new functions.https.HttpsError('not-found', 'Call not found or validation failed');
  }

  const call = result.snapshot.val();
  if (!call || call.status !== 'answered') {
    throw new functions.https.HttpsError('failed-precondition', 'Unable to answer call');
  }

  // Now deduct the locked coins (callId lock exists)
  const callerRef = db.ref(`users/${call.callerId}`);
  await callerRef.transaction((user) => {
    if (!user) return null;
    
    // Check if lock exists for this call
    if (!user.lockedCalls || !user.lockedCalls[callId]) {
      return user; // No lock - abort
    }
    
    // Remove the lock (coins already deducted in startCall)
    delete user.lockedCalls[callId];
    return user;
  });

  // Record deduction
  await db.ref(`coinTransactions/${Date.now()}`).set({
    userId: call.callerId,
    amount: -1,
    reason: `Call answered by ${call.whisperName}`,
    callId,
    status: 'deducted',
    timestamp: Date.now()
  });

  return { success: true };
});

// Cancel a call - FIXED: Abuse-aware with proper validation
exports.cancelCall = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  const { callId } = data;
  if (!callId) {
    throw new functions.https.HttpsError('invalid-argument', 'Call ID required');
  }

  // Check abuse threshold
  const isAbusive = await checkAbuseThreshold(context.auth.uid, 'cancellation');
  if (isAbusive) {
    throw new functions.https.HttpsError('failed-precondition', 'Too many cancellations. Please wait.');
  }

  const callRef = db.ref(`calls/${callId}`);
  
  // Atomic state transition with validation
  const result = await callRef.transaction((call) => {
    if (!call) return null;
    
    // Validate caller
    if (call.callerId !== context.auth.uid) return call;
    
    // Validate state
    if (call.status !== 'ringing') return call;
    
    // Update state
    call.status = 'cancelled';
    call.endedAt = Date.now();
    call.cancelledBy = context.auth.uid;
    
    return call;
  });

  if (!result.committed) {
    throw new functions.https.HttpsError('not-found', 'Call not found or validation failed');
  }

  const call = result.snapshot.val();
  
  // Refund via lock removal
  const callerRef = db.ref(`users/${call.callerId}`);
  await callerRef.transaction((user) => {
    if (!user) return null;
    
    // Check if lock exists
    if (!user.lockedCalls || !user.lockedCalls[callId]) {
      return user;
    }
    
    // Refund coin and remove lock
    user.coins = (user.coins || 0) + 1;
    delete user.lockedCalls[callId];
    return user;
  });

  // Record refund
  await db.ref(`coinTransactions/${Date.now()}`).set({
    userId: call.callerId,
    amount: 1,
    reason: 'Call cancelled - refund',
    callId,
    timestamp: Date.now()
  });

  return { success: true, refunded: true };
});

// Decline a call - FIXED: Proper validation
exports.declineCall = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  const { callId } = data;
  if (!callId) {
    throw new functions.https.HttpsError('invalid-argument', 'Call ID required');
  }

  const callRef = db.ref(`calls/${callId}`);
  
  // Atomic state transition
  const result = await callRef.transaction((call) => {
    if (!call) return null;
    if (call.whisperId !== context.auth.uid) return call;
    if (call.status !== 'ringing') return call;
    
    call.status = 'declined';
    call.endedAt = Date.now();
    call.declinedBy = context.auth.uid;
    return call;
  });

  if (!result.committed) {
    throw new functions.https.HttpsError('not-found', 'Call not found');
  }

  const call = result.snapshot.val();
  
  // Refund via lock removal
  const callerRef = db.ref(`users/${call.callerId}`);
  await callerRef.transaction((user) => {
    if (!user) return null;
    
    if (!user.lockedCalls || !user.lockedCalls[callId]) {
      return user;
    }
    
    user.coins = (user.coins || 0) + 1;
    delete user.lockedCalls[callId];
    return user;
  });

  // Record refund
  await db.ref(`coinTransactions/${Date.now()}`).set({
    userId: call.callerId,
    amount: 1,
    reason: 'Call declined - refund',
    callId,
    timestamp: Date.now()
  });

  return { success: true, refunded: true };
});

// Submit review - FIXED: Append-only with validation
exports.submitReview = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  const { callId, rating, comment, reportIssue } = data;
  if (!callId || !rating) {
    throw new functions.https.HttpsError('invalid-argument', 'Call ID and rating required');
  }

  const callSnap = await db.ref(`calls/${callId}`).once('value');
  const call = callSnap.val();

  if (!call) {
    throw new functions.https.HttpsError('not-found', 'Call not found');
  }

  if (call.callerId !== context.auth.uid && call.whisperId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You were not part of this call');
  }

  const isCaller = call.callerId === context.auth.uid;
  const targetUserId = isCaller ? call.whisperId : call.callerId;

  // Update rating transactionally
  const targetUserRef = db.ref(`users/${targetUserId}`);
  await targetUserRef.transaction((user) => {
    if (!user) return null;
    
    const currentRating = user.rating || 5.0;
    const totalReviews = user.totalReviews || 0;
    const newTotalReviews = totalReviews + 1;
    const newRating = ((currentRating * totalReviews) + rating) / newTotalReviews;
    
    user.rating = parseFloat(newRating.toFixed(2));
    user.totalReviews = newTotalReviews;
    return user;
  });

  // Save review (append-only)
  const reviewRef = db.ref('reviews').push();
  await reviewRef.set({
    callId,
    reviewerId: context.auth.uid,
    targetUserId,
    rating,
    comment: comment || null,
    isCallerReviewingWhisper: isCaller,
    reportedIssue: reportIssue || false,
    createdAt: Date.now()
  });

  // Create dispute if issue reported
  if (reportIssue) {
    const disputeRef = db.ref('callDisputes').push();
    await disputeRef.set({
      callId,
      callerId: call.callerId,
      whisperId: call.whisperId,
      reporterId: context.auth.uid,
      reason: 'User reported issue',
      message: comment || 'No additional details',
      status: 'open',
      createdAt: Date.now()
    });
  }

  return { success: true };
});

// Buy coins - DISABLED for production (admin-only for now)
exports.buyCoins = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  // Only admin can add coins directly
  if (!(await isAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Coin purchases disabled. Use admin panel.');
  }

  const { userId, amount } = data;
  if (!userId || !amount || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'User ID and valid amount required');
  }

  const userRef = db.ref(`users/${userId}`);
  await userRef.child('coins').transaction((coins) => (coins || 0) + amount);

  // Record admin action
  await db.ref(`adminActions/${Date.now()}`).set({
    action: 'add_coins',
    adminId: context.auth.uid,
    targetUserId: userId,
    amount: amount,
    timestamp: Date.now()
  });

  return { success: true, coinsAdded: amount };
});

// ============ ADMIN FUNCTIONS ============

// Admin-only: Add coins to user
exports.adminAddCoins = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  if (!(await isAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { userId, amount, reason } = data;
  if (!userId || !amount || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'User ID and valid amount required');
  }

  const userRef = db.ref(`users/${userId}`);
  await userRef.child('coins').transaction((coins) => (coins || 0) + amount);

  // Record transaction
  await db.ref(`coinTransactions/${Date.now()}`).set({
    userId: userId,
    amount: amount,
    reason: reason || 'Admin adjustment',
    adminId: context.auth.uid,
    timestamp: Date.now(),
    type: 'admin_adjustment'
  });

  // Record admin action
  await db.ref(`adminActions/${Date.now()}`).set({
    action: 'add_coins',
    adminId: context.auth.uid,
    targetUserId: userId,
    amount: amount,
    reason: reason,
    timestamp: Date.now()
  });

  return { success: true };
});

// Admin-only: Force end call
exports.adminForceEndCall = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  if (!(await isAdmin(context))) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { callId, reason } = data;
  if (!callId) {
    throw new functions.https.HttpsError('invalid-argument', 'Call ID required');
  }

  const callRef = db.ref(`calls/${callId}`);
  const callSnap = await callRef.once('value');
  const call = callSnap.val();

  if (!call) {
    throw new functions.https.HttpsError('not-found', 'Call not found');
  }

  // Update call status
  await callRef.update({
    status: 'force_ended',
    endedAt: Date.now(),
    forceEndedBy: context.auth.uid,
    forceEndReason: reason || 'Admin action'
  });

  // Refund if call was active/ringing
  if (call.status === 'ringing' || call.status === 'answered') {
    const callerRef = db.ref(`users/${call.callerId}`);
    await callerRef.transaction((user) => {
      if (!user) return null;
      
      // Check for lock
      if (user.lockedCalls && user.lockedCalls[callId]) {
        user.coins = (user.coins || 0) + 1;
        delete user.lockedCalls[callId];
      }
      return user;
    });

    // Record refund
    await db.ref(`coinTransactions/${Date.now()}`).set({
      userId: call.callerId,
      amount: 1,
      reason: 'Call force ended by admin - refund',
      callId,
      adminId: context.auth.uid,
      timestamp: Date.now()
    });
  }

  // Record admin action
  await db.ref(`adminActions/${Date.now()}`).set({
    action: 'force_end_call',
    adminId: context.auth.uid,
    callId,
    reason: reason || 'Admin action',
    timestamp: Date.now()
  });

  return { success: true };
});

// ============ INTERNAL HELPER FUNCTIONS ============

async function handleExpiredCall(callId, call) {
  const callRef = db.ref(`calls/${callId}`);
  
  // Atomic state transition
  const result = await callRef.transaction((currentCall) => {
    if (!currentCall) return null;
    if (currentCall.status !== 'ringing') return currentCall;
    
    currentCall.status = 'expired';
    currentCall.endedAt = Date.now();
    currentCall.expiredReason = 'auto_expired';
    return currentCall;
  });

  if (!result.committed || !result.snapshot.val()) {
    return;
  }

  // Refund via lock removal
  const callerRef = db.ref(`users/${call.callerId}`);
  await callerRef.transaction((user) => {
    if (!user) return null;
    
    if (!user.lockedCalls || !user.lockedCalls[callId]) {
      return user;
    }
    
    user.coins = (user.coins || 0) + 1;
    delete user.lockedCalls[callId];
    return user;
  });

  // Record refund
  await db.ref(`coinTransactions/${Date.now()}`).set({
    userId: call.callerId,
    amount: 1,
    reason: 'Call expired - automatic refund',
    callId,
    timestamp: Date.now()
  });
}

async function endCall(callId, call, reason = 'normal_end') {
  const callRef = db.ref(`calls/${callId}`);
  
  // Atomic state transition
  const result = await callRef.transaction((currentCall) => {
    if (!currentCall) return null;
    if (currentCall.status !== 'answered') return currentCall;
    
    currentCall.status = 'ended';
    currentCall.endedAt = Date.now();
    currentCall.endReason = reason;
    
    // Calculate duration
    const startTime = currentCall.answeredAt || currentCall.createdAt;
    currentCall.duration = Math.floor((Date.now() - startTime) / 1000);
    
    return currentCall;
  });

  if (!result.committed || !result.snapshot.val()) {
    return;
  }

  const endedCall = result.snapshot.val();
  
  // Check for short call abuse
  if (endedCall.duration && endedCall.duration < 30) {
    const isCallerAbusive = await checkAbuseThreshold(call.callerId, 'short_call');
    const isWhisperAbusive = await checkAbuseThreshold(call.whisperId, 'short_call');
    
    if (isCallerAbusive || isWhisperAbusive) {
      await db.ref(`abuseFlags/${Date.now()}`).set({
        callId,
        callerId: call.callerId,
        whisperId: call.whisperId,
        reason: 'Excessive short calls',
        duration: endedCall.duration,
        timestamp: Date.now()
      });
    }
  }
  
  // Process whisper earnings (coins already deducted, now credit whisper)
  const whisperRef = db.ref(`users/${call.whisperId}`);
  await whisperRef.transaction((whisper) => {
    if (!whisper) return null;
    
    const coinsEarned = call.coinsCharged || 1;
    
    whisper.earnings = (whisper.earnings || 0) + (coinsEarned * 12);
    whisper.callsCompleted = (whisper.callsCompleted || 0) + 1;
    whisper.coins = (whisper.coins || 0) + coinsEarned;
    
    return whisper;
  });

  // Create payout record
  await db.ref(`payouts/${Date.now()}`).set({
    userId: call.whisperId,
    amount: (call.coinsCharged || 1) * 12,
    callId,
    status: 'pending',
    createdAt: Date.now()
  });

  // Record earnings transaction
  await db.ref(`coinTransactions/${Date.now()}`).set({
    userId: call.whisperId,
    amount: call.coinsCharged || 1,
    reason: `Call with ${call.callerName}`,
    callId,
    timestamp: Date.now(),
    type: 'earnings'
  });

  // Update caller's call count
  const callerRef = db.ref(`users/${call.callerId}`);
  await callerRef.transaction((caller) => {
    if (!caller) return null;
    caller.callsCompleted = (caller.callsCompleted || 0) + 1;
    return caller;
  });
}
