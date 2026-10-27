/**
 * Whisper+me Nights — Cloud Functions (deployed as the separate "nights" codebase,
 * so the original Whisper+me functions are never touched by a Nights deploy)
 *
 * Everything that touches money or bookings runs here, never in the browser.
 *
 * Booking lifecycle
 *   payment   → the buyer has a Stripe checkout open (seat held for ~35 min)
 *   awaiting  → buyer paid; waiting on invited guests / open seats to pay their share
 *   confirmed → all money collected (immediately for "pay full"); seat counted as sold
 *   canceled  → released; any paid seats were refunded
 *
 * Seat states: pending (buyer, unpaid) · invited · open · claimed (checkout open) · paid · refunded
 * All money is in cents.
 */
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Stripe = require("stripe");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// Same Stripe account as Whisper+me: reuses the existing STRIPE_SECRET_KEY secret.
// Nights has its own webhook endpoint, so it gets its own signing secret.
const STRIPE_SECRET = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("NIGHTS_STRIPE_WEBHOOK_SECRET");
const APP_URL = { value: () => "https://whisperplusme.com" };
const BRAND_NAME = { value: () => "Whisper+me Nights" };
// The Whisper+me admin account (same UID used in database.rules.json).
const ADMIN_UIDS = ["v6aIXY12MDY9ci1wWJmCiLOAKoG2"];
const NIGHTS = "/nights"; // where the Nights pages live on the site

let _stripe;
const stripe = () => (_stripe ||= new Stripe(STRIPE_SECRET.value()));
const withStripe = { secrets: [STRIPE_SECRET] };

const DEFAULT_SETTINGS = {
  fee: 10,                 // platform fee, percent of each ticket
  splitWindowHours: 24,    // time everyone has to pay a split ticket
  minAge: 21,
  requireIdVerify: true,
  openSeats: true,
  chatFilter: true,
  autoApproveVenues: false
};
const BUYER_PAY_MINUTES = 35;   // how long the buyer's checkout holds the seat
const CLAIM_MINUTES = 35;       // how long a guest's checkout holds their seat
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/* ================= helpers ================= */
const fail = (code, msg) => { throw new HttpsError(code, msg); };
const nowTs = () => Timestamp.now();
const minutesFromNow = m => Timestamp.fromMillis(Date.now() + m * 60000);
const fmtMoney = c => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
const fmtWhen = ts => ts.toDate().toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const makeCode = () => "WN-" + Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const chatIdFor = (a, b) => [a, b].sort().join("_");
const dayKey = d => d.toISOString().slice(0, 10);

async function getSettings() {
  const snap = await db.doc("settings/platform").get();
  return { ...DEFAULT_SETTINGS, ...(snap.exists ? snap.data() : {}) };
}

async function activeUser(req) {
  if (!req.auth) fail("unauthenticated", "Sign in first.");
  const snap = await db.doc(`users/${req.auth.uid}`).get();
  if (!snap.exists) fail("failed-precondition", "Finish your profile first.");
  const u = { id: snap.id, ...snap.data() };
  if (u.status !== "active") fail("permission-denied", "Your account is suspended.");
  return u;
}

function checkEligible(user, s) {
  const age = new Date().getFullYear() - (user.birthYear || 9999);
  if (age < s.minAge) fail("failed-precondition", `You need to be ${s.minAge} or older to book.`);
  if (s.requireIdVerify && !user.verified) {
    fail("failed-precondition", user.idUploaded
      ? "Your ID is still being reviewed. You can book as soon as it's approved."
      : "Upload your photo ID in Profile before your first booking. Reviews usually take less than a day.");
  }
}

function requireAdmin(req) {
  const ok = req.auth && (req.auth.token.admin === true || ADMIN_UIDS.includes(req.auth.uid));
  if (!ok) fail("permission-denied", "Admins only.");
}

async function ownedVenue(uid, venueId) {
  const v = await db.doc(`venues/${venueId}`).get();
  if (!v.exists || v.data().ownerUid !== uid) fail("permission-denied", "That isn't your venue.");
  return { id: v.id, ...v.data() };
}

/** Post a message into the 1:1 chat between a and b (creates the chat if needed). */
async function postToChat(a, b, msg) {
  if (!a || !b || a === b) return;
  const cid = chatIdFor(a, b);
  const chatRef = db.doc(`chats/${cid}`);
  const recipients = msg.from === "system" ? [a, b] : [msg.from === a ? b : a];
  const preview = msg.type === "invite" ? "Ticket invite: " + (msg.title || "") : (msg.text || "");
  const unread = {};
  recipients.forEach(r => unread[r] = FieldValue.increment(1));
  await chatRef.set({
    members: [a, b].sort(),
    updatedAt: FieldValue.serverTimestamp(),
    lastMessage: { text: preview.slice(0, 120), from: msg.from },
    unread
  }, { merge: true });
  await chatRef.collection("messages").add({ hidden: false, ...msg, createdAt: FieldValue.serverTimestamp() });
}

