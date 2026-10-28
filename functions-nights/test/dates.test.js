// End-to-end tests of the Dates money rules with in-memory Firebase and Stripe.
// Run: npm test   (from functions-nights/)
const path = require("path");
const assert = require("assert");
process.env.DATES_TEST = "1";
process.env.GCLOUD_PROJECT = "demo-test";
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: "demo-test" });

// Swap firebase-admin for the in-memory fake before the functions load.
const fake = require("./fake-admin");
const adminPath = require.resolve("firebase-admin", { paths: [path.join(__dirname, "..")] });
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: fake };
const F = require("../index.js");
const T = F.__test;
const { __store: store, __rtdb: rtdb, __Timestamp: Timestamp } = fake;

/* ---------- fake Stripe ---------- */
const S = { intents: {}, refunds: [], canceled: [], captured: [], sessions: [], failCapture: new Set(), n: 0 };
T.setStripe({
  checkout: { sessions: { create: async o => { const id = "cs_" + (++S.n); S.sessions.push({ id, ...o }); return { id, url: "https://stripe.test/" + id }; } } },
  paymentIntents: {
    retrieve: async id => S.intents[id],
    capture: async id => { if (S.failCapture.has(id)) throw new Error("card_declined"); S.intents[id].status = "succeeded"; S.captured.push(id); return S.intents[id]; },
    cancel: async id => { S.intents[id].status = "canceled"; S.canceled.push(id); return S.intents[id]; }
  },
  refunds: { create: async o => { S.refunds.push(o.payment_intent); return { id: "re_" + (++S.n) }; } },
  transfers: { create: async () => ({ id: "tr_1" }) }
});
// Simulate the customer finishing the most recent checkout session.
async function completeLastCheckout(uid) {
  const sess = [...S.sessions].reverse().find(s => s.metadata.uid === uid);
  const pi = "pi_" + (++S.n);
  const hold = sess.payment_intent_data.capture_method === "manual";
  S.intents[pi] = { id: pi, status: hold ? "requires_capture" : "succeeded" };
  await T.handleStripeEvent({ type: "checkout.session.completed", data: { object: {
    id: sess.id, metadata: sess.metadata, payment_intent: pi, payment_status: hold ? "unpaid" : "paid",
    amount_total: sess.line_items[0].price_data.unit_amount } } });
  return pi;
}

/* ---------- clock control ---------- */
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const advanceHours = h => { offset += h * 3600000; };

/* ---------- helpers ---------- */
const call = (fn, uid, data = {}) => F[fn].run({ data, auth: uid ? { uid, token: { email: uid + "@x.com", firebase: { sign_in_provider: "password" } } } : null, rawRequest: {} });
const doc = p => store.get(p);
const date = id => doc("dates/" + id);
const H = 3600000;
function seedPeople(...uids) { rtdb.users = rtdb.users || {}; uids.forEach(u => { rtdb.users[u] = { name: u.toUpperCase(), photo: "", coins: 0 }; }); }
let ticketN = 0;
function seedTicket({ size = 2, price = 10000, hoursAway = 120, quantity = 5 } = {}) {
  store.set("venues/v1", { name: "Ember & Oak", status: "approved", ownerUid: "owner", sales: 0 });
  const id = "t" + (++ticketN);
  store.set("tickets/" + id, { venueId: "v1", venueName: "Ember & Oak", title: "Dinner & a Movie", category: "Dinner", items: ["Dinner"], size, price,
    startsAt: Timestamp.fromMillis(Date.now() + hoursAway * H), quantity, sold: 0, held: 0, status: "live", adminHidden: false });
  return id;
}
async function member(uid) {
  await call("datesJoin", uid, { birthYear: 1990 });
  await call("payDeposit", uid);
  await completeLastCheckout(uid);
  assert.strictEqual(doc("members/" + uid).deposit.status, "active");
}
async function splitDate(host, guests, opts = {}) {
  const t = seedTicket(opts);
  const r = await call("createDate", host, { ticketId: t, mode: "split", inviteUids: guests });
  await completeLastCheckout(host);
  for (const g of guests) { await call("answerInvite", g, { dateId: r.dateId, accept: true }); await completeLastCheckout(g); }
  return { id: r.dateId, t };
}
const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["ok", name]); }
  catch (e) { results.push(["FAIL", name, e.stack.split("\n").slice(0, 3).join(" | ")]); }
}

