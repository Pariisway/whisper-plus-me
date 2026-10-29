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
 *  - Late cancel (inside 48h) or no-show = a strike. 2 strikes = 3-day break from M&G.
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
const BRAND_NAME = "Whisper+Me M&G";
const ADMIN_UIDS = ["v6aIXY12MDY9ci1wWJmCiLOAKoG2"]; // same admin as database.rules.json

let _stripe;
const stripe = () => (_stripe ||= new Stripe(STRIPE_SECRET.value()));
const withStripe = { secrets: [STRIPE_SECRET] };

const DEFAULT_SETTINGS = {
  fee: 10,                    // platform fee, % of each ticket (taken from the venue payout)
  depositCents: 500,          // the $5 M&G booking deposit
  splitWindowHours: 24,       // time a split group has to fill and pay
  minAge: 21,
  requireIdVerify: false,
  stoodUpRewardCoins: 1,      // Whisper coin(s) for someone who was stood up and checked in
  strikesForSuspension: 2,
  suspensionDays: 3,
  lateCancelHours: 48,        // cancelling inside this window counts as standing someone up
  rescheduleCutoffHours: 48,
  openRequests: true,         // members may post "find me an M&G" and request to join
  autoApproveVenues: false,
  hostFee: 10                 // % the site keeps from each hosted M&G spot
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
    fail("permission-denied", "Create a free account to go on M&Gs.");
  }
  return req.auth.uid;
}

async function getMember(uid) {
  const snap = await db.doc(`members/${uid}`).get();
  return snap.exists ? { id: uid, ...snap.data() } : null;
}

/** Everything someone needs before they can host, accept, request or join. */
function checkCanDate(m, s) {
  if (!m) fail("failed-precondition", "Set up M&G first (it takes a few seconds).");
  if (m.suspendedUntil && ms(m.suspendedUntil) > Date.now()) {
    fail("failed-precondition", `You're on a break from M&G until ${fmtWhen(m.suspendedUntil)} because of 2 missed M&Gs.`);
  }
  // No deposit yet (or the last one was kept)? It's added to this person's checkout instead.
  if (s.requireIdVerify && !m.verified) {
    fail("failed-precondition", m.idUploaded ? "Your ID is still being reviewed." : "Upload a photo ID in M&G before your first M&G.");
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

const hasDeposit = m => !!(m && m.deposit && m.deposit.status === "active");
async function depositDueFor(uid) { const s = await getSettings(); return hasDeposit(await getMember(uid)) ? 0 : s.depositCents; }
async function activateDeposit(uid, amount, pi) {
  const ref = db.doc(`members/${uid}`);
  const m = (await ref.get()).data();
  if (hasDeposit(m) || m?.deposit?.paymentIntent === pi) return;
  await ref.set({ deposit: { status: "active", amount, paidAt: nowTs(), paymentIntent: pi, withSeat: true } }, { merge: true });
  await db.collection("ledger").add({ kind: "depositPaid", uid, amount, withSeat: true, at: nowTs() });
}

/* ---------- Stripe ---------- */
async function checkoutFor({ kind, uid, email, amount, name, description, dateId = "", seatIndex = -1, hold = false, deposit = 0 }) {
  const meta = { app: "dates", kind, uid, dateId, seatIndex: String(seatIndex), deposit: String(deposit || 0) };
  const items = [];
  if (amount > 0) items.push({ quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: { name, description } } });
  if (deposit > 0) items.push({ quantity: 1, price_data: { currency: "usd", unit_amount: deposit, product_data: { name: "M&G deposit (one time)", description: "Stays on your account for every future date. Only kept if you cancel late or don't show up." } } });
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer_email: email || undefined,
    line_items: items,
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
  const deposit = await depositDueFor(seat.uid);
  if (!(seat.amount > 0) && !deposit) fail("failed-precondition", "Nothing to pay on this M&G.");
  return checkoutFor({
    kind: "seat", uid: seat.uid, email, amount: seat.amount, dateId, seatIndex: i, hold: split, deposit,
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
      else if (s.status === "paid" && s.amount > 0 && (d.status === "forming" || refundCaptured)) { await stripe().refunds.create({ payment_intent: s.paymentIntent, amount: s.amount }); seats[i] = { ...s, status: "refunded" }; }
    } catch (e) { logger.error("release/refund failed", dateId, i, e.message); seats[i] = { ...s, moneyError: e.message }; }
  }
  // Also release any seat payment that was mid-checkout or paid but superseded.
  await ref.update({ seats });
  for (const uid of involved(d)) await push(uid, "M&G canceled", `${d.title}: ${reason}`);
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
  if (new Date().getFullYear() - birthYear < s.minAge) fail("failed-precondition", `M&G is for people ${s.minAge} and older.`);
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
  if (!m) fail("failed-precondition", "Set up M&G first.");
  if (m.deposit?.status === "active") fail("already-exists", "Your deposit is already on your account.");
  return { url: await checkoutFor({ kind: "deposit", uid, email: req.auth.token.email, amount: s.depositCents, name: `${BRAND_NAME} deposit`, description: "Stays on your account for every M&G. Kept if you cancel or miss an M&G." }) };
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
  if (!d || ["canceled", "completed"].includes(d.status)) fail("failed-precondition", "This M&G is no longer active.");
  const i = d.seats.findIndex(x => x.uid === uid && x.status === "pay");
  if (i < 0) fail("failed-precondition", "Nothing to pay on this M&G.");
  if (i === 0 && !d.live) await db.doc(`dates/${dateId}`).update({ hostPayBy: fromMs(Date.now() + HOST_PAY_MINUTES * 60000) });
  return { url: await seatCheckout(dateId, d, i, req.auth.token.email) };
});

/** Accept or decline an invite from the host. */
exports.answerInvite = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const { dateId, accept } = req.data || {};
  const ref = db.doc(`dates/${dateId}`);
  const meM = accept ? await getMember(uid) : null;
  if (accept) checkCanDate(meM, s);
  let d, i;
  await db.runTransaction(async tx => {
    d = (await tx.get(ref)).data();
    if (!d || !d.live || !["forming", "confirmed"].includes(d.status)) fail("failed-precondition", "This invite has expired.");
    i = d.seats.findIndex(x => x.uid === uid && x.status === "invited");
    if (i < 0) fail("failed-precondition", "You've already answered this invite.");
    if (accept) {
      // On a paid-in-full ticket the seat is already covered.
      d.seats[i] = { ...d.seats[i], status: d.seats[i].amount > 0 || !hasDeposit(meM) ? "pay" : "joined", answeredAt: nowTs() };
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

/** "Find me an M&G": ask to join someone's open date. */
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
    if (!d || !d.live || !d.open || !["forming", "confirmed"].includes(d.status)) fail("failed-precondition", "This M&G isn't taking requests anymore.");
    if (d.involvedUids.includes(uid)) fail("already-exists", "You're already on this M&G or have asked to join.");
    if (!d.seats.some(x => x.status === "open")) fail("resource-exhausted", "This M&G is full.");
    if ((d.requests || []).length >= 20) fail("resource-exhausted", "This M&G has plenty of requests already.");
    d.requests = [...(d.requests || []), { uid, name: me.name, photo: me.photo, at: nowTs() }];
    d.involvedUids = involved(d);
    tx.update(ref, { requests: d.requests, involvedUids: d.involvedUids });
  });
  await push(d.hostUid, "Someone wants to join your M&G", `${me.name} asked to join ${d.title}`);
  return { ok: true };
});