async function log(req, action, target, detail = "") {
  await db.collection("adminLog").add({
    by: req.auth.uid, byEmail: req.auth.token.email || "", action, target, detail,
    at: FieldValue.serverTimestamp()
  });
}

/* ---------- Stripe checkout for one seat ---------- */
async function checkoutForSeat(bookingId, booking, seatIndex, email) {
  const seat = booking.seats[seatIndex];
  const base = APP_URL.value().replace(/\/$/, "");
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer_email: email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: seat.amount,
        product_data: {
          name: `${booking.title} · ${booking.venueName}`,
          description: `${booking.mode === "split" ? "Your share" : "Full ticket"} for ${booking.size} people · ${fmtWhen(booking.startsAt)}`
        }
      }
    }],
    metadata: { app: "nights", bookingId, seatIndex: String(seatIndex), uid: seat.uid },
    payment_intent_data: { metadata: { bookingId, seatIndex: String(seatIndex), uid: seat.uid }, transfer_group: bookingId },
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    success_url: `${base}${NIGHTS}/?paid=${bookingId}#tickets`,
    cancel_url: `${base}${NIGHTS}/?unpaid=${bookingId}#tickets`
  });
  return session.url;
}

/** Keep the public "open seats" listing in step with a booking. */
async function syncOpenSeats(bookingId, b) {
  const ref = db.doc(`openSeats/${bookingId}`);
  const s = await getSettings();
  const open = b.seats.filter(x => x.status === "open");
  const live = ["awaiting", "confirmed"].includes(b.status) && b.startsAt.toMillis() > Date.now();
  if (!s.openSeats || !open.length || !live) { await ref.delete().catch(() => {}); return; }
  const host = (await db.doc(`users/${b.buyerUid}`).get()).data() || {};
  await ref.set({
    bookingId, ticketId: b.ticketId, title: b.title, venueName: b.venueName, category: b.category || "",
    startsAt: b.startsAt, size: b.size, hue: b.hue ?? null, seatPrice: open[0].amount,
    openCount: open.length, filled: b.size - open.length,
    hostUid: b.buyerUid, hostName: host.name || "", hostPhoto: host.photoURL || "",
    note: b.openSeatNote || "", createdAt: b.createdAt || FieldValue.serverTimestamp()
  });
}

/** Mark the booking confirmed inside a transaction (inventory, ledger, stats). */
function confirmInTx(tx, bookingRef, b, s) {
  const fee = Math.round(b.total * s.fee / 100);
  tx.update(bookingRef, { status: "confirmed", confirmedAt: nowTs(), platformFee: fee, venueAmount: b.total - fee });
  tx.update(db.doc(`tickets/${b.ticketId}`), { held: FieldValue.increment(-1), sold: FieldValue.increment(1) });
  tx.update(db.doc(`venues/${b.venueId}`), { sales: FieldValue.increment(b.total) });
  tx.set(db.doc(`payouts/${bookingRef.id}`), {
    venueId: b.venueId, venueName: b.venueName, bookingId: bookingRef.id, code: b.code,
    gross: b.total, fee, amount: b.total - fee, status: "due", createdAt: nowTs()
  });
  const day = dayKey(new Date());
  tx.set(db.doc(`stats/day-${day}`), { day, bookings: FieldValue.increment(1), gross: FieldValue.increment(b.total), fees: FieldValue.increment(fee) }, { merge: true });
  tx.set(db.doc("stats/totals"), { bookings: FieldValue.increment(1), gross: FieldValue.increment(b.total), fees: FieldValue.increment(fee) }, { merge: true });
}

const moneyCollected = b => b.seats.filter(x => x.status === "paid").reduce((a, x) => a + x.amount, 0);

