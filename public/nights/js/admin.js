// ConnectUs — admin control room
// Every change goes through the adminAction Cloud Function, which checks the admin
// claim and writes an entry to the admin log.
import {
  collection, doc, query, where, orderBy, limit, onSnapshot, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref as sref, listAll, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  BRAND, auth, db, storage, call, authApi, $, esc, money, toDate, fmtWhen, ago, timeLeft, hueFrom, grad, avatar, ageFrom,
  applyBrand, toast, openSheet, closeSheet, busy, confirmSheet, renderSimpleAuth, isAdminToken
} from "./common.js";

applyBrand("Admin");

const S = {
  tab: "overview", vtab: "pending", btab: "all", mtab: "all", userQ: "", rtab: "open",
  settings: {}, venues: [], tickets: [], users: [], bookings: [], reports: [], payouts: [], log: [], days: [], totals: {}
};
let unsubs = [];
const stop = () => { unsubs.forEach(u => u()); unsubs = []; };
const userName = uid => S.users.find(u => u.id === uid)?.name || "Member";
const venueName = vid => S.venues.find(v => v.id === vid)?.name || "Venue";
const DEFAULTS = { fee: 10, splitWindowHours: 24, minAge: 21, requireIdVerify: true, openSeats: true, chatFilter: true, autoApproveVenues: false };