/** Host approves or turns down a request. */
exports.answerRequest = onCall(async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const { dateId, memberUid, approve } = req.data || {};
  const ref = db.doc(`dates/${dateId}`);
  const reqM = approve ? await getMember(memberUid) : null;
  if (approve) checkCanDate(reqM, s);
  let d;
  await db.runTransaction(async tx => {
    d = (await tx.get(ref)).data();
    if (!d || d.hostUid !== uid) fail("permission-denied", "Only the host can answer requests.");
    const r = (d.requests || []).find(x => x.uid === memberUid);
    if (!r) fail("not-found", "That request is gone.");
    d.requests = d.requests.filter(x => x.uid !== memberUid);
    if (approve) {
      const i = d.seats.findIndex(x => x.status === "open");
      if (i < 0) fail("resource-exhausted", "Your M&G is already full.");
      d.seats[i] = { uid: memberUid, name: r.name, photo: r.photo, status: d.seats[i].amount > 0 || !hasDeposit(reqM) ? "pay" : "joined", amount: d.seats[i].amount, invited: false, answeredAt: nowTs() };
      if (d.status === "confirmed") issueCodes(d);
      if (!d.seats.some(x => x.status === "open")) d.requests = [];
    }
    d.involvedUids = involved(d);
    tx.update(ref, { seats: d.seats, requests: d.requests, involvedUids: d.involvedUids, codes: d.codes || [] });
  });
  await push(memberUid, approve ? "You're in!" : "Request not accepted", approve
    ? `${d.hostName} picked you for ${d.title}.${d.mode === "split" ? " Pay your share in M&G to lock it in." : hasDeposit(reqM) ? "" : " Add your deposit in M&G to lock it in."}`
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
    if (!["forming", "confirmed"].includes(d.status)) fail("failed-precondition", "This M&G is no longer active.");
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
  for (const g of Object.keys(profiles)) await push(g, "You're invited to an M&G", `${d.hostName} invited you to ${d.title} · ${fmtWhen(d.startsAt)}`);
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
  if (!d || !["forming", "confirmed"].includes(d.status)) fail("failed-precondition", "This M&G is no longer active.");
  const i = d.seats.findIndex(x => x.uid === uid && x.status !== "open");
  if (i < 0) fail("failed-precondition", "You're not on this M&G.");
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
  if (hostEndsIt) lines.push(someoneElseCommitted ? "The whole M&G is canceled for everyone. Card holds are released, so nobody is charged." : "Your M&G is canceled and your card hold is released. Nobody is charged.");
  if (loseDeposit) lines.push(`You lose your ${fmtMoney(m.deposit.amount || s.depositCents)} deposit and need a new one before your next M&G.`);
  if (loseTicket) lines.push(`Your ${fmtMoney(loseTicket)} share of the ticket is not refunded.${canReschedule ? " Rescheduling instead keeps it." : ""}`);
  if (me.status === "held") lines.push("Your card hold is released. You won't be charged for the ticket.");
  if (strike) lines.push(strikesNow >= s.strikesForSuspension
    ? `This is a missed M&G (strike ${strikesNow} of ${s.strikesForSuspension}), so you'll be on a ${s.suspensionDays}-day break from M&G.`
    : `This counts as a missed M&G: strike ${strikesNow} of ${s.strikesForSuspension}. At ${s.strikesForSuspension} you get a ${s.suspensionDays}-day break from M&G.`);
  if (late && someoneElseCommitted && s.stoodUpRewardCoins) lines.push(`If the other person still shows up, they get ${s.stoodUpRewardCoins} Whisper coin${s.stoodUpRewardCoins === 1 ? "" : "s"}.`);
  if (!lines.length) lines.push("You can leave this M&G. Nothing is charged and you keep your deposit.");
  const summary = { lines, loseDeposit, loseTicket, strike, canReschedule, hostEndsIt, hoursLeft: Math.round(hoursLeft) };
  if (preview) return summary;

  if (hostEndsIt) {
    await dissolveDate(dateId, "The host canceled.");
    if (loseDeposit) await forfeitDeposit(uid, "Host canceled an M&G others had joined", dateId);
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
  if (loseDeposit) await forfeitDeposit(uid, late ? "Late cancellation" : "Cancelled an M&G", dateId);
  if (strike) await addStrike(uid, s, "Late cancellation");
  const p = await whisperProfile(uid);
  for (const o of others) await push(o.uid, "Change to your M&G", `${p.name} canceled ${d.title}. ${d.status === "confirmed" ? "Their seat is paid for, so you can invite someone else free." : "Their seat is open again."}`);
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
  if (d.rescheduled) fail("failed-precondition", "This M&G was already rescheduled once.");
  if (ms(d.startsAt) - Date.now() < s.rescheduleCutoffHours * 3600000) fail("failed-precondition", `Rescheduling closes ${s.rescheduleCutoffHours} hours before the M&G.`);
  const t = (await db.doc(`tickets/${ticketId}`).get()).data();
  if (!t || t.venueId !== d.venueId || t.size !== d.size || t.price !== d.total || t.status !== "live" || t.adminHidden) fail("invalid-argument", "Pick another date of the same package at the same venue and price.");
  if (ms(t.startsAt) - Date.now() < s.rescheduleCutoffHours * 3600000) fail("invalid-argument", `The new date has to be at least ${s.rescheduleCutoffHours} hours away.`);
  if (t.quantity - t.sold - t.held < 1) fail("resource-exhausted", "That night is sold out.");
  const proposal = { ticketId, startsAt: t.startsAt, by: uid, approvals: [uid], at: nowTs() };
  await ref.update({ reschedule: proposal });
  const p = await whisperProfile(uid);
  for (const x of d.seats.filter(y => attending(y) && y.uid !== uid)) await push(x.uid, "Reschedule request", `${p.name} wants to move ${d.title} to ${fmtWhen(t.startsAt)}. Open M&G to answer.`);
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
    if (!d.seats.some(x => x.uid === uid && attending(x))) fail("permission-denied", "You're not on this M&G.");
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
    try {
      await stripe().paymentIntents.capture(seats[i].paymentIntent); seats[i] = { ...seats[i], status: "paid", paidAt: nowTs() };
      if (seats[i].depositIncluded) await activateDeposit(seats[i].uid, seats[i].depositIncluded, seats[i].paymentIntent);
    }
    catch (e) { failed = true; logger.error("capture failed", dateId, i, e.message); seats[i] = { ...seats[i], status: "pay", paymentIntent: null, captureError: e.message }; }
  }
  if (failed) {
    // Someone's hold failed (expired card etc). Everyone who was charged keeps their seat; that person pays again.
    await ref.update({ seats, capturing: false });
    const bad = seats.filter(s => s.captureError).map(s => s.uid);
    for (const u of bad) await push(u, "Payment didn't go through", `Your card couldn't be charged for ${d.title}. Open M&G to pay again.`);
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
  for (const s of d.seats.filter(attending)) await push(s.uid, "Your M&G is booked", `${d.title} · ${fmtWhen(d.startsAt)}. Your door code is in M&G.`);
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
    const dep = Number(sess.metadata.deposit || 0);
    d.seats[i] = { ...seat, status: held ? "held" : (seat.amount > 0 ? "paid" : "joined"), paymentIntent: pi, paidAt: nowTs(), ...(dep ? { depositIncluded: dep } : {}) };
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
  const depPaid = Number(sess.metadata.deposit || 0);
  if (depPaid && paid) await activateDeposit(uid, depPaid, pi);
  if (firstTime) {
    for (const s of d.seats.filter(x => x.status === "invited")) {
      await push(s.uid, "You're invited to an M&G", `${d.hostName} invited you to ${d.title} · ${fmtWhen(d.startsAt)}`);
    }
  }
  if (d.mode === "full" && d.status === "forming" && d.seats[0].status === "paid") await finishConfirm(dateId, d);
  else if (d.mode === "full" && d.status === "confirmed") { issueCodes(d); await ref.update({ seats: d.seats, codes: d.codes }); }
  else if (d.mode === "split" && d.seats[i].status === "joined") await maybeCaptureSplit(dateId);
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
  if (o.metadata.kind === "meetup") await onMeetupPaid(o);
  if (o.metadata.kind === "hostdeposit") await onHostDepositPaid(o);
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
      await forfeitDeposit(n.uid, "Missed an M&G", dateId);
      await addStrike(n.uid, s, "No-show");
      await push(n.uid, "Missed M&G", `You didn't check in for ${d.title}. Your deposit was kept and this counts as a strike.`);
    }
    if (noShows.length || d.stoodUp) {
      for (const x of showed) {
        await creditCoins(x.uid, s.stoodUpRewardCoins, "Stood up", dateId);
        await push(x.uid, "Sorry you got stood up", `We added ${s.stoodUpRewardCoins} Whisper coin${s.stoodUpRewardCoins === 1 ? "" : "s"} to your account.`);
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
  await meetupHousekeeping(s);
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

const TICKET_CATS = ["Dinner", "Activities", "Concerts", "Movies", "Other"];
function adminTicket(d) {
  const title = String(d.title || "").trim().slice(0, 80);
  const items = (Array.isArray(d.items) ? d.items : []).map(x => String(x || "").trim().slice(0, 60)).filter(Boolean).slice(0, 12);
  const size = Number(d.size), price = Math.round(Number(d.price) * 100), quantity = Math.round(Number(d.quantity)), startsAt = Number(d.startsAt);
  if (!title) fail("invalid-argument", "Give the ticket a name.");
  if (!TICKET_CATS.includes(d.category)) fail("invalid-argument", "Pick a category.");
  if (!items.length) fail("invalid-argument", "List at least one thing that's included.");
  if (![2, 4].includes(size)) fail("invalid-argument", "Tickets are for 2 or 4 people.");
  if (!(price >= 500)) fail("invalid-argument", "The price has to be at least $5.");
  if (!(quantity >= 1 && quantity <= 500)) fail("invalid-argument", "How many can be sold? 1 to 500.");
  if (!(startsAt > Date.now() + 3 * 3600000)) fail("invalid-argument", "Pick a date and time at least 3 hours from now.");
  const imageURL = /^https:\/\//.test(d.imageURL || "") ? String(d.imageURL).slice(0, 600) : "";
  let hue = 0; title.split("").forEach(c => { hue = (hue * 31 + c.charCodeAt(0)) % 360; });
  return { venueId: String(d.venueId || ""), title, category: d.category, items, size, price, quantity, startsAt: fromMs(startsAt), note: String(d.note || "").trim().slice(0, 300), imageURL, hue };
}

exports.nightsAdminAction = onCall(withStripe, async req => {
  if (!isAdminReq(req)) fail("permission-denied", "Admins only.");
  const { action, id, reason = "", data = {} } = req.data || {};
  const name = async (col, docId) => ((await db.doc(`${col}/${docId}`).get()).data() || {}).name || docId;
  switch (action) {
    case "approveVenue": await db.doc(`venues/${id}`).update({ status: "approved", approvedAt: nowTs() }); await log(req, action, id, await name("venues", id)); return { message: "Venue approved" };
    case "declineVenue": await db.doc(`venues/${id}`).update({ status: "declined", declinedReason: reason || "Didn't meet requirements" }); await log(req, action, id, await name("venues", id)); return { message: "Venue declined" };
    case "pauseVenue": await db.doc(`venues/${id}`).update({ status: "paused", pausedReason: reason || "Paused by admin" }); await setVenueTicketsHidden(id, true); await log(req, action, id, reason); return { message: "Venue paused and its tickets hidden" };
    case "removeVenue": { // kept on file for past bookings and payouts, gone from everywhere else
      await db.doc(`venues/${id}`).update({ status: "removed", removedAt: nowTs() });
      await setVenueTicketsHidden(id, true);
      await log(req, action, id, await name("venues", id));
      return { message: "Venue removed and its tickets hidden" };
    }
    case "deleteVenue": { // gone from the admin dashboard, still saved in the database
      await db.doc(`venues/${id}`).update({ status: "removed", adminDeleted: true, deletedAt: nowTs() });
      await setVenueTicketsHidden(id, true);
      await log(req, action, id, await name("venues", id));
      return { message: "Venue deleted from the dashboard" };
    }
    case "editVenue": {
      const ref = db.doc(`venues/${id}`), cur = (await ref.get()).data();
      if (!cur) fail("not-found", "Venue not found.");
      const str = (v, max) => String(v || "").trim().slice(0, max);
      const up = { name: str(data.name, 60), type: str(data.type, 30) || "Other", city: str(data.city, 60), address: str(data.address, 120), phone: str(data.phone, 20), description: str(data.description, 500) };
      if (!up.name || !up.city) fail("invalid-argument", "Add the venue's name and city.");
      await ref.update(up);
      if (up.name !== cur.name) { // keep ticket cards in step
        const q = await db.collection("tickets").where("venueId", "==", id).get();
        const batch = db.batch(); q.docs.forEach(x => batch.update(x.ref, { venueName: up.name })); await batch.commit();
      }
      await log(req, action, id, up.name);
      return { message: `${up.name} updated` };
    }
    case "editTicket": {
      const ref = db.doc(`tickets/${id}`), cur = (await ref.get()).data();
      if (!cur) fail("not-found", "Ticket not found.");
      const booked = (cur.sold || 0) + (cur.held || 0);
      const curStart = ms(cur.startsAt);
      const t = adminTicket({ ...data, venueId: cur.venueId, startsAt: Number(data.startsAt) === curStart ? Date.now() + 4 * 3600000 : data.startsAt }); // only re-check the time if it changed
      const up = { title: t.title, category: t.category, items: t.items, note: t.note, imageURL: t.imageURL, hue: t.hue };
      if (t.quantity < booked) fail("invalid-argument", `Can't go below the ${booked} already sold or held.`);
      up.quantity = t.quantity;
      const changing = t.price !== cur.price || t.size !== cur.size || Number(data.startsAt) !== curStart;
      if (changing && booked) fail("failed-precondition", "People already booked this one, so the price, group size and date can't change. Stop selling it and post a new ticket instead.");
      if (Number(data.startsAt) !== curStart) up.startsAt = t.startsAt;
      up.price = t.price; up.size = t.size;
      await ref.update(up);
      await log(req, action, id, t.title);
      return { message: `“${t.title}” updated` };
    }
    case "approveMeetup": {
      const x = (await mtRef(id).get()).data();
      if (!x || !["pending", "changes"].includes(x.status)) fail("failed-precondition", "Only M&Gs waiting for review can be approved.");
      await mtRef(id).update({ status: "live", approvedAt: nowTs(), changesNote: FieldValue.delete() });
      await push(x.hostUid, "Your M&G is live!", `${x.title} is on sale now. Share your link.`);
      await log(req, action, id, x.title); return { message: "Approved. It's on sale now." };
    }
    case "requestMeetupChanges": {
      const x = (await mtRef(id).get()).data();
      if (!x || !["pending", "live"].includes(x.status)) fail("failed-precondition", "Can't ask for changes right now.");
      if (!str(reason, 500)) fail("invalid-argument", "Say what needs to change.");
      await mtRef(id).update({ status: "changes", changesNote: str(reason, 500) });
      await push(x.hostUid, "Your M&G needs a change", str(reason, 140));
      await log(req, action, id, reason); return { message: "Sent to the host." };
    }
    case "rejectMeetup": {
      const x = (await mtRef(id).get()).data();
      if (!x) fail("not-found", "Not found.");
      await refundMeetup(id, reason || "It wasn't approved.");
      await mtRef(id).update({ status: "rejected", rejectedReason: str(reason, 300) });
      await releaseHostDeposit(id, x, "Not approved");
      await push(x.hostUid, "Your M&G wasn't approved", str(reason, 140) || "Contact support for details.");
      await log(req, action, id, reason); return { message: "Rejected. The host's deposit was returned." };
    }
    case "payMeetupHost": {
      const x = (await mtRef(id).get()).data();
      if (!x || !["review", "live"].includes(x.status)) fail("failed-precondition", "Nothing to pay.");
      const n = await payHost(id, x, await getSettings());
      await log(req, action, id, fmtMoney(n)); return { message: `Paid the host ${fmtMoney(n)}.` };
    }
    case "cancelMeetup": {
      const x = (await mtRef(id).get()).data();
      const n = await refundMeetup(id, reason || "Canceled by Whisper+Me.");
      if (x && data.keepDeposit) { await keepHostDeposit(id, x, "Host no-show (admin)"); await addStrike(x.hostUid, await getSettings(), "Missed their M&G"); }
      else if (x) await releaseHostDeposit(id, x, "Canceled by admin");
      await log(req, action, id, reason); return { message: `Canceled. ${n || 0} buyer(s) refunded.${data.keepDeposit ? " Host deposit kept." : ""}` };
    }
    case "hideMeetup":
    case "showMeetup": { await mtRef(id).update({ hidden: action === "hideMeetup" }); await log(req, action, id); return { message: action === "hideMeetup" ? "M&G paused" : "M&G is back on sale" }; }
    case "resumeVenue": await db.doc(`venues/${id}`).update({ status: "approved", pausedReason: FieldValue.delete() }); await setVenueTicketsHidden(id, false); await log(req, action, id, await name("venues", id)); return { message: "Venue is back on" };
    case "hideTicket":
    case "showTicket": {
      const hide = action === "hideTicket";
      await db.doc(`tickets/${id}`).update(hide ? { adminHidden: true, hiddenReason: "admin" } : { adminHidden: false, hiddenReason: FieldValue.delete() });
      await log(req, action, id); return { message: hide ? "Ticket hidden" : "Ticket is for sale again" };
    }
    case "verifyMember": await db.doc(`members/${id}`).update({ verified: true, verifiedAt: nowTs() }); await log(req, action, id, await name("members", id)); return { message: "ID approved" };
    case "rejectId": await db.doc(`members/${id}`).update({ idUploaded: false, idRejected: true }); await log(req, action, id); return { message: "Asked them to upload a new ID" };
    case "suspendMember": await db.doc(`members/${id}`).update({ suspendedUntil: fromMs(Date.now() + 3650 * 86400000), suspendedReason: reason || "Suspended by admin" }); await log(req, action, id, reason); return { message: "Blocked from M&G" };
    case "unsuspendMember": await db.doc(`members/${id}`).update({ suspendedUntil: null, strikes: 0, suspendedReason: FieldValue.delete() }); await log(req, action, id); return { message: "Break lifted and strikes cleared" };
    case "refundDeposit": {
      const ref = db.doc(`members/${id}`);
      const m = (await ref.get()).data();
      if (m?.deposit?.status !== "active") fail("failed-precondition", "There's no active deposit to refund.");
      await stripe().refunds.create({ payment_intent: m.deposit.paymentIntent, ...(m.deposit.amount ? { amount: m.deposit.amount } : {}) });
      await ref.update({ "deposit.status": "none", "deposit.refundedAt": nowTs() });
      await db.collection("ledger").add({ kind: "depositRefunded", uid: id, amount: m.deposit.amount || 0, at: nowTs() });
      await log(req, action, id, m.name || ""); return { message: "Deposit refunded" };
    }
    case "cancelDate": { // e.g. the venue can't host it: full refunds, no penalties
      const ok = await dissolveDate(id, reason || "Canceled by Whisper+me support. Everyone is refunded.", { refundCaptured: true });
      await db.doc(`payouts/${id}`).delete().catch(() => {});
      await log(req, action, id, reason); return { message: ok ? "M&G canceled; holds released and payments refunded" : "Already canceled" };
    }
    case "resolveReport": {
      const ref = db.doc(`reports/${id}`); const r = (await ref.get()).data();
      if (!r) fail("not-found", "Report not found.");
      const decision = data.decision;
      if (decision === "suspend") {
        if (r.aboutType === "user") await db.doc(`members/${r.about}`).set({ suspendedUntil: fromMs(Date.now() + 3650 * 86400000), suspendedReason: r.reason }, { merge: true });
        else { await db.doc(`venues/${r.about}`).update({ status: "paused", pausedReason: r.reason }); await setVenueTicketsHidden(r.about, true); }
      }
      if (decision === "warn" && r.aboutType === "user") await push(r.about, "Message from Whisper+Me", data.message || "We got a report about an M&G. Please follow the community rules.");
      const label = { dismiss: "Dismissed", warn: "Warning sent", suspend: r.aboutType === "user" ? "Blocked from M&G" : "Venue paused" }[decision];
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
    /* ---- create venues and tickets right from the main admin ---- */
    case "createVenue": {
      const str = (v, max) => String(v || "").trim().slice(0, max);
      const v = { name: str(data.name, 60), type: str(data.type, 30) || "Other", address: str(data.address, 120), city: str(data.city, 60), phone: str(data.phone, 20), description: str(data.description, 500) };
      if (!v.name || !v.city) fail("invalid-argument", "Add the venue's name and city.");
      const ref = db.collection("venues").doc();
      await ref.set({ ...v, contactName: "", ownerUid: req.auth.uid, ownerEmail: req.auth.token.email || "", status: "approved", sales: 0, docs: [], docsUploaded: false, createdByAdmin: true, createdAt: nowTs(), approvedAt: nowTs() });
      await log(req, action, ref.id, v.name);
      return { message: `${v.name} added`, id: ref.id };
    }
    case "createTicket": {
      const t = adminTicket(data);
      const v = (await db.doc(`venues/${t.venueId}`).get()).data();
      if (!v) fail("not-found", "Pick a venue first.");
      if (v.status !== "approved") fail("failed-precondition", "That venue isn't approved yet.");
      const ref = db.collection("tickets").doc();
      await ref.set({ ...t, venueName: v.name, status: "live", adminHidden: false, sold: 0, held: 0, createdByAdmin: true, createdAt: nowTs() });
      await log(req, action, ref.id, `${t.title} at ${v.name}`);
      return { message: `“${t.title}” is live for everyone`, id: ref.id };
    }
    case "updateTicket": {
      const ref = db.doc(`tickets/${id}`);
      const cur = (await ref.get()).data();
      if (!cur) fail("not-found", "Ticket not found.");
      const up = {};
      if (data.status) { if (!["live", "paused", "ended"].includes(data.status)) fail("invalid-argument", "Bad status."); up.status = data.status; }
      if (data.quantity != null) { const q = Math.round(Number(data.quantity)); if (!(q >= cur.sold + cur.held)) fail("invalid-argument", `Can't go below the ${cur.sold + cur.held} already sold or held.`); up.quantity = q; }
      await ref.update(up);
      await log(req, action, id, JSON.stringify(up));
      return { message: "Ticket updated" };
    }
    case "saveSettings": {
      const n = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
      const s = {
        fee: n(data.fee, 0, 50), depositCents: n(data.depositCents, 100, 5000), splitWindowHours: n(data.splitWindowHours, 1, 72),
        minAge: n(data.minAge, 18, 25), stoodUpRewardCoins: n(data.stoodUpRewardCoins, 0, 20), strikesForSuspension: n(data.strikesForSuspension, 1, 10),
        suspensionDays: n(data.suspensionDays, 1, 90), lateCancelHours: n(data.lateCancelHours, 1, 168), rescheduleCutoffHours: n(data.rescheduleCutoffHours, 1, 168),
        requireIdVerify: !!data.requireIdVerify, openRequests: !!data.openRequests, autoApproveVenues: !!data.autoApproveVenues,
        hostFee: data.hostFee == null ? 10 : n(data.hostFee, 0, 50)
      };
      if (Object.values(s).some(v => typeof v === "number" && Number.isNaN(v))) fail("invalid-argument", "Every number setting needs a number.");
      await db.doc("settings/platform").set(s, { merge: true });
      await log(req, action, "settings", `fee ${s.fee}%, deposit ${fmtMoney(s.depositCents)}, reward ${s.stoodUpRewardCoins} coins`);
      return { message: "Settings saved" };
    }
    default: fail("invalid-argument", `Unknown action: ${action}`);
  }
});

/* ═══════════════════════════════════════════════════════════════
   MEET & GREETS (M&G)
   A member or creator hosts an M&G at any public place and sets a price per
   spot. Flow: host fills it out → pays a host deposit (one spot's price) →
   admin reviews (approve / ask for changes / reject) → it goes on sale.
   The venue's address + phone and the host's contact info are private
   (meetups/{id}/private/info): buyers see the address after they pay.
   At the M&G the host checks guests in with their MG- codes.
   ~3h after the start: guests checked in → host gets price minus the site
   fee for every sold spot and the deposit back. Nobody checked in → it goes
   to the admin to decide (pay the host, or refund buyers and keep the
   deposit). Host cancels late or no-shows → buyers refunded, deposit kept.
═══════════════════════════════════════════════════════════════ */
const MEETUP_PAY_MINUTES = 40;
const mtRef = id => db.doc(`meetups/${id}`);
const mtPrivate = id => db.doc(`meetups/${id}/private/info`);
function newCode() { return makeCode().replace("WN-", "MG-"); }
const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const PHONE_RE = /^[0-9+().\-\s]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanMeetup(d, { forUpdate = false } = {}) {
  const v = d.venue || {};
  const out = {
    title: str(d.title, 80), about: str(d.about, 800), category: CATEGORIES.includes(d.category) ? d.category : "Other",
    items: (Array.isArray(d.items) ? d.items : String(d.items || "").split(/\n|,/)).map(x => str(x, 60)).filter(Boolean).slice(0, 10),
    imageURL: /^https:\/\//.test(d.imageURL || "") ? str(d.imageURL, 600) : "",
    startsAt: Number(d.startsAt), price: Math.round(Number(d.price) * 100), spots: Math.round(Number(d.spots)),
    venue: { name: str(v.name, 80), address: str(v.address, 160), city: str(v.city, 60), phone: str(v.phone, 20), source: v.source === "osm" ? "osm" : "other", osmId: str(v.osmId, 40), lat: Number(v.lat) || null, lon: Number(v.lon) || null },
    contact: { email: str(d.contact && d.contact.email, 120), phone: str(d.contact && d.contact.phone, 20) }
  };
  if (!out.title) fail("invalid-argument", "Give your M&G a name.");
  if (!out.venue.name || !out.venue.address || !out.venue.city) fail("invalid-argument", "Add the place's name, street address and city.");
  if (!PHONE_RE.test(out.venue.phone)) fail("invalid-argument", "Add the place's phone number so we can confirm your booking.");
  if (!EMAIL_RE.test(out.contact.email)) fail("invalid-argument", "Add an email we can reach you at.");
  if (!PHONE_RE.test(out.contact.phone)) fail("invalid-argument", "Add a phone number we can reach you at.");
  if (!(out.startsAt > Date.now() + 24 * 3600000)) fail("invalid-argument", "Pick a time at least 24 hours away, so there's time to review it and sell spots.");
  if (!(out.price >= 500)) fail("invalid-argument", "The price per spot has to be at least $5.");
  if (out.price > 500000) fail("invalid-argument", "That price is too high.");
  if (!(out.spots >= 1 && out.spots <= 500)) fail("invalid-argument", "Spots: 1 to 500.");
  return out;
}
function publicFields(c, host) {
  let hue = 0; c.title.split("").forEach(ch => { hue = (hue * 31 + ch.charCodeAt(0)) % 360; });
  return { title: c.title, about: c.about, category: c.category, items: c.items, imageURL: c.imageURL || host.photo || "", hue,
    startsAt: fromMs(c.startsAt), price: c.price, spots: c.spots, venueName: c.venue.name, city: c.venue.city };
}

/** Host submits a new M&G. Returns a checkout link for the host deposit (one spot's price). */
exports.createMeetup = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const m = await getMember(uid);
  if (!m) fail("failed-precondition", "Set up M&G first (it takes a few seconds).");
  if (m.suspendedUntil && ms(m.suspendedUntil) > Date.now()) fail("failed-precondition", `You're on a break until ${fmtWhen(m.suspendedUntil)}.`);
  const c = cleanMeetup(req.data || {});
  const host = await whisperProfile(uid);
  const ref = db.collection("meetups").doc();
  await ref.set({ ...publicFields(c, host), hostUid: uid, hostName: host.name, hostPhoto: host.photo, sold: 0, held: 0, buyerUids: [],
    hostFeePct: s.hostFee, status: "draft", hidden: false, checkedIn: 0, hostDeposit: { status: "unpaid", amount: c.price }, createdAt: nowTs() });
  await mtPrivate(ref.id).set({ venue: c.venue, contact: c.contact, hostUid: uid });
  await db.doc(`members/${uid}`).set({ hostContact: c.contact }, { merge: true }); // saved for next time
  const url = await checkoutFor({ kind: "hostdeposit", uid, email: c.contact.email || req.auth.token.email, amount: c.price, dateId: ref.id,
    name: `Host deposit · ${c.title}`, description: "Equal to one spot. You get it back after your M&G happens (or if it isn't approved). Kept if you cancel late or don't show up." });
  return { id: ref.id, url };
});

/** Pay the host deposit again (e.g. checkout was closed). */
exports.payHostDeposit = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const id = str(req.data?.meetupId, 64), x = (await mtRef(id).get()).data();
  if (!x || x.hostUid !== uid) fail("permission-denied", "Not your M&G.");
  if (x.status !== "draft") fail("failed-precondition", "The deposit is already paid.");
  const p = (await mtPrivate(id).get()).data() || {};
  return { url: await checkoutFor({ kind: "hostdeposit", uid, email: (p.contact || {}).email || req.auth.token.email, amount: x.price, dateId: id, name: `Host deposit · ${x.title}`, description: "Equal to one spot. Returned after your M&G happens." }) };
});

/** Host edits their M&G. Before any sales everything can change; after, only the description and contact info. */
exports.editMeetup = onCall(async req => {
  const uid = requireUser(req);
  const id = str(req.data?.meetupId, 64), ref = mtRef(id), x = (await ref.get()).data();
  if (!x || x.hostUid !== uid) fail("permission-denied", "Not your M&G.");
  if (!["draft", "pending", "changes", "live"].includes(x.status)) fail("failed-precondition", "This M&G can't be edited anymore.");
  const cur = (await mtPrivate(id).get()).data() || {};
  const sold = (x.sold || 0) + (x.held || 0);
  const d = req.data.data || {};
  const c = cleanMeetup(sold ? { ...d, startsAt: Date.now() + 25 * 3600000, price: x.price / 100, spots: Math.max(x.spots, Number(d.spots) || 0) } : d);
  const host = await whisperProfile(uid);
  const pub = publicFields(c, host);
  if (sold) {
    // Locked once people have paid: time, price and place.
    if (c.venue.name !== cur.venue?.name || c.venue.address !== cur.venue?.address) fail("failed-precondition", "People already bought spots, so the place can't change. Contact support if you need to move it.");
    pub.startsAt = x.startsAt; pub.price = x.price; pub.venueName = x.venueName; pub.city = x.city;
    if (c.spots < sold) fail("invalid-argument", `You've already sold ${sold}.`);
  }
  const major = !sold && (c.price !== x.price || c.startsAt !== ms(x.startsAt) || c.venue.address !== cur.venue?.address || c.venue.name !== cur.venue?.name);
  const status = x.status === "changes" ? "pending" : x.status === "live" && major ? "pending" : x.status;
  await ref.update({ ...pub, status, changesNote: status === "pending" ? FieldValue.delete() : (x.changesNote || FieldValue.delete()), editedAt: nowTs(),
    ...(x.status === "draft" ? { "hostDeposit.amount": c.price } : {}) });
  await mtPrivate(id).set({ venue: sold ? cur.venue : c.venue, contact: c.contact, hostUid: uid });
  await db.doc(`members/${uid}`).set({ hostContact: c.contact }, { merge: true });
  return { message: status === "pending" && x.status !== "pending" ? "Saved and sent for review" : "Saved", status };
});

exports.buyMeetupSpot = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const m = await getMember(uid);
  if (!m) fail("failed-precondition", "Set up M&G first (it takes a few seconds).");
  const id = str(req.data?.meetupId, 64);
  const ref = mtRef(id), spotRef = ref.collection("spots").doc(uid);
  let x;
  await db.runTransaction(async tx => {
    x = (await tx.get(ref)).data();
    if (!x || x.status !== "live" || x.hidden) fail("failed-precondition", "This M&G isn't available.");
    if (x.hostUid === uid) fail("failed-precondition", "You're the host.");
    if (ms(x.startsAt) < Date.now() + 2 * 3600000) fail("failed-precondition", "Sales for this one have closed.");
    const spot = (await tx.get(spotRef)).data();
    if (spot && spot.status === "paid") fail("already-exists", "You already have a spot. Your code is in My M&G.");
    const fresh = spot && spot.status === "pending" && ms(spot.createdAt) > Date.now() - MEETUP_PAY_MINUTES * 60000;
    if (!fresh) {
      if (x.sold + x.held >= x.spots) fail("resource-exhausted", "Sold out.");
      tx.update(ref, { held: FieldValue.increment(1) });
      tx.set(spotRef, { uid, role: "buyer", status: "pending", createdAt: nowTs() });
    }
  });
  const me = await whisperProfile(uid);
  await spotRef.set({ name: me.name, photo: me.photo }, { merge: true });
  const url = await checkoutFor({ kind: "meetup", uid, email: req.auth.token.email, amount: x.price, dateId: id,
    name: `${x.title} · M&G with ${x.hostName}`, description: `${fmtWhen(x.startsAt)} · ${x.venueName}, ${x.city}. The exact address is sent to you after you pay.` });
  return { url };
});

