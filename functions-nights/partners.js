/* ═══════════════════════════════════════════════════════════════
   🤝 PARTNER PROGRAM (whisperplusme.com/partner)
   Anyone applies; the admin approves. An approved partner gets a link
   (whisperplusme.com/go/CODE). People who open it and make a NEW account
   within 30 days are theirs for 3 months (Admin → Partners can change it), and the partner earns 20% of
   what Whisper+Me keeps from those people on M&Gs, plus a share of Connect Me:
     - M&G spots they buy ........ M&G rate (20%) of the site fee on their spots
     - M&Gs they host ............ M&G rate (20%) of the site fee on that M&G
     - Connect Me nights ......... Connect Me rate (10%) of the package price,
                                   only after the date happens (2+ people checked in)
   Connect Me (matchmakers): a package the partner made pays them on every sale;
   otherwise a package bought within 30 days of opening their link, or by someone
   they brought, pays them.
   Coins (calls, rooms) and Plan a Date never earn partners anything.
   Each partner can have their own M&G and Connect Me rates (Admin → Partners).
   Earnings wait a hold period (14 days, for refunds and chargebacks), then
   move into the partner's normal earnings and go out with payouts.

   Firestore (server-only):
     partners/{uid}          application + status + counters
     partnerCodes/{code}     { uid }
     partnerRefs/{memberUid} { partnerUid, code, at, until }
     partnerEarnings/{id}    one commission each, pending → paid (or reversed)
═══════════════════════════════════════════════════════════════ */
module.exports = function makePartners(d) {
  const { db, rtdb, admin, FieldValue, nowTs, ms, fromMs, push, sendEmail, logger, fail, str, APP_URL, getSettings, whisperProfile, ADMIN_UIDS, share } = d;
  const DEFAULTS = { partnerPct: 20, partnerCmPct: 10, partnerMonths: 3, partnerHoldDays: 14 };
  const KINDS = ["mg", "host", "cm"]; // never coins or Plan a Date
  const cfg = async () => { const s = await getSettings(); const o = {}; for (const k of Object.keys(DEFAULTS)) o[k] = s[k] == null ? DEFAULTS[k] : Number(s[k]); return o; };
  const pRef = uid => db.doc(`partners/${uid}`);
  const codeRef = code => db.doc(`partnerCodes/${code}`);
  const cleanCode = c => String(c || "").toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 20);
  const RESERVED = new Set(["admin", "whisper", "whisperplusme", "support", "help", "meet", "connect", "partner", "partners", "go", "staff", "official", "team"]);
  const month = t => new Date(t).toISOString().slice(0, 7);
  const money = c => "$" + (Math.round(c) / 100).toFixed(2);

  /* ---------- who referred this member (if anyone, and still within the months) ---------- */
  async function partnerOf(memberUid) {
    if (!memberUid) return null;
    const r = (await db.doc(`partnerRefs/${memberUid}`).get()).data();
    if (!r || ms(r.until) < Date.now()) return null;
    const p = (await pRef(r.partnerUid).get()).data();
    if (!p || p.status !== "active") return null;
    return { uid: r.partnerUid, code: r.code, pct: p.pct == null ? null : Number(p.pct), cmPct: p.cmPct == null ? null : Number(p.cmPct) };
  }
  async function partnerByUid(uid) {
    if (!uid) return null;
    const p = (await pRef(uid).get()).data();
    return p && p.status === "active" ? { uid, code: p.code, pct: p.pct == null ? null : Number(p.pct), cmPct: p.cmPct == null ? null : Number(p.cmPct) } : null;
  }

  /* ---------- a commission (amounts in cents) ---------- */
  /* viaCode: the partner link this purchase came through (Connect Me matchmaking), if any. */
  async function partnerByCode(code) {
    code = cleanCode(code); if (!code) return null;
    const owner = (await codeRef(code).get()).data(); if (!owner) return null;
    const p = (await pRef(owner.uid).get()).data();
    return p && p.status === "active" ? { uid: owner.uid, code, pct: p.pct == null ? null : Number(p.pct), cmPct: p.cmPct == null ? null : Number(p.cmPct) } : null;
  }
  /* base: the site fee (M&G) or the package price (Connect Me), in cents.
     ownerUid: the partner who made the Connect Me package (they're paid first). */
  async function commission({ memberUid, kind, base, key, note, viaCode, ownerUid }) {
    if (!(base > 0) || !key || !KINDS.includes(kind)) return 0;
    // Who gets it: the partner who made the package (Connect Me) → the partner link the buyer came through
    // (any purchase, any member) → the partner who brought this member in (for the set number of months).
    const owner = kind === "cm" && ownerUid ? await partnerByUid(ownerUid) : null;
    const viaP = !owner && viaCode && kind !== "host" ? await partnerByCode(viaCode) : null;
    const p = owner || (viaP && viaP.uid !== memberUid ? viaP : null) || await partnerOf(memberUid);
    if (!p || p.uid === memberUid) return 0;
    const c = await cfg();
    const pct = kind === "cm" ? (p.cmPct == null ? c.partnerCmPct : p.cmPct) : (p.pct == null ? c.partnerPct : p.pct);
    const amount = Math.round(base * pct / 100);
    if (amount <= 0) return 0;
    const ref = db.doc(`partnerEarnings/${String(key).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 140)}`);
    const made = await db.runTransaction(async tx => {
      if ((await tx.get(ref)).exists) return false; // already counted (repeat event)
      tx.set(ref, { partnerUid: p.uid, memberUid, kind, base, pct, amount, note: str(note, 80), status: "pending", at: nowTs(), availableAt: fromMs(Date.now() + c.partnerHoldDays * 864e5) });
      tx.set(pRef(p.uid), { pending: FieldValue.increment(amount), earnedTotal: FieldValue.increment(amount), byMonth: { [month(Date.now())]: FieldValue.increment(amount) } }, { merge: true });
      return true;
    });
    if (made && kind !== "host") { // count each referred member once as a buyer
      const rref = db.doc(`partnerRefs/${memberUid}`);
      await db.runTransaction(async tx => {
        const r = (await tx.get(rref)).data() || {};
        tx.set(rref, { lastEarnAt: nowTs(), countedBuyer: true }, { merge: true });
        if (!r.countedBuyer) tx.set(pRef(p.uid), { buyers: FieldValue.increment(1) }, { merge: true });
      });
    }
    return made ? amount : 0;
  }

  /* ---------- a new account that came through a partner link ---------- */
  async function attach(memberUid, src) {
    const code = cleanCode(src && src.v);
    if (!code) return null;
    const owner = (await codeRef(code).get()).data();
    if (!owner) return null;
    const p = (await pRef(owner.uid).get()).data();
    if (!p || p.status !== "active" || owner.uid === memberUid) return null;
    // Only brand-new accounts count (made in the last 2 days).
    let made = 0;
    try { made = Date.parse((await admin.auth().getUser(memberUid)).metadata.creationTime) || 0; } catch (e) { made = 0; }
    if (!made || Date.now() - made > 2 * 864e5) return null;
    const c = await cfg();
    const ref = db.doc(`partnerRefs/${memberUid}`);
    const ok = await db.runTransaction(async tx => {
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, { partnerUid: owner.uid, code, at: nowTs(), until: fromMs(Date.now() + c.partnerMonths * 30.44 * 864e5) });
      tx.set(pRef(owner.uid), { signups: FieldValue.increment(1), signupsByMonth: { [month(Date.now())]: FieldValue.increment(1) } }, { merge: true });
      return true;
    });
    if (ok) await push(owner.uid, "New sign-up from your link 🤝", "Someone just joined Whisper+Me through your partner link.", `${APP_URL}/partner/`);
    return ok ? owner.uid : null;
  }

  /* ---------- after the hold: pending → the partner's earnings (paid with payouts) ---------- */
  async function release() {
    const due = await db.collection("partnerEarnings").where("status", "==", "pending").limit(400).get();
    let n = 0;
    for (const doc of due.docs) {
      const e = doc.data();
      if (ms(e.availableAt) > Date.now()) continue;
      const ok = await db.runTransaction(async tx => {
        const cur = (await tx.get(doc.ref)).data();
        if (!cur || cur.status !== "pending") return false;
        tx.update(doc.ref, { status: "paid", paidAt: nowTs() });
        tx.set(pRef(e.partnerUid), { pending: FieldValue.increment(-e.amount), paid: FieldValue.increment(e.amount) }, { merge: true });
        return true;
      });
      if (!ok) continue;
      await rtdb.ref(`users/${e.partnerUid}/earnings`).transaction(v => Math.round(((Number(v) || 0) + e.amount / 100) * 100) / 100);
      await db.collection("ledger").add({ kind: "partnerEarned", uid: e.partnerUid, memberUid: e.memberUid, amount: e.amount, from: e.kind, at: nowTs() });
      n++;
    }
    return n;
  }

  /* ---------- a chargeback: anything still pending from that member is cancelled ---------- */
  async function reverseFor(memberUid, why) {
    if (!memberUid) return 0;
    const q = await db.collection("partnerEarnings").where("memberUid", "==", memberUid).where("status", "==", "pending").get();
    let n = 0;
    for (const doc of q.docs) {
      const e = doc.data();
      await doc.ref.update({ status: "reversed", reversedAt: nowTs(), why: str(why, 80) });
      await pRef(e.partnerUid).set({ pending: FieldValue.increment(-e.amount), earnedTotal: FieldValue.increment(-e.amount), reversed: FieldValue.increment(e.amount) }, { merge: true });
      n++;
    }
    return n;
  }

  /* ---------- /go/CODE: count the click, then open the site with the code ---------- */
  async function go(req, res) {
    const parts = req.path.split("/").filter(Boolean); // ["go", code, where?, ...]
    const code = cleanCode(parts[1]);
    const SHORT = { meet: "/meet/", plan: "/?dates=pd", connect: "/?dates=cm", mg: "/?dates=1" };
    // Any page on the site works too: /go/CODE/m/abc123 opens that M&G, /go/CODE/c/xyz that package, /go/CODE/u/name that profile…
    const rest = parts.slice(2).join("/");
    const deep = !SHORT[parts[2]] && parts[2] !== "ping" && /^[a-z][a-z0-9-]{0,15}(\/[A-Za-z0-9_.-]{1,100}){0,2}$/.test(rest) && !/\.\./.test(rest) ? "/" + rest : "";
    const where = SHORT[parts[2]] || deep || "/";
    const dest = where + (where.includes("?") ? "&" : "?") + "via=" + encodeURIComponent(code) + "&vc=1";   // vc=1: this click is already counted
    // Link previews (iMessage, Facebook, WhatsApp…) are robots: show them the preview, don't count them as clicks.
    const bot = /bot|crawl|spider|facebookexternalhit|whatsapp|telegram|slack|discord|twitter|linkedin|pinterest|preview|embed|skype|snapchat|vkshare|google-inspectiontool|applebot/i.test(String((req.get && req.get("user-agent")) || ""));
    // /go/CODE/ping: a page opened with ?via=CODE counts the click (sent once per visit by the page itself).
    if (parts[2] === "ping") {
      try { if (!bot) { const owner = code && (await codeRef(code).get()).data(); if (owner) await pRef(owner.uid).set({ clicks: FieldValue.increment(1), clicksByMonth: { [month(Date.now())]: FieldValue.increment(1) } }, { merge: true }); } } catch (e) { logger.warn("partner ping", e.message); }
      return res.set("Cache-Control", "no-store").status(204).send("");
    }
    // Robots following a link to one page get sent there, so the preview is that page's own (the M&G, the profile…).
    if (bot && deep) return res.set("Cache-Control", "no-store").redirect(302, `${APP_URL}${dest}`);
    let invite = null;
    try {
      invite = share ? await share.partnerInvite(code) : null;
      if (!bot) {
        const owner = code && (await codeRef(code).get()).data();
        if (owner) await pRef(owner.uid).set({ clicks: FieldValue.increment(1), clicksByMonth: { [month(Date.now())]: FieldValue.increment(1) } }, { merge: true });
      }
    } catch (e) { logger.warn("partner click", e.message); }
    res.set("Cache-Control", "no-store");
    // People are sent straight on. Robots get a page with the partner's own share preview.
    if (!bot || !share) return res.redirect(302, `${APP_URL}${dest}`);
    res.status(200).set("Content-Type", "text/html; charset=utf-8").send(share.partnerGoPage(invite, dest, parts[2]));
  }

  /* ---------- apply ---------- */
  async function apply(uid, data, email) {
    const cur = (await pRef(uid).get()).data();
    if (cur && ["pending", "active", "paused"].includes(cur.status)) fail("already-exists", cur.status === "pending" ? "Your application is in. We'll let you know soon." : "You're already a partner.");
    const how = str(data.how, 300), links = str(data.links, 300), audience = str(data.audience, 40), channels = (Array.isArray(data.channels) ? data.channels : []).map(x => str(x, 30)).slice(0, 8);
    if (!channels.length) fail("invalid-argument", "Pick at least one place you'll share it.");
    if (how.length < 10) fail("invalid-argument", "Tell us a little about how you'll share Whisper+Me.");
    if (data.agree !== true) fail("invalid-argument", "Please agree to the partner rules.");
    let want = cleanCode(data.code);
    if (want && (want.length < 3 || RESERVED.has(want))) fail("invalid-argument", "Pick a link name with 3 to 20 letters or numbers.");
    if (want && (await codeRef(want).get()).exists) fail("already-exists", "That link name is taken. Try another.");
    const me = await whisperProfile(uid);
    await pRef(uid).set({ uid, name: me.name, photo: me.photo, email: str(email, 200), status: "pending", wantCode: want || "", channels, how, links, audience,
      appliedAt: nowTs(), clicks: (cur && cur.clicks) || 0, signups: (cur && cur.signups) || 0 }, { merge: true });
    for (const a of ADMIN_UIDS) await push(a, "New partner application 🤝", `${me.name}: ${channels.join(", ")}`, `${APP_URL}/admin.html#partners`);
    return { message: "Thanks! We'll look at your application and let you know (usually within a day or two)." };
  }

  /* The partner's code on their public profile (users/{uid}/partnerCode): the app adds it to every
     link they share. Removed while paused. */
  async function setShareCode(uid, code) {
    try { await rtdb.ref(`users/${uid}/partnerCode`).set(code ? cleanCode(code) : null); } catch (e) { logger.warn("partner code", e.message); }
  }
  /* ---------- the partner's own board ---------- */
  async function me(uid) {
    const p = (await pRef(uid).get()).data();
    if (p) await setShareCode(uid, p.status === "active" ? p.code : "");   // keeps older partners in sync
    const c = await cfg();
    const terms = { pct: p && p.pct != null ? Number(p.pct) : c.partnerPct, cmPct: p && p.cmPct != null ? Number(p.cmPct) : c.partnerCmPct, months: c.partnerMonths, holdDays: c.partnerHoldDays };
    if (!p) return { status: "none", terms };
    const out = { status: p.status, name: p.name, code: p.code || "", wantCode: p.wantCode || "", declineReason: p.declineReason || "", pauseReason: p.pauseReason || "", terms,
      clicks: p.clicks || 0, signups: p.signups || 0, buyers: p.buyers || 0, pending: p.pending || 0, paid: p.paid || 0, earnedTotal: p.earnedTotal || 0,
      byMonth: p.byMonth || {}, clicksByMonth: p.clicksByMonth || {}, signupsByMonth: p.signupsByMonth || {} };
    if (p.status === "active") {
      const q = await db.collection("partnerEarnings").where("partnerUid", "==", uid).orderBy("at", "desc").limit(40).get();
      const LABEL = { mg: "M&G spot", host: "Hosted an M&G", cm: "Connect Me night" };
      out.recent = q.docs.map(x => { const e = x.data(); return { what: LABEL[e.kind] || e.kind, note: e.note || "", amount: e.amount, status: e.status, at: ms(e.at), availableAt: ms(e.availableAt) }; });
      const u = (await rtdb.ref(`users/${uid}`).once("value")).val() || {};
      out.payoutsOn = !!u.stripeAccountId;
      out.earningsBalance = Number(u.earnings) || 0;
    }
    return out;
  }

  /* ---------- admin ---------- */
  async function adminAction(action, id, data, reason) {
    switch (action) {
      case "partners": {
        const q = await db.collection("partners").limit(500).get();
        const list = q.docs.map(x => { const p = x.data(); return { uid: x.id, name: p.name, email: p.email, photo: p.photo, status: p.status, code: p.code || "", wantCode: p.wantCode || "", channels: p.channels || [], how: p.how || "", links: p.links || "", audience: p.audience || "",
          appliedAt: ms(p.appliedAt), clicks: p.clicks || 0, signups: p.signups || 0, buyers: p.buyers || 0, pending: p.pending || 0, paid: p.paid || 0, earnedTotal: p.earnedTotal || 0, pct: p.pct == null ? null : p.pct, cmPct: p.cmPct == null ? null : p.cmPct }; });
        list.sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.earnedTotal - a.earnedTotal || b.appliedAt - a.appliedAt);
        return { partners: list, settings: await cfg() };
      }
      case "approvePartner": {
        const p = (await pRef(id).get()).data();
        if (!p) fail("not-found", "No such application.");
        let code = cleanCode(data.code || p.code || p.wantCode || p.name);
        if (code.length < 3) code = (code + "partner").slice(0, 12);
        if (RESERVED.has(code)) code = code + "1";
        await db.runTransaction(async tx => {
          const taken = (await tx.get(codeRef(code))).data();
          if (taken && taken.uid !== id) fail("already-exists", `The link name “${code}” is taken. Type another one.`);
          if (p.code && p.code !== code) tx.delete(codeRef(p.code));
          tx.set(codeRef(code), { uid: id, at: nowTs() });
          tx.update(pRef(id), { status: "active", code, approvedAt: nowTs(), declineReason: FieldValue.delete(), pauseReason: FieldValue.delete() });
        });
        await setShareCode(id, code);
        await push(id, "You're a Whisper+Me partner! 🤝", `Your link is whisperplusme.com/go/${code}. Open your partner board to start sharing.`, `${APP_URL}/partner/`);
        await sendEmail(id, "You're a Whisper+Me partner 🤝", { heading: "Welcome to the partner program! 🤝", intro: `Share your link, or share anything on Whisper+Me while you're signed in: your code is added to every share link for you. You earn when people buy through your links, and for ${(await cfg()).partnerMonths} months on what the people who join through them spend.`,
          rows: [["Your link", `whisperplusme.com/go/${code}`], ["You earn", `${(await cfg()).partnerPct}% of what Whisper+Me keeps`], ["For", `${(await cfg()).partnerMonths} months per person`]],
          button: ["Open my partner board", `${APP_URL}/partner/`], after: "Set up payouts in 👤 Profile → Wallet so we can send your earnings to your bank." });
        return { message: `Approved: whisperplusme.com/go/${code}` };
      }
      case "declinePartner": {
        await pRef(id).update({ status: "declined", declineReason: str(reason, 200) || "Not a fit right now." });
        await push(id, "About your partner application", str(reason, 200) || "It isn't a fit right now. Thanks for applying!", `${APP_URL}/partner/`);
        return { message: "Declined" };
      }
      case "pausePartner": case "resumePartner": {
        const on = action === "resumePartner";
        await pRef(id).update(on ? { status: "active", pauseReason: FieldValue.delete() } : { status: "paused", pauseReason: str(reason, 200) || "Paused by Whisper+Me" });
        await setShareCode(id, on ? ((await pRef(id).get()).data() || {}).code : "");
        return { message: on ? "Partner is back on" : "Paused: their link still works, but nothing new is earned while paused" };
      }
      case "setPartnerPct": { // each partner's own rates; empty = the default for everyone
        const read = (v, max, label) => { if (v === undefined) return undefined; if (v === null || v === "") return null; const n = Math.round(Number(v)); if (!(n >= 0 && n <= max)) fail("invalid-argument", `${label}: 0 to ${max}%`); return n; };
        const pct = read(data.pct, 50, "M&G"), cmPct = read(data.cmPct, 50, "Connect Me");
        const upd = {};
        if (pct !== undefined) upd.pct = pct === null ? FieldValue.delete() : pct;
        if (cmPct !== undefined) upd.cmPct = cmPct === null ? FieldValue.delete() : cmPct;
        if (!Object.keys(upd).length) fail("invalid-argument", "Nothing to change.");
        await pRef(id).update(upd);
        const c = await cfg(), p = (await pRef(id).get()).data() || {};
        return { message: `M&G ${p.pct == null ? c.partnerPct + "% (default)" : p.pct + "%"} of the site fee · Connect Me ${p.cmPct == null ? c.partnerCmPct + "% (default)" : p.cmPct + "%"} of the price` };
      }
      case "partnerSettings": {
        const n = (k, lo, hi) => { const v = Math.round(Number(data[k])); if (!(v >= lo && v <= hi)) fail("invalid-argument", `${k}: ${lo} to ${hi}`); return v; };
        const s = { partnerPct: n("partnerPct", 0, 50), partnerCmPct: n("partnerCmPct", 0, 50), partnerMonths: n("partnerMonths", 1, 60), partnerHoldDays: n("partnerHoldDays", 0, 60) };
        await db.doc("settings/platform").set(s, { merge: true });
        return { message: "Partner settings saved" };
      }
      case "partnerEarnings": {
        const q = await db.collection("partnerEarnings").where("partnerUid", "==", id).orderBy("at", "desc").limit(100).get();
        return { earnings: q.docs.map(x => { const e = x.data(); return { id: x.id, kind: e.kind, note: e.note, amount: e.amount, base: e.base, pct: e.pct, status: e.status, at: ms(e.at), memberUid: e.memberUid }; }) };
      }
      default: return null;
    }
  }

  return { commission, attach, release, reverseFor, go, apply, me, adminAction, partnerOf, partnerByUid, cfg, money, cleanCode };
};
