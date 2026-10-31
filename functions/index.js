// v7 - domain fix + admin bypass
"use strict";

/* ═══════════════════════════════════════════════════════════════
   WHISPERPLUSME — Cloud Functions (functions/index.js)
   firebase-functions v7 — uses params module (NOT functions.config())
═══════════════════════════════════════════════════════════════ */

const { onRequest }          = require("firebase-functions/v2/https");
const { onSchedule }         = require("firebase-functions/v2/scheduler");
const { onValueCreated }     = require("firebase-functions/v2/database");
const { defineSecret }       = require("firebase-functions/params");
const admin                  = require("firebase-admin");

admin.initializeApp({ databaseURL: "https://whisperplusme-46d9c-default-rtdb.firebaseio.com" });
const db = admin.database();

/* ── Secrets — stored in Google Secret Manager ─────────────────
   Set each one once via CLI:
   firebase functions:secrets:set STRIPE_SECRET_KEY
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   firebase functions:secrets:set STRIPE_PRICE_ID
   firebase functions:secrets:set AGORA_APP_CERTIFICATE
   (AGORA_APP_ID and APP_URL are non-secret, set as plain env below)
──────────────────────────────────────────────────────────────── */
const STRIPE_SECRET_KEY     = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const STRIPE_PRICE_ID       = defineSecret("STRIPE_PRICE_ID");
const AGORA_APP_CERTIFICATE = defineSecret("AGORA_APP_CERTIFICATE");
const GMAIL_PASS            = defineSecret("GMAIL_APP_PASSWORD");

/* ── Non-secret constants (safe to be in code) ── */
const AGORA_APP_ID  = "605c4549677d4f91b07bfb36df7cd30c";
/* Use custom domain so Stripe/Firebase redirects land logged-in.
   The .web.app URL loses auth state because it's a different origin. */
const APP_URL = "https://whisperplusme.com";
const CREATOR_PAYOUT_USD = 2.00; /* creator gets exactly $2 per coin */
const PLATFORM_USD    = 1.00; /* site keeps exactly $1 per coin */

/* ── CORS helper ── */
function setCors(res) {
  res.set("Access-Control-Allow-Origin",  "*");
  res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* ── Auth helper ── */
async function verifyToken(req) {
  const auth = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (!auth) throw new Error("No auth token");
  return admin.auth().verifyIdToken(auth);
}

/* ═══════════════════════════════════════════════════════════════
   1. generateAgoraToken
   GET /generateAgoraToken?channel=CHANNEL&uid=0
═══════════════════════════════════════════════════════════════ */
exports.generateAgoraToken = onRequest(
  { secrets: [AGORA_APP_CERTIFICATE], cors: true },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    /* FIX: Require auth — anyone with the function URL could generate tokens for any channel */
    let caller;
    try {
      caller = await verifyToken(req);
    } catch (e) {
      return res.status(401).json({ error: "Authentication required" });
    }

    /* FIX: Rate limit — max 30 token requests per hour per user */
    const hourAgo    = Date.now() - 3600000;
    const tokenLogSnap = await db.ref("agoraTokenLog/" + caller.uid)
      .orderByChild("ts").startAt(hourAgo).once("value");
    let tokenCount = 0;
    tokenLogSnap.forEach(() => { tokenCount++; });
    if (tokenCount >= 30)
      return res.status(429).json({ error: "Too many token requests — try again later" });

    /* Log this request for rate limiting */
    await db.ref("agoraTokenLog/" + caller.uid + "/" + Date.now()).set({ ts: Date.now() });

    const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
    const channel = req.query.channel || "";
    const uid     = parseInt(req.query.uid) || 0;

    if (!channel) { res.status(400).json({ error: "channel required" }); return; }

    /* Paid 1-on-1 calls use the call's ID as the channel (it starts with "-").
       Their voice pass comes only from callToken (nights), which checks the
       person is on the call and makes it run out after 3 minutes. */
    if (channel.startsWith("-")) {
      return res.status(403).json({ error: "Calls get their voice pass from callToken" });
    }

    /* Member-only room mic gate — enforced here (not just hidden client-side)
       since this is the actual point where mic access is granted. Default
       is member-only (true) for any room that's never been explicitly
       toggled, matching the safer behavior this app already had before
       this flag existed. */
    if (channel.startsWith("livemic_")) {
      const roomId = channel.slice("livemic_".length);
      const isAnon = caller.firebase && caller.firebase.sign_in_provider === "anonymous";
      if (isAnon) {
        const moSnap = await db.ref("roomMemberOnly/" + roomId).once("value");
        const memberOnly = moSnap.exists() ? moSnap.val() : true;
        if (memberOnly) {
          return res.status(403).json({ error: "Sign up required to use the mic in this room" });
        }
      }
    }

    try {
      const expiry = Math.floor(Date.now() / 1000) + 90 * 60;
      const token  = RtcTokenBuilder.buildTokenWithUid(
        AGORA_APP_ID,
        AGORA_APP_CERTIFICATE.value(),
        channel, uid, RtcRole.PUBLISHER, expiry
      );
      res.json({ token });
    } catch (e) {
      console.error("generateAgoraToken error", e);
      res.status(500).json({ error: "token generation failed" });
    }
  }
);

