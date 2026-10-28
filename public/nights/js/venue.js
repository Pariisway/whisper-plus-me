// Whisper+me Dates — venue dashboard (apply, create tickets, see dates, door check-in, payouts)
import {
  collection, doc, addDoc, updateDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref as sref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  BRAND, db, storage, call, authApi, $, esc, money, toDate, fmtWhen, ago, hueFrom, grad,
  applyBrand, toast, busy, confirmSheet, ticketCardHTML, renderSimpleAuth
} from "./common.js";

applyBrand("Venue");

const S = { user: null, venue: null, tickets: [], bookings: [], payouts: [], tab: "tickets",
  draft: { title: "", category: "Dinner", items: [], size: 2, price: "", when: "", qty: 10, note: "" } };
let unsubs = [];
const stop = () => { unsubs.forEach(u => u()); unsubs = []; };

const CATS = ["Dinner", "Activities", "Concerts", "Movies", "Other"];
const TYPES = ["Restaurant", "Movie theater", "Lounge", "Bar", "Live music", "Nightclub", "Entertainment", "Other"];
const PRESETS = ["2 movie tickets", "3-course dinner", "2 cocktails each", "Bottle of wine", "Popcorn combo", "Reserved booth", "Dessert", "Valet parking", "Skip-the-line entry", "Appetizer platter"];
const TABS = [["tickets", "Tickets"], ["bookings", "Dates booked"], ["checkin", "Door check-in"], ["payouts", "Payouts"], ["profile", "Venue profile"]];

authApi.onChange(rawUser => {
  const user = rawUser && !rawUser.isAnonymous ? rawUser : null; // Whisper+me guests need a real account here
  stop(); S.user = user; S.venue = null; S.listening = false;
  $("#meWrap").innerHTML = user ? `<button class="btn sm ghost" id="signOut">Sign out</button>` : "";
  if (!user) return renderSimpleAuth($("#app"), { eyebrow: `${BRAND.name} for venues`, title: "Sell the night", note: "Sign in or create an account to list your restaurant, theater or lounge." });
  $("#signOut").onclick = () => authApi.signOut();
  unsubs.push(onSnapshot(query(collection(db, "venues"), where("ownerUid", "==", user.uid), limit(1)), s => {
    S.venue = s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() };
    if (!S.venue) return renderApply();
    if (S.venue.status === "approved" && !S.listening) { S.listening = true; listen(); }
    render();
  }, e => { $("#app").innerHTML = `<div class="empty"><h3>Couldn't load your venue</h3><p>${esc(e.message)}</p></div>`; }));
});

function listen() {
  const vid = S.venue.id;
  unsubs.push(onSnapshot(query(collection(db, "tickets"), where("venueId", "==", vid), orderBy("startsAt", "desc"), limit(100)), s => { S.tickets = s.docs.map(d => ({ id: d.id, ...d.data() })); render(true); }));
  unsubs.push(onSnapshot(query(collection(db, "dates"), where("venueId", "==", vid), orderBy("createdAt", "desc"), limit(150)), s => { S.bookings = s.docs.map(d => ({ id: d.id, ...d.data() })); render(true); }));
  unsubs.push(onSnapshot(query(collection(db, "payouts"), where("venueId", "==", vid), orderBy("createdAt", "desc"), limit(150)), s => { S.payouts = s.docs.map(d => ({ id: d.id, ...d.data() })); render(true); }));
  const p = new URLSearchParams(location.search);
  if (p.get("stripe") === "done") {
    call("venueStripeStatus", { venueId: vid }).then(r => toast(r.payoutsEnabled ? "Payouts are set up" : "Stripe still needs a few details from you")).catch(() => {});
    history.replaceState(null, "", "/nights/venue");
  }
}

