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
const { onValueCreated, onValueUpdated, onValueWritten } = require("firebase-functions/v2/database");
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
const GMAIL_PASS = defineSecret("GMAIL_APP_PASSWORD"); // same Gmail app password the default functions use
const withStripe = { secrets: [STRIPE_SECRET, GMAIL_PASS] }; // anything that takes money can also send the receipt

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
  hostFee: 10,                // % the site keeps from each hosted M&G spot
  hostPayoutHours: 72         // hosts are paid this long after their M&G starts (time for buyers to report a problem)
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

/* ═══════════════════════════════════════════════════════════════
   EMAIL: receipts, reminders and payout notices
   Sent from whisper.me.support@gmail.com with the GMAIL_APP_PASSWORD
   secret. Email never blocks anything: if it fails it's only logged.
   Gmail allows about 500 emails a day; move to a sending service
   (SendGrid, Postmark, Resend) when you outgrow that.
═══════════════════════════════════════════════════════════════ */
const MAIL_FROM = "whisper.me.support@gmail.com";
const sentMail = []; // tests read this
let _mailer = null;
function mailer() {
  if (_mailer) return _mailer;
  let pass = ""; try { pass = GMAIL_PASS.value(); } catch (e) { /* secret not bound to this function */ }
  if (!pass) return null;
  _mailer = require("nodemailer").createTransport({ service: "gmail", auth: { user: MAIL_FROM, pass } });
  return _mailer;
}
async function emailOf(uid) {
  if (!uid) return "";
  for (const path of [`userPrivate/${uid}/email`, `users/${uid}/email`]) {
    try { const e = (await rtdb.ref(path).once("value")).val(); if (e && EMAIL_RE.test(e)) return e; } catch (e) { /* try the next */ }
  }
  try { const u = await admin.auth().getUser(uid); if (u.email) return u.email; } catch (e) { /* no auth record */ }
  return "";
}
const escHtml = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icsDate = t => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function calendarLinks({ title, start, hours = 2, place, details }) {
  const end = start + hours * 3600000;
  const google = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(title) + "&dates=" + icsDate(start) + "/" + icsDate(end)
    + "&location=" + encodeURIComponent(place || "") + "&details=" + encodeURIComponent(details || "");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Whisper+Me//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    "UID:" + icsDate(start) + "-" + Math.random().toString(36).slice(2) + "@whisperplusme.com", "DTSTAMP:" + icsDate(Date.now()),
    "DTSTART:" + icsDate(start), "DTEND:" + icsDate(end), "SUMMARY:" + String(title).replace(/[,;\n]/g, " "),
    "LOCATION:" + String(place || "").replace(/[,;\n]/g, " "), "DESCRIPTION:" + String(details || "").replace(/[,;\n]/g, " "),
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  return { google, ics };
}
/** One simple branded layout for every email. rows: [[label, value]]; code: big code box; button: [label, url]. */
function emailHTML({ heading, intro, rows = [], code = "", button = null, after = "", cal = null }) {
  const r = rows.filter(x => x && x[1] !== "" && x[1] != null).map(([k, v]) => `<tr><td style="padding:6px 0;color:#6b6585;font-size:14px;width:120px;vertical-align:top">${escHtml(k)}</td><td style="padding:6px 0;color:#1d1a2b;font-size:15px;font-weight:600">${escHtml(v)}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f3f1fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1fa;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:linear-gradient(90deg,#7b2ff7,#00c896);background-color:#7b2ff7;padding:18px 24px;color:#fff;font-size:18px;font-weight:800">Whisper+Me</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 10px;font-size:22px;color:#1d1a2b">${escHtml(heading)}</h1>
${intro ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#3b3650">${escHtml(intro)}</p>` : ""}
${code ? `<div style="margin:0 0 16px;padding:14px;border:2px dashed #7b2ff7;border-radius:14px;text-align:center"><div style="font-size:12px;color:#6b6585;text-transform:uppercase;letter-spacing:.08em">Your code</div><div style="font-size:28px;font-weight:900;letter-spacing:.12em;color:#1d1a2b">${escHtml(code)}</div></div>` : ""}
${r ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${r}</table>` : ""}
${button ? `<a href="${escHtml(button[1])}" style="display:inline-block;background:#7b2ff7;color:#fff;text-decoration:none;font-weight:800;padding:13px 22px;border-radius:999px;font-size:15px">${escHtml(button[0])}</a>` : ""}
${cal ? `<p style="margin:14px 0 0;font-size:13px"><a href="${escHtml(cal.google)}" style="color:#7b2ff7">Add to Google Calendar</a> · the attached invite works with Apple and Outlook calendars</p>` : ""}
${after ? `<p style="margin:16px 0 0;font-size:13.5px;line-height:1.5;color:#6b6585">${escHtml(after)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 24px;background:#faf9fd;color:#8f89a8;font-size:12px;line-height:1.5">You're getting this because of something you did on <a href="${APP_URL}" style="color:#7b2ff7">whisperplusme.com</a>. Questions? Just reply to this email.</td></tr>
</table></td></tr></table></body></html>`;
}
function emailText({ heading, intro, rows = [], code = "", button = null, after = "" }) {
  return [heading, "", intro, code ? `Your code: ${code}` : "", ...rows.filter(x => x && x[1] !== "" && x[1] != null).map(([k, v]) => `${k}: ${v}`), button ? `${button[0]}: ${button[1]}` : "", after, "", "Whisper+Me · whisperplusme.com"].filter(x => x !== "").join("\n");
}
/** to: a uid or an email address. Never throws. */
async function sendEmail(to, subject, parts, { ics = "" } = {}) {
  try {
    const addr = EMAIL_RE.test(String(to)) ? String(to) : await emailOf(to);
    if (!addr) return false;
    const msg = { from: `"Whisper+Me" <${MAIL_FROM}>`, to: addr, replyTo: MAIL_FROM, subject, html: emailHTML(parts), text: emailText(parts) };
    if (ics) msg.icalEvent = { method: "PUBLISH", filename: "whisperplusme.ics", content: ics };
    if (process.env.DATES_TEST) { sentMail.push({ to: addr, subject, parts }); return true; }
    const m = mailer(); if (!m) { logger.warn("email skipped (no Gmail password)", subject); return false; }
    await m.sendMail(msg);
    return true;
  } catch (e) { logger.warn("email failed", subject, e.message); return false; }
}

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

/* ---------- push notifications: every device a member turned alerts on for ----------
   fcmTokens/{uid} = { token (latest device), devices: { <key>: { token, updatedAt } } } */
async function deviceTokens(uid) {
  const v = (await rtdb.ref(`fcmTokens/${uid}`).once("value")).val() || {};
  const list = Object.entries(v.devices || {}).map(([k, d]) => ({ key: k, token: d && d.token })).filter(d => d.token);
  if (v.token && !list.some(d => d.token === v.token)) list.push({ key: null, token: v.token });
  return list;
}
const DEAD_TOKEN = /registration-token-not-registered|invalid-registration-token|requested entity was not found/i;
/** Sends to every device; forgets devices whose alerts were turned off. Returns how many got it. */
async function sendToDevices(uid, msg) {
  let ok = 0;
  for (const d of await deviceTokens(uid)) {
    try { await admin.messaging().send({ ...msg, token: d.token }); ok++; }
    catch (e) {
      if (DEAD_TOKEN.test(`${e.code || ""} ${e.message || ""}`)) {
        if (d.key) await rtdb.ref(`fcmTokens/${uid}/devices/${d.key}`).set(null);
        else await rtdb.ref(`fcmTokens/${uid}/token`).set(null);
      } else logger.warn("push failed", uid, e.message);
    }
  }
  return ok;
}
async function push(uid, title, body, link) {
  try {
    const url = link || `${APP_URL}/?dates=1`;
    await sendToDevices(uid, {
      notification: { title, body },
      data: { type: "dates", url },
      webpush: { fcmOptions: { link: url }, notification: { icon: `${APP_URL}/favicon-32.png` } }
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
async function checkoutFor({ kind, uid, email, amount, name, description, dateId = "", seatIndex = -1, hold = false, deposit = 0, qty = 1 }) {
  const meta = { app: "dates", kind, uid, dateId, seatIndex: String(seatIndex), deposit: String(deposit || 0), qty: String(qty) };
  const items = [];
  if (amount > 0) items.push({ quantity: qty, price_data: { currency: "usd", unit_amount: amount, product_data: { name, description } } });
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

exports.nightsStripeWebhook = onRequest({ secrets: [STRIPE_SECRET, STRIPE_WEBHOOK_SECRET, GMAIL_PASS] }, async (req, res) => {
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
  if (o.metadata.kind === "connect") await onConnectPaid(o);
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
  await connectHousekeeping(s);
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
      await sendEmail(x.hostUid, `You're live: ${x.title}`, {
        heading: "Your M&G is on sale 🎉", intro: `${x.title} was approved and people can buy spots now. The more you share it, the more you sell.`,
        rows: [["When", fmtWhen(x.startsAt)], ["Price", fmtMoney(x.price) + " a spot"], ["Spots", x.spots]],
        button: ["Copy your share link", `${APP_URL}/m/${id}`],
        after: "Post the link on Instagram, Facebook, TikTok and in your group chats. On the day, check guests in by their codes." });
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
      await log(req, action, id, reason); return { message: "Rejected. The host's deposit stays on their account." };
    }
    case "payMeetupHost": {
      const x = (await mtRef(id).get()).data();
      if (!x || !["review", "live", "paying"].includes(x.status)) fail("failed-precondition", "Nothing to pay.");
      const n = await payHost(id, x, await getSettings());
      await log(req, action, id, fmtMoney(n)); return { message: `Paid the host ${fmtMoney(n)}.` };
    }
    case "cancelMeetup": {
      const x = (await mtRef(id).get()).data();
      const n = await refundMeetup(id, reason || "Canceled by Whisper+Me.");
      if (x && data.keepDeposit) { await keepHostDeposit(id, x, "Host no-show (admin)"); await addStrike(x.hostUid, await getSettings(), "Missed their M&G"); }
      else if (x) await releaseHostDeposit(id, x, "Canceled by admin");
      await log(req, action, id, reason); return { message: `Canceled. ${n || 0} buyer(s) got their money back as credit.${data.keepDeposit ? " Host deposit kept." : ""}` };
    }
    case "postConnect": { const r = await postConnect(req, id || null, data); await log(req, action, r.id, str(data.title, 80)); return r; }
    case "hideConnect":
    case "showConnect": { await cnRef(id).update({ hidden: action === "hideConnect" }); await log(req, action, id); return { message: action === "hideConnect" ? "Paused" : "Back on sale" }; }
    case "endConnect": { await cnRef(id).update({ status: "ended" }); await log(req, action, id); return { message: "Stopped selling. Packages already bought still happen." }; }
    case "cancelConnect": { const n = await cancelConnectDeal(id, str(reason, 200) || "It was canceled."); await log(req, action, id, reason); return { message: `Canceled. ${n} buyer(s) got their money back as credit.` }; }
    case "connectCheckIn": { const r = await connectCheckInCode(data.code || id); await log(req, action, r.title, r.guest); return { ...r, message: (r.already ? "Already checked in: " : "✅ Checked in: ") + r.guest }; }
    case "connectOrders": {
      const q = await db.collection("connectOrders").where("dealId", "==", id).limit(500).get();
      return { orders: q.docs.map(d => d.data()).filter(o => ["paid", "completed", "canceled"].includes(o.status)).map(o => ({ buyerName: o.buyerName, status: o.status, amount: o.amount, seats: (o.seats || []).map(x => ({ name: x.name || "", status: x.status, code: x.code || "", here: !!x.checkedInAt, method: x.checkInMethod || "" })) })) };
    }
    case "refundHostDeposit": {
      const ref = db.doc(`members/${str(id, 128)}`), m = (await ref.get()).data() || {};
      const d = m.hostDeposit || {}; let sent = 0; const keep = [];
      const open = await db.collection("meetups").where("hostUid", "==", id).where("status", "in", ["pending", "changes", "live", "review", "paying"]).limit(1).get();
      if (!open.empty) fail("failed-precondition", "They have an M&G that isn't finished yet. Refund the deposit after it's done.");
      for (const p of d.payments || []) {
        if (!(p.left > 0)) continue;
        try { await stripe().refunds.create({ payment_intent: p.pi, amount: p.left }); sent += p.left; } catch (e) { keep.push(p); }
      }
      await ref.set({ hostDeposit: { held: keep.reduce((a, p) => a + p.left, 0), payments: keep } }, { merge: true });
      await log(req, action, id, fmtMoney(sent)); return { message: `Refunded ${fmtMoney(sent)} of their deposit.` };
    }
    case "payCreator": { const n = await payoutUser(str(id, 128)); await log(req, action, id, fmtMoney(n)); return { message: `Sent ${fmtMoney(n)} to their bank account` }; }
    case "markCreatorPaid": { const n = await payoutUser(str(id, 128), { manual: true, amount: Math.round(Number(data.amount || 0) * 100) }); await log(req, action, id, fmtMoney(n)); return { message: `Recorded ${fmtMoney(n)} paid another way` }; }
    case "payAllCreators": { const r = await payAllReady(); await log(req, action, "all", `${r.paid} paid ${fmtMoney(r.total)}`); return { message: `Paid ${r.paid} creator(s) ${fmtMoney(r.total)}.${r.skipped.length ? " Skipped: " + r.skipped.slice(0, 3).join("; ") : ""}`, ...r }; }
    case "setAutoPayouts": { await db.doc("settings/platform").set({ autoPayouts: !!data.on }, { merge: true }); await log(req, action, "settings", String(!!data.on)); return { message: data.on ? "Automatic payouts are on (the 1st of every month)" : "Automatic payouts are off" }; }
    case "postMeetup": {
      const r = await postOfficialMeetup(req, id || null, data);
      await log(req, action, r.id, str(data.title, 80)); return r;
    }
    case "holdMeetupPayout": {
      const x = (await mtRef(id).get()).data();
      if (!x || x.status !== "paying") fail("failed-precondition", "Only M&Gs waiting to pay the host can be held.");
      await mtRef(id).update({ status: "review", reviewSince: nowTs(), lastReport: str(reason, 300) || "Held by admin" });
      await log(req, action, id, reason); return { message: "Payout on hold. Decide in the review list." };
    }
    case "meetupGuests": {
      const x = (await mtRef(id).get()).data();
      if (!x) fail("not-found", "Not found.");
      const g = await mtRef(id).collection("spots").where("status", "in", ["paid", "refunded"]).limit(500).get();
      const reports = await db.collection("reports").where("meetupId", "==", id).limit(50).get();
      return { guests: g.docs.map(z => ({ name: z.data().name || "Guest", qty: z.data().qty || 1, code: z.data().code || "", status: z.data().status, here: !!z.data().checkedInAt, reported: !!z.data().reported })),
        reports: reports.docs.map(z => ({ reason: z.data().reason, detail: z.data().detail || "", by: z.data().by })) };
    }
    case "salesReport": {
      // Every M&G spot and Connect Me package sold since `since`, for the admin's sales charts.
      // A sale always happens before its event starts, so only events starting after `since` can hold one.
      const since = Math.max(Date.now() - 400 * 864e5, Number(data.since) || Date.now() - 200 * 864e5);
      const s = await getSettings();
      const mg = [], cm = [];
      const ms_ = await db.collection("meetups").where("startsAt", ">=", fromMs(since)).limit(1000).get();
      for (const d of ms_.docs) {
        const x = d.data();
        if (!x.sold && !["completed", "paying", "review"].includes(x.status)) continue;
        const pct = x.official ? 100 : (x.hostFeePct ?? s.hostFee);
        const sp = await d.ref.collection("spots").where("status", "==", "paid").limit(500).get();
        for (const z of sp.docs) {
          const v = z.data(), at = ms(v.paidAt);
          if (at < since) continue;
          const amount = v.paid ?? x.price * (v.qty || 1);
          mg.push({ at, amount, site: Math.round(amount * pct / 100), fee: v.stripeFee || 0, qty: v.qty || 1, hostUid: x.official ? "" : x.hostUid, hostName: x.official ? "Whisper+Me" : x.hostName, title: x.title });
        }
      }
      const os = await db.collection("connectOrders").where("startsAt", ">=", fromMs(since)).limit(3000).get();
      for (const d of os.docs) {
        const o = d.data(), at = ms(o.paidAt);
        if (!["paid", "completed"].includes(o.status) || at < since) continue;
        cm.push({ at, amount: o.amount || 0, fee: o.stripeFee || 0, venueName: o.venueName, city: o.city, title: o.title });
      }
      return { since, mg, cm };
    }
    case "ratings": {
      const q = await db.collection("ratings").orderBy("at", "desc").limit(Math.min(200, Number(data.limit) || 100)).get();
      const venues = await db.collection("connectVenues").orderBy("n", "desc").limit(50).get();
      return { ratings: q.docs.map(d => ({ id: d.id, ...d.data(), at: ms(d.data().at) })), venues: venues.docs.map(d => ({ key: d.id, name: d.data().name, city: d.data().city, avg: avgOf(d.data()), n: d.data().n || 0 })) };
    }
    case "removeRating": {
      const ref = db.doc(`ratings/${str(id, 200)}`), r = (await ref.get()).data();
      if (!r) fail("not-found", "Already removed.");
      if (r.kind === "mg") {
        await mtRef(r.eventId).update({ "rating.sum": FieldValue.increment(-r.stars), "rating.n": FieldValue.increment(-1) }).catch(() => {});
        if (r.subjectUid) await rtdb.ref(`users/${r.subjectUid}/rating`).transaction(v => {
          if (!v) return v; v.sum -= r.stars; v.n -= 1; if (v.n <= 0) return null; v.avg = Math.round((v.sum / v.n) * 10) / 10; return v;
        });
      } else {
        await cnRef(r.dealId).update({ "rating.sum": FieldValue.increment(-r.stars), "rating.n": FieldValue.increment(-1) }).catch(() => {});
        await db.doc(`connectVenues/${r.venueKey}`).update({ sum: FieldValue.increment(-r.stars), n: FieldValue.increment(-1) }).catch(() => {});
        await refreshVenueRating(r.venueKey);
      }
      await ref.delete();
      await log(req, action, id, `${r.stars}★ ${r.title}`); return { message: "Rating removed" };
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
        hostFee: data.hostFee == null ? 10 : n(data.hostFee, 0, 50),
        hostPayoutHours: data.hostPayoutHours == null ? 72 : n(data.hostPayoutHours, 24, 240)
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
   Everything on the M&G screen is an M&G: one price per person, buy a
   spot, get the address and a code. Two kinds:
   - Hosted: a member or creator posts it → pays a host deposit (one
     spot's price when selling 2+ spots, $5 for a 1-spot M&G) → admin
     reviews (approve / ask for changes / reject) → on sale.
   - Official (official: true): posted by Whisper+Me from the admin. Live
     right away, no deposit, the site keeps the ticket money (you pay the
     venue yourself).
   The venue's address + phone and the host's contact info are private
   (meetups/{id}/private/info): buyers see the address after they pay.
   At the M&G the host checks guests in with their MG- codes.
   ~3h after the start: guests checked in → "paying": the host is paid
   (price minus the site fee for every spot) and gets the deposit back
   hostPayoutHours (72) after the start, unless a buyer reports a
   problem first. Nobody checked in → the admin decides (pay the host, or
   refund buyers and keep the deposit). Host cancels late or no-shows →
   buyers refunded, deposit kept, strike.
═══════════════════════════════════════════════════════════════ */
const MEETUP_PAY_MINUTES = 40;
const SMALL_HOST_DEPOSIT = 500; // a 1-spot M&G only needs a $5 deposit
const mtRef = id => db.doc(`meetups/${id}`);
const mtPrivate = id => db.doc(`meetups/${id}/private/info`);
function newCode() { return makeCode().replace("WN-", "MG-"); }
const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const PHONE_RE = /^[0-9+().\-\s]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hostDepositFor = (spots, price) => (spots > 1 ? price : SMALL_HOST_DEPOSIT);
const OPEN_STATUSES = ["draft", "pending", "changes", "live"];

/* ---------- the host deposit lives on the host's account ----------
   Paid once (topped up only when a bigger M&G needs more) and never sent
   back automatically, so there are no refund fees. It covers every M&G
   they host. Part of it is kept only when they cancel late or don't show.
   members/{uid}.hostDeposit = { held (cents), payments: [{ pi, amount, left, at }] } */
async function depositOnFile(uid) { return Number(((await getMember(uid)) || {}).hostDeposit?.held || 0); }
async function addToDeposit(uid, amount, pi) {
  const ref = db.doc(`members/${uid}`);
  await db.runTransaction(async tx => {
    const m = (await tx.get(ref)).data() || {};
    const d = m.hostDeposit || { held: 0, payments: [] };
    if ((d.payments || []).some(x => x.pi === pi)) return; // repeat webhook
    tx.set(ref, { hostDeposit: { held: (d.held || 0) + amount, payments: [...(d.payments || []), { pi, amount, left: amount, at: Date.now() }] } }, { merge: true });
  });
}

/* ---------- Whisper+Me credit ----------
   When an M&G or Connect Me is canceled, buyers get their money back as
   credit right away (no card fee for anyone). Credit pays for spots with no
   card fee at all. Anyone can tap "Send to my card" to get it refunded to
   the card they paid with instead.
   credits/{uid} = { balance (cents), sources: [{ pi, amount, left, at, note }] } */
const creditRef = uid => db.doc(`credits/${uid}`);
async function addCredit(uid, sources, note) {
  sources = (sources || []).filter(x => x && x.amount > 0);
  const total = sources.reduce((a, x) => a + x.amount, 0);
  if (!total) return 0;
  await db.runTransaction(async tx => {
    const c = (await tx.get(creditRef(uid))).data() || { balance: 0, sources: [] };
    tx.set(creditRef(uid), { balance: (c.balance || 0) + total, sources: [...(c.sources || []), ...sources.map(x => ({ pi: x.pi || null, amount: x.amount, left: x.amount, at: Date.now(), note: str(note, 80) }))] });
  });
  await db.collection("ledger").add({ kind: "creditIssued", uid, amount: total, note: str(note, 80), at: nowTs() });
  const bal = ((await creditRef(uid).get()).data() || {}).balance || total;
  await sendEmail(uid, `${fmtMoney(total)} Whisper+Me credit added`, {
    heading: `${fmtMoney(total)} is back in your credit`, intro: note ? str(note, 80) : "",
    rows: [["Added", fmtMoney(total)], ["Your credit now", fmtMoney(bal)]],
    button: ["Find an M&G to use it on", `${APP_URL}/?dates=1`],
    after: "Credit pays for any M&G or Connect Me with no card fee. Rather have it on your card? Tap \"Send to my card\" in My tickets." });
  return total;
}
/** Inside a transaction (call after the other reads, before writes): takes up to `want` cents, oldest first. */
function takeCredit(c, want) {
  const sources = (c?.sources || []).map(x => ({ ...x })), from = [];
  let need = Math.min(want, c?.balance || 0);
  for (const x of sources) { if (need <= 0) break; const t = Math.min(x.left || 0, need); if (t > 0) { x.left -= t; need -= t; from.push({ pi: x.pi, amount: t }); } }
  const used = from.reduce((a, x) => a + x.amount, 0);
  return { used, from, next: { balance: (c?.balance || 0) - used, sources: sources.filter(x => x.left > 0) } };
}

function cleanMeetup(d, { official = false } = {}) {
  const v = d.venue || {};
  const out = {
    title: str(d.title, 80), about: str(d.about, 800), category: CATEGORIES.includes(d.category) ? d.category : "Other",
    items: (Array.isArray(d.items) ? d.items : String(d.items || "").split(/\n|,/)).map(x => str(x, 60)).filter(Boolean).slice(0, 10),
    imageURL: /^https:\/\//.test(d.imageURL || "") ? str(d.imageURL, 600) : "",
    startsAt: Number(d.startsAt), price: Math.round(Number(d.price) * 100), spots: Math.round(Number(d.spots)),
    venue: { name: str(v.name, 80), address: str(v.address, 160), city: str(v.city, 60), phone: str(v.phone, 20), source: v.source === "osm" ? "osm" : "other", osmId: str(v.osmId, 40), lat: Number(v.lat) || null, lon: Number(v.lon) || null },
    contact: { email: str(d.contact && d.contact.email, 120), phone: str(d.contact && d.contact.phone, 20) },
    idCheck: d.idCheck === true || d.idCheck === "1" || d.idCheck === "true" // 21+ with ID at the door (bars, alcohol)
  };
  if (!out.title) fail("invalid-argument", "Give your M&G a name.");
  if (!out.venue.name || !out.venue.address || !out.venue.city) fail("invalid-argument", "Add the place's name, street address and city.");
  if (!PHONE_RE.test(out.venue.phone)) fail("invalid-argument", "Add the place's phone number so we can confirm the booking.");
  if (!official) {
    if (!EMAIL_RE.test(out.contact.email)) fail("invalid-argument", "Add an email we can reach you at.");
    if (!PHONE_RE.test(out.contact.phone)) fail("invalid-argument", "Add a phone number we can reach you at.");
    if (!(out.startsAt > Date.now() + 24 * 3600000)) fail("invalid-argument", "Pick a time at least 24 hours away, so there's time to review it and sell spots.");
  } else if (!(out.startsAt > Date.now() + 3 * 3600000)) fail("invalid-argument", "Pick a time at least 3 hours away.");
  if (!(out.price >= 500)) fail("invalid-argument", "The price per spot has to be at least $5.");
  if (out.price > 500000) fail("invalid-argument", "That price is too high.");
  if (!(out.spots >= 1 && out.spots <= 500)) fail("invalid-argument", "Spots: 1 to 500.");
  return out;
}
function publicFields(c, host) {
  let hue = 0; c.title.split("").forEach(ch => { hue = (hue * 31 + ch.charCodeAt(0)) % 360; });
  return { title: c.title, about: c.about, category: c.category, items: c.items, imageURL: c.imageURL || host.photo || "", hue,
    startsAt: fromMs(c.startsAt), price: c.price, spots: c.spots, venueName: c.venue.name, city: c.venue.city, idCheck: !!c.idCheck };
}
const ID_MSG = "This one is 21+ with ID checked at the door. Confirm you'll bring a valid photo ID.";
/** 21+ events: the buyer (or invited guest) has to confirm they'll bring a photo ID. */
function needIdOk(x, req) { if (x && x.idCheck && req.data?.idOk !== true) fail("failed-precondition", ID_MSG); }

/** First time someone books or hosts: their birth year comes with the request, so there's no separate setup step. */
async function memberFor(uid, birthYear) {
  const m = await getMember(uid);
  if (m) return m;
  const s = await getSettings();
  const by = Math.round(Number(birthYear));
  if (!by || by < 1900) fail("failed-precondition", "Enter your birth year to continue.");
  if (new Date().getFullYear() - by < s.minAge) fail("failed-precondition", `M&G is for people ${s.minAge} and older.`);
  const p = await whisperProfile(uid);
  const doc = { name: p.name, photo: p.photo, birthYear: by, deposit: { status: "none" }, strikes: 0, verified: false, idUploaded: false, createdAt: nowTs() };
  await db.doc(`members/${uid}`).set(doc, { merge: true });
  return { id: uid, ...doc };
}
function notSuspended(m) {
  if (m.suspendedUntil && ms(m.suspendedUntil) > Date.now()) fail("failed-precondition", `You're on a break from M&G until ${fmtWhen(m.suspendedUntil)}.`);
}

/** Host submits a new M&G. Returns a checkout link for the host deposit. */
exports.createMeetup = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  notSuspended(await memberFor(uid, req.data?.birthYear));
  const c = cleanMeetup(req.data || {});
  const host = await whisperProfile(uid);
  const need = hostDepositFor(c.spots, c.price), have = await depositOnFile(uid);
  const covered = have >= need;
  const ref = db.collection("meetups").doc();
  await ref.set({ ...publicFields(c, host), hostUid: uid, hostName: host.name, hostPhoto: host.photo, sold: 0, held: 0, buyerUids: [],
    hostFeePct: s.hostFee, status: covered ? "pending" : "draft", hidden: false, checkedIn: 0, hostDeposit: { status: covered ? "held" : "unpaid", amount: need }, createdAt: nowTs() });
  await mtPrivate(ref.id).set({ venue: c.venue, contact: c.contact, hostUid: uid });
  await db.doc(`members/${uid}`).set({ hostContact: c.contact }, { merge: true }); // saved for next time
  if (covered) { await sentForReview(ref.id, c.title, host.name, uid); return { id: ref.id, url: null, message: `Sent for review. Your ${fmtMoney(have)} deposit on file covers it.` }; }
  const url = await checkoutFor({ kind: "hostdeposit", uid, email: c.contact.email || req.auth.token.email, amount: need - have, dateId: ref.id,
    name: have ? `Host deposit top-up · ${c.title}` : `Host deposit · ${c.title}`, description: "Stays on your account and covers every M&G you host. Only kept if you cancel late or don't show up." });
  return { id: ref.id, url };
});
async function sentForReview(id, title, hostName, hostUid) {
  for (const a of ADMIN_UIDS) await push(a, "New M&G to review", `${title} by ${hostName}`, `${APP_URL}/admin.html`);
  await push(hostUid, "Sent for review", `${title} will go on sale once it's approved, usually within a day. We may call to confirm details.`);
}

