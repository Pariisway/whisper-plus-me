/* ═══════════════════════════════════════════════════════════════
   WHISPER+ME DATES — the 🎟️ Dates screen
   Category buttons + scrollable tickets in the phone frame,
   "My Dates" below it. All money/rules live in Cloud Functions
   (functions-nights/index.js); this file only shows things and
   calls those functions.
═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CATS = ["All", "Dinner", "Activities", "Concerts", "Movies", "Other"];
  var CAT_ICON = { All: "✨", Dinner: "🍽️", Activities: "🎳", Concerts: "🎤", Movies: "🎬", Other: "🎟️" };
  var DEFAULTS = { depositCents: 500, stoodUpRewardCoins: 5, strikesForSuspension: 2, suspensionDays: 3, lateCancelHours: 48, rescheduleCutoffHours: 48, splitWindowHours: 24, minAge: 21, requireIdVerify: false, openRequests: true };

  var S = {
    started: false, uid: null, cat: "All",
    settings: Object.assign({}, DEFAULTS),
    tickets: [], member: undefined, myDates: [], openDates: [],
    unsubs: []
  };

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(c) { var n = (c || 0) / 100; return "$" + (n % 1 ? n.toFixed(2) : n); }
  function ms(t) { return t && t.toMillis ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : Number(t) || 0); }
  function when(t) {
    var d = new Date(ms(t)); if (!ms(t)) return "";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function hoursUntil(t) { return (ms(t) - Date.now()) / 3600000; }
  function hue(str) { var h = 0; String(str).split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }
  function grad(h) { return "linear-gradient(135deg,hsl(" + h + " 60% 32%),hsl(" + ((h + 40) % 360) + " 65% 16%) 70%,#0b0b16)"; }
  function toast(m, type) { if (window.showToast) window.showToast(m, type || "success", 3500); else alert(m); }
  function db() { return firebase.firestore(); }
  function fn(name, data) {
    return firebase.functions().httpsCallable(name)(data || {}).then(function (r) { return r.data; })
      .catch(function (e) { throw new Error((e && e.message) || "Something went wrong. Try again."); });
  }
  function me() { var u = firebase.auth().currentUser; return u && !u.isAnonymous ? u : null; }
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
  function seatsFor(d) { return d.seats || []; }
  function mySeat(d) { var u = S.uid; return seatsFor(d).filter(function (s) { return s.uid === u; })[0]; }
  function isAttending(s) { return s && (s.status === "paid" || s.status === "joined"); }

  /* ---------- styles (scoped to .dt-) ---------- */
  var css = "\
.dt-phone{height:100%;display:flex;flex-direction:column;background:#0b0b16;color:#fff;border-radius:inherit;overflow:hidden}\
.dt-head{display:flex;align-items:center;justify-content:space-between;padding:44px 14px 8px}\
.dt-head h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.01em}\
.dt-head small{font-size:11px;color:#9a8fb5}\
.dt-pill{font-size:10.5px;font-weight:800;padding:4px 9px;border-radius:999px;white-space:nowrap}\
.dt-pill.ok{background:rgba(0,227,174,.14);color:#00e3ae}.dt-pill.warn{background:rgba(255,186,73,.14);color:#ffba49}.dt-pill.bad{background:rgba(229,57,53,.16);color:#ff8a80}.dt-pill.purple{background:rgba(123,47,247,.22);color:#c9a7ff}\
.dt-cats{display:flex;gap:6px;overflow-x:auto;padding:4px 12px 10px;scrollbar-width:none}.dt-cats::-webkit-scrollbar{display:none}\
.dt-cat{flex:none;border:1px solid rgba(255,255,255,.12);background:#15152a;color:#cfc8e8;border-radius:999px;padding:8px 12px;font-size:12.5px;font-weight:700;cursor:pointer;min-height:34px}\
.dt-cat[aria-pressed=true]{background:#7b2ff7;border-color:#7b2ff7;color:#fff}\
.dt-list{flex:1;overflow-y:auto;padding:0 12px 16px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}\
.dt-card{display:block;width:100%;text-align:left;border:1px solid rgba(255,255,255,.08);background:#12122a;border-radius:16px;overflow:hidden;padding:0;color:#fff;cursor:pointer}\
.dt-card:active{transform:scale(.99)}\
.dt-poster{position:relative;height:92px;padding:10px 12px;display:flex;flex-direction:column;justify-content:space-between}\
.dt-poster img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}\
.dt-poster>*{position:relative}\
.dt-poster .k{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.8);display:flex;justify-content:space-between}\
.dt-poster b{font-size:18px;line-height:1.1}\
.dt-body{padding:9px 12px 11px;display:flex;justify-content:space-between;gap:10px;align-items:flex-end}\
.dt-body .v{font-size:12px;color:#a59cc4;min-width:0}\
.dt-body .v div:first-child{color:#fff;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.dt-price{text-align:right;flex:none}.dt-price b{font-size:18px}.dt-price small{display:block;font-size:10.5px;color:#a59cc4}\
.dt-empty{margin:auto;text-align:center;color:#7d7699;font-size:13px;padding:30px 16px}\
.dt-panel{max-width:640px;margin:0 auto;padding:6px 14px 30px;display:flex;flex-direction:column;gap:14px;color:#fff}\
.dt-box{background:#11111f;border:1px solid rgba(123,47,247,.25);border-radius:16px;padding:14px}\
.dt-box h3{margin:0 0 8px;font-size:15px}\
.dt-box p{margin:0 0 10px;font-size:13px;color:#b3abcf;line-height:1.45}\
.dt-row{display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap}\
.dt-btn{border:0;border-radius:999px;padding:10px 16px;font-weight:800;font-size:13px;cursor:pointer;min-height:40px;background:#7b2ff7;color:#fff}\
.dt-btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.18);color:#ddd}\
.dt-btn.teal{background:#00e3ae;color:#06281f}\
.dt-btn.red{background:transparent;border:1px solid rgba(229,57,53,.5);color:#ff8a80}\
.dt-btn[disabled]{opacity:.55}\
.dt-date{border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;background:#12122a}\
.dt-date .dt-poster{height:70px}\
.dt-date .in{padding:10px 12px;display:flex;flex-direction:column;gap:9px;font-size:13px}\
.dt-seats{display:flex;gap:8px;flex-wrap:wrap}\
.dt-seat{display:flex;align-items:center;gap:6px;background:#0b0b16;border-radius:999px;padding:3px 10px 3px 3px;font-size:12px}\
.dt-code{font-family:ui-monospace,Menlo,monospace;font-size:22px;letter-spacing:.12em;color:#00e3ae;font-weight:800}\
.dt-actions{display:flex;gap:8px;flex-wrap:wrap}\
.dt-sec{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#9a8fb5;margin:4px 2px -4px}\
.dt-sheet{padding:18px;color:#fff;max-height:82vh;overflow-y:auto;display:flex;flex-direction:column;gap:14px}\
.dt-sheet h3{margin:0;font-size:19px}\
.dt-sheet .lbl{font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#9a8fb5;margin-bottom:6px}\
.dt-opt{display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:11px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#0b0b16;color:#fff;cursor:pointer}\
.dt-opt[aria-pressed=true]{border-color:#7b2ff7;background:rgba(123,47,247,.16)}\
.dt-opt .r{width:16px;height:16px;border-radius:50%;border:2px solid #555;flex:none}.dt-opt[aria-pressed=true] .r{border-color:#7b2ff7;background:radial-gradient(#7b2ff7 45%,transparent 50%)}\
.dt-opt .t{flex:1;min-width:0}.dt-opt small{display:block;color:#9a8fb5;font-size:12px}\
.dt-picks{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}\
.dt-pick{flex:none;width:72px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:#0b0b16;color:#ddd;font-size:11.5px;cursor:pointer}\
.dt-pick[aria-pressed=true]{border-color:#7b2ff7;color:#fff;background:rgba(123,47,247,.18)}\
.dt-warn{border:1px solid rgba(229,57,53,.4);background:rgba(229,57,53,.08);border-radius:12px;padding:12px}\
.dt-warn ul{margin:6px 0 0;padding-left:18px;font-size:13.5px;line-height:1.5;color:#ffd6d3}\
.dt-rules{font-size:12.5px;color:#b3abcf;line-height:1.5;background:#0b0b16;border-radius:12px;padding:10px 12px}\
.dt-rules li{margin-bottom:3px}\
.dt-check{display:flex;gap:9px;font-size:13px;color:#ddd;align-items:flex-start}.dt-check input{margin-top:3px;accent-color:#7b2ff7;min-width:16px;min-height:16px}\
.dt-in{width:100%;padding:11px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0b0b16;color:#fff;font-size:14px}\
.dt-err{color:#ff8a80;font-size:13px}\
";
  var styleEl = document.createElement("style"); styleEl.textContent = css; document.head.appendChild(styleEl);

  /* ---------- data ---------- */
  function start() {
    var u = me();
    if (!u) return;
    if (S.started && S.uid === u.uid) return;
    stop();
    S.started = true; S.uid = u.uid;
    var f = db();
    S.unsubs.push(f.doc("settings/platform").onSnapshot(function (s) { S.settings = Object.assign({}, DEFAULTS, s.exists ? s.data() : {}); refresh(); }, function () {}));
    S.unsubs.push(f.collection("tickets").where("status", "==", "live").where("adminHidden", "==", false).orderBy("startsAt").limit(150).onSnapshot(function (s) {
      var now = Date.now();
      S.tickets = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).filter(function (t) { return ms(t.startsAt) > now + 3 * 3600000 && (t.quantity - t.sold - t.held) > 0; });
      refresh();
    }, function (e) { console.warn("Dates tickets", e.message); }));
    S.unsubs.push(f.doc("members/" + u.uid).onSnapshot(function (s) { S.member = s.exists ? s.data() : null; refresh(); }, function () { S.member = null; refresh(); }));
    S.unsubs.push(f.collection("dates").where("involvedUids", "array-contains", u.uid).orderBy("createdAt", "desc").limit(50).onSnapshot(function (s) {
      S.myDates = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); refresh();
    }, function (e) { console.warn("Dates mine", e.message); }));
    S.unsubs.push(f.collection("dates").where("open", "==", true).where("live", "==", true).limit(60).onSnapshot(function (s) {
      S.openDates = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); refresh();
    }, function (e) { console.warn("Dates open", e.message); }));
  }
  function stop() { S.unsubs.forEach(function (u) { try { u(); } catch (e) {} }); S.unsubs = []; S.started = false; }
  firebase.auth().onAuthStateChanged(function (u) { if (!u || u.isAnonymous) { stop(); S.uid = null; } });

  /* ---------- phone frame: categories + tickets ---------- */
  function statusPill() {
    var m = S.member;
    if (m === undefined) return "";
    if (!m) return "<span class='dt-pill purple'>Set up</span>";
    if (m.suspendedUntil && ms(m.suspendedUntil) > Date.now()) return "<span class='dt-pill bad'>On a break</span>";
    if (!m.deposit || m.deposit.status !== "active") return "<span class='dt-pill warn'>Add deposit</span>";
    return "<span class='dt-pill ok'>Ready</span>";
  }
  function ticketCard(t) {
    var each = Math.floor(t.price / t.size);
    return "<button class='dt-card' onclick=\"Dates.openTicket('" + t.id + "')\">"
      + "<div class='dt-poster' style='background:" + grad(t.hue != null ? t.hue : hue(t.title)) + "'>"
      + (t.imageURL ? "<img src='" + esc(t.imageURL) + "' alt=''>" : "")
      + "<div class='k'><span>" + (CAT_ICON[t.category] || "") + " " + esc(t.category) + "</span><span>" + (t.size === 4 ? "Group of 4" : "For 2") + "</span></div>"
      + "<b>" + esc(t.title) + "</b></div>"
      + "<div class='dt-body'><div class='v'><div>" + esc(t.venueName) + "</div><div>" + esc(when(t.startsAt)) + "</div></div>"
      + "<div class='dt-price'><b>" + money(t.price) + "</b><small>" + money(each) + " each if split</small></div></div></button>";
  }
  function phoneInner() {
    if (!me()) return "<div class='dt-empty'>Sign in to see date tickets.</div>";
    var list = S.tickets.filter(function (t) { return S.cat === "All" || t.category === S.cat; });
    return "<div class='dt-head'><div><h2>🎟️ Dates</h2><small>Book a night out together</small></div>" + statusPill() + "</div>"
      + "<div class='dt-cats' role='group' aria-label='Categories'>" + CATS.map(function (c) {
        return "<button class='dt-cat' aria-pressed='" + (S.cat === c) + "' onclick=\"Dates.setCat('" + c + "')\">" + CAT_ICON[c] + " " + c + "</button>";
      }).join("") + "</div>"
      + "<div class='dt-list'>" + (list.length ? list.map(ticketCard).join("")
        : "<div class='dt-empty'>" + (S.tickets.length ? "No " + esc(S.cat.toLowerCase()) + " tickets right now.<br>Try another category." : "New date tickets are on the way.<br>Check back soon.") + "</div>") + "</div>";
  }

  /* ---------- panel below the phone: My Dates ---------- */
  function setupBox() {
    var m = S.member, s = S.settings;
    if (m === undefined) return "<div class='dt-box'><p>Loading…</p></div>";
    if (!m) {
      var yr = new Date().getFullYear();
      var years = []; for (var y = yr - 18; y >= yr - 90; y--) years.push(y);
      return "<div class='dt-box'><h3>Start dating on Whisper+me</h3>"
        + "<p>Pick a ticket, bring someone (or let them ask to join), and split it or treat them. Dates is " + s.minAge + "+.</p>"
        + "<div class='dt-row' style='justify-content:flex-start'><select id='dtYear' class='dt-in' style='width:auto' aria-label='Birth year'><option value=''>Birth year</option>"
        + years.map(function (y) { return "<option>" + y + "</option>"; }).join("") + "</select>"
        + "<button class='dt-btn' onclick='Dates.join(this)'>Set up Dates</button></div><div id='dtJoinErr' class='dt-err'></div></div>";
    }
    var dep = m.deposit || {};
    var suspended = m.suspendedUntil && ms(m.suspendedUntil) > Date.now();
    var out = "<div class='dt-box'><div class='dt-row'><h3 style='margin:0'>Your date deposit</h3>"
      + (dep.status === "active" ? "<span class='dt-pill ok'>" + money(dep.amount || s.depositCents) + " on file</span>" : dep.status === "forfeited" ? "<span class='dt-pill bad'>Kept</span>" : "<span class='dt-pill warn'>None yet</span>") + "</div>";
    if (dep.status === "active") out += "<p style='margin-top:8px'>It covers every date. You only lose it if you cancel or miss a date.</p>";
    else out += "<p style='margin-top:8px'>" + (dep.status === "forfeited" ? "Your last deposit was kept after a cancellation or missed date. " : "")
      + "Everyone going on a date keeps a " + money(s.depositCents) + " deposit on their account. It stays there for all your dates.</p>"
      + "<button class='dt-btn' onclick='Dates.payDeposit(this)'>Add " + money(s.depositCents) + " deposit</button>";
    if (suspended) out += "<p style='margin-top:10px;color:#ff8a80'>You're on a break from Dates until " + esc(when(m.suspendedUntil)) + " because of " + s.strikesForSuspension + " missed dates.</p>";
    else if (m.strikes) out += "<p style='margin-top:10px;color:#ffba49'>Missed dates: " + m.strikes + " of " + s.strikesForSuspension + ". At " + s.strikesForSuspension + " you get a " + s.suspensionDays + "-day break.</p>";
    if (s.requireIdVerify && !m.verified) out += m.idUploaded
      ? "<p style='margin-top:10px'>Your photo ID is being reviewed.</p>"
      : "<p style='margin-top:10px'>Upload a photo ID before your first date. Only Whisper+me staff can see it.</p><div class='dt-row'><input type='file' id='dtId' accept='image/*,application/pdf' class='dt-in' style='flex:1'><button class='dt-btn ghost' onclick='Dates.uploadId(this)'>Upload</button></div>";
    out += "<div style='margin-top:10px'><button class='dt-btn ghost' onclick='Dates.showRules()'>How Dates works</button></div></div>";
    return out;
  }

  function dateCard(d) {
    var u = S.uid, mine = mySeat(d), host = d.hostUid === u;
    var st = { forming: ["warn", d.mode === "split" ? "Waiting on payments" : "Waiting"], confirmed: ["ok", "Booked"], completed: ["purple", "Done"], canceled: ["bad", "Canceled"] }[d.status] || ["purple", d.status];
    var seats = seatsFor(d).map(function (s) {
      if (!s.uid) return "<span class='dt-seat' style='padding:6px 10px;color:#7d7699'>Open seat</span>";
      var label = { invited: "invited", pay: "needs to pay", held: "paid (on hold)", paid: "paid", joined: "going" }[s.status] || s.status;
      return "<span class='dt-seat'>" + avatar(s, 24) + esc(s.name) + (s.uid === d.hostUid ? " ★" : "") + " <small style='color:#9a8fb5'>· " + label + "</small></span>";
    }).join("");
    var a = [];
    var live = d.status === "forming" || d.status === "confirmed";
    if (live && mine && mine.status === "invited") a.push("<button class='dt-btn ghost' onclick=\"Dates.answerInvite('" + d.id + "',false,this)\">Decline</button><button class='dt-btn' onclick=\"Dates.answerInvite('" + d.id + "',true,this)\">" + (mine.amount ? "Accept · pay " + money(mine.amount) : "Accept") + "</button>");
    if (live && mine && mine.status === "pay") a.push("<button class='dt-btn' onclick=\"Dates.paySeat('" + d.id + "',this)\">Pay " + money(mine.amount) + (d.mode === "split" ? " (held)" : "") + "</button>");
    if (live && host && seatsFor(d).some(function (s) { return s.status === "open"; })) a.push("<button class='dt-btn ghost' onclick=\"Dates.inviteMore('" + d.id + "')\">Invite someone</button>");
    if (d.status === "confirmed" && isAttending(mine) && !d.rescheduled && hoursUntil(d.startsAt) >= S.settings.rescheduleCutoffHours && !d.reschedule) a.push("<button class='dt-btn ghost' onclick=\"Dates.reschedule('" + d.id + "')\">Reschedule</button>");
    if (live && mine && mine.status !== "invited") a.push("<button class='dt-btn red' onclick=\"Dates.leave('" + d.id + "',this)\">" + (host && d.status === "forming" ? "Cancel date" : "Cancel") + "</button>");
    var extra = "";
    if (host && (d.requests || []).length && live) {
      extra += "<div><div class='dt-sec' style='margin:0 0 6px'>Asked to join</div>" + d.requests.map(function (r) {
        return "<div class='dt-row' style='margin-bottom:6px'><span class='dt-seat'>" + avatar(r, 24) + esc(r.name) + "</span><span class='dt-actions'>"
          + "<button class='dt-btn ghost' onclick=\"Dates.answerRequest('" + d.id + "','" + r.uid + "',false,this)\">No thanks</button>"
          + "<button class='dt-btn teal' onclick=\"Dates.answerRequest('" + d.id + "','" + r.uid + "',true,this)\">Pick</button></span></div>";
      }).join("") + "</div>";
    }
    if (!host && (d.requests || []).some(function (r) { return r.uid === u; })) extra += "<div class='dt-pill warn' style='align-self:flex-start'>Request sent · waiting on " + esc(d.hostName) + "</div>";
    if (d.reschedule && live) {
      var agreed = (d.reschedule.approvals || []).indexOf(u) > -1;
      extra += "<div class='dt-warn' style='border-color:rgba(123,47,247,.5);background:rgba(123,47,247,.1)'>Move to <b>" + esc(when(d.reschedule.startsAt)) + "</b>?"
        + (agreed ? " <small style='color:#9a8fb5'>You agreed. Waiting on the others.</small>" : "<div class='dt-actions' style='margin-top:8px'><button class='dt-btn ghost' onclick=\"Dates.answerReschedule('" + d.id + "',false,this)\">Keep original</button><button class='dt-btn' onclick=\"Dates.answerReschedule('" + d.id + "',true,this)\">Agree</button></div>") + "</div>";
    }
    var code = d.status === "confirmed" && mine && mine.code
      ? "<div><div style='font-size:11px;color:#9a8fb5'>Your door code · show it at " + esc(d.venueName) + "</div><div class='dt-code'>" + esc(mine.code) + "</div></div>" : "";
    var note = d.status === "forming" && d.mode === "split" ? "<div style='font-size:12px;color:#9a8fb5'>Cards are on hold. Nobody is charged until every seat is paid. Fills by " + esc(when(d.expiresAt)) + " or it's called off free.</div>" : "";
    return "<div class='dt-date'><div class='dt-poster' style='background:" + grad(d.hue != null ? d.hue : hue(d.title)) + "'>"
      + (d.imageURL ? "<img src='" + esc(d.imageURL) + "' alt=''>" : "")
      + "<div class='k'><span>" + esc(d.venueName) + "</span><span class='dt-pill " + st[0] + "'>" + st[1] + "</span></div><b>" + esc(d.title) + "</b></div>"
      + "<div class='in'><div>" + esc(when(d.startsAt)) + " · " + (d.mode === "split" ? "Split " + money(d.total) : "Paid in full by " + esc(d.hostName)) + "</div>"
      + "<div class='dt-seats'>" + seats + "</div>" + code + note + extra
      + (a.length ? "<div class='dt-actions'>" + a.join("") + "</div>" : "")
      + (live && !host && d.status === "confirmed" ? "<button class='dt-btn ghost' style='align-self:flex-start;padding:6px 12px;min-height:32px;font-size:12px' onclick=\"Dates.report('" + d.id + "')\">Report a problem</button>" : "")
      + "</div></div>";
  }

  function panelInner() {
    if (!me()) return "";
    var u = S.uid;
    var active = S.myDates.filter(function (d) { return (d.status === "forming" ? d.live || d.hostUid === u : d.status === "confirmed") && ms(d.startsAt) > Date.now() - 6 * 3600000; });
    var needs = active.filter(function (d) { var s = mySeat(d); return (s && (s.status === "invited" || s.status === "pay")) || (d.hostUid === u && (d.requests || []).length) || (d.reschedule && (d.reschedule.approvals || []).indexOf(u) < 0); });
    var rest = active.filter(function (d) { return needs.indexOf(d) < 0; });
    var past = S.myDates.filter(function (d) { return active.indexOf(d) < 0 && d.live; }).slice(0, 6);
    var openOthers = S.openDates.filter(function (d) {
      return (d.status === "forming" || d.status === "confirmed") && d.involvedUids.indexOf(u) < 0 && ms(d.startsAt) > Date.now()
        && seatsFor(d).some(function (s) { return s.status === "open"; });
    });
    var out = setupBox();
    if (needs.length) out += "<div class='dt-sec'>Needs your answer</div>" + needs.map(dateCard).join("");
    out += "<div class='dt-sec'>Your dates</div>" + (rest.length ? rest.map(dateCard).join("") : "<div class='dt-box'><p style='margin:0'>No dates yet. Pick a ticket above to plan one.</p></div>");
    if (S.settings.openRequests) {
      out += "<div class='dt-sec'>Looking for company</div>" + (openOthers.length ? openOthers.map(function (d) {
        var open = seatsFor(d).filter(function (s) { return s.status === "open"; })[0];
        return "<div class='dt-box' style='padding:12px'><div class='dt-row'><span class='dt-seat'>" + avatar({ name: d.hostName, photo: d.hostPhoto }, 30) + "<b>" + esc(d.hostName) + "</b></span><span class='dt-pill purple'>" + esc(d.category) + "</span></div>"
          + "<p style='margin:8px 0'>" + esc(d.title) + " at " + esc(d.venueName) + "<br>" + esc(when(d.startsAt)) + " · " + (open.amount ? "your share " + money(open.amount) : "your seat is covered") + "</p>"
          + "<button class='dt-btn' onclick=\"Dates.requestJoin('" + d.id + "',this)\">Ask to join</button></div>";
      }).join("") : "<div class='dt-box'><p style='margin:0'>Nobody's looking right now. Post your own: pick a ticket and choose \"Let members ask to join.\"</p></div>");
    }
    if (past.length) out += "<div class='dt-sec'>Past & canceled</div>" + past.map(dateCard).join("");
    return out;
  }

  function refresh() {
    var p = document.getElementById("datesPhone"); if (p) { var sc = p.querySelector(".dt-list"); var top = sc ? sc.scrollTop : 0; p.innerHTML = phoneInner(); var sc2 = p.querySelector(".dt-list"); if (sc2) sc2.scrollTop = top; }
    var q = document.getElementById("datesPanel"); if (q) q.innerHTML = panelInner();
  }

  /* ---------- modal helpers (uses Whisper+me's profile modal) ---------- */
  function openModal(html) {
    var modal = document.getElementById("profileModal"), body = document.getElementById("profileModalBody");
    if (!modal || !body) return null;
    body.innerHTML = "<button onclick='closeProfileModal()' aria-label='Close' style='position:absolute;top:12px;right:14px;background:none;border:none;color:#888;font-size:22px;cursor:pointer;z-index:2;min-width:32px;min-height:32px'>✕</button><div class='dt-sheet'>" + html + "</div>";
    modal.style.display = "flex";
    return body;
  }
  function closeModal() { if (window.closeProfileModal) window.closeProfileModal(); }

  function rulesList(s) {
    s = s || S.settings;
    return "<ul class='dt-rules' style='margin:0;padding:10px 12px 10px 28px'>"
      + "<li>Everyone keeps a <b>" + money(s.depositCents) + " date deposit</b> on their account. It covers all your dates.</li>"
      + "<li><b>Cancel or miss a date and the deposit is kept.</b> You add a new one before your next date.</li>"
      + "<li>Splitting? Cards are only put <b>on hold</b> until every seat is paid. If the group doesn't fill in " + s.splitWindowHours + " hours, nobody is charged.</li>"
      + "<li>Ticket payments <b>aren't refunded</b> if you cancel. You can reschedule once, if everyone agrees, up to " + s.rescheduleCutoffHours + " hours before.</li>"
      + "<li>Cancelling inside " + s.lateCancelHours + " hours, or not showing up, is a missed date. " + s.strikesForSuspension + " missed dates = a " + s.suspensionDays + "-day break.</li>"
      + "<li>Get stood up? Check in at the venue and we add <b>" + s.stoodUpRewardCoins + " Whisper coins</b> to your account.</li>"
      + "<li>Each person gets their own door code once the ticket is fully paid.</li></ul>";
  }

  /* ---------- booking sheet ---------- */
  var B = null;
  function people() {
    var all = window.allUsers || {};
    return Object.keys(all).filter(function (k) { return k !== S.uid && all[k] && all[k].name; }).map(function (k) { return { uid: k, name: all[k].name, photo: all[k].photo || "" }; });
  }
  function drawBooking() {
    var t = B.t, need = t.size - 1, s = S.settings;
    var base = Math.floor(t.price / t.size), mineSplit = base + (t.price - base * t.size);
    var q = (B.q || "").toLowerCase();
    var list = people().filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) > -1 || B.invites.indexOf(p.uid) > -1; }).slice(0, 40);
    var openLeft = need - B.invites.length;
    var html = "<div style='margin:-18px -18px 0;border-radius:14px 14px 0 0;overflow:hidden'><div class='dt-poster' style='height:120px;background:" + grad(t.hue != null ? t.hue : hue(t.title)) + "'>"
      + (t.imageURL ? "<img src='" + esc(t.imageURL) + "' alt=''>" : "") + "<div class='k'><span>" + esc(t.venueName) + "</span><span>" + esc(when(t.startsAt)) + "</span></div><b style='font-size:22px'>" + esc(t.title) + "</b></div></div>"
      + "<div><div class='lbl'>What's included</div><div style='font-size:14px;line-height:1.6'>" + (t.items || []).map(function (i) { return "• " + esc(i); }).join("<br>") + "</div>"
      + (t.note ? "<div class='dt-rules' style='margin-top:8px'>" + esc(t.note) + "</div>" : "") + "</div>"
      + "<div><div class='lbl'>Who's coming · " + need + " more</div>"
      + "<input class='dt-in' id='dtSearch' placeholder='Search members' value='" + esc(B.q || "") + "' style='margin-bottom:8px'>"
      + "<div class='dt-picks'>" + (list.length ? list.map(function (p) { return "<button class='dt-pick' aria-pressed='" + (B.invites.indexOf(p.uid) > -1) + "' onclick=\"Dates.pick('" + p.uid + "')\">" + avatar(p, 40) + "<span style='max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc(p.name) + "</span></button>"; }).join("") : "<span style='color:#7d7699;font-size:13px'>No members match.</span>") + "</div>"
      + "<div style='font-size:12px;color:#9a8fb5;margin-top:6px'>" + B.invites.length + " of " + need + " invited</div>"
      + (s.openRequests && openLeft > 0 ? "<label class='dt-check' style='margin-top:8px'><input type='checkbox' id='dtOpen' " + (B.open ? "checked" : "") + " onchange='Dates.setOpen(this.checked)'> Let members ask to join" + (B.invites.length ? " the empty seat" + (openLeft > 1 ? "s" : "") : "") + ". You pick who goes.</label>" : "")
      + "</div>"
      + "<div><div class='lbl'>Payment</div>"
      + "<button class='dt-opt' aria-pressed='" + (B.mode === "split") + "' onclick=\"Dates.mode('split')\"><span class='r'></span><span class='t'><b>Split it</b><small>Your " + money(mineSplit) + " is held, not charged, until everyone pays</small></span><b>" + money(base) + " each</b></button>"
      + "<div style='height:8px'></div>"
      + "<button class='dt-opt' aria-pressed='" + (B.mode === "full") + "' onclick=\"Dates.mode('full')\"><span class='r'></span><span class='t'><b>Pay in full</b><small>Your treat. Charged now; guests pay nothing</small></span><b>" + money(t.price) + "</b></button></div>"
      + "<div><div class='lbl'>Before you book</div>" + rulesList() + "</div>"
      + "<label class='dt-check'><input type='checkbox' id='dtAgree'> I understand deposits and ticket payments are non-refundable except as described above and in the Terms.</label>"
      + "<div id='dtBookErr' class='dt-err'></div>"
      + "<button class='dt-btn' style='width:100%;min-height:48px;font-size:15px' onclick='Dates.book(this)'>" + (B.mode === "full" ? "Pay " + money(t.price) : "Hold my " + money(mineSplit) + " & send invites") + "</button>";
    var body = openModal(html);
    var sInput = body && body.querySelector("#dtSearch");
    if (sInput) sInput.oninput = function () { B.q = sInput.value; var pos = sInput.selectionStart; drawBooking(); var n = document.getElementById("dtSearch"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } };
  }

  function needsSetup() {
    var m = S.member, s = S.settings;
    if (!m) return "Set up Dates first (it takes a few seconds).";
    if (m.suspendedUntil && ms(m.suspendedUntil) > Date.now()) return "You're on a break from Dates until " + when(m.suspendedUntil) + ".";
    if (!m.deposit || m.deposit.status !== "active") return "Add your " + money(s.depositCents) + " date deposit first.";
    if (s.requireIdVerify && !m.verified) return m.idUploaded ? "Your ID is still being reviewed." : "Upload your photo ID first.";
    return "";
  }

  /* ---------- public API (called from onclick and app.js) ---------- */
  var Dates = {
    phoneHTML: function () { start(); return "<div id='datesPhone' class='dt-phone'>" + phoneInner() + "</div>"; },
    panelHTML: function () { start(); return "<div id='datesPanel' class='dt-panel'>" + panelInner() + "</div>"; },
    boot: function () { start(); refresh(); },
    mounted: function () { start(); refresh(); },
    setCat: function (c) { S.cat = c; refresh(); },

    openTicket: function (id) {
      var t = S.tickets.filter(function (x) { return x.id === id; })[0];
      if (!t) return toast("That ticket just sold out.", "warn");
      var block = needsSetup();
      if (block) {
        openModal("<h3>" + esc(t.title) + "</h3><p style='margin:0;color:#b3abcf'>" + esc(t.venueName) + " · " + esc(when(t.startsAt)) + " · " + money(t.price) + "</p>"
          + "<div class='dt-warn' style='border-color:rgba(123,47,247,.5);background:rgba(123,47,247,.1)'>" + esc(block) + "</div>" + rulesList()
          + "<button class='dt-btn' onclick='closeProfileModal();var p=document.getElementById(\"datesPanel\");if(p)p.scrollIntoView({behavior:\"smooth\"})'>Go to setup</button>");
        return;
      }
      B = { t: t, invites: [], mode: "split", open: false, q: "" };
      drawBooking();
    },
    pick: function (uid) {
      var need = B.t.size - 1, i = B.invites.indexOf(uid);
      if (i > -1) B.invites.splice(i, 1); else { if (B.invites.length >= need) B.invites.shift(); B.invites.push(uid); }
      drawBooking();
    },
    setOpen: function (v) { B.open = v; },
    mode: function (m) { B.mode = m; drawBooking(); },
    book: function (btn) {
      var err = document.getElementById("dtBookErr");
      if (!B.invites.length && !B.open) { err.textContent = "Invite someone, or tick \"Let members ask to join.\""; return; }
      if (!document.getElementById("dtAgree").checked) { err.textContent = "Tick the box to confirm you understand the rules."; return; }
      busy(btn, fn("createDate", { ticketId: B.t.id, mode: B.mode, inviteUids: B.invites, openToRequests: !!B.open }))
        .then(function (r) { location.href = r.url; }, function (e) { err.textContent = e.message; });
    },

    join: function (btn) {
      var y = +document.getElementById("dtYear").value, err = document.getElementById("dtJoinErr");
      if (!y) { err.textContent = "Pick your birth year."; return; }
      busy(btn, fn("datesJoin", { birthYear: y })).then(function () { toast("You're set up. Add your deposit next."); }, function (e) { err.textContent = e.message; });
    },
    payDeposit: function (btn) {
      var s = S.settings;
      openModal("<h3>Add your " + money(s.depositCents) + " date deposit</h3><p style='margin:0;color:#b3abcf'>It stays on your account and covers every date you go on.</p>" + rulesList()
        + "<label class='dt-check'><input type='checkbox' id='dtDepAgree'> I understand my deposit is kept if I cancel a date or don't show up.</label><div id='dtDepErr' class='dt-err'></div>"
        + "<button class='dt-btn' id='dtDepGo' style='width:100%;min-height:46px'>Continue to payment</button>");
      document.getElementById("dtDepGo").onclick = function () {
        if (!document.getElementById("dtDepAgree").checked) { document.getElementById("dtDepErr").textContent = "Tick the box to continue."; return; }
        busy(this, fn("payDeposit")).then(function (r) { location.href = r.url; }, function (e) { document.getElementById("dtDepErr").textContent = e.message; });
      };
    },
    uploadId: function (btn) {
      var f = document.getElementById("dtId").files[0];
      if (!f) return toast("Choose a photo of your ID first.", "warn");
      if (f.size > 10 * 1024 * 1024) return toast("That file is over 10 MB.", "warn");
      busy(btn, firebase.storage().ref("nights/ids/" + S.uid + "/" + Date.now()).put(f, { contentType: f.type })
        .then(function () { return db().doc("members/" + S.uid).update({ idUploaded: true }); }))
        .then(function () { toast("ID uploaded. We'll review it soon."); }, function (e) { toast(e.message, "error"); });
    },
    showRules: function () { openModal("<h3>How Dates works</h3>" + rulesList() + "<button class='dt-btn' onclick='closeProfileModal()'>Got it</button>"); },

    paySeat: function (id, btn) { busy(btn, fn("paySeat", { dateId: id })).then(function (r) { location.href = r.url; }, function (e) { toast(e.message, "error"); }); },
    answerInvite: function (id, accept, btn) {
      if (accept) {
        var block = needsSetup();
        if (block) { toast(block, "warn"); var p = document.getElementById("datesPanel"); if (p) p.scrollIntoView({ behavior: "smooth" }); return; }
        var d = S.myDates.filter(function (x) { return x.id === id; })[0], seat = d && mySeat(d);
        openModal("<h3>Accept " + esc(d.hostName) + "'s invite?</h3><p style='margin:0;color:#b3abcf'>" + esc(d.title) + " · " + esc(d.venueName) + "<br>" + esc(when(d.startsAt)) + "</p>"
          + (seat.amount ? "<div class='dt-rules'>Your share is <b>" + money(seat.amount) + "</b>" + (d.mode === "split" ? ", held on your card until everyone pays." : ".") + "</div>" : "<div class='dt-rules'>" + esc(d.hostName) + " paid for your seat.</div>")
          + rulesList() + "<label class='dt-check'><input type='checkbox' id='dtInvAgree'> I understand the rules above.</label><div id='dtInvErr' class='dt-err'></div>"
          + "<button class='dt-btn' id='dtInvGo' style='width:100%;min-height:46px'>" + (seat.amount ? "Accept & " + (d.mode === "split" ? "hold " : "pay ") + money(seat.amount) : "Accept") + "</button>");
        document.getElementById("dtInvGo").onclick = function () {
          if (!document.getElementById("dtInvAgree").checked) { document.getElementById("dtInvErr").textContent = "Tick the box to continue."; return; }
          busy(this, fn("answerInvite", { dateId: id, accept: true })).then(function (r) { if (r.url) location.href = r.url; else { closeModal(); toast("You're going!"); } }, function (e) { document.getElementById("dtInvErr").textContent = e.message; });
        };
        return;
      }
      busy(btn, fn("answerInvite", { dateId: id, accept: false })).then(function () { toast("Invite declined. No charge."); }, function (e) { toast(e.message, "error"); });
    },
    requestJoin: function (id, btn) {
      var block = needsSetup();
      if (block) { toast(block, "warn"); return; }
      busy(btn, fn("requestToJoin", { dateId: id })).then(function () { toast("Request sent. You'll hear back when they pick."); }, function (e) { toast(e.message, "error"); });
    },
    answerRequest: function (id, uid, approve, btn) {
      busy(btn, fn("answerRequest", { dateId: id, memberUid: uid, approve: approve })).then(function () { toast(approve ? "Picked! They'll pay their share next." : "Request declined."); }, function (e) { toast(e.message, "error"); });
    },
    inviteMore: function (id) {
      var d = S.myDates.filter(function (x) { return x.id === id; })[0];
      var picked = [];
      var draw = function (q) {
        var list = people().filter(function (p) { return d.involvedUids.indexOf(p.uid) < 0 && (!q || p.name.toLowerCase().indexOf(q.toLowerCase()) > -1); }).slice(0, 40);
        openModal("<h3>Invite to " + esc(d.title) + "</h3>" + (d.status === "confirmed" ? "<div class='dt-rules'>This seat is already paid for, so they join free (deposit still required).</div>" : "")
          + "<input class='dt-in' id='dtInvSearch' placeholder='Search members' value='" + esc(q || "") + "'>"
          + "<div class='dt-picks'>" + list.map(function (p) { return "<button class='dt-pick' aria-pressed='" + (picked.indexOf(p.uid) > -1) + "' data-uid='" + p.uid + "'>" + avatar(p, 40) + "<span>" + esc(p.name) + "</span></button>"; }).join("") + "</div>"
          + "<button class='dt-btn' id='dtInvSend'>Send invite</button>");
        var s = document.getElementById("dtInvSearch"); s.oninput = function () { var v = s.value; draw(v); var n = document.getElementById("dtInvSearch"); n.focus(); n.setSelectionRange(v.length, v.length); };
        document.querySelectorAll(".dt-picks [data-uid]").forEach(function (b) { b.onclick = function () { var u = b.getAttribute("data-uid"), i = picked.indexOf(u); if (i > -1) picked.splice(i, 1); else picked.push(u); b.setAttribute("aria-pressed", picked.indexOf(u) > -1); }; });
        document.getElementById("dtInvSend").onclick = function () {
          if (!picked.length) return toast("Pick someone first.", "warn");
          busy(this, fn("inviteToDate", { dateId: id, uids: picked })).then(function () { closeModal(); toast("Invite sent"); }, function (e) { toast(e.message, "error"); });
        };
      };
      draw("");
    },

    /* The warning comes from the server, so it always matches what will actually happen. */
    leave: function (id, btn) {
      busy(btn, fn("leaveDate", { dateId: id, preview: true })).then(function (p) {
        var serious = p.loseDeposit || p.loseTicket || p.strike;
        openModal("<h3>" + (serious ? "Before you cancel" : "Leave this date?") + "</h3>"
          + "<div class='dt-warn'" + (serious ? "" : " style='border-color:rgba(255,255,255,.15);background:#0b0b16'") + "><b>" + (serious ? "Here's what happens if you cancel:" : "What happens:") + "</b><ul>" + p.lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul></div>"
          + (p.canReschedule ? "<button class='dt-btn teal' id='dtResInstead'>Reschedule instead</button>" : "")
          + (serious ? "<label class='dt-check'><input type='checkbox' id='dtCancelAgree'> I understand and still want to cancel.</label>" : "")
          + "<div id='dtCancelErr' class='dt-err'></div>"
          + "<div class='dt-actions'><button class='dt-btn ghost' onclick='closeProfileModal()'>Keep my date</button><button class='dt-btn red' id='dtCancelGo'>Cancel anyway</button></div>");
        var r = document.getElementById("dtResInstead"); if (r) r.onclick = function () { Dates.reschedule(id); };
        document.getElementById("dtCancelGo").onclick = function () {
          var c = document.getElementById("dtCancelAgree");
          if (c && !c.checked) { document.getElementById("dtCancelErr").textContent = "Tick the box to confirm."; return; }
          busy(this, fn("leaveDate", { dateId: id })).then(function () { closeModal(); toast("Canceled.", "warn"); }, function (e) { document.getElementById("dtCancelErr").textContent = e.message; });
        };
      }, function (e) { toast(e.message, "error"); });
    },
    reschedule: function (id) {
      var d = S.myDates.filter(function (x) { return x.id === id; })[0];
      var cutoff = Date.now() + S.settings.rescheduleCutoffHours * 3600000;
      var opts = S.tickets.filter(function (t) { return t.venueId === d.venueId && t.size === d.size && t.price === d.total && t.id !== d.ticketId && ms(t.startsAt) > cutoff; });
      openModal("<h3>Reschedule " + esc(d.title) + "</h3><p style='margin:0;color:#b3abcf'>Pick another night of the same package. Everyone on the date has to agree, and you can only reschedule once.</p>"
        + (opts.length ? opts.map(function (t) { return "<button class='dt-opt' data-t='" + t.id + "'><span class='t'><b>" + esc(when(t.startsAt)) + "</b><small>" + esc(t.title) + "</small></span></button>"; }).join("")
          : "<div class='dt-rules'>" + esc(d.venueName) + " hasn't listed another night for this package yet. Ask them to add one, or keep your date.</div>")
        + "<button class='dt-btn ghost' onclick='closeProfileModal()'>Back</button>");
      document.querySelectorAll(".dt-opt[data-t]").forEach(function (b) {
        b.onclick = function () { busy(b, fn("proposeReschedule", { dateId: id, ticketId: b.getAttribute("data-t") })).then(function () { closeModal(); toast("Request sent to your date."); }, function (e) { toast(e.message, "error"); }); };
      });
    },
    answerReschedule: function (id, approve, btn) {
      busy(btn, fn("answerReschedule", { dateId: id, approve: approve })).then(function (r) { toast(r.moved ? "Date moved!" : approve ? "Agreed. Waiting on the others." : "Keeping the original date."); }, function (e) { toast(e.message, "error"); });
    },
    report: function (id) {
      var d = S.myDates.filter(function (x) { return x.id === id; })[0];
      var others = seatsFor(d).filter(function (s) { return s.uid && s.uid !== S.uid; });
      openModal("<h3>Report a problem</h3>"
        + "<select class='dt-in' id='dtRepWho'>" + others.map(function (s) { return "<option value='" + s.uid + "'>" + esc(s.name) + "</option>"; }).join("") + "<option value='venue'>" + esc(d.venueName) + " (venue)</option></select>"
        + "<select class='dt-in' id='dtRepWhy'><option>Didn't show up</option><option>Asked for money outside the app</option><option>Made me feel unsafe</option><option>Rude or disrespectful</option><option>Venue problem</option><option>Something else</option></select>"
        + "<textarea class='dt-in' id='dtRepText' maxlength='1000' rows='4' placeholder='What happened?'></textarea>"
        + "<button class='dt-btn' id='dtRepGo'>Send report</button><p style='margin:0;font-size:12px;color:#9a8fb5'>If you're in danger, call 911 first.</p>");
      document.getElementById("dtRepGo").onclick = function () {
        var who = document.getElementById("dtRepWho").value;
        busy(this, db().collection("reports").add({
          about: who === "venue" ? d.venueId : who, aboutType: who === "venue" ? "venue" : "user", by: S.uid, dateId: id,
          reason: document.getElementById("dtRepWhy").value, detail: document.getElementById("dtRepText").value.trim(),
          status: "open", createdAt: firebase.firestore.FieldValue.serverTimestamp()
        })).then(function () { closeModal(); toast("Report sent. Thanks for telling us."); }, function (e) { toast(e.message, "error"); });
      };
    }
  };
  window.Dates = Dates;

  /* ---------- coming back from Stripe (or a /?dates link) ---------- */
  var params = new URLSearchParams(location.search);
  var back = params.get("dates");
  if (back) {
    var msgs = { deposit: "Deposit added. You're ready to date!", seat: "Payment received. Your date updates in a few seconds.", back: "Checkout wasn't finished. You can pay any time from My Dates." };
    history.replaceState(null, "", location.pathname);
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var u = firebase.auth().currentUser;
      if (u && document.getElementById("mainStage") && window.setActive) {
        clearInterval(t);
        if (u.isAnonymous) return;
        window.setActive(4);
        if (msgs[back]) toast(msgs[back], back === "back" ? "warn" : "success");
      } else if (tries > 60) clearInterval(t);
    }, 250);
  }
})();