/* ================= application ================= */
function renderApply() {
  $("#app").innerHTML = `<section class="view">
    <div class="view-head"><div><div class="eyebrow">${esc(BRAND.name)} for venues</div><h1 class="display" style="margin-top:10px">List your venue</h1><p>Sell date-night packages to people looking for a good night out. We review every venue, usually within two business days.</p></div></div>
    <form class="panel" id="applyForm" novalidate style="max-width:760px">
      <div class="fields">
        <div class="field full"><label for="v-name">Venue name</label><input id="v-name" maxlength="60"></div>
        <div class="field"><label for="v-type">Type</label><select id="v-type">${TYPES.map(t => `<option>${t}</option>`).join("")}</select></div>
        <div class="field"><label for="v-phone">Phone</label><input id="v-phone" type="tel" maxlength="20"></div>
        <div class="field full"><label for="v-address">Street address</label><input id="v-address" maxlength="120"></div>
        <div class="field"><label for="v-city">City, state</label><input id="v-city" maxlength="60" placeholder="Belleville, IL"></div>
        <div class="field"><label for="v-contact">Your name</label><input id="v-contact" maxlength="60"></div>
        <div class="field full"><label for="v-desc">About the venue</label><textarea id="v-desc" maxlength="500" placeholder="What makes a night here special?"></textarea></div>
        <div class="field full"><span class="lbl">Business license</span><label class="file-drop"><input id="v-license" type="file" accept="image/*,application/pdf"></label><span class="hint">Photo or PDF, up to 10 MB</span></div>
        <div class="field full"><span class="lbl">Liquor license (if you serve alcohol)</span><label class="file-drop"><input id="v-liquor" type="file" accept="image/*,application/pdf"></label></div>
      </div>
      <label class="check"><input type="checkbox" id="v-terms"> I'm authorized to list this venue and agree that ${esc(BRAND.name)} keeps a platform fee from each ticket sold.</label>
      <div id="vErr" class="note" style="border-left-color:var(--rose)" hidden></div>
      <div style="display:flex;justify-content:flex-end"><button class="btn gold" type="submit">Submit for review</button></div>
    </form>
  </section>`;
  $("#applyForm").onsubmit = async e => {
    e.preventDefault();
    const err = m => { const x = $("#vErr"); x.hidden = false; x.textContent = m; };
    const v = id => $(id).value.trim();
    if (!v("#v-name") || !v("#v-address") || !v("#v-city") || !v("#v-phone")) return err("Fill in the venue name, phone, address and city.");
    const lic = $("#v-license").files[0];
    if (!lic) return err("Upload your business license so we can verify the venue.");
    if (!$("#v-terms").checked) return err("Check the box to confirm you can list this venue.");
    await busy(e.submitter, async () => {
      try {
        const docs = [];
        for (const [label, f] of [["license", lic], ["liquor", $("#v-liquor").files[0]]]) {
          if (!f) continue;
          if (f.size > 10 * 1024 * 1024) throw new Error(`The ${label} file is over 10 MB.`);
          const path = `nights/venueDocs/${S.user.uid}/${label}-${Date.now()}`;
          await uploadBytes(sref(storage, path), f, { contentType: f.type });
          docs.push({ label, path });
        }
        await addDoc(collection(db, "venues"), {
          name: v("#v-name"), type: $("#v-type").value, phone: v("#v-phone"), address: v("#v-address"), city: v("#v-city"),
          contactName: v("#v-contact"), description: v("#v-desc"), ownerUid: S.user.uid, ownerEmail: S.user.email || "",
          status: "pending", sales: 0, docs, docsUploaded: docs.length > 0, createdAt: serverTimestamp()
        });
        toast("Application sent");
      } catch (x) { err(x.message); }
    });
  };
}