/** Cancel a booking, refund every paid seat, release inventory. */
async function cancelBooking(bookingId, reason) {
  const ref = db.doc(`bookings/${bookingId}`);
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const b = snap.data();
    if (["canceled", "refunded"].includes(b.status)) return null;
    const t = db.doc(`tickets/${b.ticketId}`);
    if (b.status === "confirmed") {
      tx.update(t, { sold: FieldValue.increment(-1) });
      tx.update(db.doc(`venues/${b.venueId}`), { sales: FieldValue.increment(-b.total) });
    } else {
      tx.update(t, { held: FieldValue.increment(-1) });
    }
    tx.update(ref, { status: "canceled", canceledAt: nowTs(), canceledReason: reason });
    return b;
  });
  if (!result) return false;
  // Refunds happen outside the transaction (network calls).
  const seats = [...result.seats];
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i];
    if (seat.status === "paid" && seat.amount > 0 && seat.paymentIntent) {
      try {
        await stripe().refunds.create({ payment_intent: seat.paymentIntent, metadata: { bookingId, reason } });
        seats[i] = { ...seat, status: "refunded" };
      } catch (e) { logger.error("Refund failed", bookingId, i, e.message); seats[i] = { ...seat, refundError: e.message }; }
    }
  }
  const anyRefunded = seats.some(x => x.status === "refunded");
  await ref.update({ seats, status: anyRefunded ? "refunded" : "canceled" });
  const payout = db.doc(`payouts/${bookingId}`);
  const p = await payout.get();
  if (p.exists) await payout.update(p.data().status === "due" ? { status: "void" } : { refundAfterPayout: true });
  await db.doc(`openSeats/${bookingId}`).delete().catch(() => {});
  for (const uid of result.memberUids.filter(u => u !== result.buyerUid)) {
    await postToChat(result.buyerUid, uid, { from: "system", type: "system", text: `${result.title} was canceled: ${reason}${anyRefunded ? " Paid seats are being refunded." : ""}` });
  }
  return true;
}

/** Put a seat whose checkout was abandoned back the way it was. */
function resetSeat(b, i) {
  const seat = b.seats[i];
  if (seat.invited) { b.seats[i] = { ...seat, status: "invited", claimedAt: null }; return; }
  b.memberUids = b.memberUids.filter(u => u !== seat.uid);
  b.seats[i] = { status: "open", amount: seat.amount, uid: null, invited: false };
}

/* ================= member functions ================= */

exports.createBooking = onCall(withStripe, async req => {
  const user = await activeUser(req);
  const s = await getSettings();
  checkEligible(user, s);
  const { ticketId, mode, guestUids = [], openSeat = false, note = "" } = req.data || {};
  if (!["split", "full"].includes(mode)) fail("invalid-argument", "Choose split or pay full.");
  const guests = [...new Set(guestUids)].filter(g => g && g !== user.id);

  const ticketRef = db.doc(`tickets/${ticketId}`);
  const tSnap = await ticketRef.get();
  if (!tSnap.exists) fail("not-found", "That ticket no longer exists.");
  const t = tSnap.data();
  const need = t.size - 1;
  if (guests.length > need) fail("invalid-argument", `This ticket seats ${t.size}. Invite up to ${need} ${need === 1 ? "person" : "people"}.`);
  const openCount = need - guests.length;
  if (openCount > 0 && !(openSeat && s.openSeats)) {
    fail("invalid-argument", `Invite ${openCount} more ${openCount === 1 ? "person" : "people"}${s.openSeats ? " or post the empty seats as open seats" : ""}.`);
  }
  for (const g of guests) {
    const gs = await db.doc(`users/${g}`).get();
    if (!gs.exists || gs.data().status !== "active") fail("failed-precondition", "One of the people you invited can't be booked right now.");
  }

  const base = Math.floor(t.price / t.size), rem = t.price - base * t.size;
  const amountFor = i => mode === "full" ? (i === 0 ? t.price : 0) : base + (i === 0 ? rem : 0);
  const seats = [{ uid: user.id, status: "pending", amount: amountFor(0), invited: false }];
  guests.forEach((g, k) => seats.push({ uid: g, status: "invited", amount: amountFor(k + 1), invited: true }));
  for (let k = 0; k < openCount; k++) seats.push({ uid: null, status: "open", amount: amountFor(guests.length + k + 1), invited: false });

  const startsMs = t.startsAt.toMillis();
  const windowEnd = Math.min(Date.now() + s.splitWindowHours * 3600000, startsMs - 60 * 60000);
  const expiresAt = Timestamp.fromMillis(Math.max(windowEnd, Date.now() + 45 * 60000));

  const bookingRef = db.collection("bookings").doc();
  const booking = {
    ticketId, venueId: t.venueId, venueName: t.venueName, title: t.title, category: t.category || "",
    hue: t.hue ?? null, items: t.items, startsAt: t.startsAt, size: t.size, total: t.price, mode,
    buyerUid: user.id, seats, memberUids: [user.id, ...guests], status: "payment",
    code: makeCode(), openSeatNote: String(note).slice(0, 140),
    buyerPayBy: minutesFromNow(BUYER_PAY_MINUTES), expiresAt, createdAt: nowTs()
  };

  await db.runTransaction(async tx => {
    const fresh = (await tx.get(ticketRef)).data();
    const venue = (await tx.get(db.doc(`venues/${fresh.venueId}`))).data();
    if (fresh.status !== "live" || fresh.adminHidden || venue?.status !== "approved") fail("failed-precondition", "This ticket isn't for sale right now.");
    if (fresh.startsAt.toMillis() < Date.now() + 30 * 60000) fail("failed-precondition", "This night has already started.");
    if (fresh.quantity - fresh.sold - fresh.held < 1) fail("resource-exhausted", "Sold out. Try another night.");
    tx.update(ticketRef, { held: FieldValue.increment(1) });
    tx.set(bookingRef, booking);
  });

  const url = await checkoutForSeat(bookingRef.id, booking, 0, req.auth.token.email);
  return { bookingId: bookingRef.id, url };
});

