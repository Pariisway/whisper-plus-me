// Whisper+me Dates — admin control room.
// Every change goes through the nightsAdminAction Cloud Function, which checks the admin
// account and writes an entry to the admin log.
import {
  collection, doc, query, where, orderBy, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref as sref, listAll, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  BRAND, auth, db, storage, call, authApi, $, esc, money, toDate, fmtWhen, ago, timeLeft, hueFrom, grad, avatar, ageFrom,
  applyBrand, toast, openSheet, closeSheet, busy, confirmSheet, renderSimpleAuth, isAdminToken
} from "./common.js";

applyBrand("Admin");

const DEFAULTS = { fee: 10, depositCents: 500, splitWindowHours: 24, minAge: 21, requireIdVerify: false, stoodUpRewardCoins: 1, strikesForSuspension: 2, suspensionDays: 3, lateCancelHours: 48, rescheduleCutoffHours: 48, openRequests: true, autoApproveVenues: false };
const S = {
  tab: "overview", vtab: "pending", dtab: "all", mtab: "all", userQ: "", rtab: "open",
  settings: { ...DEFAULTS }, venues: [], tickets: [], members: [], dates: [], reports: [], payouts: [], ledger: [], log: [], days: [], totals: {}
};
let unsubs = [];
const stop = () => { unsubs.forEach(u => u()); unsubs = []; };
const memberName = uid => S.members.find(u => u.id === uid)?.name || "Member";
const venueName = vid => S.venues.find(v => v.id === vid)?.name || "Venue";
const isSuspended = m => m.suspendedUntil && toDate(m.suspendedUntil) > new Date();
const going = d => (d.seats || []).filter(x => x.uid && ["paid", "joined"].includes(x.status));

authApi.onChange(async rawUser => {
  const user = rawUser && !rawUser.isAnonymous ? rawUser : null;
  stop();
  $("#meWrap").innerHTML = user ? `<a class="btn sm ghost" href="/?dates=1">Dates</a> <a class="btn sm ghost" href="/admin.html">Whisper+me admin</a> <button class="btn sm ghost" id="signOut">Sign out</button>` : "";
  if (!user) return renderSimpleAuth($("#app"), { eyebrow: `${BRAND.name} admin`, title: "Control room" });
  $("#signOut").onclick = () => authApi.signOut();
  const token = await user.getIdTokenResult(true);
  if (!isAdminToken(token)) {
    $("#app").innerHTML = `<div class="empty" style="margin-top:var(--s-5)"><h3>This account isn't an admin</h3><p style="max-width:56ch">Signed in as ${esc(user.email || user.uid)}. Sign in with the Whisper+me admin account to manage Dates.</p></div>`;
    return;
  }
  const live = (q, key) => unsubs.push(onSnapshot(q, s => { S[key] = s.docs.map(d => ({ id: d.id, ...d.data() })); render(true); }, e => console.warn(key, e.message)));
  unsubs.push(onSnapshot(doc(db, "settings", "platform"), s => { S.settings = { ...DEFAULTS, ...(s.exists() ? s.data() : {}) }; render(true); }));
  live(query(collection(db, "venues"), orderBy("createdAt", "desc"), limit(300)), "venues");
  live(query(collection(db, "tickets"), orderBy("startsAt", "desc"), limit(300)), "tickets");
  live(query(collection(db, "members"), orderBy("createdAt", "desc"), limit(1000)), "members");
  live(query(collection(db, "dates"), orderBy("createdAt", "desc"), limit(300)), "dates");
  live(query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(200)), "reports");
  live(query(collection(db, "payouts"), orderBy("createdAt", "desc"), limit(500)), "payouts");
  live(query(collection(db, "ledger"), orderBy("at", "desc"), limit(300)), "ledger");
  live(query(collection(db, "adminLog"), orderBy("at", "desc"), limit(40)), "log");
  live(query(collection(db, "stats"), orderBy("day", "desc"), limit(14)), "days");
  unsubs.push(onSnapshot(doc(db, "stats", "totals"), s => { S.totals = s.exists() ? s.data() : {}; render(true); }));
  render();
});