/* ================= dashboard ================= */
function render(keep) {
  const v = S.venue; if (!v) return;
  const y = window.scrollY;
  if (v.status !== "approved") {
    const msg = {
      pending: ["Thanks, we got your application", `We're reviewing ${esc(v.name)} now. You'll be able to create tickets as soon as it's approved, usually within two business days.`],
      paused: ["Your venue is paused", `Your tickets are hidden from members right now. Reason: ${esc(v.pausedReason || "under review")}. Contact ${esc(BRAND.supportEmail)} to sort it out.`],
      declined: ["We couldn't approve this venue", `${esc(v.declinedReason || "It didn't meet our requirements.")} Contact ${esc(BRAND.supportEmail)} with questions.`]
    }[v.status] || ["Status: " + esc(v.status), ""];
    $("#app").innerHTML = `<div class="empty" style="margin-top:var(--s-5)"><div class="eyebrow">${esc(v.name)}</div><h3>${msg[0]}</h3><p style="max-width:52ch">${msg[1]}</p></div>`;
    return;
  }
  const views = { tickets: vTickets, bookings: vBookings, checkin: vCheckin, payouts: vPayouts, profile: vProfile };
  const confirmed = S.bookings.filter(b => b.status === "confirmed");
  const upcoming = confirmed.filter(b => toDate(b.startsAt) > new Date());
  const due = S.payouts.filter(p => p.status === "due").reduce((a, p) => a + p.amount, 0);
  $("#app").innerHTML = `<section class="view">
    <div class="view-head"><div><div class="eyebrow">Venue dashboard</div><h1 class="display" style="margin-top:10px">${esc(v.name)}</h1></div>
      ${v.payoutsEnabled ? '<span class="pill ok">Payouts on</span>' : '<button class="btn gold" id="stripeBtn">Set up payouts</button>'}</div>
    ${v.payoutsEnabled ? "" : `<div class="banner"><span>Connect a bank account through Stripe so we can send you money from ticket sales.</span></div>`}
    <div class="stats">
      <div class="stat"><small>Live tickets</small><b>${S.tickets.filter(t => t.status === "live" && !t.adminHidden && toDate(t.startsAt) > new Date()).length}</b></div>
      <div class="stat"><small>Upcoming dates</small><b>${upcoming.length}</b></div>
      <div class="stat"><small>Earned to date</small><b>${money(S.payouts.filter(p => p.status !== "void").reduce((a, p) => a + p.amount, 0))}</b></div>
      <div class="stat"><small>Payout coming</small><b>${money(due)}</b></div>
    </div>
    <div class="admin"><nav class="amenu" aria-label="Venue sections">${TABS.map(([k, l]) => `<button data-tab="${k}" aria-current="${S.tab === k}">${l}</button>`).join("")}</nav>
    <div class="amain">${views[S.tab]()}</div></div>
  </section>`;
  if (keep) window.scrollTo(0, y);
  const sb = $("#stripeBtn");
  if (sb) sb.onclick = () => busy(sb, async () => { try { location.href = (await call("venueStripeLink", { venueId: v.id })).url; } catch (x) { toast(x.message); } });
}

function draftTicket() {
  const d = S.draft;
  return { id: "preview", title: d.title || "Untitled night", venueName: S.venue.name, category: d.category, items: d.items.length ? d.items : ["Add what's included"],
    size: +d.size, price: Math.round((+d.price || 0) * 100), startsAt: d.when ? new Date(d.when) : null, quantity: +d.qty || 0, sold: 0, held: 0, hue: hueFrom(d.title || "x") };
}
const previewHTML = () => ticketCardHTML(draftTicket(), { asButton: false });

