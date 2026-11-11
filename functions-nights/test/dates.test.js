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
const S = { intents: {}, refunds: [], canceled: [], captured: [], sessions: [], failCapture: new Set(), n: 0, paid: {}, done: {} };
T.setStripe({
  checkout: { sessions: {
    create: async o => { const id = "cs_" + (++S.n); S.sessions.push({ id, ...o }); return { id, url: "https://stripe.test/" + id }; },
    list: async ({ payment_intent }) => ({ data: (S.paid[payment_intent] ? [S.paid[payment_intent]] : []) }),
    retrieve: async id => S.done[id] || { id, status: "open", payment_status: "unpaid", metadata: (S.sessions.find(x => x.id === id) || {}).metadata || {} }
  } },
  paymentIntents: {
    retrieve: async id => S.intents[id],
    capture: async id => { if (S.failCapture.has(id)) throw new Error("card_declined"); S.intents[id].status = "succeeded"; S.captured.push(id); return S.intents[id]; },
    cancel: async id => { S.intents[id].status = "canceled"; S.canceled.push(id); return S.intents[id]; }
  },
  refunds: { create: async o => { S.refunds.push(o.payment_intent); return { id: "re_" + (++S.n) }; } },
  // checkout.sessions.list({ payment_intent }) finds the purchase behind a dispute

  transfers: { create: async o => { if (S.failTransfer) throw new Error("Insufficient funds in Stripe account"); S.transfers = (S.transfers || []).concat([o]); return { id: "tr_" + (++S.n) }; } },
  accounts: { retrieve: async id => ({ id, payouts_enabled: id !== "acct_unfinished" }) }
});
// Simulate the customer finishing the most recent checkout session.
async function completeLastCheckout(uid) {
  const sess = [...S.sessions].reverse().find(s => s.metadata.uid === uid);
  const pi = "pi_" + (++S.n);
  const hold = sess.payment_intent_data.capture_method === "manual";
  S.intents[pi] = { id: pi, status: hold ? "requires_capture" : "succeeded" };
  S.paid[pi] = { id: sess.id, metadata: sess.metadata };
  await T.handleStripeEvent({ type: "checkout.session.completed", data: { object: {
    id: sess.id, metadata: sess.metadata, payment_intent: pi, payment_status: hold ? "unpaid" : "paid",
    amount_total: sess.line_items.reduce((a, l) => a + l.price_data.unit_amount * (l.quantity || 1), 0) } } });
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
  catch (e) { results.push(["FAIL", name, e.stack.split("\n").slice(0, 3).join(" | ") + (e.actual !== undefined ? " actual=" + JSON.stringify(e.actual) + " expected=" + JSON.stringify(e.expected) : "")]); }
}