/** Pay the host deposit again (e.g. checkout was closed). */
exports.payHostDeposit = onCall(withStripe, async req => {
  const uid = requireUser(req);
  const id = str(req.data?.meetupId, 64), x = (await mtRef(id).get()).data();
  if (!x || x.hostUid !== uid) fail("permission-denied", "Not your M&G.");
  if (x.status !== "draft") fail("failed-precondition", "The deposit is already paid.");
  const p = (await mtPrivate(id).get()).data() || {};
  const need = hostDepositFor(x.spots, x.price), have = await depositOnFile(uid);
  if (x.hostDeposit?.amount !== need) await mtRef(id).update({ "hostDeposit.amount": need });
  if (have >= need) {
    await mtRef(id).update({ status: "pending", "hostDeposit.status": "held" });
    await sentForReview(id, x.title, x.hostName, uid);
    return { url: null, message: "Sent for review. Your deposit on file covers it." };
  }
  return { url: await checkoutFor({ kind: "hostdeposit", uid, email: (p.contact || {}).email || req.auth.token.email, amount: need - have, dateId: id, name: `Host deposit · ${x.title}`, description: "Stays on your account and covers every M&G you host." }) };
});

/** Host edits their M&G. Before any sales everything can change; after, only the description, spots (up) and contact info. */
exports.editMeetup = onCall(async req => {
  const uid = requireUser(req);
  const id = str(req.data?.meetupId, 64), ref = mtRef(id), x = (await ref.get()).data();
  if (!x || x.hostUid !== uid) fail("permission-denied", "Not your M&G.");
  if (!OPEN_STATUSES.includes(x.status)) fail("failed-precondition", "This M&G can't be edited anymore.");
  const cur = (await mtPrivate(id).get()).data() || {};
  const sold = (x.sold || 0) + (x.held || 0);
  const d = req.data.data || {};
  const c = cleanMeetup(sold ? { ...d, startsAt: Date.now() + 25 * 3600000, price: x.price / 100, spots: Math.max(x.spots, Number(d.spots) || 0) } : d);
  if (x.hostDeposit?.status === "held") {
    const need = hostDepositFor(sold ? Math.max(x.spots, c.spots) : c.spots, sold ? x.price : c.price), have = await depositOnFile(uid);
    if (need > have) fail("failed-precondition", `That needs a ${fmtMoney(need)} deposit and you have ${fmtMoney(have)} on file. Cancel this one (nothing is lost before anyone buys) and post it again to add the difference.`);
  }
  const host = await whisperProfile(uid);
  const pub = publicFields(c, host);
  if (sold) {
    // Locked once people have paid: time, price and place.
    if (c.venue.name !== cur.venue?.name || c.venue.address !== cur.venue?.address) fail("failed-precondition", "People already bought spots, so the place can't change. Contact support if you need to move it.");
    pub.startsAt = x.startsAt; pub.price = x.price; pub.venueName = x.venueName; pub.city = x.city; pub.idCheck = !!x.idCheck; // buyers agreed to what it was
    if (c.spots < sold) fail("invalid-argument", `You've already sold ${sold}.`);
  }
  const major = !sold && (c.price !== x.price || c.startsAt !== ms(x.startsAt) || c.venue.address !== cur.venue?.address || c.venue.name !== cur.venue?.name);
  const status = x.status === "changes" ? "pending" : x.status === "live" && major ? "pending" : x.status;
  await ref.update({ ...pub, status, changesNote: status === "pending" ? FieldValue.delete() : (x.changesNote || FieldValue.delete()), editedAt: nowTs(),
    ...(x.status === "draft" ? { "hostDeposit.amount": hostDepositFor(c.spots, c.price) } : {}) });
  await mtPrivate(id).set({ venue: sold ? cur.venue : c.venue, contact: c.contact, hostUid: uid });
  await db.doc(`members/${uid}`).set({ hostContact: c.contact }, { merge: true });
  return { message: status === "pending" && x.status !== "pending" ? "Saved and sent for review" : "Saved", status };
});

