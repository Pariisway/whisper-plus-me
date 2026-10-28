/**
 * Whisper+me Dates — Cloud Functions (deployed as the separate "nights" codebase,
 * so the original Whisper+me functions are never touched by a Dates deploy).
 *
 * THE RULES (all numbers live in Firestore settings/platform and can be changed in the admin)
 *  - Everyone going on a date keeps a $5 date deposit on their account. It covers every future date.
 *  - Cancelling (after someone else has committed) or not showing up forfeits the deposit;
 *    a new deposit is needed before booking again.
 *  - Split tickets: every share is put on HOLD (card authorized, not charged). Only when every seat
 *    is held is everyone charged at once. If the group doesn't fill in time, holds drop off: nobody pays.
 *  - Pay-in-full tickets: the host is charged right away; guests join free (deposit still required).
 *  - Each person gets their own door code, released only once the ticket is fully paid.
 *  - Late cancel (inside 48h) or no-show = a strike. 2 strikes = 3-day break from Dates.
 *  - Anyone stood up who checks in at the venue gets 5 Whisper coins after the date.
 *  - Ticket shares are never refunded to someone who cancels; reschedule once (all agree, 48h+ ahead) instead.
 *    Their seat stays paid, so the others can invite a replacement for free.
 *  - Venues are paid AFTER the date, so a venue cancellation is refunded from money still held.
 *
 * Date status: forming → confirmed → completed   (or canceled)
 * Seat status: open · invited · pay (needs to pay) · held (split, card on hold) · paid · joined (free seat on a paid ticket)
 * All money is in cents.
 */
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Stripe = require("stripe");

admin.initializeApp({ databaseURL: "https://whisperplusme-46d9c-default-rtdb.firebaseio.com" });
const db = admin.firestore();
const rtdb = admin.database();
const { FieldValue, Timestamp } = admin.firestore;

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// Same Stripe account as Whisper+me: reuses the existing STRIPE_SECRET_KEY secret.
// Dates has its own webhook endpoint, so it gets its own signing secret.
const STRIPE_SECRET = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("NIGHTS_STRIPE_WEBHOOK_SECRET");
const APP_URL = "https://whisperplusme.com";
const BRAND_NAME = "Whisper+me Dates";
const ADMIN_UIDS = ["v6aIXY12MDY9ci1wWJmCiLOAKoG2"]; // same admin as database.rules.json

let _stripe;
const stripe = () => (_stripe ||= new Stripe(STRIPE_SECRET.value()));
const withStripe = { secrets: [STRIPE_SECRET] };

const DEFAULT_SETTINGS = {
  fee: 10,                    // platform fee, % of each ticket (taken from the venue payout)
  depositCents: 500,          // the $5 date deposit
  splitWindowHours: 24,       // time a split group has to fill and pay
  minAge: 21,
  requireIdVerify: false,
  stoodUpRewardCoins: 5,      // Whisper coins for someone who was stood up and checked in
  strikesForSuspension: 2,
  suspensionDays: 3,
  lateCancelHours: 48,        // cancelling inside this window counts as standing someone up
  rescheduleCutoffHours: 48,
  openRequests: true,         // members may post "find me a date" and request to join
  autoApproveVenues: false
};
const CATEGORIES = ["Dinner", "Activities", "Concerts", "Movies", "Other"];
const HOST_PAY_MINUTES = 35;
const SETTLE_AFTER_HOURS = 3;   // no-shows are settled this long after the start time
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/* ================= helpers ================= */
const fail = (code, msg) => { throw new HttpsError(code, msg); };
const nowTs = () => Timestamp.now();
const ms = ts => (ts && ts.toMillis ? ts.toMillis() : Number(ts) || 0);
const fromMs = m => Timestamp.fromMillis(m);
const fmtMoney = c => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
const fmtWhen = ts => new Date(ms(ts)).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const makeCode = () => "WN-" + Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const dayKey = d => d.toISOString().slice(0, 10);
const isAdminReq = req => !!req.auth && (req.auth.token.admin === true || ADMIN_UIDS.includes(req.auth.uid));
const filled = s => s.uid && ["pay", "held", "paid", "joined"].includes(s.status);   // committed or about to be
const attending = s => s.uid && ["paid", "joined"].includes(s.status);              // has a valid spot on a paid ticket

async function getSettings() {
  const snap = await db.doc("settings/platform").get();
  return { ...DEFAULT_SETTINGS, ...(snap.exists ? snap.data() : {}) };
}

/** Name and photo come from the member's Whisper+me profile (Realtime Database). */
async function whisperProfile(uid) {
  const v = (await rtdb.ref(`users/${uid}`).once("value")).val() || {};
  return { name: String(v.name || "Member").slice(0, 40), photo: String(v.photo || "").slice(0, 500) };
}

function requireUser(req) {
  if (!req.auth) fail("unauthenticated", "Sign in first.");
  if (req.auth.token.firebase && req.auth.token.firebase.sign_in_provider === "anonymous") {
    fail("permission-denied", "Create a free account to go on dates.");
  }
  return req.auth.uid;
}

async function getMember(uid) {
  const snap = await db.doc(`members/${uid}`).get();
  return snap.exists ? { id: uid, ...snap.data() } : null;
}

/** Everything someone needs before they can host, accept, request or join. */
function checkCanDate(m, s) {
  if (!m) fail("failed-precondition", "Set up Dates first (it takes a few seconds).");
  if (m.suspendedUntil && ms(m.suspendedUntil) > Date.now()) {
    fail("failed-precondition", `You're on a break from Dates until ${fmtWhen(m.suspendedUntil)} because of 2 missed dates.`);
  }
  if (!m.deposit || m.deposit.status !== "active") {
    fail("failed-precondition", m.deposit && m.deposit.status === "forfeited"
      ? `Your last deposit was kept after a cancellation or missed date. Add a new ${fmtMoney(s.depositCents)} deposit to keep dating.`
      : `Add your ${fmtMoney(s.depositCents)} date deposit first. It stays on your account for every date.`);
  }
  if (s.requireIdVerify && !m.verified) {
    fail("failed-precondition", m.idUploaded ? "Your ID is still being reviewed." : "Upload a photo ID in Dates before your first date.");
  }
}

async function push(uid, title, body) {
  try {
    const token = (await rtdb.ref(`fcmTokens/${uid}/token`).once("value")).val();
    if (!token) return;
    await admin.messaging().send({
      token,
      notification: { title, body },
      data: { type: "dates", url: `${APP_URL}/?dates=1` },
      webpush: { fcmOptions: { link: `${APP_URL}/?dates=1` }, notification: { icon: `${APP_URL}/favicon-32.png` } }
    });
  } catch (e) { logger.warn("push failed", uid, e.message); }
}