async function onMeetupPaid(sess) {
  const { dateId: id, uid } = sess.metadata || {};
  if (sess.payment_status !== "paid") return;
  const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id;
  const ref = mtRef(id), spotRef = ref.collection("spots").doc(uid);
  let code = null, undo = false, x;
  await db.runTransaction(async tx => {
    x = (await tx.get(ref)).data();
    const spot = (await tx.get(spotRef)).data();
    if (spot && spot.status === "paid") return; // repeat webhook
    if (!x || x.status !== "live" || !spot || spot.status !== "pending") { undo = true; return; }
    code = newCode();
    tx.update(spotRef, { status: "paid", code, paymentIntent: pi, paid: x.price, paidAt: nowTs() });
    tx.update(ref, { held: FieldValue.increment(-1), sold: FieldValue.increment(1), buyerUids: FieldValue.arrayUnion(uid) });
    tx.set(db.doc(`meetupCodes/${code}`), { meetupId: id, uid, role: "buyer" });
  });
  if (undo) { await stripe().refunds.create({ payment_intent: pi }).catch(() => {}); return; }
  if (!code) return;
  const p = (await mtPrivate(id).get()).data() || {};
  await push(uid, "You're in!", `${x.title} · ${fmtWhen(x.startsAt)} at ${p.venue?.name || x.venueName}, ${p.venue?.address || x.city}. Your code is in My M&G.`);
  await push(x.hostUid, "Someone bought a spot", `${x.title}: ${x.sold + 1} of ${x.spots} sold.`);
}

