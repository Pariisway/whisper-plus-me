// ConnectUs — member site (browse, book, meet, chat, tickets, profile)
import {
  collection, doc, getDoc, setDoc, updateDoc, addDoc, query, where, orderBy, limit, limitToLast,
  onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref as sref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getDatabase, ref as dref, get as dget } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { app } from "./common.js";
import {
  BRAND, auth, db, storage, call, authApi, authErrorText, $, $$, esc, money, toDate, fmtWhen, ago, timeLeft,
  hueFrom, grad, avatar, ageFrom, applyBrand, isAdminToken, toast, openSheet, closeSheet, busy, confirmSheet,
  seatDots, posterHTML, ticketCardHTML
} from "./common.js";

applyBrand();

/* ================= state ================= */
const S = {
  user: null, profile: null, isAdmin: false, settings: { minAge: 21, openSeats: true, requireIdVerify: true },
  view: "tonight", filter: "All", q: "",
  tickets: [], openSeats: [], people: [], chats: [], bookings: [],
  users: new Map(),            // uid → profile cache
  activeChat: null, messages: [], ready: false
};
let unsubs = [], msgUnsub = null;
const stopAll = () => { unsubs.forEach(u => u()); unsubs = []; if (msgUnsub) { msgUnsub(); msgUnsub = null; } };

const CATS = ["All", "Dinner + Movie", "Dinner", "Drinks", "Live Music", "Party"];
const NAV = [
  ["tonight", "Tonight", '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>'],
  ["social", "Social", '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c2.4-.3 4.3 1.3 5 4.3"/>'],
  ["chats", "Chats", '<path d="M4 5h16v11H9l-5 4Z"/>'],
  ["tickets", "My Tickets", '<path d="M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V5H3Z"/><path d="M14 5v11" stroke-dasharray="2 2"/>'],
  ["profile", "Profile", '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>']
];

/* ================= data helpers ================= */
async function userById(uid) {
  if (!uid) return null;
  if (S.users.has(uid)) return S.users.get(uid);
  const snap = await getDoc(doc(db, "users", uid)).catch(() => null);
  const u = snap && snap.exists() ? { id: uid, ...snap.data() } : { id: uid, name: "Member" };
  S.users.set(uid, u);
  return u;
}
const cachedUser = uid => S.users.get(uid) || { id: uid, name: "…" };
const unreadTotal = () => S.chats.reduce((a, c) => a + ((c.unread || {})[S.user?.uid] || 0), 0);
const chatIdFor = (a, b) => [a, b].sort().join("_");
const ticketById = id => S.tickets.find(t => t.id === id);
const bookingById = id => S.bookings.find(b => b.id === id);

async function ensureChat(otherUid) {
  const me = S.user.uid, cid = chatIdFor(me, otherUid);
  try {
    await setDoc(doc(db, "chats", cid), {
      members: [me, otherUid].sort(), updatedAt: serverTimestamp(),
      lastMessage: { text: "", from: me }, unread: { [me]: 0, [otherUid]: 0 }
    });
  } catch (_) { /* chat already exists */ }
  return cid;
}

/* ================= auth & boot ================= */
authApi.onChange(async rawUser => {
  const user = rawUser && !rawUser.isAnonymous ? rawUser : null; // Whisper+me guests need a real account here
  stopAll();
  S.user = user; S.profile = null; S.ready = false;
  if (!user) return renderAuth();
  const token = await user.getIdTokenResult();
  S.isAdmin = isAdminToken(token);
  unsubs.push(onSnapshot(doc(db, "settings", "platform"), s => { if (s.exists()) S.settings = { ...S.settings, ...s.data() }; }));
  unsubs.push(onSnapshot(doc(db, "users", user.uid), snap => {
    const first = !S.profile;
    S.profile = snap.exists() ? { id: user.uid, ...snap.data() } : null;
    if (S.profile) S.users.set(user.uid, S.profile);
    if (!S.profile) return renderOnboarding();
    if (first) startApp(); else render(true);
  }, () => renderOnboarding()));
});

function startApp() {
  const uid = S.user.uid;
  updateDoc(doc(db, "users", uid), { lastActive: serverTimestamp() }).catch(() => {});
  unsubs.push(onSnapshot(query(collection(db, "tickets"), where("status", "==", "live"), where("adminHidden", "==", false), orderBy("startsAt"), limit(120)), s => {
    const now = Date.now();
    S.tickets = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => toDate(t.startsAt)?.getTime() > now);
    if (S.view === "tonight") render(true);
  }, err => console.warn(err)));
  unsubs.push(onSnapshot(query(collection(db, "openSeats"), orderBy("startsAt"), limit(60)), s => {
    S.openSeats = s.docs.map(d => ({ id: d.id, ...d.data() }));
    if (S.view === "social") render(true);
  }));
  unsubs.push(onSnapshot(query(collection(db, "users"), where("openToMeet", "==", true), where("status", "==", "active"), orderBy("lastActive", "desc"), limit(60)), s => {
    S.people = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.id !== uid);
    S.people.forEach(p => S.users.set(p.id, p));
    if (S.view === "social") render(true);
  }));
  unsubs.push(onSnapshot(query(collection(db, "bookings"), where("memberUids", "array-contains", uid), orderBy("createdAt", "desc"), limit(50)), async s => {
    S.bookings = s.docs.map(d => ({ id: d.id, ...d.data() }));
    await Promise.all(S.bookings.flatMap(b => b.seats.map(x => x.uid)).filter(Boolean).map(userById));
    if (["tickets", "chats"].includes(S.view)) render(true);
  }));
  unsubs.push(onSnapshot(query(collection(db, "chats"), where("members", "array-contains", uid), orderBy("updatedAt", "desc"), limit(60)), async s => {
    S.chats = s.docs.map(d => ({ id: d.id, ...d.data() }));
    await Promise.all(S.chats.map(c => userById(c.members.find(m => m !== uid))));
    renderNav();
    if (S.view === "chats") render(true);
  }));
  S.ready = true;
  const params = new URLSearchParams(location.search);
  if (params.get("paid")) { toast("Payment received. Your ticket updates in a few seconds."); history.replaceState(null, "", "/nights/" + location.hash); }
  if (params.get("unpaid")) { toast("Checkout wasn't finished. You can pay from My Tickets."); history.replaceState(null, "", "/nights/" + location.hash); }
  route();
}