async function creditCoins(uid, coins, reason, dateId) {
  if (!coins) return;
  await rtdb.ref(`users/${uid}/coins`).transaction(c => (Number(c) || 0) + coins);
  await db.collection("ledger").add({ kind: "reward", uid, coins, reason, dateId, at: nowTs() });
}

async function forfeitDeposit(uid, reason, dateId) {
  const ref = db.doc(`members/${uid}`);
  const m = (await ref.get()).data();
  if (!m || !m.deposit || m.deposit.status !== "active") return false;
  await ref.update({ "deposit.status": "forfeited", "deposit.forfeitedAt": nowTs(), "deposit.forfeitReason": reason });
  await db.collection("ledger").add({ kind: "depositForfeited", uid, amount: m.deposit.amount || 0, reason, dateId, at: nowTs() });
  const day = dayKey(new Date());
  await db.doc(`stats/day-${day}`).set({ day, depositsKept: FieldValue.increment(m.deposit.amount || 0) }, { merge: true });
  return true;
}

/** A strike; reaching the limit starts a break from Dates and resets the count. */
async function addStrike(uid, s, why) {
  const ref = db.doc(`members/${uid}`);
  let suspended = false;
  await db.runTransaction(async tx => {
    const m = (await tx.get(ref)).data() || {};
    const strikes = (m.strikes || 0) + 1;
    if (strikes >= s.strikesForSuspension) {
      suspended = true;
      tx.set(ref, { strikes: 0, suspendedUntil: fromMs(Date.now() + s.suspensionDays * 86400000), lastStrikeAt: nowTs(), lastStrikeWhy: why }, { merge: true });
    } else {
      tx.set(ref, { strikes, lastStrikeAt: nowTs(), lastStrikeWhy: why }, { merge: true });
    }
  });
  return suspended;
}

async function log(req, action, target, detail = "") {
  await db.collection("adminLog").add({ by: req.auth.uid, byEmail: req.auth.token.email || "", action, target, detail, at: FieldValue.serverTimestamp() });
}

/* ---------- Stripe ---------- */
async function checkoutFor({ kind, uid, email, amount, name, description, dateId = "", seatIndex = -1, hold = false }) {
  const meta = { app: "dates", kind, uid, dateId, seatIndex: String(seatIndex) };
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer_email: email || undefined,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: { name, description } } }],
    metadata: meta,
    payment_intent_data: { metadata: meta, ...(hold ? { capture_method: "manual" } : {}) },
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    success_url: `${APP_URL}/?dates=${kind}#dates`,
    cancel_url: `${APP_URL}/?dates=back#dates`
  });
  return session.url;
}

async function seatCheckout(dateId, d, i, email) {
  const seat = d.seats[i];
  const split = d.mode === "split";
  return checkoutFor({
    kind: "seat", uid: seat.uid, email, amount: seat.amount, dateId, seatIndex: i, hold: split,
    name: `${d.title} · ${d.venueName}`,
    description: `${split ? "Your share (held until everyone pays)" : "Full ticket"} for ${d.size} · ${fmtWhen(d.startsAt)}`
  });
}

/** Split amounts so they always add up to the ticket price. */
function seatAmounts(total, size, mode) {
  const base = Math.floor(total / size), rem = total - base * size;
  return Array.from({ length: size }, (_, i) => mode === "full" ? (i === 0 ? total : 0) : base + (i === 0 ? rem : 0));
}

/** Who should be able to see/query this date. */
function involved(d) {
  return [...new Set([d.hostUid, ...d.seats.filter(s => s.uid).map(s => s.uid), ...(d.requests || []).map(r => r.uid)])];
}

/** Issue door codes for every attending seat that doesn't have one yet. */
function issueCodes(d) {
  d.seats.forEach(s => { if (attending(s) && !s.code) s.code = makeCode(); });
  d.codes = d.seats.filter(s => s.code).map(s => s.code);
}

function confirmPatch(d) {
  issueCodes(d);
  return { status: "confirmed", confirmedAt: nowTs(), seats: d.seats, codes: d.codes, open: d.seats.some(s => s.status === "open") && d.open };
}

/** Release a forming date: drop every card hold, put the ticket back on sale. No charges, no penalties. */
async function dissolveDate(dateId, reason, { refundCaptured = false } = {}) {
  const ref = db.doc(`dates/${dateId}`);
  const d = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const x = snap.data();
    if (["canceled", "completed"].includes(x.status)) return null;
    const t = db.doc(`tickets/${x.ticketId}`);
    if (x.status === "confirmed") tx.update(t, { sold: FieldValue.increment(-1) });
    else tx.update(t, { held: FieldValue.increment(-1) });
    tx.update(ref, { status: "canceled", canceledAt: nowTs(), canceledReason: reason, open: false });
    return x;
  });
  if (!d) return false;
  const seats = [...d.seats];
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    if (!s.paymentIntent) continue;
    try {
      if (s.status === "held") { await stripe().paymentIntents.cancel(s.paymentIntent); seats[i] = { ...s, status: "released" }; }
      else if (s.status === "paid" && s.amount > 0 && (d.status === "forming" || refundCaptured)) { await stripe().refunds.create({ payment_intent: s.paymentIntent }); seats[i] = { ...s, status: "refunded" }; }
    } catch (e) { logger.error("release/refund failed", dateId, i, e.message); seats[i] = { ...s, moneyError: e.message }; }
  }
  // Also release any seat payment that was mid-checkout or paid but superseded.
  await ref.update({ seats });
  for (const uid of involved(d)) await push(uid, "Date canceled", `${d.title}: ${reason}`);
  return true;
}

/* ================= member functions ================= */

/** Create (or refresh) the member's Dates profile. Name and photo come from Whisper+me. */
exports.datesJoin = onCall(async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const by = Math.round(Number(req.data?.birthYear));
  const ref = db.doc(`members/${uid}`);
  const existing = (await ref.get()).data();
  const birthYear = existing?.birthYear || by;
  if (!birthYear || birthYear < 1900) fail("invalid-argument", "Enter your birth year.");
  if (new Date().getFullYear() - birthYear < s.minAge) fail("failed-precondition", `Dates is for people ${s.minAge} and older.`);
  const p = await whisperProfile(uid);
  await ref.set(existing
    ? { name: p.name, photo: p.photo }
    : { name: p.name, photo: p.photo, birthYear, deposit: { status: "none" }, strikes: 0, verified: false, idUploaded: false, createdAt: nowTs() },
  { merge: true });
  return { ok: true };
});