async function onHostDepositPaid(sess) {
  const { dateId: id } = sess.metadata || {};
  if (sess.payment_status !== "paid") return;
  const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id;
  const ref = mtRef(id), x = (await ref.get()).data();
  if (!x) { await stripe().refunds.create({ payment_intent: pi }).catch(() => {}); return; }
  if (x.hostDeposit?.paymentIntent === pi) return;
  await ref.update({ status: x.status === "draft" ? "pending" : x.status, hostDeposit: { status: "held", amount: sess.amount_total, paymentIntent: pi, paidAt: nowTs() } });
  await db.collection("ledger").add({ kind: "hostDepositPaid", uid: x.hostUid, meetupId: id, amount: sess.amount_total, at: nowTs() });
  for (const a of ADMIN_UIDS) await push(a, "New M&G to review", `${x.title} by ${x.hostName}`);
  await push(x.hostUid, "Sent for review", `${x.title} will go on sale once it's approved. We may call to confirm details.`);
}

async function releaseHostDeposit(id, x, why) {
  const dep = x.hostDeposit || {};
  if (dep.status !== "held" || !dep.paymentIntent) return false;
  try { await stripe().refunds.create({ payment_intent: dep.paymentIntent }); }
  catch (e) { logger.error("host deposit refund", id, e.message); await mtRef(id).update({ "hostDeposit.error": e.message }); return false; }
  await mtRef(id).update({ "hostDeposit.status": "refunded", "hostDeposit.refundedAt": nowTs(), "hostDeposit.why": why });
  return true;
}
async function keepHostDeposit(id, x, why) {
  const dep = x.hostDeposit || {};
  if (dep.status !== "held") return false;
  await mtRef(id).update({ "hostDeposit.status": "kept", "hostDeposit.keptAt": nowTs(), "hostDeposit.why": why });
  await db.collection("ledger").add({ kind: "hostDepositKept", uid: x.hostUid, meetupId: id, amount: dep.amount, why, at: nowTs() });
  return true;
}