/* ═══════════════════════════════════════════════════════════════
   2. startCall
   POST /startCall  { targetUid }
═══════════════════════════════════════════════════════════════ */
exports.startCall = onRequest({ cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST")   { res.status(405).json({ error: "POST only" }); return; }

  try {
    const caller    = await verifyToken(req);
    const callerUid = caller.uid;
    const { targetUid } = req.body;

    if (!targetUid || targetUid === callerUid)
      return res.status(400).json({ error: "Invalid target" });

    /* rate limit: max 10 calls per hour per caller to prevent abuse */
    const hourAgo    = Date.now() - 3600000;
    const recentSnap = await db.ref("calls")
      .orderByChild("from").equalTo(callerUid).once("value");
    let recentCount  = 0;
    recentSnap.forEach(s => {
      const c = s.val();
      if (c && c.createdAt > hourAgo) recentCount++;
    });
    if (recentCount >= 10)
      return res.status(429).json({ error: "Too many calls. Try again later." });

    const [callerSnap, targetSnap] = await Promise.all([
      db.ref("users/" + callerUid).once("value"),
      db.ref("users/" + targetUid).once("value")
    ]);

    const callerData  = callerSnap.val() || {};
    const targetData  = targetSnap.val() || {};
    const price       = Number(targetData.price  || 1);
    const callerCoins = Number(callerData.coins   || 0);
    const isAdmin     = callerUid === "v6aIXY12MDY9ci1wWJmCiLOAKoG2";

    /* Admin account calls for free — used for moderation and member support */
    if (!isAdmin && callerCoins < price)
      return res.status(402).json({
        error: `Not enough coins. Need ${price}, have ${callerCoins}.`
      });

    const callRef = db.ref("calls").push();
    const callId  = callRef.key;
    await callRef.set({
      from:        callerUid,
      to:          targetUid,
      callerName:  callerData.name  || "Caller",
      callerPhoto: callerData.photo || "",
      price,
      status:      "ringing",
      createdAt:   Date.now()
    });

    res.json({ callId });
  } catch (e) {
    console.error("startCall error", e);
    res.status(500).json({ error: e.message || "startCall failed" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   3. acceptCallBilling
   POST /acceptCallBilling  { callId }
═══════════════════════════════════════════════════════════════ */
exports.acceptCallBilling = onRequest({ cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  try {
    const receiver    = await verifyToken(req);
    const { callId }  = req.body;
    if (!callId) return res.status(400).json({ error: "callId required" });

    const callSnap = await db.ref("calls/" + callId).once("value");
    const call     = callSnap.val();
    if (!call)                     return res.status(404).json({ error: "Call not found" });
    if (call.to !== receiver.uid)  return res.status(403).json({ error: "Not your call" });
    if (call.status !== "ringing") return res.status(409).json({ error: "Call no longer ringing" });

    const callerCoinsSnap = await db.ref("users/" + call.from + "/coins").once("value");
    const coins = Number(callerCoinsSnap.val() || 0);
    if (coins < call.price)
      return res.status(402).json({ error: "Caller no longer has enough coins" });

    res.json({ ok: true });
  } catch (e) {
    console.error("acceptCallBilling error", e);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   4. completeCallPayout
   POST /completeCallPayout  { callId }
═══════════════════════════════════════════════════════════════ */
exports.completeCallPayout = onRequest({ cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  try {
    await verifyToken(req);
    const { callId } = req.body;
    if (!callId) return res.status(400).json({ error: "callId required" });

    /* idempotency */
    const ledgerSnap = await db.ref("callLedger/" + callId).once("value");
    if (ledgerSnap.exists()) return res.json({ ok: true, skipped: true });

    const callSnap = await db.ref("calls/" + callId).once("value");
    const call     = callSnap.val();
    if (!call) return res.status(404).json({ error: "Call not found" });

    if (!call.answeredAt) {
      await db.ref("callLedger/" + callId).set({
        charged: false, reason: "never_answered", ts: Date.now()
      });
      return res.json({ ok: true, charged: false });
    }

    const price = Number(call.price || 1);

    /* atomic coin deduction — admin caller is free */
    const isAdminCaller = call.from === "v6aIXY12MDY9ci1wWJmCiLOAKoG2";
    let deductResult = { committed: true };
    if (!isAdminCaller) {
      deductResult = await db.ref("users/" + call.from).transaction(data => {
        if (!data) return; /* abort — do NOT return null, that WRITES null and deletes the node */
        const current = Number(data.coins || 0);
        if (current < price) return; /* abort */
        data.coins = current - price;
        data.calls = (data.calls || 0) + 1;
        return data;
      });
    } else {
      /* still increment call count for admin */
      await db.ref("users/" + call.from + "/calls").transaction(n => (n||0) + 1);
    }

    if (!deductResult.committed) {
      await db.ref("callLedger/" + callId).set({
        charged: false, reason: "insufficient_coins", ts: Date.now()
      });
      return res.json({ ok: true, charged: false });
    }

    /* credit receiver — exactly $2 per coin, site keeps $1 per coin */
    const earnedUsd   = Number((price * CREATOR_PAYOUT_USD).toFixed(2));
    const platformUsd = Number((price * PLATFORM_USD).toFixed(2));

    await db.ref("users/" + call.to).transaction(data => {
      if (!data) return; /* abort — do NOT return null, that WRITES null and deletes the node */
      data.earnings = Number(((data.earnings || 0) + earnedUsd).toFixed(2));
      data.calls    = (data.calls || 0) + 1;
      return data;
    });

    await db.ref("siteRevenue").transaction(data => {
      if (!data) return { total: platformUsd };
      data.total = Number(((data.total || 0) + platformUsd).toFixed(2));
      return data;
    });

    await db.ref("callLedger/" + callId).set({
      from: call.from, to: call.to,
      price, earnedUsd, platformUsd,
      charged: true, ts: Date.now()
    });

    res.json({ ok: true, charged: true, earnedUsd });
  } catch (e) {
    console.error("completeCallPayout error", e);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   5. createCoinCheckout
   POST /createCoinCheckout  { qty }
═══════════════════════════════════════════════════════════════ */
exports.createCoinCheckout = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_PRICE_ID], cors: true },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    try {
      const user   = await verifyToken(req);
      const qty    = Math.max(1, Math.min(500, parseInt(req.body.qty) || 1));

      /* FIX: Rate limit — max 5 checkout attempts per hour to prevent abuse */
      const hourAgo       = Date.now() - 3600000;
      const checkoutSnap  = await db.ref("checkoutLog/" + user.uid)
        .orderByChild("ts").startAt(hourAgo).once("value");
      let checkoutCount = 0;
      checkoutSnap.forEach(() => { checkoutCount++; });
      if (checkoutCount >= 5)
        return res.status(429).json({ error: "Too many checkout attempts — please wait before trying again." });

      /* Log this checkout attempt */
      await db.ref("checkoutLog/" + user.uid + "/" + Date.now()).set({ ts: Date.now(), qty });

      const stripe = require("stripe")(STRIPE_SECRET_KEY.value());

      const session = await stripe.checkout.sessions.create({
        mode:                 "payment",
        payment_method_types: ["card"],
        line_items: [{
          price:    STRIPE_PRICE_ID.value(),
          quantity: qty
        }],
        success_url: APP_URL + "/?coins_success=1&session_id={CHECKOUT_SESSION_ID}",
        cancel_url:  APP_URL + "/?coins_cancel=1",
        metadata: { uid: user.uid, qty: String(qty), product: "coins" },
        client_reference_id: user.uid
      });

      res.json({ url: session.url });
    } catch (e) {
      console.error("createCoinCheckout error", e);
      res.status(500).json({ error: e.message });
    }
  }
);

/* ═══════════════════════════════════════════════════════════════
   6. stripeWebhook
   POST /stripeWebhook  (Stripe → server, NOT called by client)
═══════════════════════════════════════════════════════════════ */
exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], rawBody: true },
  async (req, res) => {
    const stripe = require("stripe")(STRIPE_SECRET_KEY.value());
    const sig    = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody, sig, STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (e) {
      console.error("Webhook sig failed", e.message);
      return res.status(400).send("Webhook Error: " + e.message);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid     = session.metadata && session.metadata.uid;
      const qty     = parseInt((session.metadata && session.metadata.qty) || "0");

      /* FIX: Only credit if payment actually succeeded — don't credit unpaid sessions */
      if (session.payment_status !== "paid") {
        console.log("Session not paid, skipping credit:", session.id, session.payment_status);
        return res.json({ received: true });
      }

      /* FIX: Idempotency — don't double-credit if webhook fires twice */
      const alreadyCredited = await db.ref("coinPurchases/sessions/" + session.id).once("value");
      if (alreadyCredited.exists()) {
        console.log("Already credited session:", session.id);
        return res.json({ received: true, duplicate: true });
      }

      if (uid && qty > 0) {
        try {
          /* FIX: was using .transaction() but never checked whether it
             actually committed — a spurious abort here would mean a
             customer pays via Stripe and silently gets zero coins with no
             error anywhere. This path is already protected against
             double-processing by the session.id idempotency check above,
             so transaction-level atomicity isn't needed; a plain
             read-then-write is simpler and doesn't have the same failure
             mode. */
          const userSnapForCredit = await db.ref("users/" + uid).once("value");
          if (!userSnapForCredit.exists()) {
            console.error("Stripe payment succeeded but user no longer exists:", uid, "session:", session.id);
          } else {
            const currentCoins = Number(userSnapForCredit.val().coins || 0);
            await db.ref("users/" + uid).update({ coins: currentCoins + qty });
          }
          /* Use session ID as key for idempotency */
          await db.ref("coinPurchases/sessions/" + session.id).set({
            uid, qty, amountUsd: qty * 3, sessionId: session.id, ts: Date.now()
          });
          /* Also log under user for purchase history */
          await db.ref("coinPurchases/byUser/" + uid + "/" + Date.now()).set({
            qty, amountUsd: qty * 3, sessionId: session.id, ts: Date.now()
          });
          /* FIX: nothing anywhere tracked actual money collected via
             Stripe — the admin dashboard's only revenue figure was
             siteRevenue, which only grows once a coin gets SPENT, so a
             purchase alone (before spending anything) looked like zero
             activity to the admin despite real cash having come in. */
          await db.ref("stripeGrossRevenue").transaction(data => (Number(data) || 0) + (qty * 3));
          console.log("Credited", qty, "coins to", uid);
          try {
            const userSnap = await db.ref("users/" + uid).once("value");
            const userData = userSnap.val() || {};
            const nodemailer = require("nodemailer");
            const transporter = nodemailer.createTransport({
              service: "gmail",
              auth: { user: "whisper.me.support@gmail.com", pass: GMAIL_PASS.value() }
            });
            await transporter.sendMail({
              from: "whisper.me.support@gmail.com",
              to:   "whisper.me.support@gmail.com",
              subject: "💰 New Coin Purchase — Whisper+Me",
              html: "<h2>New coin purchase!</h2><p><b>User:</b> " + (userData.name||"Unknown") + "</p><p><b>Email:</b> " + (userData.email||uid) + "</p><p><b>Coins:</b> " + qty + "</p><p><b>Amount:</b> $" + (qty*3).toFixed(2) + "</p><p><b>Time:</b> " + new Date().toLocaleString() + "</p><p><a href='https://whisperplusme.com/admin.html'>View Admin Dashboard</a></p>"
            });
          } catch(emailErr){ console.warn("Purchase email failed:", emailErr.message); }
        } catch (e) {
          console.error("Coin credit failed", e);
          return res.status(500).send("Coin credit failed");
        }
      }
    }

    res.json({ received: true });
  }
);

/* ═══════════════════════════════════════════════════════════════
   7. createStripeConnectLink
   POST /createStripeConnectLink
═══════════════════════════════════════════════════════════════ */
exports.createStripeConnectLink = onRequest(
  { secrets: [STRIPE_SECRET_KEY], cors: true },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    try {
      const user   = await verifyToken(req);
      const stripe = require("stripe")(STRIPE_SECRET_KEY.value());

      const userSnap  = await db.ref("users/" + user.uid).once("value");
      const userData  = userSnap.val() || {};
      let   accountId = userData.stripeAccountId;

      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express", metadata: { uid: user.uid }
        });
        accountId = account.id;
        await db.ref("users/" + user.uid + "/stripeAccountId").set(accountId);
      }

      const link = await stripe.accountLinks.create({
        account:     accountId,
        refresh_url: APP_URL + "/?stripe_refresh=1",
        return_url:  APP_URL + "/?stripe_connected=1",
        type:        "account_onboarding"
      });

      res.json({ url: link.url });
    } catch (e) {
      console.error("createStripeConnectLink error", e);
      res.status(500).json({ error: e.message });
    }
  }
);