/* ================= routing & chrome ================= */
function route() {
  const h = location.hash.replace("#", "");
  const [view, arg] = h.split("-");
  S.view = NAV.some(n => n[0] === view) ? view : "tonight";
  if (S.view === "chats" && arg) openChat(h.slice(6));
  render();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => { if (S.profile) route(); });

function renderNav() {
  const u = unreadTotal();
  const badge = k => k === "chats" && u ? `<span class="badge">${u}</span>` : "";
  const cur = k => S.view === k ? 'aria-current="page"' : "";
  $("#navMain").innerHTML = S.profile ? NAV.slice(0, 4).map(([k, l]) => `<a href="#${k}" ${cur(k)}>${l}${badge(k)}</a>`).join("") : "";
  const tabs = $("#navTabs");
  tabs.style.gridTemplateColumns = "repeat(5,1fr)";
  tabs.innerHTML = S.profile ? NAV.map(([k, l, ic]) => `<a href="#${k}" ${cur(k)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ic}</svg>${l.replace("My ", "")}${badge(k)}</a>`).join("") : "";
  $("#meWrap").innerHTML = S.profile ? `<button class="me-btn" id="meBtn" aria-label="Account menu" aria-haspopup="true">${avatar(S.profile, "sm")}</button>` : "";
}
document.addEventListener("click", e => {
  if (e.target.closest("#meBtn")) {
    const wrap = $("#meWrap");
    const pop = wrap.querySelector(".menu-pop");
    if (pop) return pop.remove();
    wrap.insertAdjacentHTML("beforeend", `<div class="menu-pop"><a href="#profile">Profile</a><a href="/">Whisper+me live chat</a><a href="/nights/venue">Venue dashboard</a>${S.isAdmin ? '<a href="/nights/admin">Nights admin</a>' : ""}<button data-signout>Sign out</button></div>`);
    return;
  }
  if (!e.target.closest(".menu-pop")) $$(".menu-pop").forEach(p => p.remove());
  if (e.target.closest("[data-signout]")) authApi.signOut();
});

const footer = `<div class="proto">${esc(BRAND.name)} · meet in public · never send money outside the app<br><a href="/" style="color:var(--gold)">Rather talk first? Start a live voice chat on Whisper+me →</a></div>`;
function render(keepScroll) {
  if (!S.profile) return;
  const y = window.scrollY;
  const views = { tonight: vTonight, social: vSocial, chats: vChats, tickets: vTickets, profile: vProfile };
  $("#app").innerHTML = warningBanner() + views[S.view]() + footer;
  renderNav();
  if (keepScroll) window.scrollTo(0, y);
  const m = $("#msgs"); if (m) m.scrollTop = m.scrollHeight;
}
function warningBanner() {
  const p = S.profile;
  if (!p?.lastWarning) return "";
  const at = toDate(p.warningAt)?.getTime() || 0, seen = toDate(p.warningSeenAt)?.getTime() || 0;
  if (seen >= at) return "";
  return `<div class="banner rose" style="margin-bottom:var(--s-4)"><span><b>Message from ${esc(BRAND.name)}:</b> ${esc(p.lastWarning)}</span><button class="btn sm" data-ackwarn>Got it</button></div>`;
}

/* ================= auth screens ================= */
function renderAuth(mode = "signin") {
  S.profile = null; renderNav();
  $("#app").innerHTML = `<div class="auth"><form class="auth-card" id="authForm" novalidate>
    <div><div class="eyebrow">${esc(BRAND.tagline)}</div><h1 class="display" style="margin-top:8px">${mode === "signin" ? "Welcome back" : "Join the lounge"}</h1></div>
    <button type="button" class="btn block" id="googleBtn">Continue with Google</button>
    <div class="or">or</div>
    <div class="field"><label for="a-email">Email</label><input id="a-email" type="email" autocomplete="email" required></div>
    <div class="field"><label for="a-pw">Password</label><input id="a-pw" type="password" autocomplete="${mode === "signin" ? "current-password" : "new-password"}" minlength="6" required></div>
    <div id="authErr" class="note" style="border-left-color:var(--rose)" hidden></div>
    <button class="btn gold block" type="submit">${mode === "signin" ? "Sign in" : "Create account"}</button>
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:14px">
      <span class="muted">${mode === "signin" ? "New here?" : "Have an account?"} <button type="button" class="linkish" id="swapMode">${mode === "signin" ? "Create an account" : "Sign in"}</button></span>
      ${mode === "signin" ? '<button type="button" class="linkish" id="resetPw">Forgot password</button>' : ""}
    </div>
    <p class="muted" style="font-size:12px;margin:0">Own a restaurant, theater or lounge? <a href="/nights/venue" style="color:var(--gold)">List your venue</a></p>
  </form></div>`;
  const err = m => { const e = $("#authErr"); e.hidden = false; e.textContent = m; };
  $("#swapMode").onclick = () => renderAuth(mode === "signin" ? "signup" : "signin");
  $("#googleBtn").onclick = () => authApi.google().catch(e => err(authErrorText(e)));
  const r = $("#resetPw");
  if (r) r.onclick = async () => {
    const email = $("#a-email").value.trim();
    if (!email) return err("Type your email above, then tap Forgot password.");
    await authApi.reset(email).then(() => toast("Password reset email sent")).catch(e => err(authErrorText(e)));
  };
  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    const email = $("#a-email").value.trim(), pw = $("#a-pw").value;
    if (!email || pw.length < 6) return err("Enter your email and a password of at least 6 characters.");
    await busy(e.submitter, () => (mode === "signin" ? authApi.signIn(email, pw) : authApi.signUp(email, pw)).catch(x => err(authErrorText(x))));
  };
}