/** Host checks a guest in at the M&G with the guest's code. */
exports.checkInGuest = onCall(async req => {
  const uid = requireUser(req);
  const code = str(req.data?.code, 20).toUpperCase();
  const c = (await db.doc(`meetupCodes/${code}`).get()).data();
  if (!c) fail("not-found", `No spot matches ${code}. Check the letters and try again.`);
  const ref = mtRef(c.meetupId), x = (await ref.get()).data();
  if (!x || (x.hostUid !== uid && !ADMIN_UIDS.includes(uid))) fail("permission-denied", "That code is for a different M&G.");
  if (req.data?.meetupId && req.data.meetupId !== c.meetupId) fail("permission-denied", "That code is for a different M&G.");
  if (x.status !== "live") fail("failed-precondition", `This M&G isn't active (${x.status}).`);
  if (Math.abs(ms(x.startsAt) - Date.now()) > 12 * 3600000) fail("failed-precondition", "Guests can be checked in on the day of the M&G.");
  const spotRef = ref.collection("spots").doc(c.uid), spot = (await spotRef.get()).data() || {};
  const already = !!spot.checkedInAt;
  if (!already) { await spotRef.update({ checkedInAt: nowTs() }); await ref.update({ checkedIn: FieldValue.increment(1) }); }
  return { guest: spot.name || "Guest", already, title: x.title };
});