/* ═══════════════════════════════════════════════════════════════
   8. stripeDashboardLink
   POST /stripeDashboardLink
═══════════════════════════════════════════════════════════════ */
exports.stripeDashboardLink = onRequest(
  { secrets: [STRIPE_SECRET_KEY], cors: true },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    try {
      const user      = await verifyToken(req);
      const snap      = await db.ref("users/" + user.uid + "/stripeAccountId").once("value");
      const accountId = snap.val();
      if (!accountId) return res.status(404).json({ error: "No Stripe account connected" });

      const stripe = require("stripe")(STRIPE_SECRET_KEY.value());
      let url;
      try {
        /* createLoginLink works for Express accounts — try it first */
        const loginLink = await stripe.accounts.createLoginLink(accountId);
        url = loginLink.url;
      } catch (linkErr) {
        /* If login link fails (Standard account), return a fresh onboarding link
           so the user can at least access their Stripe dashboard */
        console.warn("createLoginLink failed:", linkErr.message);
        try {
          const acctLink = await stripe.accountLinks.create({
            account:     accountId,
            refresh_url: APP_URL + "/?stripe_refresh=1",
            return_url:  APP_URL + "/?stripe_connected=1",
            type:        "account_onboarding"
          });
          url = acctLink.url;
        } catch (e2) {
          /* Absolute fallback — send to Stripe dashboard directly */
          url = "https://dashboard.stripe.com/";
        }
      }
      res.json({ url });
    } catch (e) {
      console.error("stripeDashboardLink error", e);
      res.status(500).json({ error: e.message });
    }
  }
);