exports.payDeposit = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const m = await getMember(uid);
  if (!m) fail("failed-precondition", "Set up Dates first.");
  if (m.deposit?.status === "active") fail("already-exists", "Your deposit is already on your account.");
  return { url: await checkoutFor({ kind: "deposit", uid, email: req.auth.token.email, amount: s.depositCents, name: `${BRAND_NAME} deposit`, description: "Stays on your account for every date. Kept if you cancel or miss a date." }) };
});

exports.createDate = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const m = await getMember(uid);
  checkCanDate(m, s);
  const { ticketId, mode, inviteUids = [], openToRequests = false } = req.data || {};
  if (!["split", "full"].includes(mode)) fail("invalid-argument", "Choose split or pay in full.");
  const tRef = db.doc(`tickets/${ticketId}`);
  const t = (await tRef.get()).data();
  if (!t) fail("not-found", "That ticket is no longer available.");
  const invites = [...new Set(inviteUids)].filter(x => x && x !== uid).slice(0, t.size - 1);
  const open = !!openToRequests && s.openRequests;
  if (!invites.length && !open) fail("invalid-argument", "Invite someone, or let members request to join.");
  for (const g of invites) {
    if (!(await rtdb.ref(`users/${g}/name`).once("value")).exists()) fail("not-found", "One of the people you invited couldn't be found.");
  }
  const amounts = seatAmounts(t.price, t.size, mode);
  const host = await whisperProfile(uid);
  const seats = [{ uid, ...host, status: "pay", amount: amounts[0], invited: false }];
  for (let i = 1; i < t.size; i++) {
    const g = invites[i - 1];
    seats.push(g ? { uid: g, ...(await whisperProfile(g)), status: "invited", amount: amounts[i], invited: true }
                 : { uid: null, name: "", photo: "", status: "open", amount: amounts[i], invited: false });
  }
  const startMs = ms(t.startsAt);
  const windowEnd = Math.min(Date.now() + s.splitWindowHours * 3600000, startMs - 2 * 3600000);
  const ref = db.collection("dates").doc();
  const d = {
    ticketId, venueId: t.venueId, venueName: t.venueName, title: t.title, category: t.category, items: t.items || [],
    hue: t.hue ?? null, imageURL: t.imageURL || "", startsAt: t.startsAt, size: t.size, total: t.price, mode,
    hostUid: uid, hostName: host.name, hostPhoto: host.photo, seats, requests: [], open,
    live: false,                 // becomes true once the host's payment/hold goes through
    status: "forming", codes: [], rescheduled: false,
    hostPayBy: fromMs(Date.now() + HOST_PAY_MINUTES * 60000),
    expiresAt: fromMs(Math.max(windowEnd, Date.now() + 60 * 60000)),
    createdAt: nowTs()
  };
  d.involvedUids = involved(d);
  await db.runTransaction(async tx => {
    const fresh = (await tx.get(tRef)).data();
    const venue = (await tx.get(db.doc(`venues/${fresh.venueId}`))).data();
    if (fresh.status !== "live" || fresh.adminHidden || venue?.status !== "approved") fail("failed-precondition", "This ticket isn't for sale right now.");
    if (ms(fresh.startsAt) < Date.now() + 3 * 3600000) fail("failed-precondition", "This one starts too soon to book. Pick a later date.");
    if (fresh.quantity - fresh.sold - fresh.held < 1) fail("resource-exhausted", "Sold out. Try another night.");
    tx.update(tRef, { held: FieldValue.increment(1) });
    tx.set(ref, d);
  });
  return { dateId: ref.id, url: await seatCheckout(ref.id, d, 0, req.auth.token.email) };
});

/** Get a fresh payment link for your seat. */
exports.paySeat = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const { dateId } = req.data || {};
  const d = (await db.doc(`dates/${dateId}`).get()).data();
  if (!d || ["canceled", "completed"].includes(d.status)) fail("failed-precondition", "This date is no longer active.");
  const i = d.seats.findIndex(x => x.uid === uid && x.status === "pay");
  if (i < 0) fail("failed-precondition", "Nothing to pay on this date.");
  if (i === 0 && !d.live) await db.doc(`dates/${dateId}`).update({ hostPayBy: fromMs(Date.now() + HOST_PAY_MINUTES * 60000) });
  return { url: await seatCheckout(dateId, d, i, req.auth.token.email) };
});

/** Accept or decline an invite from the host. */
exports.answerInvite = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const { dateId, accept } = req.data || {};
  const ref = db.doc(`dates/${dateId}`);
  if (accept) checkCanDate(await getMember(uid), s);
  let d, i;
  await db.runTransaction(async tx => {
    d = (await tx.get(ref)).data();
    if (!d || !d.live || !["forming", "confirmed"].includes(d.status)) fail("failed-precondition", "This invite has expired.");
    i = d.seats.findIndex(x => x.uid === uid && x.status === "invited");
    if (i < 0) fail("failed-precondition", "You've already answered this invite.");
    if (accept) {
      // On a paid-in-full ticket the seat is already covered.
      d.seats[i] = { ...d.seats[i], status: d.seats[i].amount > 0 ? "pay" : "joined", answeredAt: nowTs() };
      if (d.status === "confirmed") issueCodes(d);
    } else {
      d.seats[i] = { uid: null, name: "", photo: "", status: "open", amount: d.seats[i].amount, invited: false };
    }
    d.involvedUids = involved(d);
    tx.update(ref, { seats: d.seats, involvedUids: d.involvedUids, codes: d.codes || [] });
  });
  const me = await whisperProfile(uid);
  await push(d.hostUid, accept ? "Invite accepted" : "Invite declined", `${me.name} ${accept ? "is in" : "can't make it"}: ${d.title}`);
  if (accept && d.seats[i].status === "pay") return { url: await seatCheckout(dateId, d, i, req.auth.token.email) };
  if (accept && d.mode === "split") await maybeCaptureSplit(dateId);
  return { ok: true };
});

/** "Find me a date": ask to join someone's open date. */
exports.requestToJoin = onCall(async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  checkCanDate(await getMember(uid), s);
  const { dateId } = req.data || {};
  const ref = db.doc(`dates/${dateId}`);
  const me = await whisperProfile(uid);
  let d;
  await db.runTransaction(async tx => {
    d = (await tx.get(ref)).data();
    if (!d || !d.live || !d.open || !["forming", "confirmed"].includes(d.status)) fail("failed-precondition", "This date isn't taking requests anymore.");
    if (d.involvedUids.includes(uid)) fail("already-exists", "You're already on this date or have asked to join.");
    if (!d.seats.some(x => x.status === "open")) fail("resource-exhausted", "This date is full.");
    if ((d.requests || []).length >= 20) fail("resource-exhausted", "This date has plenty of requests already.");
    d.requests = [...(d.requests || []), { uid, name: me.name, photo: me.photo, at: nowTs() }];
    d.involvedUids = involved(d);
    tx.update(ref, { requests: d.requests, involvedUids: d.involvedUids });
  });
  await push(d.hostUid, "Someone wants to join your date", `${me.name} asked to join ${d.title}`);
  return { ok: true };
});