/** Get a fresh checkout link for a seat that's yours and still unpaid. */
exports.payMySeat = onCall(withStripe, async req => {
  await activeUser(req);
  const { bookingId } = req.data || {};
  const ref = db.doc(`bookings/${bookingId}`);
  const b = (await ref.get()).data();
  if (!b) fail("not-found", "Booking not found.");
  const i = b.seats.findIndex(x => x.uid === req.auth.uid && ["pending", "claimed"].includes(x.status));
  if (i < 0) fail("failed-precondition", "Nothing to pay on this booking.");
  if (["canceled", "refunded"].includes(b.status)) fail("failed-precondition", "This booking was canceled.");
  const patch = i === 0 ? { buyerPayBy: minutesFromNow(BUYER_PAY_MINUTES) } : { [`seats`]: b.seats.map((x, k) => k === i ? { ...x, claimedAt: nowTs() } : x) };
  await ref.update(patch);
  return { url: await checkoutForSeat(bookingId, b, i, req.auth.token.email) };
});

exports.acceptInvite = onCall(withStripe, async req => {
  const user = await activeUser(req);
  const s = await getSettings();
  checkEligible(user, s);
  const { bookingId } = req.data || {};
  const ref = db.doc(`bookings/${bookingId}`);
  let idx = -1, booking;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "This invite has expired.");
    const b = snap.data();
    if (!["awaiting", "confirmed"].includes(b.status)) fail("failed-precondition", "This invite is no longer active.");
    idx = b.seats.findIndex(x => x.uid === user.id && ["invited", "claimed"].includes(x.status));
    if (idx < 0) fail("failed-precondition", "You've already answered this invite.");
    const seat = b.seats[idx];
    b.seats[idx] = seat.amount === 0 ? { ...seat, status: "paid", paidAt: nowTs() } : { ...seat, status: "claimed", claimedAt: nowTs() };
    tx.update(ref, { seats: b.seats });
    booking = b;
  });
  const seat = booking.seats[idx];
  await postToChat(booking.buyerUid, user.id, { from: "system", type: "system", text: `${user.name} accepted the invite to ${booking.title}.` });
  if (seat.amount === 0) return { done: true };
  return { url: await checkoutForSeat(bookingId, booking, idx, req.auth.token.email) };
});

exports.declineInvite = onCall(withStripe, async req => {
  const user = await activeUser(req);
  const s = await getSettings();
  const { bookingId } = req.data || {};
  const ref = db.doc(`bookings/${bookingId}`);
  let b, cancel = false;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "This invite has expired.");
    b = snap.data();
    const i = b.seats.findIndex(x => x.uid === user.id && ["invited", "claimed"].includes(x.status));
    if (i < 0) fail("failed-precondition", "You've already answered this invite.");
    if (s.openSeats) {
      b.seats[i] = { status: "open", amount: b.seats[i].amount, uid: null, invited: false };
      b.memberUids = b.memberUids.filter(u => u !== user.id);
      tx.update(ref, { seats: b.seats, memberUids: b.memberUids });
    } else cancel = true;
  });
  await postToChat(b.buyerUid, user.id, { from: "system", type: "system", text: `${user.name} can't make ${b.title}.${s.openSeats && !cancel ? " Their seat is now listed as an open seat." : ""}` });
  if (cancel) await cancelBooking(bookingId, "A guest declined the invite.");
  else await syncOpenSeats(bookingId, b);
  return { ok: true };
});

exports.joinOpenSeat = onCall(withStripe, async req => {
  const user = await activeUser(req);
  const s = await getSettings();
  checkEligible(user, s);
  if (!s.openSeats) fail("failed-precondition", "Open seats are turned off right now.");
  const { bookingId } = req.data || {};
  const ref = db.doc(`bookings/${bookingId}`);
  let idx = -1, b;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "That seat is gone.");
    b = snap.data();
    if (!["awaiting", "confirmed"].includes(b.status)) fail("failed-precondition", "That seat is no longer available.");
    if (b.memberUids.includes(user.id)) fail("already-exists", "You're already on this ticket.");
    idx = b.seats.findIndex(x => x.status === "open");
    if (idx < 0) fail("resource-exhausted", "Someone just took the last seat.");
    const amt = b.seats[idx].amount;
    b.seats[idx] = { uid: user.id, amount: amt, invited: false, status: amt === 0 ? "paid" : "claimed", claimedAt: nowTs(), ...(amt === 0 ? { paidAt: nowTs() } : {}) };
    b.memberUids = [...b.memberUids, user.id];
    tx.update(ref, { seats: b.seats, memberUids: b.memberUids });
  });
  await syncOpenSeats(bookingId, b);
  await postToChat(b.buyerUid, user.id, { from: "system", type: "system", text: `${user.name} took an open seat on ${b.title}.` });
  if (b.seats[idx].amount === 0) return { done: true };
  return { url: await checkoutForSeat(bookingId, b, idx, req.auth.token.email) };
});