/* ═══════════════════════════════════════════════════════════════
   9. liveMicCharge  — HTTPS (avoids Eventarc permission issues)
   POST /liveMicCharge  { room }
   Called by the client when user taps "Go Live Now".
   Server-side atomically deducts 1 coin before allowing live mic.
═══════════════════════════════════════════════════════════════ */
exports.liveMicCharge = onRequest({ cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST")   { res.status(405).json({ error: "POST only" }); return; }

  try {
    const user = await verifyToken(req);
    const uid  = user.uid;

    const room = (req.body.room || "general").replace(/[^a-z0-9_]/gi, "");
    if (!room) return res.status(400).json({ error: "room required" });

    /* Guests (anonymous auth) can go live too, unless this specific room
       is set to Member Only in the admin dashboard. Defaults to Member
       Only (true) for any room never explicitly toggled, matching
       generateAgoraToken's default. */
    if (user.firebase && user.firebase.sign_in_provider === "anonymous") {
      const moSnap = await db.ref("roomMemberOnly/" + room).once("value");
      const memberOnly = moSnap.exists() ? moSnap.val() : true;
      if (memberOnly) {
        return res.status(403).json({ error: "Create a free account to go live in this room" });
      }
    }

    /* No daily cap — members pay 1 coin per session, unlimited goes */
    /* check room isn't full (max 5 live mics) */
    const roomSnap = await db.ref("liveMics/" + room).once("value");
    const nowTs = Date.now();
    let activeCount = 0;
    roomSnap.forEach(c => { if (c.val() && c.val().active && c.val().endTs > nowTs) activeCount++; });
    if (activeCount >= 5)
      return res.status(429).json({ error: "Room full — max 5 live mics" });

    /* atomic coin deduction — admin goes free */
    const COST = 0; /* Live mic is free */
    const isMicAdmin = uid === "v6aIXY12MDY9ci1wWJmCiLOAKoG2";
    let result = { committed: true };
    if (false) {
      result = await db.ref("users/" + uid).transaction(data => {
        if (!data) return; /* abort — do NOT return null, that WRITES null and deletes the node */
        const current = Number(data.coins || 0);
        /* Live mic is free — no deduction */
        /* if (current < COST) return; */
        return data;
      });
    }

    /* Free — no coin check needed */

    /* write the live mic entry now that coin is confirmed */
    const endTs    = Date.now() + 3 * 60 * 1000;
    const userSnap = await db.ref("users/" + uid + "/name").once("value");
    const now      = Date.now();
    await Promise.all([
      db.ref("liveMics/" + room + "/" + uid).set({
        uid,
        name:    userSnap.val() || "Member",
        active:  true,
        endTs,
        startTs: now,
        room
      }),
      /* log session for rate limiting */
      db.ref("liveMicLog/" + uid + "/" + now).set({ ts: now, room })
    ]);

    res.json({ ok: true, endTs });

  } catch (e) {
    console.error("liveMicCharge error", e);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   10. cleanupExpiredLiveMics — every 5 minutes
═══════════════════════════════════════════════════════════════ */
exports.cleanupExpiredLiveMics = onSchedule(
  { schedule: "every 5 minutes", region: "us-central1" },
  async () => {
    const snap    = await db.ref("liveMics").once("value");
    const now     = Date.now();
    const updates = {};

    snap.forEach(roomSnap => {
      roomSnap.forEach(micSnap => {
        const mic = micSnap.val();
        if (mic && mic.endTs && mic.endTs < now)
          updates["liveMics/" + roomSnap.key + "/" + micSnap.key] = null;
      });
    });

    if (Object.keys(updates).length) {
      await db.ref().update(updates);
      console.log("Removed", Object.keys(updates).length, "expired live mics");
    }
    return null;
  }
);

/* ═══════════════════════════════════════════════════════════════
   11. cleanupOldChatMessages — every 60 minutes
═══════════════════════════════════════════════════════════════ */
exports.cleanupOldChatMessages = onSchedule(
  { schedule: "every 60 minutes", region: "us-central1" },
  async () => {
    const ROOMS = [
      "general","spicy","bbw","onlyfans","hotdates",
      "payforit_m","payforit_f","freaky","sugar",
      "fetish","girlpower","lgbtqia"
    ];
    const MAX     = 80;
    const updates = {};

    for (const room of ROOMS) {
      const snap = await db.ref("chat/" + room).orderByChild("ts").once("value");
      const keys = [];
      snap.forEach(c => keys.push(c.key));
      if (keys.length > MAX)
        keys.slice(0, keys.length - MAX).forEach(k => {
          updates["chat/" + room + "/" + k] = null;
        });
    }

    if (Object.keys(updates).length) {
      await db.ref().update(updates);
      console.log("Pruned", Object.keys(updates).length, "old chat messages");
    }
    return null;
  }
);

/* ═══════════════════════════════════════════════════════════════
   12. joinMemberRoom  — HTTPS  (atomic, server-side, idempotent)
   POST /joinMemberRoom  { roomId }
   Called by client when member taps "Enter Room".
   Server-side atomically:
     1. Validates room exists, open, not full
     2. Checks / enforces 4-minute re-entry cooldown per user per room
     3. Deducts coins from joiner
     4. Writes session record
     5. Increments occupant count
     6. Credits coins + earnings to owner
   Returns { ok, endTs } on success.
═══════════════════════════════════════════════════════════════ */
exports.joinMemberRoom = onRequest({ cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST")   { res.status(405).json({ error: "POST only" }); return; }

  try {
    const member   = await verifyToken(req);
    const memberUid = member.uid;
    const { roomId } = req.body;

    if (!roomId) return res.status(400).json({ error: "roomId required" });

    /* ── 1. Fetch room ── */
    const roomSnap = await db.ref("memberRooms/" + roomId).once("value");
    const room     = roomSnap.val();
    if (!room)          return res.status(404).json({ error: "Room not found" });
    if (room.closing)   return res.status(409).json({ error: "Room is closing" });
    if (room.ownerId === memberUid)
                        return res.status(400).json({ error: "You own this room" });

    const cost = Number(room.cost || 1);

    /* ── 2. Check occupancy ── */
    const occupants = Number(room.occupants || 0);
    if (occupants >= 10) return res.status(409).json({ error: "Room is full" });

    /* ── 3. Idempotency: active session check ── */
    const sessSnap = await db.ref("memberRoomSessions/" + roomId + "/" + memberUid).once("value");
    const sess     = sessSnap.val();
    if (sess && sess.endTs > Date.now()) {
      /* Already in — return existing session, no charge */
      return res.json({ ok: true, endTs: sess.endTs, alreadyIn: true });
    }

    /* ── 4. Rate limit: 4-minute window from join time (3-min call + 1-min cooldown) ── */
    const cooldownSnap = await db.ref("memberRoomCooldown/" + memberUid + "/" + roomId).once("value");
    const lastCharge   = Number(cooldownSnap.val() || 0);
    if (Date.now() - lastCharge < 4 * 60 * 1000) {
      const waitSecs = Math.ceil((4 * 60 * 1000 - (Date.now() - lastCharge)) / 1000);
      return res.status(429).json({
        error: "Wait " + waitSecs + "s before purchasing another session (1-min cooldown after your 3-min call)",
        cooldown: true,
        waitSecs
      });
    }

    /* ── 5. Atomic coin deduction — admin and free rooms skip charge ── */
    const isRoomAdmin = memberUid === "v6aIXY12MDY9ci1wWJmCiLOAKoG2";
    const isFreeRoom  = cost === 0;
    let deductResult = { committed: true };
    if (!isRoomAdmin && !isFreeRoom) {
      deductResult = await db.ref("users/" + memberUid).transaction(data => {
        if (!data) return; /* abort — do NOT return null, that WRITES null and deletes the node */
        const current = Number(data.coins || 0);
        if (current < cost) return; /* abort */
        data.coins = current - cost;
        return data;
      });
    }
    if (!deductResult.committed)
      return res.status(402).json({ error: "Not enough coins" });

    const now   = Date.now();
    const endTs = now + 3 * 60 * 1000;

    /* ── 6. Write session + increment occupant + credit owner + set cooldown ── */
    const memberSnap = await db.ref("users/" + memberUid).once("value");
    const memberData = memberSnap.val() || {};

    const earnedUsd   = Number((cost * CREATOR_PAYOUT_USD).toFixed(2));
    const platformUsd = Number((cost * PLATFORM_USD).toFixed(2));

    await Promise.all([
      /* session record */
      db.ref("memberRoomSessions/" + roomId + "/" + memberUid).set({
        uid:     memberUid,
        name:    memberData.name  || "Member",
        photo:   memberData.photo || "",
        endTs,
        startTs: now
      }),
      /* occupant count */
      db.ref("memberRooms/" + roomId + "/occupants").transaction(c => (Number(c || 0)) + 1),
      /* credit owner atomically */
      db.ref("users/" + room.ownerId).transaction(data => {
        if (!data) return; /* abort — do NOT return null, that WRITES null and deletes the node */
        /* coins NOT credited — earnings only */
        data.earnings = Number(((data.earnings || 0) + earnedUsd).toFixed(2));
        return data;
      }),
      /* FIX: this path never credited siteRevenue — the admin dashboard's
         revenue figure only ever reflected 1-on-1 call earnings, completely
         missing every paid room session. */
      db.ref("siteRevenue").transaction(data => (Number(data) || 0) + platformUsd),
      /* cooldown record */
      db.ref("memberRoomCooldown/" + memberUid + "/" + roomId).set(now),
      /* audit log */
      db.ref("memberRoomLedger/" + roomId).push({
        fromUid: memberUid,
        toUid:   room.ownerId,
        coins:   cost,
        earnedUsd,
        ts:      now
      })
    ]);

    /* ── 7. Schedule server-side session cleanup after 3 min ── */
    /* The client also does this; the CF ensures cleanup even if client disconnects */
    setTimeout(async () => {
      try {
        const s = await db.ref("memberRoomSessions/" + roomId + "/" + memberUid).once("value");
        if (s.val() && s.val().startTs === now) { /* still the same session */
          await db.ref("memberRoomSessions/" + roomId + "/" + memberUid).remove();
          await db.ref("memberRooms/" + roomId + "/occupants").transaction(c => Math.max(0, (Number(c || 0)) - 1));
        }
      } catch (e) { console.warn("Session cleanup error", e); }
    }, 3 * 60 * 1000 + 5000); /* +5s buffer */

    res.json({ ok: true, endTs, cost, ownerCredit: cost });

  } catch (e) {
    console.error("joinMemberRoom error", e);
    res.status(500).json({ error: e.message || "joinMemberRoom failed" });
  }
});

/* ═══════════════════════════════════════════════════════════════
   13. processMemberRoomEarnings — kept as safety net / reconciler
   Clears any orphaned memberRoomEarnings entries (legacy support).
   Primary crediting is now done in joinMemberRoom above.
═══════════════════════════════════════════════════════════════ */
exports.processMemberRoomEarnings = onSchedule(
  { schedule: "every 5 minutes", region: "us-central1" },
  async () => {
    /* Sweep any legacy entries from the old flow */
    const snap = await db.ref("memberRoomEarnings").once("value");
    if (!snap.exists()) return null;

    const updates = {};
    const creditsPerUser = {};

    snap.forEach(roomSnap => {
      roomSnap.forEach(entrySnap => {
        const e = entrySnap.val();
        if (!e || !e.toUid || !e.coins) return;
        creditsPerUser[e.toUid] = (creditsPerUser[e.toUid] || 0) + Number(e.coins);
        updates["memberRoomEarnings/" + roomSnap.key + "/" + entrySnap.key] = null;
      });
    });

    if (!Object.keys(updates).length) return null;

    const creditPromises = Object.entries(creditsPerUser).map(([uid, coins]) =>
      db.ref("users/" + uid).transaction(data => {
        if (!data) return; /* abort — do NOT return null, that WRITES null and deletes the node */
        data.coins    = (data.coins    || 0) + coins;
        data.earnings = Number(((data.earnings || 0) + (coins * CREATOR_PAYOUT_USD)).toFixed(2));
        return data;
      })
    );

    await Promise.all([db.ref().update(updates), ...creditPromises]);
    console.log("Reconciled legacy member room earnings for:", Object.keys(creditsPerUser));
    return null;
  }
);


/* ═══════════════════════════════════════════
   New user signup email alert to admin
═══════════════════════════════════════════ */
const { beforeUserCreated } = require("firebase-functions/v2/identity");
exports.notifyAdminOnSignup = beforeUserCreated({ secrets: [GMAIL_PASS] }, async (event) => {
  const user = event.data;
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "whisper.me.support@gmail.com",
      pass: GMAIL_PASS.value()
    }
  });
  await transporter.sendMail({
    from: "whisper.me.support@gmail.com",
    to:   "whisper.me.support@gmail.com",
    subject: "New Whisper+Me Signup!",
    html: `
      <h2>New member just signed up!</h2>
      <p><b>Email:</b> ${user.email || "Google/Facebook login"}</p>
      <p><b>UID:</b> ${user.uid}</p>
      <p><b>Time:</b> ${new Date().toLocaleString()}</p>
      <p><a href="https://whisperplusme.com/admin.html">View in Admin Dashboard</a></p>
    `
  });
  console.log("Signup alert sent for", user.email);
});

