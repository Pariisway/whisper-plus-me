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
    amount_total: sess.line_items.reduce((a, l) => a + l.price_data.unit_amount, 0) } } });
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
    assert.strictEqual(doc("meetups/" + id).hostDeposit.status, "refunded");
    assert.strictEqual(S.refunds.length - r0, 1, "only the host deposit is refunded");
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
    assert.strictEqual(S.refunds.length - r0, 1, "buyer refunded; deposit kept");
    assert.deepStrictEqual([doc("meetups/" + id).status, doc("meetups/" + id).hostDeposit.status], ["canceled", "kept"]);
    assert.strictEqual(doc("members/idol").strikes, 1);
  });

  await test("M&G: rejected → deposit back; early cancel → all refunded; share page hides the address", async () => {
    seedPeople("celeb", "f5"); await call("datesJoin", "celeb", { birthYear: 1990 }); await call("datesJoin", "f5", { birthYear: 1990 });
    const a = await call("createMeetup", "celeb", mgData({ title: "Nope" })); await completeLastCheckout("celeb");
    await admin({ action: "rejectMeetup", id: a.id, reason: "Not a public place" });
    assert.deepStrictEqual([doc("meetups/" + a.id).status, doc("meetups/" + a.id).hostDeposit.status], ["rejected", "refunded"]);
    const { id } = await call("createMeetup", "celeb", mgData({ title: "Coffee & Q&A", price: 75, spots: 4, startsAt: Date.now() + 200 * H }));
    await completeLastCheckout("celeb"); await admin({ action: "approveMeetup", id });
    const html = await T.meetupOGPage(id);
    assert.ok(html.includes('og:title" content="Coffee &amp; Q&amp;A · with CELEB"'));
    assert.ok(/\$75 a spot, 4 left/.test(html) && !html.includes("123 Main St"));
    await call("buyMeetupSpot", "f5", { meetupId: id }); await completeLastCheckout("f5");
    const pv = await call("cancelMeetup", "celeb", { meetupId: id, preview: true });
    assert.ok(/returned/.test(pv.lines.join(" ")));
    await call("cancelMeetup", "celeb", { meetupId: id });
    assert.deepStrictEqual([doc("meetups/" + id).status, doc("meetups/" + id).hostDeposit.status], ["canceled", "refunded"]);
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
    await assert.rejects(call("editMeetup", "solo", { meetupId: id, data: mgData({ spots: 4, price: 250 }) }), /1-spot M&G/);
    const two = await call("createMeetup", "solo", mgData({ spots: 2, price: 40, title: "Two" }));
    assert.strictEqual([...S.sessions].reverse().find(x => x.metadata.uid === "solo").line_items[0].price_data.unit_amount, 4000, "2+ spots → one spot's price");
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
    await admin({ action: "payMeetupHost", id });
    assert.strictEqual(Math.round((Number(rtdb.users.solo.earnings) - e0) * 100), 22500, "$250 × 90%");
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
