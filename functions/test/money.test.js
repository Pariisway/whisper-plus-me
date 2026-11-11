// Money tests for the main app's functions (calls, rooms, coin purchases), with in-memory Firebase.
// Run: npm test   (from functions/)
const path = require("path");
const assert = require("assert");
process.env.GCLOUD_PROJECT = "demo-test";
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: "demo-test", databaseURL: "https://demo-test.firebaseio.com" });

// The same in-memory Firebase the Dates tests use (its transactions behave like the real SDK's: first try sees null).
const fake = require("../../functions-nights/test/fake-admin");
fake.auth = () => ({ verifyIdToken: async t => ({ uid: t, firebase: { sign_in_provider: "password" } }) });
const adminPath = require.resolve("firebase-admin", { paths: [path.join(__dirname, "..")] });
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: fake };
// Stripe stand-in: the webhook body is trusted as the event.
const stripePath = require.resolve("stripe", { paths: [path.join(__dirname, "..")] });
require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: () => ({ webhooks: { constructEvent: b => JSON.parse(String(b)) } }) };
const F = require("../index.js");
const rtdb = fake.__rtdb;
const ADMIN = "v6aIXY12MDY9ci1wWJmCiLOAKoG2";

const run = (fn, uid, body) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, removeHeader() {}, on() {}, once() {}, emit() {}, status(c) { this.statusCode = c; return this; },
    json(o) { resolve({ status: this.statusCode, body: o }); }, send(o) { resolve({ status: this.statusCode, body: o }); }, end() { resolve({ status: this.statusCode }); } };
  const req = { method: "POST", headers: uid ? { authorization: "Bearer " + uid, origin: "https://whisperplusme.com" } : { origin: "https://whisperplusme.com" }, body, rawBody: Buffer.from(JSON.stringify(body || {})), query: {}, get: () => "" };
  Promise.resolve(F[fn](req, res)).catch(reject);
});
const results = [];
async function test(name, fn) { try { await fn(); results.push(["ok", name]); } catch (e) { results.push(["FAIL", name, e.stack.split("\n").slice(0, 3).join(" | ")]); } }
const user = (uid, o) => { rtdb.users = rtdb.users || {}; rtdb.users[uid] = Object.assign({ name: uid }, o); };

(async () => {
  await test("Calls: charged once even if both phones hang up together; $2 a coin to the person called, $1 to the site", async () => {
    user("caller", { coins: 10 }); user("star", { price: 3, earnings: 1 }); rtdb.siteRevenue = 5;
    const { body } = await run("startCall", "caller", { targetUid: "star" });
    rtdb.calls[body.callId].answeredAt = Date.now();
    const [a, b] = await Promise.all([run("completeCallPayout", "caller", { callId: body.callId }), run("completeCallPayout", "star", { callId: body.callId })]);
    assert.strictEqual([a.body, b.body].filter(x => x.charged).length, 1, JSON.stringify([a.body, b.body]));
    assert.deepStrictEqual([rtdb.users.caller.coins, rtdb.users.star.earnings, rtdb.siteRevenue], [7, 7, 8]);
  });
  await test("Calls: the price can't be changed on the call record after it starts", async () => {
    user("c2", { coins: 20 }); user("s2", { price: 2 }); user("thief", {});
    const { body } = await run("startCall", "c2", { targetUid: "s2" });
    Object.assign(rtdb.calls[body.callId], { price: 20, to: "thief", answeredAt: Date.now() });   // what a client could write
    await run("completeCallPayout", "s2", { callId: body.callId });
    assert.deepStrictEqual([rtdb.users.c2.coins, rtdb.users.s2.earnings, rtdb.users.thief.earnings], [18, 4, undefined]);
  });
  await test("Calls: not answered = free; not enough coins = free; strangers can't settle someone's call", async () => {
    user("c3", { coins: 1 }); user("s3", { price: 5 });
    let r = await run("startCall", "c3", { targetUid: "s3" });
    assert.strictEqual(r.status, 402);
    user("c3", { coins: 9 });
    r = await run("startCall", "c3", { targetUid: "s3" });
    const id = r.body.callId;
    assert.strictEqual((await run("completeCallPayout", "nosy", { callId: id })).status, 403);
    assert.strictEqual((await run("completeCallPayout", "c3", { callId: id })).body.charged, false, "never answered");
    assert.strictEqual(rtdb.users.c3.coins, 9);
  });
  await test("Member rooms: coins taken once, owner gets $2 a coin as earnings, site $1", async () => {
    user("owner", { earnings: 0 }); user("guest", { coins: 3 }); rtdb.siteRevenue = 0;
    rtdb.memberRooms = { mr_x_1: { name: "Late talks", cost: 2, ownerId: "owner", ownerName: "Owner", createdAt: 1 } };
    const r = await run("joinMemberRoom", "guest", { roomId: "mr_x_1" });
    assert.ok(r.body.ok, JSON.stringify(r.body));
    assert.deepStrictEqual([rtdb.users.guest.coins, rtdb.users.owner.earnings, rtdb.siteRevenue], [1, 4, 2]);
    rtdb.memberRoomCooldown = {}; rtdb.memberRoomSessions = {};
    assert.strictEqual((await run("joinMemberRoom", "guest", { roomId: "mr_x_1" })).status, 402, "1 coin left, room costs 2");
  });
  await test("Coin purchase: credited once even if Stripe sends it twice at once; unpaid sessions get nothing", async () => {
    user("buyer", { coins: 2 });
    const ev = { type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", metadata: { uid: "buyer", qty: "5", product: "coins" } } } };
    await Promise.all([run("stripeWebhook", null, ev), run("stripeWebhook", null, ev)]);
    assert.strictEqual(rtdb.users.buyer.coins, 7);
    await run("stripeWebhook", null, { type: "checkout.session.completed", data: { object: { id: "cs_2", payment_status: "unpaid", metadata: { uid: "buyer", qty: "5" } } } });
    assert.strictEqual(rtdb.users.buyer.coins, 7);
  });
  await test("Coin purchase: M&G, Connect Me and deposit checkouts never give coins", async () => {
    user("fan", { coins: 0 });
    for (const kind of ["meetup", "connect", "hostdeposit", "plan"]) {
      await run("stripeWebhook", null, { type: "checkout.session.completed", data: { object: { id: "cs_" + kind, payment_status: "paid", metadata: { app: "dates", kind, uid: "fan", qty: "2", dateId: "m1" } } } });
    }
    assert.strictEqual(rtdb.users.fan.coins, 0);
  });
  await test("Admin calls are free and pay nobody", async () => {
    user(ADMIN, { coins: 0 }); user("s5", { price: 4, earnings: 0 });
    const { body } = await run("startCall", ADMIN, { targetUid: "s5" });
    rtdb.calls[body.callId].answeredAt = Date.now();
    await run("completeCallPayout", ADMIN, { callId: body.callId });
    assert.deepStrictEqual([rtdb.users[ADMIN].coins, rtdb.users.s5.earnings], [0, 0]);
  });
  for (const r of results) console.log((r[0] === "ok" ? "  ✓ " : "  ✗ ") + r[1] + (r[2] ? "\n      " + r[2] : ""));
  const bad = results.filter(r => r[0] !== "ok").length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
})();