/* ================= shared bits ================= */
async function act(action, payload = {}, btn) {
  return busy(btn, async () => {
    try { const r = await call("nightsAdminAction", { action, ...payload }); toast(r.message || "Done"); return true; }
    catch (x) { toast(x.message); return false; }
  });
}
function askReason({ title, body, label = "Reason", yes, placeholder = "" }) {
  return new Promise(resolve => {
    openSheet(`<form class="sheet-body" id="reasonForm"><h3 class="display" style="font-size:30px">${esc(title)}</h3>${body ? `<p class="muted" style="margin:0">${body}</p>` : ""}
      <div class="field"><label for="reason">${esc(label)}</label><textarea id="reason" maxlength="300" placeholder="${esc(placeholder)}"></textarea></div>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn ghost" data-sheet-close>Cancel</button><button class="btn gold" type="submit">${esc(yes)}</button></div></form>`, title);
    const form = $("#reasonForm");
    form.onsubmit = e => { e.preventDefault(); const v = $("#reason").value.trim(); if (!v) { $("#reason").focus(); return; } closeSheet(); resolve(v); };
    form.addEventListener("click", e => { if (e.target.closest("[data-sheet-close]")) resolve(null); });
  });
}
const head = (title, help, right = "") => `<div class="ahead"><div><h2>${title}</h2><p>${help}</p></div>${right}</div>`;
const empty = (t, p) => `<div class="empty"><h3>${t}</h3><p>${p}</p></div>`;
const tableWrap = (cols, rows) => `<div class="table-wrap"><table><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
const searchBox = (id, val, ph) => `<label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="${id}" type="search" placeholder="${esc(ph)}" value="${esc(val)}" aria-label="${esc(ph)}"></label>`;
const MEMBER_FILTERS = {
  all: () => true,
  review: m => m.idUploaded && !m.verified,
  nodeposit: m => !m.deposit || m.deposit.status !== "active",
  strikes: m => (m.strikes || 0) > 0 || isSuspended(m),
  reported: m => (m.reportsCount || 0) > 0
};

function counts() {
  return {
    venues: S.venues.filter(v => v.status === "pending").length,
    members: S.settings.requireIdVerify ? S.members.filter(MEMBER_FILTERS.review).length : 0,
    reports: S.reports.filter(r => r.status === "open").length,
    dates: S.dates.filter(d => d.status === "forming" && d.live).length,
    payouts: new Set(S.payouts.filter(p => p.status === "due").map(p => p.venueId)).size
  };
}

/* ================= sections ================= */
function sOverview() {
  const c = counts();
  const days = [...Array(7)].map((_, i) => new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10));
  const byDay = Object.fromEntries(S.days.map(d => [d.day, d]));
  const vals = days.map(d => byDay[d]?.bookings || 0);
  const week = days.reduce((a, d) => ({ b: a.b + (byDay[d]?.bookings || 0), g: a.g + (byDay[d]?.gross || 0), f: a.f + (byDay[d]?.fees || 0), k: a.k + (byDay[d]?.depositsKept || 0), n: a.n + (byDay[d]?.noShows || 0) }), { b: 0, g: 0, f: 0, k: 0, n: 0 });
  const W = 600, H = 230, pl = 34, pr = 10, pt = 22, pb = 30;
  const top = Math.max(4, Math.ceil(Math.max(...vals) * 1.15 / 4) * 4);
  const y = v => pt + (H - pt - pb) * (1 - v / top);
  const bw = (W - pl - pr) / 7, peak = Math.max(...vals);
  const grid = [0, top / 4, top / 2, top * 3 / 4, top].map(g => `<line x1="${pl}" x2="${W - pr}" y1="${y(g)}" y2="${y(g)}" stroke="var(--line)"/><text x="${pl - 8}" y="${y(g) + 4}" text-anchor="end" font-size="11" fill="var(--dim)" font-family="DM Mono, monospace">${g}</text>`).join("");
  const bars = vals.map((v, i) => {
    const x = pl + i * bw + bw * .2, w = bw * .6, t = y(v), hi = v === peak && v > 0;
    return `<rect x="${x}" y="${t}" width="${w}" height="${Math.max(0, y(0) - t)}" rx="4" fill="${hi ? "var(--gold)" : "rgba(214,177,107,.35)"}"/><text x="${x + w / 2}" y="${t - 6}" text-anchor="middle" font-size="11" fill="${hi ? "var(--gold)" : "var(--muted)"}" font-family="DM Mono, monospace">${v}</text><text x="${x + w / 2}" y="${H - 10}" text-anchor="middle" font-size="11.5" fill="var(--muted)">${new Date(days[i] + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}</text>`;
  }).join("");
  const attn = [
    ["venues", c.venues, "Venues waiting for approval", "Check their licenses and approve"],
    ["members", c.members, "IDs to review", "Members can't book until approved"],
    ["reports", c.reports, "Open reports", "Problems people reported after a date"],
    ["dates", c.dates, "Dates still filling", "Cards on hold; called off free if not filled"],
    ["payouts", c.payouts, "Venues to pay", "Money owed for dates that already happened"]
  ].filter(a => a[0] !== "members" || S.settings.requireIdVerify);
  const hour = new Date().getHours();
  return `${head(`Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}`, `Everything on ${esc(BRAND.name)} at a glance. Anything that needs you shows up first. Tap a card to go there.`)}
    <div class="attn">${attn.map(([tab, n, b, s]) => `<button class="attn-item" data-tab="${tab}"><span class="n ${n ? "hot" : "calm"}">${n}</span><span><b>${b}</b><small>${n ? s : "All clear"}</small></span><span class="go">→</span></button>`).join("")}</div>
    <div class="stats">
      <div class="stat"><small>Dates booked, last 7 days</small><b>${week.b}</b></div>
      <div class="stat"><small>Ticket sales, last 7 days</small><b>${money(week.g)}</b></div>
      <div class="stat"><small>Your fees, last 7 days</small><b>${money(week.f)}</b></div>
      <div class="stat"><small>Deposits kept, last 7 days</small><b>${money(week.k)}</b></div>
    </div>
    <div class="two">
      <div class="panel"><div class="section-title"><h2 style="font-size:24px">Dates booked by day</h2><span class="muted" style="font-size:13px">Fully paid dates, last 7 days</span></div><div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Dates booked per day: ${vals.join(", ")}">${grid}${bars}</svg></div></div>
      <div class="panel"><h2 style="font-size:24px">Recent admin actions</h2>${S.log.length ? `<ul class="log">${S.log.slice(0, 7).map(l => `<li><span class="mono">${esc(ago(l.at))}</span><span>${esc(l.action.replace(/([A-Z])/g, " $1").toLowerCase())}${l.detail ? ": " + esc(l.detail) : ""}</span></li>`).join("")}</ul>` : '<p class="muted">Nothing yet. Actions you take show up here.</p>'}</div>
    </div>
    <div class="stats">
      <div class="stat"><small>All-time dates</small><b>${S.totals.bookings || 0}</b></div>
      <div class="stat"><small>All-time ticket sales</small><b>${money(S.totals.gross || 0)}</b></div>
      <div class="stat"><small>All-time fees</small><b>${money(S.totals.fees || 0)}</b></div>
      <div class="stat"><small>Members with a deposit</small><b>${S.members.filter(m => m.deposit?.status === "active").length}</b></div>
    </div>`;
}

function sVenues() {
  const tabs = [["pending", "Waiting for approval"], ["approved", "Approved"], ["paused", "Paused"], ["declined", "Declined"]];
  const list = S.venues.filter(v => v.status === S.vtab);
  const actions = v => ({
    pending: `<button class="btn sm ghost" data-va="declineVenue:${v.id}">Decline</button><button class="btn sm gold" data-va="approveVenue:${v.id}">Approve</button>`,
    approved: `<button class="btn sm" data-va="pauseVenue:${v.id}">Pause</button>`,
    paused: `<button class="btn sm gold" data-va="resumeVenue:${v.id}">Turn back on</button>`,
    declined: `<button class="btn sm" data-va="approveVenue:${v.id}">Approve anyway</button>`
  })[v.status];
  return `${head("Venues", "Restaurants, theaters and lounges that sell date tickets. Approve new ones after checking their licenses. Pausing hides all of a venue's tickets until you turn it back on.")}
    <div class="subtabs">${tabs.map(([k, l]) => `<button class="chip" data-vtab="${k}" aria-pressed="${S.vtab === k}">${l} · ${S.venues.filter(v => v.status === k).length}</button>`).join("")}</div>
    ${list.length ? tableWrap(["Venue", "Contact", S.vtab === "pending" ? "Documents" : S.vtab === "approved" ? "Payouts" : "Reason", S.vtab === "pending" ? "Applied" : "Joined", ""],
      list.map(v => `<tr><td><b>${esc(v.name)}</b><div class="muted" style="font-size:12px">${esc(v.type)} · ${esc(v.address || "")} ${esc(v.city || "")}</div></td>
      <td>${esc(v.contactName || "")}<div class="muted" style="font-size:12px">${esc(v.phone || "")} · ${esc(v.ownerEmail || "")}</div></td>
      <td>${S.vtab === "pending" ? ((v.docs || []).map(d => `<button class="btn sm ghost" data-doc="${esc(d.path)}">View ${esc(d.label)}</button>`).join(" ") || '<span class="pill rose">None uploaded</span>')
        : S.vtab === "approved" ? (v.payoutsEnabled ? '<span class="pill ok">Bank connected</span>' : '<span class="pill warn">No bank yet</span>')
        : esc(v.pausedReason || v.declinedReason || "")}</td>
      <td>${esc(ago(v.createdAt))}</td><td><div class="row-actions">${actions(v)}</div></td></tr>`).join("")) : empty("Nothing here", "No venues in this list right now.")}`;
}

function sTickets() {
  const now = new Date();
  return `${head("Tickets", "Every date package venues have listed. Hide one if it breaks the rules. The venue still sees it and can't un-hide it.")}
    ${S.tickets.length ? tableWrap(["Ticket", "Venue", "When", "Party", "Price", "Sold", "Status", ""], S.tickets.map(t => {
      const past = toDate(t.startsAt) < now;
      const st = t.adminHidden ? `<span class="pill rose">${t.hiddenReason === "venuePaused" ? "Venue paused" : "Hidden"}</span>` : past ? '<span class="pill gold">Ended</span>' : t.status === "paused" ? '<span class="pill warn">Paused by venue</span>' : '<span class="pill ok">For sale</span>';
      const a = t.adminHidden ? (t.hiddenReason === "admin" ? `<button class="btn sm gold" data-va="showTicket:${t.id}">Show</button>` : "") : past ? "" : `<button class="btn sm" data-va="hideTicket:${t.id}">Hide</button>`;
      return `<tr><td><span class="swatch-sm" style="background:${grad(t.hue ?? hueFrom(t.title))}"></span><b>${esc(t.title)}</b><div class="muted" style="font-size:12px">${esc(t.category)} · ${esc((t.items || []).join(" · "))}</div></td><td>${esc(t.venueName)}</td><td>${esc(fmtWhen(t.startsAt))}</td><td class="num">${t.size}</td><td class="num">${money(t.price)}</td><td class="num">${t.sold} / ${t.quantity}</td><td>${st}</td><td><div class="row-actions">${a}</div></td></tr>`;
    }).join("")) : empty("No tickets yet", "Tickets show up here when venues publish them.")}`;
}

function sMembers() {
  const q = S.userQ.toLowerCase();
  const tabs = [["all", "Everyone"], ["nodeposit", "No deposit"], ["strikes", "Strikes & breaks"], ["reported", "Reported"], ...(S.settings.requireIdVerify ? [["review", "ID to review"]] : [])];
  const list = S.members.filter(m => MEMBER_FILTERS[S.mtab](m) && (!q || (m.name || "").toLowerCase().includes(q))).slice(0, 200);
  return `${head("Members", `People who set up Dates. Each keeps a ${money(S.settings.depositCents)} deposit; missing or cancelling a date costs it. ${S.settings.strikesForSuspension} missed dates = a ${S.settings.suspensionDays}-day break.`, searchBox("userQ", S.userQ, "Search by name"))}
    <div class="subtabs">${tabs.map(([k, l]) => `<button class="chip" data-mtab="${k}" aria-pressed="${S.mtab === k}">${l} · ${S.members.filter(MEMBER_FILTERS[k]).length}</button>`).join("")}</div>
    ${list.length ? tableWrap(["Member", "Deposit", "Missed dates", "Status", S.settings.requireIdVerify ? "Photo ID" : "Joined", ""], list.map(m => {
      const dep = m.deposit?.status === "active" ? `<span class="pill ok">${money(m.deposit.amount)} on file</span>` : m.deposit?.status === "forfeited" ? '<span class="pill rose">Kept</span>' : '<span class="pill warn">None</span>';
      const status = isSuspended(m) ? `<span class="pill rose" title="${esc(m.suspendedReason || "")}">Break until ${esc(fmtWhen(m.suspendedUntil).split(" · ")[0])}</span>` : '<span class="pill ok">Active</span>';
      const id = m.verified ? '<span class="pill ok">Verified</span>' : m.idUploaded ? `<button class="btn sm gold" data-viewid="${m.id}">Review ID</button>` : '<span class="pill warn">Not uploaded</span>';
      const actions = [
        isSuspended(m) || m.strikes ? `<button class="btn sm gold" data-va="unsuspendMember:${m.id}">Clear strikes${isSuspended(m) ? " & break" : ""}</button>` : `<button class="btn sm ghost" data-va="suspendMember:${m.id}">Block from Dates</button>`,
        m.deposit?.status === "active" ? `<button class="btn sm ghost" data-va="refundDeposit:${m.id}">Refund deposit</button>` : ""
      ].join("");
      return `<tr><td><span class="who-cell">${avatar({ ...m, photoURL: m.photo }, "sm")}<span><b>${esc(m.name)}</b><small>${ageFrom(m.birthYear)} · ${m.reportsCount ? `<span style="color:var(--rose)">${m.reportsCount} report${m.reportsCount > 1 ? "s" : ""}</span>` : "no reports"}</small></span></span></td>
        <td>${dep}</td><td class="num">${m.strikes || 0} / ${S.settings.strikesForSuspension}</td><td>${status}</td><td>${S.settings.requireIdVerify ? id : esc(ago(m.createdAt))}</td><td><div class="row-actions">${actions}</div></td></tr>`;
    }).join("")) : empty("No one matches", "Try a different search or list.")}`;
}

function sDates() {
  const tabs = [["all", "All"], ["forming", "Filling up"], ["confirmed", "Booked"], ["completed", "Done"], ["canceled", "Canceled"]];
  const list = S.dates.filter(d => (d.live || d.status !== "forming") && (S.dtab === "all" || d.status === S.dtab));
  const pill = { forming: ["warn", "Filling up"], confirmed: ["ok", "Booked"], completed: ["gold", "Done"], canceled: ["rose", "Canceled"] };
  return `${head("Dates", `Every date. Split dates hold cards until everyone pays (${S.settings.splitWindowHours}h max), then charge everyone at once. Venues are paid after the date. Cancel a date only if the venue can't host it: everyone is refunded and nobody is penalized.`)}
    <div class="subtabs">${tabs.map(([k, l]) => `<button class="chip" data-dtab="${k}" aria-pressed="${S.dtab === k}">${l}</button>`).join("")}</div>
    ${list.length ? tableWrap(["Date", "Host & guests", "Payment", "Total", "Status", ""], list.map(d => {
      const [c, l] = pill[d.status] || ["gold", d.status];
      const people = (d.seats || []).map(x => x.uid ? `${esc(x.name)} <span class="muted" style="font-size:11px">(${x.status}${x.checkedInAt ? ", here" : ""})</span>` : '<span class="muted">open</span>').join(", ");
      const flags = [d.noShowUids?.length ? `${d.noShowUids.length} no-show` : "", d.stoodUp ? "late cancel" : "", d.rescheduled ? "rescheduled" : ""].filter(Boolean).join(" · ");
      return `<tr><td><b>${esc(d.title)}</b><div class="muted" style="font-size:12px">${esc(d.venueName)} · ${esc(fmtWhen(d.startsAt))}</div></td><td style="max-width:320px">${people}</td><td>${d.mode === "split" ? "Split" : "Paid in full"}</td><td class="num">${money(d.total)}</td>
      <td><span class="pill ${c}">${l}</span>${d.status === "forming" ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(timeLeft(d.expiresAt))}</div>` : ""}${flags ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(flags)}</div>` : ""}</td>
      <td><div class="row-actions">${["forming", "confirmed"].includes(d.status) ? `<button class="btn sm ghost" data-va="cancelDate:${d.id}">Cancel & refund</button>` : ""}</div></td></tr>`;
    }).join("")) : empty("No dates here", "Dates in this list show up here.")}`;
}

function sReports() {
  const list = S.reports.filter(r => S.rtab === "open" ? r.status === "open" : r.status !== "open");
  const card = r => {
    const isV = r.aboutType === "venue";
    const subj = isV ? { name: venueName(r.about) } : (S.members.find(u => u.id === r.about) || { name: "Member" });
    return `<div class="report ${r.status !== "open" ? "closed" : ""}">${avatar({ ...subj, photoURL: subj.photo }, "md")}<div><b>${esc(r.reason)}</b> · <span class="muted" style="font-size:13px">about ${esc(subj.name)}${isV ? " (venue)" : ""} · from ${esc(memberName(r.by))} · ${esc(ago(r.createdAt))}</span>${r.detail ? `<p>“${esc(r.detail)}”</p>` : ""}</div>
    <div class="row-actions">${r.status === "open" ? `<button class="btn sm ghost" data-rr="dismiss:${r.id}">Dismiss</button>${isV ? "" : `<button class="btn sm" data-rr="warn:${r.id}">Send warning</button>`}<button class="btn sm gold" data-rr="suspend:${r.id}">${isV ? "Pause venue" : "Block from Dates"}</button>` : `<span class="pill ${r.status === "Dismissed" ? "gold" : "ok"}">${esc(r.status)}</span>`}</div></div>`;
  };
  return `${head("Reports", "Problems members reported about a date. No-shows are handled automatically from door check-ins, so these are mostly about behavior and venues.")}
    <div class="subtabs"><button class="chip" data-rtab="open" aria-pressed="${S.rtab === "open"}">Open · ${S.reports.filter(r => r.status === "open").length}</button><button class="chip" data-rtab="done" aria-pressed="${S.rtab === "done"}">Handled</button></div>
    ${list.length ? `<div class="stubs">${list.map(card).join("")}</div>` : empty(S.rtab === "open" ? "No open reports" : "Nothing handled yet", S.rtab === "open" ? "You're all caught up." : "Reports you resolve show up here.")}`;
}

function sMoney() {
  const kept = S.ledger.filter(l => l.kind === "depositForfeited");
  const rewards = S.ledger.filter(l => l.kind === "reward");
  const keptSum = kept.reduce((a, l) => a + (l.amount || 0), 0);
  const coins = rewards.reduce((a, l) => a + (l.coins || 0), 0);
  const label = { depositPaid: "Deposit paid", depositForfeited: "Deposit kept", depositRefunded: "Deposit refunded", reward: "Stood-up coins" };
  return `${head("Deposits & coins", `Every deposit paid, kept or refunded, and every stood-up reward. Each reward coin can turn into a $2 creator payout when spent on calls, so ${S.settings.stoodUpRewardCoins} coins can cost up to ${money(S.settings.stoodUpRewardCoins * 200)} against a ${money(S.settings.depositCents)} deposit kept.`)}
    <div class="stats">
      <div class="stat"><small>Deposits kept (recent)</small><b>${money(keptSum)}</b></div>
      <div class="stat"><small>Reward coins given (recent)</small><b>${coins}</b></div>
      <div class="stat"><small>Most a reward can cost you</small><b>${money(coins * 200)}</b></div>
      <div class="stat"><small>Net (kept − max reward cost)</small><b style="color:${keptSum - coins * 200 < 0 ? "var(--rose)" : "var(--ok)"}">${money(keptSum - coins * 200)}</b></div>
    </div>
    ${S.ledger.length ? tableWrap(["What", "Member", "Amount", "Why", "When"], S.ledger.slice(0, 150).map(l => `<tr><td>${label[l.kind] || esc(l.kind)}</td><td>${esc(memberName(l.uid))}</td><td class="num">${l.coins ? l.coins + " coins" : money(l.amount)}</td><td>${esc(l.reason || "")}</td><td>${esc(ago(l.at))}</td></tr>`).join("")) : empty("Nothing yet", "Deposits and rewards show up here.")}`;
}

function sPayouts() {
  const due = {};
  S.payouts.filter(p => p.status === "due").forEach(p => { (due[p.venueId] ||= { amount: 0, n: 0 }); due[p.venueId].amount += p.amount; due[p.venueId].n++; });
  const rows = Object.entries(due), total = rows.reduce((a, [, d]) => a + d.amount, 0);
  const paid = S.payouts.filter(p => p.status === "paid").slice(0, 50);
  return `${head("Payouts", `What you owe each venue for dates that already happened, after your ${S.settings.fee}% fee. "Pay with Stripe" sends it to the bank they connected. Use "Mark paid" only if you paid them another way.`, `<div class="stat" style="padding:10px 16px"><small>Total due</small><b style="font-size:26px">${money(total)}</b></div>`)}
    ${rows.length ? tableWrap(["Venue", "Dates", "Amount owed", "Bank", ""], rows.map(([vid, d]) => {
      const v = S.venues.find(x => x.id === vid) || {};
      return `<tr><td><b>${esc(v.name || "Venue")}</b></td><td class="num">${d.n}</td><td class="num"><b>${money(d.amount)}</b></td><td>${v.payoutsEnabled ? '<span class="pill ok">Connected</span>' : '<span class="pill warn">Not connected</span>'}</td>
      <td><div class="row-actions"><button class="btn sm ghost" data-pv="markVenuePaid:${vid}">Mark paid</button>${v.payoutsEnabled ? `<button class="btn sm gold" data-pv="payVenue:${vid}">Pay with Stripe</button>` : ""}</div></td></tr>`;
    }).join("")) : empty("Nothing due", "Every venue is paid up.")}
    ${paid.length ? `<div class="section-title"><h2 style="font-size:22px">Recently paid</h2></div>${tableWrap(["Venue", "Amount", "How", "When"], paid.map(p => `<tr><td>${esc(p.venueName || venueName(p.venueId))}</td><td class="num">${money(p.amount)}</td><td>${p.method === "stripe" ? "Stripe" : "Manual"}</td><td>${esc(ago(p.paidAt))}</td></tr>`).join(""))}` : ""}`;
}

function sSettings() {
  const s = S.settings;
  const sw = (k, b, sm) => `<div class="set-row"><div><b>${b}</b><small>${sm}</small></div><button type="button" class="switch" role="switch" aria-checked="${!!s[k]}" data-sw="${k}" aria-label="${esc(b)}"></button></div>`;
  const num = (id, val, b, sm, unit, min, max, step = 1) => `<div class="set-row"><div><b>${b}</b><small>${sm}</small></div><label style="display:flex;align-items:center;gap:6px">${unit === "$" ? "$" : ""}<input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${val}"> ${unit === "$" ? "" : unit}</label></div>`;
  return `${head("Settings", "The Dates rules. Members see these numbers in the app, including in the warning before they cancel. Changes apply as soon as you save.")}
    <form class="panel settings" id="settingsForm">
      ${num("s-deposit", s.depositCents / 100, "Date deposit", "Kept on each member's account; lost when they cancel or miss a date", "$", 1, 50)}
      ${num("s-reward", s.stoodUpRewardCoins, "Stood-up reward", "Whisper coins for someone who was stood up and checked in at the venue", "coins", 0, 20)}
      ${num("s-strikes", s.strikesForSuspension, "Missed dates before a break", "Late cancels and no-shows both count", "", 1, 10)}
      ${num("s-days", s.suspensionDays, "Length of the break", "How long they can't book, accept or request", "days", 1, 90)}
      ${num("s-late", s.lateCancelHours, "Late-cancel window", "Cancelling inside this counts as a missed date", "hrs", 1, 168)}
      ${num("s-resched", s.rescheduleCutoffHours, "Reschedule cutoff", "Rescheduling closes this long before the date", "hrs", 1, 168)}
      ${num("s-window", s.splitWindowHours, "Time to fill a split", "Cards stay on hold this long; if not everyone pays, nobody is charged", "hrs", 1, 72)}
      ${num("s-fee", s.fee, "Platform fee", "Your cut of each ticket, taken from the venue payout", "%", 0, 50)}
      ${num("s-age", s.minAge, "Minimum age", "Members confirm their birth year when they set up Dates", "years", 18, 25)}
      ${sw("openRequests", "Allow \"find me a date\"", "Members can let others ask to join, and the host picks")}
      ${sw("requireIdVerify", "Require photo ID", "Members upload an ID and you approve it before their first date")}
      ${sw("autoApproveVenues", "Auto-approve venues", "Skip manual review when a venue uploads its license")}
      <div style="display:flex;justify-content:flex-end;padding-top:16px"><button class="btn gold" type="submit">Save settings</button></div>
    </form>`;
}