function renderOnboarding() {
  renderNav();
  const yr = new Date().getFullYear();
  const years = Array.from({ length: 80 }, (_, i) => yr - 18 - i);
  $("#app").innerHTML = `<div class="auth"><form class="auth-card" id="onboard" novalidate>
    <div><div class="eyebrow">Step 1 of 1</div><h1 class="display" style="margin-top:8px">Set up your Nights profile</h1><p class="muted" style="margin:8px 0 0">Same account as Whisper+me. This is what people see before they share a table with you.</p></div>
    <div class="field"><label for="o-name">First name</label><input id="o-name" maxlength="40" autocomplete="given-name" value="${esc(S.user.displayName?.split(" ")[0] || "")}"></div>
    <div class="fields">
      <div class="field"><label for="o-year">Birth year</label><select id="o-year"><option value="">Select</option>${years.map(y => `<option>${y}</option>`).join("")}</select></div>
      <div class="field"><label for="o-city">City</label><input id="o-city" maxlength="40" placeholder="Belleville, IL"></div>
    </div>
    <div class="field"><label for="o-bio">About you</label><textarea id="o-bio" maxlength="300" placeholder="What's your idea of a good night out?"></textarea></div>
    <div class="field"><label for="o-tags">Interests</label><input id="o-tags" placeholder="Live music, cocktails, movies"><span class="hint">Separate with commas</span></div>
    <label class="check"><input type="checkbox" id="o-open" checked> Show me on Social so people can invite me out</label>
    <label class="check"><input type="checkbox" id="o-rules"> I'll meet people in public, treat them with respect, and never ask for money outside ${esc(BRAND.name)}.</label>
    <div id="oErr" class="note" style="border-left-color:var(--rose)" hidden></div>
    <button class="btn gold block" type="submit">Enter ${esc(BRAND.name)}</button>
    <button type="button" class="btn ghost block" data-signout>Sign out</button>
  </form></div>`;
  // Pre-fill from the member's Whisper+me profile (same account).
  let whisperPhoto = S.user.photoURL || "";
  dget(dref(getDatabase(app), `users/${S.user.uid}`)).then(snap => {
    const w = snap.val() || {};
    const nameEl = $("#o-name");
    if (w.name && nameEl && !nameEl.value) nameEl.value = String(w.name).split(" ")[0].slice(0, 40);
    if (w.bio && $("#o-bio") && !$("#o-bio").value) $("#o-bio").value = String(w.bio).slice(0, 300);
    if (w.photo) whisperPhoto = w.photo;
  }).catch(() => {});
  $("#onboard").onsubmit = async e => {
    e.preventDefault();
    const err = m => { const x = $("#oErr"); x.hidden = false; x.textContent = m; };
    const name = $("#o-name").value.trim(), year = +$("#o-year").value;
    if (!name) return err("Add your first name.");
    if (!year) return err("Select your birth year.");
    if (yr - year < (S.settings.minAge || 21)) return err(`${BRAND.name} is for people ${S.settings.minAge || 21} and older.`);
    if (!$("#o-rules").checked) return err("Check the community promise to continue.");
    await busy(e.submitter, () => setDoc(doc(db, "users", S.user.uid), {
      name, birthYear: year, city: $("#o-city").value.trim(), bio: $("#o-bio").value.trim(),
      tags: $("#o-tags").value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 8),
      photoURL: whisperPhoto, openToMeet: $("#o-open").checked,
      status: "active", verified: false, idUploaded: false,
      createdAt: serverTimestamp(), lastActive: serverTimestamp()
    }).catch(x => err(x.message)));
  };
}

/* ================= views ================= */
function vTonight() {
  const q = S.q.toLowerCase();
  const list = S.tickets.filter(t => (S.filter === "All" || (t.category || "").startsWith(S.filter)) && (!q || [t.title, t.venueName, ...(t.items || [])].join(" ").toLowerCase().includes(q)));
  const name = S.profile.name;
  return `<section class="view">
    <div class="tonight-hero">
      <div class="view-head" style="display:block">
        <div class="eyebrow">${esc(BRAND.city)} · Hi ${esc(name)}</div>
        <h1 class="display" style="margin-top:10px">Pick the night.<br>Bring the company.</h1>
        <p>Packages from local restaurants, cinemas and lounges. Pay for the whole night or split it evenly.</p>
      </div>
      <div class="how">
        <div><span class="mono">STEP 1</span><b>Choose a ticket</b>Dinner, a movie, drinks, one price.</div>
        <div><span class="mono">STEP 2</span><b>Invite your company</b>Send it to someone or post an open seat.</div>
        <div><span class="mono">STEP 3</span><b>Pay full or split</b>Seats lock in once everyone's paid.</div>
      </div>
    </div>
    ${idBanner()}
    <div class="toolbar">
      <div class="chips" role="group" aria-label="Filter">${CATS.map(c => `<button class="chip" data-filter="${esc(c)}" aria-pressed="${S.filter === c}">${esc(c)}</button>`).join("")}</div>
      <label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="Search venues or items" value="${esc(S.q)}" aria-label="Search tickets"></label>
    </div>
    ${list.length ? `<div class="grid">${list.map(t => ticketCardHTML(t)).join("")}</div>`
      : `<div class="empty"><h3>${S.tickets.length ? "Nothing matches yet" : "New nights are on the way"}</h3><p>${S.tickets.length ? "Try another category or clear the search." : "Venues are adding tickets. Check back soon, or tell your favorite spot to list here."}</p>${S.tickets.length ? '<button class="btn" data-filter="All">Show all tickets</button>' : ""}</div>`}
  </section>`;
}
function idBanner() {
  const p = S.profile;
  if (!S.settings.requireIdVerify || p.verified) return "";
  return p.idUploaded
    ? `<div class="banner"><span>Your ID is being reviewed. You can browse and chat now, and book once it's approved.</span></div>`
    : `<div class="banner"><span>Upload a photo ID before your first booking. It keeps everyone safe and usually takes less than a day to approve.</span><a class="btn sm gold" href="#profile">Upload ID</a></div>`;
}

