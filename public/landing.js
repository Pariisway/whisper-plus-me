/* ═══════════════════════════════════════════════════════════════
   WHISPER+ME LANDING — live background + social sign-in
   The background (video playlist, picture or solid color) and the
   headline are set in Admin → Landing page and stored in the public
   `landing` node of the Realtime Database.
═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var DEFAULTS = {
    mode: "color",                 // "videos" | "image" | "color"
    playlist: {},                  // { id: { url, type: "video"|"image", name, order } }
    image: "",
    color: "#0b0b16", color2: "#3a1170", gradient: true,
    shuffle: false, imageSeconds: 8, overlay: 0.45, showSound: true,
    headline: "Talk. Go live. Meet up.",
    subline: "Voice rooms, live mics, 1-on-1 calls and real meet & greets. Your people are already here."
  };
  var cfg = Object.assign({}, DEFAULTS);
  var stats = null;
  var mounted = false, listening = false;
  var queue = [], qi = 0, timer = null, soundOn = false, layers = [], front = 0;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lowData() {
    var c = navigator.connection || {};
    return !!c.saveData || /(^|-)2g$/.test(c.effectiveType || "") ||
      (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* ---------- styles ---------- */
  var css = "\
#lp-bg{position:fixed;inset:0;z-index:0;overflow:hidden;background:#0b0b16;pointer-events:none}\
#lp-bg .lp-layer{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 1.2s ease}\
#lp-bg .lp-layer.on{opacity:1}\
#lp-bg .lp-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,5,12,.55) 0%,rgba(5,5,12,var(--lp-shade,.45)) 45%,rgba(5,5,12,.85) 100%)}\
#lp-bg .lp-orb{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55;animation:lpFloat 18s ease-in-out infinite}\
@keyframes lpFloat{0%,100%{transform:translate(0,0)}50%{transform:translate(40px,-30px)}}\
body.lp2-on #header,body.lp2-on #footer,body.lp2-on #legalLinks,body.lp2-on #membersContainer{display:none!important}\
body.lp2-on{background:#0b0b16}\
.lp2{position:relative;z-index:1;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;color:#fff;padding:max(14px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(84px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left))}\
.lp2-top{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:1100px;width:100%;margin:0 auto}\
.lp2-logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;letter-spacing:-.01em;color:#fff;text-decoration:none}\
.lp2-logo img{width:34px;height:34px;border-radius:50%;box-shadow:0 0 14px rgba(0,227,174,.4)}\
.lp2-logo b{color:#00e3ae}\
.lp2-login{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:999px;padding:9px 18px;font-weight:700;font-size:14px;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}\
.lp2-hero{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;max-width:560px;width:100%;margin:0 auto;padding:28px 0 18px;gap:18px}\
.lp2-live{display:inline-flex;align-self:center;align-items:center;gap:8px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:7px 14px;font-size:13px;font-weight:700;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}\
.lp2-live i{width:9px;height:9px;border-radius:50%;background:#ff3b5c;box-shadow:0 0 0 0 rgba(255,59,92,.7);animation:lpPulse 1.6s infinite}\
@keyframes lpPulse{70%{box-shadow:0 0 0 9px rgba(255,59,92,0)}100%{box-shadow:0 0 0 0 rgba(255,59,92,0)}}\
.lp2-h1{margin:0;font-size:clamp(40px,9vw,72px);line-height:1.02;font-weight:900;letter-spacing:-.03em;text-shadow:0 4px 30px rgba(0,0,0,.45)}\
.lp2-h1 span{white-space:nowrap;background:linear-gradient(90deg,#b98cff,#00e3ae);-webkit-background-clip:text;background-clip:text;color:transparent}\
.lp2-sub{margin:0 auto;font-size:clamp(16px,2.4vw,19px);line-height:1.5;color:rgba(255,255,255,.88);max-width:46ch;text-shadow:0 2px 16px rgba(0,0,0,.5)}\
.lp2-emailbox{display:flex;flex-direction:column;gap:10px}\
.lp2-emailbox[hidden]{display:none}\
.lp2-pair{display:flex;gap:10px;width:100%}.lp2-pair .lp2-btn{flex:1}\
.lp2-inv{display:flex;gap:12px;align-items:center;text-align:left;width:100%;max-width:420px;margin:0 auto 6px;padding:12px;border-radius:18px;background:rgba(12,10,26,.82);border:1px solid rgba(214,177,107,.55);box-shadow:0 10px 40px rgba(0,0,0,.45);backdrop-filter:blur(10px)}\
.lp2-inv img,.lp2-inv-ph{width:72px;height:72px;border-radius:14px;object-fit:cover;flex:none;display:grid;place-items:center;font-size:30px;background:linear-gradient(135deg,#7b2ff7,#00e3ae)}\
.lp2-inv small{display:block;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#f3d08a;font-weight:800}\
.lp2-inv b{display:block;font-size:16px;line-height:1.2;margin:2px 0;color:#fff}\
.lp2-inv span{display:block;font-size:12.5px;color:#cfc8e8;line-height:1.4}\
.lp2-inv em{display:block;font-style:normal;font-weight:800;color:#00e3ae;font-size:13px;margin-top:3px}\
.lp2-inv-go{margin:0 0 4px;font-size:13px;color:#fff;font-weight:700;text-align:center}\
#lp2-invite{width:100%}#lp2-invite:not(:empty){margin-top:clamp(50px,18vh,240px)}#lp2-invite:not(:empty)+.lp2-card{margin-top:0}\
.lp2-forgot{align-self:center;font-size:13px}\
.lp2-or{display:flex;align-items:center;gap:10px;color:rgba(255,255,255,.55);font-size:12px;text-transform:uppercase;letter-spacing:.1em}.lp2-or::before,.lp2-or::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.18)}\
.lp2-card{width:100%;max-width:440px;margin-top:clamp(70px,24vh,300px);background:rgba(10,10,22,.42)!important;text-align:left;display:flex;flex-direction:column;gap:10px;background:rgba(10,10,22,.55);border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:16px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}\
.lp2-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:52px;border-radius:999px;border:0;font-size:16px;font-weight:800;cursor:pointer;text-decoration:none}\
.lp2-btn.google{background:#fff;color:#111}\
.lp2-btn.main{background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff}\
.lp2-btn.ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.28);font-weight:700}\
.lp2-btn:active{transform:scale(.99)}\
.lp2-in{margin:0;width:100%;min-height:48px;padding:0 16px;border-radius:14px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.35);color:#fff;font-size:16px;outline:0}\
.lp2-in:focus{border-color:#00e3ae}\
.lp2-row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:13.5px;color:rgba(255,255,255,.75)}\
.lp2-link{background:none;border:0;padding:0;min-height:0;color:#00e3ae;font-weight:700;font-size:13.5px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}\
.lp2-guest{align-self:center;background:none;border:0;color:rgba(255,255,255,.85);font-weight:700;font-size:15px;cursor:pointer;padding:8px}\
.lp2-guest:hover{color:#fff}\
.lp2-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}\
.lp2-chips span{background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:7px 12px;font-size:13px;font-weight:600;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}\
.lp2-foot{display:flex;justify-content:center;gap:18px;flex-wrap:wrap;font-size:12.5px;padding-top:6px}\
.lp2-foot a{color:rgba(255,255,255,.6);text-decoration:none}\
.lp2-foot a:hover{color:#fff}\
.lp2-terms{font-size:12px;color:rgba(255,255,255,.6);text-align:center;margin:0}\
.lp2-terms a{color:rgba(255,255,255,.8)}\
#lp-sound{position:fixed;z-index:3;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));display:flex;align-items:center;gap:8px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:999px;padding:10px 16px;font-weight:700;font-size:14px;cursor:pointer;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}\
#lp-sound[hidden]{display:none}\
@media (min-width:900px){.lp2-hero{max-width:640px}}\
@media (max-width:700px){#lp-sound{bottom:auto;top:44%;right:12px;width:48px;height:48px;padding:0;justify-content:center;font-size:20px;border-radius:50%}#lp-sound span{display:none}}\
";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---------- settings ---------- */
  function listen() {
    if (listening || !window.firebase || !firebase.database) return;
    listening = true;
    firebase.database().ref("landing").on("value", function (snap) {
      var v = snap.val() || {};
      stats = v.stats || null;
      var next = Object.assign({}, DEFAULTS, v); delete next.stats;
      var changed = JSON.stringify(next) !== JSON.stringify(cfg);
      cfg = next;
      paintText();
      if (mounted && changed) startBackground();
      applySite();
    }, function () { /* offline or blocked: keep defaults */ });
  }

  /* ---------- background engine ---------- */
  function bgEl() {
    var el = document.getElementById("lp-bg");
    if (!el) { el = document.createElement("div"); el.id = "lp-bg"; el.setAttribute("aria-hidden", "true"); document.body.insertBefore(el, document.body.firstChild); }
    return el;
  }
  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }
  function stopBackground() {
    clearTimer();
    layers.forEach(function (l) { if (l.tagName === "VIDEO") { try { l.pause(); l.removeAttribute("src"); l.load(); } catch (e) {} } });
    layers = [];
    var el = document.getElementById("lp-bg"); if (el) el.remove();
    var snd = document.getElementById("lp-sound"); if (snd) snd.remove();
  }
  function baseLayer() {
    return "<div class='lp-shade' style='--lp-shade:" + Math.max(0, Math.min(.9, Number(cfg.overlay) || 0)) + "'></div>";
  }
  function startBackground() {
    clearTimer();
    var el = bgEl();
    layers.forEach(function (l) { if (l.tagName === "VIDEO") { try { l.pause(); } catch (e) {} } });
    layers = []; front = 0;
    var mode = cfg.mode, imageUrl = cfg.image;
    var hex = function (c, d) { return /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : d; };
    var c1 = hex(cfg.color, "#0b0b16"), c2 = hex(cfg.color2, "#3a1170");
    var items = Object.keys(cfg.playlist || {}).map(function (k) { return cfg.playlist[k]; })
      .filter(function (x) { return x && x.url; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    if (mode === "videos" && !items.length) mode = imageUrl ? "image" : "color";
    if (mode === "videos" && lowData()) {
      // Save data / reduced motion: show a still instead of streaming video.
      var still = items.filter(function (x) { return x.type === "image"; })[0];
      if (still) imageUrl = still.url;
      mode = imageUrl ? "image" : "color";
    }
    if (mode === "color") {
      var bg = cfg.gradient ? "radial-gradient(1200px 800px at 15% 10%," + c2 + " 0%,transparent 60%),radial-gradient(900px 700px at 90% 90%,#00e3ae33 0%,transparent 60%)," + c1 : c1;
      el.style.background = "";
      el.style.backgroundColor = c1;
      el.style.backgroundImage = cfg.gradient ? bg.slice(0, bg.lastIndexOf(",")) : "none";
      el.innerHTML = (cfg.gradient ? "<div class='lp-orb' style='width:340px;height:340px;left:-80px;top:20%;background:" + c2 + "'></div><div class='lp-orb' style='width:280px;height:280px;right:-60px;bottom:10%;background:#00e3ae;animation-delay:-6s'></div>" : "") + baseLayer();
      soundButton(false);
      return;
    }
    el.style.backgroundImage = "none"; el.style.backgroundColor = "#000";
    if (mode === "image") {
      el.innerHTML = "<img class='lp-layer on' alt='' src='" + esc(imageUrl || (items[0] && items[0].url) || "") + "'>" + baseLayer();
      soundButton(false);
      return;
    }
    // Video playlist (may include pictures, shown for imageSeconds each).
    queue = items.slice();
    if (cfg.shuffle) queue.sort(function () { return Math.random() - .5; });
    qi = 0;
    el.innerHTML = "<video class='lp-layer' muted playsinline preload='auto'></video><video class='lp-layer' muted playsinline preload='auto'></video><img class='lp-layer' alt=''>" + baseLayer();
    layers = Array.prototype.slice.call(el.querySelectorAll(".lp-layer"));
    playItem(queue[0]);
  }
  function playItem(item) {
    if (!mounted || !item) return;
    clearTimer();
    var el = document.getElementById("lp-bg"); if (!el) return;
    var vids = layers.filter(function (l) { return l.tagName === "VIDEO"; });
    var img = layers.filter(function (l) { return l.tagName === "IMG"; })[0];
    var advance = function () { qi = (qi + 1) % queue.length; playItem(queue[qi]); };
    if (item.type === "image") {
      img.onload = function () { layers.forEach(function (l) { l.classList.toggle("on", l === img); if (l.tagName === "VIDEO") { try { l.pause(); } catch (e) {} } }); };
      img.src = item.url;
      soundButton(false);
      timer = setTimeout(advance, Math.max(3, Number(cfg.imageSeconds) || 8) * 1000);
      return;
    }
    var v = vids[front]; front = 1 - front;
    v.muted = !soundOn;
    v.loop = queue.length === 1;
    v.onended = queue.length > 1 ? advance : null;
    v.onerror = function () { if (queue.length > 1) advance(); };
    v.oncanplay = function () {
      v.oncanplay = null;
      var p = v.play(); if (p && p.catch) p.catch(function () { v.muted = true; soundOn = false; v.play().catch(function () {}); updateSoundLabel(); });
      layers.forEach(function (l) { l.classList.toggle("on", l === v); if (l !== v && l.tagName === "VIDEO") { try { l.pause(); } catch (e) {} } });
    };
    v.src = item.url;
    v.load();
    soundButton(true);
    // Never let one broken or very long video freeze the playlist.
    if (queue.length > 1) timer = setTimeout(function () { if (!v.paused && v.duration && v.currentTime < v.duration - 1) return; advance(); }, 90000);
  }

  /* ---------- main site background (after sign-in), set in Admin → Landing page ---------- */
  var siteKey = "";
  function applySite() {
    var st = cfg.site || {}, mode = st.mode || "default";
    var el = document.getElementById("site-bg");
    if (mounted || mode === "default") { if (el) el.remove(); siteKey = ""; return; }
    var hex = function (c, d) { return /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : d; };
    if (mode === "video" && (lowData() || !st.video)) mode = st.image ? "image" : "color";
    var key = JSON.stringify([mode, st.image, st.video, st.color, st.color2, st.gradient, st.overlay]);
    if (el && key === siteKey) return;
    siteKey = key;
    if (!el) { el = document.createElement("div"); el.id = "site-bg"; el.setAttribute("aria-hidden", "true"); el.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden"; document.body.insertBefore(el, document.body.firstChild); }
    var shade = "<div style='position:absolute;inset:0;background:rgba(8,8,18," + Math.max(0, Math.min(.9, Number(st.overlay == null ? .5 : st.overlay))) + ")'></div>";
    var c1 = hex(st.color, "#0e0e1c"), c2 = hex(st.color2, "#3a1170");
    el.style.background = c1;
    if (mode === "image" && st.image) el.innerHTML = "<img src='" + esc(st.image) + "' alt='' style='position:absolute;inset:0;width:100%;height:100%;object-fit:cover'>" + shade;
    else if (mode === "video") el.innerHTML = "<video src='" + esc(st.video) + "' autoplay muted loop playsinline style='position:absolute;inset:0;width:100%;height:100%;object-fit:cover'></video>" + shade;
    else { el.innerHTML = ""; if (st.gradient !== false) el.style.backgroundImage = "radial-gradient(1200px 800px at 15% 10%," + c2 + " 0%,transparent 60%),radial-gradient(900px 700px at 90% 90%,#00e3ae22 0%,transparent 60%)"; }
    var v = el.querySelector("video"); if (v) { v.muted = true; var p = v.play && v.play(); if (p && p.catch) p.catch(function () {}); }
  }

  /* ---------- sound button ---------- */
  function soundButton(isVideo) {
    var btn = document.getElementById("lp-sound");
    if (!isVideo || cfg.showSound === false) { if (btn) btn.hidden = true; return; }
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "lp-sound"; btn.type = "button";
      btn.onclick = function () {
        soundOn = !soundOn;
        layers.forEach(function (l) { if (l.tagName === "VIDEO") l.muted = !soundOn; });
        var cur = layers.filter(function (l) { return l.tagName === "VIDEO" && l.classList.contains("on"); })[0];
        if (cur && soundOn) cur.play().catch(function () {});
        updateSoundLabel();
      };
      document.body.appendChild(btn);
    }
    btn.hidden = false;
    updateSoundLabel();
  }
  function updateSoundLabel() {
    var btn = document.getElementById("lp-sound"); if (!btn) return;
    btn.innerHTML = soundOn ? "🔊 <span>Sound on</span>" : "🔇 <span>Tap for sound</span>";
    btn.setAttribute("aria-pressed", soundOn);
    btn.setAttribute("aria-label", soundOn ? "Turn sound off" : "Turn sound on");
  }

  /* ---------- text ---------- */
  function liveText() {
    if (stats && stats.online > 1) return stats.online + " people online now" + (stats.liveRooms ? " · " + stats.liveRooms + " live room" + (stats.liveRooms > 1 ? "s" : "") : "");
    return "Live now · open 24/7";
  }
  function headlineHTML(h) {
    // Last sentence gets the gradient, e.g. "Talk. Go live. <span>Meet up.</span>"
    var parts = (String(h || "").trim().match(/[^.!?]+[.!?]*/g) || []).map(function (x) { return x.trim(); }).filter(Boolean);
    if (parts.length < 2) return esc(h);
    var last = parts.pop();
    return esc(parts.join(" ")) + " <span>" + esc(last) + "</span>";
  }
  function paintText() {
    var a = document.getElementById("lp2-live-text"); if (a) a.textContent = liveText();
    var b = document.getElementById("lp2-h1"); if (b) b.innerHTML = headlineHTML(cfg.headline);
    var c = document.getElementById("lp2-sub"); if (c) c.textContent = cfg.subline;
  }

  /* ---------- someone opened a shared M&G link: show it above sign-up ---------- */
  var invite = null, inviteLoading = false;
  function sharedMeetupId() {
    var id = (new URLSearchParams(location.search).get("meetup") || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!id) { try { id = sessionStorage.getItem("wpmMeetup") || ""; } catch (e) {} }
    return id.slice(0, 64);
  }
  function loadInvite() {
    var id = sharedMeetupId();
    if (!id || invite || inviteLoading || !window.fetch) return;
    inviteLoading = true;
    // Live M&Gs are public, so the Firestore REST API can read one without signing in.
    var pid = (window.firebaseConfig && firebaseConfig.projectId) || "whisperplusme-46d9c";
    fetch("https://firestore.googleapis.com/v1/projects/" + pid + "/databases/(default)/documents/meetups/" + id).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.fields) return;
      var f = j.fields, v = function (k) { var x = f[k] || {}; return x.stringValue != null ? x.stringValue : x.integerValue != null ? Number(x.integerValue) : x.doubleValue != null ? x.doubleValue : x.booleanValue != null ? x.booleanValue : x.timestampValue || null; };
      if (v("status") !== "live" || v("hidden")) return;
      invite = { title: v("title"), host: v("official") ? "Whisper+Me" : v("hostName"), photo: v("imageURL") || v("hostPhoto") || "", venue: v("venueName"), city: v("city"),
        price: v("price"), left: Math.max(0, (v("spots") || 0) - (v("sold") || 0) - (v("held") || 0)), at: Date.parse(v("startsAt")) };
      var el = document.getElementById("lp2-invite"); if (el) el.innerHTML = inviteHTML();
    }).catch(function () {});
  }
  function inviteHTML() {
    if (!invite) { loadInvite(); return ""; }
    var d = new Date(invite.at), when = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    var money = "$" + ((invite.price || 0) / 100).toFixed(invite.price % 100 ? 2 : 0);
    return "<div class='lp2-inv'>" + (invite.photo ? "<img src='" + esc(invite.photo) + "' alt=''>" : "<span class='lp2-inv-ph'>⭐</span>")
      + "<div><small>You're invited · M&amp;G</small><b>" + esc(invite.title) + "</b><span>with " + esc(invite.host) + " · " + esc(when) + "<br>📍 " + esc(invite.venue) + (invite.city ? ", " + esc(invite.city) : "") + "</span>"
      + "<em>" + money + " per person" + (invite.left && invite.left <= 10 ? " · only " + invite.left + " left" : "") + "</em></div></div>"
      + "<p class='lp2-inv-go'>Sign up free below to get your spot 👇</p>";
  }

  /* ---------- markup (rendered by app.js when signed out) ---------- */
  function html() {
    return "<div class='lp2'>"
      + "<div class='lp2-top'><a class='lp2-logo' href='/'><img src='/header-icon.png' alt=''><span>Whisper<b>+</b>Me</span></a>"
      + "<button class='lp2-login' onclick=\"Landing.showEmail('login')\">Log in</button></div>"
      + "<main class='lp2-hero'>"
      + "<div class='lp2-live'><i></i><span id='lp2-live-text'>" + esc(liveText()) + "</span></div>"
      + "<h1 class='lp2-h1' id='lp2-h1'>" + headlineHTML(cfg.headline) + "</h1>"
      + "<p class='lp2-sub' id='lp2-sub'>" + esc(cfg.subline) + "</p>"
      + "<div id='lp2-invite'>" + inviteHTML() + "</div>"
      + "<div class='lp2-card' id='lp-auth'>"
      + "<input id='email' class='lp2-in' type='email' placeholder='Email' autocomplete='email' inputmode='email'>"
      + "<input id='password' class='lp2-in' type='password' placeholder='Password (6+ characters)' autocomplete='current-password'>"
      + "<div class='lp2-pair'><button class='lp2-btn main' id='lp-login-btn' onclick=\"Landing.submit('login')\">Log in</button>"
      + "<button class='lp2-btn ghost' id='lp-signup-btn' onclick=\"Landing.submit('signup')\">Sign up</button></div>"
      + "<button class='lp2-link lp2-forgot' onclick='lpForgotPassword()'>Forgot password?</button>"
      + "<div class='lp2-or'><span>or</span></div>"
      + "<button class='lp2-btn google' onclick='signInWithGoogle()'><img src='https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg' width='20' height='20' alt=''>Continue with Google</button>"
      + "<p class='lp2-terms'>18+ only. By joining you agree to the <a href='/terms.html'>Terms</a> &amp; <a href='/privacy.html'>Privacy</a>.</p>"
      + "</div>"
      + "<button class='lp2-guest' id='lp-guest-btn' onclick='enterAsGuest()'>👀 Peek inside first, no sign-up →</button>"
      + "<div class='lp2-chips'><span>🎙️ Live rooms</span><span>📞 1-on-1 calls</span><span>🗺️ Live map</span><span>⭐ Meet & greets</span></div>"
      + "</main>"
      + "<div class='lp2-foot'><a href='/about.html'>About</a><a href='/terms.html'>Terms</a><a href='/privacy.html'>Privacy</a></div>"
      + "</div>";
  }

  var Landing = {
    html: function () { listen(); return html(); },
    mount: function () {
      listen();
      document.body.classList.add("lp2-on");
      if (!mounted) { mounted = true; startBackground(); }
      applySite();
      paintText();
    },
    unmount: function () {
      listen(); applySite();
      if (!mounted && !document.body.classList.contains("lp2-on")) return;
      mounted = false;
      document.body.classList.remove("lp2-on");
      stopBackground();
    },
    mode: "login",
    showEmail: function (mode) {
      Landing.mode = mode;
      var el = document.getElementById("email"); if (!el) return;
      if (el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus();
    },
    submit: function (mode) {
      mode = mode || Landing.mode || "login";
      Landing.mode = mode;
      var e = (document.getElementById("email") || {}).value || "", p = (document.getElementById("password") || {}).value || "";
      if (!e.trim() || !p) { showToast("Enter your email and a password", "warn"); return; }
      if (mode === "signup") {
        if (p.length < 6) { showToast("Password must be at least 6 characters", "warn"); return; }
        // Next: pick a display name and an optional photo, then the account is created.
        if (window.showSignupPhotoStep) showSignupPhotoStep(); else doSignUp();
      } else doLogin();
    }
  };
  // Keep the old helper working (used after a guest taps "Sign up").
  window.lpTab = function (tab) { Landing.showEmail(tab === 1 || tab === "signup" ? "signup" : "login"); };
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && document.body.classList.contains("lp2-on") && e.target && /^(email|password|lp-name)$/.test(e.target.id)) Landing.submit();
  });
  window.Landing = Landing;
})();