/** The buyer can cancel before everyone has paid; paid seats are refunded. */
exports.cancelMyBooking = onCall(withStripe, async req => {
  await activeUser(req);
  const { bookingId } = req.data || {};
  const b = (await db.doc(`bookings/${bookingId}`).get()).data();
  if (!b || b.buyerUid !== req.auth.uid) fail("permission-denied", "Only the person who booked can cancel.");
  if (b.status === "confirmed") fail("failed-precondition", "Confirmed tickets can only be canceled by the venue or support.");
  await cancelBooking(bookingId, "The host canceled.");
  return { ok: true };
});

/* ================= Stripe webhook ================= */
// Named nightsStripeWebhook so it doesn't clash with Whisper+me's own stripeWebhook.
exports.nightsStripeWebhook = onRequest({ secrets: [STRIPE_SECRET, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  let event;
  try {
    event = stripe().webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET.value());
  } catch (e) {
    logger.warn("Bad webhook signature", e.message);
    res.status(400).send("Bad signature"); return;
  }
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const sess = event.data.object;
      if (sess.payment_status === "paid") await seatPaid(sess);
    } else if (event.type === "checkout.session.expired") {
      await seatCheckoutExpired(event.data.object);
    } else if (event.type === "account.updated") {
      const acct = event.data.object;
      const q = await db.collection("venues").where("stripeAccountId", "==", acct.id).limit(1).get();
      if (!q.empty) await q.docs[0].ref.update({ payoutsEnabled: !!(acct.charges_enabled && acct.payouts_enabled) });
    }
    res.json({ received: true });
  } catch (e) {
    logger.error("Webhook handler failed", event.type, e);
    res.status(500).send("Handler error");
  }
});

async function seatPaid(sess) {
  const { bookingId, seatIndex, uid } = sess.metadata || {};
  if (!bookingId) return;
  const i = Number(seatIndex);
  const ref = db.doc(`bookings/${bookingId}`);
  const s = await getSettings();
  let outcome = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const b = snap.data();
    const seat = b.seats[i];
    if (!seat || seat.uid !== uid) { outcome = { refund: true }; return; }
    if (seat.status === "paid") return; // already handled (webhooks can repeat)
    if (["canceled", "refunded"].includes(b.status)) { outcome = { refund: true }; return; }
    b.seats[i] = { ...seat, status: "paid", paidAt: nowTs(), paymentIntent: sess.payment_intent };
    const firstPayment = i === 0 && b.status === "payment";
    const patch = { seats: b.seats };
    if (firstPayment) { patch.status = "awaiting"; b.status = "awaiting"; }
    tx.update(ref, patch);
    const confirmNow = moneyCollected(b) >= b.total;
    if (confirmNow) { confirmInTx(tx, ref, b, s); b.status = "confirmed"; }
    outcome = { b, firstPayment, confirmNow };
  });
  if (!outcome) return;
  if (outcome.refund) {
    await stripe().refunds.create({ payment_intent: sess.payment_intent, metadata: { bookingId, reason: "booking no longer active" } });
    return;
  }
  const { b, firstPayment, confirmNow } = outcome;
  if (firstPayment) {
    for (const seat of b.seats.filter(x => x.invited && x.uid)) {
      await postToChat(b.buyerUid, seat.uid, { from: b.buyerUid, type: "invite", bookingId, title: b.title, text: "" });
    }
  }
  if (confirmNow) {
    for (const m of b.memberUids) await db.doc(`users/${m}`).update({ bookingsCount: FieldValue.increment(1) }).catch(() => {});
    for (const m of b.memberUids.filter(x => x !== b.buyerUid)) {
      await postToChat(b.buyerUid, m, { from: "system", type: "system", text: `You're all set for ${b.title} on ${fmtWhen(b.startsAt)}. Show code ${b.code} at ${b.venueName}.` });
    }
  }
  await syncOpenSeats(bookingId, b);
}