function vSocial() {
  const me = S.user.uid;
  const seats = S.openSeats.filter(o => toDate(o.startsAt)?.getTime() > Date.now());
  return `<section class="view">
    <div class="view-head"><div><div class="eyebrow">The lounge</div><h1 class="display" style="margin-top:10px">Who's going out</h1><p>Meet people, start a chat, or grab an open seat someone already booked.</p></div></div>
    ${S.settings.openSeats ? `<div class="section-title"><h2>Open seats</h2><span class="muted" style="font-size:13px">Join and pay your share</span></div>
    ${seats.length ? `<div class="open-seats">${seats.map(o => {
      const mine = o.hostUid === me, joined = bookingById(o.id)?.memberUids.includes(me);
      return `<div class="seat-card"><div class="swatch" style="background:${grad(o.hue ?? hueFrom(o.title))}"></div><div class="info"><b>${esc(o.title)}</b><span>${esc(o.venueName)} · ${esc(fmtWhen(o.startsAt))}</span><span style="display:block">${mine ? "Posted by you" : `Hosted by ${esc(o.hostName)}`}${o.note ? ` · “${esc(o.note)}”` : ""}</span><div style="margin-top:6px;font-size:13px">${seatDots(o.size, o.filled)} <span class="mono" style="margin-left:6px">${o.seatPrice ? money(o.seatPrice) + " / seat" : "Seat is covered"}</span></div></div>${mine ? '<span class="pill gold">Yours</span>' : joined ? '<span class="pill ok">Joined</span>' : `<button class="btn sm gold" data-join="${o.id}">Join</button>`}</div>`;
    }).join("")}</div>` : `<div class="empty" style="padding:var(--s-5)"><p style="margin:0">No open seats right now. Book a ticket and post one yourself.</p></div>`}` : ""}
    <div class="section-title"><h2>People nearby</h2><span class="muted" style="font-size:13px"><span style="color:var(--ok)">●</span> active today</span></div>
    ${S.people.length ? `<div class="people">${S.people.map(p => {
      const live = toDate(p.lastActive)?.getTime() > Date.now() - 86400000;
      return `<article class="person">
      <div class="person-top">${avatar(p, "lg", live)}<div><h3>${esc(p.name)}, ${ageFrom(p.birthYear)}</h3><div class="meta">${esc(p.city || "")}${p.verified ? ' · <span style="color:var(--ok)">ID verified</span>' : ""}</div></div></div>
      ${p.bio ? `<p>${esc(p.bio)}</p>` : ""}
      ${(p.tags || []).length ? `<div class="includes">${p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="actions"><button class="btn sm" data-msg="${p.id}">Message</button><button class="btn sm gold" data-sendticket="${p.id}">Send ticket</button></div>
    </article>`;
    }).join("")}</div>` : `<div class="empty"><h3>It's quiet in here</h3><p>As more people join, they'll show up here.</p></div>`}
  </section>`;
}

/* ----- chats ----- */
function openChat(cid) {
  if (msgUnsub) { msgUnsub(); msgUnsub = null; }
  S.activeChat = cid; S.messages = [];
  if (!cid) return;
  msgUnsub = onSnapshot(query(collection(db, "chats", cid, "messages"), orderBy("createdAt"), limitToLast(200)), s => {
    S.messages = s.docs.map(d => ({ id: d.id, ...d.data() }));
    if (S.view === "chats") render(true);
  }, () => {});
  updateDoc(doc(db, "chats", cid), { [`unread.${S.user.uid}`]: 0 }).catch(() => {});
}
function inviteCard(m) {
  const b = bookingById(m.bookingId);
  const me = S.user.uid;
  if (!b) return `<div class="msg system">Ticket invite: ${esc(m.title || "")} (no longer available)</div>`;
  const mine = m.from === me;
  const seat = b.seats.find(x => x.uid === me);
  const each = b.seats.find(x => x.uid && x.uid !== b.buyerUid)?.amount ?? b.seats[1]?.amount ?? 0;
  let actions;
  if (["canceled", "refunded"].includes(b.status)) actions = `<span class="pill rose">Canceled</span>`;
  else if (mine) {
    const pending = b.seats.filter(x => x.invited && x.status !== "paid").length;
    actions = pending ? `<span class="pill warn">Waiting on ${pending}</span>` : `<span class="pill ok">Everyone's in</span>`;
  } else if (!seat) actions = `<span class="pill rose">Declined</span>`;
  else if (seat.status === "invited") actions = `<div class="row"><button class="btn sm ghost" data-decline="${b.id}">Decline</button><button class="btn sm gold" data-accept="${b.id}">${seat.amount ? `Accept · pay ${money(seat.amount)}` : "Accept"}</button></div>`;
  else if (seat.status === "claimed") actions = `<button class="btn sm gold" data-pay="${b.id}">Finish paying ${money(seat.amount)}</button>`;
  else actions = `<span class="pill ok">You're going</span>`;
  return `<div class="invite ${mine ? "mine" : ""}">${posterHTML(b)}<div class="in"><div>${esc(b.venueName)} · ${esc(fmtWhen(b.startsAt))}</div><div class="muted">${b.mode === "split" ? `Split evenly · ${money(each)} each` : `Paid in full by ${mine ? "you" : esc(cachedUser(b.buyerUid).name)}`}</div>${actions}</div></div>`;
}
function vChats() {
  const me = S.user.uid, a = S.activeChat;
  const visible = S.chats.filter(c => c.lastMessage?.text || c.id === a);
  const list = visible.map(c => {
    const other = cachedUser(c.members.find(m => m !== me));
    const n = (c.unread || {})[me] || 0;
    return `<button class="chat-item" data-chat="${c.id}" aria-current="${a === c.id}">${avatar(other, "md")}<span class="t"><b>${esc(other.name)} ${n ? `<span class="badge">${n}</span>` : `<span>${ago(c.updatedAt)}</span>`}</b><small>${c.lastMessage?.from === me ? "You: " : ""}${esc(c.lastMessage?.text || "")}</small></span></button>`;
  }).join("") || `<div class="empty" style="border:0;margin:var(--s-4)"><p style="margin:0">No chats yet. Say hi to someone on Social.</p></div>`;
  let thread = `<div class="empty" style="margin:auto;border:0"><h3>Pick a conversation</h3><p>Or find someone new on Social.</p></div>`;
  const chat = S.chats.find(c => c.id === a);
  if (chat) {
    const other = cachedUser(chat.members.find(m => m !== me));
    const msgs = S.messages.map(m => {
      if (m.type === "invite") return inviteCard(m);
      if (m.type === "system") return `<div class="msg system">${esc(m.text)}</div>`;
      if (m.hidden) return `<div class="msg ${m.from === me ? "me" : "them"} hidden-msg">Message hidden: asking for money outside ${esc(BRAND.name)} isn't allowed</div>`;
      return `<div class="msg ${m.from === me ? "me" : "them"}" title="${esc(fmtWhen(m.createdAt))}">${esc(m.text)}</div>`;
    }).join("");
    thread = `<div class="thread-head"><button class="btn sm ghost back" data-back aria-label="Back to chats">←</button>${avatar(other, "md")}<div class="who"><b>${esc(other.name)}${other.birthYear ? ", " + ageFrom(other.birthYear) : ""}</b><small>${other.verified ? "ID verified · " : ""}${esc(other.city || "")}</small></div><button class="btn sm ghost" data-report="${other.id}" aria-label="Report ${esc(other.name)}">Report</button><button class="btn sm gold" data-sendticket="${other.id}">Send ticket</button></div>
    <div class="msgs" id="msgs">${msgs || `<div class="msg-time">Say hello to ${esc(other.name)}</div>`}</div>
    <form class="composer" id="composer"><input id="msgInput" autocomplete="off" maxlength="1000" placeholder="Message ${esc(other.name)}" aria-label="Message"><button class="btn gold" type="submit">Send</button></form>`;
  }
  return `<section class="view">
    <div class="view-head"><div><div class="eyebrow">Messages</div><h1 class="display" style="margin-top:10px">Chats</h1></div></div>
    <div class="chat-shell ${a ? "has-thread" : ""}"><div class="chat-list">${list}</div><div class="thread">${thread}</div></div>
  </section>`;
}

/* ----- my tickets ----- */
const STATUS_PILL = { payment: ["warn", "Checkout not finished"], awaiting: ["warn", "Waiting on payments"], confirmed: ["ok", "Confirmed"], canceled: ["rose", "Canceled"], refunded: ["rose", "Refunded"] };
function vTickets() {
  const me = S.user.uid;
  const upcoming = S.bookings.filter(b => toDate(b.startsAt)?.getTime() > Date.now() - 6 * 3600000 && !["canceled", "refunded"].includes(b.status));
  const past = S.bookings.filter(b => !upcoming.includes(b));
  const stub = b => {
    const [cls, label] = STATUS_PILL[b.status] || ["gold", b.status];
    const mySeat = b.seats.find(x => x.uid === me);
    const paidCount = b.seats.filter(x => x.status === "paid").length;
    const pct = Math.round(b.seats.filter(x => x.status === "paid").reduce((a, x) => a + x.amount, 0) / b.total * 100);
    const who = b.seats.filter(x => x.uid && x.uid !== me).map(x => esc(cachedUser(x.uid).name));
    const openN = b.seats.filter(x => x.status === "open").length;
    let actions = "";
    if (mySeat && ["pending", "claimed"].includes(mySeat.status) && !["canceled", "refunded"].includes(b.status)) actions += `<button class="btn sm gold" data-pay="${b.id}">Pay ${money(mySeat.amount)}</button>`;
    if (mySeat?.status === "invited") actions += `<button class="btn sm gold" data-accept="${b.id}">Accept</button>`;
    if (b.buyerUid === me && ["payment", "awaiting"].includes(b.status)) actions += `<button class="btn sm ghost" data-cancelbooking="${b.id}">Cancel</button>`;
    return `<article class="stub">${posterHTML(b)}
      <div class="mid"><h3>${esc(b.venueName)}</h3><div class="meta"><span>${esc(fmtWhen(b.startsAt))}</span><span>${who.length ? "With " + who.join(", ") : ""}${openN ? `${who.length ? " + " : ""}${openN} open seat${openN > 1 ? "s" : ""}` : ""}</span></div>
      <div class="includes">${(b.items || []).map(i => `<span class="tag">${esc(i)}</span>`).join("")}</div>
      ${b.status === "awaiting" ? `<div class="muted" style="font-size:13px">Seats release ${timeLeft(b.expiresAt) === "expired" ? "soon" : "in " + timeLeft(b.expiresAt).replace(" left", "")} if not everyone has paid.</div>` : ""}</div>
      <div class="side"><div style="text-align:right"><span class="pill ${cls}">${esc(label)}</span>${b.status === "confirmed" ? `<div class="code" style="margin-top:10px;font-size:18px;color:var(--gold)">${esc(b.code)}</div><div class="muted" style="font-size:11px">Show this at the door</div>` : ""}</div>
      <div style="width:100%;min-width:120px"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:6px"><span>${b.mode === "full" ? "Paid in full" : `${paidCount} of ${b.size} paid`}</span><span class="mono">${money(b.total)}</span></div><div class="progress"><i style="width:${Math.min(100, pct)}%"></i></div></div>
      ${actions ? `<div class="row-actions">${actions}</div>` : ""}</div>
    </article>`;
  };
  return `<section class="view">
    <div class="view-head"><div><div class="eyebrow">Your nights out</div><h1 class="display" style="margin-top:10px">My Tickets</h1><p>Show your code at the venue. A split ticket locks in once every seat is paid.</p></div><a class="btn" href="#tonight">Find another night</a></div>
    ${upcoming.length ? `<div class="stubs">${upcoming.map(stub).join("")}</div>` : `<div class="empty"><h3>No upcoming tickets</h3><p>Book a night and it shows up here.</p><a class="btn gold" href="#tonight">Browse tickets</a></div>`}
    ${past.length ? `<div class="section-title"><h2>Past & canceled</h2></div><div class="stubs">${past.map(stub).join("")}</div>` : ""}
  </section>`;
}

/* ----- profile ----- */
function vProfile() {
  const p = S.profile, yr = new Date().getFullYear();
  const years = Array.from({ length: 80 }, (_, i) => yr - 18 - i);
  const idState = p.verified ? '<span class="pill ok">Verified</span>' : p.idUploaded ? '<span class="pill warn">Under review</span>' : '<span class="pill rose">Not uploaded</span>';
  return `<section class="view">
    <div class="view-head"><div><div class="eyebrow">Your profile</div><h1 class="display" style="margin-top:10px">${esc(p.name)}</h1></div><button class="btn ghost" data-signout>Sign out</button></div>
    <div class="builder">
      <form class="panel" id="profileForm" novalidate>
        <h2>Details</h2>
        <div style="display:flex;gap:16px;align-items:center">${avatar(p, "lg")}<label class="file-drop" style="flex:1"><span>Profile photo</span><input id="p-photo" type="file" accept="image/*"></label></div>
        <div class="fields">
          <div class="field"><label for="p-name">First name</label><input id="p-name" maxlength="40" value="${esc(p.name)}"></div>
          <div class="field"><label for="p-year">Birth year</label><select id="p-year">${years.map(y => `<option ${y === p.birthYear ? "selected" : ""}>${y}</option>`).join("")}</select></div>
          <div class="field full"><label for="p-city">City</label><input id="p-city" maxlength="40" value="${esc(p.city || "")}"></div>
          <div class="field full"><label for="p-bio">About you</label><textarea id="p-bio" maxlength="300">${esc(p.bio || "")}</textarea></div>
          <div class="field full"><label for="p-tags">Interests</label><input id="p-tags" value="${esc((p.tags || []).join(", "))}"><span class="hint">Separate with commas</span></div>
        </div>
        <label class="check"><input type="checkbox" id="p-open" ${p.openToMeet ? "checked" : ""}> Show me on Social so people can invite me out</label>
        <div style="display:flex;justify-content:flex-end"><button class="btn gold" type="submit">Save profile</button></div>
      </form>
      <div class="preview-col">
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2>Photo ID</h2>${idState}</div>
          <p class="muted" style="margin:0;font-size:14px">Only ${esc(BRAND.name)} staff can see your ID. Members only see a "verified" badge.</p>
          ${p.verified ? "" : `<label class="file-drop"><input id="p-id" type="file" accept="image/*,application/pdf"></label><button class="btn" id="uploadId">${p.idUploaded ? "Upload a new ID" : "Upload ID"}</button>`}
        </div>
        <div class="panel"><h2>Your stats</h2><dl class="kv"><dt>Nights booked</dt><dd class="mono">${p.bookingsCount || 0}</dd><dt>Member since</dt><dd>${toDate(p.createdAt)?.toLocaleDateString("en-US", { month: "long", year: "numeric" }) || ""}</dd></dl></div>
      </div>
    </div>
  </section>`;
}

/* ================= booking flow ================= */
let B = null;
function openBooking(ticketId, opts = {}) {
  const t = ticketById(ticketId);
  if (!t) return toast("That ticket is no longer for sale.");
  B = { t, who: opts.guest ? "invite" : "invite", guests: opts.guest ? [opts.guest] : [], pay: "split", note: "" };
  drawBooking();
}
function drawBooking() {
  const { t } = B, need = t.size - 1;
  const base = Math.floor(t.price / t.size), each = base + (t.price - base * t.size);
  const due = B.pay === "full" ? t.price : each;
  const pickable = S.people.slice(0, 40);
  B.guests.forEach(g => { if (!pickable.some(p => p.id === g)) pickable.unshift(cachedUser(g)); });
  const openLeft = need - B.guests.length;
  const canOpen = S.settings.openSeats;
  const pickers = pickable.map(p => `<button class="pick" data-pick="${p.id}" aria-pressed="${B.guests.includes(p.id)}">${avatar(p, "md")}${esc(p.name)}</button>`).join("");
  openSheet(`<div style="position:relative">${posterHTML(t, `<div class="cat" style="text-transform:none;letter-spacing:.02em;font-family:var(--f-body);font-size:13px"><span>${esc(t.venueName)}</span><span>${esc(fmtWhen(t.startsAt))}</span></div>`)}<button class="close" data-sheet-close aria-label="Close">×</button></div>
  <div class="sheet-body">
    <div><div class="block-title">What's included</div><ul class="inc-list">${t.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>
    ${t.note ? `<div class="note">${esc(t.note)}</div>` : ""}
    <div><div class="block-title">Who's coming · ${need} more</div>
      <div class="pick-people" aria-label="Invite people">${pickers || '<span class="muted" style="font-size:13px">No one to invite yet. Post an open seat instead.</span>'}</div>
      <div class="muted" style="font-size:12px;margin-top:6px">${B.guests.length} of ${need} invited${openLeft > 0 ? canOpen ? ` · ${openLeft} seat${openLeft > 1 ? "s" : ""} will be posted as open` : ` · invite ${openLeft} more` : ""}</div>
      ${openLeft > 0 && canOpen ? `<div class="field" style="margin-top:10px"><label for="b-note">Note on your open seat (optional)</label><input id="b-note" maxlength="140" value="${esc(B.note)}" placeholder="Looking for a fun +1 for the late set"></div>` : ""}
    </div>
    <div><div class="block-title">Payment</div><div class="options">
      <button class="option" data-paymode="split" aria-pressed="${B.pay === "split"}"><span class="radio"></span><span class="o-main"><b>Split evenly</b><small>Everyone pays their own seat within ${S.settings.splitWindowHours || 24} hours</small></span><span class="amt">${money(base)} each</span></button>
      <button class="option" data-paymode="full" aria-pressed="${B.pay === "full"}"><span class="radio"></span><span class="o-main"><b>Pay the full ticket</b><small>Your treat. Guests pay nothing</small></span><span class="amt">${money(t.price)}</span></button>
    </div></div>
    <div class="summary"><div><div class="mono">YOU PAY NOW</div><div class="price">${money(due)}</div></div><button class="btn gold" id="reserveBtn">Continue to payment</button></div>
    <div id="bookErr" class="note" style="border-left-color:var(--rose)" hidden></div>
    <p class="muted" style="font-size:12px;margin:0">Payments are handled by Stripe. If the group doesn't finish paying in time, everyone who paid is refunded automatically.</p>
  </div>`, t.title);
}
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-pick],[data-paymode],#reserveBtn,[data-pickticket]");
  if (!el) return;
  if (el.dataset.pickticket) { const g = $(".sheet")?.dataset.guest; closeSheet(); return openBooking(el.dataset.pickticket, { guest: g }); }
  if (!B) return;
  const nb = $("#b-note"); if (nb) B.note = nb.value;
  if (el.dataset.pick) {
    const need = B.t.size - 1, i = B.guests.indexOf(el.dataset.pick);
    if (i > -1) B.guests.splice(i, 1); else { if (B.guests.length >= need) B.guests.shift(); B.guests.push(el.dataset.pick); }
    return drawBooking();
  }
  if (el.dataset.paymode) { B.pay = el.dataset.paymode; return drawBooking(); }
  if (el.id === "reserveBtn") {
    const need = B.t.size - 1, openLeft = need - B.guests.length;
    const err = m => { const x = $("#bookErr"); x.hidden = false; x.textContent = m; };
    if (openLeft > 0 && !S.settings.openSeats) return err(`Invite ${openLeft} more ${openLeft === 1 ? "person" : "people"} to continue.`);
    await busy(el, async () => {
      try {
        const res = await call("createBooking", { ticketId: B.t.id, mode: B.pay, guestUids: B.guests, openSeat: openLeft > 0, note: B.note });
        location.href = res.url;
      } catch (x) { err(x.message); }
    });
  }
});