function vTickets() {
  const d = S.draft;
  const now = new Date();
  return `<div class="ahead"><div><h2>Create a ticket</h2><p>A ticket is a date package: what's included, how many people, one price. Members can split it evenly or one person can pay for everyone.</p></div></div>
    <div class="builder">
      <form class="panel" id="builder" novalidate>
        <div class="fields">
          <div class="field full"><label for="f-title">Ticket name</label><input id="f-title" value="${esc(d.title)}" placeholder="e.g. Candlelight Booth" maxlength="40"></div>
          <div class="field"><label for="f-cat">Category</label><select id="f-cat">${CATS.map(c => `<option ${d.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
          <div class="field"><span class="lbl">Party size</span><div class="seg" role="group" aria-label="Party size">${[2, 4].map(n => `<button type="button" data-size="${n}" aria-pressed="${+d.size === n}">${n} people</button>`).join("")}</div></div>
          <div class="field full"><span class="lbl">What's included</span>
            <div class="chosen">${d.items.map((it, i) => `<span class="tag">${esc(it)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(it)}">×</button></span>`).join("")}</div>
            <div class="item-entry"><input id="f-item" maxlength="40" placeholder="Type an item and press Enter" aria-label="Add an included item"><button type="button" class="btn sm" id="addItem">Add</button></div>
            <div class="presets">${PRESETS.filter(p => !d.items.includes(p)).map(p => `<button type="button" class="chip" data-preset="${esc(p)}">+ ${esc(p)}</button>`).join("")}</div>
          </div>
          <div class="field"><label for="f-price">Price for the whole party ($)</label><input id="f-price" type="number" min="5" step="1" inputmode="decimal" value="${esc(d.price)}" placeholder="120"><span class="hint" id="splitHint">${d.price ? `${money(Math.floor(d.price * 100 / d.size))} per person if they split` : "Members can split this evenly"}</span></div>
          <div class="field"><label for="f-qty">How many of this ticket</label><input id="f-qty" type="number" min="1" value="${esc(d.qty)}"></div>
          <div class="field full"><label for="f-when">Date & start time</label><input id="f-when" type="datetime-local" value="${esc(d.when)}"></div>
          <div class="field full"><label for="f-note">Details for guests</label><textarea id="f-note" maxlength="400" placeholder="Dress code, ID rules, how long the table is held…">${esc(d.note)}</textarea></div>
          <div class="field full"><span class="lbl">Cover photo (optional)</span><label class="file-drop"><input id="f-img" type="file" accept="image/*"></label></div>
        </div>
        <div id="formErr" class="note" style="border-left-color:var(--rose)" hidden></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button type="button" class="btn ghost" id="resetDraft">Clear</button><button type="submit" class="btn gold">Publish ticket</button></div>
      </form>
      <div class="preview-col"><div class="eyebrow">How members will see it</div><div id="preview">${previewHTML()}</div></div>
    </div>
    <div class="section-title"><h2>Your tickets</h2></div>
    ${S.tickets.length ? `<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>When</th><th>Party</th><th>Price</th><th>Sold</th><th>Status</th><th></th></tr></thead><tbody>
    ${S.tickets.map(t => {
      const past = toDate(t.startsAt) < now;
      const status = t.adminHidden ? '<span class="pill rose">Hidden by support</span>' : past || t.status === "ended" ? '<span class="pill gold">Ended</span>' : t.status === "paused" ? '<span class="pill warn">Paused</span>' : t.sold + t.held >= t.quantity ? '<span class="pill rose">Sold out</span>' : '<span class="pill ok">For sale</span>';
      const act = past || t.status === "ended" ? "" : t.status === "live" ? `<button class="btn sm" data-tstatus="${t.id}:paused">Pause</button>` : `<button class="btn sm gold" data-tstatus="${t.id}:live">Resume</button>`;
      return `<tr><td><span class="swatch-sm" style="background:${grad(t.hue ?? hueFrom(t.title))}"></span><b>${esc(t.title)}</b></td><td>${esc(fmtWhen(t.startsAt))}</td><td class="num">${t.size}</td><td class="num">${money(t.price)}</td><td class="num">${t.sold}${t.held ? ` (+${t.held} pending)` : ""} / ${t.quantity}</td><td>${status}</td><td><div class="row-actions">${act}${past ? "" : `<button class="btn sm ghost" data-addqty="${t.id}">+5 tickets</button>`}</div></td></tr>`;
    }).join("")}</tbody></table></div>` : `<div class="empty"><h3>No tickets yet</h3><p>Your first ticket shows up here once you publish it.</p></div>`}`;
}

function vBookings() {
  const pill = { forming: ["warn", "Filling up"], confirmed: ["ok", "Booked"], completed: ["gold", "Done"], canceled: ["rose", "Canceled"] };
  const list = S.bookings.filter(b => b.live || b.status !== "forming");
  return `<div class="ahead"><div><h2>Dates booked</h2><p>Every date booked on your tickets. "Booked" means fully paid. Each guest has their own door code. You're paid after the date happens.</p></div></div>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>When</th><th>Guests</th><th>Total</th><th>Status</th><th>Checked in</th></tr></thead><tbody>
    ${list.map(b => {
      const [c, l] = pill[b.status] || ["gold", b.status];
      const going = (b.seats || []).filter(x => x.uid && ["paid", "joined"].includes(x.status));
      const here = (b.seats || []).filter(x => x.checkedInAt).length;
      return `<tr><td><b>${esc(b.title)}</b></td><td>${esc(fmtWhen(b.startsAt))}</td><td>${going.map(x => esc(x.name)).join(", ") || "—"} <span class="muted">(party of ${b.size})</span></td><td class="num">${money(b.total)}</td><td><span class="pill ${c}">${l}</span></td><td class="num">${b.status === "confirmed" || b.status === "completed" ? `${here} of ${going.length}` : "—"}</td></tr>`;
    }).join("")}
    </tbody></table></div>` : `<div class="empty"><h3>No dates yet</h3><p>When members book your tickets, they show up here.</p></div>`}`;
}

function vCheckin() {
  const today = S.bookings.filter(b => b.status === "confirmed" && toDate(b.startsAt)?.toDateString() === new Date().toDateString());
  const seatsToday = today.flatMap(b => (b.seats || []).filter(x => x.code).map(x => ({ ...x, title: b.title, startsAt: b.startsAt })));
  return `<div class="ahead"><div><h2>Door check-in</h2><p>Each guest has their own code starting with WN-. Enter it when they arrive. Checking guests in matters: it's how no-shows are handled fairly.</p></div></div>
    <form class="panel" id="checkinForm"><div class="checkin"><input id="ci-code" placeholder="WN-XXXXX" autocomplete="off" aria-label="Ticket code" maxlength="8"><button class="btn gold" type="submit">Check in</button></div><div id="ciResult"></div></form>
    <div class="section-title"><h2 style="font-size:22px">Tonight's guests</h2><span class="muted" style="font-size:13px">${seatsToday.filter(x => x.checkedInAt).length} of ${seatsToday.length} checked in</span></div>
    ${seatsToday.length ? `<div class="table-wrap"><table><thead><tr><th>Guest</th><th>Ticket</th><th>Time</th><th>Status</th></tr></thead><tbody>${seatsToday.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.title)}</td><td>${esc(fmtWhen(x.startsAt).split(" · ")[1])}</td><td>${x.checkedInAt ? '<span class="pill ok">Here</span>' : '<span class="pill gold">Expected</span>'}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty" style="padding:var(--s-5)"><p style="margin:0">No guests booked for today.</p></div>`}`;
}