/** Admin posts (or edits) an official Whisper+Me M&G. It's live right away. */
async function postOfficialMeetup(req, id, data) {
  const c = cleanMeetup(data || {}, { official: true });
  const site = { name: "Whisper+Me", photo: `${APP_URL}/icon-192.png` };
  if (!id) {
    const ref = db.collection("meetups").doc();
    await ref.set({ ...publicFields(c, site), hostUid: req.auth.uid, hostName: site.name, hostPhoto: site.photo, official: true, sold: 0, held: 0, buyerUids: [],
      hostFeePct: 100, status: "live", hidden: false, checkedIn: 0, hostDeposit: null, createdAt: nowTs(), approvedAt: nowTs() });
    await mtPrivate(ref.id).set({ venue: c.venue, contact: { email: req.auth.token.email || "", phone: "" }, hostUid: req.auth.uid });
    return { id: ref.id, message: `“${c.title}” is live for everyone` };
  }
  const ref = mtRef(id), x = (await ref.get()).data();
  if (!x) fail("not-found", "Not found.");
  const cur = (await mtPrivate(id).get()).data() || {};
  const sold = (x.sold || 0) + (x.held || 0);
  const pub = publicFields(c, site);
  if (sold) {
    if (c.price !== x.price || c.startsAt !== ms(x.startsAt) || c.venue.address !== cur.venue?.address) fail("failed-precondition", "People already bought spots, so the time, price and place are locked. Cancel & refund it and post a new one if they must change.");
    if (c.spots < sold) fail("invalid-argument", `Already sold ${sold}.`);
  }
  await ref.update({ ...pub, editedAt: nowTs() });
  await mtPrivate(id).set({ ...cur, venue: c.venue }, { merge: true });
  return { id, message: `“${c.title}” updated` };
}

const MAX_SPOTS_PER_ORDER = 6;
/** One checkout for you (and up to 5 friends). One code covers the whole group. */
exports.buyMeetupSpot = onCall(withStripe, async req => {
  const uid = requireUser(req);
  notSuspended(await memberFor(uid, req.data?.birthYear));
  const id = str(req.data?.meetupId, 64);
  const qty = Math.min(MAX_SPOTS_PER_ORDER, Math.max(1, Math.round(Number(req.data?.qty) || 1)));
  const ref = mtRef(id), spotRef = ref.collection("spots").doc(uid);
  let x, total = 0, credit = 0, code = null;
  await db.runTransaction(async tx => {
    x = (await tx.get(ref)).data();
    const spot = (await tx.get(spotRef)).data();
    const c = (await tx.get(creditRef(uid))).data();
    if (!x || x.status !== "live" || x.hidden) fail("failed-precondition", "This M&G isn't available.");
    if (x.hostUid === uid && !x.official) fail("failed-precondition", "You're the host.");
    needIdOk(x, req);
    if (ms(x.startsAt) < Date.now() + 2 * 3600000) fail("failed-precondition", "Sales for this one have closed.");
    if (spot && spot.status === "paid") fail("already-exists", "You already have your spot (code under My tickets). Friends can get their own: tap Share and send them the link.");
    const fresh = spot && spot.status === "pending" && ms(spot.createdAt) > Date.now() - MEETUP_PAY_MINUTES * 60000;
    const holding = fresh ? (spot.qty || 1) : 0; // a checkout they started a few minutes ago
    const left = x.spots - x.sold - x.held + holding;
    if (left < qty) fail("resource-exhausted", left > 0 ? `Only ${left} spot${left === 1 ? "" : "s"} left.` : "Sold out.");
    total = x.price * qty; credit = Math.min(total, c?.balance || 0);
    if (credit >= total) {
      // Their Whisper+Me credit covers it: no checkout, no card fee.
      const t = takeCredit(c, total);
      code = newCode();
      tx.set(creditRef(uid), t.next);
      tx.update(ref, { held: FieldValue.increment(-holding), sold: FieldValue.increment(qty), buyerUids: FieldValue.arrayUnion(uid) });
      tx.set(spotRef, { uid, role: "buyer", status: "paid", qty, code, paid: total, ...(x.idCheck ? { idOkAt: Date.now() } : {}), cardPaid: 0, creditFrom: t.from, paymentIntent: null, paidAt: nowTs(), createdAt: nowTs() });
      tx.set(db.doc(`meetupCodes/${code}`), { meetupId: id, uid, role: "buyer" });
      return;
    }
    tx.update(ref, { held: FieldValue.increment(qty - holding) });
    tx.set(spotRef, { uid, role: "buyer", status: "pending", qty, creditToUse: credit, createdAt: nowTs(), ...(x.idCheck ? { idOkAt: Date.now() } : {}) });
  });
  const me = await whisperProfile(uid);
  await spotRef.set({ name: me.name, photo: me.photo }, { merge: true });
  if (code) { await afterMeetupSale(id, x, uid, qty); return { done: true, code, message: `You're in! Paid with ${fmtMoney(total)} of your Whisper+Me credit.` }; }
  const name = `${x.title} · M&G${x.official ? "" : " with " + x.hostName}`, description = `${fmtWhen(x.startsAt)} · ${x.venueName}, ${x.city}. The exact address and your code show in the app right after you pay.`;
  const url = credit > 0
    ? await checkoutFor({ kind: "meetup", uid, email: req.auth.token.email, amount: total - credit, dateId: id, name: `${qty > 1 ? qty + " spots · " : ""}${name} (after ${fmtMoney(credit)} credit)`, description })
    : await checkoutFor({ kind: "meetup", uid, email: req.auth.token.email, amount: x.price, qty, dateId: id, name, description });
  return { url };
});
async function afterMeetupSale(id, x, uid, qty) {
  const p = (await mtPrivate(id).get()).data() || {};
  await push(uid, "You're in!", `${x.title} · ${fmtWhen(x.startsAt)} at ${p.venue?.name || x.venueName}, ${p.venue?.address || x.city}. Your code is under My tickets.`);
  if (!x.official) await push(x.hostUid, qty > 1 ? `${qty} spots just sold` : "Someone bought a spot", `${x.title}: ${(x.sold || 0) + qty} of ${x.spots} sold.`);
  const spot = (await mtRef(id).collection("spots").doc(uid).get()).data() || {};
  await emailMeetupTicket(id, x, p, spot, "receipt");
  if (!x.official) await sendEmail(x.hostUid, `${qty > 1 ? qty + " spots" : "A spot"} sold: ${x.title}`, {
    heading: qty > 1 ? `${qty} spots just sold 🎉` : "Someone bought a spot 🎉",
    intro: `${spot.name || "A member"} is coming to ${x.title}.`,
    rows: [["Sold", `${(x.sold || 0) + qty} of ${x.spots}`], ["When", fmtWhen(x.startsAt)]],
    button: ["Share it to sell more", `${APP_URL}/m/${id}`],
    after: "On the day, check guests in by their codes (My tickets → your M&G → Check in). You're paid a few days after the M&G." });
}
/** The ticket email: right after buying ("receipt") and the day before ("reminder"). */
async function emailMeetupTicket(id, x, p, spot, kind) {
  if (!spot || !spot.uid || spot.status !== "paid") return false;
  const qty = spot.qty || 1, start = ms(x.startsAt);
  const place = [p.venue?.name || x.venueName, p.venue?.address, p.venue?.city || x.city].filter(Boolean).join(", ");
  const cal = calendarLinks({ title: `M&G: ${x.title}`, start, place, details: `Your code: ${spot.code}. Show it at the door. ${APP_URL}` });
  const paid = spot.paid != null ? spot.paid : x.price * qty, card = spot.cardPaid != null ? spot.cardPaid : paid;
  const remind = kind === "reminder";
  return sendEmail(spot.uid, remind ? `Tomorrow: ${x.title}` : `You're in: ${x.title}`, {
    heading: remind ? `See you tomorrow at ${x.title}` : "You're in! 🎉",
    intro: remind ? `Here's everything you need for ${fmtWhen(start)}.` : `Your spot${qty > 1 ? "s" : ""} for ${x.title} ${qty > 1 ? "are" : "is"} confirmed. Show this code at the door.`,
    code: spot.code,
    rows: [["What", x.title], ["When", fmtWhen(start) + " (Central)"], ["Where", place], ["Venue phone", p.venue?.phone || ""], ["Spots", qty > 1 ? `${qty} (one code covers your group)` : "1"], ["ID", x.idCheck ? "21+: bring a valid photo ID, it's checked at the door" : ""],
      ...(remind ? [] : [["Paid", fmtMoney(paid) + (card < paid ? ` (${fmtMoney(paid - card)} from your credit)` : "")]])],
    button: ["Open My tickets", `${APP_URL}/?dates=1`],
    cal,
    after: remind ? "Can't make it? Spots aren't refunded, but you can give yours to a friend: they just show your code." : "Spots aren't refunded, but if the M&G is canceled you get the full amount back as Whisper+Me credit right away." }, { ics: cal.ics });
}

