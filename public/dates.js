/* ═══════════════════════════════════════════════════════════════
   WHISPER+ME M&G — the ⭐ M&G screen
   One simple flow for everyone:
     Buyers:  pick an M&G → pay for your spot → address + code show up
              under My tickets → show the code at the door.
     Hosts:   post it → pay a small deposit → we review it (usually
              within a day) → share your link → check guests in →
              paid 3 days later.
   Guests (peeking without an account) can browse; buying asks them to
   sign up. All money and rules live in Cloud Functions
   (functions-nights/index.js); this file only shows things and calls
   those functions.
═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CATS = ["All", "Dinner", "Activities", "Concerts", "Movies", "Other"];
  var CAT_ICON = { All: "✨", Dinner: "🍽️", Activities: "🎳", Concerts: "🎤", Movies: "🎬", Other: "⭐" };
  var DEFAULTS = { minAge: 21, hostFee: 10, hostPayoutHours: 72, lateCancelHours: 48 };
  var MAX_QTY = 6; // spots per checkout (you + friends), same as the server

  var S = {
    started: false, uid: null, anon: false, cat: "All",
    settings: Object.assign({}, DEFAULTS),
    meetups: [], mine: [], loadedMine: false, member: undefined, hostContact: null,
    mode: "mg", connects: [], myCon: [], credit: 0, depositOnFile: 0,
    myDates: [], unsubs: []
  };

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(c) { var n = (c || 0) / 100; return "$" + (n % 1 ? n.toFixed(2) : n); }
  function ms(t) { return t && t.toMillis ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : Number(t) || 0); }
  function when(t) {
    var d = new Date(ms(t)); if (!ms(t)) return "";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function day(t) { var d = new Date(ms(t)); return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }); }
  function hue(str) { var h = 0; String(str).split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }
  function grad(h) { return "linear-gradient(135deg,hsl(" + h + " 60% 32%),hsl(" + ((h + 40) % 360) + " 65% 16%) 70%,#0b0b16)"; }
  function toast(m, type) { if (window.showToast) window.showToast(m, type || "success", 3500); else alert(m); }
  function db() { return firebase.firestore(); }
  function fn(name, data) {
    return firebase.functions().httpsCallable(name)(data || {}).then(function (r) { return r.data; })
      .catch(function (e) { throw new Error((e && e.message) || "Something went wrong. Try again."); });
  }
  function me() { var u = firebase.auth().currentUser; return u && !u.isAnonymous ? u : null; }
  function anyUser() { return firebase.auth().currentUser; }
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
  function stars(avg, n) { return n ? "<span class='dt-stars' title='" + avg + " out of 5 from " + n + " rating" + (n === 1 ? "" : "s") + "'>★ " + Number(avg).toFixed(1) + " <small>(" + n + ")</small></span>" : ""; }
  function hostStars(m) { if (m.official) return ""; var r = ((window.allUsers || {})[m.hostUid] || {}).rating; return r && r.n ? stars(r.avg, r.n) : ""; }
  function idOkBox(id) { return "<label class='dt-check dt-idok'><input type='checkbox' id='" + id + "'> <span>🪪 <b>21+, ID checked at the door.</b> I'll bring a valid photo ID. Without one I can be turned away, and the spot isn't refunded.</span></label>"; }
  function starRow(kind, id, mine) {
    return "<div class='dt-rate'><span>" + (mine ? "You rated it" : "How was it?") + "</span><span class='dt-starbtns' role='group' aria-label='Rate 1 to 5 stars'>" + [1, 2, 3, 4, 5].map(function (n) {
      return "<button class='" + (n <= mine ? "on" : "") + "' aria-label='" + n + " star" + (n === 1 ? "" : "s") + "' onclick=\"Dates.rate('" + kind + "','" + id + "'," + n + ")\">★</button>";
    }).join("") + "</span></div>";
  }
  function left(m) { return Math.max(0, (m.spots || 0) - (m.sold || 0) - (m.held || 0)); }
  function hostLabel(m) { return m.official ? "Whisper+Me" : m.hostName; }
  function shareLink(id) { return "https://whisperplusme.com/m/" + encodeURIComponent(id); }
  function hostKeep() { return 100 - (S.settings.hostFee == null ? 10 : S.settings.hostFee); }
  function payoutDays() { return Math.round((S.settings.hostPayoutHours || 72) / 24); }
  function birthYearField(id) {
    var yr = new Date().getFullYear(), opts = "";
    for (var y = yr - 18; y >= yr - 90; y--) opts += "<option>" + y + "</option>";
    return "<div><div class='lbl'>Your birth year <small>(M&G is " + S.settings.minAge + "+, asked once)</small></div><select id='" + id + "' class='dt-in'><option value=''>Pick a year</option>" + opts + "</select></div>";
  }

  /* ---------- styles (scoped to .dt-) ---------- */
  var css = "\
.dt-phone{height:100%;display:flex;flex-direction:column;background:#0b0b16;color:#fff;border-radius:inherit;overflow:hidden}\
.dt-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:44px 14px 8px}\
.dt-head h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.01em}\
.dt-head small{font-size:11.5px;color:#9a8fb5}\
.dt-mybtn{flex:none;border:1px solid rgba(0,227,174,.45);background:rgba(0,227,174,.1);color:#00e3ae;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:800;cursor:pointer;min-height:34px;white-space:nowrap}\
.dt-mybtn b{display:inline-grid;place-items:center;min-width:18px;height:18px;border-radius:9px;background:#00e3ae;color:#06281f;font-size:11px;margin-left:4px;padding:0 4px}\
.dt-pill{font-size:10.5px;font-weight:800;padding:4px 9px;border-radius:999px;white-space:nowrap}\
.dt-pill.ok{background:rgba(0,227,174,.14);color:#00e3ae}.dt-pill.warn{background:rgba(255,186,73,.14);color:#ffba49}.dt-pill.bad{background:rgba(229,57,53,.16);color:#ff8a80}.dt-pill.purple{background:rgba(123,47,247,.22);color:#c9a7ff}\
.dt-cats{display:flex;gap:6px;overflow-x:auto;padding:4px 12px 6px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-behavior:smooth}.dt-cats::-webkit-scrollbar{display:none}\
.dt-catbar{position:relative;height:5px;margin:0 12px 10px;border-radius:99px;background:rgba(255,255,255,.1);cursor:pointer}\
.dt-catbar i{position:absolute;top:0;bottom:0;left:0;width:40%;border-radius:99px;background:linear-gradient(90deg,#7b2ff7,#00e3ae)}\
.dt-cat{flex:none;border:1px solid rgba(255,255,255,.12);background:#15152a;color:#cfc8e8;border-radius:999px;padding:8px 12px;font-size:12.5px;font-weight:700;cursor:pointer;min-height:34px}\
.dt-cat[aria-pressed=true]{background:#7b2ff7;border-color:#7b2ff7;color:#fff}\
.dt-vres{display:flex;flex-direction:column;gap:4px;margin-top:6px;max-height:220px;overflow:auto}\
.dt-vr{display:block;width:100%;text-align:left;background:#15152a;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:8px 10px;color:#fff;font-size:13px;cursor:pointer}\
.dt-vr small{color:#9a8fb5}\
.dt-list{flex:1;overflow-y:auto;padding:0 12px 16px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}\
.dt-card{flex:none;display:block;width:100%;text-align:left;border:1px solid rgba(255,255,255,.08);background:#12122a;border-radius:16px;overflow:hidden;padding:0;color:#fff;cursor:pointer}\
.dt-card.official{border-color:rgba(0,227,174,.35)}\
.dt-card:active{transform:scale(.99)}\
.dt-poster{position:relative;height:96px;padding:10px 12px;display:flex;flex-direction:column;justify-content:space-between}\
.dt-poster img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}\
.dt-poster>*{position:relative}\
.dt-poster .k{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.85);display:flex;justify-content:space-between;gap:8px}\
.dt-poster b{font-size:18px;line-height:1.1;text-shadow:0 1px 8px rgba(0,0,0,.5)}\
.dt-hot{background:#e53935;color:#fff;border-radius:6px;padding:1px 6px;letter-spacing:.06em}\
.dt-body{padding:9px 12px 11px;display:flex;justify-content:space-between;gap:10px;align-items:center}\
.dt-body .v{font-size:12px;color:#a59cc4;min-width:0;display:flex;align-items:center;gap:8px}\
.dt-body .v .t{min-width:0}.dt-body .v .t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.dt-body .v .t div:first-child{color:#fff;font-weight:700}\
.dt-price{text-align:right;flex:none}.dt-price b{font-size:18px}.dt-price small{display:block;font-size:10.5px;color:#a59cc4}.dt-price .dt-going{color:#ffba49;font-weight:700;margin-top:2px}\
.dt-empty{margin:auto;text-align:center;color:#a59cc4;font-size:13.5px;padding:26px 16px;line-height:1.5}\
.dt-hostcta{flex:none;border:1px dashed rgba(214,177,107,.5);background:rgba(214,177,107,.06);border-radius:16px;padding:12px;color:#fff;text-align:left;cursor:pointer;font-size:13px;line-height:1.4}\
.dt-hostcta b{color:#f3d08a}\
.dt-panel{max-width:640px;margin:0 auto;padding:6px 14px 30px;display:flex;flex-direction:column;gap:14px;color:#fff}\
.dt-box{background:#11111f;border:1px solid rgba(123,47,247,.25);border-radius:16px;padding:14px}\
.dt-box h3{margin:0 0 8px;font-size:15px}\
.dt-box p{margin:0 0 10px;font-size:13px;color:#b3abcf;line-height:1.45}\
.dt-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0;padding:0;list-style:none}\
.dt-steps li{background:#0b0b16;border-radius:12px;padding:10px 8px;text-align:center;font-size:12px;color:#b3abcf;line-height:1.35}\
.dt-steps li b{display:block;font-size:20px;margin-bottom:2px}\
.dt-steps li strong{display:block;color:#fff;font-size:12.5px;margin-bottom:2px}\
.dt-row{display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap}\
.dt-btn{border:0;border-radius:999px;padding:10px 16px;font-weight:800;font-size:13px;cursor:pointer;min-height:40px;background:#7b2ff7;color:#fff}\
.dt-btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.18);color:#ddd}\
.dt-btn.teal{background:#00e3ae;color:#06281f}\
.dt-btn.gold{background:linear-gradient(90deg,#d6b16b,#f3d08a);color:#2a1d05}\
.dt-btn.red{background:transparent;border:1px solid rgba(229,57,53,.5);color:#ff8a80}\
.dt-btn.big{width:100%;min-height:50px;font-size:15.5px}\
.dt-btn[disabled]{opacity:.55}\
.dt-next{font-size:12.5px;color:#cfc8e8;background:#0b0b16;border-left:3px solid #7b2ff7;border-radius:8px;padding:8px 10px;margin:8px 0;line-height:1.45}\
.dt-guests{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}\
.dt-g{font-size:12px;background:#0b0b16;border-radius:999px;padding:4px 10px;color:#cfc8e8}.dt-g.here{background:rgba(0,227,174,.14);color:#00e3ae}\
.dt-date{border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;background:#12122a}\
.dt-date .dt-poster{height:70px}\
.dt-date .in{padding:10px 12px;display:flex;flex-direction:column;gap:9px;font-size:13px}\
.dt-seats{display:flex;gap:8px;flex-wrap:wrap}\
.dt-seat{display:flex;align-items:center;gap:6px;background:#0b0b16;border-radius:999px;padding:3px 10px 3px 3px;font-size:12px}\
.dt-code{font-family:ui-monospace,Menlo,monospace;font-size:24px;letter-spacing:.12em;color:#00e3ae;font-weight:800}\
.dt-actions{display:flex;gap:8px;flex-wrap:wrap}\
.dt-sec{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#9a8fb5;margin:4px 2px -4px}\
.dt-sheet{padding:18px;color:#fff;max-height:82vh;overflow-y:auto;display:flex;flex-direction:column;gap:14px}.dt-sheet>*{flex-shrink:0}\
.dt-sheet h3{margin:0;font-size:19px}\
.dt-sheet h4{margin:4px 0 -4px;font-size:13px;color:#c9a7ff;letter-spacing:.04em}\
.dt-sheet .lbl{font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#9a8fb5;margin-bottom:6px}\
.dt-sheet .lbl small{text-transform:none;letter-spacing:0;font-weight:600}\
.dt-seg{display:flex;gap:4px;margin:0 12px 8px;padding:4px;border-radius:999px;background:#15152a;border:1px solid rgba(255,255,255,.08)}\
.dt-seg button{flex:1;border:0;border-radius:999px;padding:8px 6px;background:transparent;color:#a59cc4;font-weight:800;font-size:13px;cursor:pointer;min-height:36px}\
.dt-seg button[aria-pressed=true]{background:linear-gradient(90deg,#7b2ff7,#e0457b);color:#fff}\
.dt-card.cm{border-color:rgba(224,69,123,.45)}\
.dt-seat{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#0b0b16;border-radius:12px;padding:8px 10px;margin-top:6px;font-size:13px;flex-wrap:wrap}\
.dt-qty{display:flex;align-items:center;gap:10px;flex:none}.dt-qty b{font-size:20px;min-width:22px;text-align:center}.dt-qty .dt-btn{width:42px;padding:0;font-size:20px}\
.dt-facts{display:flex;gap:8px}.dt-facts div{flex:1;background:#0b0b16;border-radius:12px;padding:9px 6px;text-align:center;font-size:11.5px;color:#9a8fb5}.dt-facts b{display:block;color:#fff;font-size:16px}\
.dt-opt{display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:11px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#0b0b16;color:#fff;cursor:pointer}\
.dt-opt .t{flex:1;min-width:0}.dt-opt small{display:block;color:#9a8fb5;font-size:12px}\
.dt-picks{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}\
.dt-pick{flex:none;width:72px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:#0b0b16;color:#ddd;font-size:11.5px;cursor:pointer}\
.dt-pick[aria-pressed=true]{border-color:#7b2ff7;color:#fff;background:rgba(123,47,247,.18)}\
.dt-warn{border:1px solid rgba(229,57,53,.4);background:rgba(229,57,53,.08);border-radius:12px;padding:12px;font-size:13px}\
.dt-warn ul{margin:6px 0 0;padding-left:18px;font-size:13.5px;line-height:1.5;color:#ffd6d3}\
.dt-rules{font-size:12.5px;color:#b3abcf;line-height:1.5;background:#0b0b16;border-radius:12px;padding:10px 12px}\
.dt-fine{font-size:11.5px;color:#8f88aa;line-height:1.45;text-align:center;margin:-6px 0 0}\
.dt-fine a{color:#b9a4ff}\
.dt-check{display:flex;gap:9px;font-size:13px;color:#ddd;align-items:flex-start}.dt-check input{margin-top:3px;accent-color:#7b2ff7;min-width:16px;min-height:16px}\
.dt-check a{color:#b9a4ff}\
.dt-in{width:100%;padding:11px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0b16;color:#fff;font-size:14px}\
.dt-err{color:#ff8a80;font-size:13px}\
.dt-stars{color:#ffc94d;font-weight:800;white-space:nowrap}.dt-stars small{color:#9a8fb5;font-weight:600}\
.dt-idb{display:inline-block;background:rgba(255,186,73,.16);color:#ffba49;border-radius:999px;padding:2px 8px;font-size:10.5px;font-weight:800;margin-top:4px;white-space:nowrap}\
.dt-idok input{flex:none;width:auto}\
.dt-idok{background:rgba(255,186,73,.08);border:1px solid rgba(255,186,73,.35);border-radius:12px;padding:10px 12px}\
.dt-rate{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(255,201,77,.08);border:1px solid rgba(255,201,77,.25)}\
.dt-rate span{font-size:13px;color:#ddd}\
.dt-starbtns{display:flex;gap:2px}\
.dt-starbtns button{background:none;border:0;padding:2px 3px;font-size:24px;line-height:1;color:#5d5675;cursor:pointer;min-height:36px;min-width:32px}\
.dt-starbtns button.on{color:#ffc94d}\
.dt-starbig button{font-size:38px;min-width:48px;min-height:52px}\
";
  var styleEl = document.createElement("style"); styleEl.textContent = css; document.head.appendChild(styleEl);

  /* ---------- data ---------- */
  /* Firestore is only needed for M&G, so it loads the first time M&G opens. */
  var fsPromise = null;
  function ensureFirestore() {
    if (firebase.firestore) return Promise.resolve();
    if (!fsPromise) fsPromise = new Promise(function (res, rej) {
      var sc = document.createElement("script");
      sc.src = "https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js";
      var fail = function () { fsPromise = null; rej(new Error("M&G couldn't load. Check your connection.")); };
      // Resolve only if Firestore really arrived (an ad blocker can serve an empty file).
      sc.onload = function () { if (firebase.firestore) res(); else fail(); };
      sc.onerror = fail;
      document.head.appendChild(sc);
    });
    return fsPromise;
  }
  function start() {
    var u = anyUser();
    if (!u) return;
    if (S.started && S.uid === u.uid) return;
    stop();
    S.started = true; S.uid = u.uid; S.anon = !!u.isAnonymous;
    if (!firebase.firestore) {
      ensureFirestore().then(function () { S.started = false; start(); refresh(); }, function (e) { S.started = false; toast(e.message, "error"); });
      return;
    }
    var f = db();
    S.unsubs.push(f.doc("settings/platform").onSnapshot(function (s) { S.settings = Object.assign({}, DEFAULTS, s.exists ? s.data() : {}); refresh(); }, function () {}));
    S.unsubs.push(f.collection("meetups").where("status", "==", "live").where("hidden", "==", false).orderBy("startsAt").limit(80).onSnapshot(function (s) {
      var now = Date.now();
      S.meetups = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).filter(function (m) { return ms(m.startsAt) > now + 2 * 3600000 && (left(m) > 0 || m.hostUid === S.uid); });
      refresh();
    }, function (e) { console.warn("M&G list", e.message); }));
    S.unsubs.push(f.collection("connects").where("status", "==", "live").where("hidden", "==", false).orderBy("startsAt").limit(60).onSnapshot(function (s) {
      var now = Date.now();
      S.connects = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).filter(function (c) { return ms(c.startsAt) > now + 2 * 3600000 && (c.quantity - c.sold - c.held) > 0; });
      refresh();
    }, function (e) { console.warn("Connect Me list", e.message); }));
    if (S.anon) return; // guests just browse
    S.unsubs.push(f.doc("members/" + u.uid).onSnapshot(function (s) { S.member = s.exists ? s.data() : null; refresh(); }, function () { S.member = null; refresh(); }));
    // Bookings made with the old "for 2 / group of 4" tickets still show until they're done.
    S.unsubs.push(f.collection("dates").where("involvedUids", "array-contains", u.uid).orderBy("createdAt", "desc").limit(20).onSnapshot(function (s) {
      S.myDates = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); refresh();
    }, function () {}));
    loadMine();
  }
  function loadMine() {
    if (!me()) return;
    fn("myMeetups").then(function (r) { S.mine = r.meetups || []; S.hostContact = r.hostContact || null; S.credit = r.credit || 0; S.depositOnFile = r.depositOnFile || 0; S.loadedMine = true; refresh(); }, function () { S.loadedMine = true; });
    fn("myConnects").then(function (r) { S.myCon = r.connects || []; refresh(); }, function () {});
  }
  function stop() { S.unsubs.forEach(function (u) { try { u(); } catch (e) {} }); S.unsubs = []; S.started = false; }
  firebase.auth().onAuthStateChanged(function (u) {
    if (!u) { stop(); S.uid = null; S.mine = []; S.member = undefined; return; }
    // Came in from a shared M&G or Connect Me link: take them straight to it.
    var pending = null; try { pending = sessionStorage.getItem("wpmMeetup") || sessionStorage.getItem("wpmConnect"); } catch (e) {}
    if (pending) setTimeout(function () { if (window.setActive && typeof active !== "undefined" && active !== 4) window.setActive(4); }, 900);
  });

  function myTickets() { return S.mine.filter(function (m) { return !m.host && (["live", "paying", "review"].indexOf(m.status) > -1 || m.startsAt > Date.now() - 3 * 86400000); }); }
  function upcomingTickets() { return S.mine.filter(function (m) { return !m.host && m.status === "live" && m.code; }).concat(myCons().filter(function (o) { return o.status === "paid" || o.invite; })); }
  function myCons() { return S.myCon.filter(function (o) { return o.invite || o.status === "paid" || o.startsAt > Date.now() - 2 * 86400000; }); }
  function myHosted() { return S.mine.filter(function (m) { return m.host && (["draft", "pending", "changes", "live", "review", "paying"].indexOf(m.status) > -1 || m.startsAt > Date.now() - 7 * 86400000); }); }

  /* ---------- venue search (free OpenStreetMap data via Photon) ---------- */
  var HF = { venue: {}, results: [] };
  var POI = /^(amenity|leisure|tourism|shop|club)$/;
  function venueSearch(q) {
    var box = $i("mgVres"); if (!box) return;
    if (q.length < 3) { box.innerHTML = ""; return; }
    var meU = (window.allUsers || {})[S.uid] || window.me || {};
    var bias = meU.lat && meU.lng ? "&lat=" + meU.lat + "&lon=" + meU.lng : "&lat=38.6&lon=-90.2";
    box.innerHTML = "<div class='dt-vr' style='color:#9a8fb5'>Searching…</div>";
    fetch("https://photon.komoot.io/api/?q=" + encodeURIComponent(q) + "&limit=8&lang=en" + bias).then(function (r) { return r.json(); }).then(function (j) {
      HF.results = (j.features || []).map(function (f) {
        var p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
        return { name: p.name || "", address: [p.housenumber, p.street].filter(Boolean).join(" "), city: [p.city || p.town || p.village || p.county, p.state].filter(Boolean).join(", "),
          osmId: (p.osm_type || "") + (p.osm_id || ""), osmType: p.osm_type, osmNum: p.osm_id, lat: c[1], lon: c[0], kind: p.osm_value || "", poi: POI.test(p.osm_key || ""), source: "osm", phone: "" };
      }).filter(function (r) { return r.name && r.city; }).sort(function (a, b) { return (b.poi ? 1 : 0) - (a.poi ? 1 : 0); });
      box.innerHTML = HF.results.length ? HF.results.map(function (r, i) {
        return "<button class='dt-vr' onclick='Dates.pickVenue(" + i + ")'><b>" + esc(r.name) + "</b> <small>" + esc(r.kind.replace(/_/g, " ")) + "</small><br><small>" + esc([r.address, r.city].filter(Boolean).join(", ")) + "</small></button>";
      }).join("") + "<div class='dt-vr' style='opacity:.75'>Not listed? Tap <b>Other: type it in</b> below.</div>"
        : "<div class='dt-vr'>No places found. Tap <b>Other: type it in</b> below.</div>";
    }, function () { box.innerHTML = "<div class='dt-vr'>Search isn't working right now. Tap <b>Other: type it in</b> below.</div>"; });
  }
  function venuePhone(r) {
    if (!r.osmType || !r.osmNum) return Promise.resolve("");
    var t = { N: "node", W: "way", R: "relation" }[r.osmType] || "node";
    return fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent("[out:json][timeout:5];" + t + "(" + r.osmNum + ");out tags;"))
      .then(function (x) { return x.json(); }).then(function (j) { var tg = ((j.elements || [])[0] || {}).tags || {}; return tg.phone || tg["contact:phone"] || ""; }, function () { return ""; });
  }

  /* ---------- phone frame: the list ---------- */
  function card(m) {
    var l = left(m), sold = m.sold || 0;
    var top = m.official ? "⭐ Whisper+Me pick" : (CAT_ICON[m.category] || "⭐") + " " + esc(m.category || "M&G");
    var badge = l <= 5 ? "<span class='dt-hot'>" + l + " left</span>" : "<span>" + esc(day(m.startsAt).split(",")[0]) + "</span>";
    return "<button class='dt-card" + (m.official ? " official" : "") + "' onclick=\"Dates.openMeetup('" + m.id + "')\">"
      + "<div class='dt-poster' style='background:" + grad(m.hue != null ? m.hue : hue(m.title)) + "'>" + (m.imageURL ? "<img src='" + esc(m.imageURL) + "' alt=''>" : "")
      + "<div class='k'><span>" + top + "</span>" + badge + "</div>"
      + "<b>" + esc(m.title) + "</b></div>"
      + "<div class='dt-body'><div class='v'>" + avatar({ name: hostLabel(m), photo: m.hostPhoto }, 32)
      + "<div class='t'><div>" + (m.official ? "Hosted by Whisper+Me" : "with " + esc(m.hostName)) + (hostStars(m) ? " · " + hostStars(m) : "") + "</div><div>" + esc(when(m.startsAt)) + "</div><div>📍 " + esc(m.venueName) + (m.city ? ", " + esc(m.city.split(",")[0]) : "") + "</div></div></div>"
      + "<div class='dt-price'><b>" + money(m.price) + "</b><small>per person</small>" + (sold >= 3 ? "<small class='dt-going'>🔥 " + sold + " going</small>" : "") + (m.idCheck ? "<span class='dt-idb'>🪪 21+ ID</span>" : "") + "</div></div></button>";
  }
  function phoneInner() {
    var u = anyUser();
    if (!u) return "<div class='dt-empty'>Sign in to see M&Gs.</div>";
    var cm = S.mode === "cm";
    var pool = cm ? S.connects : S.meetups;
    var list = pool.filter(function (m) { return S.cat === "All" || m.category === S.cat; });
    var n = upcomingTickets().length;
    var head = "<div class='dt-head'><div>" + (cm ? "<h2>💞 Connect Me</h2><small>Night-out packages · invite who you want</small>" : "<h2>⭐ M&G</h2><small>Meet & Greet · meet people in person</small>") + "</div>"
      + (S.anon ? "" : "<button class='dt-mybtn' onclick='Dates.showTickets()'>🎟️ My tickets" + (n ? "<b>" + n + "</b>" : "") + "</button>") + "</div>"
      + "<div class='dt-seg' role='tablist'><button aria-pressed='" + !cm + "' onclick=\"Dates.setMode('mg')\">⭐ M&G</button><button aria-pressed='" + cm + "' onclick=\"Dates.setMode('cm')\">💞 Connect Me</button></div>";
    var cats = "<div class='dt-cats' data-noswipe role='group' aria-label='Categories' onwheel='Dates.catWheel(event,this)' onscroll='Dates.catScroll(this)'>" + CATS.map(function (c, i) {
      return "<button class='dt-cat' aria-pressed='" + (S.cat === c) + "' onclick='Dates.setCatIdx(" + i + ")'>" + CAT_ICON[c] + " " + esc(c) + "</button>";
    }).join("") + "</div><div class='dt-catbar' data-noswipe onclick='Dates.catJump(event,this)'><i></i></div>";
    var hostCta; hostCta = "<button class='dt-hostcta' onclick='Dates.hostMeetup()'><b>⭐ Host your own M&G</b><br>Meet & Greet your fans or followers. Set a price, we review it, you keep " + hostKeep() + "%.</button>";
    if (cm) hostCta = "";
    var body = list.length ? list.map(cm ? conCard : card).join("") + hostCta
      : "<div class='dt-empty'>" + (pool.length ? "Nothing in " + esc(S.cat.toLowerCase()) + " right now.<br>Try another category." : cm ? "No Connect Me packages right now.<br>New ones are added all the time." : "No M&Gs on sale right now.<br>New ones are added all the time.") + "</div>" + hostCta;
    return head + cats + "<div class='dt-list'>" + body + "</div>";
  }

  /* ---------- Connect Me (night-out packages) ---------- */
  function conCard(c) {
    var l = c.quantity - c.sold - c.held;
    return "<button class='dt-card cm' onclick=\"Dates.openConnect('" + c.id + "')\">"
      + "<div class='dt-poster' style='background:" + grad(c.hue != null ? c.hue : hue(c.title)) + "'>" + (c.imageURL ? "<img src='" + esc(c.imageURL) + "' alt=''>" : "")
      + "<div class='k'><span>💞 " + (CAT_ICON[c.category] || "") + " " + esc(c.category || "Night out") + "</span>" + (l <= 3 ? "<span class='dt-hot'>" + l + " left</span>" : "<span>For " + c.size + "</span>") + "</div>"
      + "<b>" + esc(c.title) + "</b></div>"
      + "<div class='dt-body'><div class='v'><div class='t'><div>📍 " + esc(c.venueName) + (c.city ? ", " + esc(c.city.split(",")[0]) : "") + (c.venueRating && c.venueRating.n ? " · " + stars(c.venueRating.avg, c.venueRating.n) : "") + "</div><div>" + esc(when(c.startsAt)) + "</div><div>" + esc((c.items || []).slice(0, 2).join(" · ")) + "</div></div></div>"
      + "<div class='dt-price'><b>" + money(c.price) + "</b><small>for " + c.size + "</small>" + (c.idCheck ? "<span class='dt-idb'>🪪 21+ ID</span>" : "") + "</div></div></button>";
  }
  function connectHow() {
    return "<div class='dt-box' style='border-color:rgba(224,69,123,.4)'><h3>How Connect Me works</h3><p>Night-out packages at real places, for a set day and time. You buy it, then bring who you want.</p><ol class='dt-steps'>"
      + "<li><b>1</b><strong>Buy it</strong>One price covers everyone (dinner for 2, bowling for 4…).</li>"
      + "<li><b>2</b><strong>Invite</strong>Pick a member here, or send a link anywhere. They join free to accept.</li>"
      + "<li><b>3</b><strong>Check in</strong>Each of you taps “I'm here” at the place, or shows your code.</li>"
      + "</ol></div>";
  }
  function conBox(o) {
    if (o.invite) return "<div class='dt-box' style='border-color:rgba(224,69,123,.5)'><div class='dt-row'><h3 style='margin:0'>💌 " + esc(o.buyerName) + " invited you</h3><span class='dt-pill purple'>Paid for</span></div>"
      + "<p style='margin:6px 0'>" + esc(o.title) + " · " + esc(o.venueName) + " · " + esc(when(o.startsAt)) + "</p>"
      + "<button class='dt-btn' onclick=\"Dates.openInvite('" + esc(o.token) + "')\">See invite</button></div>";
    var now = Date.now(), live = o.status === "paid", hereOpen = live && now > o.startsAt - 3600000 && now < o.startsAt + 3 * 3600000;
    var st = live ? (o.here ? ["ok", "Checked in"] : ["ok", "Booked"]) : o.status === "canceled" ? ["bad", "Canceled · money back as credit"] : ["purple", "Done"];
    var maps = "https://maps.google.com/?q=" + encodeURIComponent(o.venueName + ", " + o.address + ", " + o.city);
    var seats = (o.seats || []).map(function (x) {
      var label = x.role === "buyer" ? (o.buyer ? "You" : esc(x.name)) : x.status === "accepted" ? esc(x.name) : x.status === "invited" ? "Invited · waiting for them" : "Open spot";
      var acts = "";
      if (o.buyer && live && x.role === "guest" && x.status !== "accepted") acts = "<span class='dt-actions'><button class='dt-btn ghost' style='min-height:34px;padding:6px 12px' onclick=\"Dates.connectInviteMember('" + o.id + "'," + x.i + ")\">👋 Member</button><button class='dt-btn' style='min-height:34px;padding:6px 12px' onclick=\"Dates.shareSeat('" + o.id + "'," + x.i + ")\">↗ Send link</button>" + (x.status === "invited" ? "<button class='dt-btn ghost' style='min-height:34px;padding:6px 12px' onclick=\"Dates.newConnectLink('" + o.id + "'," + x.i + ",this)\">New link</button>" : "") + "</span>";
      else if (o.buyer && live && x.role === "guest" && x.status === "accepted" && !x.here) acts = "<button class='dt-btn ghost' style='min-height:30px;padding:4px 10px;font-size:11.5px' onclick=\"Dates.newConnectLink('" + o.id + "'," + x.i + ",this)\">Swap</button>";
      return "<div class='dt-seat'><span>" + (x.here ? "✅ " : x.status === "accepted" ? "👤 " : "➕ ") + label + "</span>" + acts + "</div>";
    }).join("");
    return "<div class='dt-box' style='border-color:rgba(224,69,123,.4)'><div class='dt-row'><h3 style='margin:0'>💞 " + esc(o.title) + "</h3><span class='dt-pill " + st[0] + "'>" + st[1] + "</span></div>"
      + "<p style='margin:6px 0'>" + esc(when(o.startsAt)) + (o.buyer ? "" : " · from " + esc(o.buyerName)) + "</p>"
      + (live && o.address ? "<div class='dt-rules'>📍 <b>" + esc(o.venueName) + "</b><br>" + esc(o.address) + ", " + esc(o.city) + (o.venuePhone ? "<br>📞 <a href='tel:" + esc(String(o.venuePhone).replace(/[^0-9+]/g, "")) + "' style='color:#00e3ae'>" + esc(o.venuePhone) + "</a>" : "") + "<br><a href='" + maps + "' target='_blank' rel='noopener' style='color:#00e3ae'>Open in Maps</a></div>" : "")
      + (o.buyer || seats ? "<div style='margin-top:8px'><div class='lbl' style='font-size:11px;color:#9a8fb5;font-weight:800;letter-spacing:.08em'>WHO'S GOING</div>" + seats + "</div>" : "")
      + (live && o.code ? "<div style='text-align:center;margin-top:10px'><div class='dt-code' style='color:#ff8fb3'>" + esc(o.code) + "</div><div style='font-size:12px;color:#9a8fb5'>Your code. Show it if the staff asks.</div></div>" : "")
      + (live && o.idCheck ? "<div class='dt-rules' style='margin-top:8px'>🪪 <b>21+:</b> everyone brings a valid photo ID. It's checked at the door.</div>" : "")
      + (o.canRate ? starRow("cm", o.id, o.myStars || 0) : "")
      + (live ? "<div class='dt-actions' style='margin-top:10px'>" + (hereOpen && !o.here ? "<button class='dt-btn teal' onclick=\"Dates.imHere('" + o.id + "',this)\">📍 I'm here</button>" : !o.here ? "<span style='font-size:12px;color:#9a8fb5'>“I'm here” opens an hour before.</span>" : "") + "</div>" : "")
      + "</div>";
  }

  /* ---------- panel below the phone ---------- */
  var ST = { draft: ["warn", "Deposit not paid"], pending: ["purple", "Being reviewed"], changes: ["warn", "Needs a change"], live: ["ok", "On sale"], review: ["warn", "Being checked"], paying: ["ok", "Payout coming"], completed: ["ok", "Done"], canceled: ["bad", "Canceled"], rejected: ["bad", "Not approved"], expired: ["bad", "Expired"] };
  function howItWorks() {
    return "<div class='dt-box'><h3>How M&G works</h3><p><b>M&G stands for Meet &amp; Greet:</b> real-life hangouts at public places with creators, hosts and members you know from Whisper+Me.</p><ol class='dt-steps'>"
      + "<li><b>1</b><strong>Pick one</strong>Dinners, shows, game nights. Bring friends: up to " + MAX_QTY + " spots at once.</li>"
      + "<li><b>2</b><strong>Get your spot</strong>One price per person. The address and your code show up right away.</li>"
      + "<li><b>3</b><strong>Show your code</strong>At the door. If the host cancels or doesn't show, you get all your money back.</li>"
      + "</ol></div>";
  }
  function ticketBox(m) {
    var st = m.status === "live" ? (m.guestCheckedIn ? ["ok", "Checked in"] : ["ok", "You're going"]) : m.status === "canceled" ? ["bad", "Canceled · money back as credit"] : m.status === "completed" || m.status === "paying" ? ["purple", "Done"] : ST[m.status] || ["warn", m.status];
    var maps = "https://maps.google.com/?q=" + encodeURIComponent(m.venueName + ", " + m.address + ", " + m.city);
    return "<div class='dt-box'><div class='dt-row'><h3 style='margin:0'>" + esc(m.title) + "</h3><span class='dt-pill " + st[0] + "'>" + st[1] + "</span></div>"
      + "<p style='margin:6px 0'>" + (m.official ? "Whisper+Me M&G" : "with " + esc(m.hostName)) + " · " + esc(when(m.startsAt)) + "</p>"
      + (m.address && m.status !== "canceled" ? "<div class='dt-rules'>📍 <b>" + esc(m.venueName) + "</b><br>" + esc(m.address) + ", " + esc(m.city) + (m.venuePhone ? "<br>📞 <a href='tel:" + esc(String(m.venuePhone).replace(/[^0-9+]/g, "")) + "' style='color:#00e3ae'>" + esc(m.venuePhone) + "</a>" : "") + "<br><a href='" + maps + "' target='_blank' rel='noopener' style='color:#00e3ae'>Open in Maps</a></div>" : "")
      + (m.status === "live" && m.code ? "<div style='text-align:center;margin-top:10px'><div class='dt-code'>" + esc(m.code) + "</div><div style='font-size:12px;color:#9a8fb5'>" + ((m.qty || 1) > 1 ? "<b style='color:#fff'>Good for " + m.qty + " people.</b> " : "") + "Show this code to " + esc(hostLabel(m)) + " when you get there.</div></div>" : "")
      + (m.status === "live" && m.idCheck ? "<div class='dt-rules' style='margin-top:8px'>🪪 <b>21+:</b> bring a valid photo ID" + ((m.qty || 1) > 1 ? " (everyone in your group)" : "") + ". It's checked at the door.</div>" : "")
      + (m.canRate ? starRow("mg", m.id, m.myStars || 0) : "")
      + "<div class='dt-actions' style='margin-top:10px'>"
      + (m.status === "live" ? "<button class='dt-btn ghost' onclick=\"Dates.shareMeetup('" + m.id + "')\">↗ Bring a friend</button>" : "")
      + (m.canReport && !m.reported ? "<button class='dt-btn ghost' onclick=\"Dates.reportMeetup('" + m.id + "')\">Report a problem</button>" : "")
      + (m.reported ? "<span class='dt-pill warn'>Reported. We're looking into it.</span>" : "")
      + "</div></div>";
  }
  function hostNext(m) {
    var dep = m.hostDeposit || {};
    switch (m.status) {
      case "draft": return "Next: pay your " + money(dep.amount) + " deposit to send it for review.";
      case "pending": return "We're reviewing it, usually within a day. We may call you or the place to confirm.";
      case "changes": return "Fix what we asked below, then save. It comes right back to us.";
      case "live": return m.sold ? "On sale. Share your link to sell more. On the day, check guests in with their codes." : "On sale! Share your link: most spots sell from the host's own posts.";
      case "review": return "We're checking how it went before paying you. We'll be in touch if we need anything.";
      case "paying": return "You'll get " + money(m.hostCut * m.sold) + " on " + esc(day(m.payoutAt)) + ". Buyers can report a problem until then." + payoutHint();
      case "completed": return (m.hostEarned ? "Added " + money(m.hostEarned) + " to your earnings." : "All done.") + payoutHint();
      default: return "";
    }
  }
  function payoutHint() {
    var u = window.me || {};
    return u.stripeAccountId ? " It's sent to your bank once your earnings reach $50." : " <b>Set up payouts</b> (👤 Profile → Wallet) so we can send it to your bank.";
  }
  function hostBox(m) {
    var st = ST[m.status] || ["warn", m.status];
    var dayOf = Math.abs(m.startsAt - Date.now()) < 12 * 3600000;
    var open = ["draft", "pending", "changes", "live"].indexOf(m.status) > -1;
    var guests = (m.guests || []);
    return "<div class='dt-box'><div class='dt-row'><h3 style='margin:0'>" + esc(m.title) + "</h3><span class='dt-pill " + st[0] + "'>" + (m.hidden && m.status === "live" ? "Paused" : st[1]) + "</span></div>"
      + "<p style='margin:6px 0 0'>" + esc(m.venueName) + (m.address ? ", " + esc(m.address) : "") + "<br>" + esc(when(m.startsAt)) + " · " + money(m.price) + " a spot · <b>" + (m.sold || 0) + " of " + m.spots + "</b> sold</p>"
      + "<div class='dt-next'>" + hostNext(m) + "</div>"
      + (m.ratings ? "<p style='margin:6px 0 0;font-size:13px'>Guests rated it " + stars(m.rating, m.ratings) + "</p>" : "")
      + (m.idCheck && ["live", "pending", "changes"].indexOf(m.status) > -1 ? "<p style='margin:6px 0 0;font-size:12.5px;color:#ffba49'>🪪 21+: check each guest's photo ID at the door.</p>" : "")
      + (m.status === "changes" && m.changesNote ? "<div class='dt-warn'><b>What to change:</b> " + esc(m.changesNote) + "</div>" : "")
      + (guests.length ? "<div class='dt-guests'>" + guests.map(function (g) { return "<span class='dt-g" + (g.here ? " here" : "") + "'>" + (g.here ? "✓ " : "") + esc(g.name) + "</span>"; }).join("") + "</div>" : "")
      + "<div class='dt-actions'>"
      + (m.status === "draft" ? "<button class='dt-btn' onclick=\"Dates.payHostDeposit('" + m.id + "',this)\">Pay " + money((m.hostDeposit || {}).amount) + " deposit</button>" : "")
      + (m.status === "live" && dayOf ? "<button class='dt-btn teal' onclick=\"Dates.checkInGuest('" + m.id + "')\">✅ Check in guests (" + m.checkedIn + ")</button>" : "")
      + ((m.status === "paying" || m.status === "completed") && !m.official && !(window.me || {}).stripeAccountId && window.connectStripe ? "<button class='dt-btn gold' onclick='connectStripe()'>💸 Set up payouts</button>" : "")
      + (m.status === "live" ? "<button class='dt-btn' onclick=\"Dates.shareMeetup('" + m.id + "')\">↗ Share</button>" : "")
      + (open && !m.official ? "<button class='dt-btn ghost' onclick=\"Dates.hostMeetup('" + m.id + "')\">✏️ " + (m.status === "changes" ? "Fix it" : "Edit") + "</button>" : "")
      + (open && !m.official ? "<button class='dt-btn ghost' onclick=\"Dates.cancelMeetup('" + m.id + "',this)\">Cancel</button>" : "")
      + "</div></div>";
  }
  function hostPitch() {
    return "<div class='dt-box' style='border-color:rgba(214,177,107,.4)'><h3>⭐ Host an M&G (Meet &amp; Greet)</h3>"
      + "<p>Meet your fans or followers in person at a public place. You set the price per spot and keep <b>" + hostKeep() + "%</b>. Card fees are on us.</p>"
      + "<ol class='dt-steps' style='margin-bottom:12px'>"
      + "<li><b>1</b><strong>Post it</strong>Pick the place, time, price and spots.</li>"
      + "<li><b>2</b><strong>We review it</strong>Usually within a day. Then share your link.</li>"
      + "<li><b>3</b><strong>Get paid</strong>Check guests in. Your money hits your earnings " + payoutDays() + " days after, then your bank.</li></ol>"
      + "<p style='font-size:12px'>One-time deposit: one spot's price (or $5 for a 1-spot M&G). It stays on your account and covers all your M&Gs; it's only kept if you cancel late or don't show." + (S.depositOnFile ? " <b style='color:#fff'>You have " + money(S.depositOnFile) + " on file.</b>" : "") + " To cash out, set up payouts once in 👤 Profile → Wallet.</p>"
      + "<button class='dt-btn gold' onclick='Dates.hostMeetup()'>⭐ Host one</button></div>";
  }
  function creditBox() {
    return S.credit > 0 ? "<div class='dt-box' style='border-color:rgba(0,227,174,.45)'><div class='dt-row'><h3 style='margin:0'>💳 Whisper+Me credit</h3><span class='dt-pill ok'>" + money(S.credit) + "</span></div>"
      + "<p style='margin:8px 0'>It's used first on your next M&G or Connect Me, with no card needed.</p><button class='dt-btn ghost' onclick='Dates.creditToCard(this)'>Send it to my card instead</button></div>" : "";
  }
  function panelInner() {
    if (!me()) return S.anon ? (S.mode === "cm" ? connectHow() : howItWorks()) : "";
    var out = creditBox();
    var t = myTickets(), h = myHosted(), c = myCons();
    if (S.mode === "cm") {
      out += c.length ? "<div class='dt-sec'>💞 Your Connect Me</div>" + c.map(conBox).join("") : "";
      out += connectHow();
      if (t.length) out += "<div class='dt-sec'>🎟️ M&G tickets</div>" + t.map(ticketBox).join("");
      return out;
    }
    if (t.length) out += "<div class='dt-sec'>🎟️ My tickets</div>" + t.map(ticketBox).join("");
    if (c.length) out += "<div class='dt-sec'>💞 Your Connect Me</div>" + c.map(conBox).join("");
    if (h.length) out += "<div class='dt-sec'>⭐ M&Gs you host</div>" + h.map(hostBox).join("");
    if (!t.length) out += howItWorks();
    out += hostPitch();
    var m = S.member;
    if (m && m.suspendedUntil && ms(m.suspendedUntil) > Date.now()) out = "<div class='dt-warn'>You're on a break from hosting and booking M&Gs until " + esc(when(m.suspendedUntil)) + ".</div>" + out;
    var old = S.myDates.filter(function (d) { return (d.status === "forming" || d.status === "confirmed") && ms(d.startsAt) > Date.now() - 6 * 3600000; });
    if (old.length) out += "<div class='dt-sec'>Earlier bookings</div>" + old.map(legacyCard).join("");
    return out;
  }

  function openPending() {
    if (typeof active === "undefined" || active !== 4) return;
    var rt = null; try { rt = sessionStorage.getItem("wpmRate"); } catch (e) {}
    if (rt && me() && S.loadedMine) {
      try { sessionStorage.removeItem("wpmRate"); } catch (e) {}
      var parts = rt.split(":");
      setTimeout(function () { Dates.rate(parts[0] === "cm" ? "cm" : "mg", parts[1]); }, 50);
      return;
    }
    var tok = null; try { tok = sessionStorage.getItem("wpmConnect"); } catch (e) {}
    if (tok && anyUser()) { try { sessionStorage.removeItem("wpmConnect"); } catch (e) {} S.mode = "cm"; setTimeout(function () { refresh(); Dates.openInvite(tok); }, 50); return; }
    if (!S.meetups.length) return;
    var mid = null; try { mid = sessionStorage.getItem("wpmMeetup"); } catch (e) {}
    if (!mid) return;
    try { sessionStorage.removeItem("wpmMeetup"); } catch (e) {}
    if (S.meetups.some(function (x) { return x.id === mid; })) setTimeout(function () { Dates.openMeetup(mid); }, 50);
    else toast("That M&G isn't on sale anymore. Here's what's on.", "warn");
  }
  function refresh() {
    setTimeout(openPending, 0);
    var p = $i("datesPhone");
    if (p) {
      var sc = p.querySelector(".dt-list"), top = sc ? sc.scrollTop : 0, cs = p.querySelector(".dt-cats"), lft = cs ? cs.scrollLeft : 0;
      p.innerHTML = phoneInner();
      var sc2 = p.querySelector(".dt-list"); if (sc2) sc2.scrollTop = top;
      var cs2 = p.querySelector(".dt-cats"); if (cs2) { cs2.style.scrollBehavior = "auto"; cs2.scrollLeft = lft; cs2.style.scrollBehavior = ""; Dates.catScroll(cs2); }
    }
    var q = $i("datesPanel"); if (q) q.innerHTML = panelInner();
  }

  /* ---------- modal helpers (uses Whisper+me's profile modal) ---------- */
  function openModal(html) {
    var modal = $i("profileModal"), body = $i("profileModalBody");
    if (!modal || !body) return null;
    body.innerHTML = "<button onclick='closeProfileModal()' aria-label='Close' style='position:absolute;top:12px;right:14px;background:none;border:none;color:#888;font-size:22px;cursor:pointer;z-index:2;min-width:32px;min-height:32px'>✕</button><div class='dt-sheet'>" + html + "</div>";
    modal.style.display = "flex";
    return body;
  }
  function closeModal() { if (window.closeProfileModal) window.closeProfileModal(); }
  function people(exclude) {
    var all = window.allUsers || {};
    return Object.keys(all).filter(function (k) { return k !== S.uid && all[k] && all[k].name && (!exclude || exclude.indexOf(k) < 0); }).map(function (k) { return { uid: k, name: all[k].name, photo: all[k].photo || "" }; });
  }
  function findM(id) { return S.meetups.filter(function (x) { return x.id === id; })[0] || S.mine.filter(function (x) { return x.id === id; })[0]; }

  /* ---------- public API (called from onclick and app.js) ---------- */
  var Dates = {
    phoneHTML: function () { if (typeof active !== "undefined" && active === 4) start(); return "<div id='datesPhone' class='dt-phone'>" + phoneInner() + "</div>"; },
    panelHTML: function () { if (typeof active !== "undefined" && active === 4) start(); return "<div id='datesPanel' class='dt-panel'>" + panelInner() + "</div>"; },
    boot: function () { start(); refresh(); loadMine(); },
    mounted: function () { start(); refresh(); },
    setCat: function (c) { S.cat = c; refresh(); },
    setCatIdx: function (i) { S.cat = CATS[i] || "All"; refresh(); },
    setMode: function (m) { S.mode = m === "cm" ? "cm" : "mg"; S.cat = "All"; refresh(); },

    /* ---------- Connect Me ---------- */
    openConnect: function (id) {
      var c = S.connects.filter(function (x) { return x.id === id; })[0];
      if (!c) return toast("That package just sold out.", "warn");
      var l = c.quantity - c.sold - c.held, needYear = !S.anon && S.member === null;
      openModal("<div style='margin:-18px -18px 0;border-radius:14px 14px 0 0;overflow:hidden'><div class='dt-poster' style='height:150px;background:" + grad(c.hue != null ? c.hue : hue(c.title)) + "'>"
        + (c.imageURL ? "<img src='" + esc(c.imageURL) + "' alt=''>" : "") + "<div class='k'><span>💞 Connect Me</span>" + (l <= 3 ? "<span class='dt-hot'>" + l + " left</span>" : "") + "</div><b style='font-size:23px'>" + esc(c.title) + "</b></div></div>"
        + "<div><b>" + esc(when(c.startsAt)) + "</b><br><small style='color:#9a8fb5'>📍 " + esc(c.venueName) + (c.city ? ", " + esc(c.city) : "") + "</small></div>"
        + "<div class='dt-facts'><div><b>" + money(c.price) + "</b>for " + c.size + " people</div><div><b>" + money(Math.round(c.price / c.size)) + "</b>each</div><div><b>" + l + "</b>left</div></div>"
        + (c.about ? "<p style='margin:0;line-height:1.55;font-size:14px'>" + esc(c.about) + "</p>" : "")
        + ((c.items || []).length ? "<div><div class='lbl'>Included</div><div style='font-size:14px;line-height:1.6'>" + c.items.map(function (i) { return "✓ " + esc(i); }).join("<br>") + "</div></div>" : "")
        + "<div class='dt-rules'><b>How it works:</b> buy it, then invite who you're bringing: pick a member here, or send them a link (they join free to accept). The address and everyone's code show up right after. At the place, each of you taps <b>“I'm here.”</b></div>"
        + (c.venueRating && c.venueRating.n ? "<div style='font-size:13px'>People rated " + esc(c.venueName) + " " + stars(c.venueRating.avg, c.venueRating.n) + "</div>" : "")
        + (needYear ? birthYearField("cmYear") : "")
        + (c.idCheck && !S.anon ? idOkBox("cmIdOk") : "")
        + (S.credit > 0 && !S.anon ? "<div class='dt-rules' style='color:#00e3ae'>💳 Your " + money(S.credit) + " credit is used first.</div>" : "")
        + "<div id='cmErr' class='dt-err'></div><button class='dt-btn big' id='cmBuy' style='background:linear-gradient(90deg,#7b2ff7,#e0457b)'>" + (S.anon ? "Sign up free to get it" : "Get it · " + money(c.price)) + "</button>"
        + "<p class='dt-fine'>Paid packages aren't refundable. If the place or Whisper+Me cancels, you get all your money back. By buying you agree to the <a href='/terms.html' target='_blank' rel='noopener'>terms</a>.</p>");
      $i("cmBuy").onclick = function () {
        if (S.anon) { if (window.promptGuestUpgrade) window.promptGuestUpgrade("Connect Me"); return; }
        var data = { dealId: c.id };
        if (needYear) { data.birthYear = +($i("cmYear") || {}).value; if (!data.birthYear) { $i("cmErr").textContent = "Pick your birth year first."; return; } }
        if (c.idCheck) { if (!$i("cmIdOk").checked) { $i("cmErr").textContent = "This one is 21+ with ID at the door. Tick the ID box to continue."; return; } data.idOk = true; }
        busy(this, fn("buyConnect", data)).then(function (r) { if (r.done) { closeModal(); toast(r.message); loadMine(); } else location.href = r.url; }, function (e) { $i("cmErr").textContent = e.message; });
      };
    },
    openInvite: function (token) {
      fn("connectInvite", { token: token }).then(function (v) {
        var needYear = !S.anon && S.member === null;
        openModal("<div style='margin:-18px -18px 0;border-radius:14px 14px 0 0;overflow:hidden'><div class='dt-poster' style='height:130px;background:" + grad(v.hue != null ? v.hue : hue(v.title)) + "'>" + (v.imageURL ? "<img src='" + esc(v.imageURL) + "' alt=''>" : "") + "<div class='k'><span>💌 You're invited</span></div><b style='font-size:22px'>" + esc(v.title) + "</b></div></div>"
          + "<p style='margin:0;font-size:15px'><b>" + esc(v.from) + "</b> invited you out. It's already paid for.</p>"
          + "<div><b>" + esc(when(v.startsAt)) + "</b><br><small style='color:#9a8fb5'>📍 " + esc(v.venueName) + (v.city ? ", " + esc(v.city) : "") + "</small></div>"
          + ((v.items || []).length ? "<div style='font-size:14px;line-height:1.6'>" + v.items.map(function (i) { return "✓ " + esc(i); }).join("<br>") + "</div>" : "")
          + (v.mine ? "<div class='dt-rules'>You already accepted. Your code and the address are under 💞 Connect Me.</div>"
            : v.taken ? "<div class='dt-warn'>Someone already accepted this invite.</div>"
            : v.forSomeoneElse ? "<div class='dt-warn'>This invite was sent to someone else.</div>"
            : (needYear ? birthYearField("ivYear") : "") + (v.idCheck && !S.anon ? idOkBox("ivIdOk") : "") + "<div id='ivErr' class='dt-err'></div><button class='dt-btn big' id='ivGo' style='background:linear-gradient(90deg,#7b2ff7,#e0457b)'>" + (S.anon ? "Sign up free to accept" : "Accept 💞") + "</button><p class='dt-fine'>Free to accept. 21+ only. You'll get the address and your own code.</p>"));
        var b = $i("ivGo");
        if (b) b.onclick = function () {
          if (S.anon) { try { sessionStorage.setItem("wpmConnect", token); } catch (e) {} if (window.promptGuestUpgrade) window.promptGuestUpgrade("Accepting a Connect Me invite"); return; }
          var data = { token: token };
          if (needYear) { data.birthYear = +($i("ivYear") || {}).value; if (!data.birthYear) { $i("ivErr").textContent = "Pick your birth year first."; return; } }
          if (v.idCheck) { if (!$i("ivIdOk").checked) { $i("ivErr").textContent = "This one is 21+ with ID at the door. Tick the ID box to accept."; return; } data.idOk = true; }
          busy(b, fn("acceptConnect", data)).then(function (r) { closeModal(); toast(r.message); S.mode = "cm"; loadMine(); }, function (e) { $i("ivErr").textContent = e.message; });
        };
      }, function (e) { toast(e.message, "error"); });
    },
    shareSeat: function (orderId, i) {
      var o = S.myCon.filter(function (x) { return x.id === orderId; })[0] || {}, st = (o.seats || [])[i] || {};
      if (st.link) Dates.shareConnect(st.link, o.title);
    },
    shareConnect: function (link, title) {
      var text = "I got us a spot: " + (title || "a night out") + ". Tap to accept (free).";
      if (navigator.share) { navigator.share({ title: "You're invited · Whisper+Me", text: text, url: link }).catch(function () {}); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text + " " + link).then(function () { toast("Invite link copied. Send it to them anywhere."); }, function () { prompt("Copy this invite link:", link); });
      else prompt("Copy this invite link:", link);
    },
    connectInviteMember: function (orderId, seat) {
      var draw = function (q) {
        var list = people().filter(function (p) { return !q || p.name.toLowerCase().indexOf(q.toLowerCase()) > -1; }).slice(0, 40);
        openModal("<h3>👋 Invite a member</h3><p style='margin:0;color:#b3abcf;font-size:13px'>They get a notification and accept for free.</p>"
          + "<input class='dt-in' id='cmInvQ' placeholder='Search members' value='" + esc(q || "") + "'>"
          + "<div class='dt-picks'>" + (list.length ? list.map(function (p) { return "<button class='dt-pick' data-uid='" + esc(p.uid) + "'>" + avatar(p, 40) + "<span style='max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc(p.name) + "</span></button>"; }).join("") : "<span style='color:#7d7699;font-size:13px'>No members match.</span>") + "</div>");
        var sI = $i("cmInvQ"); sI.oninput = function () { var v = sI.value; draw(v); var n = $i("cmInvQ"); n.focus(); n.setSelectionRange(v.length, v.length); };
        document.querySelectorAll(".dt-picks [data-uid]").forEach(function (b) {
          b.onclick = function () { busy(b, fn("inviteToConnect", { orderId: orderId, seat: seat, uid: b.getAttribute("data-uid") })).then(function () { closeModal(); toast("Invite sent 💞"); loadMine(); }, function (e) { toast(e.message, "error"); }); };
        });
      };
      draw("");
    },
    newConnectLink: function (orderId, seat, btn) {
      if (!confirm("Give this spot a new link? The old link stops working.")) return;
      busy(btn, fn("newConnectLink", { orderId: orderId, seat: seat })).then(function (r) { toast(r.message); loadMine(); }, function (e) { toast(e.message, "error"); });
    },
    imHere: function (orderId, btn) {
      var send = function (pos) {
        busy(btn, fn("connectHere", Object.assign({ orderId: orderId }, pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : {}))).then(function (r) { toast(r.message); loadMine(); }, function (e) { toast(e.message, "error"); });
      };
      if (navigator.geolocation) navigator.geolocation.getCurrentPosition(send, function () { send(null); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
      else send(null);
    },
    creditToCard: function (btn) {
      if (!confirm("Send your " + money(S.credit) + " credit back to your card? It takes 5–10 days to show up.")) return;
      busy(btn, fn("creditToCard")).then(function (r) { toast(r.message); loadMine(); }, function (e) { toast(e.message, "error"); });
    },
    catScroll: function (el) {
      var bar = el && el.nextElementSibling; if (!bar || !bar.firstChild) return;
      var w = el.scrollWidth, c = el.clientWidth;
      bar.style.visibility = w > c + 2 ? "visible" : "hidden";
      bar.firstChild.style.width = Math.max(12, c / w * 100) + "%";
      bar.firstChild.style.left = (el.scrollLeft / w * 100) + "%";
    },
    catJump: function (e, bar) { var el = bar.previousElementSibling, r = bar.getBoundingClientRect(); if (el) el.scrollLeft = (e.clientX - r.left) / r.width * el.scrollWidth - el.clientWidth / 2; },
    catWheel: function (e, el) { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); } },

    /* The M&G page: everything a buyer needs, one button. */
    openMeetup: function (id) {
      var m = S.meetups.filter(function (x) { return x.id === id; })[0];
      if (!m) return toast("That M&G just sold out.", "warn");
      var l = left(m), mine = m.hostUid === S.uid && !m.official;
      var have = S.mine.filter(function (x) { return x.id === id && !x.host && x.code; })[0];
      var needYear = !S.anon && S.member === null;
      openModal("<div style='margin:-18px -18px 0;border-radius:14px 14px 0 0;overflow:hidden'><div class='dt-poster' style='height:150px;background:" + grad(m.hue != null ? m.hue : hue(m.title)) + "'>"
        + (m.imageURL ? "<img src='" + esc(m.imageURL) + "' alt=''>" : "") + "<div class='k'><span>" + (m.official ? "⭐ Whisper+Me pick" : (CAT_ICON[m.category] || "⭐") + " " + esc(m.category || "M&G")) + "</span>" + (l <= 5 ? "<span class='dt-hot'>" + l + " left</span>" : "") + "</div><b style='font-size:23px'>" + esc(m.title) + "</b></div></div>"
        + "<div class='dt-row' style='justify-content:flex-start;gap:10px;flex-wrap:nowrap'>" + avatar({ name: hostLabel(m), photo: m.hostPhoto }, 46) + "<div><b>" + (m.official ? "Hosted by Whisper+Me" : "with " + esc(m.hostName)) + "</b>" + (hostStars(m) ? " " + hostStars(m) : "") + "<br><small style='color:#9a8fb5'>" + esc(when(m.startsAt)) + "<br>📍 " + esc(m.venueName) + (m.city ? ", " + esc(m.city) : "") + "</small></div></div>"
        + "<div class='dt-facts'><div><b>" + money(m.price) + "</b>per person</div><div><b>" + l + "</b>spot" + (l === 1 ? "" : "s") + " left</div>" + ((m.sold || 0) >= 1 ? "<div><b>" + m.sold + "</b>going</div>" : "") + "</div>"
        + (m.about ? "<p style='margin:0;line-height:1.55;font-size:14px'>" + esc(m.about) + "</p>" : "")
        + ((m.items || []).length ? "<div><div class='lbl'>Included</div><div style='font-size:14px;line-height:1.6'>" + m.items.map(function (i) { return "✓ " + esc(i); }).join("<br>") + "</div></div>" : "")
        + "<div class='dt-rules'>📍 You get the exact address and the place's phone number <b>right after you pay</b>, with your entry code.</div>"
        + (have ? "<div class='dt-rules' style='text-align:center'>You're going! Your code: <span class='dt-code' style='font-size:18px'>" + esc(have.code) + "</span></div>"
          : mine ? "<div class='dt-rules'>This is your M&G. Share it so people can find it.</div>"
          : (needYear ? birthYearField("dtMgYear") : "")
            + (S.anon || l < 2 ? "" : "<div class='dt-row' style='flex-wrap:nowrap'><div><div class='lbl' style='margin:0'>How many spots?</div><small style='color:#9a8fb5'>You + friends, one code for the group</small></div>"
              + "<div class='dt-qty'><button class='dt-btn ghost' id='dtQm' aria-label='One less'>−</button><b id='dtQn'>1</b><button class='dt-btn ghost' id='dtQp' aria-label='One more'>+</button></div></div>")
            + (m.idCheck && !S.anon ? idOkBox("dtMgIdOk") : "")
            + (S.credit > 0 ? "<div class='dt-rules' style='color:#00e3ae'>💳 Your " + money(S.credit) + " credit is used first.</div>" : "")
            + "<div id='dtMgErr' class='dt-err'></div>"
            + "<button class='dt-btn big' id='dtMgBuy'>" + (S.anon ? "Sign up free to get a spot" : "Get my spot · " + money(m.price)) + "</button>"
            + "<p class='dt-fine'>Spots aren't refundable, except: if the host cancels or doesn't show up, you get all your money back automatically. By buying you agree to the <a href='/terms.html' target='_blank' rel='noopener'>M&G terms</a>.</p>")
        + "<div class='dt-actions'><button class='dt-btn ghost' style='flex:1' onclick=\"Dates.shareMeetup('" + m.id + "')\">↗ Share</button>"
        + (S.anon ? "" : "<button class='dt-btn ghost' style='flex:1' onclick=\"Dates.inviteMember('" + m.id + "')\">👋 Invite a member</button>") + "</div>");
      var b = $i("dtMgBuy"), qty = 1, maxQ = Math.min(MAX_QTY, l);
      var setQ = function (n) { qty = Math.max(1, Math.min(maxQ, n)); $i("dtQn").textContent = qty; b.textContent = qty > 1 ? "Get " + qty + " spots · " + money(m.price * qty) : "Get my spot · " + money(m.price); };
      if ($i("dtQp")) { $i("dtQp").onclick = function () { setQ(qty + 1); }; $i("dtQm").onclick = function () { setQ(qty - 1); }; }
      if (b) b.onclick = function () {
        if (S.anon) { try { sessionStorage.setItem("wpmMeetup", m.id); } catch (e) {} if (window.promptGuestUpgrade) window.promptGuestUpgrade("Getting a spot at an M&G"); return; }
        var data = { meetupId: m.id, qty: qty };
        if (needYear) { data.birthYear = +($i("dtMgYear") || {}).value; if (!data.birthYear) { $i("dtMgErr").textContent = "Pick your birth year first."; return; } }
        if (m.idCheck) { if (!$i("dtMgIdOk").checked) { $i("dtMgErr").textContent = "This one is 21+ with ID at the door. Tick the ID box to continue."; return; } data.idOk = true; }
        busy(b, fn("buyMeetupSpot", data)).then(function (r) { if (r.done) { closeModal(); toast(r.message); loadMine(); setTimeout(Dates.showTickets, 1500); } else location.href = r.url; }, function (e) { $i("dtMgErr").textContent = e.message; });
      };
    },
    /* ⭐ Rate an M&G (the host) or a Connect Me (the night and the place). Stars are public; the comment only goes to Whisper+Me. */
    rate: function (kind, id, pre) {
      if (!me()) return;
      var it = kind === "cm" ? S.myCon.filter(function (x) { return x.id === id; })[0] : S.mine.filter(function (x) { return x.id === id && !x.host; })[0];
      var title = it ? it.title : "it", n = pre || (it && it.myStars) || 0;
      var who = kind === "cm" ? "the night and " + esc(it ? it.venueName : "the place") : it && !it.official ? esc(it.hostName) + " as a host" : "the night";
      openModal("<h3>⭐ How was " + esc(title) + "?</h3><p style='margin:0;color:#b3abcf;font-size:13px'>Rate " + who + ".</p>"
        + "<div class='dt-starbtns dt-starbig' id='rtStars' role='group' aria-label='Rate 1 to 5 stars' style='justify-content:center'>" + [1, 2, 3, 4, 5].map(function (k) { return "<button data-n='" + k + "' aria-label='" + k + " star" + (k === 1 ? "" : "s") + "'>★</button>"; }).join("") + "</div>"
        + "<div id='rtWord' style='text-align:center;font-weight:800;min-height:20px'></div>"
        + "<textarea class='dt-in' id='rtText' rows='3' maxlength='600' placeholder='Anything we should know? (optional)'></textarea>"
        + "<p class='dt-fine' style='margin:0'>Only Whisper+Me sees your comment. Your stars count toward the " + (kind === "cm" ? "place's" : "host's") + " rating.</p>"
        + "<div id='rtErr' class='dt-err'></div><button class='dt-btn big' id='rtGo'>Send rating</button>");
      var words = ["", "Bad", "Not great", "OK", "Good", "Amazing!"];
      var set = function (k) { n = k; document.querySelectorAll("#rtStars button").forEach(function (b) { b.classList.toggle("on", +b.getAttribute("data-n") <= k); }); $i("rtWord").textContent = words[k] || ""; };
      document.querySelectorAll("#rtStars button").forEach(function (b) { b.onclick = function () { set(+b.getAttribute("data-n")); }; });
      set(n);
      $i("rtGo").onclick = function () {
        if (!n) { $i("rtErr").textContent = "Tap 1 to 5 stars."; return; }
        busy(this, fn("rateEvent", { kind: kind, id: id, stars: n, text: $i("rtText").value })).then(function (r) { closeModal(); toast(r.message); loadMine(); }, function (e) { $i("rtErr").textContent = e.message; });
      };
    },
    showTickets: function () {
      var t = myTickets(), c = myCons();
      openModal("<h3>🎟️ My tickets</h3>" + creditBox() + (t.length || c.length ? t.map(ticketBox).join("") + c.map(conBox).join("") : "<div class='dt-rules'>No tickets yet. Pick an M&G or a Connect Me package: the address and your code show up here right away.</div>")
        + "<button class='dt-btn ghost' onclick='closeProfileModal()'>Close</button>");
      if (!S.loadedMine) loadMine();
    },
    shareMeetup: function (id) {
      var m = findM(id) || {};
      var url = shareLink(id);
      var text = (m.title || "M&G") + (m.hostName && !m.official ? " with " + m.hostName : "") + (m.venueName ? " at " + m.venueName : "") + (m.startsAt ? ", " + when(m.startsAt) : "") + ". Spots are limited.";
      if (navigator.share) { navigator.share({ title: (m.title || "M&G") + " · Whisper+Me", text: text, url: url }).catch(function () {}); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text + " " + url).then(function () { toast("Link copied. Paste it anywhere."); }, function () { prompt("Copy this link:", url); });
      else prompt("Copy this link:", url);
    },
    /* Send another member a notification that opens this M&G. */
    inviteMember: function (id, preUid) {
      var m = findM(id) || {};
      var draw = function (q) {
        var list = people().filter(function (p) { return !q || p.name.toLowerCase().indexOf(q.toLowerCase()) > -1; }).slice(0, 40);
        openModal("<h3>👋 Invite a member</h3><p style='margin:0;color:#b3abcf;font-size:13px'>They get a notification that opens <b>" + esc(m.title || "this M&G") + "</b>.</p>"
          + "<input class='dt-in' id='dtInvQ' placeholder='Search members' value='" + esc(q || "") + "'>"
          + "<div class='dt-picks'>" + (list.length ? list.map(function (p) { return "<button class='dt-pick' data-uid='" + esc(p.uid) + "'>" + avatar(p, 40) + "<span style='max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc(p.name) + "</span></button>"; }).join("") : "<span style='color:#7d7699;font-size:13px'>No members match.</span>") + "</div>"
          + "<button class='dt-btn ghost' onclick=\"Dates.shareMeetup('" + id + "')\">Or share the link anywhere ↗</button>");
        var s = $i("dtInvQ"); s.oninput = function () { var v = s.value; draw(v); var n = $i("dtInvQ"); n.focus(); n.setSelectionRange(v.length, v.length); };
        document.querySelectorAll(".dt-picks [data-uid]").forEach(function (b) {
          b.onclick = function () { busy(b, fn("inviteToMeetup", { meetupId: id, uid: b.getAttribute("data-uid") })).then(function () { b.setAttribute("aria-pressed", "true"); toast("Invite sent"); }, function (e) { toast(e.message, "error"); }); };
        });
      };
      if (preUid) { fn("inviteToMeetup", { meetupId: id, uid: preUid }).then(function () { closeModal(); toast("Invite sent"); }, function (e) { toast(e.message, "error"); }); return; }
      draw("");
    },
    /* "Invite to an M&G" from someone's profile card: pick one, they get a notification. */
    askOut: function (uid) {
      var person = (window.allUsers || {})[uid] || {};
      var go = function () {
        var list = S.meetups.slice(0, 40);
        openModal("<h3>Invite " + esc(person.name || "them") + " to an M&G</h3><p style='margin:0;color:#b3abcf;font-size:13px'>Pick one. They get a notification and can grab their own spot.</p>"
          + (list.length ? list.map(function (m) {
            return "<button class='dt-opt' data-m='" + m.id + "'><span style='width:44px;height:44px;border-radius:10px;flex:none;background:" + grad(m.hue != null ? m.hue : hue(m.title)) + "'></span><span class='t'><b>" + esc(m.title) + "</b><small>" + esc(m.venueName) + " · " + esc(when(m.startsAt)) + "</small></span><b>" + money(m.price) + "</b></button>";
          }).join("") : "<div class='dt-rules'>No M&Gs on sale right now. Check back soon, or host one!</div>"));
        document.querySelectorAll(".dt-opt[data-m]").forEach(function (b) { b.onclick = function () { Dates.inviteMember(b.getAttribute("data-m"), uid); }; });
      };
      if (window.setActive) window.setActive(4);
      if (S.started && S.meetups.length) go(); else setTimeout(go, 1200);
    },
    reportMeetup: function (id) {
      var m = findM(id) || {};
      openModal("<h3>Report a problem</h3><p style='margin:0;color:#b3abcf;font-size:13px'>" + esc(m.title || "") + ". The host isn't paid until we've looked into it.</p>"
        + "<select class='dt-in' id='dtRepWhy'><option>Host didn't show up</option><option>It didn't happen / the place was closed</option><option>Not what was described</option><option>Made me feel unsafe</option><option>Asked for money outside the app</option><option>Something else</option></select>"
        + "<textarea class='dt-in' id='dtRepText' maxlength='1000' rows='4' placeholder='What happened?'></textarea>"
        + "<button class='dt-btn' id='dtRepGo'>Send report</button><p style='margin:0;font-size:12px;color:#9a8fb5'>If you're in danger, call 911 first.</p>");
      $i("dtRepGo").onclick = function () {
        busy(this, fn("reportMeetup", { meetupId: id, reason: $i("dtRepWhy").value, detail: $i("dtRepText").value })).then(function (r) { closeModal(); toast(r.message); loadMine(); }, function (e) { toast(e.message, "error"); });
      };
    },

    /* ---------- hosting ---------- */
    hostMeetup: function (editId) {
      if (S.anon) { if (window.promptGuestUpgrade) window.promptGuestUpgrade("Hosting an M&G"); return; }
      if (!me()) return;
      var ed = editId ? S.mine.filter(function (x) { return x.id === editId && x.host; })[0] : null;
      var v = (ed && ed.venue) || {}, c = (ed && ed.contact) || S.hostContact || {};
      var u = firebase.auth().currentUser || {};
      var fee = S.settings.hostFee == null ? 10 : S.settings.hostFee;
      var locked = ed && ed.sold > 0;
      var needYear = !ed && S.member === null;
      var minWhen = new Date(Date.now() + 25 * 3600000); minWhen = new Date(minWhen.getTime() - minWhen.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      var whenVal = ed ? new Date(ed.startsAt - new Date(ed.startsAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
      HF = { venue: Object.assign({ source: "other" }, v), img: ed ? ed.imageURL : "", results: [] };
      openModal("<h3>" + (ed ? "✏️ Edit your M&G" : "⭐ Host an M&G") + "</h3>"
        + (ed ? "" : "<p style='margin:-6px 0 0;color:#b3abcf;font-size:13px'>Takes about 2 minutes. We review it (usually within a day), then it goes on sale.</p>")
        + (ed && ed.status === "changes" && ed.changesNote ? "<div class='dt-warn'><b>What to change:</b> " + esc(ed.changesNote) + "</div>" : "")
        + (locked ? "<div class='dt-rules'>People already bought spots, so the time, price and place are locked. Contact support if they must change.</div>" : "")
        + "<h4>1 · WHAT</h4>"
        + "<div><div class='lbl'>Name it</div><input class='dt-in' id='mgTitle' maxlength='80' placeholder='Dinner & photos with me' value='" + esc(ed ? ed.title : "") + "'></div>"
        + "<div><div class='lbl'>What will you do?</div><textarea class='dt-in' id='mgAbout' maxlength='800' rows='3' placeholder='We will eat, talk and take pictures. Bring your questions!'>" + esc(ed ? ed.about : "") + "</textarea></div>"
        + "<div class='dt-row' style='gap:8px;flex-wrap:nowrap'><div style='flex:1'><div class='lbl'>Category</div><select class='dt-in' id='mgCat'>" + ["Dinner", "Activities", "Concerts", "Movies", "Other"].map(function (k) { return "<option" + (ed && ed.category === k ? " selected" : "") + ">" + k + "</option>"; }).join("") + "</select></div>"
        + "<div style='flex:1'><div class='lbl'>Picture <small>(optional)</small></div><input type='file' id='mgImg' accept='image/*' class='dt-in' style='padding:8px'></div></div>"
        + "<div><div class='lbl'>Included <small>(one per line, optional)</small></div><textarea class='dt-in' id='mgItems' rows='2' placeholder='Dinner\nPhoto + signed print'>" + esc(ed ? (ed.items || []).join("\n") : "") + "</textarea></div>"
        + "<h4>2 · WHERE</h4>"
        + (locked ? "<div class='dt-rules'><b>" + esc(v.name || ed.venueName) + "</b><br>" + esc(v.address || "") + ", " + esc(v.city || ed.city) + "<br>📞 " + esc(v.phone || "") + "</div>"
          : "<input class='dt-in' id='mgVq' placeholder='Search: restaurant, lounge, bowling alley…' autocomplete='off' value='" + esc(v.name || "") + "'>"
          + "<div id='mgVres' class='dt-vres'></div>"
          + "<div id='mgVform' style='display:" + (v.name ? "block" : "none") + ";margin-top:8px'>"
          + "<input class='dt-in' id='mgVname' placeholder='Place name' value='" + esc(v.name || "") + "' style='margin-bottom:6px'>"
          + "<input class='dt-in' id='mgVaddr' placeholder='Street address' value='" + esc(v.address || "") + "' style='margin-bottom:6px'>"
          + "<div class='dt-row' style='gap:6px;flex-wrap:nowrap'><input class='dt-in' id='mgVcity' placeholder='City, state' value='" + esc(v.city || "") + "'><input class='dt-in' id='mgVphone' type='tel' placeholder='Place phone' value='" + esc(v.phone || "") + "'></div>"
          + "<p style='margin:6px 0 0;font-size:12px;color:#9a8fb5'>Must be a public place. Buyers see only the name and city until they pay. We may call the place to confirm.</p></div>"
          + "<button class='dt-btn ghost' id='mgOther' style='margin-top:6px'>Other: type it in</button>"
          + "<p style='margin:4px 0 0;font-size:11px;color:#6f6a88'>Search by © OpenStreetMap contributors</p>")
        + "<h4>3 · WHEN & PRICE</h4>"
        + (locked ? "" : "<div><div class='lbl'>Day and time</div><input class='dt-in' id='mgWhen' type='datetime-local' min='" + minWhen + "' value='" + whenVal + "'></div>")
        + "<div class='dt-row' style='gap:10px;flex-wrap:nowrap'>" + (locked ? "" : "<div style='flex:1'><div class='lbl'>Price per person ($)</div><input class='dt-in' id='mgPrice' type='number' min='5' step='1' inputmode='numeric' value='" + (ed ? ed.price / 100 : "") + "' placeholder='45'></div>")
        + "<div style='width:110px'><div class='lbl'>Spots</div><input class='dt-in' id='mgSpots' type='number' min='1' max='500' inputmode='numeric' value='" + (ed ? ed.spots : 10) + "'></div></div>"
        + "<div class='dt-rules' id='mgMath'></div>"
        + "<label class='dt-check'><input type='checkbox' id='mgIdCheck'" + (ed && ed.idCheck ? " checked" : "") + (locked ? " disabled" : "") + "> <span>🪪 <b>21+ with ID at the door</b> (a bar, lounge, or drinks are the main thing). Buyers confirm they'll bring a photo ID, and you check it when they arrive.</span></label>"
        + "<h4>4 · HOW WE REACH YOU</h4>"
        + "<div class='dt-row' style='gap:6px;flex-wrap:nowrap'><input class='dt-in' id='mgEmail' type='email' placeholder='Email' value='" + esc(c.email || u.email || "") + "'><input class='dt-in' id='mgPhone' type='tel' placeholder='Your phone' value='" + esc(c.phone || "") + "'></div>"
        + "<p style='margin:-8px 0 0;font-size:12px;color:#9a8fb5'>Only Whisper+Me sees these, to confirm details or ask for changes.</p>"
        + (needYear ? birthYearField("mgYear") : "")
        + (ed ? "" : "<label class='dt-check'><input type='checkbox' id='mgAgree'> <span>I'll be there and check my guests in. If I cancel within " + S.settings.lateCancelHours + " hours or don't show, buyers get their money back and my deposit is kept. <a href='/terms.html' target='_blank' rel='noopener'>M&G terms</a></span></label>")
        + "<div id='mgErr' class='dt-err'></div>"
        + "<button class='dt-btn big gold' id='mgGo'>" + (ed ? "Save changes" : "Continue to deposit") + "</button>");
      var math = function () {
        var price = locked ? ed.price : Math.round((+($i("mgPrice") || {}).value || 0) * 100), n = Math.max(0, Math.round(+$i("mgSpots").value || 0)), cut = Math.round(price * (100 - fee) / 100);
        var dep = n > 1 ? price : 500, due = Math.max(0, dep - S.depositOnFile);
        $i("mgMath").innerHTML = price < 500 ? "Set a price per person (at least $5)." : "You keep <b>" + money(cut) + "</b> a spot (" + (100 - fee) + "%). All " + n + " sold = <b>" + money(cut * n) + "</b>, paid " + payoutDays() + " days after your M&G. Card fees are on us."
          + (ed ? "" : "<br>Deposit: <b>" + money(dep) + "</b> " + (n > 1 ? "(one spot's price)" : "(1-spot M&G)") + ", paid once and kept on your account for all your M&Gs."
            + (S.depositOnFile ? " You have " + money(S.depositOnFile) + " on file" + (due ? ", so you pay <b>" + money(due) + "</b> today." : ", so <b>nothing to pay</b>.") : ""));
        if (!ed) $i("mgGo").textContent = price < 500 ? "Continue" : due ? "Continue · pay " + money(due) + " deposit" : "Send for review";
      };
      ["mgPrice", "mgSpots"].forEach(function (k) { if ($i(k)) $i(k).oninput = math; }); math();
      if (!locked) {
        $i("mgOther").onclick = function () { HF.venue = { source: "other" }; ["mgVname", "mgVaddr", "mgVcity", "mgVphone"].forEach(function (k) { $i(k).value = ""; }); $i("mgVform").style.display = "block"; $i("mgVres").innerHTML = ""; $i("mgVname").value = $i("mgVq").value; $i("mgVaddr").focus(); };
        var timer = null;
        $i("mgVq").oninput = function () { clearTimeout(timer); var q = this.value.trim(); timer = setTimeout(function () { venueSearch(q); }, 350); };
      }
      $i("mgGo").onclick = function () {
        var err = $i("mgErr"), btn = this;
        if (!ed && !$i("mgAgree").checked) { err.textContent = "Tick the box to continue."; return; }
        var venue = locked ? v : { name: $i("mgVname").value, address: $i("mgVaddr").value, city: $i("mgVcity").value, phone: $i("mgVphone").value, source: HF.venue.source || "other", osmId: HF.venue.osmId || "", lat: HF.venue.lat, lon: HF.venue.lon };
        var startsAt = locked ? ed.startsAt : ($i("mgWhen").value ? new Date($i("mgWhen").value).getTime() : 0);
        var data = { title: $i("mgTitle").value, about: $i("mgAbout").value, category: $i("mgCat").value, items: $i("mgItems").value, venue: venue, startsAt: startsAt,
          price: locked ? ed.price / 100 : +$i("mgPrice").value, spots: +$i("mgSpots").value, contact: { email: $i("mgEmail").value, phone: $i("mgPhone").value }, imageURL: HF.img || "", idCheck: $i("mgIdCheck").checked };
        if (needYear) { data.birthYear = +$i("mgYear").value; if (!data.birthYear) { err.textContent = "Pick your birth year."; return; } }
        var f = $i("mgImg").files[0];
        var up = f ? (f.size > 5 * 1024 * 1024 ? Promise.reject(new Error("The picture is over 5 MB.")) : firebase.storage().ref("nights/ticketImages/" + S.uid + "/" + Date.now()).put(f, { contentType: f.type }).then(function (r) { return r.ref.getDownloadURL(); })) : Promise.resolve(HF.img || "");
        busy(btn, up.then(function (url) { data.imageURL = url; return ed ? fn("editMeetup", { meetupId: ed.id, data: data }) : fn("createMeetup", data); }))
          .then(function (r) { if (ed || !r.url) { closeModal(); toast(r.message || "Saved"); loadMine(); } else location.href = r.url; }, function (e) { err.textContent = e.message; });
      };
    },
    editMeetup: function (id) { Dates.hostMeetup(id); },
    payHostDeposit: function (id, btn) { busy(btn, fn("payHostDeposit", { meetupId: id })).then(function (r) { if (r.url) location.href = r.url; else { toast(r.message); loadMine(); } }, function (e) { toast(e.message, "error"); }); },
    pickVenue: function (i) {
      var r = HF.results[i]; if (!r) return;
      HF.venue = r;
      $i("mgVname").value = r.name; $i("mgVaddr").value = r.address; $i("mgVcity").value = r.city; $i("mgVphone").value = r.phone || "";
      $i("mgVq").value = r.name; $i("mgVres").innerHTML = ""; $i("mgVform").style.display = "block";
      if (!r.phone) { $i("mgVphone").placeholder = "Place phone (looking it up…)"; venuePhone(r).then(function (ph) { if (ph && !$i("mgVphone").value) $i("mgVphone").value = ph; $i("mgVphone").placeholder = "Place phone"; }); }
    },
    checkInGuest: function (id) {
      var m = findM(id) || {};
      openModal("<h3>✅ Check in guests</h3><p style='margin:0;color:#b3abcf'>Ask each guest for the code on their phone (it starts with MG-) and type it here. Checking guests in is how you get paid.</p>"
        + (m.idCheck ? "<div class='dt-warn'>🪪 <b>21+ event:</b> look at each guest's photo ID before you check them in. The name should match and they must be 21 or older. No ID, no entry.</div>" : "")
        + "<input class='dt-in' id='mgCode' placeholder='MG-XXXXX' autocomplete='off' style='text-transform:uppercase;font-size:20px;letter-spacing:.1em'><div id='mgCiOut' class='dt-err'></div>"
        + "<button class='dt-btn big teal' id='mgCi'>Check in</button>"
        + ((m.guests || []).length ? "<div><div class='lbl'>Guest list</div><div class='dt-guests' id='mgGl'>" + m.guests.map(function (g) { return "<span class='dt-g" + (g.here ? " here" : "") + "'>" + (g.here ? "✓ " : "") + esc(g.name) + "</span>"; }).join("") + "</div></div>" : ""));
      var go = function () {
        var code = $i("mgCode").value.trim().toUpperCase(), out = $i("mgCiOut");
        if (!code) return;
        busy($i("mgCi"), fn("checkInGuest", { meetupId: id, code: code.indexOf("MG-") === 0 ? code : "MG-" + code })).then(function (r) {
          out.style.color = "#00e3ae"; out.textContent = (r.already ? "Already checked in: " : "✅ Checked in: ") + r.guest + (r.idCheck && !r.already ? " · 🪪 ID checked?" : ""); $i("mgCode").value = ""; $i("mgCode").focus(); loadMine();
        }, function (e) { out.style.color = ""; out.textContent = e.message; });
      };
      $i("mgCi").onclick = go;
      $i("mgCode").onkeydown = function (e) { if (e.key === "Enter") go(); };
    },
    cancelMeetup: function (id, btn) {
      busy(btn, fn("cancelMeetup", { meetupId: id, preview: true })).then(function (r) {
        openModal("<h3>Cancel this M&G?</h3><ul class='dt-rules' style='padding-left:28px'>" + r.lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>"
          + "<div class='dt-actions'><button class='dt-btn ghost' style='flex:1' onclick='closeProfileModal()'>Keep it</button><button class='dt-btn red' style='flex:1' id='mgCx'>Cancel it</button></div>");
        $i("mgCx").onclick = function () { busy(this, fn("cancelMeetup", { meetupId: id })).then(function (x) { closeModal(); toast(x.message); loadMine(); }, function (e) { toast(e.message, "error"); }); };
      }, function (e) { toast(e.message, "error"); });
    },

    /* ---------- older bookings (from the "for 2 / group of 4" tickets) ---------- */
    paySeat: function (id, btn) { busy(btn, fn("paySeat", { dateId: id })).then(function (r) { location.href = r.url; }, function (e) { toast(e.message, "error"); }); },
    answerInvite: function (id, accept, btn) {
      busy(btn, fn("answerInvite", { dateId: id, accept: accept })).then(function (r) { if (r && r.url) location.href = r.url; else toast(accept ? "You're going!" : "Invite declined. No charge."); }, function (e) { toast(e.message, "error"); });
    },
    leave: function (id, btn) {
      busy(btn, fn("leaveDate", { dateId: id, preview: true })).then(function (p) {
        openModal("<h3>Cancel this booking?</h3><div class='dt-warn'><b>What happens:</b><ul>" + p.lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul></div>"
          + "<div class='dt-actions'><button class='dt-btn ghost' onclick='closeProfileModal()'>Keep it</button><button class='dt-btn red' id='dtCancelGo'>Cancel anyway</button></div>");
        $i("dtCancelGo").onclick = function () { busy(this, fn("leaveDate", { dateId: id })).then(function () { closeModal(); toast("Canceled.", "warn"); }, function (e) { toast(e.message, "error"); }); };
      }, function (e) { toast(e.message, "error"); });
    }
  };
  function legacyCard(d) {
    var u = S.uid, mine = (d.seats || []).filter(function (s) { return s.uid === u; })[0];
    var st = { forming: ["warn", "Waiting on payments"], confirmed: ["ok", "Booked"] }[d.status] || ["purple", d.status];
    var a = [];
    if (mine && mine.status === "invited") a.push("<button class='dt-btn ghost' onclick=\"Dates.answerInvite('" + d.id + "',false,this)\">Decline</button><button class='dt-btn' onclick=\"Dates.answerInvite('" + d.id + "',true,this)\">Accept</button>");
    if (mine && mine.status === "pay") a.push("<button class='dt-btn' onclick=\"Dates.paySeat('" + d.id + "',this)\">Pay " + money(mine.amount) + "</button>");
    if (mine && mine.status !== "invited") a.push("<button class='dt-btn red' onclick=\"Dates.leave('" + d.id + "',this)\">Cancel</button>");
    return "<div class='dt-box'><div class='dt-row'><h3 style='margin:0'>" + esc(d.title) + "</h3><span class='dt-pill " + st[0] + "'>" + st[1] + "</span></div>"
      + "<p style='margin:6px 0'>" + esc(d.venueName) + " · " + esc(when(d.startsAt)) + "</p>"
      + (d.status === "confirmed" && mine && mine.code ? "<div class='dt-code'>" + esc(mine.code) + "</div><p style='font-size:12px'>Show this code at " + esc(d.venueName) + ".</p>" : "")
      + (a.length ? "<div class='dt-actions'>" + a.join("") + "</div>" : "") + "</div>";
  }
  window.Dates = Dates;

  /* ---------- coming back from Stripe (or a shared /m/ link) ---------- */
  var params = new URLSearchParams(window.__initialSearch || location.search); // app.js cleans the URL before this file runs
  var back = params.get("dates") || (params.get("connect") ? "1" : "");
  var sharedMeetup = (params.get("meetup") || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (sharedMeetup) { try { sessionStorage.setItem("wpmMeetup", sharedMeetup); } catch (e) {} }
  var sharedConnect = (params.get("connect") || "").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 20);
  if (sharedConnect) { try { sessionStorage.setItem("wpmConnect", sharedConnect); } catch (e) {} if (!back) back = "1"; }
  var rateLink = (params.get("rate") || "").replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 80);
  if (/^(mg|cm):/.test(rateLink)) { try { sessionStorage.setItem("wpmRate", rateLink); } catch (e) {} if (!back) back = "1"; }
  if (back) {
    var msgs = { connect: "Booked! 💞 Now invite who you're bringing: a member, or send them a link.", meetup: "You're in! The address and your code are under 🎟️ My tickets.", hostdeposit: "Deposit received. We'll review your M&G (usually within a day) and let you know when it's live.", seat: "Payment received.", back: "Checkout wasn't finished. Nothing was charged." };
    history.replaceState(null, "", location.pathname);
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var u = firebase.auth().currentUser;
      if (u && $i("mainStage") && window.setActive) {
        clearInterval(t);
        window.setActive(4);
        if (msgs[back]) toast(msgs[back], back === "back" ? "warn" : "success");
        if (back === "meetup") { setTimeout(loadMine, 2500); setTimeout(function () { loadMine(); if (upcomingTickets().length) Dates.showTickets(); }, 5000); }
        if (back === "hostdeposit") setTimeout(loadMine, 2500);
        if (back === "connect") { S.mode = "cm"; refresh(); setTimeout(loadMine, 2500); setTimeout(loadMine, 5000); }
      } else if (tries > 60) clearInterval(t);
    }, 250);
  }
})();