async function seatCheckoutExpired(sess) {
  const { bookingId, seatIndex, uid } = sess.metadata || {};
  if (!bookingId) return;
  const i = Number(seatIndex);
  const ref = db.doc(`bookings/${bookingId}`);
  let b = null, cancelIt = false;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    b = snap.data();
    const seat = b.seats[i];
    if (!seat || seat.uid !== uid) { b = null; return; }
    if (i === 0 && b.status === "payment" && seat.status === "pending") { cancelIt = true; return; }
    if (seat.status === "claimed") { resetSeat(b, i); tx.update(ref, { seats: b.seats, memberUids: b.memberUids }); }
    else b = null;
  });
  if (cancelIt) await cancelBooking(bookingId, "Checkout wasn't completed.");
  else if (b) await syncOpenSeats(bookingId, b);
}

/* ================= scheduled cleanup ================= */
exports.nightsExpireBookings = onSchedule({ schedule: "every 10 minutes", ...withStripe }, async () => {
  const now = Date.now();
  // 1) Buyer never finished checkout.
  const unpaid = await db.collection("bookings").where("status", "==", "payment").limit(300).get();
  for (const d of unpaid.docs) {
    if (d.data().buyerPayBy.toMillis() < now) await cancelBooking(d.id, "Checkout wasn't completed.");
  }
  // 2) Split window ran out before everyone paid.
  const late = await db.collection("bookings").where("status", "==", "awaiting").where("expiresAt", "<", Timestamp.fromMillis(now)).limit(300).get();
  for (const d of late.docs) await cancelBooking(d.id, "Not every seat was paid in time.");
  // 3) Guests who opened a checkout and walked away: free their seat again.
  const waiting = await db.collection("bookings").where("status", "==", "awaiting").limit(500).get();
  for (const d of waiting.docs) {
    const b = d.data();
    const stale = b.seats.map((x, i) => x.status === "claimed" && x.claimedAt && x.claimedAt.toMillis() < now - CLAIM_MINUTES * 60000 ? i : -1).filter(i => i >= 0);
    if (!stale.length) continue;
    stale.forEach(i => resetSeat(b, i));
    await d.ref.update({ seats: b.seats, memberUids: b.memberUids });
    await syncOpenSeats(d.id, b);
  }
});

/* ================= chat moderation & counters ================= */
const PAYMENT_ASK = /(cash\s?app|\$[a-z][a-z0-9_]{2,}|zelle|venmo|paypal\.me|apple\s?pay\s?(me|to)|send\s+me\s+\$?\d+)/i;

exports.nightsOnMessage = onDocumentCreated("chats/{cid}/messages/{mid}", async event => {
  const m = event.data?.data();
  if (!m || m.type !== "text") return;
  const s = await getSettings();
  const chatRef = db.doc(`chats/${event.params.cid}`);
  const chat = (await chatRef.get()).data();
  if (!chat) return;
  let text = m.text;
  if (s.chatFilter && PAYMENT_ASK.test(m.text)) {
    await event.data.ref.update({ hidden: true, hiddenReason: "payment-request" });
    text = "Message hidden: asking for money outside the app isn't allowed";
  }
  const other = chat.members.find(x => x !== m.from);
  await chatRef.update({
    updatedAt: FieldValue.serverTimestamp(),
    lastMessage: { text: text.slice(0, 120), from: m.from },
    [`unread.${other}`]: FieldValue.increment(1)
  });
  await db.doc(`users/${m.from}`).update({ lastActive: FieldValue.serverTimestamp() }).catch(() => {});
});

exports.nightsOnReport = onDocumentCreated("reports/{rid}", async event => {
  const r = event.data?.data();
  if (r?.aboutType === "user") await db.doc(`users/${r.about}`).update({ reportsCount: FieldValue.increment(1) }).catch(() => {});
});

exports.nightsOnVenue = onDocumentCreated("venues/{vid}", async event => {
  const v = event.data?.data();
  const s = await getSettings();
  if (v && s.autoApproveVenues && v.docsUploaded) await event.data.ref.update({ status: "approved", approvedAt: nowTs() });
});

/* ================= venue functions ================= */

/** Venue staff enter the guest's code at the door. */
exports.checkIn = onCall(async req => {
  if (!req.auth) fail("unauthenticated", "Sign in first.");
  const code = String(req.data?.code || "").trim().toUpperCase();
  if (!code) fail("invalid-argument", "Enter the code from the guest's ticket.");
  const q = await db.collection("bookings").where("code", "==", code).limit(1).get();
  if (q.empty) fail("not-found", `No ticket matches ${code}. Check the letters and try again.`);
  const doc = q.docs[0], b = doc.data();
  await ownedVenue(req.auth.uid, b.venueId);
  if (b.status !== "confirmed") fail("failed-precondition", `This ticket isn't confirmed (status: ${b.status}).`);
  const names = [];
  for (const m of b.memberUids) names.push(((await db.doc(`users/${m}`).get()).data() || {}).name || "Guest");
  const already = !!b.checkedInAt;
  if (!already) await doc.ref.update({ checkedInAt: nowTs() });
  return { title: b.title, startsAt: b.startsAt.toMillis(), size: b.size, guests: names, already };
});