function sendTicketTo(uid) {
  const p = cachedUser(uid);
  const sheet = openSheet(`<div class="sheet-body" style="position:relative">
    <button class="close" data-sheet-close aria-label="Close" style="background:var(--raise)">×</button>
    <div style="display:flex;gap:12px;align-items:center">${avatar(p, "lg")}<div><div class="eyebrow">Send a ticket</div><h3 class="display" style="font-size:30px">to ${esc(p.name)}</h3></div></div>
    ${S.tickets.length ? `<div class="options">${S.tickets.slice(0, 30).map(t => `<button class="option" data-pickticket="${t.id}"><span style="width:40px;height:40px;border-radius:8px;flex:none;background:${grad(t.hue ?? hueFrom(t.title))}"></span><span class="o-main"><b>${esc(t.title)}</b><small>${esc(t.venueName)} · ${esc(fmtWhen(t.startsAt))}</small></span><span class="amt">${money(t.price)}</span></button>`).join("")}</div>` : '<p class="muted">No tickets are for sale right now.</p>'}
  </div>`, `Send a ticket to ${p.name}`);
  sheet.dataset.guest = uid;
}

function reportSheet(uid) {
  const p = cachedUser(uid);
  openSheet(`<form class="sheet-body" id="reportForm">
    <div><div class="eyebrow">Report</div><h3 class="display" style="font-size:30px">${esc(p.name)}</h3><p class="muted" style="margin:6px 0 0">Our team reviews every report. ${esc(p.name)} won't see who reported them.</p></div>
    <div class="field"><label for="r-reason">What happened?</label><select id="r-reason">
      <option>Asked for money outside the app</option><option>Didn't show up</option><option>Rude or disrespectful</option>
      <option>Made me feel unsafe</option><option>Fake profile</option><option>Something else</option></select></div>
    <div class="field"><label for="r-detail">Details</label><textarea id="r-detail" maxlength="1000" placeholder="Tell us what happened"></textarea></div>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn ghost" data-sheet-close>Cancel</button><button class="btn gold" type="submit">Send report</button></div>
    <p class="muted" style="font-size:12px;margin:0">If you're in danger, call 911 first.</p>
  </form>`, "Report member");
  $("#reportForm").onsubmit = async e => {
    e.preventDefault();
    await busy(e.submitter, () => addDoc(collection(db, "reports"), {
      about: uid, aboutType: "user", by: S.user.uid, reason: $("#r-reason").value,
      detail: $("#r-detail").value.trim(), status: "open", createdAt: serverTimestamp()
    }).then(() => { closeSheet(); toast("Report sent. Thanks for looking out."); }).catch(x => toast(x.message)));
  };
}