authApi.onChange(async rawUser => {
  const user = rawUser && !rawUser.isAnonymous ? rawUser : null; // Whisper+me guests need a real account here
  stop();
  $("#meWrap").innerHTML = user ? `<a class="btn sm ghost" href="/nights/">Nights site</a> <a class="btn sm ghost" href="/admin.html">Whisper+me admin</a> <button class="btn sm ghost" id="signOut">Sign out</button>` : "";
  if (!user) return renderSimpleAuth($("#app"), { eyebrow: `${BRAND.name} admin`, title: "Control room" });
  $("#signOut").onclick = () => authApi.signOut();
  const token = await user.getIdTokenResult(true);
  if (!isAdminToken(token)) {
    $("#app").innerHTML = `<div class="empty" style="margin-top:var(--s-5)"><h3>This account isn't an admin</h3><p style="max-width:56ch">Signed in as ${esc(user.email || user.uid)}. Sign in with the Whisper+me admin account to manage Nights.</p></div>`;
    return;
  }
  const live = (q, key, map = d => ({ id: d.id, ...d.data() })) => unsubs.push(onSnapshot(q, s => { S[key] = s.docs.map(map); render(true); }, e => console.warn(key, e.message)));
  unsubs.push(onSnapshot(doc(db, "settings", "platform"), s => { S.settings = { ...DEFAULTS, ...(s.exists() ? s.data() : {}) }; render(true); }));
  live(query(collection(db, "venues"), orderBy("createdAt", "desc"), limit(300)), "venues");
  live(query(collection(db, "tickets"), orderBy("startsAt", "desc"), limit(300)), "tickets");
  live(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(1000)), "users");
  live(query(collection(db, "bookings"), orderBy("createdAt", "desc"), limit(300)), "bookings");
  live(query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(200)), "reports");
  live(query(collection(db, "payouts"), orderBy("createdAt", "desc"), limit(500)), "payouts");
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
function askReason({ title, body, label = "Reason", yes, placeholder = "", required = true }) {
  return new Promise(resolve => {
    openSheet(`<form class="sheet-body" id="reasonForm"><h3 class="display" style="font-size:30px">${esc(title)}</h3>${body ? `<p class="muted" style="margin:0">${body}</p>` : ""}
      <div class="field"><label for="reason">${esc(label)}</label><textarea id="reason" maxlength="300" placeholder="${esc(placeholder)}"></textarea></div>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn ghost" data-sheet-close>Cancel</button><button class="btn gold" type="submit">${esc(yes)}</button></div></form>`, title);
    const form = $("#reasonForm");
    form.onsubmit = e => { e.preventDefault(); const v = $("#reason").value.trim(); if (required && !v) { $("#reason").focus(); return; } closeSheet(); resolve(v); };
    form.addEventListener("click", e => { if (e.target.closest("[data-sheet-close]")) resolve(null); });
  });
}
const head = (title, help, right = "") => `<div class="ahead"><div><h2>${title}</h2><p>${help}</p></div>${right}</div>`;
const empty = (t, p) => `<div class="empty"><h3>${t}</h3><p>${p}</p></div>`;
const tableWrap = (cols, rows) => `<div class="table-wrap"><table><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
const searchBox = (id, val, ph) => `<label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="${id}" type="search" placeholder="${esc(ph)}" value="${esc(val)}" aria-label="${esc(ph)}"></label>`;

function counts() {
  return {
    venues: S.venues.filter(v => v.status === "pending").length,
    members: S.users.filter(u => u.idUploaded && !u.verified && u.status === "active").length,
    reports: S.reports.filter(r => r.status === "open").length,
    bookings: S.bookings.filter(b => b.status === "awaiting").length,
    payouts: new Set(S.payouts.filter(p => p.status === "due").map(p => p.venueId)).size
  };
}

/* ================= sections ================= */
function sOverview() {
  const c = counts();
  const weekAgo = Date.now() - 7 * 86400000;
  const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 86400000); return d.toISOString().slice(0, 10); });
  const byDay = Object.fromEntries(S.days.map(d => [d.day, d]));
  const vals = days.map(d => byDay[d]?.bookings || 0);
  const week = days.reduce((a, d) => ({ b: a.b + (byDay[d]?.bookings || 0), g: a.g + (byDay[d]?.gross || 0), f: a.f + (byDay[d]?.fees || 0) }), { b: 0, g: 0, f: 0 });
  const newMembers = S.users.filter(u => toDate(u.createdAt)?.getTime() > weekAgo).length;
  // chart
  const W = 600, H = 230, pl = 34, pr = 10, pt = 22, pb = 30;
  const top = Math.max(4, Math.ceil(Math.max(...vals) * 1.15 / 4) * 4);
  const y = v => pt + (H - pt - pb) * (1 - v / top);
  const bw = (W - pl - pr) / 7;
  const ticks = [0, top / 4, top / 2, top * 3 / 4, top];
  const grid = ticks.map(g => `<line x1="${pl}" x2="${W - pr}" y1="${y(g)}" y2="${y(g)}" stroke="var(--line)"/><text x="${pl - 8}" y="${y(g) + 4}" text-anchor="end" font-size="11" fill="var(--dim)" font-family="DM Mono, monospace">${g}</text>`).join("");
  const peak = Math.max(...vals);
  const bars = vals.map((v, i) => {
    const x = pl + i * bw + bw * .2, w = bw * .6, t = y(v), hi = v === peak && v > 0;
    const label = new Date(days[i] + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
    return `<rect x="${x}" y="${t}" width="${w}" height="${Math.max(0, y(0) - t)}" rx="4" fill="${hi ? "var(--gold)" : "rgba(214,177,107,.35)"}"/><text x="${x + w / 2}" y="${t - 6}" text-anchor="middle" font-size="11" fill="${hi ? "var(--gold)" : "var(--muted)"}" font-family="DM Mono, monospace">${v}</text><text x="${x + w / 2}" y="${H - 10}" text-anchor="middle" font-size="11.5" fill="var(--muted)">${label}</text>`;
  }).join("");
  const attn = [
    ["venues", c.venues, "Venues waiting for approval", "Check their licenses and approve"],
    ["members", c.members, "IDs to review", "Members can't book until their ID is approved"],
    ["reports", c.reports, "Open reports", "Members or venues flagged for review"],
    ["bookings", c.bookings, "Split tickets not fully paid", "Seats release automatically if unpaid"],
    ["payouts", c.payouts, "Venues to pay", "Money owed from confirmed bookings"]
  ];
  const topVenues = S.venues.filter(v => v.status === "approved").sort((a, b) => (b.sales || 0) - (a.sales || 0)).slice(0, 5);
  const hour = new Date().getHours();
  return `${head(`Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}`, `Everything on ${esc(BRAND.name)} at a glance. Anything that needs you shows up first. Tap a card to go there.`)}
    <div class="attn">${attn.map(([tab, n, b, s]) => `<button class="attn-item" data-tab="${tab}"><span class="n ${n ? "hot" : "calm"}">${n}</span><span><b>${b}</b><small>${n ? s : "All clear"}</small></span><span class="go">→</span></button>`).join("")}</div>
    <div class="stats">
      <div class="stat"><small>Bookings, last 7 days</small><b>${week.b}</b></div>
      <div class="stat"><small>Ticket sales, last 7 days</small><b>${money(week.g)}</b></div>
      <div class="stat"><small>Your earnings, last 7 days</small><b>${money(week.f)}</b></div>
      <div class="stat"><small>New members, last 7 days</small><b>${newMembers}</b></div>
    </div>
    <div class="two">
      <div class="panel"><div class="section-title"><h2 style="font-size:24px">Bookings by day</h2><span class="muted" style="font-size:13px">Confirmed bookings, last 7 days</span></div><div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Confirmed bookings per day: ${vals.join(", ")}">${grid}${bars}</svg></div></div>
      <div class="panel"><h2 style="font-size:24px">Recent admin actions</h2>${S.log.length ? `<ul class="log">${S.log.slice(0, 7).map(l => `<li><span class="mono">${esc(ago(l.at))}</span><span>${esc(l.action.replace(/([A-Z])/g, " $1").toLowerCase())}${l.detail ? ": " + esc(l.detail) : ""}</span></li>`).join("")}</ul>` : '<p class="muted">Nothing yet. Actions you take show up here.</p>'}</div>
    </div>
    <div class="stats">
      <div class="stat"><small>All-time bookings</small><b>${S.totals.bookings || 0}</b></div>
      <div class="stat"><small>All-time ticket sales</small><b>${money(S.totals.gross || 0)}</b></div>
      <div class="stat"><small>All-time earnings</small><b>${money(S.totals.fees || 0)}</b></div>
      <div class="stat"><small>Members</small><b>${S.users.length}</b></div>
    </div>
    <div class="section-title"><h2>Top venues</h2><button class="btn sm" data-tab="venues">All venues</button></div>
    ${topVenues.length ? tableWrap(["Venue", "Type", "City", "Live tickets", "Sales to date"], topVenues.map(v => `<tr><td><b>${esc(v.name)}</b></td><td>${esc(v.type)}</td><td>${esc(v.city)}</td><td class="num">${S.tickets.filter(t => t.venueId === v.id && t.status === "live" && !t.adminHidden && toDate(t.startsAt) > new Date()).length}</td><td class="num">${money(v.sales || 0)}</td></tr>`).join("")) : empty("No venues yet", "Approved venues show up here.")}`;
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
  return `${head("Venues", "Restaurants, theaters and lounges that sell tickets. Approve new ones after checking their licenses. Pausing hides all of a venue's tickets until you turn it back on.")}
    <div class="subtabs">${tabs.map(([k, l]) => `<button class="chip" data-vtab="${k}" aria-pressed="${S.vtab === k}">${l} · ${S.venues.filter(v => v.status === k).length}</button>`).join("")}</div>
    ${list.length ? tableWrap(["Venue", "Contact", S.vtab === "pending" ? "Documents" : S.vtab === "approved" ? "Sales · payouts" : "Reason", S.vtab === "pending" ? "Applied" : "Joined", ""],
      list.map(v => `<tr><td><b>${esc(v.name)}</b><div class="muted" style="font-size:12px">${esc(v.type)} · ${esc(v.address || "")} ${esc(v.city || "")}</div></td>
      <td>${esc(v.contactName || "")}<div class="muted" style="font-size:12px">${esc(v.phone || "")} · ${esc(v.ownerEmail || "")}</div></td>
      <td>${S.vtab === "pending" ? ((v.docs || []).map(d => `<button class="btn sm ghost" data-doc="${esc(d.path)}">View ${esc(d.label)}</button>`).join(" ") || '<span class="pill rose">None uploaded</span>')
        : S.vtab === "approved" ? `<span class="mono">${money(v.sales || 0)}</span> · ${v.payoutsEnabled ? '<span class="pill ok">Bank connected</span>' : '<span class="pill warn">No bank yet</span>'}`
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
      return `<tr><td><span class="swatch-sm" style="background:${grad(t.hue ?? hueFrom(t.title))}"></span><b>${esc(t.title)}</b><div class="muted" style="font-size:12px">${esc((t.items || []).join(" · "))}</div></td><td>${esc(t.venueName)}</td><td>${esc(fmtWhen(t.startsAt))}</td><td class="num">${t.size}</td><td class="num">${money(t.price)}</td><td class="num">${t.sold} / ${t.quantity}</td><td>${st}</td><td><div class="row-actions">${a}</div></td></tr>`;
    }).join("")) : empty("No tickets yet", "Tickets show up here when venues publish them.")}`;
}

function sMembers() {
  const q = S.userQ.toLowerCase();
  const tabs = [["all", "Everyone"], ["review", "ID to review"], ["reported", "Reported"], ["suspended", "Suspended"]];
  const filt = { all: () => true, review: u => u.idUploaded && !u.verified, reported: u => (u.reportsCount || 0) > 0, suspended: u => u.status === "suspended" }[S.mtab];
  const list = S.users.filter(u => filt(u) && (!q || (u.name || "").toLowerCase().includes(q) || (u.city || "").toLowerCase().includes(q))).slice(0, 200);
  return `${head("Members", "People who book nights out. Members must have their photo ID approved before booking. Suspended members can't sign in.", searchBox("userQ", S.userQ, "Search by name or city"))}
    <div class="subtabs">${tabs.map(([k, l]) => `<button class="chip" data-mtab="${k}" aria-pressed="${S.mtab === k}">${l} · ${S.users.filter({ all: () => true, review: u => u.idUploaded && !u.verified, reported: u => (u.reportsCount || 0) > 0, suspended: u => u.status === "suspended" }[k]).length}</button>`).join("")}</div>
    ${list.length ? tableWrap(["Member", "Joined", "Photo ID", "Nights", "Reports", "Status", ""], list.map(u => {
      const id = u.verified ? '<span class="pill ok">Verified</span>' : u.idUploaded ? `<button class="btn sm gold" data-viewid="${u.id}">Review ID</button>` : '<span class="pill warn">Not uploaded</span>';
      return `<tr><td><span class="who-cell">${avatar(u, "sm")}<span><b>${esc(u.name)}</b><small>${ageFrom(u.birthYear)} · ${esc(u.city || "")}</small></span></span></td><td>${esc(ago(u.createdAt))}</td><td>${id}</td><td class="num">${u.bookingsCount || 0}</td><td class="num" style="${u.reportsCount ? "color:var(--rose)" : ""}">${u.reportsCount || 0}</td>
      <td>${u.status === "active" ? '<span class="pill ok">Active</span>' : `<span class="pill rose" title="${esc(u.suspendedReason || "")}">Suspended</span>`}</td>
      <td><div class="row-actions">${u.status === "active" ? `<button class="btn sm ghost" data-va="suspendUser:${u.id}">Suspend</button>` : `<button class="btn sm gold" data-va="restoreUser:${u.id}">Restore</button>`}</div></td></tr>`;
    }).join("")) : empty("No one matches", "Try a different search or list.")}`;
}

function sBookings() {
  const tabs = [["all", "All"], ["awaiting", "Waiting on payment"], ["confirmed", "Confirmed"], ["canceled", "Canceled & refunded"]];
  const list = S.bookings.filter(b => S.btab === "all" || b.status === S.btab || (S.btab === "canceled" && b.status === "refunded"));
  const pill = { payment: ["warn", "At checkout"], awaiting: ["warn", "Waiting on payment"], confirmed: ["ok", "Confirmed"], canceled: ["rose", "Canceled"], refunded: ["rose", "Refunded"] };
  return `${head("Bookings", `Every reservation. A split ticket is confirmed once every seat is paid. Unpaid seats are released after ${S.settings.splitWindowHours} hours and everyone who paid is refunded automatically.`)}
    <div class="subtabs">${tabs.map(([k, l]) => `<button class="chip" data-btab="${k}" aria-pressed="${S.btab === k}">${l}</button>`).join("")}</div>
    ${list.length ? tableWrap(["Code", "Ticket", "Booked by", "Payment", "Paid", "Total", "Status", ""], list.map(b => {
      const [c, l] = pill[b.status] || ["gold", b.status];
      const paid = b.seats.filter(x => x.status === "paid").length;
      const guests = b.seats.filter(x => x.uid && x.uid !== b.buyerUid).map(x => esc(userName(x.uid)));
      const open = b.seats.filter(x => x.status === "open").length;
      const a = b.status === "awaiting" ? `<button class="btn sm" data-va="remindBooking:${b.id}">Remind</button><button class="btn sm ghost" data-va="cancelBooking:${b.id}">Cancel</button>`
        : b.status === "confirmed" ? `<button class="btn sm ghost" data-va="cancelBooking:${b.id}">Refund</button>` : "";
      return `<tr><td class="num">${esc(b.code)}</td><td><b>${esc(b.title)}</b><div class="muted" style="font-size:12px">${esc(b.venueName)} · ${esc(fmtWhen(b.startsAt))}</div></td>
      <td>${esc(userName(b.buyerUid))}<div class="muted" style="font-size:12px">${guests.length ? "with " + guests.join(", ") : ""}${open ? ` · ${open} open` : ""}</div></td>
      <td>${b.mode === "split" ? "Split" : "Paid in full"}</td><td class="num">${paid} / ${b.size}</td><td class="num">${money(b.total)}</td>
      <td><span class="pill ${c}">${l}</span>${b.status === "awaiting" ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(timeLeft(b.expiresAt))}</div>` : ""}${b.checkedInAt ? '<div class="muted" style="font-size:12px;margin-top:4px">Checked in</div>' : ""}</td>
      <td><div class="row-actions">${a}</div></td></tr>`;
    }).join("")) : empty("No bookings here", "Bookings in this list show up here.")}`;
}

function sReports() {
  const list = S.reports.filter(r => S.rtab === "open" ? r.status === "open" : r.status !== "open");
  const card = r => {
    const isV = r.aboutType === "venue";
    const subj = isV ? { name: venueName(r.about), id: r.about } : (S.users.find(u => u.id === r.about) || { name: "Member", id: r.about });
    return `<div class="report ${r.status !== "open" ? "closed" : ""}">${avatar(subj, "md")}<div><b>${esc(r.reason)}</b> · <span class="muted" style="font-size:13px">about ${esc(subj.name)}${isV ? " (venue)" : ""}${!isV && subj.reportsCount > 1 ? ` · ${subj.reportsCount} reports total` : ""} · from ${esc(userName(r.by))} · ${esc(ago(r.createdAt))}</span>${r.detail ? `<p>“${esc(r.detail)}”</p>` : ""}</div>
    <div class="row-actions">${r.status === "open" ? `<button class="btn sm ghost" data-rr="dismiss:${r.id}">Dismiss</button>${isV ? "" : `<button class="btn sm" data-rr="warn:${r.id}">Send warning</button>`}<button class="btn sm gold" data-rr="suspend:${r.id}">${isV ? "Pause venue" : "Suspend"}</button>` : `<span class="pill ${r.status === "Dismissed" ? "gold" : "ok"}">${esc(r.status)}</span>`}</div></div>`;
  };
  return `${head("Reports", "When someone flags a member or venue it lands here. Read what happened, then dismiss it, send a warning the member sees next time they open the app, or suspend.")}
    <div class="subtabs"><button class="chip" data-rtab="open" aria-pressed="${S.rtab === "open"}">Open · ${S.reports.filter(r => r.status === "open").length}</button><button class="chip" data-rtab="done" aria-pressed="${S.rtab === "done"}">Handled</button></div>
    ${list.length ? `<div class="stubs">${list.map(card).join("")}</div>` : empty(S.rtab === "open" ? "No open reports" : "Nothing handled yet", S.rtab === "open" ? "You're all caught up." : "Reports you resolve show up here.")}`;
}

function sPayouts() {
  const due = {};
  S.payouts.filter(p => p.status === "due").forEach(p => { (due[p.venueId] ||= { amount: 0, n: 0 }); due[p.venueId].amount += p.amount; due[p.venueId].n++; });
  const dueRows = Object.entries(due);
  const total = dueRows.reduce((a, [, d]) => a + d.amount, 0);
  const paid = S.payouts.filter(p => p.status === "paid").slice(0, 50);
  return `${head("Payouts", `What you owe each venue for confirmed bookings, after your ${S.settings.fee}% fee. "Pay with Stripe" sends it to the bank they connected. Use "Mark paid" only if you paid them another way.`, `<div class="stat" style="padding:10px 16px"><small>Total due</small><b style="font-size:26px">${money(total)}</b></div>`)}
    ${dueRows.length ? tableWrap(["Venue", "Bookings", "Amount owed", "Bank", ""], dueRows.map(([vid, d]) => {
      const v = S.venues.find(x => x.id === vid) || {};
      return `<tr><td><b>${esc(v.name || "Venue")}</b></td><td class="num">${d.n}</td><td class="num"><b>${money(d.amount)}</b></td><td>${v.payoutsEnabled ? '<span class="pill ok">Connected</span>' : '<span class="pill warn">Not connected</span>'}</td>
      <td><div class="row-actions"><button class="btn sm ghost" data-pv="markVenuePaid:${vid}">Mark paid</button>${v.payoutsEnabled ? `<button class="btn sm gold" data-pv="payVenue:${vid}">Pay with Stripe</button>` : ""}</div></td></tr>`;
    }).join("")) : empty("Nothing due", "Every venue is paid up.")}
    ${paid.length ? `<div class="section-title"><h2 style="font-size:22px">Recently paid</h2></div>${tableWrap(["Venue", "Booking", "Amount", "How", "When"], paid.map(p => `<tr><td>${esc(p.venueName || venueName(p.venueId))}</td><td class="num">${esc(p.code || "")}</td><td class="num">${money(p.amount)}</td><td>${p.method === "stripe" ? "Stripe" : "Manual"}</td><td>${esc(ago(p.paidAt))}</td></tr>`).join(""))}` : ""}`;
}

function sSettings() {
  const s = S.settings;
  const sw = (k, b, sm) => `<div class="set-row"><div><b>${b}</b><small>${sm}</small></div><button type="button" class="switch" role="switch" aria-checked="${!!s[k]}" data-sw="${k}" aria-label="${esc(b)}"></button></div>`;
  const num = (id, k, b, sm, unit, min, max) => `<div class="set-row"><div><b>${b}</b><small>${sm}</small></div><label style="display:flex;align-items:center;gap:6px"><input id="${id}" type="number" min="${min}" max="${max}" value="${s[k]}"> ${unit}</label></div>`;
  return `${head("Settings", "Rules for the whole site. Changes apply as soon as you save.")}
    <form class="panel settings" id="settingsForm">
      ${num("s-fee", "fee", "Platform fee", "Your cut of every ticket, taken before venue payouts", "%", 0, 50)}
      ${num("s-window", "splitWindowHours", "Time to pay a split", "How long the group has to pay before seats release and refunds go out", "hrs", 1, 72)}
      ${num("s-age", "minAge", "Minimum age", "Members must be at least this old to sign up and book", "years", 18, 25)}
      ${sw("requireIdVerify", "Require photo ID to book", "Members upload an ID and you approve it before their first booking")}
      ${sw("openSeats", "Allow open seats", "Members can post an empty seat for anyone on Social to join")}
      ${sw("chatFilter", "Block payment requests in chat", "Hides messages that ask for Cash App, Zelle, Venmo and similar")}
      ${sw("autoApproveVenues", "Auto-approve venues", "Skip manual review when a venue uploads its license")}
      <div style="display:flex;justify-content:flex-end;padding-top:16px"><button class="btn gold" type="submit">Save settings</button></div>
    </form>`;
}

const SECTIONS = { overview: ["Overview", sOverview], venues: ["Venues", sVenues], tickets: ["Tickets", sTickets], members: ["Members", sMembers], bookings: ["Bookings", sBookings], reports: ["Reports", sReports], payouts: ["Payouts", sPayouts], settings: ["Settings", sSettings] };
let draftSettings = null;
function render(keep) {
  if (!auth.currentUser) return;
  const y = window.scrollY, c = counts();
  if (S.tab !== "settings") draftSettings = null;
  $("#app").innerHTML = `<section class="view">
    <div class="view-head"><div><div class="eyebrow">Admin · ${esc(BRAND.name)}</div><h1 class="display" style="margin-top:10px">Control room</h1></div></div>
    <div class="admin"><nav class="amenu" aria-label="Admin sections">${Object.entries(SECTIONS).map(([k, [l]]) => `<button data-tab="${k}" aria-current="${S.tab === k}">${l}${c[k] ? `<span class="badge">${c[k]}</span>` : ""}</button>`).join("")}</nav>
    <div class="amain">${SECTIONS[S.tab][1]()}</div></div>
  </section>`;
  if (keep) window.scrollTo(0, y);
}

/* ================= events ================= */
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-tab],[data-vtab],[data-btab],[data-mtab],[data-rtab],[data-va],[data-rr],[data-pv],[data-doc],[data-viewid],[data-sw]");
  if (!el) return;
  const d = el.dataset;
  if (d.tab) { S.tab = d.tab; render(); window.scrollTo(0, 0); return; }
  if (d.vtab) { S.vtab = d.vtab; return render(true); }
  if (d.btab) { S.btab = d.btab; return render(true); }
  if (d.mtab) { S.mtab = d.mtab; return render(true); }
  if (d.rtab) { S.rtab = d.rtab; return render(true); }
  if (d.sw) { S.settings[d.sw] = !S.settings[d.sw]; el.setAttribute("aria-checked", S.settings[d.sw]); return; }
  if (d.va) {
    const [action, id] = d.va.split(":");
    let reason = "";
    if (action === "pauseVenue") { reason = await askReason({ title: "Pause this venue?", body: "All its tickets are hidden from members until you turn it back on. Existing bookings aren't canceled.", yes: "Pause venue", placeholder: "e.g. Canceled 3 bookings last minute" }); if (reason === null) return; }
    if (action === "declineVenue") { reason = await askReason({ title: "Decline this venue?", body: "The owner sees this reason.", yes: "Decline", placeholder: "e.g. Liquor license is missing" }); if (reason === null) return; }
    if (action === "suspendUser") { reason = await askReason({ title: `Suspend ${userName(id)}?`, body: "They're signed out and can't sign back in until you restore them.", yes: "Suspend", placeholder: "e.g. Asked members for money in chat" }); if (reason === null) return; }
    if (action === "cancelBooking") { reason = await askReason({ title: "Cancel and refund this booking?", body: "Everyone who paid gets a full refund through Stripe, and the venue's payout for it is voided.", yes: "Cancel & refund", placeholder: "e.g. Venue closed for the night" }); if (reason === null) return; }
    if (action === "hideTicket" && !(await confirmSheet({ title: "Hide this ticket?", body: "Members won't see it. Existing bookings stay as they are.", yes: "Hide" }))) return;
    return act(action, { id, reason }, el.closest("[data-va]"));
  }
  if (d.rr) {
    const [decision, id] = d.rr.split(":");
    const r = S.reports.find(x => x.id === id);
    let message = "";
    if (decision === "warn") { message = await askReason({ title: "Send a warning", body: "The member sees this message the next time they open the app.", label: "Message", yes: "Send warning", placeholder: "We got a report that you asked someone for money outside the app. That's against our rules." }); if (message === null) return; }
    if (decision === "suspend" && !(await confirmSheet({ title: r.aboutType === "venue" ? "Pause this venue?" : "Suspend this member?", body: r.aboutType === "venue" ? "All its tickets are hidden until you turn it back on." : "They're signed out and can't sign back in until you restore them.", yes: r.aboutType === "venue" ? "Pause venue" : "Suspend", danger: true }))) return;
    return act("resolveReport", { id, data: { decision, message } }, el);
  }
  if (d.pv) {
    const [action, vid] = d.pv.split(":");
    const ok = await confirmSheet(action === "payVenue"
      ? { title: `Pay ${venueName(vid)}?`, body: "This sends the money from your Stripe balance to their bank. It can't be undone here.", yes: "Send payment" }
      : { title: `Mark ${venueName(vid)} as paid?`, body: "Only do this if you already paid them another way (check, Zelle, cash).", yes: "Mark paid" });
    if (ok) act(action, { id: vid }, el);
    return;
  }
  if (d.doc) { try { window.open(await getDownloadURL(sref(storage, d.doc)), "_blank", "noopener"); } catch (x) { toast(x.message); } return; }
  if (d.viewid) return reviewId(d.viewid);
});

async function reviewId(uid) {
  const u = S.users.find(x => x.id === uid);
  const sheet = openSheet(`<div class="sheet-body"><div style="display:flex;gap:12px;align-items:center">${avatar(u, "lg")}<div><div class="eyebrow">Review photo ID</div><h3 class="display" style="font-size:30px">${esc(u.name)}, ${ageFrom(u.birthYear)}</h3></div></div>
    <p class="muted" style="margin:0">Check that the name and birth year match the profile (born ${u.birthYear}) and the ID isn't expired.</p>
    <div id="idFiles" class="loading"><div class="spinner"></div></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button class="btn ghost" data-idact="rejectId">Ask for a new ID</button><button class="btn gold" data-idact="verifyUser">Approve ID</button></div></div>`, "Review ID");
  try {
    const files = (await listAll(sref(storage, `nights/ids/${uid}`))).items.slice(-3);
    const urls = await Promise.all(files.map(f => getDownloadURL(f)));
    $("#idFiles").outerHTML = urls.length ? `<div style="display:grid;gap:10px">${urls.map((url, i) => files[i].name.endsWith(".pdf") ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Open PDF</a>` : `<img src="${esc(url)}" alt="Uploaded ID" style="border-radius:12px;border:1px solid var(--line)">`).join("")}</div>` : `<p class="muted">No ID file found.</p>`;
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
  const s = S.settings;
  await act("saveSettings", { data: { fee: +$("#s-fee").value, splitWindowHours: +$("#s-window").value, minAge: +$("#s-age").value, requireIdVerify: !!s.requireIdVerify, openSeats: !!s.openSeats, chatFilter: !!s.chatFilter, autoApproveVenues: !!s.autoApproveVenues } }, e.submitter);
});