/** Start or continue Stripe payout setup for a venue. */
exports.venueStripeLink = onCall(withStripe, async req => {
  if (!req.auth) fail("unauthenticated", "Sign in first.");
  const v = await ownedVenue(req.auth.uid, req.data?.venueId);
  if (v.status !== "approved") fail("failed-precondition", "Payout setup opens once your venue is approved.");
  let acct = v.stripeAccountId;
  if (!acct) {
    const a = await stripe().accounts.create({
      type: "express", country: "US", email: req.auth.token.email || undefined,
      capabilities: { transfers: { requested: true } },
      business_profile: { name: v.name, product_description: `Date-night packages sold on ${BRAND_NAME.value()}` },
      metadata: { venueId: v.id }
    });
    acct = a.id;
    await db.doc(`venues/${v.id}`).update({ stripeAccountId: acct, payoutsEnabled: false });
  }
  const base = APP_URL.value().replace(/\/$/, "");
  const link = await stripe().accountLinks.create({
    account: acct, type: "account_onboarding",
    refresh_url: `${base}${NIGHTS}/venue?stripe=refresh`, return_url: `${base}${NIGHTS}/venue?stripe=done`
  });
  return { url: link.url };
});

exports.venueStripeStatus = onCall(withStripe, async req => {
  if (!req.auth) fail("unauthenticated", "Sign in first.");
  const v = await ownedVenue(req.auth.uid, req.data?.venueId);
  if (!v.stripeAccountId) return { payoutsEnabled: false };
  const a = await stripe().accounts.retrieve(v.stripeAccountId);
  const ok = !!(a.charges_enabled && a.payouts_enabled) || !!a.payouts_enabled;
  await db.doc(`venues/${v.id}`).update({ payoutsEnabled: ok });
  return { payoutsEnabled: ok };
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
async function suspendUser(uid, reason) {
  await db.doc(`users/${uid}`).update({ status: "suspended", suspendedReason: reason, openToMeet: false });
  await admin.auth().updateUser(uid, { disabled: true }).catch(() => {});
}
async function pauseVenue(vid, reason) {
  await db.doc(`venues/${vid}`).update({ status: "paused", pausedReason: reason });
  await setVenueTicketsHidden(vid, true);
}

exports.nightsAdminAction = onCall(withStripe, async req => {
  requireAdmin(req);
  const { action, id, reason = "", data = {} } = req.data || {};
  const nameOf = async (col, docId) => ((await db.doc(`${col}/${docId}`).get()).data() || {}).name || docId;

  switch (action) {
    /* venues */
    case "approveVenue": {
      await db.doc(`venues/${id}`).update({ status: "approved", approvedAt: nowTs(), pausedReason: FieldValue.delete() });
      await log(req, action, id, await nameOf("venues", id)); return { message: "Venue approved" };
    }
    case "declineVenue": {
      await db.doc(`venues/${id}`).update({ status: "declined", declinedReason: reason || "Didn't meet requirements" });
      await log(req, action, id, await nameOf("venues", id)); return { message: "Venue declined" };
    }
    case "pauseVenue": {
      await pauseVenue(id, reason || "Paused by admin");
      await log(req, action, id, `${await nameOf("venues", id)}: ${reason}`); return { message: "Venue paused and its tickets hidden" };
    }
    case "resumeVenue": {
      await db.doc(`venues/${id}`).update({ status: "approved", pausedReason: FieldValue.delete() });
      await setVenueTicketsHidden(id, false);
      await log(req, action, id, await nameOf("venues", id)); return { message: "Venue is back on" };
    }
    /* tickets */
    case "hideTicket":
    case "showTicket": {
      const hide = action === "hideTicket";
      await db.doc(`tickets/${id}`).update(hide ? { adminHidden: true, hiddenReason: "admin" } : { adminHidden: false, hiddenReason: FieldValue.delete() });
      const t = (await db.doc(`tickets/${id}`).get()).data();
      await log(req, action, id, t?.title || ""); return { message: hide ? "Ticket hidden" : "Ticket is for sale again" };
    }
    /* members */
    case "verifyUser": {
      await db.doc(`users/${id}`).update({ verified: true, verifiedAt: nowTs() });
      await log(req, action, id, await nameOf("users", id)); return { message: "Member verified" };
    }
    case "rejectId": {
      await db.doc(`users/${id}`).update({ idUploaded: false, lastWarning: "Your ID couldn't be verified. Upload a clear photo of a government ID.", warningAt: nowTs() });
      await log(req, action, id, await nameOf("users", id)); return { message: "Asked member to re-upload ID" };
    }
    case "suspendUser": {
      await suspendUser(id, reason || "Suspended by admin");
      await log(req, action, id, `${await nameOf("users", id)}: ${reason}`); return { message: "Member suspended" };
    }
    case "restoreUser": {
      await db.doc(`users/${id}`).update({ status: "active", suspendedReason: FieldValue.delete() });
      await admin.auth().updateUser(id, { disabled: false }).catch(() => {});
      await log(req, action, id, await nameOf("users", id)); return { message: "Member restored" };
    }
    /* bookings */
    case "cancelBooking": {
      const ok = await cancelBooking(id, reason || "Canceled by support.");
      await log(req, action, id, reason); return { message: ok ? "Booking canceled and paid seats refunded" : "Booking was already canceled" };
    }
    case "remindBooking": {
      const b = (await db.doc(`bookings/${id}`).get()).data();
      if (!b) fail("not-found", "Booking not found.");
      const unpaid = b.seats.filter(x => x.uid && x.uid !== b.buyerUid && ["invited", "claimed"].includes(x.status));
      for (const seat of unpaid) {
        await postToChat(b.buyerUid, seat.uid, { from: "system", type: "system", text: `Reminder: your seat for ${b.title} isn't paid yet. It's released ${fmtWhen(b.expiresAt)} if unpaid.` });
      }
      await log(req, action, id, `${unpaid.length} reminded`); return { message: unpaid.length ? `Reminder sent to ${unpaid.length}` : "Everyone invited has already paid" };
    }
    /* reports */
    case "resolveReport": {
      const ref = db.doc(`reports/${id}`); const r = (await ref.get()).data();
      if (!r) fail("not-found", "Report not found.");
      const decision = data.decision;
      if (decision === "warn" && r.aboutType === "user") {
        await db.doc(`users/${r.about}`).update({ warnings: FieldValue.increment(1), lastWarning: data.message || "We got a report about your behavior. Please follow the community rules.", warningAt: nowTs() });
      }
      if (decision === "suspend") {
        if (r.aboutType === "user") await suspendUser(r.about, r.reason); else await pauseVenue(r.about, r.reason);
      }
      const label = { dismiss: "Dismissed", warn: "Warning sent", suspend: r.aboutType === "user" ? "Member suspended" : "Venue paused" }[decision];
      if (!label) fail("invalid-argument", "Pick dismiss, warn or suspend.");
      await ref.update({ status: label, resolvedAt: nowTs(), resolvedBy: req.auth.uid });
      await log(req, "resolveReport", id, `${label}: ${r.reason}`); return { message: label };
    }
    /* payouts */
    case "payVenue":
    case "markVenuePaid": {
      const v = (await db.doc(`venues/${id}`).get()).data();
      if (!v) fail("not-found", "Venue not found.");
      const due = await db.collection("payouts").where("venueId", "==", id).where("status", "==", "due").get();
      const amount = due.docs.reduce((a, d) => a + d.data().amount, 0);
      if (!amount) return { message: "Nothing due for this venue" };
      let transferId = null;
      if (action === "payVenue") {
        if (!v.stripeAccountId || !v.payoutsEnabled) fail("failed-precondition", `${v.name} hasn't finished payout setup. Ask them to connect Stripe from their venue dashboard, or use "Mark paid" if you paid them another way.`);
        const tr = await stripe().transfers.create({ amount, currency: "usd", destination: v.stripeAccountId, metadata: { venueId: id, payouts: String(due.size) } });
        transferId = tr.id;
      }
      const batch = db.batch();
      due.docs.forEach(d => batch.update(d.ref, { status: "paid", paidAt: nowTs(), transferId, method: transferId ? "stripe" : "manual" }));
      await batch.commit();
      await log(req, action, id, `${v.name} ${fmtMoney(amount)}`); return { message: `Paid ${fmtMoney(amount)} to ${v.name}` };
    }
    /* settings */
    case "saveSettings": {
      const s = {
        fee: Math.min(50, Math.max(0, Number(data.fee))),
        splitWindowHours: Math.min(72, Math.max(1, Math.round(Number(data.splitWindowHours)))),
        minAge: Math.min(25, Math.max(18, Math.round(Number(data.minAge)))),
        requireIdVerify: !!data.requireIdVerify, openSeats: !!data.openSeats,
        chatFilter: !!data.chatFilter, autoApproveVenues: !!data.autoApproveVenues
      };
      if ([s.fee, s.splitWindowHours, s.minAge].some(Number.isNaN)) fail("invalid-argument", "Fee, time window and age must be numbers.");
      await db.doc("settings/platform").set(s, { merge: true });
      await log(req, action, "settings", `fee ${s.fee}%, window ${s.splitWindowHours}h, age ${s.minAge}+`); return { message: "Settings saved" };
    }
    default: fail("invalid-argument", `Unknown action: ${action}`);
  }
});