function vPayouts() {
  const v = S.venue;
  return `<div class="ahead"><div><h2>Payouts</h2><p>After each date happens, you get the ticket price minus the ${esc(BRAND.name)} fee. Payouts go to the bank account you connected through Stripe.</p></div>${v.payoutsEnabled ? '<span class="pill ok">Bank connected</span>' : ""}</div>
    ${S.payouts.length ? `<div class="table-wrap"><table><thead><tr><th>Booking</th><th>Ticket price</th><th>Fee</th><th>You get</th><th>Status</th></tr></thead><tbody>
    ${S.payouts.map(p => `<tr><td class="num">${esc(p.code || p.bookingId)}</td><td class="num">${money(p.gross)}</td><td class="num">${money(p.fee)}</td><td class="num"><b>${money(p.amount)}</b></td><td>${p.status === "paid" ? '<span class="pill ok">Paid</span>' : p.status === "void" ? '<span class="pill rose">Refunded</span>' : '<span class="pill warn">Coming</span>'}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><h3>Nothing yet</h3><p>Payouts appear here after your first confirmed booking.</p></div>`}`;
}

function vProfile() {
  const v = S.venue;
  return `<div class="ahead"><div><h2>Venue profile</h2><p>Members see your name on every ticket. Changing your name updates new tickets.</p></div></div>
    <form class="panel" id="vProfile" novalidate><div class="fields">
      <div class="field full"><label for="vp-name">Venue name</label><input id="vp-name" maxlength="60" value="${esc(v.name)}"></div>
      <div class="field"><label for="vp-phone">Phone</label><input id="vp-phone" maxlength="20" value="${esc(v.phone || "")}"></div>
      <div class="field"><label for="vp-city">City, state</label><input id="vp-city" maxlength="60" value="${esc(v.city || "")}"></div>
      <div class="field full"><label for="vp-address">Street address</label><input id="vp-address" maxlength="120" value="${esc(v.address || "")}"></div>
      <div class="field full"><label for="vp-desc">About the venue</label><textarea id="vp-desc" maxlength="500">${esc(v.description || "")}</textarea></div>
    </div><div style="display:flex;justify-content:flex-end"><button class="btn gold" type="submit">Save</button></div></form>`;
}

/* ================= events ================= */
const refreshPreview = () => { const p = $("#preview"); if (p) p.innerHTML = previewHTML(); };
function addItem() {
  const i = $("#f-item"); const v = i.value.trim(); if (!v) return;
  if (S.draft.items.length >= 8) return toast("Keep it to 8 items or fewer.");
  S.draft.items.push(v.slice(0, 40)); render(true); $("#f-item").focus();
}
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-tab],[data-size],[data-preset],[data-rm],[data-tstatus],[data-addqty],#addItem,#resetDraft");
  if (!el || !S.venue) return;
  const d = el.dataset;
  if (d.tab) { S.tab = d.tab; return render(); }
  if (d.size) { S.draft.size = +d.size; return render(true); }
  if (d.preset) { if (S.draft.items.length < 8) S.draft.items.push(d.preset); return render(true); }
  if (d.rm) { S.draft.items.splice(+d.rm, 1); return render(true); }
  if (el.id === "addItem") return addItem();
  if (el.id === "resetDraft") { S.draft = { title: "", category: S.draft.category, items: [], size: 2, price: "", when: "", qty: 10, note: "" }; return render(true); }
  if (d.tstatus) {
    const [id, status] = d.tstatus.split(":");
    if (status === "paused" && !(await confirmSheet({ title: "Pause this ticket?", body: "Members won't see it until you resume. Existing bookings stay as they are.", yes: "Pause" }))) return;
    return updateDoc(doc(db, "tickets", id), { status }).then(() => toast(status === "live" ? "Ticket is for sale again" : "Ticket paused")).catch(x => toast(x.message));
  }
  if (d.addqty) { const t = S.tickets.find(x => x.id === d.addqty); return updateDoc(doc(db, "tickets", t.id), { quantity: t.quantity + 5 }).then(() => toast("Added 5 more")).catch(x => toast(x.message)); }
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "f-item") { e.preventDefault(); addItem(); } });
document.addEventListener("input", e => {
  const map = { "f-title": "title", "f-cat": "category", "f-price": "price", "f-qty": "qty", "f-when": "when", "f-note": "note" };
  const k = map[e.target.id]; if (!k) return;
  S.draft[k] = e.target.value; refreshPreview();
  if (k === "price") $("#splitHint").textContent = S.draft.price ? `${money(Math.floor(S.draft.price * 100 / S.draft.size))} per person if they split` : "Members can split this evenly";
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "builder") {
    const d = S.draft, err = m => { const x = $("#formErr"); x.hidden = false; x.textContent = m; };
    const miss = [];
    if (!d.title.trim()) miss.push("a ticket name");
    if (!d.items.length) miss.push("at least one included item");
    if (!(+d.price >= 5)) miss.push("a price of at least $5");
    if (!d.when) miss.push("a date and time");
    if (miss.length) return err("Add " + miss.join(", ") + " to publish.");
    const when = new Date(d.when);
    if (when < new Date(Date.now() + 60 * 60000)) return err("Pick a start time at least an hour from now.");
    await busy(e.submitter, async () => {
      try {
        let imageURL = "";
        const f = $("#f-img").files[0];
        if (f) {
          if (f.size > 5 * 1024 * 1024) throw new Error("Cover photo is over 5 MB.");
          const r = sref(storage, `nights/ticketImages/${S.user.uid}/${Date.now()}`);
          await uploadBytes(r, f, { contentType: f.type });
          imageURL = await getDownloadURL(r);
        }
        await addDoc(collection(db, "tickets"), {
          venueId: S.venue.id, venueName: S.venue.name, title: d.title.trim(), category: d.category, items: [...d.items],
          size: +d.size, price: Math.round(+d.price * 100), startsAt: Timestamp.fromDate(when), quantity: Math.max(1, Math.round(+d.qty || 1)),
          note: d.note.trim(), hue: hueFrom(d.title), imageURL, status: "live", adminHidden: false, sold: 0, held: 0, createdAt: serverTimestamp()
        });
        S.draft = { title: "", category: d.category, items: [], size: 2, price: "", when: "", qty: 10, note: "" };
        toast(`“${d.title.trim()}” is live`);
        render(true);
      } catch (x) { err(x.message); }
    });
  }
  if (e.target.id === "checkinForm") {
    const code = $("#ci-code").value.trim().toUpperCase(), out = $("#ciResult");
    if (!code) return;
    await busy(e.submitter, async () => {
      try {
        const r = await call("checkIn", { code });
        out.innerHTML = `<div class="banner ${r.already ? "" : "ok"}" style="margin-top:12px"><span><b>${r.already ? "Already checked in" : "Checked in"}: ${esc(r.guest)}</b> · ${esc(r.title)} · party: ${r.party.map(x => esc(x.name) + (x.here ? " ✓" : "")).join(", ")}</span></div>`;
        $("#ci-code").value = "";
      } catch (x) { out.innerHTML = `<div class="banner rose" style="margin-top:12px"><span>${esc(x.message)}</span></div>`; }
    });
  }
  if (e.target.id === "vProfile") {
    const g = id => $(id).value.trim();
    if (!g("#vp-name")) return toast("Your venue needs a name.");
    await busy(e.submitter, () => updateDoc(doc(db, "venues", S.venue.id), { name: g("#vp-name"), phone: g("#vp-phone"), city: g("#vp-city"), address: g("#vp-address"), description: g("#vp-desc") })
      .then(() => toast("Saved")).catch(x => toast(x.message)));
  }
});