/** Send leftover Whisper+Me credit back to the card(s) it came from. */
exports.creditToCard = onCall(withStripe, async req => {
  const uid = requireUser(req);
  let sent = 0, kept = 0;
  const c = (await creditRef(uid).get()).data() || { balance: 0, sources: [] };
  const keep = [];
  for (const x of c.sources || []) {
    if (!(x.left > 0)) continue;
    if (!x.pi || Date.now() - (x.at || 0) > 170 * 86400000) { keep.push(x); kept += x.left; continue; }
    try { await stripe().refunds.create({ payment_intent: x.pi, amount: x.left }); sent += x.left; }
    catch (e) { logger.error("credit refund", uid, e.message); keep.push(x); kept += x.left; }
  }
  await creditRef(uid).set({ balance: kept, sources: keep });
  if (sent) await db.collection("ledger").add({ kind: "creditRefunded", uid, amount: sent, at: nowTs() });
  if (!sent) fail("failed-precondition", kept ? "This credit can't go back to a card (it's too old or wasn't paid by card). You can still use it on any M&G." : "You don't have any credit.");
  return { sent, kept, message: `${fmtMoney(sent)} is on its way back to your card (5–10 days).${kept ? ` ${fmtMoney(kept)} stays as credit.` : ""}` };
});

/** What Stripe actually charged us for a payment (falls back to the standard 2.9% + 30¢). */
async function stripeFeeFor(pi, amount) {
  try {
    const p = await stripe().paymentIntents.retrieve(pi, { expand: ["latest_charge.balance_transaction"] });
    const fee = p?.latest_charge?.balance_transaction?.fee;
    if (Number.isFinite(fee)) return fee;
  } catch (e) { /* estimate below */ }
  return Math.round(amount * 0.029) + 30;
}

async function onMeetupPaid(sess) {
  const { dateId: id, uid } = sess.metadata || {};
  if (sess.payment_status !== "paid") return;
  const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id;
  const ref = mtRef(id), spotRef = ref.collection("spots").doc(uid);
  let code = null, undo = false, x, qty = 1;
  await db.runTransaction(async tx => {
    x = (await tx.get(ref)).data();
    const spot = (await tx.get(spotRef)).data();
    const c = spot?.creditToUse ? (await tx.get(creditRef(uid))).data() : null;
    if (spot && spot.status === "paid") return; // repeat webhook
    if (!x || x.status !== "live" || !spot || spot.status !== "pending") { undo = true; return; }
    qty = spot.qty || 1;
    const t = c ? takeCredit(c, spot.creditToUse) : { used: 0, from: [] };
    if (c) tx.set(creditRef(uid), t.next);
    code = newCode();
    tx.update(spotRef, { status: "paid", code, paymentIntent: pi, cardPaid: sess.amount_total, creditFrom: t.from, paid: sess.amount_total + t.used, paidAt: nowTs() });
    tx.update(ref, { held: FieldValue.increment(-qty), sold: FieldValue.increment(qty), buyerUids: FieldValue.arrayUnion(uid) });
    tx.set(db.doc(`meetupCodes/${code}`), { meetupId: id, uid, role: "buyer" });
  });
  if (undo) { await addCredit(uid, [{ pi, amount: sess.amount_total }], "Payment for an M&G that had closed"); return; }
  if (!code) return;
  // Card fees come out of the site's share; keep a record so the admin sees what we really made.
  const fee = await stripeFeeFor(pi, sess.amount_total || x.price * qty);
  await spotRef.update({ stripeFee: fee });
  await ref.update({ stripeFees: FieldValue.increment(fee) });
  await afterMeetupSale(id, x, uid, qty);
}

async function onHostDepositPaid(sess) {
  const { dateId: id } = sess.metadata || {};
  if (sess.payment_status !== "paid") return;
  const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id;
  const ref = mtRef(id), x = (await ref.get()).data();
  const uid = sess.metadata?.uid || x?.hostUid;
  await addToDeposit(uid, sess.amount_total, pi); // always lands on their account, even if the M&G is gone
  if (!x || x.hostDeposit?.paymentIntent === pi) return;
  await ref.update({ status: x.status === "draft" ? "pending" : x.status, hostDeposit: { status: "held", amount: x.hostDeposit?.amount || sess.amount_total, paymentIntent: pi, paidAt: nowTs() } });
  await db.collection("ledger").add({ kind: "hostDepositPaid", uid, meetupId: id, amount: sess.amount_total, at: nowTs() });
  await sendEmail(uid, `Deposit received: ${x.title}`, {
    heading: "Your host deposit is in",
    intro: `Thanks! ${x.title} is now with us for a quick review. We'll let you know as soon as it's live.`,
    rows: [["Paid", fmtMoney(sess.amount_total)], ["On file now", fmtMoney(await depositOnFile(uid))]],
    after: "Your deposit stays on your account and covers every M&G you host, so you only pay it once. It's only kept if you cancel late or don't show up." });
  if (x.status === "draft") await sentForReview(id, x.title, x.hostName, uid);
}

/** The M&G is over (or canceled early / not approved): its deposit simply stays on the host's account for next time. */
async function releaseHostDeposit(id, x, why) {
  const dep = x.hostDeposit || {};
  if (dep.status !== "held") return false;
  await mtRef(id).update({ "hostDeposit.status": "onFile", "hostDeposit.why": why });
  return true;
}
/** Late cancel or no-show: this M&G's share of the deposit is kept (it pays for the refunds). */
async function keepHostDeposit(id, x, why) {
  const dep = x.hostDeposit || {};
  if (dep.status !== "held") return false;
  const ref = db.doc(`members/${x.hostUid}`);
  let kept = 0;
  await db.runTransaction(async tx => {
    const m = (await tx.get(ref)).data() || {};
    const d = m.hostDeposit || { held: 0, payments: [] };
    kept = Math.min(d.held || 0, dep.amount || 0);
    let need = kept; const payments = (d.payments || []).map(p => ({ ...p }));
    for (const p of payments) { const t = Math.min(p.left || 0, need); p.left -= t; need -= t; if (!need) break; }
    tx.set(ref, { hostDeposit: { held: (d.held || 0) - kept, payments: payments.filter(p => p.left > 0) } }, { merge: true });
  });
  await mtRef(id).update({ "hostDeposit.status": "kept", "hostDeposit.kept": kept, "hostDeposit.keptAt": nowTs(), "hostDeposit.why": why });
  if (kept) await rtdb.ref("siteRevenue").transaction(v => Math.round(((Number(v) || 0) + kept / 100) * 100) / 100);
  await db.collection("ledger").add({ kind: "hostDepositKept", uid: x.hostUid, meetupId: id, amount: kept, why, at: nowTs() });
  return true;
}

/** Host (or an admin) checks a guest in at the M&G with the guest's code. */
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
  const already = !!spot.checkedInAt, qty = spot.qty || 1;
  if (!already) { await spotRef.update({ checkedInAt: nowTs() }); await ref.update({ checkedIn: FieldValue.increment(qty) }); }
  return { guest: (spot.name || "Guest") + (qty > 1 ? ` +${qty - 1}` : ""), qty, already, title: x.title, idCheck: !!x.idCheck };
});

/** A buyer reports a problem (host didn't show, it didn't happen…). Holds the host's payout for the admin. */
exports.reportMeetup = onCall(async req => {
  const uid = requireUser(req);
  const id = str(req.data?.meetupId, 64), ref = mtRef(id), x = (await ref.get()).data();
  if (!x) fail("not-found", "Not found.");
  const spot = (await ref.collection("spots").doc(uid).get()).data();
  if (!spot || spot.status !== "paid") fail("permission-denied", "Only people with a spot can report this M&G.");
  if (!["live", "paying", "review"].includes(x.status)) fail("failed-precondition", "This M&G is already settled. Contact support.");
  const reason = str(req.data?.reason, 80) || "Something else", detail = str(req.data?.detail, 1000);
  await db.collection("reports").add({ about: x.hostUid, aboutType: "user", by: uid, meetupId: id, reason, detail, status: "open", createdAt: nowTs() });
  await ref.collection("spots").doc(uid).update({ reported: true, reportedAt: nowTs() });
  const up = { reported: FieldValue.increment(1), lastReport: `${reason}${detail ? ": " + detail.slice(0, 200) : ""}` };
  if (x.status === "paying") Object.assign(up, { status: "review", reviewSince: nowTs() });
  await ref.update(up);
  for (const a of ADMIN_UIDS) await push(a, "M&G problem reported", `${x.title}: ${reason}. The host's payout is on hold.`, `${APP_URL}/admin.html`);
  return { message: "Thanks for telling us. The host isn't paid until we've looked into it." };
});

/** Invite another member to an M&G: they get a notification that opens it. */
exports.inviteToMeetup = onCall(async req => {
  const uid = requireUser(req);
  const id = str(req.data?.meetupId, 64), to = str(req.data?.uid, 128);
  if (!to || to === uid) fail("invalid-argument", "Pick someone to invite.");
  const x = (await mtRef(id).get()).data();
  if (!x || x.status !== "live" || x.hidden) fail("failed-precondition", "This M&G isn't on sale.");
  const day = dayKey(new Date());
  const cnt = db.doc(`members/${uid}`);
  const n = await db.runTransaction(async tx => {
    const m = (await tx.get(cnt)).data() || {};
    const used = m.invitesDay === day ? (m.invitesUsed || 0) : 0;
    if (used >= 30) fail("resource-exhausted", "That's a lot of invites for one day. Try again tomorrow.");
    tx.set(cnt, { invitesDay: day, invitesUsed: used + 1 }, { merge: true });
    return used + 1;
  });
  const me = await whisperProfile(uid);
  await push(to, `${me.name} invited you to an M&G`, `${x.title} · ${fmtWhen(x.startsAt)} at ${x.venueName}. ${fmtMoney(x.price)} a spot.`, `${APP_URL}/?dates=1&meetup=${id}`);
  return { message: "Invite sent", used: n };
});