/** Host approves or turns down a request. */
exports.answerRequest = onCall(async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const { dateId, memberUid, approve } = req.data || {};
  const ref = db.doc(`dates/${dateId}`);
  if (approve) checkCanDate(await getMember(memberUid), s);
  let d;
  await db.runTransaction(async tx => {
    d = (await tx.get(ref)).data();
    if (!d || d.hostUid !== uid) fail("permission-denied", "Only the host can answer requests.");
    const r = (d.requests || []).find(x => x.uid === memberUid);
    if (!r) fail("not-found", "That request is gone.");
    d.requests = d.requests.filter(x => x.uid !== memberUid);
    if (approve) {
      const i = d.seats.findIndex(x => x.status === "open");
      if (i < 0) fail("resource-exhausted", "Your date is already full.");
      d.seats[i] = { uid: memberUid, name: r.name, photo: r.photo, status: d.seats[i].amount > 0 ? "pay" : "joined", amount: d.seats[i].amount, invited: false, answeredAt: nowTs() };
      if (d.status === "confirmed") issueCodes(d);
      if (!d.seats.some(x => x.status === "open")) d.requests = [];
    }
    d.involvedUids = involved(d);
    tx.update(ref, { seats: d.seats, requests: d.requests, involvedUids: d.involvedUids, codes: d.codes || [] });
  });
  await push(memberUid, approve ? "You're in!" : "Request not accepted", approve
    ? `${d.hostName} picked you for ${d.title}.${d.mode === "split" ? " Pay your share in Dates to lock it in." : ""}`
    : `${d.hostName}'s date ${d.title} is set.`);
  return { ok: true };
});

/** Host invites more people into open seats (also how a canceled seat gets refilled). */
exports.inviteToDate = onCall(async req => {
  const uid = requireUser(req);
  const { dateId, uids = [] } = req.data || {};
  const ref = db.doc(`dates/${dateId}`);
  const profiles = {};
  for (const g of [...new Set(uids)].slice(0, 5)) profiles[g] = await whisperProfile(g);
  let d;
  await db.runTransaction(async tx => {
    d = (await tx.get(ref)).data();
    if (!d || d.hostUid !== uid) fail("permission-denied", "Only the host can invite people.");
    if (!["forming", "confirmed"].includes(d.status)) fail("failed-precondition", "This date is no longer active.");
    for (const g of Object.keys(profiles)) {
      if (d.involvedUids.includes(g) && !(d.requests || []).some(r => r.uid === g)) continue;
      const i = d.seats.findIndex(x => x.status === "open");
      if (i < 0) break;
      d.seats[i] = { uid: g, ...profiles[g], status: "invited", amount: d.seats[i].amount, invited: true };
      d.requests = (d.requests || []).filter(r => r.uid !== g);
    }
    d.involvedUids = involved(d);
    tx.update(ref, { seats: d.seats, requests: d.requests || [], involvedUids: d.involvedUids });
  });
  for (const g of Object.keys(profiles)) await push(g, "You're invited on a date", `${d.hostName} invited you to ${d.title} · ${fmtWhen(d.startsAt)}`);
  return { ok: true };
});

/**
 * Leave / cancel. With preview:true nothing changes; it returns exactly what the member will lose,
 * so the app can show it BEFORE they confirm.
 */
exports.leaveDate = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const { dateId, preview = false } = req.data || {};
  const ref = db.doc(`dates/${dateId}`);
  const d = (await ref.get()).data();
  if (!d || !["forming", "confirmed"].includes(d.status)) fail("failed-precondition", "This date is no longer active.");
  const i = d.seats.findIndex(x => x.uid === uid && x.status !== "open");
  if (i < 0) fail("failed-precondition", "You're not on this date.");
  if (d.seats[i].status === "invited") fail("failed-precondition", "Use Decline to turn down an invite. Declining is free.");
  const me = d.seats[i];
  const m = await getMember(uid);
  const hoursLeft = (ms(d.startsAt) - Date.now()) / 3600000;
  const others = d.seats.filter((x, k) => k !== i && filled(x));
  const someoneElseCommitted = others.length > 0;
  const isHost = d.hostUid === uid;
  const late = d.status === "confirmed" && hoursLeft < s.lateCancelHours;
  const hostEndsIt = isHost && d.status === "forming";

  const loseDeposit = someoneElseCommitted && m?.deposit?.status === "active";
  const loseTicket = d.status === "confirmed" && me.status === "paid" ? me.amount : 0;
  const strike = late && someoneElseCommitted;
  const strikesNow = (m?.strikes || 0) + (strike ? 1 : 0);
  const canReschedule = d.status === "confirmed" && !d.rescheduled && hoursLeft >= s.rescheduleCutoffHours;
  const lines = [];
  if (hostEndsIt) lines.push(someoneElseCommitted ? "The whole date is canceled for everyone. Card holds are released, so nobody is charged." : "Your date is canceled and your card hold is released. Nobody is charged.");
  if (loseDeposit) lines.push(`You lose your ${fmtMoney(m.deposit.amount || s.depositCents)} deposit and need a new one before your next date.`);
  if (loseTicket) lines.push(`Your ${fmtMoney(loseTicket)} share of the ticket is not refunded.${canReschedule ? " Rescheduling instead keeps it." : ""}`);
  if (me.status === "held") lines.push("Your card hold is released. You won't be charged for the ticket.");
  if (strike) lines.push(strikesNow >= s.strikesForSuspension
    ? `This is a missed date (strike ${strikesNow} of ${s.strikesForSuspension}), so you'll be on a ${s.suspensionDays}-day break from Dates.`
    : `This counts as a missed date: strike ${strikesNow} of ${s.strikesForSuspension}. At ${s.strikesForSuspension} you get a ${s.suspensionDays}-day break from Dates.`);
  if (late && someoneElseCommitted && s.stoodUpRewardCoins) lines.push(`If your date still shows up, they get ${s.stoodUpRewardCoins} Whisper coins.`);
  if (!lines.length) lines.push("You can leave this date. Nothing is charged and you keep your deposit.");
  const summary = { lines, loseDeposit, loseTicket, strike, canReschedule, hostEndsIt, hoursLeft: Math.round(hoursLeft) };
  if (preview) return summary;

  if (hostEndsIt) {
    await dissolveDate(dateId, "The host canceled.");
    if (loseDeposit) await forfeitDeposit(uid, "Host canceled a date others had joined", dateId);
    return { ...summary, done: true };
  }
  // Leave the seat; the money already paid on the ticket stays with the ticket.
  let holdToRelease = null;
  await db.runTransaction(async tx => {
    const x = (await tx.get(ref)).data();
    const k = x.seats.findIndex(y => y.uid === uid && !["open", "invited"].includes(y.status));
    if (k < 0) return;
    const seat = x.seats[k];
    if (seat.status === "held") holdToRelease = seat.paymentIntent;
    const stillPaid = x.status === "confirmed";   // a paid seat can be given to someone else for free
    x.seats[k] = { uid: null, name: "", photo: "", status: "open", amount: stillPaid ? 0 : seat.amount, invited: false, leftBy: uid };
    let hostUid = x.hostUid, hostName = x.hostName, hostPhoto = x.hostPhoto;
    if (x.hostUid === uid) { // host leaves a confirmed date: hand it to the next person on it
      const next = x.seats.find(y => attending(y));
      if (next) { hostUid = next.uid; hostName = next.name; hostPhoto = next.photo; }
    }
    x.involvedUids = involved({ ...x, hostUid });
    x.codes = x.seats.filter(y => y.code).map(y => y.code);
    tx.update(ref, { seats: x.seats, involvedUids: x.involvedUids, codes: x.codes, hostUid, hostName, hostPhoto,
      ...(late && someoneElseCommitted ? { stoodUp: true } : {}) });
  });
  if (holdToRelease) await stripe().paymentIntents.cancel(holdToRelease).catch(e => logger.warn("hold release", e.message));
  if (loseDeposit) await forfeitDeposit(uid, late ? "Late cancellation" : "Cancelled a date", dateId);
  if (strike) await addStrike(uid, s, "Late cancellation");
  const p = await whisperProfile(uid);
  for (const o of others) await push(o.uid, "Change to your date", `${p.name} canceled ${d.title}. ${d.status === "confirmed" ? "Their seat is paid for, so you can invite someone else free." : "Their seat is open again."}`);
  return { ...summary, done: true };
});