/* ================= events ================= */
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-open],[data-filter],[data-join],[data-msg],[data-sendticket],[data-chat],[data-back],[data-accept],[data-decline],[data-pay],[data-cancelbooking],[data-report],[data-ackwarn],#uploadId");
  if (!el || !S.profile) return;
  const d = el.dataset;
  if (d.open) return openBooking(d.open);
  if (d.filter) { S.filter = d.filter; return render(true); }
  if (d.join) {
    const o = S.openSeats.find(x => x.id === d.join);
    const ok = await confirmSheet({ title: `Join ${o.title}?`, body: `${esc(o.venueName)} · ${esc(fmtWhen(o.startsAt))}<br>Hosted by ${esc(o.hostName)}. ${o.seatPrice ? `Your seat is ${money(o.seatPrice)}.` : "Your seat is already paid for."}`, yes: o.seatPrice ? `Join & pay ${money(o.seatPrice)}` : "Join" });
    if (!ok) return;
    try { const r = await call("joinOpenSeat", { bookingId: d.join }); if (r.url) location.href = r.url; else { toast("You're in!"); location.hash = "tickets"; } } catch (x) { toast(x.message); }
    return;
  }
  if (d.msg) { const cid = await ensureChat(d.msg); location.hash = "chats-" + cid; return; }
  if (d.sendticket) return sendTicketTo(d.sendticket);
  if (d.chat) { location.hash = "chats-" + d.chat; return; }
  if ("back" in d) { openChat(null); history.replaceState(null, "", "#chats"); return render(true); }
  if (d.accept) return busy(el, async () => { try { const r = await call("acceptInvite", { bookingId: d.accept }); if (r.url) location.href = r.url; else toast("You're going!"); } catch (x) { toast(x.message); } });
  if (d.decline) {
    if (!(await confirmSheet({ title: "Decline this invite?", body: "The host will be told you can't make it.", yes: "Decline", danger: true }))) return;
    try { await call("declineInvite", { bookingId: d.decline }); toast("Invite declined"); } catch (x) { toast(x.message); }
    return;
  }
  if (d.pay) return busy(el, async () => { try { const r = await call("payMySeat", { bookingId: d.pay }); location.href = r.url; } catch (x) { toast(x.message); } });
  if (d.cancelbooking) {
    if (!(await confirmSheet({ title: "Cancel this booking?", body: "Anyone who already paid gets a full refund.", yes: "Cancel booking", danger: true }))) return;
    try { await call("cancelMyBooking", { bookingId: d.cancelbooking }); toast("Booking canceled"); } catch (x) { toast(x.message); }
    return;
  }
  if (d.report) return reportSheet(d.report);
  if ("ackwarn" in d) return updateDoc(doc(db, "users", S.user.uid), { warningSeenAt: serverTimestamp() });
  if (el.id === "uploadId") {
    const f = $("#p-id").files[0];
    if (!f) return toast("Choose a photo of your ID first.");
    if (f.size > 10 * 1024 * 1024) return toast("That file is over 10 MB. Try a smaller photo.");
    await busy(el, async () => {
      await uploadBytes(sref(storage, `nights/ids/${S.user.uid}/${Date.now()}-${f.name.replace(/[^\w.-]/g, "")}`), f, { contentType: f.type });
      await updateDoc(doc(db, "users", S.user.uid), { idUploaded: true });
      toast("ID uploaded. We'll review it soon.");
    }).catch(x => toast(x.message));
  }
});