async function refundMeetup(id, reason) {
  const ref = mtRef(id);
  const x = await db.runTransaction(async tx => {
    const v = (await tx.get(ref)).data();
    if (!v || !["live", "review", "paying", "pending", "changes", "draft"].includes(v.status)) return null;
    tx.update(ref, { status: "canceled", canceledReason: reason, canceledAt: nowTs() });
    return v;
  });
  if (!x) return false;
  const spots = await ref.collection("spots").get();
  let refunded = 0;
  for (const d of spots.docs) {
    const sp = d.data();
    if (sp.status === "paid") {
      // Back as Whisper+Me credit right away (no card fees); they can send it to their card from My tickets.
      const back = await addCredit(sp.uid, [{ pi: sp.paymentIntent, amount: sp.cardPaid ?? sp.paid ?? x.price }, ...(sp.creditFrom || [])], `Refund: ${x.title}`);
      await d.ref.update({ status: "refunded", refundedAs: "credit", refundAmount: back }); refunded++;
      await push(sp.uid, "M&G canceled", `${x.title}: ${reason} ${fmtMoney(back)} is back in your Whisper+Me credit. Use it on any M&G, or send it to your card from My tickets.`);
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
  if (!OPEN_STATUSES.includes(x.status)) fail("failed-precondition", "This M&G can't be canceled anymore. Contact support.");
  const late = ms(x.startsAt) - Date.now() < s.lateCancelHours * 3600000;
  const keep = late && x.sold > 0 && !x.official;
  if (req.data?.preview) {
    return { lines: [x.sold ? `Everyone who bought a spot (${x.sold}) gets their money back.` : "Nobody has bought a spot yet.",
      x.hostDeposit?.status === "held" ? (keep ? `It's within ${s.lateCancelHours} hours, so ${fmtMoney(x.hostDeposit.amount)} of your deposit is kept and it counts as a strike.` : "Your deposit stays on your account for your next M&G.") : ""].filter(Boolean) };
  }
  await refundMeetup(id, "The host canceled.");
  if (keep) { await keepHostDeposit(id, x, "Canceled late"); await addStrike(uid, s, "Canceled an M&G late"); }
  else await releaseHostDeposit(id, x, "Canceled early");
  return { message: keep ? "Canceled. Buyers got their money back; part of your deposit was kept." : "Canceled. Buyers got their money back; your deposit stays on your account." };
});

/** Your tickets and the M&Gs you host. Buyers get the address and phone; hosts get everything plus the guest list. */
exports.myMeetups = onCall(async req => {
  const uid = requireUser(req);
  const s = await getSettings();
  const [hosted, bought, mem] = await Promise.all([
    db.collection("meetups").where("hostUid", "==", uid).orderBy("startsAt", "desc").limit(30).get(),
    db.collection("meetups").where("buyerUids", "array-contains", uid).limit(30).get(),
    getMember(uid)
  ]);
  const out = [], seen = new Set();
  for (const d of [...hosted.docs, ...bought.docs]) {
    const x = d.data(), host = x.hostUid === uid;
    const spot = (await d.ref.collection("spots").doc(uid).get()).data() || {};
    const paid = spot.status === "paid";
    // An admin who bought a spot at their own official M&G sees both the host card and the ticket.
    const views = host && paid ? [true, false] : [host];
    if (!host && !paid && !["refunded"].includes(spot.status)) continue;
    const p = host || paid ? ((await mtPrivate(d.id).get()).data() || {}) : {};
    const pct = x.hostFeePct ?? 10;
    let guests = null;
    if (host && ["live", "paying", "review", "completed"].includes(x.status) && x.sold) {
      const g = await d.ref.collection("spots").where("status", "==", "paid").limit(500).get();
      guests = g.docs.map(z => ({ name: (z.data().name || "Guest") + ((z.data().qty || 1) > 1 ? ` +${z.data().qty - 1}` : ""), here: !!z.data().checkedInAt }));
    }
    const settledAt = ms(x.startsAt) + (s.hostPayoutHours || 72) * 3600000;
    for (const asHost of views) {
      const key = d.id + (asHost ? "h" : "b"); if (seen.has(key)) continue; seen.add(key);
      out.push({ id: d.id, host: asHost, official: !!x.official, title: x.title, about: x.about, category: x.category, items: x.items || [], venueName: x.venueName, city: x.city,
        startsAt: ms(x.startsAt), status: x.status, hidden: !!x.hidden, price: x.price, spots: x.spots, sold: x.sold, checkedIn: x.checkedIn || 0, hostName: x.hostName, hostPhoto: x.hostPhoto || "",
        imageURL: x.imageURL || "", hue: x.hue, changesNote: asHost ? (x.changesNote || "") : "",
        code: !asHost && paid ? spot.code : "", qty: spot.qty || 1, spotStatus: spot.status || "", guestCheckedIn: !!spot.checkedInAt, reported: !!spot.reported,
        canReport: !asHost && paid && ["live", "paying", "review"].includes(x.status) && Date.now() > ms(x.startsAt) - 2 * 3600000,
        address: (asHost || paid) ? (p.venue?.address || "") : "", venuePhone: (asHost || paid) ? (p.venue?.phone || "") : "",
        venue: asHost ? (p.venue || null) : null, contact: asHost ? (p.contact || null) : null,
        hostDeposit: asHost ? (x.hostDeposit || null) : null, guests: asHost ? guests : null,
        payoutAt: asHost ? (ms(x.payoutAt) || settledAt) : 0, hostEarned: asHost ? (x.hostEarned || 0) : 0,
        hostCut: asHost && !x.official ? Math.round(x.price * (100 - pct) / 100) : 0,
        idCheck: !!x.idCheck, rating: avgOf(x.rating), ratings: x.rating?.n || 0,
        canRate: !asHost && paid && rateWindow(ms(x.startsAt)) && ["live", "paying", "review", "completed"].includes(x.status) });
    }
  }
  out.sort((a, b) => b.startsAt - a.startsAt);
  const mineR = await ratingsFor(uid, "mg", out.filter(z => z.canRate).map(z => z.id));
  out.forEach(z => { if (z.canRate) z.myStars = mineR[z.id] || 0; });
  const cr = (await creditRef(uid).get()).data() || {};
  return { meetups: out, hostContact: mem?.hostContact || null, credit: cr.balance || 0, depositOnFile: mem?.hostDeposit?.held || 0,
    member: mem ? { birthYear: !!mem.birthYear, strikes: mem.strikes || 0, suspendedUntil: ms(mem.suspendedUntil) || 0 } : null };
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
          tx.update(d.ref, { held: FieldValue.increment(-(cur.qty || 1)) });
        });
      }
    }
    if (ms(x.startsAt) < now - SETTLE_AFTER_HOURS * 3600000) await settleMeetup(d.id, s);
    else await meetupReminders(d, x, now);
  }
  // Hosts are paid a few days after their M&G, if nobody reported a problem.
  const paying = await db.collection("meetups").where("status", "==", "paying").limit(300).get();
  for (const d of paying.docs) {
    const x = d.data();
    if (ms(x.payoutAt) <= now && !x.reported) await payHost(d.id, x, s);
  }
  // Drafts whose deposit was never paid disappear after a day.
  const drafts = await db.collection("meetups").where("status", "==", "draft").limit(200).get();
  for (const d of drafts.docs) if (ms(d.data().createdAt) < now - 86400000) await d.ref.update({ status: "expired" });
}

const REMIND_BEFORE_MS = 24 * 3600000;
/** Claims a "reminded" flag once, so two housekeeping runs never both send. */
async function claimReminder(ref) {
  return db.runTransaction(async tx => {
    const cur = (await tx.get(ref)).data();
    if (!cur || cur.remindedAt) return false;
    tx.update(ref, { remindedAt: nowTs() });
    return true;
  });
}
/** The day before an M&G: every guest gets their code, place and time again; the host gets a checklist. */
async function meetupReminders(d, x, now) {
  const start = ms(x.startsAt);
  if (x.remindedAt || !x.sold || start - now > REMIND_BEFORE_MS || start < now + 3600000) return 0;
  if (!(await claimReminder(d.ref))) return 0;
  const p = (await mtPrivate(d.id).get()).data() || {};
  const spots = await d.ref.collection("spots").where("status", "==", "paid").limit(500).get();
  let n = 0;
  for (const sp of spots.docs) {
    const spot = sp.data();
    await push(spot.uid, "Tomorrow: " + x.title, `${fmtWhen(start)} at ${p.venue?.name || x.venueName}. Your code is under My tickets.`);
    if (await emailMeetupTicket(d.id, x, p, spot, "reminder")) n++;
  }
  if (!x.official) {
    await push(x.hostUid, `Tomorrow: ${x.title}`, `${x.sold} spot${x.sold === 1 ? "" : "s"} sold. Check guests in by their codes when they arrive.`);
    await sendEmail(x.hostUid, `Tomorrow you're hosting ${x.title}`, {
      heading: "You're hosting tomorrow 🙌", intro: "A quick checklist so it goes smoothly:",
      rows: [["When", fmtWhen(start) + " (Central)"], ["Where", [p.venue?.name, p.venue?.address].filter(Boolean).join(", ")], ["Guests", `${x.sold} of ${x.spots} spots sold`],
        ["1", "Call the venue today to confirm your table or booking"], ["2", "Get there 10 minutes early"], ["3", "Check each guest in by their code: My tickets → your M&G → Check in"]],
      button: ["Open my M&G", `${APP_URL}/?dates=1`],
      after: "You're paid a few days after, once guests are checked in. If something comes up, cancel as early as you can: a late cancel or no-show keeps part of your deposit." });
  }
  return n;
}

async function payHost(id, x, s) {
  const pct = x.official ? 100 : (x.hostFeePct ?? s.hostFee);
  const gross = x.price * x.sold;
  const hostTotal = Math.round(gross * (100 - pct) / 100), siteTotal = gross - hostTotal;
  if (hostTotal) await rtdb.ref(`users/${x.hostUid}/earnings`).transaction(e => Math.round(((Number(e) || 0) + hostTotal / 100) * 100) / 100);
  if (siteTotal) await rtdb.ref("siteRevenue").transaction(v => Math.round(((Number(v) || 0) + siteTotal / 100) * 100) / 100);
  const cardFees = x.stripeFees || 0, siteNet = siteTotal - cardFees;
  await db.collection("ledger").add({ kind: "meetupSettled", meetupId: id, hostUid: x.hostUid, official: !!x.official, sold: x.sold, hostEarned: hostTotal, siteFee: siteTotal, cardFees, siteNet, at: nowTs() });
  const day = dayKey(new Date());
  await db.doc(`stats/day-${day}`).set({ day, fees: FieldValue.increment(siteTotal), cardFees: FieldValue.increment(cardFees), meetups: FieldValue.increment(1) }, { merge: true });
  await mtRef(id).update({ status: "completed", completedAt: nowTs(), hostEarned: hostTotal, siteFee: siteTotal, siteNet });
  await releaseHostDeposit(id, x, "M&G happened");
  if (hostTotal) await push(x.hostUid, "You got paid", `${fmtMoney(hostTotal)} from ${x.title} was added to your Whisper+Me earnings.`);
  return hostTotal;
}

async function settleMeetup(id, s) {
  const x = (await mtRef(id).get()).data();
  if (!x || x.status !== "live") return;
  if (x.official || !x.sold) { await payHost(id, x, s); return; }
  if (x.checkedIn > 0 && !x.reported) {
    const payoutAt = ms(x.startsAt) + (s.hostPayoutHours || 72) * 3600000;
    const hostTotal = Math.round(x.price * x.sold * (100 - (x.hostFeePct ?? s.hostFee)) / 100);
    await mtRef(id).update({ status: "paying", payoutAt: fromMs(payoutAt) });
    const here = await mtRef(id).collection("spots").where("status", "==", "paid").limit(500).get();
    await askForRatings("mg", id, x, here.docs.filter(z => z.data().checkedInAt).map(z => z.data().uid));
    await push(x.hostUid, "Thanks for hosting!", `${fmtMoney(hostTotal)} from ${x.title} will be added to your earnings on ${fmtWhen(payoutAt)}.`);
    await sendEmail(x.hostUid, `Thanks for hosting ${x.title}`, {
      heading: "Thanks for hosting! 🙌", intro: `${x.checkedIn} guest${x.checkedIn === 1 ? "" : "s"} checked in. Here's what you made.`,
      rows: [["Spots sold", x.sold], ["Your share", fmtMoney(hostTotal)], ["Added to earnings", fmtWhen(payoutAt)]],
      button: ["Host another M&G", `${APP_URL}/?dates=1`],
      after: "Earnings are sent to your bank with the monthly payout once you've set up payouts in Profile → Wallet." });
    return;
  }
  // People paid but nobody was checked in (or a buyer reported a problem): the admin checks with the host and venue.
  await mtRef(id).update({ status: "review", reviewSince: nowTs() });
  for (const a of ADMIN_UIDS) await push(a, "M&G needs a look", `${x.title}: ${x.sold} sold, ${x.reported ? "a buyer reported a problem" : "nobody checked in"}. Pay the host or refund buyers.`, `${APP_URL}/admin.html`);
}