/** Propose moving a confirmed date to another night of the same package (once, 48h+ ahead, everyone agrees). */
exports.proposeReschedule = onCall(async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const { dateId, ticketId } = req.data || {};
  const ref = db.doc(`dates/${dateId}`);
  const d = (await ref.get()).data();
  if (!d || d.status !== "confirmed" || !d.seats.some(x => x.uid === uid && attending(x))) fail("permission-denied", "Only people on a confirmed date can reschedule it.");
  if (d.rescheduled) fail("failed-precondition", "This date was already rescheduled once.");
  if (ms(d.startsAt) - Date.now() < s.rescheduleCutoffHours * 3600000) fail("failed-precondition", `Rescheduling closes ${s.rescheduleCutoffHours} hours before the date.`);
  const t = (await db.doc(`tickets/${ticketId}`).get()).data();
  if (!t || t.venueId !== d.venueId || t.size !== d.size || t.price !== d.total || t.status !== "live" || t.adminHidden) fail("invalid-argument", "Pick another date of the same package at the same venue and price.");
  if (ms(t.startsAt) - Date.now() < s.rescheduleCutoffHours * 3600000) fail("invalid-argument", `The new date has to be at least ${s.rescheduleCutoffHours} hours away.`);
  if (t.quantity - t.sold - t.held < 1) fail("resource-exhausted", "That night is sold out.");
  const proposal = { ticketId, startsAt: t.startsAt, by: uid, approvals: [uid], at: nowTs() };
  await ref.update({ reschedule: proposal });
  const p = await whisperProfile(uid);
  for (const x of d.seats.filter(y => attending(y) && y.uid !== uid)) await push(x.uid, "Reschedule request", `${p.name} wants to move ${d.title} to ${fmtWhen(t.startsAt)}. Open Dates to answer.`);
  return { ok: true };
});

exports.answerReschedule = onCall(async req => {
  const uid = requireUser(req);
  const { dateId, approve } = req.data || {};
  const ref = db.doc(`dates/${dateId}`);
  let moved = false, d;
  await db.runTransaction(async tx => {
    d = (await tx.get(ref)).data();
    if (!d?.reschedule) fail("failed-precondition", "There's no reschedule request.");
    if (!d.seats.some(x => x.uid === uid && attending(x))) fail("permission-denied", "You're not on this date.");
    if (!approve) { tx.update(ref, { reschedule: FieldValue.delete() }); return; }
    const approvals = [...new Set([...d.reschedule.approvals, uid])];
    const everyone = d.seats.filter(attending).map(x => x.uid);
    if (!everyone.every(u => approvals.includes(u))) { tx.update(ref, { "reschedule.approvals": approvals }); return; }
    const newRef = db.doc(`tickets/${d.reschedule.ticketId}`);
    const nt = (await tx.get(newRef)).data();
    if (!nt || nt.quantity - nt.sold - nt.held < 1) fail("resource-exhausted", "That night just sold out. Pick another.");
    tx.update(db.doc(`tickets/${d.ticketId}`), { sold: FieldValue.increment(-1) });
    tx.update(newRef, { sold: FieldValue.increment(1) });
    tx.update(ref, { ticketId: d.reschedule.ticketId, startsAt: nt.startsAt, rescheduled: true, reschedule: FieldValue.delete(), rescheduledFrom: d.startsAt });
    moved = true;
  });
  for (const x of d.seats.filter(y => attending(y) && y.uid !== uid)) {
    await push(x.uid, moved ? "Date rescheduled" : approve ? "Reschedule update" : "Reschedule declined",
      moved ? `${d.title} is now ${fmtWhen(d.reschedule.startsAt)}.` : approve ? "Waiting on everyone to agree." : `${d.title} stays on ${fmtWhen(d.startsAt)}.`);
  }
  return { moved };
});

/* ================= payments ================= */