const SECTIONS = { overview: ["Overview", sOverview], venues: ["Venues", sVenues], tickets: ["Tickets", sTickets], members: ["Members", sMembers], dates: ["Dates", sDates], reports: ["Reports", sReports], money: ["Deposits & coins", sMoney], payouts: ["Payouts", sPayouts], settings: ["Settings", sSettings] };
function render(keep) {
  if (!auth.currentUser) return;
  const y = window.scrollY, c = counts();
  $("#app").innerHTML = `<section class="view">
    <div class="view-head"><div><div class="eyebrow">Admin · ${esc(BRAND.name)}</div><h1 class="display" style="margin-top:10px">Control room</h1></div></div>
    <div class="admin"><nav class="amenu" aria-label="Admin sections">${Object.entries(SECTIONS).map(([k, [l]]) => `<button data-tab="${k}" aria-current="${S.tab === k}">${l}${c[k] ? `<span class="badge">${c[k]}</span>` : ""}</button>`).join("")}</nav>
    <div class="amain">${SECTIONS[S.tab][1]()}</div></div>
  </section>`;
  if (keep) window.scrollTo(0, y);
}

/* ================= events ================= */
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-tab],[data-vtab],[data-dtab],[data-mtab],[data-rtab],[data-va],[data-rr],[data-pv],[data-doc],[data-viewid],[data-sw]");
  if (!el) return;
  const d = el.dataset;
  if (d.tab) { S.tab = d.tab; render(); window.scrollTo(0, 0); return; }
  if (d.vtab) { S.vtab = d.vtab; return render(true); }
  if (d.dtab) { S.dtab = d.dtab; return render(true); }
  if (d.mtab) { S.mtab = d.mtab; return render(true); }
  if (d.rtab) { S.rtab = d.rtab; return render(true); }
  if (d.sw) { S.settings[d.sw] = !S.settings[d.sw]; el.setAttribute("aria-checked", S.settings[d.sw]); return; }
  if (d.va) {
    const [action, id] = d.va.split(":");
    let reason = "";
    const ask = async o => { reason = await askReason(o); return reason !== null; };
    if (action === "pauseVenue" && !(await ask({ title: "Pause this venue?", body: "All its tickets are hidden until you turn it back on. Existing dates aren't canceled.", yes: "Pause venue", placeholder: "e.g. Canceled 3 dates last minute" }))) return;
    if (action === "declineVenue" && !(await ask({ title: "Decline this venue?", body: "The owner sees this reason.", yes: "Decline", placeholder: "e.g. Liquor license is missing" }))) return;
    if (action === "suspendMember" && !(await ask({ title: `Block ${memberName(id)} from Dates?`, body: "They can still use the rest of Whisper+me.", yes: "Block", placeholder: "e.g. Asked a date for money" }))) return;
    if (action === "cancelDate" && !(await ask({ title: "Cancel and refund this date?", body: "Use this when the venue can't host it. Card holds are released, payments are refunded, the venue isn't paid, and nobody loses a deposit or gets a strike.", yes: "Cancel & refund", placeholder: "e.g. Venue closed for a private event" }))) return;
    if (action === "refundDeposit" && !(await confirmSheet({ title: `Refund ${memberName(id)}'s deposit?`, body: "Do this when someone in good standing asks to close out. They'll need a new deposit to date again.", yes: "Refund deposit" }))) return;
    if (action === "hideTicket" && !(await confirmSheet({ title: "Hide this ticket?", body: "Members won't see it. Existing dates stay as they are.", yes: "Hide" }))) return;
    return act(action, { id, reason }, el.closest("[data-va]"));
  }
  if (d.rr) {
    const [decision, id] = d.rr.split(":");
    const r = S.reports.find(x => x.id === id);
    let message = "";
    if (decision === "warn") { message = await askReason({ title: "Send a warning", body: "They get this as a notification.", label: "Message", yes: "Send warning", placeholder: "We got a report about your date. Please follow the community rules." }); if (message === null) return; }
    if (decision === "suspend" && !(await confirmSheet({ title: r.aboutType === "venue" ? "Pause this venue?" : "Block from Dates?", body: r.aboutType === "venue" ? "All its tickets are hidden until you turn it back on." : "They can't book or join dates until you clear it in Members.", yes: r.aboutType === "venue" ? "Pause venue" : "Block", danger: true }))) return;
    return act("resolveReport", { id, data: { decision, message } }, el);
  }
  if (d.pv) {
    const [action, vid] = d.pv.split(":");
    const ok = await confirmSheet(action === "payVenue"
      ? { title: `Pay ${venueName(vid)}?`, body: "This sends the money from your Stripe balance to their bank. It can't be undone here.", yes: "Send payment" }
      : { title: `Mark ${venueName(vid)} as paid?`, body: "Only do this if you already paid them another way.", yes: "Mark paid" });
    if (ok) act(action, { id: vid }, el);
    return;
  }
  if (d.doc) { try { window.open(await getDownloadURL(sref(storage, d.doc)), "_blank", "noopener"); } catch (x) { toast(x.message); } return; }
  if (d.viewid) return reviewId(d.viewid);
});

