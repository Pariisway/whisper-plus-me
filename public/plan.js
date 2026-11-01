/* ═══════════════════════════════════════════════════════════════
   WHISPER+ME 📍 PLAN A DATE: the third tab on the ⭐ M&G screen.
   Anyone, in any city, posts a date at a real public place and pays a
   small listing fee. People tap "I'm interested" (free). The creator
   picks one; that person confirms; they can message each other; both
   tap "I'm here" at the place. They pay the place themselves.
   All rules and money live in Cloud Functions (functions-nights);
   this file only shows things and calls them.
═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var NEAR_KM = 40; // "near me" = about 25 miles
  var PAYS = { split: ["🤝", "We split it"], me: ["💝", "I'll treat"], each: ["🧾", "Each pays our own"] };
  var P = { list: [], loaded: false, mine: [], mineLoaded: false, fee: 499, credit: 0, near: null, where: null, unsub: null, uid: null, chatOff: null };

  /* ---------- helpers (same look as dates.js) ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(c) { var n = (c || 0) / 100; return "$" + (n % 1 ? n.toFixed(2) : n); }
  function ms(t) { return t && t.toMillis ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : Number(t) || 0); }
  var MY_TZ = ""; try { MY_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
  /* A date's time is shown in the place's own time zone (with "PST" etc. when that isn't yours). */
  function when(t, tz) {
    if (!ms(t)) return "";
    var d = new Date(ms(t)), o = {}, other = tz && tz !== MY_TZ;
    try { if (tz) { new Intl.DateTimeFormat("en-US", { timeZone: tz }); o.timeZone = tz; } } catch (e) { other = false; }
    return d.toLocaleDateString("en-US", Object.assign({ weekday: "short", month: "short", day: "numeric" }, o)) + " · " + d.toLocaleTimeString("en-US", Object.assign({ hour: "numeric", minute: "2-digit" }, o, other ? { timeZoneName: "short" } : {}));
  }
  function hue(str) { var h = 0; String(str).split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }
  function grad(h) { return "linear-gradient(135deg,hsl(" + h + " 60% 32%),hsl(" + ((h + 40) % 360) + " 65% 16%) 70%,#0b0b16)"; }
  function toast(m, type) { if (window.showToast) window.showToast(m, type || "success", 3500); else alert(m); }
  function fn(name, data) {
    return firebase.functions().httpsCallable(name)(data || {}).then(function (r) { return r.data; })
      .catch(function (e) { throw new Error((e && e.message) || "Something went wrong. Try again."); });
  }
  function me() { var u = firebase.auth().currentUser; return u && !u.isAnonymous ? u : null; }
  function $i(id) { return document.getElementById(id); }
  function avatar(p, size) {
    size = size || 34;
    var st = "width:" + size + "px;height:" + size + "px;border-radius:50%;flex:none;display:inline-grid;place-items:center;font-weight:800;color:#fff;font-size:" + Math.round(size * .42) + "px;background:" + grad(hue(p && p.name || "?")) + ";overflow:hidden";
    return p && p.photo ? "<span style='" + st + "'><img src='" + esc(p.photo) + "' alt='' style='width:100%;height:100%;object-fit:cover'></span>"
      : "<span style='" + st + "'>" + esc(((p && p.name) || "?")[0].toUpperCase()) + "</span>";
  }
  function busy(btn, p) {
    if (!btn) return p;
    var old = btn.innerHTML; btn.disabled = true; btn.innerHTML = "…";
    return p.then(function (v) { btn.disabled = false; btn.innerHTML = old; return v; }, function (e) { btn.disabled = false; btn.innerHTML = old; throw e; });
  }
  /* "I'll treat" is the creator's words; everyone else sees "Zoe treats". */
  function paysText(x) {
    var mineIt = x.mine === true || (x.mine === undefined && x.creatorUid === P.uid);
    if (x.pays === "me" && !mineIt) return String(x.creatorName || "They").trim().split(/\s+/)[0] + " treats";
    if (x.pays === "each" && !mineIt) return "Each pays their own";
    return (PAYS[x.pays] || PAYS.split)[1];
  }
  function stars(r) { return r && r.n ? "<span class='dt-stars'>★ " + Number(r.avg).toFixed(1) + " <small>(" + r.n + ")</small></span>" : ""; }
  function openModal(html) {
    var modal = $i("profileModal"), body = $i("profileModalBody");
    if (!modal || !body) return null;
    body.innerHTML = "<button onclick='Plan.closeModal()' aria-label='Close' style='position:absolute;top:12px;right:14px;background:none;border:none;color:#888;font-size:22px;cursor:pointer;z-index:2;min-width:32px;min-height:32px'>✕</button><div class='dt-sheet'>" + html + "</div>";
    modal.style.display = "flex";
    return body;
  }
  function closeModal() { stopChat(); if (window.closeProfileModal) window.closeProfileModal(); }
  function redraw() { if (window.Dates && window.Dates.refresh) window.Dates.refresh(); }
  function kmBetween(a, b, c, d) { var r = function (x) { return x * Math.PI / 180; }, h = Math.pow(Math.sin(r(c - a) / 2), 2) + Math.cos(r(a)) * Math.cos(r(c)) * Math.pow(Math.sin(r(d - b) / 2), 2); return 12742 * Math.asin(Math.sqrt(h)); }
  function needYear() { return window.Dates && window.Dates.needsBirthYear && window.Dates.needsBirthYear(); }
  function birthYearField(id) {
    var yr = new Date().getFullYear(), opts = "";
    for (var y = yr - 21; y >= yr - 90; y--) opts += "<option>" + y + "</option>";
    return "<div><div class='lbl'>Your birth year <small>(dates are 21+, asked once)</small></div><select id='" + id + "' class='dt-in'><option value=''>Pick a year</option>" + opts + "</select></div>";
  }
  function yearRetry(e, reopen) { if (/birth year/i.test((e && e.message) || "") && window.Dates && window.Dates.forgetMember) { window.Dates.forgetMember(); setTimeout(reopen, 0); return true; } return false; }

  var css = "\
.pd-bar{display:flex;gap:8px;margin:0 12px 8px;align-items:center}\
.pd-bar .dt-btn{flex:1;min-height:42px}\
.pd-near{flex:none;display:flex;gap:2px;padding:3px;border-radius:999px;background:#15152a;border:1px solid rgba(255,255,255,.08)}\
.pd-near button{border:0;border-radius:999px;background:none;color:#a59cc4;font-weight:800;font-size:11.5px;padding:6px 9px;cursor:pointer;min-height:32px}\
.pd-near button[aria-pressed=true]{background:#00e3ae;color:#06281f}\
.dt-card.pd{border-color:rgba(0,227,174,.35)}\
.pd-req{display:flex;gap:10px;align-items:flex-start;background:#0b0b16;border-radius:12px;padding:10px;margin-top:8px}\
.pd-req .t{flex:1;min-width:0;font-size:13px}.pd-req .t .f{display:block;color:#9a8fb5;font-size:12px;margin-top:2px}\
.pd-req .t q{display:block;color:#ddd;font-style:italic;margin-top:4px}\
.pd-req .a{display:flex;flex-direction:column;gap:6px;flex:none}\
.pd-req .a .dt-btn{min-height:34px;padding:6px 12px}\
.pd-chat{display:flex;flex-direction:column;gap:6px;max-height:42vh;min-height:140px;overflow-y:auto;background:#0b0b16;border-radius:12px;padding:10px}\
.pd-msg{max-width:80%;padding:7px 11px;border-radius:14px;font-size:14px;line-height:1.35;background:#1d1b33;align-self:flex-start;word-break:break-word}\
.pd-msg.me{background:#5b2bd6;align-self:flex-end}\
.pd-msg small{display:block;font-size:10.5px;color:#b3abcf;margin-bottom:2px}\
.pd-pays{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}\
.pd-pays button{border:1px solid rgba(255,255,255,.12);background:#0b0b16;color:#ddd;border-radius:12px;padding:9px 4px;font-size:12px;font-weight:700;cursor:pointer;min-height:54px}\
.pd-pays button b{display:block;font-size:18px}\
.pd-pays button[aria-pressed=true]{border-color:#00e3ae;background:rgba(0,227,174,.12);color:#fff}\
";
  var styleEl = document.createElement("style"); styleEl.textContent = css; document.head.appendChild(styleEl);

  /* ---------- data ---------- */
  function start() {
    var u = firebase.auth().currentUser;
    if (!u || !firebase.firestore) return;
    if (P.unsub && P.uid === u.uid) return;
    stop(); P.uid = u.uid;
    P.unsub = firebase.firestore().collection("plans").where("status", "==", "live").where("hidden", "==", false).orderBy("startsAt").limit(150).onSnapshot(function (s) {
      var now = Date.now();
      P.list = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).filter(function (x) { return ms(x.startsAt) > now + 3 * 3600000; });
      P.loaded = true; redraw();
    }, function (e) { P.loaded = true; console.warn("plans", e.message); redraw(); });
    if (!u.isAnonymous) load();
    if (!P.where) {
      var mu = (window.allUsers || {})[u.uid] || window.me || {};
      if (mu.lat && mu.lng) P.where = { lat: mu.lat, lng: mu.lng };
      else { try { var c = JSON.parse(localStorage.getItem("wpmNear") || "null"); if (c && Date.now() - c.at < 7 * 864e5) P.where = c; } catch (e) {} }
      if (P.near === null) P.near = !!P.where;
    }
  }
  function stop() { if (P.unsub) { try { P.unsub(); } catch (e) {} } P.unsub = null; }
  function load() {
    if (!me()) return Promise.resolve();
    return fn("myPlans").then(function (r) { P.mine = r.plans || []; P.fee = r.fee != null ? r.fee : P.fee; P.credit = r.credit || 0; P.mineLoaded = true; redraw(); openPending(); }, function () { P.mineLoaded = true; });
  }
  firebase.auth().onAuthStateChanged(function (u) { if (!u) { stop(); P.mine = []; P.list = []; P.uid = null; } });

  function shown() {
    var list = P.list.slice();
    if (P.near && P.where) {
      list = list.filter(function (x) { return x.lat != null && kmBetween(P.where.lat, P.where.lng, x.lat, x.lon) <= NEAR_KM; });
    }
    return list;
  }
  function distLabel(x) { if (!P.where || x.lat == null) return ""; var mi = kmBetween(P.where.lat, P.where.lng, x.lat, x.lon) * 0.621; return mi < 1 ? " · nearby" : " · " + Math.round(mi) + " mi"; }

  /* ---------- phone frame: open dates ---------- */
  function card(x) {
    var mine = x.creatorUid === P.uid, pays = PAYS[x.pays] || PAYS.split;
    return "<button class='dt-card pd' onclick=\"Plan.open('" + x.id + "')\">"
      + "<div class='dt-poster' style='background:" + grad(hue(x.title)) + "'>" + (x.creatorPhoto ? "<img src='" + esc(x.creatorPhoto) + "' alt=''>" : "")
      + "<div class='k'><span>📍 " + esc((x.city || "").split(",")[0]) + esc(distLabel(x)) + "</span><span>" + (mine ? "Yours" : x.requests ? x.requests + " interested" : "New") + "</span></div>"
      + "<b>" + esc(x.title) + "</b></div>"
      + "<div class='dt-body'><div class='v'>" + avatar({ name: x.creatorName, photo: x.creatorPhoto }, 32)
      + "<div class='t'><div>" + esc(x.creatorName) + (x.creatorRating ? " · " + stars(x.creatorRating) : "") + "</div><div>" + esc(when(x.startsAt, x.tz)) + "</div><div>📍 " + esc(x.venueName) + "</div></div></div>"
      + "<div class='dt-price'><b style='font-size:20px'>" + pays[0] + "</b><small>" + esc(paysText(x)) + "</small></div></div></button>";
  }
  function phoneHTML() {
    start();
    var list = shown(), anon = !me();
    var bar = "<div class='pd-bar'>" + (anon ? "" : "<button class='dt-btn teal' onclick='Plan.create()'>📍 Plan a date</button>")
      + "<div class='pd-near' role='group' aria-label='Where'><button aria-pressed='" + !!P.near + "' onclick='Plan.setNear(true)'>Near me</button><button aria-pressed='" + !P.near + "' onclick='Plan.setNear(false)'>Everywhere</button></div></div>";
    var body = !P.loaded ? "<div class='dt-empty'>Loading dates…</div>"
      : list.length ? list.map(card).join("")
      : "<div class='dt-empty'>" + (P.near && P.where ? "No open dates near you yet." + (P.list.length ? " <button class='dt-btn ghost' style='margin:8px auto 0;display:block' onclick='Plan.setNear(false)'>See " + P.list.length + " elsewhere</button>" : "") : "No open dates right now.") + "<br>" + (anon ? "Sign up free to plan one." : "Be the first: plan one in a minute.") + "</div>";
    return bar + "<div class='dt-list'>" + body + "</div>";
  }

  /* ---------- panel: your dates ---------- */
  var ST = { draft: ["warn", "Fee not paid"], live: ["ok", "Open"], matched: ["purple", "Waiting to confirm"], confirmed: ["ok", "It's a date"], completed: ["purple", "Done"], expired: ["bad", "No match"], canceled: ["bad", "Called off"], removed: ["bad", "Removed"],
    asked: ["purple", "You asked"], declined: ["bad", "Not this time"], filled: ["bad", "Filled"], closed: ["bad", "Called off"], withdrawn: ["bad", "Taken back"], passed: ["bad", "You passed"], lapsed: ["bad", "Not confirmed"] };
  function reqRow(x, r) {
    var facts = [r.rating ? stars(r.rating) : "New to dates", r.datesDone ? r.datesDone + " date" + (r.datesDone === 1 ? "" : "s") : "", r.noShows ? "<span style='color:#ff8a80'>" + r.noShows + " no-show" + (r.noShows === 1 ? "" : "s") + "</span>" : ""].filter(Boolean).join(" · ");
    return "<div class='pd-req'>" + "<button style='background:none;border:0;padding:0;cursor:pointer' onclick=\"Plan.profile('" + esc(r.uid) + "')\" aria-label='See profile'>" + avatar(r, 44) + "</button>"
      + "<div class='t'><b>" + esc(r.name) + "</b><span class='f'>" + facts + "</span>" + (r.note ? "<q>" + esc(r.note) + "</q>" : "") + "</div>"
      + (r.status === "pending" && x.status === "live" ? "<div class='a'><button class='dt-btn teal' onclick=\"Plan.answer('" + x.id + "','" + esc(r.uid) + "',true,this)\">Pick</button><button class='dt-btn ghost' onclick=\"Plan.answer('" + x.id + "','" + esc(r.uid) + "',false,this)\">No</button></div>"
        : r.status === "approved" ? "<span class='dt-pill purple'>Picked</span>" : "")
      + "</div>";
  }
  function box(x) {
    var st = ST[x.status] || ["warn", x.status], now = Date.now(), pays = PAYS[x.pays] || PAYS.split;
    var other = x.mine ? { name: x.guestName, photo: x.guestPhoto, uid: x.guestUid } : { name: x.creatorName, photo: x.creatorPhoto, uid: x.creatorUid };
    var on = x.status === "confirmed", picked = x.status === "matched" || on, hereOpen = on && now > x.startsAt - 3600000 && now < x.startsAt + 3 * 3600000;
    var head = "<div class='dt-row'><h3 style='margin:0'>📍 " + esc(x.title) + "</h3><span class='dt-pill " + st[0] + "'>" + st[1] + "</span></div>"
      + "<p style='margin:6px 0'>" + esc(when(x.startsAt, x.tz)) + " · " + esc(x.venueName) + ", " + esc((x.city || "").split(",")[0]) + " · " + pays[0] + " " + esc(paysText(x)) + "</p>";
    var next = "", acts = [];
    if (x.mine) {
      if (x.status === "draft") { next = "Pay the " + money(x.fee) + " listing fee to put it up."; acts.push("<button class='dt-btn' onclick=\"Plan.pay('" + x.id + "',this)\">Pay " + money(x.fee) + "</button>"); }
      if (x.status === "live") next = (x.requests || []).length ? "Tap <b>Pick</b> on the person you want to go with. Everyone else is told it's filled." : "Open! We'll tell you when someone's interested. Share it to get more.";
      if (x.status === "matched") next = "You picked <b>" + esc(x.guestName) + "</b>. They have until " + esc(when(x.confirmBy, x.tz)) + " to confirm.";
      if (x.status === "expired") next = x.feeReturned ? "Nobody was matched, so your " + money(x.fee) + " is back as credit. Try another day or place!" : "Nobody was matched.";
      if (x.status === "live") acts.push("<button class='dt-btn ghost' onclick=\"Plan.share('" + x.id + "')\">↗ Share</button>");
      if (["draft", "live", "matched", "confirmed"].indexOf(x.status) > -1) acts.push("<button class='dt-btn red' onclick=\"Plan.cancel('" + x.id + "',this)\">Call it off</button>");
    } else {
      if (x.status === "asked") { next = "Waiting for " + esc(x.creatorName) + " to pick."; acts.push("<button class='dt-btn ghost' onclick=\"Plan.withdraw('" + x.id + "',this)\">Take it back</button>"); }
      if (x.status === "matched") { next = "<b>" + esc(x.creatorName) + " picked you!</b> Confirm by " + esc(when(x.confirmBy, x.tz)) + ", or it goes to someone else."; acts.push("<button class='dt-btn teal' onclick=\"Plan.confirm('" + x.id + "',true,this)\">✅ Confirm</button><button class='dt-btn ghost' onclick=\"Plan.confirm('" + x.id + "',false,this)\">Can't make it</button>"); }
      if (x.status === "confirmed") acts.push("<button class='dt-btn red' onclick=\"Plan.withdraw('" + x.id + "',this)\">Back out</button>");
      if (["declined", "filled", "lapsed"].indexOf(x.status) > -1) next = "Not this time. Plenty more dates near you.";
    }
    if (on) next = "You're meeting <b>" + esc(other.name) + "</b>. Pay the place directly. Tap <b>I'm here</b> when you arrive." + (x.otherHere ? " <b style='color:#00e3ae'>" + esc(other.name) + " is here.</b>" : "");
    var place = on && x.address ? "<div class='dt-rules'>📍 <b>" + esc(x.venueName) + "</b><br>" + esc(x.address) + ", " + esc(x.city) + (x.venuePhone ? "<br>📞 <a href='tel:" + esc(String(x.venuePhone).replace(/[^0-9+]/g, "")) + "' style='color:#00e3ae'>" + esc(x.venuePhone) + "</a>" : "")
      + "<br><a href='https://maps.google.com/?q=" + encodeURIComponent(x.venueName + ", " + x.address + ", " + x.city) + "' target='_blank' rel='noopener' style='color:#00e3ae'>Directions ↗</a></div>" : "";
    var top = [];
    if (picked) top.push("<button class='dt-btn' onclick=\"Plan.chat('" + x.id + "')\">💬 Message " + esc(other.name) + "</button>");
    if (on && hereOpen && !x.here) top.push("<button class='dt-btn teal' onclick=\"Plan.here('" + x.id + "',this)\">📍 I'm here</button>");
    if (on && x.here) top.push("<span class='dt-pill ok'>✅ You checked in</span>");
    if (on) top.push("<button class='dt-btn ghost' onclick=\"Plan.tellFriend('" + x.id + "')\">🛟 Share with a friend</button>");
    return "<div class='dt-box' style='border-color:rgba(0,227,174,.35)'>" + head
      + (next ? "<div class='dt-next'>" + next + "</div>" : "") + place
      + (x.mine && (x.requests || []).length ? "<div><div class='lbl' style='font-size:11px;color:#9a8fb5;font-weight:800;letter-spacing:.08em;margin-top:8px'>WHO'S INTERESTED</div>" + x.requests.map(function (r) { return reqRow(x, r); }).join("") + "</div>" : "")
      + (x.canRate ? "<div class='dt-rate'><span>" + (x.myStars ? "You rated " + esc(other.name) : "How was your date?") + "</span><button class='dt-btn ghost' style='min-height:34px' onclick=\"Plan.rate('" + x.id + "')\">" + (x.myStars ? "★ " + x.myStars : "Rate") + "</button></div>" : "")
      + (top.length ? "<div class='dt-actions' style='margin-top:10px'>" + top.join("") + "</div>" : "")
      + (acts.length ? "<div class='dt-actions' style='margin-top:8px'>" + acts.join("") + "</div>" : "")
      + "</div>";
  }
  function how() {
    return "<div class='dt-box' style='border-color:rgba(0,227,174,.4)'><h3>📍 How Plan a Date works</h3><p>Plan your own date anywhere, at a real public place. Pick who you go with.</p><ol class='dt-steps'>"
      + "<li><b>1</b><strong>Post it</strong>The place, the time, the plan. " + (P.fee ? money(P.fee) + " to list." : "Free to list.") + "</li>"
      + "<li><b>2</b><strong>Pick someone</strong>People tap “I'm interested.” You choose one.</li>"
      + "<li><b>3</b><strong>Meet up</strong>Both tap “I'm here.” You pay the place directly.</li></ol>"
      + "<p style='margin:10px 0 0;font-size:12.5px'>No match by the time it starts? Your fee comes back as credit. Asking is always free. <a href='/help/#plan-a-date' target='_blank' rel='noopener' style='color:#00e3ae'>Full guide with pictures →</a></p></div>"
      + "<div class='dt-rules'>🛟 <b>Stay safe:</b> meet only at the place you picked, tell a friend where you'll be, and never send money to someone you're meeting. Anyone asking for money is breaking the rules: report them.</div>";
  }
  function panelHTML() {
    start();
    if (!me()) return how();
    var live = P.mine.filter(function (x) { return ["draft", "live", "matched", "confirmed", "asked"].indexOf(x.status) > -1 || x.canRate || x.startsAt > Date.now() - 864e5; });
    return (live.length ? "<div class='dt-sec'>📍 Your dates</div>" + live.map(box).join("") : "") + how();
  }

  /* ---------- deep links (?plan=ID from a notification or a shared link) ---------- */
  function openPending() {
    var id = null; try { id = sessionStorage.getItem("wpmPlan"); } catch (e) {}
    if (!id || (me() && !P.mineLoaded) || typeof active === "undefined" || active !== 4) return;
    try { sessionStorage.removeItem("wpmPlan"); } catch (e) {}
    if (window.Dates && window.Dates.setMode) window.Dates.setMode("pd");
    var mineIt = P.mine.filter(function (x) { return x.id === id; })[0];
    if (mineIt) { setTimeout(function () { var p = $i("datesPanel"); if (p && p.scrollIntoView) p.scrollIntoView({ behavior: "smooth", block: "start" }); }, 300); return; }
    var tries = 0, t = setInterval(function () { tries++; if (P.list.some(function (x) { return x.id === id; })) { clearInterval(t); Plan.open(id); } else if (tries > 20) { clearInterval(t); toast("That date isn't open anymore. Here are others.", "warn"); } }, 300);
  }

  /* ---------- the create form ---------- */
  var V = { venue: {}, results: [] };
  function venueSearch(q) {
    var box = $i("pdVres"); if (!box) return;
    if (q.length < 3) { box.innerHTML = ""; return; }
    var bias = P.where ? "&lat=" + P.where.lat + "&lon=" + P.where.lng : "";
    box.innerHTML = "<div class='dt-vr' style='color:#9a8fb5'>Searching…</div>";
    fetch("https://photon.komoot.io/api/?q=" + encodeURIComponent(q) + "&limit=8&lang=en" + bias).then(function (r) { return r.json(); }).then(function (j) {
      V.results = (j.features || []).map(function (f) {
        var p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
        return { name: p.name || "", address: [p.housenumber, p.street].filter(Boolean).join(" "), city: [p.city || p.town || p.village || p.county, p.state].filter(Boolean).join(", "),
          osmId: (p.osm_type || "") + (p.osm_id || ""), osmType: p.osm_type, osmNum: p.osm_id, lat: c[1], lon: c[0], kind: p.osm_value || "", poi: /^(amenity|leisure|tourism|shop|club)$/.test(p.osm_key || ""), source: "osm", phone: "" };
      }).filter(function (r) { return r.name && r.city && r.poi; });
      box.innerHTML = V.results.length ? V.results.map(function (r, i) {
        return "<button class='dt-vr' onclick='Plan.pickVenue(" + i + ")'><b>" + esc(r.name) + "</b> <small>" + esc(r.kind.replace(/_/g, " ")) + "</small><br><small>" + esc([r.address, r.city].filter(Boolean).join(", ")) + "</small></button>";
      }).join("") + "<div class='dt-vr' style='opacity:.75'>Not listed? Tap <b>Type it in</b> below.</div>"
        : "<div class='dt-vr'>No places found. Tap <b>Type it in</b> below.</div>";
    }, function () { box.innerHTML = "<div class='dt-vr'>Search isn't working right now. Tap <b>Type it in</b> below.</div>"; });
  }
  function venuePhone(r) {
    if (!r.osmType || !r.osmNum) return Promise.resolve("");
    var t = { N: "node", W: "way", R: "relation" }[r.osmType] || "node";
    return fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent("[out:json][timeout:5];" + t + "(" + r.osmNum + ");out tags;"))
      .then(function (x) { return x.json(); }).then(function (j) { var tg = ((j.elements || [])[0] || {}).tags || {}; return tg.phone || tg["contact:phone"] || ""; }, function () { return ""; });
  }
  function localInput(t) { return new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

  var Plan = {
    phoneHTML: phoneHTML,
    panelHTML: panelHTML,
    load: function () { return load(); },
    /* for "My Meet & Greet" (Profile → More): your dates and the box with their buttons */
    mineList: function () { return P.mine.slice(); },
    mineLoaded: function () { return P.mineLoaded; },
    boxFor: function (id) { var x = P.mine.filter(function (z) { return z.id === id; })[0]; return x ? box(x) : ""; },
    closeModal: closeModal,
    openPending: openPending,
    setNear: function (on) {
      if (!on) { P.near = false; redraw(); return; }
      if (P.where) { P.near = true; redraw(); return; }
      if (!navigator.geolocation) return toast("This browser can't share your location.", "warn");
      navigator.geolocation.getCurrentPosition(function (pos) {
        P.where = { lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100, at: Date.now() };
        try { localStorage.setItem("wpmNear", JSON.stringify(P.where)); } catch (e) {}
        P.near = true; redraw();
      }, function () { toast("Turn on location to see dates near you.", "warn"); }, { timeout: 10000, maximumAge: 600000 });
    },
    open: function (id) {
      var x = P.list.filter(function (z) { return z.id === id; })[0];
      if (!x) return toast("That date isn't open anymore.", "warn");
      var mine = x.creatorUid === P.uid, anon = !me(), pays = PAYS[x.pays] || PAYS.split;
      var asked = P.mine.filter(function (z) { return z.id === id && !z.mine; })[0];
      var ny = !anon && !mine && needYear();
      openModal("<div style='margin:-18px -18px 0;border-radius:14px 14px 0 0;overflow:hidden'><div class='dt-poster' style='height:150px;background:" + grad(hue(x.title)) + "'>" + (x.creatorPhoto ? "<img src='" + esc(x.creatorPhoto) + "' alt=''>" : "")
        + "<div class='k'><span>📍 " + esc(x.city) + esc(distLabel(x)) + (x.requests ? " · " + x.requests + " interested" : "") + "</span></div><b style='font-size:22px'>" + esc(x.title) + "</b></div></div>"
        + "<div class='dt-row' style='justify-content:flex-start;gap:10px;flex-wrap:nowrap'><button style='background:none;border:0;padding:0;cursor:pointer' onclick=\"Plan.profile('" + esc(x.creatorUid) + "')\">" + avatar({ name: x.creatorName, photo: x.creatorPhoto }, 46) + "</button><div><b>" + esc(x.creatorName) + "</b> " + stars(x.creatorRating) + "<br><small style='color:#9a8fb5'>is planning this date</small></div></div>"
        + "<div class='dt-facts'><div><b>" + esc(when(x.startsAt, x.tz).split(" · ")[0]) + "</b>" + esc(when(x.startsAt, x.tz).split(" · ")[1] || "") + "</div><div><b>" + pays[0] + "</b>" + esc(paysText(x)) + "</div></div>"
        + (x.about ? "<p style='margin:0;line-height:1.55;font-size:14px'>" + esc(x.about) + "</p>" : "")
        + "<div class='dt-rules'>📍 <b>" + esc(x.venueName) + "</b>, " + esc(x.city) + ". You get the street address and can message each other once you're picked.</div>"
        + (mine ? "<div class='dt-rules'>This is your date. See who's interested under <b>📍 Your dates</b> below.</div><button class='dt-btn ghost' onclick=\"Plan.share('" + x.id + "')\">↗ Share it</button>"
          : asked ? "<div class='dt-rules' style='text-align:center'>You asked for this one. We'll tell you if you're picked.</div>"
          : (ny ? birthYearField("pdYear") : "")
            + (anon ? "" : "<div><div class='lbl'>Say hi <small>(optional)</small></div><input class='dt-in' id='pdNote' maxlength='200' placeholder='Love tacos! I can do 7.'></div>")
            + "<div id='pdErr' class='dt-err'></div><button class='dt-btn big teal' id='pdAsk'>" + (anon ? "Sign up free to ask" : "🙋 I'm interested") + "</button>"
            + "<p class='dt-fine'>Asking is free. If you're picked, you confirm, then meet at the place and each pay it directly. Never send money to someone you're meeting.</p>")
        + "<div class='dt-actions'><button class='dt-btn ghost' style='flex:1' onclick=\"Plan.share('" + x.id + "')\">↗ Share</button>" + (mine || anon ? "" : "<button class='dt-btn ghost' style='flex:1' onclick=\"Plan.report('" + esc(x.creatorUid) + "')\">🚩 Report</button>") + "</div>");
      var b = $i("pdAsk");
      if (b) b.onclick = function () {
        if (anon) { try { sessionStorage.setItem("wpmPlan", x.id); } catch (e) {} if (window.promptGuestUpgrade) window.promptGuestUpgrade("Asking for a date"); return; }
        var data = { planId: x.id, note: ($i("pdNote") || {}).value || "" };
        if (ny) { data.birthYear = +($i("pdYear") || {}).value; if (!data.birthYear) { $i("pdErr").textContent = "Pick your birth year first."; return; } }
        busy(b, fn("requestPlan", data)).then(function (r) { closeModal(); toast(r.message); load(); }, function (e) { if (!yearRetry(e, function () { Plan.open(x.id); })) $i("pdErr").textContent = e.message; });
      };
    },
    create: function () {
      if (!me()) { if (window.promptGuestUpgrade) window.promptGuestUpgrade("Planning a date"); return; }
      V = { venue: {}, results: [] };
      var ny = needYear(), pays = "split", minT = localInput(Date.now() + 25 * 3600000), maxT = localInput(Date.now() + 30 * 864e5);
      var cover = P.credit >= P.fee;
      openModal("<h3>📍 Plan a date</h3><p style='margin:-6px 0 0;color:#b3abcf;font-size:13px'>Anywhere, at a real public place. People ask, you pick who goes.</p>"
        + "<div><div class='lbl'>What's the plan?</div><input class='dt-in' id='pdTitle' maxlength='70' placeholder='Tacos and mini golf'></div>"
        + "<div><div class='lbl'>A little more <small>(optional)</small></div><textarea class='dt-in' id='pdAbout' maxlength='400' rows='2' placeholder='Low-key first date. Loser buys dessert.'></textarea></div>"
        + "<div><div class='lbl'>Where</div><input class='dt-in' id='pdVq' placeholder='Search: restaurant, café, bowling…' autocomplete='off'><div id='pdVres' class='dt-vres'></div>"
        + "<div id='pdVform' style='display:none;margin-top:8px'><input class='dt-in' id='pdVname' placeholder='Place name' style='margin-bottom:6px'><input class='dt-in' id='pdVaddr' placeholder='Street address' style='margin-bottom:6px'>"
        + "<div class='dt-row' style='gap:6px;flex-wrap:nowrap'><input class='dt-in' id='pdVcity' placeholder='City, state'><input class='dt-in' id='pdVphone' type='tel' placeholder='Place phone'></div></div>"
        + "<button class='dt-btn ghost' id='pdOther' style='margin-top:6px'>Type it in</button><p style='margin:4px 0 0;font-size:11px;color:#6f6a88'>Restaurants, cafés, bars, bowling, mini golf, classes… No homes or hotels. Search by © OpenStreetMap contributors</p></div>"
        + "<div><div class='lbl'>When</div><input class='dt-in' id='pdWhen' type='datetime-local' min='" + minT + "' max='" + maxT + "'></div>"
        + "<div><div class='lbl'>The bill <small>(you pay the place directly)</small></div><div class='pd-pays' id='pdPays'>" + ["split", "me", "each"].map(function (k) { return "<button data-k='" + k + "' aria-pressed='" + (k === pays) + "'><b>" + PAYS[k][0] + "</b>" + PAYS[k][1] + "</button>"; }).join("") + "</div></div>"
        + (ny ? birthYearField("pdYear2") : "")
        + "<label class='dt-check'><input type='checkbox' id='pdAgree'> <span>It's at a public place, nobody pays anyone to go out (we each pay the place), and I'll show up or call it off at least a day ahead. <a href='/terms.html#plan' target='_blank' rel='noopener'>Plan a Date rules</a></span></label>"
        + "<div id='pdErr2' class='dt-err'></div>"
        + "<button class='dt-btn big teal' id='pdGo'>" + (!P.fee ? "Post it · free" : cover ? "Post it · paid with your credit" : "Post it · " + money(P.fee)) + "</button>"
        + "<p class='dt-fine'>" + (P.fee ? "Nobody picked by the time it starts? The " + money(P.fee) + " comes back as Whisper+Me credit. " : "") + "Asking is free for everyone.</p>");
      document.querySelectorAll("#pdPays button").forEach(function (b) { b.onclick = function () { pays = b.getAttribute("data-k"); document.querySelectorAll("#pdPays button").forEach(function (c) { c.setAttribute("aria-pressed", c === b); }); }; });
      var timer = null;
      $i("pdVq").oninput = function () { clearTimeout(timer); var q = this.value.trim(); timer = setTimeout(function () { venueSearch(q); }, 350); };
      $i("pdOther").onclick = function () { V.venue = { source: "other" }; ["pdVaddr", "pdVcity", "pdVphone"].forEach(function (k) { $i(k).value = ""; }); $i("pdVname").value = $i("pdVq").value; $i("pdVform").style.display = "block"; $i("pdVres").innerHTML = ""; $i("pdVaddr").focus(); };
      $i("pdGo").onclick = function () {
        var err = $i("pdErr2"), btn = this;
        if (!$i("pdAgree").checked) { err.textContent = "Tick the box to continue."; return; }
        if ($i("pdVform").style.display === "none") { err.textContent = "Pick the place first."; return; }
        var data = { title: $i("pdTitle").value, about: $i("pdAbout").value, pays: pays, tz: MY_TZ, startsAt: $i("pdWhen").value ? new Date($i("pdWhen").value).getTime() : 0,
          venue: { name: $i("pdVname").value, address: $i("pdVaddr").value, city: $i("pdVcity").value, phone: $i("pdVphone").value, source: V.venue.source || "other", osmId: V.venue.osmId || "", lat: V.venue.lat, lon: V.venue.lon } };
        if (ny) { data.birthYear = +$i("pdYear2").value; if (!data.birthYear) { err.textContent = "Pick your birth year."; return; } }
        busy(btn, fn("createPlan", data)).then(function (r) { if (r.url) location.href = r.url; else { closeModal(); toast(r.message); if (window.Dates) window.Dates.setMode("pd"); load(); } }, function (e) { if (!yearRetry(e, Plan.create)) err.textContent = e.message; });
      };
    },
    pickVenue: function (i) {
      var r = V.results[i]; if (!r) return;
      V.venue = r;
      $i("pdVname").value = r.name; $i("pdVaddr").value = r.address; $i("pdVcity").value = r.city; $i("pdVphone").value = r.phone || "";
      $i("pdVq").value = r.name; $i("pdVres").innerHTML = ""; $i("pdVform").style.display = "block";
      if (!r.phone) { $i("pdVphone").placeholder = "Place phone (looking it up…)"; venuePhone(r).then(function (ph) { var el = $i("pdVphone"); if (!el) return; if (ph && !el.value) el.value = ph; el.placeholder = "Place phone"; }); }
    },
    pay: function (id, btn) { busy(btn, fn("payPlan", { planId: id })).then(function (r) { if (r.url) location.href = r.url; }, function (e) { toast(e.message, "error"); }); },
    answer: function (id, uid, yes, btn) {
      if (yes && !confirm("Pick this person? Everyone else will be told it's filled once they confirm.")) return;
      busy(btn, fn("answerPlanRequest", { planId: id, uid: uid, approve: yes })).then(function (r) { toast(r.message); load(); }, function (e) { toast(e.message, "error"); });
    },
    confirm: function (id, yes, btn) {
      if (!yes && !confirm("Pass on this date? It goes back to them to pick someone else.")) return;
      busy(btn, fn("confirmPlan", { planId: id, yes: yes })).then(function (r) { toast(r.message); load(); }, function (e) { toast(e.message, "error"); });
    },
    cancel: function (id, btn) {
      var x = P.mine.filter(function (z) { return z.id === id; })[0] || {};
      var late = x.startsAt - Date.now() < 24 * 3600000;
      if (!confirm(late ? "It's less than a day away. Calling it off now doesn't return the fee" + (x.status === "confirmed" ? " and counts as a strike" : "") + ". Call it off?" : "Call off this date? Your fee comes back as Whisper+Me credit.")) return;
      busy(btn, fn("cancelPlan", { planId: id })).then(function (r) { toast(r.message); load(); }, function (e) { toast(e.message, "error"); });
    },
    withdraw: function (id, btn) {
      var x = P.mine.filter(function (z) { return z.id === id; })[0] || {};
      var late = x.status === "confirmed" && x.startsAt - Date.now() < 24 * 3600000;
      if (!confirm(x.status === "asked" ? "Take back your request?" : late ? "It's less than a day away, so backing out counts as a strike. Back out?" : "Back out of this date? We'll let them know.")) return;
      busy(btn, fn("withdrawPlan", { planId: id })).then(function (r) { toast(r.message); load(); }, function (e) { toast(e.message, "error"); });
    },
    here: function (id, btn) {
      var send = function (pos) { busy(btn, fn("planHere", Object.assign({ planId: id }, pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : {}))).then(function (r) { toast(r.message); load(); }, function (e) { toast(e.message, "error"); }); };
      if (navigator.geolocation) navigator.geolocation.getCurrentPosition(send, function () { send(null); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
      else send(null);
    },
    share: function (id) {
      var x = P.list.filter(function (z) { return z.id === id; })[0] || P.mine.filter(function (z) { return z.id === id; })[0] || {};
      var url = "https://whisperplusme.com/p/" + encodeURIComponent(id);
      var text = "📍 " + (x.title || "A date") + (x.venueName ? " at " + x.venueName : "") + (x.startsAt ? ", " + when(x.startsAt, x.tz) : "") + ". Want to go? Tap “I'm interested” on Whisper+Me.";
      if (window.openShareSheet) window.openShareSheet((x.title || "Plan a Date") + " · Whisper+Me", text, url);
      else if (navigator.share) navigator.share({ title: x.title, text: text, url: url }).catch(function () {});
    },
    /* 🛟 a friend gets who, where and when (straight from your phone; nothing is sent by us) */
    tellFriend: function (id) {
      var x = P.mine.filter(function (z) { return z.id === id; })[0]; if (!x) return;
      var who = x.mine ? x.guestName : x.creatorName;
      var text = "Heads up: I'm on a date. " + x.title + " with " + who + " (Whisper+Me), " + when(x.startsAt, x.tz) + " at " + x.venueName + ", " + [x.address, x.city].filter(Boolean).join(", ") + ". I'll check in with you after.";
      if (navigator.share) navigator.share({ title: "My date plan", text: text }).catch(function () {});
      else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast("Copied. Paste it to a friend."); });
      else prompt("Send this to a friend:", text);
    },
    profile: function (uid) { if (window.showProfileModal) window.showProfileModal(uid); },
    report: function (uid) { if (window.showProfileModal) { window.showProfileModal(uid); setTimeout(function () { if (window.Profile && window.Profile.report) window.Profile.report(uid); }, 50); } },
    rate: function (id, pre) {
      var x = P.mine.filter(function (z) { return z.id === id; })[0];
      if (!x) { load().then(function () { if (P.mine.some(function (z) { return z.id === id; })) Plan.rate(id, pre); }); return; }
      var who = x.mine ? x.guestName : x.creatorName, n = pre || x.myStars || 0;
      openModal("<h3>⭐ How was your date with " + esc(who) + "?</h3>"
        + "<div class='dt-starbtns dt-starbig' id='pdStars' role='group' aria-label='Rate 1 to 5 stars' style='justify-content:center'>" + [1, 2, 3, 4, 5].map(function (k) { return "<button data-n='" + k + "' aria-label='" + k + " star" + (k === 1 ? "" : "s") + "'>★</button>"; }).join("") + "</div>"
        + "<textarea class='dt-in' id='pdRt' rows='3' maxlength='600' placeholder='Anything we should know? (optional)'></textarea>"
        + "<p class='dt-fine' style='margin:0'>Only Whisper+Me sees your comment. Your stars show on their date profile.</p>"
        + "<div id='pdRtErr' class='dt-err'></div><button class='dt-btn big' id='pdRtGo'>Send rating</button>");
      var set = function (k) { n = k; document.querySelectorAll("#pdStars button").forEach(function (b) { b.classList.toggle("on", +b.getAttribute("data-n") <= k); }); };
      document.querySelectorAll("#pdStars button").forEach(function (b) { b.onclick = function () { set(+b.getAttribute("data-n")); }; });
      set(n);
      $i("pdRtGo").onclick = function () {
        if (!n) { $i("pdRtErr").textContent = "Tap 1 to 5 stars."; return; }
        busy(this, fn("rateEvent", { kind: "pd", id: id, stars: n, text: $i("pdRt").value })).then(function (r) { closeModal(); toast(r.message); load(); }, function (e) { $i("pdRtErr").textContent = e.message; });
      };
    },
    /* 💬 messages: the server writes them (and blocks money talk); both people can read */
    chat: function (id) {
      var x = P.mine.filter(function (z) { return z.id === id; })[0]; if (!x) return;
      var other = x.mine ? x.guestName : x.creatorName;
      openModal("<h3>💬 " + esc(other) + "</h3><div class='dt-rules' style='font-size:12px'>🛟 Meet only at " + esc(x.venueName) + ". Never send money: anyone who asks is breaking the rules.</div>"
        + "<div class='pd-chat' id='pdChat'><div style='color:#9a8fb5;font-size:13px;margin:auto'>Say hi and sort out the details.</div></div>"
        + "<div class='dt-row' style='flex-wrap:nowrap;gap:6px'><input class='dt-in' id='pdSay' maxlength='500' placeholder='Message' autocomplete='off'><button class='dt-btn' id='pdSend' style='flex:none'>Send</button></div><div id='pdChatErr' class='dt-err'></div>");
      stopChat();
      var ref = firebase.database().ref("planChat/" + id + "/msgs").limitToLast(100);
      var cb = ref.on("value", function (s) {
        var box = $i("pdChat"); if (!box) return;
        var rows = []; s.forEach(function (c) { rows.push(c.val()); });
        if (rows.length) box.innerHTML = rows.map(function (m) { return "<div class='pd-msg" + (m.uid === P.uid ? " me" : "") + "'>" + (m.uid === P.uid ? "" : "<small>" + esc(m.name) + "</small>") + esc(m.text) + "</div>"; }).join("");
        box.scrollTop = box.scrollHeight;
      }, function () {});
      P.chatOff = function () { ref.off("value", cb); };
      var send = function () {
        var inp = $i("pdSay"), t = inp.value.trim(); if (!t) return;
        $i("pdChatErr").textContent = "";
        busy($i("pdSend"), fn("planSay", { planId: id, text: t })).then(function () { inp.value = ""; inp.focus(); }, function (e) { $i("pdChatErr").textContent = e.message; });
      };
      $i("pdSend").onclick = send;
      $i("pdSay").onkeydown = function (e) { if (e.key === "Enter") send(); };
    }
  };
  function stopChat() { if (P.chatOff) { try { P.chatOff(); } catch (e) {} P.chatOff = null; } }
  window.Plan = Plan;
})();