/** When every seat on a split ticket is on hold, charge everyone at once. */
async function maybeCaptureSplit(dateId) {
  const ref = db.doc(`dates/${dateId}`);
  // Claim the capture inside a transaction so two webhooks can't both capture.
  const d = await db.runTransaction(async tx => {
    const x = (await tx.get(ref)).data();
    if (!x || x.status !== "forming" || x.mode !== "split" || x.capturing) return null;
    // Every seat must be on hold (or already charged after an earlier partial capture).
    const ready = x.seats.every(s => s.status === "held" || s.status === "paid" || (s.status === "joined" && s.amount === 0));
    if (!ready) return null;
    tx.update(ref, { capturing: true });
    return x;
  });
  if (!d) return false;
  const seats = [...d.seats];
  let failed = false;
  for (let i = 0; i < seats.length; i++) {
    if (seats[i].status !== "held") continue;
    try { await stripe().paymentIntents.capture(seats[i].paymentIntent); seats[i] = { ...seats[i], status: "paid", paidAt: nowTs() }; }
    catch (e) { failed = true; logger.error("capture failed", dateId, i, e.message); seats[i] = { ...seats[i], status: "pay", paymentIntent: null, captureError: e.message }; }
  }
  if (failed) {
    // Someone's hold failed (expired card etc). Everyone who was charged keeps their seat; that person pays again.
    await ref.update({ seats, capturing: false });
    const bad = seats.filter(s => s.captureError).map(s => s.uid);
    for (const u of bad) await push(u, "Payment didn't go through", `Your card couldn't be charged for ${d.title}. Open Dates to pay again.`);
    return false;
  }
  const x = { ...d, seats };
  await finishConfirm(dateId, x);
  return true;
}

async function finishConfirm(dateId, d) {
  const ref = db.doc(`dates/${dateId}`);
  const patch = confirmPatch(d);
  await db.runTransaction(async tx => {
    tx.update(ref, { ...patch, capturing: false });
    tx.update(db.doc(`tickets/${d.ticketId}`), { held: FieldValue.increment(-1), sold: FieldValue.increment(1) });
  });
  const day = dayKey(new Date());
  await db.doc(`stats/day-${day}`).set({ day, bookings: FieldValue.increment(1), gross: FieldValue.increment(d.total) }, { merge: true });
  await db.doc("stats/totals").set({ bookings: FieldValue.increment(1), gross: FieldValue.increment(d.total) }, { merge: true });
  for (const s of d.seats.filter(attending)) await push(s.uid, "Your date is booked", `${d.title} · ${fmtWhen(d.startsAt)}. Your door code is in Dates.`);
}

async function onSeatPaymentSettled(sess) {
  const { dateId, seatIndex, uid } = sess.metadata || {};
  const i = Number(seatIndex);
  const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id;
  const intent = await stripe().paymentIntents.retrieve(pi);
  const held = intent.status === "requires_capture";
  const paid = intent.status === "succeeded";
  if (!held && !paid) return;
  const ref = db.doc(`dates/${dateId}`);
  let outcome = null;
  await db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data();
    if (!d) return;
    const seat = d.seats[i];
    const stale = !seat || seat.uid !== uid || seat.status !== "pay" || ["canceled", "completed"].includes(d.status);
    if (stale) { outcome = { undo: true }; return; }
    d.seats[i] = { ...seat, status: held ? "held" : "paid", paymentIntent: pi, paidAt: nowTs() };
    const wasLive = d.live;
    d.live = true;
    tx.update(ref, { seats: d.seats, live: true });
    outcome = { d, firstTime: !wasLive };
  });
  if (!outcome) return;
  if (outcome.undo) { // payment for a seat that's no longer theirs: give it straight back
    if (held) await stripe().paymentIntents.cancel(pi).catch(() => {});
    else await stripe().refunds.create({ payment_intent: pi }).catch(() => {});
    return;
  }
  const { d, firstTime } = outcome;
  if (firstTime) {
    for (const s of d.seats.filter(x => x.status === "invited")) {
      await push(s.uid, "You're invited on a date", `${d.hostName} invited you to ${d.title} · ${fmtWhen(d.startsAt)}`);
    }
  }
  if (d.mode === "full" && d.status === "forming" && d.seats[0].status === "paid") await finishConfirm(dateId, d);
  else if (d.mode === "full" && d.status === "confirmed") { issueCodes(d); await ref.update({ seats: d.seats, codes: d.codes }); }
  else if (d.mode === "split") await maybeCaptureSplit(dateId);
}

exports.nightsStripeWebhook = onRequest({ secrets: [STRIPE_SECRET, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  let event;
  try {
    event = stripe().webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET.value());
  } catch (e) { res.status(400).send("Bad signature"); return; }
  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (e) {
    logger.error("Webhook handler failed", event.type, e);
    res.status(500).send("Handler error");
  }
});

async function handleStripeEvent(event) {
  const o = event.data.object;
  if (event.type === "account.updated") {
    const q = await db.collection("venues").where("stripeAccountId", "==", o.id).limit(1).get();
    if (!q.empty) await q.docs[0].ref.update({ payoutsEnabled: !!o.payouts_enabled });
    return;
  }
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) return;
  if (o.metadata?.app !== "dates") return; // coin purchases are handled by the main Whisper+me webhook
  if (o.metadata.kind === "deposit") {
    if (o.payment_status !== "paid") return;
    const ref = db.doc(`members/${o.metadata.uid}`);
    const m = (await ref.get()).data();
    if (m?.deposit?.paymentIntent === o.payment_intent) return; // repeat webhook
    await ref.set({ deposit: { status: "active", amount: o.amount_total, paidAt: nowTs(), paymentIntent: o.payment_intent } }, { merge: true });
    await db.collection("ledger").add({ kind: "depositPaid", uid: o.metadata.uid, amount: o.amount_total, at: nowTs() });
    return;
  }
  if (o.metadata.kind === "seat") await onSeatPaymentSettled(o);
}

/* ================= scheduled housekeeping ================= */

/** Settle a finished date: no-shows lose their deposit and get a strike; anyone stood up who checked in gets coins. */
async function settleDate(dateId, s) {
  const ref = db.doc(`dates/${dateId}`);
  const d = await db.runTransaction(async tx => {
    const x = (await tx.get(ref)).data();
    if (!x || x.status !== "confirmed" || x.settled) return null;
    tx.update(ref, { settled: true, status: "completed", completedAt: nowTs(), open: false });
    return x;
  });
  if (!d) return;
  const going = d.seats.filter(attending);
  const showed = going.filter(x => x.checkedInAt);
  const noShows = going.filter(x => !x.checkedInAt);
  // Only penalize when someone actually showed up (otherwise the venue may just not have scanned codes).
  if (showed.length) {
    for (const n of noShows) {
      await forfeitDeposit(n.uid, "Missed a date", dateId);
      await addStrike(n.uid, s, "No-show");
      await push(n.uid, "Missed date", `You didn't check in for ${d.title}. Your deposit was kept and this counts as a strike.`);
    }
    if (noShows.length || d.stoodUp) {
      for (const x of showed) {
        await creditCoins(x.uid, s.stoodUpRewardCoins, "Stood up", dateId);
        await push(x.uid, "Sorry you got stood up", `We added ${s.stoodUpRewardCoins} Whisper coins to your account.`);
      }
    }
  }
  // The venue gets paid now that the date has happened.
  const fee = Math.round(d.total * s.fee / 100);
  await db.doc(`payouts/${dateId}`).set({ venueId: d.venueId, venueName: d.venueName, dateId, code: (d.codes || [])[0] || "", gross: d.total, fee, amount: d.total - fee, status: "due", createdAt: nowTs() });
  const day = dayKey(new Date());
  await db.doc(`stats/day-${day}`).set({ day, fees: FieldValue.increment(fee), noShows: FieldValue.increment(showed.length ? noShows.length : 0) }, { merge: true });
  await db.doc("stats/totals").set({ fees: FieldValue.increment(fee) }, { merge: true });
  await ref.update({ noShowUids: showed.length ? noShows.map(x => x.uid) : [], platformFee: fee });
}