async function reviewId(uid) {
  const u = S.members.find(x => x.id === uid);
  const sheet = openSheet(`<div class="sheet-body"><div style="display:flex;gap:12px;align-items:center">${avatar({ ...u, photoURL: u.photo }, "lg")}<div><div class="eyebrow">Review photo ID</div><h3 class="display" style="font-size:30px">${esc(u.name)}, ${ageFrom(u.birthYear)}</h3></div></div>
    <p class="muted" style="margin:0">Check the birth year matches (${u.birthYear}) and the ID isn't expired.</p>
    <div id="idFiles" class="loading"><div class="spinner"></div></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button class="btn ghost" data-idact="rejectId">Ask for a new ID</button><button class="btn gold" data-idact="verifyMember">Approve ID</button></div></div>`, "Review ID");
  try {
    const files = (await listAll(sref(storage, `nights/ids/${uid}`))).items.slice(-3);
    const urls = await Promise.all(files.map(f => getDownloadURL(f)));
    $("#idFiles").outerHTML = urls.length ? `<div style="display:grid;gap:10px">${urls.map(url => `<img src="${esc(url)}" alt="Uploaded ID" style="border-radius:12px;border:1px solid var(--line)" onerror="this.outerHTML='<a class=&quot;btn&quot; href=&quot;${esc(url)}&quot; target=&quot;_blank&quot;>Open file</a>'">`).join("")}</div>` : `<p class="muted">No ID file found.</p>`;
  } catch (x) { $("#idFiles").outerHTML = `<p class="muted">Couldn't load the ID: ${esc(x.message)}</p>`; }
  sheet.addEventListener("click", async e => {
    const b = e.target.closest("[data-idact]"); if (!b) return;
    if (await act(b.dataset.idact, { id: uid }, b)) closeSheet();
  });
}

document.addEventListener("input", e => {
  if (e.target.id === "userQ") {
    S.userQ = e.target.value; const pos = e.target.selectionStart; render(true);
    const q = $("#userQ"); q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {}
  }
});
document.addEventListener("submit", async e => {
  if (e.target.id !== "settingsForm") return;
  e.preventDefault();
  const s = S.settings, v = id => +$(id).value;
  await act("saveSettings", { data: {
    depositCents: Math.round(v("#s-deposit") * 100), stoodUpRewardCoins: v("#s-reward"), strikesForSuspension: v("#s-strikes"), suspensionDays: v("#s-days"),
    lateCancelHours: v("#s-late"), rescheduleCutoffHours: v("#s-resched"), splitWindowHours: v("#s-window"), fee: v("#s-fee"), minAge: v("#s-age"),
    requireIdVerify: !!s.requireIdVerify, openRequests: !!s.openRequests, autoApproveVenues: !!s.autoApproveVenues
  } }, e.submitter);
});