(async () => {
  seedPeople("ann", "ben", "cal", "dee", "eve", "fay", "gus", "hal");
  for (const u of ["ann", "ben", "cal", "dee", "eve", "fay", "gus"]) await member(u);

  await test("No deposit yet: it's added to the first checkout and counts once paid", async () => {
    await call("datesJoin", "hal", { birthYear: 1990 });
    const r = await call("createDate", "hal", { ticketId: seedTicket({ price: 6000 }), mode: "full", inviteUids: ["ann"] });
    const sess = [...S.sessions].reverse().find(x => x.metadata.uid === "hal");
    assert.deepStrictEqual(sess.line_items.map(l => l.price_data.unit_amount), [6000, 500]);
    assert.ok(/deposit/i.test(sess.line_items[1].price_data.product_data.name));
    await completeLastCheckout("hal");
    assert.strictEqual(doc("members/hal").deposit.status, "active");
    assert.strictEqual(doc("members/hal").deposit.amount, 500);
    assert.strictEqual(date(r.dateId).status, "confirmed");
    // second date: no deposit line any more
    await call("createDate", "hal", { ticketId: seedTicket({ price: 6000 }), mode: "full", inviteUids: ["ann"] });
    const s2 = [...S.sessions].reverse().find(x => x.metadata.uid === "hal");
    assert.strictEqual(s2.line_items.length, 1);
  });

  await test("Guest with no deposit on a paid-in-full date pays just the deposit", async () => {
    seedPeople("ivy"); await call("datesJoin", "ivy", { birthYear: 1991 });
    const r = await call("createDate", "ann", { ticketId: seedTicket({ price: 7000 }), mode: "full", inviteUids: ["ivy"] });
    await completeLastCheckout("ann");
    const a = await call("answerInvite", "ivy", { dateId: r.dateId, accept: true });
    assert.ok(a.url, "deposit checkout");
    const sess = [...S.sessions].reverse().find(x => x.metadata.uid === "ivy");
    assert.deepStrictEqual(sess.line_items.map(l => l.price_data.unit_amount), [500]);
    await completeLastCheckout("ivy");
    const d = date(r.dateId);
    assert.strictEqual(d.seats[1].status, "joined");
    assert.strictEqual(doc("members/ivy").deposit.status, "active");
    assert.strictEqual(new Set(d.codes).size, 2);
  });

  await test("Split with deposit inside the hold: deposit only counts once captured", async () => {
    seedPeople("jo"); await call("datesJoin", "jo", { birthYear: 1990 });
    const t = seedTicket({ price: 8000 });
    const r = await call("createDate", "jo", { ticketId: t, mode: "split", inviteUids: ["ann"] });
    await completeLastCheckout("jo");
    assert.notStrictEqual((doc("members/jo").deposit || {}).status, "active", "held, not yet captured");
    await call("answerInvite", "ann", { dateId: r.dateId, accept: true }); await completeLastCheckout("ann");
    assert.strictEqual(date(r.dateId).status, "confirmed");
    assert.strictEqual(doc("members/jo").deposit.status, "active");
  });

  await test("Under-21 can't join Dates", async () => {
    seedPeople("kid");
    await assert.rejects(call("datesJoin", "kid", { birthYear: new Date().getFullYear() - 19 }), /21 and older/);
  });

  await test("Split: holds only, then everyone charged at once with one code each", async () => {
    const cap0 = S.captured.length;
    const { id, t } = await splitDate("ann", ["ben"]);
    const d = date(id);
    assert.strictEqual(d.status, "confirmed");
    assert.strictEqual(d.seats.every(s => s.status === "paid"), true);
    assert.strictEqual(new Set(d.codes).size, 2);
    assert.strictEqual(S.captured.length - cap0, 2);
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
  await test("No-show: deposit kept, strike, stood-up person gets 1 coin, venue paid after", async () => {
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
    assert.strictEqual(rtdb.users.gus.coins, 1);
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

  await test("Forfeited deposit: a new one is added to the next booking's checkout", async () => {
    assert.strictEqual(doc("members/dee").deposit.status, "forfeited");
    await call("createDate", "dee", { ticketId: seedTicket(), mode: "full", inviteUids: ["gus"] });
    const sess = [...S.sessions].reverse().find(x => x.metadata.uid === "dee");
    assert.strictEqual(sess.line_items.length, 2);
    await completeLastCheckout("dee");
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
    await assert.rejects(call("createDate", "dee", { ticketId: seedTicket(), mode: "split", inviteUids: ["gus"] }), /break from M&G/);
    advanceHours(73);
    await call("createDate", "dee", { ticketId: seedTicket(), mode: "split", inviteUids: ["gus"] });
  });

  await test("Late cancel: warning first, then deposit kept, strike, seat stays paid for a free replacement", async () => {
    const { id } = await splitDate("ann", ["ben"], { hoursAway: 30 });
    const preview = await call("leaveDate", "ben", { dateId: id, preview: true });
    assert.ok(preview.loseDeposit && preview.strike && preview.loseTicket === 5000);
    assert.ok(preview.lines.some(l => /lose your \$5 deposit/.test(l)));
    assert.ok(preview.lines.some(l => /not refunded/.test(l)));
    assert.ok(preview.lines.some(l => /1 Whisper coin\b/.test(l)));
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

  await test("Admin posts a venue + ticket from the main admin; it's live for everyone", async () => {
    const A = { uid: "v6aIXY12MDY9ci1wWJmCiLOAKoG2", token: { email: "a@x.com" } };
    const run = d => F.nightsAdminAction.run({ data: d, auth: A });
    await assert.rejects(F.nightsAdminAction.run({ data: { action: "createVenue", data: { name: "X", city: "Y" } }, auth: { uid: "ann", token: {} } }), /Admins only/);
    const v = await run({ action: "createVenue", data: { name: "Ember & Oak", city: "Belleville, IL", type: "Restaurant" } });
    assert.strictEqual(doc("venues/" + v.id).status, "approved");
    const when = Date.now() + 5 * 86400000;
    await assert.rejects(run({ action: "createTicket", data: { venueId: v.id, title: "Too soon", category: "Dinner", items: ["x"], size: 2, price: 50, quantity: 3, startsAt: Date.now() + 3600000 } }), /3 hours/);
    await assert.rejects(run({ action: "createTicket", data: { venueId: v.id, title: "No items", category: "Dinner", items: [], size: 2, price: 50, quantity: 3, startsAt: when } }), /included/);
    const t = await run({ action: "createTicket", data: { venueId: v.id, title: "Dinner & a Movie", category: "Dinner", items: ["3-course dinner", "2 movie tickets"], size: 2, price: 80, quantity: 4, startsAt: when, note: "Dress up" } });
    const tk = doc("tickets/" + t.id);
    assert.deepStrictEqual([tk.status, tk.adminHidden, tk.price, tk.sold, tk.held, tk.venueName], ["live", false, 8000, 0, 0, "Ember & Oak"]);
    // a member can book it like any venue ticket
    seedPeople("pia", "quin"); await member("pia");
    const r = await call("createDate", "pia", { ticketId: t.id, mode: "full", inviteUids: ["quin"] });
    assert.ok(r.dateId);
    await assert.rejects(run({ action: "updateTicket", id: t.id, data: { quantity: 0 } }), /already sold or held/);
    await run({ action: "removeVenue", id: v.id });
    assert.deepStrictEqual([doc("venues/" + v.id).status, doc("tickets/" + t.id).adminHidden], ["removed", true]);
    await run({ action: "resumeVenue", id: v.id });
    assert.deepStrictEqual([doc("venues/" + v.id).status, doc("tickets/" + t.id).adminHidden], ["approved", false]);
    await run({ action: "updateTicket", id: t.id, data: { status: "ended" } });
    assert.strictEqual(doc("tickets/" + t.id).status, "ended");
  });

  await test("Admin edits a venue + ticket, deletes a venue, share page is clean", async () => {
    const A = { uid: "v6aIXY12MDY9ci1wWJmCiLOAKoG2", token: { email: "a@x.com" } };
    const run = d => F.nightsAdminAction.run({ data: d, auth: A });
    const v = await run({ action: "createVenue", data: { name: "Old Name", city: "Cahokia, IL" } });
    const when = Date.now() + 6 * 86400000;
    const t = await run({ action: "createTicket", data: { venueId: v.id, title: "Wing Night", category: "Dinner", items: ["Wings"], size: 2, price: 40, quantity: 5, startsAt: when } });
    await run({ action: "editVenue", id: v.id, data: { name: "New Name", city: "Cahokia, IL" } });
    assert.strictEqual(doc("tickets/" + t.id).venueName, "New Name");
    await run({ action: "editTicket", id: t.id, data: { title: "Wing & Trivia Night", category: "Activities", items: ["Wings", "Trivia"], size: 2, price: 45, quantity: 8, startsAt: doc("tickets/" + t.id).startsAt.toMillis() } });
    const tk = doc("tickets/" + t.id);
    assert.deepStrictEqual([tk.title, tk.category, tk.price, tk.quantity], ["Wing & Trivia Night", "Activities", 4500, 8]);
    const html = await T.dateOGPage(t.id);
    assert.ok(html.includes('og:title" content="Wing &amp; Trivia Night at New Name"'), "title");
    assert.ok(/og:description" content="[^"]*For 2: \$45, or \$22\.50 each/.test(html), "description");
    assert.ok(html.includes("?dates=1&amp;ticket=" + t.id), "redirect to ticket");
    // booked → price can't change
    seedPeople("kay"); await member("kay");
    await call("createDate", "kay", { ticketId: t.id, mode: "full", inviteUids: ["ann"] });
    await assert.rejects(run({ action: "editTicket", id: t.id, data: { title: "X", category: "Dinner", items: ["Wings"], size: 2, price: 99, quantity: 8, startsAt: doc("tickets/" + t.id).startsAt.toMillis() } }), /already booked/);
    await run({ action: "deleteVenue", id: v.id });
    assert.deepStrictEqual([doc("venues/" + v.id).adminDeleted, doc("venues/" + v.id).status, doc("tickets/" + t.id).adminHidden], [true, "removed", true]);
    assert.ok((await T.dateOGPage("nope")).includes("Date nights on Whisper+Me"));
  });

  const mgData = (o = {}) => Object.assign({ title: "Dinner & pics with Star", about: "We eat, talk, take pictures.", category: "Dinner", items: ["Dinner", "Photo"],
    startsAt: Date.now() + 72 * H, price: 100, spots: 3,
    venue: { name: "Ember & Oak", address: "123 Main St", city: "Belleville, IL", phone: "618-555-0100", source: "osm" },
    contact: { email: "star@x.com", phone: "618-555-0199" } }, o);
  const admin = d => F.nightsAdminAction.run({ data: d, auth: { uid: "v6aIXY12MDY9ci1wWJmCiLOAKoG2", token: {} } });

  await test("M&G: deposit, admin review, private address, host check-in, host paid 90%", async () => {
    seedPeople("star", "fan1", "fan2", "fan3"); await call("datesJoin", "star", { birthYear: 1990 });
    for (const f of ["fan1", "fan2", "fan3"]) await call("datesJoin", f, { birthYear: 1992 });
    await assert.rejects(call("createMeetup", "star", mgData({ venue: { name: "X", address: "1 A St", city: "Y", phone: "" } })), /phone number/);
    await assert.rejects(call("createMeetup", "star", mgData({ startsAt: Date.now() + 3 * H })), /24 hours/);
    const mk = await call("createMeetup", "star", mgData());
    const id = mk.id;
    const dep = [...S.sessions].reverse().find(x => x.metadata.uid === "star");
    assert.deepStrictEqual([dep.metadata.kind, dep.line_items[0].price_data.unit_amount], ["hostdeposit", 10000]);
    assert.strictEqual(doc("meetups/" + id).status, "draft");
    assert.ok(!JSON.stringify(doc("meetups/" + id)).includes("123 Main St"), "address is not on the public doc");
    assert.strictEqual(doc("meetups/" + id + "/private/info").venue.address, "123 Main St");
    assert.strictEqual(doc("members/star").hostContact.email, "star@x.com");
    await completeLastCheckout("star");
    assert.deepStrictEqual([doc("meetups/" + id).status, doc("meetups/" + id).hostDeposit.status], ["pending", "held"]);
    await assert.rejects(call("buyMeetupSpot", "fan1", { meetupId: id }), /isn't available/);
    await admin({ action: "requestMeetupChanges", id, reason: "Add the venue's real phone number" });
    let mine = await call("myMeetups", "star");
    assert.strictEqual(mine.meetups[0].changesNote, "Add the venue's real phone number");
    const ed = await call("editMeetup", "star", { meetupId: id, data: mgData({ title: "Dinner & photos with Star", venue: { name: "Ember & Oak", address: "123 Main St", city: "Belleville, IL", phone: "618-555-0123", source: "osm" } }) });
    assert.strictEqual(ed.status, "pending");
    await admin({ action: "approveMeetup", id });
    assert.strictEqual(doc("meetups/" + id).status, "live");
    for (const f of ["fan1", "fan2"]) { await call("buyMeetupSpot", f, { meetupId: id }); await completeLastCheckout(f); }
    await call("buyMeetupSpot", "fan3", { meetupId: id });
    // after sales: price/time/place locked
    await assert.rejects(call("editMeetup", "star", { meetupId: id, data: mgData({ venue: { name: "Other Place", address: "9 B St", city: "Belleville, IL", phone: "618-555-0123" } }) }), /can't change/);
    const fan = (await call("myMeetups", "fan1")).meetups[0];
    assert.deepStrictEqual([fan.address, fan.venuePhone], ["123 Main St", "618-555-0123"]);
    assert.ok(/^MG-/.test(fan.code));
    assert.strictEqual((await call("myMeetups", "fan3")).meetups.length, 0, "unpaid buyer sees nothing");
    advanceHours(72);
    await assert.rejects(call("checkInGuest", "fan2", { code: fan.code }), /different M&G/);
    const ci = await call("checkInGuest", "star", { code: fan.code });
    assert.ok(/FAN1/.test(ci.guest));
    const earn0 = Number(rtdb.users.star.earnings || 0), r0 = S.refunds.length;
    advanceHours(4); await T.housekeeping();
    // paid out 3 days after the start, not right away
    assert.strictEqual(doc("meetups/" + id).status, "paying");
    assert.strictEqual(Number(rtdb.users.star.earnings || 0), earn0, "not paid yet");
    const hostView = (await call("myMeetups", "star")).meetups.find(m => m.id === id && m.host);
    assert.deepStrictEqual(hostView.guests.map(g => [g.name, g.here]), [["FAN1", true], ["FAN2", false]]);
    advanceHours(40); await T.housekeeping();
    assert.strictEqual(doc("meetups/" + id).status, "paying");
    advanceHours(30); await T.housekeeping();
    assert.strictEqual(doc("meetups/" + id).status, "completed");
    assert.strictEqual(doc("meetups/" + id + "/spots/fan3").status, "released");
    assert.strictEqual(Number(rtdb.users.star.earnings) - earn0, 180, "2 spots × $100 × 90%");
    assert.strictEqual(doc("meetups/" + id).hostDeposit.status, "onFile");
    assert.strictEqual(S.refunds.length - r0, 0, "nothing refunded: no refund fees");
    assert.strictEqual(doc("members/star").hostDeposit.held, 10000, "deposit stays on the host's account");
  });

  await test("M&G: nobody checked in → admin decides; refund buyers + keep deposit", async () => {
    seedPeople("idol", "f4"); await call("datesJoin", "idol", { birthYear: 1990 }); await call("datesJoin", "f4", { birthYear: 1990 });
    const { id } = await call("createMeetup", "idol", mgData({ price: 60, spots: 5 }));
    await completeLastCheckout("idol"); await admin({ action: "approveMeetup", id });
    await call("buyMeetupSpot", "f4", { meetupId: id }); await completeLastCheckout("f4");
    advanceHours(80); await T.housekeeping();
    assert.strictEqual(doc("meetups/" + id).status, "review");
    const r0 = S.refunds.length;
    await admin({ action: "cancelMeetup", id, reason: "Host didn't show.", data: { keepDeposit: true } });
    assert.strictEqual(S.refunds.length - r0, 0, "no card refunds");
    assert.strictEqual(doc("credits/f4").balance, 6000, "buyer gets it back as credit");
    assert.deepStrictEqual([doc("meetups/" + id).status, doc("meetups/" + id).hostDeposit.status, doc("meetups/" + id).hostDeposit.kept, doc("members/idol").hostDeposit.held], ["canceled", "kept", 6000, 0]);
    assert.strictEqual(doc("members/idol").strikes, 1);
  });

  await test("M&G: rejected → deposit back; early cancel → all refunded; share page hides the address", async () => {
    seedPeople("celeb", "f5"); await call("datesJoin", "celeb", { birthYear: 1990 }); await call("datesJoin", "f5", { birthYear: 1990 });
    const a = await call("createMeetup", "celeb", mgData({ title: "Nope" })); await completeLastCheckout("celeb");
    await admin({ action: "rejectMeetup", id: a.id, reason: "Not a public place" });
    assert.deepStrictEqual([doc("meetups/" + a.id).status, doc("meetups/" + a.id).hostDeposit.status, doc("members/celeb").hostDeposit.held], ["rejected", "onFile", 10000]);
    const n0 = S.sessions.length;
    const mk2 = await call("createMeetup", "celeb", mgData({ title: "Coffee & Q&A", price: 75, spots: 4, startsAt: Date.now() + 200 * H }));
    const id = mk2.id;
    assert.deepStrictEqual([mk2.url, S.sessions.length - n0, doc("meetups/" + id).status], [null, 0, "pending"], "deposit on file covers the next M&G: no new charge");
    await admin({ action: "approveMeetup", id });
    const html = await T.meetupOGPage(id);
    assert.ok(html.includes('og:title" content="Coffee &amp; Q&amp;A · with CELEB"'));
    assert.ok(/\$75 a spot, 4 left/.test(html) && !html.includes("123 Main St"));
    await call("buyMeetupSpot", "f5", { meetupId: id }); await completeLastCheckout("f5");
    const pv = await call("cancelMeetup", "celeb", { meetupId: id, preview: true });
    assert.ok(/stays on your account/.test(pv.lines.join(" ")));
    await call("cancelMeetup", "celeb", { meetupId: id });
    assert.deepStrictEqual([doc("meetups/" + id).status, doc("meetups/" + id).hostDeposit.status, doc("members/celeb").hostDeposit.held], ["canceled", "onFile", 10000]);
    assert.strictEqual(doc("credits/f5").balance, 7500, "buyer credited");
    // credit pays for the next spot with no checkout at all
    const other = await call("createMeetup", "celeb", mgData({ title: "Brunch", price: 50, spots: 3, startsAt: Date.now() + 200 * H }));
    await admin({ action: "approveMeetup", id: other.id });
    const n1 = S.sessions.length;
    const b = await call("buyMeetupSpot", "f5", { meetupId: other.id });
    assert.deepStrictEqual([b.done, S.sessions.length - n1, doc("credits/f5").balance, doc("meetups/" + other.id).sold], [true, 0, 2500, 1]);
    // the rest goes back to the card on request
    const r0 = S.refunds.length;
    const both = await Promise.allSettled([call("creditToCard", "f5"), call("creditToCard", "f5")]);   // a double tap
    const back = both.find(x => x.status === "fulfilled").value;
    assert.deepStrictEqual([back.sent, S.refunds.length - r0, doc("credits/f5").balance, both.filter(x => x.status === "fulfilled").length], [2500, 1, 0, 1], "refunded once, never twice");
    assert.ok(!doc("members/celeb").strikes);
  });

  await test("M&G: 1 spot = $5 deposit; birth year inline; a buyer report holds the payout", async () => {
    seedPeople("solo", "kid", "newfan", "f6");
    // no separate setup: birth year comes with the first request
    await assert.rejects(call("createMeetup", "solo", mgData({ spots: 1 })), /birth year/);
    const { id } = await call("createMeetup", "solo", mgData({ spots: 1, price: 250, birthYear: 1991 }));
    const dep = [...S.sessions].reverse().find(x => x.metadata.uid === "solo");
    assert.strictEqual(dep.line_items[0].price_data.unit_amount, 500, "1 spot → $5 deposit");
    await completeLastCheckout("solo");
    await assert.rejects(call("editMeetup", "solo", { meetupId: id, data: mgData({ spots: 4, price: 250 }) }), /needs a \$250 deposit and you have \$5 on file/);
    const two = await call("createMeetup", "solo", mgData({ spots: 2, price: 40, title: "Two" }));
    assert.strictEqual([...S.sessions].reverse().find(x => x.metadata.uid === "solo").line_items[0].price_data.unit_amount, 3500, "2+ spots → one spot's price ($40), minus the $5 already on file");
    await admin({ action: "approveMeetup", id });
    await assert.rejects(call("buyMeetupSpot", "kid", { meetupId: id, birthYear: new Date().getFullYear() - 19 }), /21 and older/);
    await call("buyMeetupSpot", "newfan", { meetupId: id, birthYear: 1995 }); await completeLastCheckout("newfan");
    assert.strictEqual(doc("meetups/" + id).sold, 1);
    const code = (await call("myMeetups", "newfan")).meetups[0].code;
    advanceHours(72); await call("checkInGuest", "solo", { code });
    advanceHours(4); await T.housekeeping();
    assert.strictEqual(doc("meetups/" + id).status, "paying");
    const mine = (await call("myMeetups", "newfan")).meetups[0];
    assert.ok(mine.canReport);
    await call("reportMeetup", "newfan", { meetupId: id, reason: "Host left after 5 minutes" });
    assert.strictEqual(doc("meetups/" + id).status, "review", "report puts the payout on hold");
    advanceHours(80); await T.housekeeping();
    assert.strictEqual(doc("meetups/" + id).status, "review", "never auto-paid after a report");
    const g = await admin({ action: "meetupGuests", id });
    assert.deepStrictEqual([g.guests.length, g.guests[0].here, g.reports[0].reason], [1, true, "Host left after 5 minutes"]);
    const e0 = Number(rtdb.users.solo.earnings || 0);
    await Promise.allSettled([admin({ action: "payMeetupHost", id }), admin({ action: "payMeetupHost", id }), T.housekeeping()]);   // two taps + the scheduled job at once
    assert.strictEqual(Math.round((Number(rtdb.users.solo.earnings) - e0) * 100), 22500, "$250 × 90%, paid once");
    assert.strictEqual(doc("meetups/" + id).status, "completed");
    await assert.rejects(call("reportMeetup", "f6", { meetupId: id }), /Only people with a spot/);
    assert.ok(two.id);
  });

  await test("M&G: official Whisper+Me M&G goes live at once; site keeps it; invites", async () => {
    seedPeople("buyer1", "pal");
    const r = await admin({ action: "postMeetup", data: mgData({ title: "Jazz Night", price: 30, spots: 20, contact: {}, startsAt: Date.now() + 10 * H }) });
    const x = doc("meetups/" + r.id);
    assert.deepStrictEqual([x.status, x.official, x.hostName, x.hostDeposit], ["live", true, "Whisper+Me", null]);
    await assert.rejects(admin({ action: "postMeetup", data: mgData({ venue: { name: "A", address: "", city: "B", phone: "618-555-0100" } }) }), /street address/);
    await call("buyMeetupSpot", "buyer1", { meetupId: r.id, birthYear: 1990 }); await completeLastCheckout("buyer1");
    await assert.rejects(admin({ action: "postMeetup", id: r.id, data: mgData({ title: "Jazz Night", price: 35, spots: 20, contact: {}, startsAt: Date.now() + 10 * H }) }), /locked/);
    await admin({ action: "postMeetup", id: r.id, data: mgData({ title: "Jazz Night Live", price: 30, spots: 25, contact: {}, startsAt: x.startsAt.toMillis() }) });
    assert.deepStrictEqual([doc("meetups/" + r.id).title, doc("meetups/" + r.id).spots], ["Jazz Night Live", 25]);
    const inv = await call("inviteToMeetup", "buyer1", { meetupId: r.id, uid: "pal" });
    assert.strictEqual(inv.message, "Invite sent");
    const rev0 = Number(rtdb.siteRevenue || 0);
    advanceHours(14); await T.housekeeping();
    assert.strictEqual(doc("meetups/" + r.id).status, "completed", "official: no check-in or payout wait needed");
    assert.strictEqual(Math.round((Number(rtdb.siteRevenue) - rev0) * 100), 3000, "site keeps the whole $30");
  });

  await test("M&G: buy for you + friends in one checkout; one code checks in the group; card fees come out of the site's share", async () => {
    seedPeople("crew", "host9");
    const r = await admin({ action: "postMeetup", data: mgData({ title: "Group night", price: 20, spots: 4, contact: {}, startsAt: Date.now() + 30 * H }) });
    await assert.rejects(call("buyMeetupSpot", "crew", { meetupId: r.id, qty: 5, birthYear: 1990 }), /Only 4 spots left/);
    await call("buyMeetupSpot", "crew", { meetupId: r.id, qty: 3, birthYear: 1990 });
    const sess = [...S.sessions].reverse().find(x => x.metadata.uid === "crew");
    assert.deepStrictEqual([sess.line_items[0].quantity, sess.line_items[0].price_data.unit_amount], [3, 2000]);
    assert.strictEqual(doc("meetups/" + r.id).held, 3);
    await call("buyMeetupSpot", "crew", { meetupId: r.id, qty: 2 }); // changed their mind before paying
    assert.strictEqual(doc("meetups/" + r.id).held, 2, "the earlier hold is replaced, not added");
    await completeLastCheckout("crew");
    const m = doc("meetups/" + r.id);
    assert.deepStrictEqual([m.sold, m.held, m.stripeFees], [2, 0, Math.round(4000 * 0.029) + 30]);
    const t = (await call("myMeetups", "crew")).meetups.find(x => x.id === r.id && !x.host);
    assert.strictEqual(t.qty, 2);
    advanceHours(30); const ci = await call("checkInGuest", "v6aIXY12MDY9ci1wWJmCiLOAKoG2", { code: t.code });
    assert.deepStrictEqual([ci.guest, doc("meetups/" + r.id).checkedIn], ["CREW +1", 2]);
    advanceHours(4); await T.housekeeping();
    const done = doc("meetups/" + r.id);
    assert.deepStrictEqual([done.status, done.siteFee, done.siteNet], ["completed", 4000, 4000 - 146]);
  });

  await test("Payouts: Stripe transfer to the earner, taken out of earnings, never twice; legacy and unfinished accounts are skipped", async () => {
    rtdb.users = rtdb.users || {};
    rtdb.users.payA = { name: "A", earnings: 72.5, stripeAccountId: "acct_A" };
    rtdb.users.payB = { name: "B", earnings: 60, stripeAccountId: "acct_unfinished" };
    rtdb.users.payC = { name: "C", earnings: 90, stripeAccountId: "acct_C", lastPaidOut: 1, lastPaidAmount: 40 };
    rtdb.users.payD = { name: "D", earnings: 20, stripeAccountId: "acct_D" };
    const r = await admin({ action: "payCreator", id: "payA" });
    assert.ok(/\$72\.50/.test(r.message));
    assert.deepStrictEqual([rtdb.users.payA.earnings, rtdb.users.payA.paidOut, S.transfers.at(-1).amount, S.transfers.at(-1).destination], [0, 72.5, 7250, "acct_A"]);
    await assert.rejects(admin({ action: "payCreator", id: "payA" }), /Nothing to pay/);
    await assert.rejects(admin({ action: "payCreator", id: "payB" }), /isn't finished/);
    S.failTransfer = true;
    await assert.rejects(admin({ action: "payCreator", id: "payD" }), /about 2 days/);
    assert.strictEqual(rtdb.users.payD.earnings, 20, "money put back when the transfer fails");
    S.failTransfer = false;
    rtdb.users.payA.earnings = 55;
    const all = await admin({ action: "payAllCreators" });
    assert.strictEqual(all.paid, 1, "only A: B unfinished, C legacy, D under $50");
    assert.ok(all.skipped.some(x => /marked paid before/.test(x)) && all.skipped.some(x => /isn't finished/.test(x)));
    await admin({ action: "markCreatorPaid", id: "payC", data: { amount: 40 } });
    assert.deepStrictEqual([rtdb.users.payC.earnings, rtdb.users.payC.paidOut], [50, 40]);
    await admin({ action: "setAutoPayouts", data: { on: true } });
    assert.strictEqual(doc("settings/platform").autoPayouts, true);
  });

  await test("Connect Me: buy a package, invite by link, both check in at the venue, site keeps it; stood up → coin; canceled → credit", async () => {
    seedPeople("romeo", "juliet", "kid2", "nosy", "solo2");
    const venue = { name: "Ember & Oak", address: "200 E Main St", city: "Belleville, IL", phone: "618-555-0100", source: "osm", lat: 38.5134, lon: -89.9840 };
    const deal = await admin({ action: "postConnect", data: { title: "Dinner for 2", about: "3 courses", category: "Dinner", items: ["Dinner", "Dessert"], venue, startsAt: Date.now() + 48 * H, price: 80, size: 2, quantity: 3 } });
    assert.strictEqual(doc("connects/" + deal.id).status, "live");
    assert.ok(!JSON.stringify(doc("connects/" + deal.id)).includes("200 E Main"), "address not public");
    const b = await call("buyConnect", "romeo", { dealId: deal.id, birthYear: 1990 });
    assert.ok(b.url && !b.done);
    await completeLastCheckout("romeo");
    const o = doc("connectOrders/" + b.orderId);
    assert.deepStrictEqual([o.status, o.seats.length, o.seats[0].status, /^CM-/.test(o.seats[0].code), o.seats[1].status, doc("connects/" + deal.id).sold], ["paid", 2, "accepted", true, "open", 1]);
    const mine = (await call("myConnects", "romeo")).connects[0];
    assert.ok(mine.buyer && mine.address === "200 E Main St" && /\?connect=/.test(mine.seats[1].link));
    const token = mine.seats[1].link.split("connect=")[1];
    const info = await F.connectInvite.run({ data: { token }, auth: null, rawRequest: {} });
    assert.deepStrictEqual([info.title, info.from, info.taken], ["Dinner for 2", "ROMEO", false]);
    await assert.rejects(call("acceptConnect", "romeo", { token }), /your own package/);
    await assert.rejects(call("acceptConnect", "kid2", { token, birthYear: new Date().getFullYear() - 19 }), /21 and older/);
    const acc = await call("acceptConnect", "juliet", { token, birthYear: 1993 });
    assert.ok(/^CM-/.test(acc.code));
    await assert.rejects(call("acceptConnect", "nosy", { token, birthYear: 1990 }), /already accepted/);
    const jv = (await call("myConnects", "juliet")).connects[0];
    assert.deepStrictEqual([jv.buyer, jv.address, jv.code], [false, "200 E Main St", acc.code]);
    // check-in
    await assert.rejects(call("connectHere", "romeo", { orderId: b.orderId, lat: 38.5134, lng: -89.984 }), /opens an hour before/);
    advanceHours(48);
    await assert.rejects(call("connectHere", "romeo", { orderId: b.orderId, lat: 38.627, lng: -90.199 }), /don't seem to be at Ember & Oak/);
    const h1 = await call("connectHere", "romeo", { orderId: b.orderId, lat: 38.5136, lng: -89.9843 });
    assert.strictEqual(h1.allHere, false);
    const ci = await admin({ action: "connectCheckIn", data: { code: acc.code } });
    assert.deepStrictEqual([ci.guest, ci.allHere], ["JULIET", true], "venue gave the code, admin checked her in");
    const rev0 = Number(rtdb.siteRevenue || 0), coins0 = rtdb.users.romeo.coins || 0;
    advanceHours(4); await T.housekeeping();
    assert.deepStrictEqual([doc("connects/" + deal.id).status, doc("connectOrders/" + b.orderId).status], ["completed", "completed"]);
    assert.strictEqual(Math.round((Number(rtdb.siteRevenue) - rev0) * 100), 8000, "the site keeps the package price");
    assert.strictEqual(rtdb.users.romeo.coins || 0, coins0, "nobody stood up");
    // stood up: only the buyer showed
    const d2 = await admin({ action: "postConnect", data: { title: "Bowling for 2", category: "Activities", items: ["2 games"], venue, startsAt: Date.now() + 30 * H, price: 40, size: 2, quantity: 2 } });
    const b2 = await call("buyConnect", "solo2", { dealId: d2.id, birthYear: 1990 }); await completeLastCheckout("solo2");
    const t2 = (await call("myConnects", "solo2")).connects.find(x => x.id === b2.orderId).seats[1].link.split("connect=")[1];
    await call("acceptConnect", "nosy", { token: t2 });
    advanceHours(30); await call("connectHere", "solo2", { orderId: b2.orderId, lat: 38.5134, lng: -89.984 });
    advanceHours(4); await T.housekeeping();
    assert.strictEqual(rtdb.users.solo2.coins, 1, "stood up → 1 coin");
    assert.deepStrictEqual(doc("connectOrders/" + b2.orderId).noShows, ["nosy"]);
    // canceled by admin → buyer credit, no card refund; a fresh link for a guest who can't make it
    const d3 = await admin({ action: "postConnect", data: { title: "Movie for 2", category: "Movies", items: ["2 tickets"], venue, startsAt: Date.now() + 60 * H, price: 30, size: 2, quantity: 2 } });
    const b3 = await call("buyConnect", "romeo", { dealId: d3.id }); await completeLastCheckout("romeo");
    const inv = await call("inviteToConnect", "romeo", { orderId: b3.orderId, seat: 1, uid: "juliet" });
    assert.ok((await call("myConnects", "juliet")).connects.some(x => x.invite && x.id === b3.orderId), "on-site invite shows for her");
    await assert.rejects(call("acceptConnect", "nosy", { token: inv.link.split("connect=")[1], birthYear: 1990 }), /sent to someone else/);
    const nl = await call("newConnectLink", "romeo", { orderId: b3.orderId, seat: 1 });
    assert.ok(nl.link !== inv.link);
    const r0 = S.refunds.length;
    await admin({ action: "cancelConnect", id: d3.id, reason: "Theater closed." });
    assert.deepStrictEqual([doc("connectOrders/" + b3.orderId).status, S.refunds.length - r0, doc("credits/romeo").balance], ["canceled", 0, 3000]);
    // and credit buys the next package outright
    const d4 = await admin({ action: "postConnect", data: { title: "Coffee for 2", category: "Other", items: ["2 coffees"], venue, startsAt: Date.now() + 60 * H, price: 20, size: 2, quantity: 2 } });
    const n0 = S.sessions.length;
    const b4 = await call("buyConnect", "romeo", { dealId: d4.id });
    assert.deepStrictEqual([b4.done, S.sessions.length - n0, doc("credits/romeo").balance, doc("connectOrders/" + b4.orderId).seats.length], [true, 0, 1000, 2]);
  });

  await test("Emails: ticket receipt with code + calendar invite, host notices, one day-before reminder, payout, credit", async () => {
    const M = T.sentMail; M.length = 0;
    seedPeople("mia", "hoste", "zed"); rtdb.users.mia.email = "mia@x.com"; rtdb.users.hoste.email = "host@x.com"; rtdb.users.zed.email = "zed@x.com";
    await call("datesJoin", "hoste", { birthYear: 1990 });
    const mg = await call("createMeetup", "hoste", mgData({ title: "Wings night", price: 25, spots: 4, startsAt: Date.now() + 50 * H }));
    await completeLastCheckout("hoste");
    assert.ok(M.some(m => m.to === "host@x.com" && /Deposit received/.test(m.subject)), "deposit receipt");
    await admin({ action: "approveMeetup", id: mg.id });
    assert.ok(M.some(m => m.to === "host@x.com" && /You're live/.test(m.subject) && m.parts.button[1].endsWith("/m/" + mg.id)), "live + share link");
    await call("buyMeetupSpot", "mia", { meetupId: mg.id, qty: 2, birthYear: 1992 }); await completeLastCheckout("mia");
    const rc = M.find(m => m.to === "mia@x.com" && /You're in/.test(m.subject));
    assert.ok(rc && /^MG-/.test(rc.parts.code) && rc.parts.cal && /BEGIN:VCALENDAR/.test(rc.parts.cal.ics), "receipt has the code and a calendar invite");
    assert.ok(rc.parts.rows.some(r => r[0] === "Where" && /123 Main St/.test(r[1])), "receipt has the private address");
    assert.ok(M.some(m => m.to === "host@x.com" && /2 spots sold/.test(m.subject)), "host told");
    const html = T.emailHTML({ heading: "<b>x</b>", rows: [["a", "<script>"]] });
    assert.ok(!html.includes("<script>") && html.includes("&lt;b&gt;"), "email is escaped");
    // reminders: not yet (50h away), then once inside 24h, never twice
    await T.housekeeping(); assert.ok(!M.some(m => /Tomorrow/.test(m.subject)));
    advanceHours(30); await T.housekeeping(); await T.housekeeping();
    assert.strictEqual(M.filter(m => m.to === "mia@x.com" && /Tomorrow: Wings night/.test(m.subject)).length, 1, "one reminder");
    assert.ok(M.some(m => m.to === "host@x.com" && /hosting Wings night/.test(m.subject)), "host checklist");
    // canceled → credit email
    await admin({ action: "cancelMeetup", id: mg.id, reason: "Venue closed." });
    assert.ok(M.some(m => m.to === "mia@x.com" && /credit added/.test(m.subject)), "credit email");
    // payout email
    rtdb.users.zed.earnings = 64; rtdb.users.zed.stripeAccountId = "acct_Z";
    await admin({ action: "payCreator", id: "zed" });
    assert.ok(M.some(m => m.to === "zed@x.com" && /You got paid \$64/.test(m.subject)));
    // nobody without an email address gets anything (and nothing breaks)
    assert.ok(M.every(m => /@/.test(m.to)));
  });

  await test("21+ ID check and ratings: confirm ID to buy, host sees ID reminder at check-in; rate host and venue once; admin can remove", async () => {
    seedPeople("barhost", "bev", "cole", "dana");
    await call("datesJoin", "barhost", { birthYear: 1985 });
    const mg = await call("createMeetup", "barhost", mgData({ title: "Bar crawl", price: 15, spots: 5, idCheck: true, startsAt: Date.now() + 30 * H }));
    await completeLastCheckout("barhost"); await admin({ action: "approveMeetup", id: mg.id });
    assert.strictEqual(doc("meetups/" + mg.id).idCheck, true);
    await assert.rejects(call("buyMeetupSpot", "bev", { meetupId: mg.id, birthYear: 1995 }), /21\+ with ID/);
    await call("buyMeetupSpot", "bev", { meetupId: mg.id, birthYear: 1995, idOk: true }); await completeLastCheckout("bev");
    assert.ok(doc(`meetups/${mg.id}/spots/bev`).idOkAt, "agreement recorded");
    const t = (await call("myMeetups", "bev")).meetups.find(x => x.id === mg.id && !x.host);
    assert.ok(t.idCheck && !t.canRate, "can't rate before it happens");
    await assert.rejects(call("rateEvent", "bev", { kind: "mg", id: mg.id, stars: 5 }), /end of the night/);
    advanceHours(30);
    const ci = await call("checkInGuest", "barhost", { code: t.code });
    assert.strictEqual(ci.idCheck, true, "host is reminded to check ID");
    advanceHours(2);
    await call("rateEvent", "bev", { kind: "mg", id: mg.id, stars: 4, text: "Fun night" });
    await call("rateEvent", "bev", { kind: "mg", id: mg.id, stars: 5, text: "Changed my mind, great" }); // re-rating replaces
    assert.deepStrictEqual([rtdb.users.barhost.rating.n, rtdb.users.barhost.rating.avg], [1, 5]);
    assert.deepStrictEqual(doc("meetups/" + mg.id).rating, { sum: 5, n: 1 });
    assert.strictEqual((await call("myMeetups", "bev")).meetups.find(x => x.id === mg.id && !x.host).myStars, 5);
    await assert.rejects(call("rateEvent", "cole", { kind: "mg", id: mg.id, stars: 1 }), /had a spot/);
    await assert.rejects(call("rateEvent", "barhost", { kind: "mg", id: mg.id, stars: 5 }), /had a spot/, "hosts can't rate themselves");
    // Connect Me: 21+ package, the invitee confirms ID too, both rate the place
    const venue = { name: "Hop House", address: "9 Oak St", city: "Edwardsville, IL", phone: "618-555-0111", source: "other" };
    const deal = await admin({ action: "postConnect", data: { title: "Beer flight for 2", category: "Other", items: ["Flights"], venue, startsAt: Date.now() + 26 * H, price: 30, size: 2, quantity: 3, idCheck: true } });
    await assert.rejects(call("buyConnect", "cole", { dealId: deal.id, birthYear: 1990 }), /photo ID/);
    const b = await call("buyConnect", "cole", { dealId: deal.id, birthYear: 1990, idOk: true }); await completeLastCheckout("cole");
    const tok = (await call("myConnects", "cole")).connects.find(x => x.id === b.orderId).seats[1].link.split("connect=")[1];
    assert.strictEqual((await F.connectInvite.run({ data: { token: tok }, auth: null, rawRequest: {} })).idCheck, true);
    await assert.rejects(call("acceptConnect", "dana", { token: tok, birthYear: 1994 }), /photo ID/);
    await call("acceptConnect", "dana", { token: tok, birthYear: 1994, idOk: true });
    advanceHours(28);
    await call("rateEvent", "cole", { kind: "cm", id: b.orderId, stars: 5 });
    await call("rateEvent", "dana", { kind: "cm", id: b.orderId, stars: 2, text: "Slow service" });
    const vk = doc("ratings/cm_" + b.orderId + "_dana").venueKey;
    assert.deepStrictEqual([doc("connectVenues/" + vk).n, doc("connectVenues/" + vk).sum], [2, 7]);
    const d2 = await admin({ action: "postConnect", data: { title: "Trivia for 2", category: "Other", items: ["Trivia"], venue, startsAt: Date.now() + 50 * H, price: 20, size: 2, quantity: 2 } });
    assert.deepStrictEqual(doc("connects/" + d2.id).venueRating, { avg: 3.5, n: 2 }, "new packages at the place show its rating");
    const list = await admin({ action: "ratings" });
    assert.ok(list.ratings.some(r => r.text === "Slow service") && list.venues.some(v => v.name === "Hop House" && v.avg === 3.5));
    const rep = await admin({ action: "salesReport", data: { since: Date.now() - 30 * 86400000 } });
    assert.ok(rep.mg.some(x => x.title === "Bar crawl" && x.amount === 1500 && x.site === 150 && x.hostName === "BARHOST"), "M&G sale with the site's 10%");
    assert.ok(rep.cm.some(x => x.title === "Beer flight for 2" && x.amount === 3000));
    await admin({ action: "removeRating", id: "cm_" + b.orderId + "_dana" });
    assert.deepStrictEqual(doc("connects/" + d2.id).venueRating, { avg: 5, n: 1 });
    await admin({ action: "removeRating", id: "mg_" + mg.id + "_bev" });
    assert.ok(!rtdb.users.barhost.rating, "host back to no rating");
  });

  await test("Call alerts: ring every device, never re-ring a repeated or ended call, decline from the lock screen, missed call once, test ring", async () => {
    const pushes = require("firebase-admin").__pushes;
    const fa = require("firebase-admin");
    rtdb.fcmTokens = { bob: { token: "tok-laptop", devices: { phone: { token: "tok-phone" }, old: { token: "tok-dead" } } } };
    const realSend = fa.messaging().send;
    // a token the browser has thrown away
    const msgMod = fa.messaging;
    fa.messaging = () => ({ send: async m => { fa.__checkFcm(m); if (m.token === "tok-dead") { const e = new Error("Requested entity was not found."); e.code = "messaging/registration-token-not-registered"; throw e; } pushes.push(m); return "ok"; } });
    rtdb.calls = { c1: { from: "amy", to: "bob", callerName: "Amy", status: "ringing", createdAt: Date.now() } };
    const p0 = pushes.length;
    assert.strictEqual(await T.ringOnce("c1", 0), 2, "first ring goes to both live devices");
    assert.strictEqual(await T.ringOnce("c1", 0), 0, "the same event delivered again never rings twice");
    const ra = await call("ringAgain", "amy", { callId: "c1", n: 1 });
    assert.strictEqual(ra.sent, 2, "the caller's app asks for the next ring");
    await assert.rejects(call("ringAgain", "eve", { callId: "c1", n: 2 }), /Not your call/);
    const sent = pushes.slice(p0);
    assert.deepStrictEqual([...new Set(sent.map(m => m.token))].sort(), ["tok-laptop", "tok-phone"], "both live devices ring");
    assert.ok(sent.every(m => !m.notification && m.data.type === "incoming_call" && m.webpush.headers.Urgency === "high"), "data-only, high priority");
    assert.ok(sent.every(m => Number(m.data.exp) > Date.now() && m.data.dk), "alerts expire and carry a decline key");
    assert.ok(sent.every(m => m.data.callerName === "Amy" && m.data.callerUid === "amy" && /Amy is calling/.test(m.data.title)), "the alert says who's calling");
    assert.ok(!rtdb.fcmTokens.bob.devices.old, "dead device forgotten");
    // hung up: no more rings, ever (this was the "keeps dinging" bug)
    rtdb.calls.c1.status = "ended";
    assert.strictEqual(await T.ringOnce("c1", 2), 0);
    assert.strictEqual((await call("ringAgain", "amy", { callId: "c1", n: 3 })).sent, 0);
    // too old to ring
    rtdb.calls.cold = { from: "amy", to: "bob", status: "ringing", createdAt: Date.now() - 120000 };
    assert.strictEqual(await T.ringOnce("cold", 0), 0, "a stuck old call never rings");
    // Decline on the lock screen with the site closed
    rtdb.calls.c5 = { from: "amy", to: "bob", callerName: "Amy", status: "ringing", createdAt: Date.now() };
    await T.ringOnce("c5", 0);
    const dk = pushes.at(-1).data.dk;
    const resp = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, set() { return r; }, send(b) { r.body = b; return r; }, setHeader() {}, getHeader() {}, end() {}, on() {}, once() {}, emit() {}, statusCode: 200 }; return r; };
    let r1 = resp(); await F.declineCall({ method: "POST", body: { c: "c5", k: "wrong" }, query: {}, headers: {}, get: () => "" }, r1);
    assert.strictEqual(r1.code, 403, "wrong key can't end someone's call");
    r1 = resp(); await F.declineCall({ method: "POST", body: { c: "c5", k: dk }, query: {}, headers: {}, get: () => "" }, r1);
    assert.deepStrictEqual([r1.body && r1.body.declined, rtdb.calls.c5.status, rtdb.calls.c5.endedBy], [true, "ended", "bob"]);
    const p1 = pushes.length;
    rtdb.calls.c2 = { from: "amy", to: "bob", callerName: "Amy", status: "ended", createdAt: Date.now() };
    const missed = await T.stopRingFlow("c2", "ringing", "ended", rtdb.calls.c2);
    assert.strictEqual(missed, true);
    assert.strictEqual(await T.stopRingFlow("c2", "ringing", "ended", rtdb.calls.c2), null, "a repeated event doesn't send a second missed alert");
    const end = pushes.slice(p1).find(m => m.data.type === "call_ended");
    assert.deepStrictEqual([end.data.callId, end.data.missed], ["c2", "1"]);
    // voice pass: only the two people on the call, and it runs out after 3 minutes
    process.env.AGORA_APP_CERTIFICATE = "0123456789abcdef0123456789abcdef";
    rtdb.calls.cv = { from: "amy", to: "bob", status: "connecting", answeredAt: Date.now(), createdAt: Date.now() };
    const tk = await call("callToken", "bob", { callId: "cv" });
    assert.ok(tk.token && tk.endsAt - Date.now() <= 226000 && tk.endsAt - Date.now() > 220000, "expires 3 min + 45 s after answering");
    await assert.rejects(call("callToken", "eve", { callId: "cv" }), /isn't your call/);
    rtdb.calls.cv.answeredAt = Date.now() - 300000;
    await assert.rejects(call("callToken", "amy", { callId: "cv" }), /has ended/);
    rtdb.calls.cr = { from: "amy", to: "bob", status: "ringing", createdAt: Date.now() };
    await assert.rejects(call("callToken", "amy", { callId: "cr" }), /isn't connected/);
    rtdb.blocks = { bob: { amy: true } };
    rtdb.calls.cb = { from: "amy", to: "bob", status: "ringing", createdAt: Date.now() };
    assert.strictEqual(await T.ringOnce("cb", 0), 0, "a blocked caller never rings");
    delete rtdb.blocks;
    rtdb.calls.c3 = { from: "amy", to: "bob", callerName: "Amy", status: "ended", endedBy: "bob" };
    assert.strictEqual(await T.stopRingFlow("c3", "ringing", "ended", rtdb.calls.c3), false, "declined isn't missed");
    assert.strictEqual(await T.stopRingFlow("c4", "ringing", "connecting", { to: "bob", answeredAt: 1 }), false, "answered: just take the alert down");
    const t = await call("testRing", "bob", { delay: 0 });
    assert.strictEqual(t.devices, 2);
    await assert.rejects(call("testRing", "nobody", { delay: 0 }), /aren't on for this device/);
    fa.messaging = msgMod;
    // a shared phone: Amy used it, then Bob logs in on it → only Bob's calls ring it
    rtdb.fcmTokens = { amy: { token: "tok-shared", devices: { shared: { token: "tok-shared" }, laptop: { token: "tok-amy" } } } };
    assert.strictEqual(await T.claimDevice("amy", "shared", { token: "tok-shared" }), null);
    rtdb.fcmTokens.bob = { token: "tok-shared", devices: { shared: { token: "tok-shared" } } };
    assert.strictEqual(await T.claimDevice("bob", "shared", { token: "tok-shared" }), "amy");
    assert.ok(!rtdb.fcmTokens.amy.devices.shared && !rtdb.fcmTokens.amy.token, "taken off Amy");
    assert.ok(rtdb.fcmTokens.amy.devices.laptop, "Amy's own laptop still rings");
    assert.strictEqual(rtdb.fcmOwners.shared, "bob");
    await T.claimDevice("bob", "shared", null); // Bob logs out
    assert.ok(!rtdb.fcmOwners || !rtdb.fcmOwners.shared);
  });

  await test("Chargebacks: account frozen, unspent coins taken back, creators' unpaid share reversed, M&G payout held; ban really locks out", async () => {
    seedPeople("cheat", "cre1", "cre2", "mgbuyer");
    // a coin purchase made through the main site's checkout
    S.paid.pi_coins = { id: "cs_coins", metadata: { uid: "cheat", qty: "10", product: "coins" } };
    rtdb.users.cheat.coins = 4; // bought 10, spent 6 on calls
    rtdb.users.cre1.earnings = 8; rtdb.users.cre2.earnings = 1;
    rtdb.callLedger = Object.assign(rtdb.callLedger || {}, {
      l1: { from: "cheat", to: "cre1", price: 3, earnedUsd: 6, charged: true, ts: 1 },
      l2: { from: "cheat", to: "cre2", price: 3, earnedUsd: 6, charged: true, ts: 2 },
      l3: { from: "someone", to: "cre1", price: 1, earnedUsd: 2, charged: true, ts: 3 } });
    const M = T.sentMail; M.length = 0;
    const dispute = { id: "dp_1", payment_intent: "pi_coins", amount: 3000, reason: "fraudulent", status: "needs_response", evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86400 } };
    await T.handleStripeEvent({ type: "charge.dispute.created", data: { object: dispute } });
    await T.handleStripeEvent({ type: "charge.dispute.created", data: { object: dispute } }); // repeat webhook: nothing twice
    const fa = require("firebase-admin");
    assert.deepStrictEqual([rtdb.users.cheat.banned, fa.__auth.cheat.disabled, fa.__auth.cheat.revoked], [true, true, true], "frozen and signed out");
    assert.strictEqual(rtdb.users.cheat.coins, 0, "4 unspent coins taken back");
    assert.deepStrictEqual([rtdb.users.cre2.earnings, rtdb.users.cre1.earnings], [0, 2], "6 spent coins: newest call first, only from unpaid earnings");
    assert.ok(rtdb.callLedger.l2.reversed && rtdb.callLedger.l1.reversed && !rtdb.callLedger.l3.reversed);
    const dp = doc("disputes/dp_1");
    assert.ok(dp.actions.some(a => /Took back 4/.test(a)) && dp.coins.spentNotRecovered === 0, JSON.stringify(dp.actions));
    assert.ok(M.some(m => /Chargeback: \$30/.test(m.subject)), "admin emailed");
    // an M&G spot disputed: payout held
    const r = await admin({ action: "postMeetup", data: mgData({ title: "Dispute night", price: 20, spots: 3, contact: {}, startsAt: Date.now() + 30 * H }) });
    await call("buyMeetupSpot", "mgbuyer", { meetupId: r.id, birthYear: 1990 });
    const pi = await completeLastCheckout("mgbuyer");
    await T.handleStripeEvent({ type: "charge.dispute.created", data: { object: { id: "dp_2", payment_intent: pi, amount: 2000, reason: "product_not_received", status: "needs_response" } } });
    assert.ok(doc("meetups/" + r.id).reported && doc(`meetups/${r.id}/spots/mgbuyer`).disputed, "host payout on hold");
    const list = await admin({ action: "disputes" });
    assert.ok(list.disputes.some(x => x.id === "dp_1" && x.name === "CHEAT"));
    await T.handleStripeEvent({ type: "charge.dispute.closed", data: { object: { ...dispute, status: "won" } } });
    assert.strictEqual(doc("disputes/dp_1").status, "won");
    await admin({ action: "unfreeze", id: "cheat" });
    assert.deepStrictEqual([rtdb.users.cheat.banned, fa.__auth.cheat.disabled], [false, false]);
  });

  await test("Back from Stripe: the app double-checks the payment, so a slow or missing webhook never loses a ticket", async () => {
    seedPeople("lateguy");
    const r = await admin({ action: "postMeetup", data: mgData({ title: "Webhook-proof night", price: 15, spots: 5, contact: {}, startsAt: Date.now() + 30 * H }) });
    await call("buyMeetupSpot", "lateguy", { meetupId: r.id, birthYear: 1990, src: { s: "instagram", m: "paid<script>", c: "launch" } });
    const sess = [...S.sessions].reverse().find(x => x.metadata.uid === "lateguy");
    assert.ok(/sid=\{CHECKOUT_SESSION_ID\}/.test(sess.success_url), "Stripe sends the session id back");
    assert.deepStrictEqual(await call("confirmCheckout", "lateguy", { sid: sess.id }), { done: false, kind: "meetup" }, "not paid yet: nothing happens");
    S.intents.pi_late = { id: "pi_late", status: "succeeded" };
    S.done[sess.id] = { id: sess.id, status: "complete", payment_status: "paid", metadata: sess.metadata, payment_intent: "pi_late", amount_total: 1500 };
    await assert.rejects(call("confirmCheckout", "someoneelse", { sid: sess.id }), /isn't your checkout/);
    const c1 = await call("confirmCheckout", "lateguy", { sid: sess.id });
    assert.strictEqual(c1.done, true);
    assert.ok(/^MG-/.test(doc(`meetups/${r.id}/spots/lateguy`).code), "ticket issued without the webhook");
    // the webhook arrives later: still one spot
    await T.handleStripeEvent({ type: "checkout.session.completed", data: { object: S.done[sess.id] } });
    await call("confirmCheckout", "lateguy", { sid: sess.id });
    assert.deepStrictEqual([doc("meetups/" + r.id).sold, doc("meetups/" + r.id).held], [1, 0], "counted once");
    assert.deepStrictEqual(doc(`meetups/${r.id}/spots/lateguy`).src, { s: "instagram", m: "paidscript", c: "launch", ct: "" }, "the ad that brought the sale is kept (cleaned)");
    const rep = await admin({ action: "salesReport", data: { since: Date.now() - 86400000 } });
    assert.ok(rep.mg.some(x => x.title === "Webhook-proof night" && x.src && x.src.s === "instagram"));
  });

  await test("Take me out: someone asks to be taken, a buyer pays, the asker gets the spot and can accept or decline; /connect lists date ideas", async () => {
    seedPeople("asker", "treater", "rando");
    rtdb.users.asker.email = "asker@x.com";
    rtdb.fcmTokens = Object.assign(rtdb.fcmTokens || {}, { asker: { token: "tok-asker" } });
    const venue = { name: "Pinz", address: "1 Lane St", city: "St. Louis, MO", phone: "314-555-0101", source: "other" };
    const d = await admin({ action: "postConnect", data: { title: "Bowling for 2", category: "Activities", items: ["2 games", "Shoes"], venue, startsAt: Date.now() + 40 * H, price: 50, size: 2, quantity: 4 } });
    // the shared page says who's asking
    const page = await T.share.connectPage(d.id, "", "asker");
    assert.ok(page.includes("ASKER wants to go") && page.includes("Take ASKER out · $50") && page.includes(`deal=${d.id}&amp;ask=asker`), "asker version of the page");
    assert.ok(page.includes("card.png?v=") && page.includes("&amp;ask=asker"), "preview picture shows the asker too");
    const list = await T.share.connectListPage("", "asker");
    assert.ok(list.includes("ASKER wants a night out") && list.includes("Bowling for 2"), "/connect?ask= lists packages to take them to");
    assert.ok((await T.share.connectListPage("", "")).includes("No date ideas?"));
    // can't ask yourself; unknown askers are ignored
    const self = await call("buyConnect", "asker", { dealId: d.id, birthYear: 1992, askUid: "asker" });
    await completeLastCheckout("asker");
    assert.strictEqual(doc("connectOrders/" + self.orderId).askedBy, null);
    // a treater takes them out
    const M = T.sentMail; M.length = 0;
    const p0 = require("firebase-admin").__pushes.length;
    const b = await call("buyConnect", "treater", { dealId: d.id, birthYear: 1990, askUid: "asker" });
    await completeLastCheckout("treater");
    const o = doc("connectOrders/" + b.orderId);
    assert.deepStrictEqual([o.askedBy, o.seats[1].status, o.seats[1].invitedUid, o.invitedUids], ["asker", "invited", "asker", ["asker"]]);
    const pushes = require("firebase-admin").__pushes.slice(p0);
    assert.ok(pushes.some(m => /TREATER is taking you out/.test(JSON.stringify(m))), "asker gets a push");
    assert.ok(M.some(m => m.to === "asker@x.com" && /taking you out/.test(m.subject)), "asker emailed");
    const tok = o.seats[1].token;
    const info = await call("connectInvite", "asker", { token: tok });
    assert.deepStrictEqual([info.forYou, info.askedBy], [true, true]);
    await assert.rejects(call("declineConnect", "rando", { token: tok }), /nothing to decline/);
    await call("declineConnect", "asker", { token: tok });
    const o2 = doc("connectOrders/" + b.orderId);
    assert.deepStrictEqual([o2.seats[1].status, o2.seats[1].invitedUid, o2.invitedUids], ["open", null, []], "spot opens back up for the buyer");
    // the open link still works for whoever the buyer sends it to
    const acc = await call("acceptConnect", "rando", { token: tok, birthYear: 1991 });
    assert.ok(/^CM-/.test(acc.code));
  });

  await test("Share pages: profile and M&G links show a picture drawn like the app and real buttons", async () => {
    rtdb.users.sharey = { name: "Sharey <b>", bio: "Hi there", price: 2, calls: 3, rating: { avg: 4.5, n: 2 }, instagram: "sharey" };
    const html = await T.share.profilePage("sharey");
    assert.ok(html.includes('og:image" content="https://whisperplusme.com/s/u/sharey/card.png?v='), "link preview uses the app-style picture");
    assert.ok(html.includes('twitter:card" content="summary_large_image"'));
    assert.ok(html.includes("📞 Call Sharey &lt;b&gt; · $6") && html.includes("/?openProfile=sharey") && html.includes("instagram.com/sharey"), "real buttons");
    assert.ok(!html.includes("<b>\"") && !html.includes("Sharey <b>"), "name is escaped");
    assert.ok((await T.share.profilePage("nobody")).includes("isn't available"));
  });

  await test("Search engines: live M&Gs and Connect Me nights are events in the sitemap; real profiles findable, personal links stay out", async () => {
    const venue = { name: "Pinz", address: "1 Lane St", city: "St. Louis, MO", phone: "314-555-0101", source: "other" };
    const mg = await admin({ action: "postMeetup", data: mgData({ title: "Search Night", price: 25, spots: 10, contact: {}, startsAt: Date.now() + 30 * H }) });
    const deal = await admin({ action: "postConnect", data: { title: "Searchable dinner", category: "Dinner", items: ["Dinner"], venue, startsAt: Date.now() + 50 * H, price: 60, size: 2, quantity: 2 } });
    const ldOf = html => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    const mp = await T.share.meetupPage(mg.id);
    assert.ok(mp.includes('name="robots" content="index, follow'), "live M&G can be found in search");
    const ev = ldOf(mp);
    assert.deepStrictEqual([ev["@type"], ev.name, ev.offers.price, ev.offers.priceCurrency, ev.location["@type"], ev.eventAttendanceMode],
      ["Event", "Search Night", "25.00", "USD", "Place", "https://schema.org/OfflineEventAttendanceMode"]);
    assert.ok(ev.startDate && ev.location.address.addressLocality, "has a date and a city");
    assert.ok(!JSON.stringify(ev).includes("1 Lane St") && !JSON.stringify(ev).includes("555-"), "private address and phone never published");
    const cp = await T.share.connectPage(deal.id, "", "");
    assert.ok(cp.includes('content="index, follow') && ldOf(cp).offers.price === "60.00");
    seedPeople("seeker");
    const ask = await T.share.connectPage(deal.id, "", "seeker");
    assert.ok(ask.includes('content="noindex, follow"') && ask.includes(`<link rel="canonical" href="https://whisperplusme.com/c/${deal.id}">`), "take-me-out links stay out of search");
    assert.ok((await T.share.profilePage("seeker")).includes('content="noindex, follow"'), "a bare profile (no photo, no bio) stays out of search");
    rtdb.users.seeker.bio = "Late-night talks"; rtdb.users.seeker.instagram = "seekr";
    const prof = await T.share.profilePage("seeker");
    assert.ok(prof.includes('content="index, follow') && ldOf(prof)["@type"] === "ProfilePage" && ldOf(prof).mainEntity.sameAs[0] === "https://instagram.com/seekr", "real profiles can be found");
    rtdb.users.seeker.banned = true;
    assert.ok((await T.share.profilePage("seeker")).includes("isn't available"), "banned members' pages are gone");
    delete rtdb.users.seeker.banned;
    assert.ok((await T.share.connectListPage("", "")).includes('"@type":"ItemList"'));
    const sm = await T.buildSitemap();
    assert.ok(sm.startsWith('<?xml') && sm.includes("<loc>https://whisperplusme.com/</loc>") && sm.includes("/rooms/vent-room/") && sm.includes("<loc>https://whisperplusme.com/connect</loc>"));
    assert.ok(sm.includes(`/m/${mg.id}<`) && sm.includes(`/c/${deal.id}<`), "live events listed");
    assert.ok(sm.includes("/u/seeker<"), "profiles with a bio or photo are listed");
    assert.ok(!sm.includes("/u/rando<") || rtdb.users.rando.photo || rtdb.users.rando.bio, "bare profiles are not");
    await admin({ action: "hideMeetup", id: mg.id });
    assert.ok(!(await T.buildSitemap()).includes(`/m/${mg.id}<`), "paused M&G drops out");
  });

  await test("Plan a Date: posting costs 1 coin, people ask free, creator picks one, money talk blocked, no-show strike, unmatched coin comes back", async () => {
    seedPeople("pcre", "pg1", "pg2", "pg3", "pnoph");
    ["pcre", "pg1", "pg2", "pg3"].forEach(u => { rtdb.users[u].photo = "https://x.test/" + u + ".jpg"; rtdb.users[u].email = u + "@x.com"; });
    const s = await T.getSettings();
    const venue = { name: "Taco Town", address: "12 Main St", city: "Los Angeles, CA", phone: "310-555-0100", lat: 34.05, lon: -118.25 };
    const plan = (o = {}) => Object.assign({ title: "Tacos and mini golf", about: "Low-key first date", pays: "split", venue, startsAt: Date.now() + 72 * H, birthYear: 1992, tz: "America/Los_Angeles" }, o);
    // rules on what a plan can say and where it can be
    await assert.rejects(call("createPlan", "pnoph", plan()), /profile photo/);
    await assert.rejects(call("createPlan", "pcre", plan({ about: "Generous gentlemen only, $200" })), /Leave money out/);
    await assert.rejects(call("createPlan", "pcre", plan({ about: "drinks then back to my place" })), /Homes and hotels/);
    await assert.rejects(call("createPlan", "pcre", plan({ venue: Object.assign({}, venue, { name: "Hilton Hotel" }) })), /Hotels and homes/);
    await assert.rejects(call("createPlan", "pcre", plan({ startsAt: Date.now() + 3 * H })), /24 hours/);
    assert.strictEqual(T.planTextOk("Flower arrangement class then coffee", "plan"), "", "a flower arrangement class is fine");
    assert.ok([...store.values()].some(x => x && x.where === "plan" && /Generous/.test(x.text || "")), "blocked attempts are logged for the admin");
    // posting costs 1 coin: no coins, no post; with coins it goes live right away (no card checkout)
    rtdb.users.pcre.coins = 0;
    await assert.rejects(call("createPlan", "pcre", plan()), /You need 1 coin to post a date\. You have 0 coins/);
    assert.ok(![...store.keys()].some(k => /^plans\/[^/]+$/.test(k) && store.get(k).creatorUid === "pcre"), "nothing was posted");
    rtdb.users.pcre.coins = 3; rtdb.users.pg2.coins = 2; rtdb.users.pg3.coins = 2;
    const sessBefore = S.sessions.length;
    const p1 = await call("createPlan", "pcre", plan());
    assert.deepStrictEqual([p1.url, p1.coins, rtdb.users.pcre.coins, S.sessions.length], [null, 1, 2, sessBefore], "1 coin taken, no checkout");
    const x1 = doc("plans/" + p1.id);
    assert.deepStrictEqual([x1.status, x1.paidWith, x1.coins, x1.venueName, x1.city], ["live", "coins", 1, "Taco Town", "Los Angeles, CA"]);
    assert.ok(!("address" in x1) && !("phone" in x1), "street address and phone stay private");
    assert.strictEqual(x1.tz, "America/Los_Angeles", "the place's time zone is kept");
    assert.deepStrictEqual([x1.lat, x1.lon], [34.05, -118.25], "open dates get a map pin");
    // the share page: who, what, where (city only), free to ask, not indexed
    const pg = await T.share.planPage(p1.id);
    assert.ok(/Tacos and mini golf/.test(pg) && /Taco Town, Los Angeles, CA/.test(pg) && /I&#39;m interested|I'm interested/.test(pg) && /noindex/.test(pg), "plan share page");
    assert.ok(!/12 Main St/.test(pg) && !/310-555/.test(pg), "share page never shows the street address or phone");
    assert.ok(/isn't open anymore/.test(await T.share.planPage("nope")), "missing plan page");
    // asking is free; needs a photo, can't ask yourself, money talk in the note is blocked
    await assert.rejects(call("requestPlan", "pnoph", { planId: p1.id, birthYear: 1990 }), /profile photo/);
    await assert.rejects(call("requestPlan", "pcre", { planId: p1.id }), /your own/);
    await assert.rejects(call("requestPlan", "pg1", { planId: p1.id, birthYear: 1990, note: "cashapp me first" }), /Leave money out/);
    rtdb.blocks = { pcre: { pg3: true } };
    await assert.rejects(call("requestPlan", "pg3", { planId: p1.id, birthYear: 1990 }), /can't ask/);
    rtdb.blocks = {};
    await call("requestPlan", "pg1", { planId: p1.id, birthYear: 1990, note: "Love tacos!" });
    await call("requestPlan", "pg2", { planId: p1.id, birthYear: 1990 });
    await assert.rejects(call("requestPlan", "pg1", { planId: p1.id }), /already asked/);
    assert.strictEqual(doc("plans/" + p1.id).requests, 2);
    let mine = await call("myPlans", "pcre");
    const card = mine.plans.find(z => z.id === p1.id);
    assert.deepStrictEqual(card.requests.map(r => r.uid).sort(), ["pg1", "pg2"], "creator sees who asked");
    // only the creator picks; picking one opens messages for the two of them
    await assert.rejects(call("answerPlanRequest", "pg2", { planId: p1.id, uid: "pg1", approve: true }), /Not your date/);
    await call("answerPlanRequest", "pcre", { planId: p1.id, uid: "pg1", approve: true });
    assert.deepStrictEqual([doc("plans/" + p1.id).status, doc("plans/" + p1.id).guestUid], ["matched", "pg1"]);
    assert.deepStrictEqual(rtdb.planChat[p1.id].members, { pcre: true, pg1: true });
    await assert.rejects(call("answerPlanRequest", "pcre", { planId: p1.id, uid: "pg2", approve: true }), /already picked/);
    await call("planSay", "pg1", { planId: p1.id, text: "See you at 7! I'll grab a table." });
    await assert.rejects(call("planSay", "pg1", { planId: p1.id, text: "send $50 on venmo for gas" }), /Leave money out/);
    await assert.rejects(call("planSay", "pg2", { planId: p1.id, text: "hi" }), /once someone is picked/);
    assert.strictEqual(Object.keys(rtdb.planChat[p1.id].msgs).length, 1);
    // they confirm → everyone else is told it's filled
    await call("confirmPlan", "pg1", { planId: p1.id });
    assert.strictEqual(doc("plans/" + p1.id).status, "confirmed");
    assert.strictEqual(doc(`planRequests/${p1.id}_pg2`).status, "filled");
    mine = await call("myPlans", "pg1");
    assert.strictEqual(mine.plans.find(z => z.id === p1.id).address, "12 Main St", "the picked person gets the address");
    assert.strictEqual((await call("myPlans", "pg2")).plans.find(z => z.id === p1.id).status, "filled", "the others see it was filled");
    // the day before: a reminder
    advanceHours(49); const M = T.sentMail; M.length = 0;
    await T.planHousekeeping(s);
    assert.ok(M.some(m => m.to === "pg1@x.com" && /Tomorrow/.test(m.subject)) && M.some(m => m.to === "pcre@x.com" && /Tomorrow/.test(m.subject)), "both get a reminder email");
    // on the day: only the guest shows up (GPS at the place)
    await assert.rejects(call("planHere", "pg1", { planId: p1.id, lat: 34.05, lng: -118.25 }), /opens an hour before/);
    advanceHours(23);
    await assert.rejects(call("planHere", "pg1", { planId: p1.id, lat: 34.2, lng: -118.25 }), /don't seem to be at Taco Town/);
    await call("planHere", "pg1", { planId: p1.id, lat: 34.0501, lng: -118.2501 });
    advanceHours(4);
    const coins0 = rtdb.users.pg1.coins || 0;
    await T.planHousekeeping(s);
    const xd = doc("plans/" + p1.id);
    assert.deepStrictEqual([xd.status, xd.noShows], ["completed", ["pcre"]]);
    assert.strictEqual(doc("members/pcre").strikes, 1, "the creator who didn't show gets a strike");
    assert.strictEqual(rtdb.users.pg1.coins, coins0 + s.stoodUpRewardCoins, "the one who showed gets a coin");
    // rating each other (stars only on the person)
    await call("rateEvent", "pg1", { kind: "pd", id: p1.id, stars: 2, text: "Never showed" });
    assert.deepStrictEqual([rtdb.users.pcre.dateRating.n, rtdb.users.pcre.dateRating.avg], [1, 2]);
    await assert.rejects(call("rateEvent", "pg2", { kind: "pd", id: p1.id, stars: 5 }), /date you went on/);

    // no match by the time it starts → the coin comes back
    const p2 = await call("createPlan", "pcre", plan({ title: "Coffee and a walk", startsAt: Date.now() + 30 * H }));
    const coinsBefore = rtdb.users.pcre.coins;
    await call("requestPlan", "pg2", { planId: p2.id });
    advanceHours(31);
    await T.planHousekeeping(s);
    assert.strictEqual(doc("plans/" + p2.id).status, "expired");
    assert.strictEqual(doc(`planRequests/${p2.id}_pg2`).status, "closed");
    assert.strictEqual(rtdb.users.pcre.coins, coinsBefore + 1, "coin back");
    await T.planHousekeeping(s);
    assert.strictEqual(rtdb.users.pcre.coins, coinsBefore + 1, "never twice");
    const p3 = await call("createPlan", "pcre", plan({ title: "Paint and sip", startsAt: Date.now() + 40 * H }));
    assert.deepStrictEqual([p3.url, doc("plans/" + p3.id).status, rtdb.users.pcre.coins], [null, "live", coinsBefore]);

    // picked but never confirmed → back on, creator picks someone else
    await call("requestPlan", "pg2", { planId: p3.id });
    await call("requestPlan", "pg3", { planId: p3.id, birthYear: 1990 });
    await call("answerPlanRequest", "pcre", { planId: p3.id, uid: "pg2", approve: true });
    advanceHours(13);
    await T.planHousekeeping(s);
    assert.deepStrictEqual([doc("plans/" + p3.id).status, doc("plans/" + p3.id).guestUid, doc(`planRequests/${p3.id}_pg2`).status], ["live", null, "lapsed"]);
    await call("answerPlanRequest", "pcre", { planId: p3.id, uid: "pg3", approve: true });
    await call("confirmPlan", "pg3", { planId: p3.id });
    // the guest backs out the same day → strike for them, creator's fee back (too late to find someone else)
    advanceHours(23);
    const strikes3 = (doc("members/pg3") || {}).strikes || 0;
    await call("withdrawPlan", "pg3", { planId: p3.id });
    assert.strictEqual(doc("plans/" + p3.id).status, "canceled");
    assert.strictEqual(doc("members/pg3").strikes, strikes3 + 1);
    assert.strictEqual(rtdb.users.pcre.coins, coinsBefore + 1, "creator's coin back");

    // creator cancels early → credit; admin can remove one and give the fee back
    const p4 = await call("createPlan", "pcre", plan({ title: "Bowling", startsAt: Date.now() + 80 * H }));
    assert.strictEqual(rtdb.users.pcre.coins, coinsBefore);
    const c4 = await call("cancelPlan", "pcre", { planId: p4.id });
    assert.ok(/Your 1 coin is back/.test(c4.message) && rtdb.users.pcre.coins === coinsBefore + 1, c4.message);
    const p5 = await call("createPlan", "pcre", plan({ title: "Arcade night", startsAt: Date.now() + 60 * H }));
    const ad = await call("nightsAdminAction", "v6aIXY12MDY9ci1wWJmCiLOAKoG2", { action: "plans" });
    assert.ok(ad.plans.some(z => z.id === p5.id) && ad.flags.length >= 3, "admin sees plans and blocked attempts");
    await call("nightsAdminAction", "v6aIXY12MDY9ci1wWJmCiLOAKoG2", { action: "removePlan", id: p5.id, reason: "Test", data: { refund: true } });
    assert.deepStrictEqual([doc("plans/" + p5.id).status, rtdb.users.pcre.coins], ["removed", coinsBefore + 1]);
    // 🗺️ map pins: a place typed in by hand (no spot yet) is looked up once, never again
    const p7 = await call("createPlan", "pg2", plan({ title: "Typed-in place", startsAt: Date.now() + 50 * H, venue: { name: "Corner Cafe", address: "9 Elm St", city: "Austin, TX", phone: "512-555-0101" } }));
    assert.strictEqual(doc("plans/" + p7.id).lat, null);
    await T.mapPins();
    assert.strictEqual(doc("plans/" + p7.id).geoTried, true, "looked up once (no network in tests)");
    await call("cancelPlan", "pg2", { planId: p7.id });
    // the admin can change the price in coins, even to free
    await assert.rejects(call("nightsAdminAction", "v6aIXY12MDY9ci1wWJmCiLOAKoG2", { action: "savePlanCoins", data: { planCoins: 99 } }), /0 to 20/);
    await call("nightsAdminAction", "v6aIXY12MDY9ci1wWJmCiLOAKoG2", { action: "savePlanCoins", data: { planCoins: 0 } });
    const before3 = rtdb.users.pg3.coins;
    const p6 = await call("createPlan", "pg3", plan({ title: "Free coffee date", startsAt: Date.now() + 40 * H }));
    assert.deepStrictEqual([p6.url, doc("plans/" + p6.id).status, doc("plans/" + p6.id).paidWith, rtdb.users.pg3.coins], [null, "live", "free", before3]);
    assert.strictEqual((await call("myPlans", "pg3", {})).coins, 0);
    await call("cancelPlan", "pg3", { planId: p6.id });
    assert.strictEqual(rtdb.users.pg3.coins, before3, "nothing to give back on a free listing");
    await call("nightsAdminAction", "v6aIXY12MDY9ci1wWJmCiLOAKoG2", { action: "savePlanCoins", data: { planCoins: 1 } });
    const mp = await call("myPlans", "pg3", {});
    assert.deepStrictEqual([mp.coins, mp.coinsHave], [1, before3]);
  });

  await test("Plan a Date: no double-booking (first confirm wins, the other pick reopens, clashing asks are blocked)", async () => {
    seedPeople("dA", "dB", "dC", "dE", "dG", "dH");
    ["dA", "dB", "dC", "dE", "dG", "dH"].forEach(u => { rtdb.users[u].photo = "https://x.test/" + u + ".jpg"; rtdb.users[u].email = u + "@x.com"; });
    const venue = { name: "Taco Town", address: "12 Main St", city: "Austin, TX", phone: "512-555-0100", lat: 30.27, lon: -97.74 };
    const T0 = Date.now() + 72 * H;
    ["dA", "dB", "dC", "dE", "dG", "dH"].forEach(u => { rtdb.users[u].coins = 10; });
    const post = async (u, title, at) => { const r = await call("createPlan", u, { title, pays: "split", venue, startsAt: at, birthYear: 1990 }); return r.id; };
    const a = await post("dA", "Tacos", T0), b = await post("dB", "Bowling", T0 + 1 * H), c = await post("dC", "Brunch", T0 + 30 * H), g = await post("dE", "Karaoke", T0 + 3 * H);
    for (const id of [a, b, c, g]) await call("requestPlan", "dG", { planId: id, birthYear: 1991 });
    await call("requestPlan", "dH", { planId: b, birthYear: 1993 });
    // both A and B pick dG around the same time (allowed: nothing is confirmed yet)
    await call("answerPlanRequest", "dA", { planId: a, uid: "dG", approve: true });
    await call("answerPlanRequest", "dB", { planId: b, uid: "dG", approve: true });
    assert.deepStrictEqual([doc("plans/" + a).status, doc("plans/" + b).status], ["matched", "matched"]);
    const gReq = doc("plans/" + g).requests;
    // dG confirms A first: B goes back to its creator, the 3-hours-later request is taken back, the next-day one stays
    await call("confirmPlan", "dG", { planId: a, yes: true });
    assert.strictEqual(doc("plans/" + a).status, "confirmed");
    assert.deepStrictEqual([doc("plans/" + b).status, doc("plans/" + b).guestUid], ["live", null], "the clashing pick reopens");
    assert.strictEqual(doc("planRequests/" + b + "_dG").status, "passed");
    assert.strictEqual(doc("planRequests/" + g + "_dG").status, "withdrawn", "a request 3 hours later is taken back");
    assert.strictEqual(doc("plans/" + g).requests, gReq - 1);
    assert.strictEqual(doc("planRequests/" + c + "_dG").status, "pending", "a date 30 hours later is fine");
    await assert.rejects(call("confirmPlan", "dG", { planId: b, yes: true }), /nothing to confirm/);
    // B picks dH instead; dH confirms
    await call("answerPlanRequest", "dB", { planId: b, uid: "dH", approve: true });
    await call("confirmPlan", "dH", { planId: b, yes: true });
    // booked people can't post or ask for dates that clash
    await assert.rejects(call("createPlan", "dG", { title: "Sushi", pays: "split", venue, startsAt: T0 - 1 * H }), /already have a date around then/);
    assert.strictEqual(rtdb.users.dG.coins, 10, "a refused post never takes the coin");
    await assert.rejects(call("requestPlan", "dH", { planId: g }), /already have a date around then/);
    // a creator can't pick someone who's already booked then
    await call("requestPlan", "dH", { planId: c });
    await call("answerPlanRequest", "dC", { planId: c, uid: "dH", approve: true }); // 29h apart: fine
    assert.strictEqual(doc("plans/" + c).guestUid, "dH");
    // posting next to your own date clashes; far enough apart is fine
    await assert.rejects(call("createPlan", "dE", { title: "Late show", pays: "split", venue, startsAt: T0 + 5 * H }), /already have a date around then/);
    // someone far away has to say they'll be in town; the creator sees how far
    seedPeople("dJ", "dK"); rtdb.users.dJ.photo = "https://x.test/dJ.jpg"; rtdb.users.dK.photo = "https://x.test/dK.jpg"; rtdb.users.dK.email = "dK@x.com"; rtdb.users.dK.coins = 5;
    const k = await post("dK", "Museum", T0 + 50 * H);
    const la = { lat: 34.05, lng: -118.24, birthYear: 1994 };
    await assert.rejects(call("requestPlan", "dJ", { planId: k, ...la }), /about 1\d{3} miles from you\. Only ask if you'll be in Austin/);
    await call("requestPlan", "dJ", { planId: k, ...la, traveling: true });
    const fromLA = doc("planRequests/" + k + "_dJ");
    assert.ok(fromLA.distKm > 1800 && fromLA.distKm < 2000 && fromLA.traveling === true, "distance kept for the creator: " + fromLA.distKm);
    await call("requestPlan", "dJ", { planId: g, lat: 30.3, lng: -97.7 }).catch(() => {}); // next door: no box needed
    const near = (await call("myPlans", "dE", {})).plans.find(x => x.id === g);
    assert.ok(near && near.requests.some(r => r.uid === "dJ" && r.distKm != null && r.distKm < 10), "the creator sees they're close");
    const z = await post("dE", "Late show", T0 + 8 * H);
    await call("requestPlan", "dA", { planId: z }); // dA's own Tacos is 8 hours earlier
    assert.strictEqual(doc("planRequests/" + z + "_dA").status, "pending");
  });

  await test("Partners: apply, approved, link clicks, new sign-ups counted, 20% of the site's share on M&G spots, hosted M&Gs and Connect Me (matchmaker), never coins or Plan a Date, for a set number of months (3 unless changed), hold then paid, chargeback cancels", async () => {
    const ADM = "v6aIXY12MDY9ci1wWJmCiLOAKoG2", P = T.partners();
    const auth = require("firebase-admin").__auth;
    seedPeople("ptA", "ptB", "nm1", "nm2", "old1");
    const fresh = u => { auth[u] = Object.assign(auth[u] || {}, { creationTime: new Date(Date.now()).toUTCString() }); };
    // apply → pending → admin approves with a link name
    await assert.rejects(call("partnerApply", "ptA", { channels: [], how: "x" }), /at least one place/);
    await assert.rejects(call("partnerApply", "ptA", { channels: ["TikTok"], how: "I post date ideas daily", code: "admin", agree: true }), /3 to 20 letters/);
    const r = await call("partnerApply", "ptA", { channels: ["TikTok", "Instagram"], how: "I post St. Louis date ideas daily", links: "@stlDates", audience: "12k", code: "STL-Dates!", agree: true });
    assert.ok(/Thanks/.test(r.message));
    assert.strictEqual((await call("partnerMe", "ptA")).status, "pending");
    await assert.rejects(call("partnerApply", "ptA", { channels: ["TikTok"], how: "again and again", agree: true }), /application is in/);
    const list = await call("nightsAdminAction", ADM, { action: "partners" });
    assert.ok(list.partners.some(x => x.uid === "ptA" && x.status === "pending" && x.wantCode === "stl-dates"));
    await call("nightsAdminAction", ADM, { action: "approvePartner", id: "ptA" });
    assert.deepStrictEqual([doc("partners/ptA").status, doc("partners/ptA").code, doc("partnerCodes/stl-dates").uid], ["active", "stl-dates", "ptA"]);
    // a second partner can't take the same link name
    await call("partnerApply", "ptB", { channels: ["Facebook groups"], how: "I run a local events group", agree: true });
    await assert.rejects(call("nightsAdminAction", ADM, { action: "approvePartner", id: "ptB", data: { code: "stl-dates" } }), /taken/);
    // clicks: /go/CODE counts and opens the site with the code
    let red = null; const res = { set() {}, redirect: (c, u) => { red = u; } };
    await P.go({ path: "/go/stl-dates/meet" }, res);
    await P.go({ path: "/go/stl-dates" }, res);
    assert.strictEqual(red, "https://whisperplusme.com/?via=stl-dates&vc=1");
    await P.go({ path: "/go/nobody" }, res);
    assert.strictEqual(doc("partners/ptA").clicks, 2);
    // any page works: /go/CODE/m/ID opens that M&G with the code (and junk paths go home)
    await P.go({ path: "/go/stl-dates/m/abc123" }, res);
    assert.strictEqual(red, "https://whisperplusme.com/m/abc123?via=stl-dates&vc=1");
    await P.go({ path: "/go/stl-dates/u/Kiana_Rae" }, res);
    assert.strictEqual(red, "https://whisperplusme.com/u/Kiana_Rae?via=stl-dates&vc=1");
    await P.go({ path: "/go/stl-dates/https:/evil.com" }, res);
    assert.ok(red.startsWith("https://whisperplusme.com/"), red);
    await P.go({ path: "/go/stl-dates/m/../../x" }, res);
    assert.ok(red.startsWith("https://whisperplusme.com/?via"), red);
    assert.strictEqual(doc("partners/ptA").clicks, 6);
    // a share link with ?via=CODE counts its visit with a ping (robots don't count)
    let code204 = 0; const pres = { set() { return pres; }, status(c) { code204 = c; return pres; }, send() {} };
    await P.go({ path: "/go/stl-dates/ping" }, pres);
    await P.go({ path: "/go/stl-dates/ping", get: () => "WhatsApp/2.0" }, pres);
    assert.deepStrictEqual([code204, doc("partners/ptA").clicks], [204, 7]);
    // robots following a link to one page are sent to that page, for its own preview
    let bred = ""; const b2 = { set() { return b2; }, redirect: (c, u) => { bred = u; } };
    await P.go({ path: "/go/stl-dates/m/abc123", get: () => "facebookexternalhit/1.1" }, b2);
    assert.strictEqual(bred, "https://whisperplusme.com/m/abc123?via=stl-dates&vc=1");
    assert.strictEqual(doc("partners/ptA").clicks, 7);
    // approved partners get their code on their profile, so the app adds it to everything they share
    assert.strictEqual(rtdb.users.ptA.partnerCode, "stl-dates");
    // link previews (robots) get the partner's own share preview and are not counted as clicks
    let html = ""; const bres = { set() { return bres; }, status() { return bres; }, send: h => { html = h; }, redirect: () => assert.fail("robots get the preview page") };
    await P.go({ path: "/go/stl-dates", get: () => "facebookexternalhit/1.1" }, bres);
    assert.ok(/invited you to Whisper\+Me/.test(html) && html.includes("/s/pt/stl-dates/card.png") && html.includes("?via=stl-dates"), html.slice(0, 300));
    assert.strictEqual(doc("partners/ptA").clicks, 7);
    // sign-ups: brand-new accounts only, never yourself, never an old account
    fresh("nm1"); fresh("nm2"); fresh("ptA");
    auth.old1 = { creationTime: new Date(Date.now() - 10 * 864e5).toUTCString() };
    assert.strictEqual(await P.attach("nm1", { s: "partner", v: "stl-dates" }), "ptA");
    assert.strictEqual(await P.attach("nm1", { s: "partner", v: "stl-dates" }), null, "only once");
    assert.strictEqual(await P.attach("old1", { s: "partner", v: "stl-dates" }), null, "old accounts don't count");
    assert.strictEqual(await P.attach("ptA", { s: "partner", v: "stl-dates" }), null, "not yourself");
    assert.strictEqual(await P.attach("nm2", { s: "partner", v: "nope" }), null, "unknown code");
    assert.strictEqual(doc("partners/ptA").signups, 1);
    // earnings: 20% of the site's share, on meet-ups only (never coins or Connect Me)
    assert.strictEqual(await P.commission({ memberUid: "nm1", kind: "coins", base: 2500, key: "coins_s1", note: "25 coins" }), 0, "coins never pay partners");
    assert.strictEqual(await P.commission({ memberUid: "nm1", kind: "pd", base: 2500, key: "pd_1" }), 0, "Plan a Date never pays partners");
    assert.strictEqual(await P.commission({ memberUid: "nm1", kind: "host", base: 2500, key: "host_m9", note: "Her M&G" }), 500, "hosted an M&G: site fee $25 → partner $5");
    assert.strictEqual(await P.commission({ memberUid: "nm1", kind: "host", base: 2500, key: "host_m9" }), 0, "a repeat event never pays twice");
    assert.strictEqual(await P.commission({ memberUid: "nm2", kind: "host", base: 2500, key: "host_m8" }), 0, "not referred");
    await P.commission({ memberUid: "nm1", kind: "mg", base: 450, key: "mg_m1_nm1", note: "Brunch" });
    assert.deepStrictEqual([doc("partners/ptA").pending, doc("partners/ptA").buyers], [590, 1], "hosting isn't buying; the M&G spot is");
    // the partner's board
    const me = await call("partnerMe", "ptA");
    assert.ok(me.status === "active" && me.code === "stl-dates" && me.clicks === 7 && me.signups === 1 && me.pending === 590 && me.recent.length === 2 && me.terms.pct === 20);
    // hold: nothing moves before 14 days, then it lands in earnings (paid with payouts)
    rtdb.users.ptA.earnings = 10;
    assert.strictEqual(await P.release(), 0);
    advanceHours(15 * 24);
    assert.strictEqual(await P.release(), 2);
    assert.strictEqual(rtdb.users.ptA.earnings, 15.9);
    assert.deepStrictEqual([doc("partners/ptA").pending, doc("partners/ptA").paid], [0, 590]);
    // a chargeback cancels what's still pending from that member
    await P.commission({ memberUid: "nm1", kind: "mg", base: 1000, key: "pd_s3" });
    assert.strictEqual(await P.reverseFor("nm1", "Chargeback"), 1);
    assert.deepStrictEqual([doc("partners/ptA").pending, doc("partnerEarnings/pd_s3").status], [0, "reversed"]);
    // paused partners earn nothing new; a custom rate; after 12 months nothing more
    await call("nightsAdminAction", ADM, { action: "pausePartner", id: "ptA", reason: "Spam" });
    assert.strictEqual(await P.commission({ memberUid: "nm1", kind: "mg", base: 1000, key: "pd_s4" }), 0);
    assert.ok(rtdb.users.ptA.partnerCode == null, "paused: code comes off their shares");
    await call("nightsAdminAction", ADM, { action: "resumePartner", id: "ptA" });
    assert.strictEqual(rtdb.users.ptA.partnerCode, "stl-dates");
    await call("nightsAdminAction", ADM, { action: "setPartnerPct", id: "ptA", data: { pct: 30 } });
    assert.strictEqual(await P.commission({ memberUid: "nm1", kind: "mg", base: 1000, key: "pd_s5" }), 300);
    await call("nightsAdminAction", ADM, { action: "partnerSettings", data: { partnerPct: 20, partnerCmPct: 10, partnerMonths: 12, partnerHoldDays: 21 } });
    assert.deepStrictEqual([(await P.cfg()).partnerHoldDays, (await P.cfg()).partnerCmPct], [21, 10]);
    // each partner can have their own Connect Me rate (of the package price)
    const rr = await call("nightsAdminAction", ADM, { action: "setPartnerPct", id: "ptA", data: { cmPct: 15 } });
    assert.ok(/M&G 30% · |M&G 30%/.test(rr.message) && /Connect Me 15%/.test(rr.message), rr.message);
    // Connect Me matchmaking: a package bought through a partner's link pays that partner, even from an older account
    seedPeople("cmOld"); auth.cmOld = { creationTime: new Date(Date.now() - 400 * 864e5).toUTCString() };
    assert.strictEqual(await P.commission({ memberUid: "cmOld", kind: "cm", base: 8000, key: "cm_o1", note: "Dinner for 2", viaCode: "stl-dates" }), 1200, "15% of an $80 package");
    // M&G spots bought through a partner's link pay that partner too, even from an older account…
    assert.strictEqual(await P.commission({ memberUid: "cmOld", kind: "mg", base: 500, key: "mg_via1", note: "Brunch", viaCode: "stl-dates" }), 150, "30% of a $5 site fee");
    // …but never your own purchase through your own link, and a hosted M&G never counts the link
    assert.strictEqual(await P.commission({ memberUid: "ptA", kind: "mg", base: 500, key: "mg_via2", viaCode: "stl-dates" }), 0);
    assert.strictEqual(await P.commission({ memberUid: "cmOld", kind: "host", base: 500, key: "host_via3", viaCode: "stl-dates" }), 0);
    assert.strictEqual(await P.commission({ memberUid: "cmOld", kind: "mg", base: 2400, key: "mg_o1", viaCode: "stl-dates" }), 720, "an M&G spot bought through the link pays the partner, even from an older account");
    assert.strictEqual(await P.commission({ memberUid: "ptA", kind: "cm", base: 8000, key: "cm_self", viaCode: "stl-dates" }), 0, "not through your own link");
    advanceHours(366 * 24);
    assert.strictEqual(await P.commission({ memberUid: "nm1", kind: "mg", base: 1000, key: "pd_s6" }), 0, "12 months are up");
    // declined
    await call("nightsAdminAction", ADM, { action: "declinePartner", id: "ptB", reason: "Not a fit yet" });
    assert.ok((await call("partnerMe", "ptB")).status === "declined");
  });

  await test("Partner packages + matchmaking: a partner posts a package, admin approves, buyer gets suggestions from members who opted in, invites one, partner is paid only when the date happens", async () => {
    const ADM = "v6aIXY12MDY9ci1wWJmCiLOAKoG2";
    seedPeople("az", "guy1", "gal1", "gal2", "gal3", "guy2");
    rtdb.users.az.email = "az@x.com";
    ["gal1", "gal2", "gal3"].forEach(u => { rtdb.users[u].photo = "https://x.test/" + u + ".jpg"; });
    rtdb.users.gal1.introOk = true; rtdb.users.gal2.introOk = true; // gal3 didn't opt in
    const venue = { name: "Cafe Rio", address: "1 Mill Ave", city: "Tempe, AZ", phone: "480-555-0100", source: "osm", lat: 33.42, lon: -111.94 };
    const pkg = { title: "Tacos & a sunset walk", about: "Dinner for two", category: "Dinner", items: ["Dinner for 2"], venue, startsAt: Date.now() + 72 * H, price: 90, size: 2, quantity: 5, venueCost: 50 };
    // only approved partners
    await assert.rejects(call("partnerPostConnect", "az", { data: pkg }), /approved partners/);
    await call("partnerApply", "az", { channels: ["Instagram"], how: "I set up my friends on dates", agree: true });
    await call("nightsAdminAction", ADM, { action: "approvePartner", id: "az", data: { code: "arizona" } });
    await assert.rejects(call("partnerPostConnect", "az", { data: { ...pkg, venueCost: 0 } }), /what the place will cost/);
    const made = await call("partnerPostConnect", "az", { data: { ...pkg, imageURL: "https://evil.example/x.jpg" } });
    const c0 = doc("connects/" + made.id);
    assert.deepStrictEqual([c0.status, c0.partnerUid, c0.imageURL], ["review", "az", ""], "goes to review, no picture links");
    assert.strictEqual(doc("connects/" + made.id + "/private/info").venueCost, 5000);
    // admin sends it back, partner fixes it, admin approves
    await call("nightsAdminAction", ADM, { action: "rejectConnect", id: made.id, reason: "Add the time you'll meet" });
    assert.strictEqual(doc("connects/" + made.id).status, "changes");
    await call("partnerPostConnect", "az", { id: made.id, data: { ...pkg, about: "Dinner for two, meet at 7" } });
    assert.strictEqual(doc("connects/" + made.id).status, "review");
    await call("nightsAdminAction", ADM, { action: "approveConnect", id: made.id });
    assert.strictEqual(doc("connects/" + made.id).status, "live");
    await assert.rejects(call("partnerPostConnect", "guy1", { id: made.id, data: pkg }), /approved partners/);
    // a buyer (not from her link) buys it
    const b = await call("buyConnect", "guy1", { dealId: made.id, birthYear: 1988 }); await completeLastCheckout("guy1");
    // her board shows the order; the pool is only people who opted in
    const board = (await call("partnerConnects", "az")).packages.find(x => x.id === made.id);
    assert.ok(board.sold === 1 && board.orders.length === 1 && board.orders[0].buyerName === "GUY1" && board.venueCost === 5000);
    const pool = (await call("partnerPool", "az")).members.map(m => m.uid).sort();
    assert.deepStrictEqual(pool, ["gal1", "gal2"]);
    // she suggests; someone who didn't opt in is skipped; not for other people's orders
    await assert.rejects(call("partnerSuggest", "az", { orderId: b.orderId, uids: ["gal3"] }), /can be suggested/);
    const sg = await call("partnerSuggest", "az", { orderId: b.orderId, uids: ["gal1", "gal2", "gal3"] });
    assert.ok(/Sent 2 suggestions/.test(sg.message));
    await assert.rejects(call("partnerSuggest", "guy2", { orderId: b.orderId, uids: ["gal1"] }), /approved partners/);
    // the buyer sees them (and who the matchmaker is) and invites one; she accepts
    const mine = (await call("myConnects", "guy1")).connects.find(x => x.id === b.orderId);
    assert.deepStrictEqual([mine.matchmaker, mine.suggestions.map(z => z.uid).sort()], ["AZ", ["gal1", "gal2"]]);
    await call("inviteToConnect", "guy1", { orderId: b.orderId, seat: 1, uid: "gal2" });
    const tok = doc("connectOrders/" + b.orderId).seats[1].token;
    await call("acceptConnect", "gal2", { token: tok, birthYear: 1995 });
    assert.ok(!(await call("myConnects", "guy1")).connects.find(x => x.id === b.orderId).suggestions.some(z => z.uid === "gal2"), "she's going now");
    // both check in → she is paid her Connect Me rate (default 10%) of the price (no pay if only one person shows)
    const e0 = (doc("partners/az").earnedTotal || 0);
    advanceHours(72);
    await call("connectHere", "guy1", { orderId: b.orderId, lat: 33.42, lng: -111.94 });
    await call("connectHere", "gal2", { orderId: b.orderId, lat: 33.42, lng: -111.94 });
    advanceHours(4); await T.housekeeping();
    assert.strictEqual(doc("connectOrders/" + b.orderId).status, "completed");
    assert.strictEqual(doc("partners/az").earnedTotal - e0, 900, "10% of $90, held then paid with payouts");
    assert.strictEqual(doc("partnerEarnings/cm_" + b.orderId).partnerUid, "az");
  });

  await test("🤝 Partner link on an M&G: an older member who buys through it earns the partner their share", async () => {
    const ADM = "v6aIXY12MDY9ci1wWJmCiLOAKoG2", auth = require("firebase-admin").__auth;
    seedPeople("pv", "vb"); auth.vb = { creationTime: new Date(Date.now() - 300 * 864e5).toUTCString() };
    await call("partnerApply", "pv", { channels: ["TikTok"], how: "I post my events every day", code: "tiara", agree: true });
    await call("nightsAdminAction", ADM, { action: "approvePartner", id: "pv" });
    const venue = { name: "Ember & Oak", address: "200 E Main St", city: "Belleville, IL", phone: "618-555-0100", source: "other" };
    const r = await admin({ action: "postMeetup", data: { title: "Meet Tiara", category: "Dinner", venue, startsAt: Date.now() + 48 * H, price: 50, spots: 10 } });
    await call("buyMeetupSpot", "vb", { meetupId: r.id, birthYear: 1990, src: { s: "partner", v: "tiara" } }); await completeLastCheckout("vb");
    assert.deepStrictEqual([doc(`meetups/${r.id}/spots/vb`).status, doc(`meetups/${r.id}/spots/vb`).via], ["paid", "tiara"]);
    const code = (await call("myMeetups", "vb")).meetups.find(m => m.id === r.id).code;
    advanceHours(49); await call("checkInGuest", ADM, { code });
    for (let i = 0; i < 8 && doc("meetups/" + r.id).status !== "completed"; i++) { advanceHours(24); await T.housekeeping(); }
    assert.strictEqual(doc("meetups/" + r.id).status, "completed");
    const e = doc(`partnerEarnings/mg_${r.id}_vb`);
    assert.ok(e && e.partnerUid === "pv" && e.amount > 0 && e.status === "pending", JSON.stringify(e));
  });
  await test("💡 Date ideas: admin-only, free to join, pay at the place, leave any time with no strike", async () => {
    const pic = u => { seedPeople(u); rtdb.users[u].photo = "https://x/p.jpg"; };
    ["di1", "di2", "di3", "di4"].forEach(pic); seedPeople("dinopic");
    const venue = { name: "Pinz", address: "1 Lane St", city: "St. Louis, MO", phone: "314-555-0101", source: "other" };
    const r = await admin({ action: "postMeetup", data: { idea: true, title: "Bowling for 2", about: "Loser buys fries", category: "Games", items: [], venue, startsAt: Date.now() + 48 * H, spots: 2, est: 25, pays: "each" } });
    const m = () => doc("meetups/" + r.id);
    assert.deepStrictEqual([m().idea, m().price, m().est, m().pays, m().spots, m().status, m().official], [true, 0, 2500, "each", 2, "live", true]);
    // Only the admin can post them: a member's M&G still needs a price.
    seedPeople("hosty"); await assert.rejects(call("createMeetup", "hosty", { ...mgData({ price: 0 }), idea: true, birthYear: 1990 }), /at least \$5/);
    await assert.rejects(call("buyMeetupSpot", "di1", { meetupId: r.id, birthYear: 1990 }), /free/);
    await assert.rejects(call("joinIdea", "dinopic", { meetupId: r.id, birthYear: 1990 }), /photo/);
    const j1 = await call("joinIdea", "di1", { meetupId: r.id, birthYear: 1990 });
    assert.ok(/We'll tell you/.test(j1.message));
    assert.deepStrictEqual([m().sold, m().going.map(g => g.uid), rtdb.ideaChat[r.id].members], [1, ["di1"], { di1: true }]);
    await assert.rejects(call("joinIdea", "di1", { meetupId: r.id }), /already going/);
    const j2 = await call("joinIdea", "di2", { meetupId: r.id, birthYear: 1990 });
    assert.ok(j2.full && m().sold === 2);
    await assert.rejects(call("joinIdea", "di3", { meetupId: r.id, birthYear: 1990 }), /filled up/);
    // Chat: only people going; money talk blocked
    await call("ideaSay", "di1", { meetupId: r.id, text: "See you at 7!" });
    await assert.rejects(call("ideaSay", "di3", { meetupId: r.id, text: "hi" }), /Only people going/);
    await assert.rejects(call("ideaSay", "di2", { meetupId: r.id, text: "cashapp me $20" }), /money/);
    // My Meet & Greet shows it with who's going and the address
    const mine = (await call("myMeetups", "di2")).meetups.find(x => x.id === r.id);
    assert.ok(mine.idea && mine.going.length === 2 && mine.address === "1 Lane St" && mine.spotStatus === "paid");
    // Leaving: free, no strike, spot opens for someone else
    const before = (doc("members/di1") || {}).strikes || 0;
    await call("leaveIdea", "di1", { meetupId: r.id });
    assert.deepStrictEqual([m().sold, m().going.map(g => g.uid), (doc("members/di1") || {}).strikes || 0, rtdb.ideaChat[r.id].members], [1, ["di2"], before, { di2: true }]);
    await call("joinIdea", "di3", { meetupId: r.id, birthYear: 1990 });
    // Edits: time and place lock once people are going
    await assert.rejects(admin({ action: "postMeetup", id: r.id, data: { title: "Bowling for 2", category: "Games", venue, startsAt: Date.now() + 60 * H, spots: 2 } }), /locked/);
    await admin({ action: "postMeetup", id: r.id, data: { title: "Bowling night for 4", category: "Games", venue, startsAt: m().startsAt.toMillis(), spots: 4, est: 30, pays: "split" } });
    assert.deepStrictEqual([m().idea, m().spots, m().pays, m().price], [true, 4, "split", 0]);
    // No hoarding: 3 open date ideas at a time
    const more = [];
    for (let i = 0; i < 3; i++) more.push((await admin({ action: "postMeetup", data: { idea: true, title: "Idea " + i, category: "Dinner", venue, startsAt: Date.now() + (50 + i) * H, spots: 2 } })).id);
    await call("joinIdea", "di4", { meetupId: more[0], birthYear: 1991 }); await call("joinIdea", "di4", { meetupId: more[1] }); await call("joinIdea", "di4", { meetupId: more[2] });
    await call("joinIdea", "di4", { meetupId: r.id }).then(() => assert.fail("should block a 4th"), e => assert.ok(/already going on 3/.test(e.message)));
    // Not full? Each person decides. "Still going" marks them ✅; nothing is canceled for them.
    await assert.rejects(call("ideaStillGoing", "di1", { meetupId: r.id, yes: true }), /not going/);
    const sg = await call("ideaStillGoing", "di2", { meetupId: r.id, yes: true });
    assert.ok(/still going/.test(sg.message));
    assert.deepStrictEqual(m().going.map(g => [g.uid, !!g.still]), [["di2", true], ["di3", false]]);
    assert.strictEqual(m().status, "live");
    // Admin cancels: nothing to refund, nobody gets "credit"
    await admin({ action: "cancelMeetup", id: r.id, reason: "Rain." });
    assert.strictEqual(m().status, "canceled");
    assert.ok(!doc("credits/di2") || !(doc("credits/di2").balance > 0), "no credit for a free date");
    assert.ok(rtdb.ideaChat[r.id] == null, "chat removed");
    // Share page says free
    const page = await T.share.meetupPage(more[0]);
    assert.ok(page.includes("Free to join") && page.includes("💡 Date idea"));
  });
  await test("🔗 Picture from a link: real pictures only, never private addresses", async () => {
    seedPeople("pic1");
    const dns = require("dns").promises, realLookup = dns.lookup, realFetch = global.fetch;
    const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    dns.lookup = async h => h === "evil.test" ? [{ address: "10.0.0.5", family: 4 }] : h === "meta.test" ? [{ address: "169.254.169.254", family: 4 }] : [{ address: "93.184.216.34", family: 4 }];
    const resp = (status, type, body, loc) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => ({ "content-type": type, location: loc, "content-length": String(body.length) })[k.toLowerCase()] }, body: (async function* () { yield body; })() });
    global.fetch = async u => { u = String(u);
      if (u.includes("/ok.png")) return resp(200, "image/png", PNG);
      if (u.includes("/hop")) return resp(302, "text/html", Buffer.from(""), "http://meta.test/latest");
      if (u.includes("/page")) return resp(200, "text/html", Buffer.from("<html>"));
      if (u.includes("/fake.png")) return resp(200, "image/png", Buffer.from("<script>alert(1)</script>"));
      return resp(404, "text/html", Buffer.from("")); };
    try {
      const r = await call("fetchPicture", "pic1", { url: "https://pics.test/a/ok.png" });
      assert.deepStrictEqual([r.type, r.name, Buffer.from(r.data, "base64").equals(PNG)], ["image/png", "ok.png", true]);
      for (const [url, re] of [["file:///etc/passwd", /https/], ["http://localhost/x.png", /isn't allowed/], ["https://evil.test/x.png", /isn't allowed/], ["https://pics.test:8080/x.png", /isn't allowed/],
        ["https://pics.test/hop", /isn't allowed/], ["https://pics.test/page", /web page/], ["https://pics.test/fake.png", /real picture/], ["not a link", /web address/]])
        await assert.rejects(call("fetchPicture", "pic1", { url }), re, url);
      await assert.rejects(call("fetchPicture", null, { url: "https://pics.test/a/ok.png" }));
    } finally { dns.lookup = realLookup; global.fetch = realFetch; }
  });
  await test("Contact email: admin sets it once, every page and email reply uses it", async () => {
    T.resetContact();
    assert.strictEqual(await T.contactEmail(), "whisper.me.support@gmail.com", "default");
    await require("firebase-admin").database().ref("landing/contact").set({ email: "hello@whisperplusme.com", updatedAt: Date.now() });
    T.resetContact();
    assert.strictEqual(await T.contactEmail(), "hello@whisperplusme.com");
    await require("firebase-admin").database().ref("landing/contact").set({ email: "not an email" });
    T.resetContact();
    assert.strictEqual(await T.contactEmail(), "whisper.me.support@gmail.com", "a bad value falls back to the default");
    T.resetContact();
  });
  await test("Landing counter and chat cleanup keep the site fast", async () => {
    const rt = require("firebase-admin").__rtdb;
    rt.presence = { a: { room: "general" }, b: { room: "general" }, c: { room: "x" } };
    rt.memberRooms = { mr_a_1: { name: "Live", closing: false }, mr_b_2: { name: "Done", closing: true } };
    const st = await T.landingStats();
    assert.deepStrictEqual([st.online, st.liveRooms], [3, 1]);
    assert.strictEqual(rt.landing.stats.online, 3);
    const msgs = {};
    for (let i = 0; i < 130; i++) msgs["m" + String(i).padStart(3, "0")] = { uid: "u", ts: 1000 + i, type: "text", text: "hi " + i };
    msgs.welcome = { uid: "whisper_support_official", ts: 1, type: "text", seeded: true };
    rt.chat = { general: msgs };
    const removed = await T.chatPrune();
    assert.strictEqual(removed, 30, "131 messages, keep newest 100 + the pinned welcome");
    assert.ok(rt.chat.general.welcome && rt.chat.general.m129 && !rt.chat.general.m000);
  });

  Date.now = realNow;
  const failed = results.filter(r => r[0] === "FAIL");
  results.forEach(r => console.log(r[0] === "ok" ? "  ✓" : "  ✗", r[1], r[2] ? "\n      " + r[2] : ""));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