/* ═══════════════════════════════════════════
   Email admin on new signup
═══════════════════════════════════════════ */
exports.notifyAdminOnSignup = onValueCreated(
  { ref: "/users/{uid}", region: "us-central1", secrets: [GMAIL_PASS] },
  async (event) => {
    const user = event.data.val();
    if(!user) return;
    try {
      const nodemailer = require("nodemailer");
      const t = nodemailer.createTransport({
        service: "gmail",
        auth: { user: "whisper.me.support@gmail.com", pass: GMAIL_PASS.value() }
      });
      await t.sendMail({
        from: "whisper.me.support@gmail.com",
        to:   "whisper.me.support@gmail.com",
        subject: "🎉 New Whisper+Me Signup!",
        html: "<h2>New member signed up!</h2><p><b>Name:</b> " + (user.name||"Unknown") + "</p><p><b>Email:</b> " + (user.email||"Google login") + "</p><p><b>Time:</b> " + new Date().toLocaleString() + "</p><p><a href='https://whisperplusme.com/admin.html'>View Admin Dashboard</a></p>"
      });
      console.log("Signup email sent for", user.email);
    } catch(e){ console.warn("Signup email failed:", e.message); }
  }
);

exports.adminSendPushNotification = onRequest(
  { cors: true },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    try {
      const caller = await verifyToken(req);
      if (caller.uid !== "v6aIXY12MDY9ci1wWJmCiLOAKoG2")
        return res.status(403).json({ error: "Unauthorized" });

      const { title, body, url, image } = req.body;
      if (!title || !body) return res.status(400).json({ error: "title and body required" });

      const tokensSnap = await db.ref("fcmTokens").once("value");
      const tokensData = tokensSnap.val() || {};
      /* keep uid alongside each token so we can clean up dead ones by uid afterward */
      const entries = Object.entries(tokensData)
        .map(([uid, v]) => ({ uid, token: v && v.token }))
        .filter(e => e.token);
      if (!entries.length) return res.json({ success: true, sent: 0, failed: 0, note: "No registered devices" });

      const { getMessaging } = require("firebase-admin/messaging");
      const fcm = getMessaging();
      const linkUrl = url || "https://whisperplusme.com";

      let sent = 0, failed = 0;
      const deadUids = [];
      for (let i = 0; i < entries.length; i += 500) {
        const batch = entries.slice(i, i + 500);
        try {
          const resp = await fcm.sendEachForMulticast({
            tokens: batch.map(e => e.token),
            data: { type: "admin_broadcast", title, body, url: linkUrl, image: image || "" },
            notification: { title, body, imageUrl: image || undefined },
            webpush: {
              notification: {
                icon:  "https://whisperplusme.com/favicon-32.png",
                badge: "https://whisperplusme.com/favicon-32.png",
                image: image || undefined
              },
              fcmOptions: { link: linkUrl }
            }
          });
          sent   += resp.successCount;
          failed += resp.failureCount;
          resp.responses.forEach((r, idx) => {
            /* only remove tokens FCM says are permanently dead — not
               transient failures (rate limits, network blips, etc.) which
               shouldn't cost a user their registration */
            if (!r.success && (
              r.error?.code === "messaging/registration-token-not-registered" ||
              r.error?.code === "messaging/invalid-registration-token"
            )) {
              deadUids.push(batch[idx].uid);
            }
          });
        } catch (e) {
          console.error("Broadcast batch failed:", e.message);
          failed += batch.length;
        }
      }

      if (deadUids.length) {
        const cleanup = {};
        deadUids.forEach(uid => { cleanup["fcmTokens/" + uid] = null; });
        await db.ref().update(cleanup);
      }

      /* log it so there's a record of what was sent and when */
      await db.ref("adminBroadcastLog").push({ title, body, url: linkUrl, image: image || null, sent, failed, ts: Date.now() });

      res.json({ success: true, sent, failed, totalTokens: entries.length, staleRemoved: deadUids.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

/* ═══════════════════════════════════════════
   Incoming-call alerts moved to the "nights" codebase (callRing,
   callStopRing, testRing in functions-nights/index.js): they ring every
   device, re-ring while the call is ringing and send missed-call alerts.
═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   Notify all members when a new room opens
═══════════════════════════════════════════ */
exports.notifyMembersNewRoom = onValueCreated(
  { ref: "/memberRooms/{roomId}", region: "us-central1" },
  async (event) => {
    const room   = event.data.val();
    const roomId = event.params.roomId;
    if(!room) return;
    const tokensSnap = await db.ref("fcmTokens").once("value");
    const tokensData = tokensSnap.val() || {};
    const tokens = Object.entries(tokensData)
      .filter(([uid]) => uid !== room.ownerId)
      .map(([, val]) => val.token)
      .filter(Boolean);
    if(!tokens.length){ console.log("No FCM tokens"); return; }
    const { getMessaging } = require("firebase-admin/messaging");
    const fcm = getMessaging();
    const ownerSnap = await db.ref("users/" + room.ownerId).once("value");
    const owner = ownerSnap.val() || {};
    for(let i = 0; i < tokens.length; i += 500){
      const batch = tokens.slice(i, i + 500);
      try {
        const resp = await fcm.sendEachForMulticast({
          tokens: batch,
          data: {
            type: "new_room", roomId, cost: String(room.cost||0),
            roomName:  room.name      || "New Room",
            ownerName: room.ownerName || owner.name || "A member",
            ownerPic:  owner.photo    || owner.photoURL || "",
            url: "https://whisperplusme.com"
          },
          notification: {
            title: "🏠 New Room: " + (room.name||"New Room"),
            body:  (room.ownerName||"A member") + " just opened a room — " + (room.cost||0) + " coins to join"
          },
          webpush: { notification: { icon: owner.photo || "https://whisperplusme.com/favicon-32.png", badge: "https://whisperplusme.com/favicon-32.png" } }
        });
        console.log("Room notif:", resp.successCount, "ok,", resp.failureCount, "failed");
      } catch(e){ console.error("FCM batch failed:", e.message); }
    }
  }
);

/* ═══════════════════════════════════════════
   Dynamic OG tags for profile sharing
   Serves /?user=UID with personalized meta
═══════════════════════════════════════════ */
exports.profileOG = onRequest({ cors: false }, async (req, res) => {
  /* req.path looks like "/u/abc123" here — extract the uid segment.
     (The old version read req.query.user, but Firebase Hosting rewrites
     only ever match the URL PATH, never the query string — so that
     branch never actually ran for a real request.) */
  const pathParts = req.path.split("/").filter(Boolean); // ["u", "abc123"]
  const uid = pathParts[1];
  if (!uid) return res.redirect("/");

  let name  = "a member";
  let bio   = "Come talk to me on Whisper+Me";
  let photo = "https://whisperplusme.com/og-image.png?v=3";
  let price = 1;
  const url = "https://whisperplusme.com/u/" + uid;
  let calls = 0;
  let online = false;

  try {
    const snap = await db.ref("users/" + uid).once("value");
    const u    = snap.val() || {};
    if (u.name)  name  = u.name;
    if (u.bio)   bio   = u.bio.substring(0, 120);
    if (u.photo) photo = u.photo;
    if (u.price) price = u.price;
    calls = u.calls || 0;
  } catch(e) {
    console.warn("profileOG db read failed:", e.message);
  }

  try {
    const presSnap = await db.ref("presence/" + uid).once("value");
    online = presSnap.exists();
  } catch(e) {
    console.warn("profileOG presence read failed:", e.message);
  }

  let priceLine = price + " coin" + (price === 1 ? "" : "s") + " ($" + (price*3) + ") per call";
  let desc = priceLine + " \u00b7 " + bio;
  if (online) {
    desc = "\uD83D\uDFE2 Online now \u2014 " + priceLine + " \u00b7 " + bio;
  } else if (calls > 0) {
    desc = calls + " call" + (calls === 1 ? "" : "s") + " taken \u2014 " + priceLine + " \u00b7 " + bio;
  }

  const esc = (s) => s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="description"          content="${esc(desc)}">
  <meta property="og:type"          content="profile">
  <meta property="og:url"           content="${esc(url)}">
  <meta property="og:title"         content="${esc(name)} on Whisper+Me">
  <meta property="og:description"   content="${esc(desc)}">
  <meta property="og:image"         content="${esc(photo)}">
  <meta property="og:image:width"   content="400">
  <meta property="og:image:height"  content="400">
  <meta property="og:site_name"     content="Whisper+Me">
  <meta name="twitter:card"         content="summary">
  <meta name="twitter:title"        content="${esc(name)} on Whisper+Me">
  <meta name="twitter:description"  content="${esc(desc)}">
  <meta name="twitter:image"        content="${esc(photo)}">
  <script>window.location.href = "/?openProfile=${uid}";</script>
</head>
<body>
  <p>Redirecting to <a href="/?user=${uid}">${esc(name)}'s profile</a>...</p>
</body>
</html>`;

  res.set("Cache-Control", "public, max-age=300");
  res.set("Content-Type", "text/html");
  res.send(html);
});

/* ═══════════════════════════════════════════════════════════════
   joinOG — dynamic preview for the universal /join hub link.
   Reflects real total presence across all rooms right now, so the
   share card people actually see (Twitter/Facebook/iMessage/etc)
   isn't a static line — it's the truth at the moment it's opened.
═══════════════════════════════════════════════════════════════ */
exports.joinOG = onRequest({ cors: false }, async (req, res) => {
  const dest = "https://whisperplusme.com/?room=general";
  const title = "Whisper+Me \u2014 Join a Live Room";
  let desc = "Free anonymous voice chat. Real people, real conversations.";

  try {
    const snap = await db.ref("presence").once("value");
    let online = 0;
    snap.forEach(() => { online++; });
    if (online > 0) {
      desc = "\ud83d\udd34 " + online + " " + (online === 1 ? "person is" : "people are")
        + " on Whisper+Me right now \u2014 tap in, no sign-up required.";
    }
  } catch (e) {
    console.warn("joinOG presence read failed:", e.message);
  }

  const esc = (s) => s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="description"          content="${esc(desc)}">
  <meta property="og:type"          content="website">
  <meta property="og:url"           content="${esc(dest)}">
  <meta property="og:title"         content="${esc(title)}">
  <meta property="og:description"   content="${esc(desc)}">
  <meta property="og:image"         content="https://whisperplusme.com/og-image.png?v=4">
  <meta property="og:image:width"   content="1200">
  <meta property="og:image:height"  content="630">
  <meta property="og:site_name"     content="Whisper+Me">
  <meta name="twitter:card"         content="summary_large_image">
  <meta name="twitter:title"        content="${esc(title)}">
  <meta name="twitter:description"  content="${esc(desc)}">
  <meta name="twitter:image"        content="https://whisperplusme.com/og-image.png?v=4">
  <script>window.location.href = "${dest}";</script>
</head>
<body>
  <p>Joining Whisper+Me... <a href="${dest}">Tap here if you're not redirected</a></p>
</body>
</html>`;

  res.set("Cache-Control", "public, max-age=20");
  res.set("Content-Type", "text/html");
  res.send(html);
});

/* ═══════════════════════════════════════════════════════════════
   roomOG — dynamic per-room social share preview.
   GET /roomOG?room=ROOMID&label=Room+Name
   Crawlers (Twitter/Facebook/Discord/iMessage bots) read the OG tags
   below to build the share card. Real browsers get bounced straight
   into the embeddable guest chat for that room.
═══════════════════════════════════════════════════════════════ */
const ROOM_LABELS = {
  general:       "\uD83D\uDCAC General",
  vent:          "\uD83E\uDD17 Vent & Release",
  anxiety:       "\uD83C\uDF3F Anxiety & Stress",
  nightowls:     "\uD83C\uDF19 Night Owls",
  grief:         "\uD83D\uDD4A\uFE0F Grief & Loss",
  mentalhealth:  "\uD83D\uDC99 Mental Health",
  gangstalking:  "\uD83D\uDD0D Gang Stalking Help",
  voices:        "\uD83C\uDF99\uFE0F Live Voices",
  connection:    "\uD83E\uDD1D Real Connection",
  creators:      "\u2728 Creators Lounge",
  spicy:         "\uD83C\uDF36\uFE0F Spicy",
  hotdates:      "\uD83D\uDD25 Hot Dates",
  sugar:         "\uD83C\uDF6C Sugar",
  lgbt_safe:     "\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08 LGBTQ+ Safe Space",
  lgbt_chat:     "\uD83D\uDC9C Queer Connect",
  lgbt_youth:    "\uD83C\uDF08 Rainbow Youth",
  psychics:      "\uD83D\uDD2E Psychic Circle",
  astrology:     "\u2B50 Astrology Lounge",
  tarot:         "\uD83C\uDCCF Tarot & Palm Reading",
  apothecary:    "\uD83C\uDF3F The Apothecary"
};

exports.roomOG = onRequest({ cors: false }, async (req, res) => {
  const room  = (req.query.room  || "general").replace(/[^a-z0-9_]/gi, "");
  const label = (req.query.label || ROOM_LABELS[room] || "").substring(0, 60);
  const dest  = "https://whisperplusme.com/?room=" + encodeURIComponent(room);

  let title = (label || "Live Chat") + " \u00b7 Whisper+Me";
  let desc  = "Anonymous voice chat \u2014 tap in and see who shows up. No sign-up required.";
  let roomPhoto = "";

  try {
    const snap = await db.ref("presence").once("value");
    let count = 0;
    snap.forEach(c => { if (c.val() && c.val().room === room) count++; });
    if (count > 0) {
      desc = "\ud83d\udd34 " + count + " " + (count === 1 ? "person is" : "people are") + " talking here right now.";
    }
  } catch (e) {
    console.warn("roomOG presence read failed:", e.message);
  }

  try {
    const roomSnap = await db.ref("presetRooms/" + room).once("value");
    const roomData = roomSnap.val();
    if (roomData && roomData.photo && roomData.displayMode !== "emoji") {
      roomPhoto = roomData.photo;
    }
  } catch (e) {
    console.warn("roomOG room photo read failed:", e.message);
  }

  /* A room's uploaded photo is a headshot-style image, not a wide
     banner — use the small "summary" card (like profile shares) so it
     renders as a proportioned thumbnail instead of getting stretched
     into a 1200x630 banner slot. Rooms without a photo keep the
     original branded banner image. */
  const usingRoomPhoto = !!roomPhoto;
  const image      = usingRoomPhoto ? roomPhoto : "https://whisperplusme.com/og-image.png?v=4";
  const imgWidth   = usingRoomPhoto ? "400"  : "1200";
  const imgHeight  = usingRoomPhoto ? "400"  : "630";
  const twitterCard = usingRoomPhoto ? "summary" : "summary_large_image";

  const esc = (s) => s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="description"          content="${esc(desc)}">
  <meta property="og:type"          content="website">
  <meta property="og:url"           content="${esc(dest)}">
  <meta property="og:title"         content="${esc(title)}">
  <meta property="og:description"   content="${esc(desc)}">
  <meta property="og:image"         content="${esc(image)}">
  <meta property="og:image:width"   content="${imgWidth}">
  <meta property="og:image:height"  content="${imgHeight}">
  <meta property="og:site_name"     content="Whisper+Me">
  <meta name="twitter:card"         content="${twitterCard}">
  <meta name="twitter:title"        content="${esc(title)}">
  <meta name="twitter:description"  content="${esc(desc)}">
  <meta name="twitter:image"        content="${esc(image)}">
  <script>window.location.href = "${dest}";</script>
</head>
<body>

  <p>Joining the chat... <a href="${dest}">Tap here if you're not redirected</a></p>
</body>
</html>`;

  res.set("Cache-Control", "public, max-age=30");
  res.set("Content-Type", "text/html");
  res.send(html);
});

/* ═══════════════════════════════════════════════════════════════
   deleteAccount — a member deleting their own account, OR the admin
   deleting any member's account.
   POST /deleteAccount  { targetUid?: string }
   - No targetUid: caller deletes their own account.
   - targetUid + caller is admin: admin deletes that account instead.

   Removes: the Firebase Auth account itself, their profile, personal
   data nodes (coin purchase history, Stripe Connect link, mic log,
   push tokens, cooldowns, moderator assignments, live presence), and
   their uploaded profile photo.

   Deliberately NOT touched: past chat messages (room content, not
   account data — same reasoning as the anonymous-guest cleanup),
   and financial ledgers that involve other parties (call ledger,
   member room ledger, site revenue) since those are legitimate
   accounting records independent of any one account existing.
═══════════════════════════════════════════════════════════════ */
exports.deleteAccount = onRequest({ cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  try {
    const caller = await verifyToken(req);
    const isAdmin = caller.uid === "v6aIXY12MDY9ci1wWJmCiLOAKoG2";
    const requestedTarget = req.body && req.body.targetUid;

    let targetUid = caller.uid;
    if (requestedTarget && requestedTarget !== caller.uid) {
      if (!isAdmin) return res.status(403).json({ error: "Admin only for deleting other accounts" });
      targetUid = requestedTarget;
    }
    if (targetUid === "v6aIXY12MDY9ci1wWJmCiLOAKoG2" && !isAdmin) {
      return res.status(403).json({ error: "Cannot delete the admin account this way" });
    }

    const cleanupPaths = [
      "users/" + targetUid,
      "coinPurchases/" + targetUid,
      "stripeConnectAccounts/" + targetUid,
      "liveMicLog/" + targetUid,
      "fcmTokens/" + targetUid,
      "memberRoomCooldown/" + targetUid,
      "presence/" + targetUid,
      "userPrivate/" + targetUid
    ];
    await Promise.all(cleanupPaths.map(p => db.ref(p).remove().catch(e => {
      console.warn("deleteAccount: cleanup failed for", p, e.message);
    })));

    try {
      const modSnap = await db.ref("roomModerators").once("value");
      const modUpdates = {};
      modSnap.forEach(roomSnap => {
        if (roomSnap.child(targetUid).exists()) {
          modUpdates[roomSnap.key + "/" + targetUid] = null;
        }
      });
      if (Object.keys(modUpdates).length) await db.ref("roomModerators").update(modUpdates);
    } catch (e) {
      console.warn("deleteAccount: moderator cleanup failed:", e.message);
    }

    try {
      await admin.storage().bucket().file("profilePhotos/" + targetUid).delete();
    } catch (e) {
      /* Fine if it never existed */
    }

    await admin.auth().deleteUser(targetUid);

    return res.json({ deleted: targetUid });
  } catch (e) {
    console.error("deleteAccount error", e);
    return res.status(500).json({ error: e.message });
  }
});

exports.adminGiveCoins = onRequest(
  { cors: true },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    try {
      const caller = await verifyToken(req);
      if (caller.uid !== "v6aIXY12MDY9ci1wWJmCiLOAKoG2")
        return res.status(403).json({ error: "Unauthorized" });
      const { uid, newBalance } = req.body;
      const target = Number(newBalance);
      if (!uid || newBalance === undefined || newBalance === null || !Number.isFinite(target) || target < 0) {
        return res.status(400).json({ error: "Missing uid or invalid newBalance (must be a number >= 0)" });
      }
      /* FIX: .transaction() was aborting on real, existing users. The Admin
         SDK's transaction() can invoke the update callback speculatively
         with data=null before it has actually fetched the current server
         value; our old code treated that speculative null as "no such
         user" and aborted immediately, producing false 404s. A plain
         read-then-update avoids that race entirely and is safe here since
         admin sets an absolute value rather than depending on the prior
         value. */
      const snap = await db.ref("users/" + uid).once("value");
      if (!snap.exists()) {
        return res.status(404).json({ error: "User not found" });
      }
      await db.ref("users/" + uid).update({ coins: target });
      res.json({ success: true, coins: target });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }
);

exports.adminSetBanStatus = onRequest(
  { cors: true },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    try {
      const caller = await verifyToken(req);
      if (caller.uid !== "v6aIXY12MDY9ci1wWJmCiLOAKoG2")
        return res.status(403).json({ error: "Unauthorized" });
      const { uid, banned } = req.body;
      if (!uid || typeof banned !== "boolean") {
        return res.status(400).json({ error: "Missing uid or invalid banned (must be true/false)" });
      }
      const snap = await db.ref("users/" + uid).once("value");
      if (!snap.exists()) return res.status(404).json({ error: "User not found" });
      await db.ref("users/" + uid).update({
        banned,
        banAt: banned ? Date.now() : null
      });
      if (banned) {
        /* also force-deactivate any live mic sessions for this user */
        const micsSnap = await db.ref("liveMics").once("value");
        const updates = {};
        micsSnap.forEach(room => {
          room.forEach(mic => {
            if (mic.key === uid) updates[`liveMics/${room.key}/${uid}/active`] = false;
          });
        });
        if (Object.keys(updates).length) await db.ref().update(updates);
      }
      res.json({ success: true, banned });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }
);

exports.adminMarkPayout = onRequest(
  { cors: true },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    try {
      const caller = await verifyToken(req);
      if (caller.uid !== "v6aIXY12MDY9ci1wWJmCiLOAKoG2")
        return res.status(403).json({ error: "Unauthorized" });
      const { uid, amount } = req.body;
      const amt = Number(amount);
      if (!uid || !Number.isFinite(amt) || amt < 0) {
        return res.status(400).json({ error: "Missing uid or invalid amount (must be a number >= 0)" });
      }
      const snap = await db.ref("users/" + uid).once("value");
      if (!snap.exists()) return res.status(404).json({ error: "User not found" });
      await db.ref("users/" + uid).update({
        lastPaidOut: Date.now(),
        lastPaidAmount: amt
      });
      res.json({ success: true });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }
);

/* ═══════════════════════════════════════════
   Clean up stale online presence every 5 min
═══════════════════════════════════════════ */
exports.cleanupStalePresence = onSchedule("every 5 minutes", async () => {
  const cutoff = Date.now() - 10 * 60 * 1000; /* 10 min ago */
  const snap = await db.ref("users").orderByChild("lastSeen").endAt(cutoff).once("value");
  const updates = {};
  snap.forEach(function(c){
    if(c.val() && c.val().online){
      updates[c.key + "/online"] = false;
    }
  });
  if(Object.keys(updates).length > 0){
    await db.ref("users").update(updates);
    console.log("Cleaned", Object.keys(updates).length, "stale presence entries");
  }
});

/* ═══════════════════════════════════════════════════════════════
   cleanupAnonymousUsers — daily
   Firebase Auth never auto-deletes anonymous accounts; they pile up
   forever otherwise. Deletes any anonymous account (no provider data)
   whose last sign-in was more than 24 hours ago. Their past chat
   messages are untouched — this only removes the throwaway Auth
   account, not room history.
═══════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   Anonymous account cleanup — shared logic
   Firebase Auth never auto-deletes anonymous accounts; they pile up
   forever otherwise. Deletes any anonymous account (no provider data)
   whose last sign-in was more than CUTOFF_DAYS ago. Their past chat
   messages are untouched — this only removes the throwaway Auth
   account, not room history.
═══════════════════════════════════════════════════════════════ */
async function runAnonymousCleanup(cutoffDays) {
  const CUTOFF_MS = cutoffDays * 24 * 60 * 60 * 1000;
  const cutoffTime = Date.now() - CUTOFF_MS;
  let deleted = 0;
  let nextPageToken;

  do {
    const result = await admin.auth().listUsers(1000, nextPageToken);
    const toDelete = result.users
      .filter(u =>
        u.providerData.length === 0 && /* anonymous accounts have no provider data */
        new Date(u.metadata.lastSignInTime).getTime() < cutoffTime
      )
      .map(u => u.uid);

    for (let i = 0; i < toDelete.length; i += 1000) {
      const batch = toDelete.slice(i, i + 1000);
      if (batch.length) {
        const res = await admin.auth().deleteUsers(batch);
        deleted += res.successCount;
      }
    }

    nextPageToken = result.pageToken;
  } while (nextPageToken);

  return deleted;
}

/* Runs automatically every 24 hours */
exports.cleanupAnonymousUsers = onSchedule(
  { schedule: "every 24 hours", region: "us-central1" },
  async () => {
    const deleted = await runAnonymousCleanup(1);
    console.log("cleanupAnonymousUsers: deleted", deleted, "stale anonymous accounts");
    return null;
  }
);

/* ═══════════════════════════════════════════════════════════════
   runAnonymousCleanupNow — admin-triggered, runs immediately
   POST /runAnonymousCleanupNow  { days?: number }  (defaults to 30)
═══════════════════════════════════════════════════════════════ */
exports.runAnonymousCleanupNow = onRequest({ cors: true }, async (req, res) => {
  try {
    const user = await verifyToken(req);
    if (user.uid !== "v6aIXY12MDY9ci1wWJmCiLOAKoG2") {
      return res.status(403).json({ error: "Admin only" });
    }
    const days = Number(req.body && req.body.days) || 1;
    const deleted = await runAnonymousCleanup(days);
    return res.json({ deleted, cutoffDays: days });
  } catch (e) {
    console.error("runAnonymousCleanupNow error", e);
    return res.status(500).json({ error: e.message });
  }
});