async function refundMeetup(id, reason) {
  const ref = mtRef(id);
  const x = await db.runTransaction(async tx => {
    const v = (await tx.get(ref)).data();
    if (!v || !["live", "review", "pending", "changes", "draft"].includes(v.status)) return null;
    tx.update(ref, { status: "canceled", canceledReason: reason, canceledAt: nowTs() });
    return v;
  });
  if (!x) return false;
  const spots = await ref.collection("spots").get();
  let refunded = 0;
  for (const d of spots.docs) {
    const sp = d.data();
    if (sp.status === "paid" && sp.paymentIntent) {
      try { await stripe().refunds.create({ payment_intent: sp.paymentIntent }); await d.ref.update({ status: "refunded" }); refunded++; }
      catch (e) { logger.error("meetup refund", id, e.message); await d.ref.update({ moneyError: e.message }); }
      await push(sp.uid, "M&G canceled", `${x.title}: ${reason} You've been refunded in full.`);
    }
    if (sp.status === "pending") await d.ref.update({ status: "released" });
  }
  return refunded;
}

exports.cancelMeetup = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const id = str(req.data?.meetupId, 64);
  const x = (await mtRef(id).get()).data();
  if (!x || x.hostUid !== uid) fail("permission-denied", "Only the host can cancel.");
  const late = ms(x.startsAt) - Date.now() < s.lateCancelHours * 3600000;
  const keep = late && x.sold > 0;
  if (req.data?.preview) {
    return { lines: [x.sold ? `Everyone who bought a spot (${x.sold}) gets a full refund.` : "Nobody has bought a spot yet.",
      x.hostDeposit?.status === "held" ? (keep ? `It's within ${s.lateCancelHours} hours, so your ${fmtMoney(x.hostDeposit.amount)} host deposit is kept and it counts as a strike.` : `Your ${fmtMoney(x.hostDeposit.amount)} host deposit is returned.`) : ""].filter(Boolean) };
  }
  await refundMeetup(id, "The host canceled.");
  if (keep) { await keepHostDeposit(id, x, "Canceled late"); await addStrike(uid, s, "Canceled an M&G late"); }
  else await releaseHostDeposit(id, x, "Canceled early");
  return { message: keep ? "Canceled. Buyers were refunded; your deposit was kept." : "Canceled. Everyone was refunded, including your deposit." };
});