async function housekeeping() {
  const s = await getSettings();
  const now = Date.now();
  const forming = await db.collection("dates").where("status", "==", "forming").limit(500).get();
  for (const doc of forming.docs) {
    const d = doc.data();
    if (!d.live && ms(d.hostPayBy) < now) await dissolveDate(doc.id, "Checkout wasn't finished.");
    else if (ms(d.expiresAt) < now) await dissolveDate(doc.id, "Not everyone paid in time, so nobody was charged.");
  }
  const done = await db.collection("dates").where("status", "==", "confirmed").where("startsAt", "<", fromMs(now - SETTLE_AFTER_HOURS * 3600000)).limit(300).get();
  for (const doc of done.docs) await settleDate(doc.id, s);
}
exports.datesHousekeeping = onSchedule({ schedule: "every 10 minutes", ...withStripe }, housekeeping);

/* ================= triggers ================= */
exports.nightsOnReport = onDocumentCreated("reports/{rid}", async event => {
  const r = event.data?.data();
  if (r?.aboutType === "user") await db.doc(`members/${r.about}`).set({ reportsCount: FieldValue.increment(1) }, { merge: true });
});
exports.nightsOnVenue = onDocumentCreated("venues/{vid}", async event => {
  const v = event.data?.data();
  const s = await getSettings();
  if (v && s.autoApproveVenues && v.docsUploaded) await event.data.ref.update({ status: "approved", approvedAt: nowTs() });
});

/* ================= venue functions ================= */
async function ownedVenue(uid, venueId) {
  const v = await db.doc(`venues/${venueId}`).get();
  if (!v.exists || v.data().ownerUid !== uid) fail("permission-denied", "That isn't your venue.");
  return { id: v.id, ...v.data() };
}

/** Door check-in: every guest has their own code. */
exports.checkIn = onCall(async req => {
  if (!req.auth) fail("unauthenticated", "Sign in first.");
  const code = String(req.data?.code || "").trim().toUpperCase();
  if (!code) fail("invalid-argument", "Enter the code from the guest's ticket.");
  const q = await db.collection("dates").where("codes", "array-contains", code).limit(1).get();
  if (q.empty) fail("not-found", `No ticket matches ${code}. Check the letters and try again.`);
  const doc = q.docs[0], d = doc.data();
  await ownedVenue(req.auth.uid, d.venueId);
  if (d.status !== "confirmed") fail("failed-precondition", `This ticket isn't active (${d.status}).`);
  const i = d.seats.findIndex(x => x.code === code);
  const seat = d.seats[i];
  const already = !!seat.checkedInAt;
  if (!already) { d.seats[i] = { ...seat, checkedInAt: nowTs() }; await doc.ref.update({ seats: d.seats }); }
  return {
    title: d.title, startsAt: ms(d.startsAt), size: d.size, guest: seat.name, already,
    party: d.seats.map(x => ({ name: x.uid ? x.name : "Open seat", here: !!x.checkedInAt || x.code === code }))
  };
});

exports.venueStripeLink = onCall(withStripe, async req => {
  if (!req.auth) fail("unauthenticated", "Sign in first.");
  const v = await ownedVenue(req.auth.uid, req.data?.venueId);
  if (v.status !== "approved") fail("failed-precondition", "Payout setup opens once your venue is approved.");
  let acct = v.stripeAccountId;
  if (!acct) {
    const a = await stripe().accounts.create({ type: "express", country: "US", email: req.auth.token.email || undefined, capabilities: { transfers: { requested: true } }, business_profile: { name: v.name, product_description: `Date packages sold on ${BRAND_NAME}` }, metadata: { venueId: v.id } });
    acct = a.id;
    await db.doc(`venues/${v.id}`).update({ stripeAccountId: acct, payoutsEnabled: false });
  }
  const link = await stripe().accountLinks.create({ account: acct, type: "account_onboarding", refresh_url: `${APP_URL}/nights/venue?stripe=refresh`, return_url: `${APP_URL}/nights/venue?stripe=done` });
  return { url: link.url };
});

exports.venueStripeStatus = onCall(withStripe, async req => {
  if (!req.auth) fail("unauthenticated", "Sign in first.");
  const v = await ownedVenue(req.auth.uid, req.data?.venueId);
  if (!v.stripeAccountId) return { payoutsEnabled: false };
  const a = await stripe().accounts.retrieve(v.stripeAccountId);
  await db.doc(`venues/${v.id}`).update({ payoutsEnabled: !!a.payouts_enabled });
  return { payoutsEnabled: !!a.payouts_enabled };
});

/* ================= admin ================= */
async function setVenueTicketsHidden(venueId, hidden) {
  const q = hidden
    ? await db.collection("tickets").where("venueId", "==", venueId).where("adminHidden", "==", false).get()
    : await db.collection("tickets").where("venueId", "==", venueId).where("hiddenReason", "==", "venuePaused").get();
  const batch = db.batch();
  q.docs.forEach(d => batch.update(d.ref, hidden ? { adminHidden: true, hiddenReason: "venuePaused" } : { adminHidden: false, hiddenReason: FieldValue.delete() }));
  await batch.commit();
}