(async () => {
  seedPeople("ann", "ben", "cal", "dee", "eve", "fay", "gus", "hal");
  for (const u of ["ann", "ben", "cal", "dee", "eve", "fay", "gus"]) await member(u);

  await test("Can't create a date without a deposit", async () => {
    await call("datesJoin", "hal", { birthYear: 1990 });
    await assert.rejects(call("createDate", "hal", { ticketId: seedTicket(), mode: "split", inviteUids: ["ann"] }), /deposit/);
  });

  await test("Under-21 can't join Dates", async () => {
    seedPeople("kid");
    await assert.rejects(call("datesJoin", "kid", { birthYear: new Date().getFullYear() - 19 }), /21 and older/);
  });

  await test("Split: holds only, then everyone charged at once with one code each", async () => {
    const { id, t } = await splitDate("ann", ["ben"]);
    const d = date(id);
    assert.strictEqual(d.status, "confirmed");
    assert.strictEqual(d.seats.every(s => s.status === "paid"), true);
    assert.strictEqual(new Set(d.codes).size, 2);
    assert.strictEqual(S.captured.length, 2);
    assert.deepStrictEqual([doc("tickets/" + t).held, doc("tickets/" + t).sold], [0, 1]);
    assert.strictEqual(d.seats[0].amount + d.seats[1].amount, 10000);
  });

  await test("Split that never fills: holds dropped, nobody charged, no penalties", async () => {
    const t = seedTicket();
    const r = await call("createDate", "cal", { ticketId: t, mode: "split", inviteUids: ["dee"] });
    const pi = await completeLastCheckout("cal");
    assert.strictEqual(date(r.dateId).live, true);
    advanceHours(25);
    await T.housekeeping();
    assert.strictEqual(date(r.dateId).status, "canceled");
    assert.ok(S.canceled.includes(pi), "host hold released");
    assert.ok(!S.captured.includes(pi), "host never charged");
    assert.strictEqual(doc("tickets/" + t).held, 0);
    assert.strictEqual(doc("members/cal").deposit.status, "active");
  });

  await test("Host who never finishes checkout: ticket goes back on sale", async () => {
    const t = seedTicket();
    const r = await call("createDate", "cal", { ticketId: t, mode: "full", inviteUids: ["dee"] });
    advanceHours(1);
    await T.housekeeping();
    assert.strictEqual(date(r.dateId).status, "canceled");
    assert.strictEqual(doc("tickets/" + t).held, 0);
  });

  let fullId;
  await test("Pay in full: confirmed right away; guest joins free and gets a code", async () => {
    const t = seedTicket({ price: 8000 });
    const r = await call("createDate", "eve", { ticketId: t, mode: "full", inviteUids: ["fay"] });
    assert.strictEqual(S.sessions.at(-1).line_items[0].price_data.unit_amount, 8000);
    await completeLastCheckout("eve");
    assert.strictEqual(date(r.dateId).status, "confirmed");
    const res = await call("answerInvite", "fay", { dateId: r.dateId, accept: true });
    assert.ok(!res.url, "guest pays nothing");
    const d = date(r.dateId);
    assert.strictEqual(d.seats[1].status, "joined");
    assert.strictEqual(d.codes.length, 2);
    fullId = r.dateId;
  });

  let noShowDate;
  await test("No-show: deposit kept, strike, stood-up person gets 5 coins, venue paid after", async () => {
    const { id } = await splitDate("gus", ["dee"]);
    noShowDate = id;
    const gusCode = date(id).seats[0].code;
    const chk = await call("checkIn", "owner", { code: gusCode });
    assert.strictEqual(chk.guest, "GUS");
    advanceHours(124);
    await T.housekeeping();
    const d = date(id);
    assert.strictEqual(d.status, "completed");
    assert.deepStrictEqual(d.noShowUids, ["dee"]);
    assert.strictEqual(doc("members/dee").deposit.status, "forfeited");
    assert.strictEqual(doc("members/dee").strikes, 1);
    assert.strictEqual(rtdb.users.gus.coins, 5);
    assert.strictEqual(doc("members/gus").deposit.status, "active");
    const p = doc("payouts/" + id);
    assert.deepStrictEqual([p.status, p.amount, p.fee], ["due", 9000, 1000]);
  });

  await test("Nobody checked in at all: no penalties (venue may not have scanned)", async () => {
    const before = doc("members/ann").strikes || 0;
    // ann & ben's confirmed date from earlier has passed too
    const d = [...store.entries()].find(([p, v]) => p.startsWith("dates/") && v.hostUid === "ann");
    assert.strictEqual(d[1].status, "completed");
    assert.deepStrictEqual(d[1].noShowUids, []);
    assert.strictEqual(doc("members/ann").strikes || 0, before);
  });

  await test("Forfeited deposit blocks the next booking until a new one is paid", async () => {
    await assert.rejects(call("createDate", "dee", { ticketId: seedTicket(), mode: "split", inviteUids: ["gus"] }), /new \$5 deposit/);
    await call("payDeposit", "dee"); await completeLastCheckout("dee");
    assert.strictEqual(doc("members/dee").deposit.status, "active");
  });

  await test("Second strike: 3-day break from Dates, strikes reset", async () => {
    const { id } = await splitDate("gus", ["dee"]);
    await call("checkIn", "owner", { code: date(id).seats[0].code });
    advanceHours(124);
    await T.housekeeping();
    const m = doc("members/dee");
    assert.strictEqual(m.strikes, 0);
    const days = (m.suspendedUntil.toMillis() - Date.now()) / 86400000;
    assert.ok(days > 2.9 && days <= 3, "suspended ~3 days, got " + days);
    await call("payDeposit", "dee"); await completeLastCheckout("dee");
    await assert.rejects(call("createDate", "dee", { ticketId: seedTicket(), mode: "split", inviteUids: ["gus"] }), /break from Dates/);
    advanceHours(73);
    await call("createDate", "dee", { ticketId: seedTicket(), mode: "split", inviteUids: ["gus"] });
  });

  await test("Late cancel: warning first, then deposit kept, strike, seat stays paid for a free replacement", async () => {
    const { id } = await splitDate("ann", ["ben"], { hoursAway: 30 });
    const preview = await call("leaveDate", "ben", { dateId: id, preview: true });
    assert.ok(preview.loseDeposit && preview.strike && preview.loseTicket === 5000);
    assert.ok(preview.lines.some(l => /lose your \$5 deposit/.test(l)));
    assert.ok(preview.lines.some(l => /not refunded/.test(l)));
    assert.ok(preview.lines.some(l => /5 Whisper coins/.test(l)));
    assert.strictEqual(doc("members/ben").deposit.status, "active", "preview changes nothing");
    await call("leaveDate", "ben", { dateId: id });
    const d = date(id);
    assert.strictEqual(doc("members/ben").deposit.status, "forfeited");
    assert.strictEqual(doc("members/ben").strikes, 1);
    assert.deepStrictEqual([d.seats[1].status, d.seats[1].amount], ["open", 0]);
    assert.strictEqual(d.stoodUp, true);
    assert.strictEqual(S.refunds.length, 0, "no refunds");
    // Ann invites Cal for the free seat
    await call("inviteToDate", "ann", { dateId: id, uids: ["cal"] });
    const r = await call("answerInvite", "cal", { dateId: id, accept: true });
    assert.ok(!r.url);
    assert.strictEqual(date(id).seats[1].status, "joined");
    assert.strictEqual(date(id).codes.length, 2);
  });

  await test("Early cancel (48h+): deposit kept, no strike, reschedule offered", async () => {
    const { id } = await splitDate("eve", ["fay"], { hoursAway: 200 });
    const p = await call("leaveDate", "fay", { dateId: id, preview: true });
    assert.ok(p.loseDeposit && !p.strike && p.canReschedule);
    await call("leaveDate", "fay", { dateId: id });
    assert.strictEqual(doc("members/fay").deposit.status, "forfeited");
    assert.strictEqual(doc("members/fay").strikes || 0, 0);
  });

  await test("Declining an invite is free", async () => {
    await call("payDeposit", "fay"); await completeLastCheckout("fay");
    const t = seedTicket();
    const r = await call("createDate", "cal", { ticketId: t, mode: "split", inviteUids: ["fay"] });
    await completeLastCheckout("cal");
    await assert.rejects(call("leaveDate", "fay", { dateId: r.dateId }), /Decline/);
    await call("answerInvite", "fay", { dateId: r.dateId, accept: false });
    assert.strictEqual(doc("members/fay").deposit.status, "active");
    assert.strictEqual(date(r.dateId).seats[1].status, "open");
  });

  await test("Find me a date: request, host approves, approved person pays share, then capture", async () => {
    const t = seedTicket();
    const r = await call("createDate", "ann", { ticketId: t, mode: "split", inviteUids: [], openToRequests: true });
    await completeLastCheckout("ann");
    await call("requestToJoin", "gus", { dateId: r.dateId });
    await call("requestToJoin", "eve", { dateId: r.dateId });
    assert.strictEqual(date(r.dateId).requests.length, 2);
    await assert.rejects(call("answerRequest", "gus", { dateId: r.dateId, memberUid: "eve", approve: true }), /Only the host/);
    await call("answerRequest", "ann", { dateId: r.dateId, memberUid: "gus", approve: true });
    assert.strictEqual(date(r.dateId).requests.length, 0, "other requests closed when full");
    const pay = await call("paySeat", "gus", { dateId: r.dateId });
    assert.ok(pay.url);
    await completeLastCheckout("gus");
    assert.strictEqual(date(r.dateId).status, "confirmed");
  });

  await test("Group of 4 split: confirmed only when all 4 holds are in", async () => {
    const t = seedTicket({ size: 4, price: 32001 });
    const r = await call("createDate", "ann", { ticketId: t, mode: "split", inviteUids: ["gus", "eve", "cal"] });
    await completeLastCheckout("ann");
    for (const g of ["gus", "eve"]) { await call("answerInvite", g, { dateId: r.dateId, accept: true }); await completeLastCheckout(g); }
    assert.strictEqual(date(r.dateId).status, "forming");
    await call("answerInvite", "cal", { dateId: r.dateId, accept: true }); await completeLastCheckout("cal");
    const d = date(r.dateId);
    assert.strictEqual(d.status, "confirmed");
    assert.strictEqual(d.seats.reduce((a, s) => a + s.amount, 0), 32001);
    assert.strictEqual(d.codes.length, 4);
  });

  await test("A failed capture: that person pays again; nobody else loses anything", async () => {
    const t = seedTicket();
    const r = await call("createDate", "eve", { ticketId: t, mode: "split", inviteUids: ["gus"] });
    await completeLastCheckout("eve");
    await call("answerInvite", "gus", { dateId: r.dateId, accept: true });
    const sess = S.sessions.at(-1); const pi = "pi_" + (++S.n);
    S.intents[pi] = { id: pi, status: "requires_capture" }; S.failCapture.add(pi);
    await T.handleStripeEvent({ type: "checkout.session.completed", data: { object: { id: sess.id, metadata: sess.metadata, payment_intent: pi, payment_status: "unpaid" } } });
    let d = date(r.dateId);
    assert.strictEqual(d.status, "forming");
    assert.deepStrictEqual(d.seats.map(s => s.status), ["paid", "pay"]);
    await call("paySeat", "gus", { dateId: r.dateId }); await completeLastCheckout("gus");
    d = date(r.dateId);
    assert.strictEqual(d.status, "confirmed");
    assert.deepStrictEqual(d.seats.map(s => s.status), ["paid", "paid"]);
  });

  await test("Reschedule once when everyone agrees (48h+ ahead)", async () => {
    const { id, t } = await splitDate("cal", ["eve"], { hoursAway: 150 });
    const t2 = seedTicket({ hoursAway: 300 });
    await call("proposeReschedule", "cal", { dateId: id, ticketId: t2 });
    let r = await call("answerReschedule", "eve", { dateId: id, approve: true });
    assert.strictEqual(r.moved, true);
    assert.strictEqual(date(id).ticketId, t2);
    assert.deepStrictEqual([doc("tickets/" + t).sold, doc("tickets/" + t2).sold], [0, 1]);
    await assert.rejects(call("proposeReschedule", "cal", { dateId: id, ticketId: seedTicket({ hoursAway: 400 }) }), /already rescheduled/);
  });

  await test("Admin cancels a confirmed date (venue closed): everyone refunded, no penalties", async () => {
    const t = seedTicket({ price: 8000, hoursAway: 100 });
    const r0 = await call("createDate", "eve", { ticketId: t, mode: "full", inviteUids: ["fay"] });
    await completeLastCheckout("eve");
    fullId = r0.dateId;
    const before = S.refunds.length;
    await assert.rejects(F.nightsAdminAction.run({ data: { action: "cancelDate", id: fullId }, auth: { uid: "ann", token: {} } }), /Admins only/);
    await F.nightsAdminAction.run({ data: { action: "cancelDate", id: fullId, reason: "Venue closed" }, auth: { uid: "v6aIXY12MDY9ci1wWJmCiLOAKoG2", token: {} } });
    assert.strictEqual(date(fullId).status, "canceled");
    assert.strictEqual(S.refunds.length - before, 1, "host's full payment refunded");
  });

  await test("Coin purchases from the main app are ignored by the Dates webhook", async () => {
    const before = store.size;
    await T.handleStripeEvent({ type: "checkout.session.completed", data: { object: { metadata: { uid: "ann", qty: "3" }, payment_status: "paid" } } });
    assert.strictEqual(store.size, before);
  });

  Date.now = realNow;
  const failed = results.filter(r => r[0] === "FAIL");
  results.forEach(r => console.log(r[0] === "ok" ? "  ✓" : "  ✗", r[1], r[2] ? "\n      " + r[2] : ""));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