/** The M&Gs you host or bought. Buyers get the address and phone; hosts get everything. */
exports.myMeetups = onCall(async req => {
  const uid = requireUser(req);
  const [hosted, bought, mem] = await Promise.all([
    db.collection("meetups").where("hostUid", "==", uid).orderBy("startsAt", "desc").limit(30).get(),
    db.collection("meetups").where("buyerUids", "array-contains", uid).limit(30).get(),
    getMember(uid)
  ]);
  const out = [];
  for (const d of [...hosted.docs, ...bought.docs]) {
    const x = d.data(), host = x.hostUid === uid;
    const spot = (await d.ref.collection("spots").doc(uid).get()).data() || {};
    const paid = spot.status === "paid";
    const p = host || paid ? ((await mtPrivate(d.id).get()).data() || {}) : {};
    const pct = x.hostFeePct ?? 10;
    out.push({ id: d.id, host, title: x.title, about: x.about, category: x.category, items: x.items || [], venueName: x.venueName, city: x.city,
      startsAt: ms(x.startsAt), status: x.status, hidden: !!x.hidden, price: x.price, spots: x.spots, sold: x.sold, checkedIn: x.checkedIn || 0, hostName: x.hostName,
      imageURL: x.imageURL || "", hue: x.hue, changesNote: host ? (x.changesNote || "") : "",
      code: paid ? spot.code : "", spotStatus: spot.status || "", guestCheckedIn: !!spot.checkedInAt,
      address: (host || paid) ? (p.venue?.address || "") : "", venuePhone: (host || paid) ? (p.venue?.phone || "") : "",
      venue: host ? (p.venue || null) : null, contact: host ? (p.contact || null) : null,
      hostDeposit: host ? (x.hostDeposit || null) : null,
      hostCut: host ? Math.round(x.price * (100 - pct) / 100) : 0 });
  }
  out.sort((a, b) => b.startsAt - a.startsAt);
  return { meetups: out, hostContact: mem?.hostContact || null };
});

async function meetupHousekeeping(s) {
  const now = Date.now();
  const live = await db.collection("meetups").where("status", "==", "live").limit(300).get();
  for (const d of live.docs) {
    const x = d.data();
    if (x.held > 0) {
      const stale = await d.ref.collection("spots").where("status", "==", "pending").get();
      for (const sp of stale.docs) {
        if (ms(sp.data().createdAt) > now - MEETUP_PAY_MINUTES * 60000) continue;
        await db.runTransaction(async tx => {
          const cur = (await tx.get(sp.ref)).data();
          if (cur.status !== "pending") return;
          tx.update(sp.ref, { status: "released" });
          tx.update(d.ref, { held: FieldValue.increment(-1) });
        });
      }
    }
    if (ms(x.startsAt) < now - SETTLE_AFTER_HOURS * 3600000) await settleMeetup(d.id, s);
  }
  // Drafts whose deposit was never paid disappear after a day.
  const drafts = await db.collection("meetups").where("status", "==", "draft").limit(200).get();
  for (const d of drafts.docs) if (ms(d.data().createdAt) < now - 86400000) await d.ref.update({ status: "expired" });
}

async function payHost(id, x, s) {
  const pct = x.hostFeePct ?? s.hostFee;
  const gross = x.price * x.sold;
  const hostTotal = Math.round(gross * (100 - pct) / 100), siteTotal = gross - hostTotal;
  if (hostTotal) await rtdb.ref(`users/${x.hostUid}/earnings`).transaction(e => Math.round(((Number(e) || 0) + hostTotal / 100) * 100) / 100);
  if (siteTotal) await rtdb.ref("siteRevenue").transaction(v => Math.round(((Number(v) || 0) + siteTotal / 100) * 100) / 100);
  await db.collection("ledger").add({ kind: "meetupSettled", meetupId: id, hostUid: x.hostUid, sold: x.sold, hostEarned: hostTotal, siteFee: siteTotal, at: nowTs() });
  const day = dayKey(new Date());
  await db.doc(`stats/day-${day}`).set({ day, fees: FieldValue.increment(siteTotal), meetups: FieldValue.increment(1) }, { merge: true });
  await mtRef(id).update({ status: "completed", completedAt: nowTs(), hostEarned: hostTotal, siteFee: siteTotal });
  await releaseHostDeposit(id, x, "M&G happened");
  if (hostTotal) await push(x.hostUid, "You got paid", `${fmtMoney(hostTotal)} from ${x.title} was added to your Whisper+Me earnings, and your host deposit is on its way back.`);
  return hostTotal;
}

async function settleMeetup(id, s) {
  const x = (await mtRef(id).get()).data();
  if (!x || x.status !== "live") return;
  if (!x.sold || x.checkedIn > 0) { await payHost(id, x, s); return; }
  // People paid but nobody was checked in: the admin checks with the host and venue.
  await mtRef(id).update({ status: "review", reviewSince: nowTs() });
  for (const a of ADMIN_UIDS) await push(a, "M&G needs a look", `${x.title}: ${x.sold} sold, nobody checked in. Pay the host or refund buyers.`);
}