exports.nightsAdminAction = onCall(withStripe, async req => {
  if (!isAdminReq(req)) fail("permission-denied", "Admins only.");
  const { action, id, reason = "", data = {} } = req.data || {};
  const name = async (col, docId) => ((await db.doc(`${col}/${docId}`).get()).data() || {}).name || docId;
  switch (action) {
    case "approveVenue": await db.doc(`venues/${id}`).update({ status: "approved", approvedAt: nowTs() }); await log(req, action, id, await name("venues", id)); return { message: "Venue approved" };
    case "declineVenue": await db.doc(`venues/${id}`).update({ status: "declined", declinedReason: reason || "Didn't meet requirements" }); await log(req, action, id, await name("venues", id)); return { message: "Venue declined" };
    case "pauseVenue": await db.doc(`venues/${id}`).update({ status: "paused", pausedReason: reason || "Paused by admin" }); await setVenueTicketsHidden(id, true); await log(req, action, id, reason); return { message: "Venue paused and its tickets hidden" };
    case "resumeVenue": await db.doc(`venues/${id}`).update({ status: "approved", pausedReason: FieldValue.delete() }); await setVenueTicketsHidden(id, false); await log(req, action, id, await name("venues", id)); return { message: "Venue is back on" };
    case "hideTicket":
    case "showTicket": {
      const hide = action === "hideTicket";
      await db.doc(`tickets/${id}`).update(hide ? { adminHidden: true, hiddenReason: "admin" } : { adminHidden: false, hiddenReason: FieldValue.delete() });
      await log(req, action, id); return { message: hide ? "Ticket hidden" : "Ticket is for sale again" };
    }
    case "verifyMember": await db.doc(`members/${id}`).update({ verified: true, verifiedAt: nowTs() }); await log(req, action, id, await name("members", id)); return { message: "ID approved" };
    case "rejectId": await db.doc(`members/${id}`).update({ idUploaded: false, idRejected: true }); await log(req, action, id); return { message: "Asked them to upload a new ID" };
    case "suspendMember": await db.doc(`members/${id}`).update({ suspendedUntil: fromMs(Date.now() + 3650 * 86400000), suspendedReason: reason || "Suspended by admin" }); await log(req, action, id, reason); return { message: "Blocked from Dates" };
    case "unsuspendMember": await db.doc(`members/${id}`).update({ suspendedUntil: null, strikes: 0, suspendedReason: FieldValue.delete() }); await log(req, action, id); return { message: "Break lifted and strikes cleared" };
    case "refundDeposit": {
      const ref = db.doc(`members/${id}`);
      const m = (await ref.get()).data();
      if (m?.deposit?.status !== "active") fail("failed-precondition", "There's no active deposit to refund.");
      await stripe().refunds.create({ payment_intent: m.deposit.paymentIntent });
      await ref.update({ "deposit.status": "none", "deposit.refundedAt": nowTs() });
      await db.collection("ledger").add({ kind: "depositRefunded", uid: id, amount: m.deposit.amount || 0, at: nowTs() });
      await log(req, action, id, m.name || ""); return { message: "Deposit refunded" };
    }
    case "cancelDate": { // e.g. the venue can't host it: full refunds, no penalties
      const ok = await dissolveDate(id, reason || "Canceled by Whisper+me support. Everyone is refunded.", { refundCaptured: true });
      await db.doc(`payouts/${id}`).delete().catch(() => {});
      await log(req, action, id, reason); return { message: ok ? "Date canceled; holds released and payments refunded" : "Already canceled" };
    }
    case "resolveReport": {
      const ref = db.doc(`reports/${id}`); const r = (await ref.get()).data();
      if (!r) fail("not-found", "Report not found.");
      const decision = data.decision;
      if (decision === "suspend") {
        if (r.aboutType === "user") await db.doc(`members/${r.about}`).set({ suspendedUntil: fromMs(Date.now() + 3650 * 86400000), suspendedReason: r.reason }, { merge: true });
        else { await db.doc(`venues/${r.about}`).update({ status: "paused", pausedReason: r.reason }); await setVenueTicketsHidden(r.about, true); }
      }
      if (decision === "warn" && r.aboutType === "user") await push(r.about, "Message from Whisper+me", data.message || "We got a report about a date. Please follow the community rules.");
      const label = { dismiss: "Dismissed", warn: "Warning sent", suspend: r.aboutType === "user" ? "Blocked from Dates" : "Venue paused" }[decision];
      if (!label) fail("invalid-argument", "Pick dismiss, warn or suspend.");
      await ref.update({ status: label, resolvedAt: nowTs() });
      await log(req, action, id, `${label}: ${r.reason}`); return { message: label };
    }
    case "payVenue":
    case "markVenuePaid": {
      const v = (await db.doc(`venues/${id}`).get()).data();
      if (!v) fail("not-found", "Venue not found.");
      const due = await db.collection("payouts").where("venueId", "==", id).where("status", "==", "due").get();
      const amount = due.docs.reduce((a, x) => a + x.data().amount, 0);
      if (!amount) return { message: "Nothing due for this venue" };
      let transferId = null;
      if (action === "payVenue") {
        if (!v.stripeAccountId || !v.payoutsEnabled) fail("failed-precondition", `${v.name} hasn't finished payout setup. Use "Mark paid" if you paid them another way.`);
        transferId = (await stripe().transfers.create({ amount, currency: "usd", destination: v.stripeAccountId, metadata: { venueId: id } })).id;
      }
      const batch = db.batch();
      due.docs.forEach(x => batch.update(x.ref, { status: "paid", paidAt: nowTs(), transferId, method: transferId ? "stripe" : "manual" }));
      await batch.commit();
      await log(req, action, id, `${v.name} ${fmtMoney(amount)}`); return { message: `Paid ${fmtMoney(amount)} to ${v.name}` };
    }
    case "saveSettings": {
      const n = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
      const s = {
        fee: n(data.fee, 0, 50), depositCents: n(data.depositCents, 100, 5000), splitWindowHours: n(data.splitWindowHours, 1, 72),
        minAge: n(data.minAge, 18, 25), stoodUpRewardCoins: n(data.stoodUpRewardCoins, 0, 20), strikesForSuspension: n(data.strikesForSuspension, 1, 10),
        suspensionDays: n(data.suspensionDays, 1, 90), lateCancelHours: n(data.lateCancelHours, 1, 168), rescheduleCutoffHours: n(data.rescheduleCutoffHours, 1, 168),
        requireIdVerify: !!data.requireIdVerify, openRequests: !!data.openRequests, autoApproveVenues: !!data.autoApproveVenues
      };
      if (Object.values(s).some(v => typeof v === "number" && Number.isNaN(v))) fail("invalid-argument", "Every number setting needs a number.");
      await db.doc("settings/platform").set(s, { merge: true });
      await log(req, action, "settings", `fee ${s.fee}%, deposit ${fmtMoney(s.depositCents)}, reward ${s.stoodUpRewardCoins} coins`);
      return { message: "Settings saved" };
    }
    default: fail("invalid-argument", `Unknown action: ${action}`);
  }
});

// Test hooks (only when running the local test script; never part of a deploy).
if (process.env.DATES_TEST) {
  module.exports.__test = { setStripe: s => { _stripe = s; }, handleStripeEvent, housekeeping, settleDate, getSettings, CATEGORIES };
}