/* ═══════════════════════════════════════════════════════════════
   CONNECT ME 💞  (Groupon-style night-out packages, not M&Gs)
   You post a package for a set date and time, e.g. "Dinner for 2 at
   Ember & Oak, Fri 7 PM, $80". A member buys it, then invites whoever
   they want: a member on the site (they get a notification) or anyone
   with a link (they sign up free to accept). Everyone on the package
   gets their own code and the address.
   Check-in ("both of you were really there"):
     - each person taps "I'm here" at the venue: their phone's location
       has to be within about a quarter mile of the place, or
     - the venue reads you the codes and you check them in from the admin.
   The ticket money is the site's (you pay the venue yourself). No
   refunds once bought; if you cancel a package, buyers get credit.
   Collections: connects/{id} (+ private/info for the address),
   connectOrders/{id}, connectInvites/{token}, connectCodes/{code}.
═══════════════════════════════════════════════════════════════ */
const cnRef = id => db.doc(`connects/${id}`);
const cnPrivate = id => db.doc(`connects/${id}/private/info`);
const coRef = id => db.doc(`connectOrders/${id}`);
const CONNECT_PAY_MINUTES = 40;
const HERE_RADIUS_KM = 0.4;
function connectCode() { return makeCode().replace("WN-", "CM-"); }
function inviteToken() { return Array.from({ length: 10 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("").toLowerCase(); }
function kmBetween(a, b, c, d) {
  const r = x => x * Math.PI / 180, R = 6371;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const connectLink = token => `${APP_URL}/?connect=${token}`;

function cleanConnect(d) {
  const c = cleanMeetup({ ...d, spots: 1, contact: {} }, { official: true });
  const size = Number(d.size);
  if (![2, 3, 4].includes(size)) fail("invalid-argument", "A package is for 2, 3 or 4 people.");
  const quantity = Math.round(Number(d.quantity));
  if (!(quantity >= 1 && quantity <= 500)) fail("invalid-argument", "How many packages can be sold? 1 to 500.");
  return { ...c, size, quantity };
}
async function postConnect(req, id, data) {
  const c = cleanConnect(data);
  let hue = 0; c.title.split("").forEach(ch => { hue = (hue * 31 + ch.charCodeAt(0)) % 360; });
  const vk = venueKey(c.venue), vr = (await db.doc(`connectVenues/${vk}`).get()).data();
  const pub = { title: c.title, about: c.about, category: c.category, items: c.items, imageURL: c.imageURL, hue, startsAt: fromMs(c.startsAt), price: c.price, size: c.size, quantity: c.quantity, venueName: c.venue.name, city: c.venue.city,
    venueKey: vk, venueRating: vr && vr.n ? { avg: avgOf(vr), n: vr.n } : null, idCheck: c.idCheck };
  if (!id) {
    const ref = db.collection("connects").doc();
    await ref.set({ ...pub, sold: 0, held: 0, status: "live", hidden: false, stripeFees: 0, createdAt: nowTs() });
    await cnPrivate(ref.id).set({ venue: c.venue });
    return { id: ref.id, message: `“${c.title}” is live in Connect Me` };
  }
  const x = (await cnRef(id).get()).data();
  if (!x) fail("not-found", "Not found.");
  const cur = (await cnPrivate(id).get()).data() || {};
  const booked = (x.sold || 0) + (x.held || 0);
  if (booked && (c.price !== x.price || c.size !== x.size || c.startsAt !== ms(x.startsAt) || c.venue.address !== cur.venue?.address)) fail("failed-precondition", "People already bought this one, so the price, size, time and place are locked. Cancel it (buyers get credit) and post a new one.");
  if (c.quantity < booked) fail("invalid-argument", `Already sold ${booked}.`);
  await cnRef(id).update({ ...pub, editedAt: nowTs() });
  await cnPrivate(id).set({ venue: c.venue });
  return { id, message: `“${c.title}” updated` };
}

/** Buy a package. Credit is used first; if it covers everything there's no checkout (no card fee). */
exports.buyConnect = onCall(withStripe, async req => {
  const uid = requireUser(req);
  notSuspended(await memberFor(uid, req.data?.birthYear));
  const dealId = str(req.data?.dealId, 64);
  const me = await whisperProfile(uid);
  const oref = db.collection("connectOrders").doc();
  let x, credit = 0, paidNow = false;
  await db.runTransaction(async tx => {
    x = (await tx.get(cnRef(dealId))).data();
    const c = (await tx.get(creditRef(uid))).data();
    if (!x || x.status !== "live" || x.hidden) fail("failed-precondition", "This package isn't available.");
    needIdOk(x, req);
    if (ms(x.startsAt) < Date.now() + 2 * 3600000) fail("failed-precondition", "Sales for this one have closed.");
    if (x.quantity - x.sold - x.held < 1) fail("resource-exhausted", "Sold out.");
    credit = Math.min(x.price, c?.balance || 0);
    const base = { dealId, buyerUid: uid, buyerName: me.name, title: x.title, venueName: x.venueName, city: x.city, startsAt: x.startsAt, size: x.size, amount: x.price, memberUids: [uid], idCheck: !!x.idCheck, createdAt: nowTs() };
    if (credit >= x.price) {
      const t = takeCredit(c, x.price);
      tx.set(creditRef(uid), t.next);
      tx.set(oref, { ...base, status: "paid", cardPaid: 0, creditFrom: t.from, paymentIntent: null, paidAt: nowTs(), seats: [] });
      tx.update(cnRef(dealId), { sold: FieldValue.increment(1) });
      paidNow = true;
      return;
    }
    tx.set(oref, { ...base, status: "pending", creditToUse: credit, seats: [] });
    tx.update(cnRef(dealId), { held: FieldValue.increment(1) });
  });
  if (paidNow) { await issueConnectSeats(oref.id, me); return { done: true, orderId: oref.id, message: `Paid with ${fmtMoney(x.price)} of your Whisper+Me credit. Now invite your date!` }; }
  const url = await checkoutFor({ kind: "connect", uid, email: req.auth.token.email, amount: x.price - credit, dateId: oref.id,
    name: `Connect Me · ${x.title}${credit ? ` (after ${fmtMoney(credit)} credit)` : ""}`, description: `${fmtWhen(x.startsAt)} · ${x.venueName}, ${x.city}. For ${x.size}. After you pay, invite who you're bringing.` });
  return { url, orderId: oref.id };
});

/** Paid: the buyer gets a code; every other seat gets an invite link. */
async function issueConnectSeats(orderId, me) {
  const ref = coRef(orderId);
  const o = (await ref.get()).data();
  if (!o || (o.seats || []).length) return;
  const seats = [{ uid: o.buyerUid, name: me?.name || o.buyerName, photo: me?.photo || "", role: "buyer", status: "accepted", code: connectCode() }];
  for (let i = 1; i < o.size; i++) seats.push({ uid: null, name: "", role: "guest", status: "open", token: inviteToken() });
  const batch = db.batch();
  batch.update(ref, { seats });
  seats.forEach((st, i) => {
    if (st.code) batch.set(db.doc(`connectCodes/${st.code}`), { orderId, seat: i });
    if (st.token) batch.set(db.doc(`connectInvites/${st.token}`), { orderId, seat: i });
  });
  await batch.commit();
  await push(o.buyerUid, "Your Connect Me is booked 💞", `${o.title} · ${fmtWhen(o.startsAt)}. Now invite who you're bringing.`);
  const v = ((await cnPrivate(o.dealId).get()).data() || {}).venue || {};
  const place = [v.name || o.venueName, v.address, v.city || o.city].filter(Boolean).join(", ");
  const cal = calendarLinks({ title: `Connect Me: ${o.title}`, start: ms(o.startsAt), place, details: `Your code: ${seats[0].code}. ${APP_URL}` });
  const links = seats.filter(x => x.token).map(x => connectLink(x.token));
  await sendEmail(o.buyerUid, `Booked: ${o.title}`, {
    heading: "Your Connect Me is booked 💞",
    intro: `Now invite who you're bringing. Send ${links.length === 1 ? "them this link" : "each person one of these links"}. They sign up free and get their own code.`,
    code: seats[0].code,
    rows: [["What", o.title], ["When", fmtWhen(o.startsAt) + " (Central)"], ["Where", place], ["For", `${o.size} people`], ["Paid", fmtMoney(o.amount)], ["ID", o.idCheck ? "21+: everyone brings a valid photo ID" : ""],
      ...links.map((l, i) => [links.length > 1 ? `Invite link ${i + 1}` : "Invite link", l])],
    button: ["Invite from the app", `${APP_URL}/?dates=1`], cal,
    after: "At the place, everyone taps \"I'm here\" in the app (or shows their code to the staff). Packages aren't refunded, but if we cancel one you get the full amount back as credit." }, { ics: cal.ics });
}
async function onConnectPaid(sess) {
  const { dateId: orderId, uid } = sess.metadata || {};
  if (sess.payment_status !== "paid") return;
  const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id;
  const ref = coRef(orderId);
  let ok = false, undo = false, o;
  await db.runTransaction(async tx => {
    o = (await tx.get(ref)).data();
    const c = o?.creditToUse ? (await tx.get(creditRef(uid))).data() : null;
    if (o && o.status === "paid") return; // repeat webhook
    if (!o || o.status !== "pending") { undo = true; return; }
    const t = c ? takeCredit(c, o.creditToUse) : { used: 0, from: [] };
    if (c) tx.set(creditRef(uid), t.next);
    tx.update(ref, { status: "paid", paymentIntent: pi, cardPaid: sess.amount_total, creditFrom: t.from, paidAt: nowTs() });
    tx.update(cnRef(o.dealId), { held: FieldValue.increment(-1), sold: FieldValue.increment(1) });
    ok = true;
  });
  if (undo) { await addCredit(uid, [{ pi, amount: sess.amount_total }], "Payment for a Connect Me that had closed"); return; }
  if (!ok) return;
  const fee = await stripeFeeFor(pi, sess.amount_total);
  await ref.update({ stripeFee: fee });
  await cnRef(o.dealId).update({ stripeFees: FieldValue.increment(fee) });
  await issueConnectSeats(orderId, await whisperProfile(uid));
}

/** Who's coming: invite a member on the site (they get a notification). */
exports.inviteToConnect = onCall(async req => {
  const uid = requireUser(req);
  const orderId = str(req.data?.orderId, 64), seat = Math.round(Number(req.data?.seat)), to = str(req.data?.uid, 128);
  const ref = coRef(orderId), o = (await ref.get()).data();
  if (!o || o.buyerUid !== uid) fail("permission-denied", "Not your package.");
  if (o.status !== "paid") fail("failed-precondition", "This package isn't active.");
  if (!to || to === uid || (o.memberUids || []).includes(to)) fail("invalid-argument", "Pick someone else.");
  const st = (o.seats || [])[seat];
  if (!st || st.role !== "guest" || st.status === "accepted") fail("failed-precondition", "That spot is already taken.");
  o.seats[seat] = { ...st, status: "invited", invitedUid: to };
  await ref.update({ seats: o.seats, invitedUids: FieldValue.arrayUnion(to) });
  const me = await whisperProfile(uid);
  await push(to, `${me.name} invited you out 💞`, `${o.title} · ${fmtWhen(o.startsAt)} at ${o.venueName}. It's already paid for. Tap to accept.`, connectLink(st.token));
  return { message: "Invite sent", link: connectLink(st.token) };
});

/** Give a spot a fresh link (e.g. the person can't make it). The old link stops working. */
exports.newConnectLink = onCall(async req => {
  const uid = requireUser(req);
  const orderId = str(req.data?.orderId, 64), seat = Math.round(Number(req.data?.seat));
  const ref = coRef(orderId), o = (await ref.get()).data();
  if (!o || o.buyerUid !== uid) fail("permission-denied", "Not your package.");
  if (o.status !== "paid" || ms(o.startsAt) < Date.now()) fail("failed-precondition", "This package isn't active.");
  const st = (o.seats || [])[seat];
  if (!st || st.role !== "guest") fail("invalid-argument", "Pick a guest spot.");
  if (st.checkedInAt) fail("failed-precondition", "They already checked in.");
  const token = inviteToken();
  if (st.token) await db.doc(`connectInvites/${st.token}`).delete();
  if (st.code) await db.doc(`connectCodes/${st.code}`).delete();
  o.seats[seat] = { uid: null, name: "", role: "guest", status: "open", token };
  o.memberUids = (o.memberUids || []).filter(u => u !== st.uid);
  await ref.update({ seats: o.seats, memberUids: o.memberUids });
  await db.doc(`connectInvites/${token}`).set({ orderId, seat });
  if (st.uid) await push(st.uid, "Plans changed", `${o.buyerName} gave your spot for ${o.title} to someone else.`);
  return { link: connectLink(token), message: "New link ready. The old one no longer works." };
});

/** What an invite link shows (works before signing in, so the landing page can show it). */
exports.connectInvite = onCall(async req => {
  const token = str(req.data?.token, 20).toLowerCase();
  const inv = (await db.doc(`connectInvites/${token}`).get()).data();
  if (!inv) fail("not-found", "This invite link isn't valid anymore. Ask for a new one.");
  const o = (await coRef(inv.orderId).get()).data();
  const deal = o ? (await cnRef(o.dealId).get()).data() : null;
  if (!o || !deal || o.status !== "paid") fail("not-found", "This invite isn't active anymore.");
  const st = o.seats[inv.seat] || {};
  const me = req.auth?.uid;
  return { title: o.title, from: o.buyerName, venueName: o.venueName, city: o.city, startsAt: ms(o.startsAt), size: o.size, items: deal.items || [], about: deal.about || "",
    imageURL: deal.imageURL || "", hue: deal.hue, idCheck: !!(o.idCheck || deal.idCheck), venueRating: deal.venueRating || null, taken: st.status === "accepted" && st.uid !== me, forSomeoneElse: !!(st.invitedUid && me && st.invitedUid !== me), mine: st.uid === me && st.status === "accepted" };
}
);

/** Accept an invite: needs a free account (21+). The guest gets their own code and the address. */
exports.acceptConnect = onCall({ secrets: [GMAIL_PASS] }, async req => {
  const uid = requireUser(req);
  notSuspended(await memberFor(uid, req.data?.birthYear));
  const token = str(req.data?.token, 20).toLowerCase();
  const inv = (await db.doc(`connectInvites/${token}`).get()).data();
  if (!inv) fail("not-found", "This invite link isn't valid anymore. Ask for a new one.");
  const ref = coRef(inv.orderId);
  const me = await whisperProfile(uid);
  let o, code;
  await db.runTransaction(async tx => {
    o = (await tx.get(ref)).data();
    if (!o || o.status !== "paid") fail("failed-precondition", "This invite isn't active anymore.");
    needIdOk(o, req);
    if (o.buyerUid === uid) fail("failed-precondition", "That's your own package. Send the link to who you're bringing.");
    if ((o.memberUids || []).includes(uid)) fail("already-exists", "You're already going. Your code is under Connect Me.");
    const st = o.seats[inv.seat];
    if (st.status === "accepted") fail("already-exists", "Someone already accepted this invite.");
    if (st.invitedUid && st.invitedUid !== uid) fail("permission-denied", "This invite was sent to someone else.");
    code = connectCode();
    o.seats[inv.seat] = { ...st, uid, name: me.name, photo: me.photo, status: "accepted", code, acceptedAt: Date.now() };
    tx.update(ref, { seats: o.seats, memberUids: FieldValue.arrayUnion(uid), invitedUids: FieldValue.arrayRemove(uid) });
    tx.set(db.doc(`connectCodes/${code}`), { orderId: inv.orderId, seat: inv.seat });
  });
  await push(o.buyerUid, `${me.name} is in! 💞`, `${me.name} accepted your invite to ${o.title}.`);
  await emailConnectSeat(o, { uid, code, name: me.name }, "accepted");
  return { orderId: inv.orderId, code, message: "You're going! The address and your code are under Connect Me." };
});

/** "I'm here": the phone's location has to be at the venue (within about a quarter mile). */
exports.connectHere = onCall(async req => {
  const uid = requireUser(req);
  const orderId = str(req.data?.orderId, 64);
  const ref = coRef(orderId), o = (await ref.get()).data();
  if (!o || o.status !== "paid") fail("failed-precondition", "This package isn't active.");
  const i = (o.seats || []).findIndex(x => x.uid === uid && x.status === "accepted");
  if (i < 0) fail("permission-denied", "You're not on this package.");
  const start = ms(o.startsAt);
  if (Date.now() < start - 60 * 60000) fail("failed-precondition", `Check-in opens an hour before (${fmtWhen(start - 3600000)}).`);
  if (Date.now() > start + 3 * 3600000) fail("failed-precondition", "Check-in for this one has closed.");
  const v = ((await cnPrivate(o.dealId).get()).data() || {}).venue || {};
  const lat = Number(req.data?.lat), lng = Number(req.data?.lng);
  let method = "self";
  if (v.lat && v.lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) fail("failed-precondition", "Turn on location so we can see you're at the place.");
    const km = kmBetween(lat, lng, v.lat, v.lon);
    if (km > HERE_RADIUS_KM) fail("failed-precondition", `You don't seem to be at ${v.name || o.venueName} yet (${(km * 0.621).toFixed(1)} miles away). Try again when you get there, or show your code to the staff.`);
    method = "gps";
  }
  if (!o.seats[i].checkedInAt) {
    o.seats[i] = { ...o.seats[i], checkedInAt: Date.now(), checkInMethod: method };
    await ref.update({ seats: o.seats });
  }
  const people = o.seats.filter(x => x.uid);
  const allHere = people.length === o.size && people.every(x => x.checkedInAt);
  if (allHere) for (const p of people) await push(p.uid, "Everyone's here 💞", `You're all checked in for ${o.title}. Have fun!`);
  else for (const p of people) if (p.uid !== uid) await push(p.uid, `${o.seats[i].name} is here`, `${o.seats[i].name} just checked in at ${o.venueName}.`);
  const id = o.idCheck ? " Have your photo ID ready for the staff." : "";
  return { allHere, idCheck: !!o.idCheck, message: (allHere ? "Everyone's here. Have fun!" : "You're checked in. We'll let the others know.") + id };
});

/** Your packages: the ones you bought (with invite links) and the ones you were invited to. */
exports.myConnects = onCall(async req => {
  const uid = requireUser(req);
  const [q, inv] = await Promise.all([
    db.collection("connectOrders").where("memberUids", "array-contains", uid).limit(40).get(),
    db.collection("connectOrders").where("invitedUids", "array-contains", uid).limit(20).get()
  ]);
  const out = [];
  for (const d of inv.docs) {
    const o = d.data(); if (o.status !== "paid" || ms(o.startsAt) < Date.now()) continue;
    const st = (o.seats || []).find(x => x.invitedUid === uid && x.status === "invited");
    if (st) out.push({ id: d.id, invite: true, token: st.token, title: o.title, venueName: o.venueName, city: o.city, startsAt: ms(o.startsAt), size: o.size, status: "invited", buyerName: o.buyerName, seats: [] });
  }
  for (const d of q.docs) {
    const o = d.data();
    if (!["paid", "completed", "canceled"].includes(o.status)) continue;
    const buyer = o.buyerUid === uid;
    const v = o.status === "paid" ? (((await cnPrivate(o.dealId).get()).data() || {}).venue || {}) : {};
    const mine = (o.seats || []).find(x => x.uid === uid) || {};
    out.push({ id: d.id, buyer, title: o.title, venueName: o.venueName, city: o.city, startsAt: ms(o.startsAt), size: o.size, status: o.status, amount: buyer ? o.amount : 0,
      address: v.address || "", venuePhone: v.phone || "", code: mine.code || "", here: !!mine.checkedInAt, buyerName: o.buyerName, idCheck: !!o.idCheck,
      canRate: !!mine.code && ["paid", "completed"].includes(o.status) && rateWindow(ms(o.startsAt)),
      seats: (o.seats || []).map((x, i) => ({ i, name: x.name || "", role: x.role, status: x.status, here: !!x.checkedInAt, link: buyer && x.token && x.status !== "accepted" ? connectLink(x.token) : "" })) });
  }
  out.sort((a, b) => b.startsAt - a.startsAt);
  const mineR = await ratingsFor(uid, "cm", out.filter(z => z.canRate).map(z => z.id));
  out.forEach(z => { if (z.canRate) z.myStars = mineR[z.id] || 0; });
  return { connects: out };
});

/** A Connect Me ticket email for one person: when they accept, and the day before. */
async function emailConnectSeat(o, seat, kind) {
  if (!seat || !seat.uid || !seat.code) return false;
  const v = ((await cnPrivate(o.dealId).get()).data() || {}).venue || {};
  const place = [v.name || o.venueName, v.address, v.city || o.city].filter(Boolean).join(", ");
  const start = ms(o.startsAt), remind = kind === "reminder";
  const cal = calendarLinks({ title: `Connect Me: ${o.title}`, start, place, details: `Your code: ${seat.code}. ${APP_URL}` });
  const others = (o.seats || []).filter(x => x.uid && x.uid !== seat.uid).map(x => x.name).filter(Boolean);
  return sendEmail(seat.uid, remind ? `Tomorrow: ${o.title}` : `You're going: ${o.title}`, {
    heading: remind ? `Tomorrow: ${o.title} 💞` : "You're going! 💞",
    intro: remind ? `Here's everything you need for ${fmtWhen(start)}.` : `${o.buyerName || "Your host"} invited you, and you're all set.`,
    code: seat.code,
    rows: [["What", o.title], ["When", fmtWhen(start) + " (Central)"], ["Where", place], ["With", others.join(", ")], ["Venue phone", v.phone || ""], ["ID", o.idCheck ? "21+: bring a valid photo ID" : ""]],
    button: ["Open Connect Me", `${APP_URL}/?dates=1`], cal,
    after: "When you get there, tap \"I'm here\" in the app (or show your code to the staff)." }, { ics: cal.ics });
}

async function cancelConnectDeal(id, reason) {
  const x = (await cnRef(id).get()).data();
  if (!x) fail("not-found", "Not found.");
  await cnRef(id).update({ status: "canceled", canceledReason: reason, canceledAt: nowTs() });
  const q = await db.collection("connectOrders").where("dealId", "==", id).get();
  let n = 0;
  for (const d of q.docs) {
    const o = d.data();
    if (o.status === "pending") { await d.ref.update({ status: "released" }); continue; }
    if (o.status !== "paid") continue;
    const back = await addCredit(o.buyerUid, [{ pi: o.paymentIntent, amount: o.cardPaid ?? o.amount }, ...(o.creditFrom || [])], `Refund: ${o.title}`);
    await d.ref.update({ status: "canceled", refundedAs: "credit", refundAmount: back });
    for (const s of o.seats || []) if (s.uid) await push(s.uid, "Plans canceled", `${o.title}: ${reason}${s.uid === o.buyerUid ? ` ${fmtMoney(back)} is back in your Whisper+Me credit (or send it to your card from your Wallet).` : ""}`);
    n++;
  }
  return n;
}
/** Admin check-in by code: the venue reads you the codes, or you check them at the door. */
async function connectCheckInCode(code) {
  code = str(code, 20).toUpperCase(); if (!/^CM-/.test(code)) code = "CM-" + code.replace(/^.*-/, "");
  const c = (await db.doc(`connectCodes/${code}`).get()).data();
  if (!c) fail("not-found", `No Connect Me code matches ${code}.`);
  const ref = coRef(c.orderId), o = (await ref.get()).data();
  if (!o || o.status !== "paid") fail("failed-precondition", "That package isn't active.");
  const st = o.seats[c.seat];
  const already = !!st.checkedInAt;
  if (!already) { o.seats[c.seat] = { ...st, checkedInAt: Date.now(), checkInMethod: "code" }; await ref.update({ seats: o.seats }); }
  const people = o.seats.filter(x => x.uid);
  return { guest: st.name, title: o.title, already, idCheck: !!o.idCheck, party: o.seats.map(x => ({ name: x.name || "(not accepted yet)", here: !!x.checkedInAt })), allHere: people.length === o.size && people.every(x => x.checkedInAt) };
}

/** The day before a Connect Me: everyone going gets their code again; buyers with open seats get a nudge. */
async function connectReminders(d, x, now) {
  const start = ms(x.startsAt);
  if (x.remindedAt || !x.sold || start - now > REMIND_BEFORE_MS || start < now + 3600000) return 0;
  if (!(await claimReminder(d.ref))) return 0;
  const orders = await db.collection("connectOrders").where("dealId", "==", d.id).where("status", "==", "paid").get();
  let n = 0;
  for (const od of orders.docs) {
    const o = od.data();
    for (const seat of (o.seats || []).filter(z => z.uid && z.code)) {
      await push(seat.uid, "Tomorrow: " + o.title, `${fmtWhen(start)} at ${o.venueName}. Tap "I'm here" when you arrive.`);
      if (await emailConnectSeat(o, seat, "reminder")) n++;
    }
    const open = (o.seats || []).filter(z => !z.uid && z.token);
    if (open.length) await push(o.buyerUid, "Who's coming with you?", `${o.title} is tomorrow and ${open.length} invite${open.length === 1 ? " hasn't" : "s haven't"} been accepted yet. Send the link again from Connect Me.`, `${APP_URL}/?dates=1`);
  }
  return n;
}

async function connectHousekeeping(s) {
  const now = Date.now();
  const pend = await db.collection("connectOrders").where("status", "==", "pending").limit(300).get();
  for (const d of pend.docs) {
    const o = d.data();
    if (ms(o.createdAt) > now - CONNECT_PAY_MINUTES * 60000) continue;
    await db.runTransaction(async tx => {
      const cur = (await tx.get(d.ref)).data();
      if (cur.status !== "pending") return;
      tx.update(d.ref, { status: "released" });
      tx.update(cnRef(cur.dealId), { held: FieldValue.increment(-1) });
    });
  }
  const live = await db.collection("connects").where("status", "==", "live").limit(300).get();
  for (const d of live.docs) {
    const x = d.data();
    if (ms(x.startsAt) > now - SETTLE_AFTER_HOURS * 3600000) { await connectReminders(d, x, now); continue; }
    // It's over: count it, mark no-shows, and say sorry (with coins) to anyone who showed up and got stood up.
    const orders = await db.collection("connectOrders").where("dealId", "==", d.id).where("status", "==", "paid").get();
    let gross = 0, stoodUp = 0;
    for (const od of orders.docs) {
      const o = od.data();
      gross += o.amount || 0;
      const people = (o.seats || []).filter(z => z.uid);
      const here = people.filter(z => z.checkedInAt), gone = people.filter(z => !z.checkedInAt);
      if (here.length && (gone.length || people.length < o.size)) {
        stoodUp++;
        for (const z of here) { await creditCoins(z.uid, s.stoodUpRewardCoins, "Stood up (Connect Me)", od.id); await push(z.uid, "Sorry they didn't make it", `We added ${s.stoodUpRewardCoins} Whisper coin${s.stoodUpRewardCoins === 1 ? "" : "s"} to your account.`); }
      }
      await od.ref.update({ status: "completed", noShows: gone.map(z => z.uid), completedAt: nowTs() });
      if (here.length) await askForRatings("cm", od.id, o, here.map(z => z.uid));
    }
    const fees = x.stripeFees || 0;
    if (gross) await rtdb.ref("siteRevenue").transaction(v => Math.round(((Number(v) || 0) + gross / 100) * 100) / 100);
    await db.collection("ledger").add({ kind: "connectSettled", dealId: d.id, sold: x.sold, gross, cardFees: fees, siteNet: gross - fees, stoodUp, at: nowTs() });
    await db.doc(`stats/day-${dayKey(new Date())}`).set({ connectSales: FieldValue.increment(gross), cardFees: FieldValue.increment(fees) }, { merge: true });
    await d.ref.update({ status: "completed", completedAt: nowTs(), gross, siteNet: gross - fees });
  }
}

/* ═══════════════════════════════════════════════════════════════
   RATINGS ⭐  after an M&G (guests rate the host) and after a Connect Me
   (everyone rates the night and the place).
   - Stars are public: a host's average shows on their profile and M&G
     cards (users/{uid}/rating), a venue's on its Connect Me packages.
   - Comments are private: only the admin sees them (Admin → ⭐ M&G /
     💞 Connect Me → Reviews), so nobody has to moderate public reviews.
   ratings/{kind}_{eventId}_{uid}, connectVenues/{key} = { name, sum, n }
═══════════════════════════════════════════════════════════════ */
const RATE_DAYS = 14; // how long after the event you can still rate
const venueKey = v => str(`${v.name || ""} ${v.city || ""}`, 140).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "venue";
const avgOf = r => (r && r.n ? Math.round((r.sum / r.n) * 10) / 10 : 0);

/** Can this person rate this event yet, and what did they say before? */
function rateWindow(start) { const now = Date.now(); return now > start + 90 * 60000 && now < start + RATE_DAYS * 864e5; }
async function meetupRatable(id, uid) {
  const x = (await mtRef(id).get()).data();
  if (!x || !["live", "paying", "review", "completed"].includes(x.status)) return null;
  if (x.hostUid === uid && !x.official) return null;
  const spot = (await mtRef(id).collection("spots").doc(uid).get()).data();
  if (!spot || spot.status !== "paid" || !rateWindow(ms(x.startsAt))) return null;
  return x;
}
async function connectRatable(orderId, uid) {
  const o = (await coRef(orderId).get()).data();
  if (!o || !["paid", "completed"].includes(o.status)) return null;
  if (!(o.seats || []).some(z => z.uid === uid)) return null;
  if (!rateWindow(ms(o.startsAt))) return null;
  return o;
}

exports.rateEvent = onCall(async req => {
  const uid = requireUser(req);
  const kind = req.data?.kind === "cm" ? "cm" : "mg";
  const id = str(req.data?.id, 64);
  const stars = Math.round(Number(req.data?.stars));
  if (!(stars >= 1 && stars <= 5)) fail("invalid-argument", "Tap 1 to 5 stars.");
  const text = str(req.data?.text, 600);
  const rref = db.doc(`ratings/${kind}_${id}_${uid}`);
  const me = await whisperProfile(uid);
  if (kind === "mg") {
    const x = await meetupRatable(id, uid);
    if (!x) fail("failed-precondition", "You can rate an M&G you had a spot at, from the end of the night until 2 weeks after.");
    let prev = null;
    await db.runTransaction(async tx => {
      prev = (await tx.get(rref)).data() || null;
      tx.set(rref, { kind, eventId: id, title: x.title, subjectUid: x.official ? null : x.hostUid, subjectName: x.official ? "Whisper+Me" : x.hostName, by: uid, byName: me.name, stars, text, hidden: false, at: nowTs() });
      tx.update(mtRef(id), { "rating.sum": FieldValue.increment(stars - (prev?.stars || 0)), "rating.n": FieldValue.increment(prev ? 0 : 1) });
    });
    if (!x.official) {
      await rtdb.ref(`users/${x.hostUid}/rating`).transaction(r => {
        r = r || { sum: 0, n: 0 };
        r.sum = (r.sum || 0) + stars - (prev?.stars || 0); r.n = (r.n || 0) + (prev ? 0 : 1); r.avg = Math.round((r.sum / r.n) * 10) / 10;
        return r;
      });
      if (!prev) await push(x.hostUid, `New ${stars}★ rating`, `Someone rated ${x.title} ${stars} star${stars === 1 ? "" : "s"}.`);
    }
    if (stars <= 2) for (const a of ADMIN_UIDS) await push(a, `${stars}★ M&G rating`, `${me.name} on ${x.title}${text ? `: “${text.slice(0, 90)}”` : ""}`, `${APP_URL}/admin.html`);
    return { message: "Thanks! Your rating helps people find great hosts." };
  }
  const o = await connectRatable(id, uid);
  if (!o) fail("failed-precondition", "You can rate a Connect Me you went to, from the end of the night until 2 weeks after.");
  const v = ((await cnPrivate(o.dealId).get()).data() || {}).venue || { name: o.venueName, city: o.city };
  const key = venueKey(v);
  let prev = null;
  await db.runTransaction(async tx => {
    prev = (await tx.get(rref)).data() || null;
    const vr = (await tx.get(db.doc(`connectVenues/${key}`))).data() || { sum: 0, n: 0 };
    tx.set(rref, { kind, eventId: id, dealId: o.dealId, title: o.title, venueKey: key, subjectName: v.name || o.venueName, by: uid, byName: me.name, stars, text, hidden: false, at: nowTs() });
    tx.update(cnRef(o.dealId), { "rating.sum": FieldValue.increment(stars - (prev?.stars || 0)), "rating.n": FieldValue.increment(prev ? 0 : 1) });
    tx.set(db.doc(`connectVenues/${key}`), { name: v.name || o.venueName, city: v.city || o.city, sum: (vr.sum || 0) + stars - (prev?.stars || 0), n: (vr.n || 0) + (prev ? 0 : 1), updatedAt: nowTs() }, { merge: true });
  });
  await refreshVenueRating(key);
  if (stars <= 2) for (const a of ADMIN_UIDS) await push(a, `${stars}★ Connect Me rating`, `${me.name} on ${o.title} at ${o.venueName}${text ? `: “${text.slice(0, 90)}”` : ""}`, `${APP_URL}/admin.html`);
  return { message: "Thanks! Your rating helps us pick the best places." };
});
/** Packages on sale at a venue show that venue's average. */
async function refreshVenueRating(key) {
  const vr = (await db.doc(`connectVenues/${key}`).get()).data();
  if (!vr) return;
  const live = await db.collection("connects").where("venueKey", "==", key).where("status", "==", "live").limit(50).get();
  for (const d of live.docs) await d.ref.update({ venueRating: { avg: avgOf(vr), n: vr.n } });
}
/** "How was it?": once, to the people who were there. */
async function askForRatings(kind, id, x, uids) {
  const link = `${APP_URL}/?dates=1&rate=${kind}:${id}`;
  for (const uid of [...new Set(uids)].filter(Boolean)) {
    await push(uid, `How was ${x.title}?`, kind === "mg" ? `Tap to rate ${x.official ? "the night" : x.hostName}. It takes 5 seconds.` : "Tap to rate the night and the place. It takes 5 seconds.", link);
  }
}
async function ratingsFor(uid, kind, ids) {
  const out = {};
  await Promise.all(ids.map(async id => { const r = (await db.doc(`ratings/${kind}_${id}_${uid}`).get()).data(); if (r) out[id] = r.stars; }));
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   CALL ALERTS: ring the member's phone even when the app is closed
   - A data-only push goes to every device they turned alerts on for.
     The service worker (public/firebase-messaging-sw.js) shows it with
     Answer / Decline, a long vibration, and stays up until they act.
   - It re-rings every 9 seconds (4 times) while the call is still ringing.
   - When the call stops ringing, the alert is taken down; if they never
     answered it and didn't decline, they get "Missed call from …".
   (Replaces notifyIncomingCall in the default functions codebase.)
═══════════════════════════════════════════════════════════════ */
const RING_EVERY_MS = 9000, RINGS = 4;
const sleep = ms => new Promise(r => setTimeout(r, process.env.DATES_TEST ? 0 : ms));
function callAlert(callId, call, n, extra = {}) {
  const name = String(call.callerName || "Someone").slice(0, 40);
  return {
    data: { type: "incoming_call", callId, from: String(call.from || ""), callerName: name, callerPhoto: String(call.callerPhoto || "").slice(0, 500),
      price: String(call.price || 1), title: `📞 ${name} is calling`, body: "Tap to answer on Whisper+Me", url: APP_URL, ring: String(n), ...extra },
    webpush: { headers: { Urgency: "high", TTL: "45" }, fcmOptions: { link: APP_URL } }
  };
}
async function ringFlow(callId, call) {
  if (!call || call.status !== "ringing" || !call.to) return 0;
  if (call.from && (await rtdb.ref(`blocks/${call.to}/${call.from}`).once("value")).val()) return 0; // they blocked the caller
  let sent = 0;
  for (let n = 0; n < RINGS; n++) {
    if (n) {
      await sleep(RING_EVERY_MS);
      const st = (await rtdb.ref(`calls/${callId}/status`).once("value")).val();
      if (st !== "ringing") break;
    }
    const ok = await sendToDevices(call.to, callAlert(callId, call, n));
    if (!ok) break; // no device has alerts on
    sent++;
  }
  return sent;
}
exports.callRing = onValueCreated({ ref: "/calls/{callId}", region: "us-central1", timeoutSeconds: 60, memory: "256MiB" }, async event => {
  await ringFlow(event.params.callId, event.data.val());
});
async function stopRingFlow(callId, before, after, call) {
  if (before !== "ringing" || after === "ringing" || !call || !call.to) return null;
  const missed = after === "ended" && !call.answeredAt && call.endedBy !== call.to && call.endReason !== "unavailable";
  await sendToDevices(call.to, { data: { type: "call_ended", callId, missed: missed ? "1" : "", callerName: String(call.callerName || "Someone").slice(0, 40), url: APP_URL },
    webpush: { headers: { Urgency: "high", TTL: "600" } } });
  return missed;
}
exports.callStopRing = onValueUpdated({ ref: "/calls/{callId}/status", region: "us-central1", memory: "256MiB" }, async event => {
  const id = event.params.callId;
  const call = (await rtdb.ref(`calls/${id}`).once("value")).val();
  await stopRingFlow(id, event.data.before.val(), event.data.after.val(), call);
});
/** "Test my ringer": waits a few seconds (time to lock the phone), then sends a test call alert to all their devices. */
/* One phone rings for one account. When a device turns on alerts for a new
   account (a shared phone, or someone logged in as somebody else without
   logging out), it's taken off the account that had it before. */
async function claimDevice(uid, key, dev) {
  const ownRef = rtdb.ref(`fcmOwners/${key}`);
  const prev = (await ownRef.once("value")).val();
  if (!dev) { if (prev === uid) await ownRef.set(null); return null; } // logged out / removed
  if (!dev.token) return null;
  if (prev && prev !== uid) {
    const old = (await rtdb.ref(`fcmTokens/${prev}`).once("value")).val() || {};
    const upd = { [`devices/${key}`]: null };
    if (old.token === dev.token) upd.token = null;
    await rtdb.ref(`fcmTokens/${prev}`).update(upd);
  }
  if (prev !== uid) await ownRef.set(uid);
  return prev && prev !== uid ? prev : null;
}
exports.fcmClaim = onValueWritten({ ref: "/fcmTokens/{uid}/devices/{key}", region: "us-central1", memory: "256MiB" }, async event => {
  await claimDevice(event.params.uid, event.params.key, event.data.after.exists() ? event.data.after.val() : null);
});

exports.testRing = onCall({ timeoutSeconds: 30 }, async req => {
  const uid = requireUser(req);
  const n = (await deviceTokens(uid)).length;
  if (!n) fail("failed-precondition", "Call alerts aren't on for this device yet. Tap Turn on first, then try again.");
  await sleep(Math.min(15, Math.max(0, Number(req.data?.delay ?? 8))) * 1000);
  const ok = await sendToDevices(uid, callAlert(`test-${Date.now()}`, { callerName: "Whisper+Me test call", callerPhoto: `${APP_URL}/icon-192.png`, from: "test" }, 0, { test: "1" }));
  if (!ok) fail("failed-precondition", "We couldn't reach this device. Tap Turn on again to refresh it.");
  return { devices: ok, message: `Test call sent to ${ok} device${ok === 1 ? "" : "s"}.` };
});

/* ═══════════════════════════════════════════════════════════════
   PAYOUTS: creators' and hosts' earnings → their bank
   Everything people earn (calls, member rooms, M&Gs) adds up in
   users/{uid}/earnings (dollars). Paying out sends a Stripe transfer to
   their connected Stripe account (Profile → Wallet → Set up payouts) and
   moves the amount from earnings to paidOut, so nobody is paid twice.
   Card fees were already taken out of the site's share when people paid,
   so earners always get their full amount.
═══════════════════════════════════════════════════════════════ */
const PAYOUT_MIN = 50;
async function payoutUser(uid, { manual = false, amount = 0 } = {}) {
  const u = (await rtdb.ref(`users/${uid}`).once("value")).val() || {};
  const all = Math.floor(Number(u.earnings || 0) * 100);
  const cents = amount > 0 ? Math.min(all, Math.round(amount)) : all;
  if (cents <= 0) fail("failed-precondition", "Nothing to pay.");
  if (!manual) {
    if (!u.stripeAccountId) fail("failed-precondition", `${u.name || "They"} hasn't set up payouts yet (Profile → Wallet → Set up payouts).`);
    const acct = await stripe().accounts.retrieve(u.stripeAccountId);
    if (!acct.payouts_enabled) fail("failed-precondition", `${u.name || "Their"} Stripe setup isn't finished yet.`);
  }
  // Take it out of earnings first, so a double click can never pay twice.
  let took = 0;
  await rtdb.ref(`users/${uid}/earnings`).transaction(e => { const cur = Math.round((Number(e) || 0) * 100); took = Math.min(cur, cents); return (cur - took) / 100; });
  if (!took) fail("failed-precondition", "Nothing to pay.");
  let transferId = null;
  if (!manual) {
    try {
      transferId = (await stripe().transfers.create({ amount: took, currency: "usd", destination: u.stripeAccountId, description: "Whisper+Me earnings", metadata: { uid } }, { idempotencyKey: `payout-${uid}-${took}-${Math.floor(Date.now() / 60000)}` })).id;
    } catch (e) {
      await rtdb.ref(`users/${uid}/earnings`).transaction(v => Math.round(((Number(v) || 0) * 100 + took)) / 100); // put it back
      fail("failed-precondition", /insufficient/i.test(e.message) ? "Your Stripe balance doesn't have enough available yet (new payments take about 2 days). Try again later." : e.message);
    }
  }
  await rtdb.ref(`users/${uid}/paidOut`).transaction(v => Math.round(((Number(v) || 0) * 100 + took)) / 100);
  await rtdb.ref(`users/${uid}`).update({ lastPaidOut: Date.now(), lastPaidAmount: took / 100 });
  await db.collection("ledger").add({ kind: "payout", uid, amount: took, transferId, method: manual ? "manual" : "stripe", at: nowTs() });
  await push(uid, "You got paid 💸", `${fmtMoney(took)} is on its way to your bank.`);
  await sendEmail(uid, `You got paid ${fmtMoney(took)} 💸`, {
    heading: "You got paid 💸",
    intro: manual ? `We paid you ${fmtMoney(took)} of your Whisper+Me earnings.` : `${fmtMoney(took)} of your Whisper+Me earnings is on its way to your bank. It usually lands in 2 business days.`,
    rows: [["Amount", fmtMoney(took)], ["Date", new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" })], ["Paid so far", fmtMoney(Math.round((Number(u.paidOut || 0) * 100) + took))]],
    after: "Keep it up: take calls and host M&Gs to earn more. See your earnings any time in Profile → Wallet." });
  return took;
}
/** Every earner at the minimum with Stripe set up. Skips anyone who can't be paid yet. */
async function payAllReady() {
  const all = (await rtdb.ref("users").orderByChild("earnings").startAt(PAYOUT_MIN).once("value")).val() || {};
  const out = { paid: 0, total: 0, skipped: [] };
  for (const [uid, u] of Object.entries(all)) {
    if (!u || !u.stripeAccountId || Number(u.earnings) < PAYOUT_MIN) continue;
    // Paid by hand with the old "Mark paid" button, which didn't take it out of their earnings: check them one by one first.
    if (u.lastPaidOut && u.paidOut == null) { out.skipped.push(`${u.name || uid}: was marked paid before, check their balance first`); continue; }
    try { out.total += await payoutUser(uid); out.paid++; }
    catch (e) { out.skipped.push(`${u.name || uid}: ${e.message}`); if (/balance/i.test(e.message)) break; }
  }
  return out;
}
/** Automatic payouts (Admin → 💰 Money → turn on): once a month, on the 1st. Monthly keeps Stripe's
    per-payout and monthly-active-account fees as low as possible. */
exports.autoPayouts = onSchedule({ schedule: "1 of month 10:00", timeZone: "America/Chicago", ...withStripe }, async () => {
  const s = await getSettings();
  if (!s.autoPayouts) return;
  const r = await payAllReady();
  if (r.paid || r.skipped.length) for (const a of ADMIN_UIDS) await push(a, "Monthly payouts", `Paid ${r.paid} creator(s) ${fmtMoney(r.total)}.${r.skipped.length ? ` ${r.skipped.length} skipped.` : ""}`, `${APP_URL}/admin.html`);
});

/* ═══════════════════════════════════════════════════════════════
   SHARE LINKS: whisperplusme.com/m/{meetupId} (and old /d/{ticketId})
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
  module.exports.__test = { setStripe: s => { _stripe = s; }, handleStripeEvent, housekeeping, settleDate, getSettings, CATEGORIES, landingStats, chatPrune, dateOGPage, meetupOGPage, payAllReady, ringFlow, stopRingFlow, claimDevice, sentMail, meetupReminders, connectReminders, emailHTML, connectInviteToken: async orderId => ((await coRef(orderId).get()).data()?.seats || []).map(x => x.token) };
}