/* ═══════════════════════════════════════════════════════════════
   SHARE LINKS/* ═══════════════════════════════════════════════════════════════
   SHARE LINKS: whisperplusme.com/d/{ticketId}
   Social apps read the title, description and picture from this page;
   people are sent straight on to the ticket in the app.
═══════════════════════════════════════════════════════════════ */
const htmlEsc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function dateOGPage(ticketId) {
  const id = String(ticketId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const t = id ? (await db.doc(`tickets/${id}`).get()).data() : null;
  const live = t && t.status === "live" && !t.adminHidden && ms(t.startsAt) > Date.now();
  const v = t ? ((await db.doc(`venues/${t.venueId}`).get()).data() || {}) : {};
  const url = `${APP_URL}/d/${id}`;
  const appUrl = `${APP_URL}/?dates=1${live ? "&ticket=" + id : ""}`;
  const when = t ? new Date(ms(t.startsAt)).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : "";
  const each = t ? fmtMoney(Math.ceil(t.price / t.size)) : "";
  const title = t ? `${t.title} at ${t.venueName}` : "Date nights on Whisper+Me";
  const desc = !t ? "Book dinner, concerts, movies and more with someone new. Split it or treat them."
    : live ? `${when}${v.city ? " · " + v.city : ""}. For ${t.size}: ${fmtMoney(t.price)}, or ${each} each if you split it. ${(t.items || []).slice(0, 2).join(", ")}.`
    : `This one's no longer available. See what else is on at Whisper+Me M&G.`;
  const img = (t && t.imageURL) || `${APP_URL}/og-image.png?v=4`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEsc(title)} · Whisper+Me M&G</title>
<meta name="description" content="${htmlEsc(desc)}">
<link rel="canonical" href="${htmlEsc(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Whisper+Me">
<meta property="og:url" content="${htmlEsc(url)}"><meta property="og:title" content="${htmlEsc(title)}">
<meta property="og:description" content="${htmlEsc(desc)}"><meta property="og:image" content="${htmlEsc(img)}"><meta property="og:image:alt" content="${htmlEsc(title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${htmlEsc(title)}">
<meta name="twitter:description" content="${htmlEsc(desc)}"><meta name="twitter:image" content="${htmlEsc(img)}">
<meta http-equiv="refresh" content="0;url=${htmlEsc(appUrl)}">
</head><body style="background:#0b0b16;color:#fff;font-family:system-ui;text-align:center;padding:40px">
<p><a href="${htmlEsc(appUrl)}" style="color:#00e3ae">Open ${htmlEsc(title)} on Whisper+Me</a></p>
<script>location.replace(${JSON.stringify(appUrl)});</script></body></html>`;
}
async function meetupOGPage(meetupId) {
  const id = String(meetupId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const x = id ? (await mtRef(id).get()).data() : null;
  const live = x && x.status === "live" && !x.hidden && ms(x.startsAt) > Date.now();
  const url = `${APP_URL}/m/${id}`;
  const appUrl = `${APP_URL}/?dates=1${live ? "&meetup=" + id : ""}`;
  const when = x ? new Date(ms(x.startsAt)).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : "";
  const left = x ? Math.max(0, x.spots - x.sold - x.held) : 0;
  const title = x ? `${x.title} · with ${x.hostName}` : "Meet & greets on Whisper+Me";
  const desc = !x ? "Meet the people you follow, in person, at real venues."
    : live ? `${when} at ${x.venueName}${x.city ? ", " + x.city : ""}. ${fmtMoney(x.price)} a spot${left <= 10 ? `, ${left} left` : ""}. ${(x.items || []).slice(0, 2).join(", ")}.`
    : "This meet & greet has ended. See what's coming up on Whisper+Me.";
  const img = (x && (x.imageURL || x.hostPhoto)) || `${APP_URL}/og-image.png?v=4`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEsc(title)}</title><meta name="description" content="${htmlEsc(desc)}"><link rel="canonical" href="${htmlEsc(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Whisper+Me">
<meta property="og:url" content="${htmlEsc(url)}"><meta property="og:title" content="${htmlEsc(title)}">
<meta property="og:description" content="${htmlEsc(desc)}"><meta property="og:image" content="${htmlEsc(img)}"><meta property="og:image:alt" content="${htmlEsc(title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${htmlEsc(title)}">
<meta name="twitter:description" content="${htmlEsc(desc)}"><meta name="twitter:image" content="${htmlEsc(img)}">
<meta http-equiv="refresh" content="0;url=${htmlEsc(appUrl)}"></head><body style="background:#0b0b16;color:#fff;font-family:system-ui;text-align:center;padding:40px">
<p><a href="${htmlEsc(appUrl)}" style="color:#00e3ae">Open ${htmlEsc(title)} on Whisper+Me</a></p><script>location.replace(${JSON.stringify(appUrl)});</script></body></html>`;
}
exports.meetupOG = onRequest({ cors: false }, async (req, res) => {
  try {
    const id = (req.path.split("/").filter(Boolean)[1]) || "";
    res.set("Cache-Control", "public, max-age=300, s-maxage=600");
    res.status(200).send(await meetupOGPage(id));
  } catch (e) { logger.error("meetupOG", e.message); res.redirect(302, `${APP_URL}/?dates=1`); }
});

exports.dateOG = onRequest({ cors: false }, async (req, res) => {
  try {
    const id = (req.path.split("/").filter(Boolean)[1]) || "";
    res.set("Cache-Control", "public, max-age=300, s-maxage=600");
    res.status(200).send(await dateOGPage(id));
  } catch (e) { logger.error("dateOG", e.message); res.redirect(302, `${APP_URL}/?dates=1`); }
});

/* ═══════════════════════════════════════════════════════════════
   WHISPER+ME SITE HELPERS (Realtime Database)
   - landingStats: the "N people online" counter on the landing page
   - chatPrune: keeps each chat room to its newest messages, so members
     never need permission to delete anyone else's messages
═══════════════════════════════════════════════════════════════ */
const CHAT_KEEP = 100;

async function landingStats() {
  const [pres, rooms] = await Promise.all([rtdb.ref("presence").once("value"), rtdb.ref("memberRooms").once("value")]);
  const online = Object.keys(pres.val() || {}).length;
  const liveRooms = Object.values(rooms.val() || {}).filter(r => r && !r.closing).length;
  const stats = { online, liveRooms, ts: Date.now() };
  await rtdb.ref("landing/stats").set(stats);
  return stats;
}
exports.landingStats = onSchedule({ schedule: "every 5 minutes", memory: "256MiB" }, landingStats);

async function chatPrune() {
  const all = (await rtdb.ref("chat").once("value")).val() || {};
  const upd = {};
  for (const [room, msgs] of Object.entries(all)) {
    const list = Object.entries(msgs || {}).sort((a, b) => ((a[1] && a[1].ts) || 0) - ((b[1] && b[1].ts) || 0));
    list.slice(0, Math.max(0, list.length - CHAT_KEEP)).forEach(([k, v]) => {
      if (!(v && v.seeded)) upd[`chat/${room}/${k}`] = null; // keep the pinned welcome message
    });
  }
  const n = Object.keys(upd).length;
  if (n) await rtdb.ref().update(upd);
  logger.info(`chatPrune removed ${n} old messages`);
  return n;
}
exports.chatPrune = onSchedule({ schedule: "every 30 minutes", memory: "512MiB" }, chatPrune);

// Test hooks (only when running the local test script; never part of a deploy).
if (process.env.DATES_TEST) {
  module.exports.__test = { setStripe: s => { _stripe = s; }, handleStripeEvent, housekeeping, settleDate, getSettings, CATEGORIES, landingStats, chatPrune, dateOGPage, meetupOGPage };
}