document.addEventListener("input", e => {
  if (e.target.id === "q") {
    S.q = e.target.value; const pos = e.target.selectionStart; render(true);
    const q = $("#q"); q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {}
  }
});

document.addEventListener("submit", async e => {
  if (e.target.id === "composer") {
    e.preventDefault();
    const input = $("#msgInput"), text = input.value.trim();
    if (!text || !S.activeChat) return;
    input.value = "";
    await addDoc(collection(db, "chats", S.activeChat, "messages"), { from: S.user.uid, type: "text", text, hidden: false, createdAt: serverTimestamp() })
      .catch(x => { toast("Message didn't send. " + x.message); input.value = text; });
    $("#msgInput")?.focus();
  }
  if (e.target.id === "profileForm") {
    e.preventDefault();
    const name = $("#p-name").value.trim();
    if (!name) return toast("Add your first name.");
    const yr = +$("#p-year").value;
    if (new Date().getFullYear() - yr < (S.settings.minAge || 21)) return toast(`You need to be ${S.settings.minAge || 21} or older.`);
    await busy(e.submitter, async () => {
      const patch = { name, birthYear: yr, city: $("#p-city").value.trim(), bio: $("#p-bio").value.trim(), openToMeet: $("#p-open").checked, tags: $("#p-tags").value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 8) };
      const f = $("#p-photo").files[0];
      if (f) {
        if (f.size > 5 * 1024 * 1024) throw new Error("Photo is over 5 MB. Try a smaller one.");
        const r = sref(storage, `nights/avatars/${S.user.uid}/photo`);
        await uploadBytes(r, f, { contentType: f.type });
        patch.photoURL = await getDownloadURL(r);
      }
      await updateDoc(doc(db, "users", S.user.uid), patch);
      toast("Profile saved");
    }).catch(x => toast(x.message));
  }
});
