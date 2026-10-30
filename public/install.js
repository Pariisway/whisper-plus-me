/* ═══════════════════════════════════════════════════════════════
   WHISPER+ME — "Add to Home Screen" prompt
   Why it matters: an iPhone only rings for calls when the site is on
   the Home Screen, and on Android the installed app feels like a real
   app (own icon, full screen, faster to open).
   • Android / Chrome / Edge: the browser's own one-tap Install.
   • iPhone Safari: a short picture guide (Share → Add to Home Screen).
   • iPhone in another app's browser (Instagram, Facebook, Chrome…):
     "Open in Safari first" with a copy-link button.
   Shows once to signed-in members a little after they arrive, and again
   at most every 10 days if they tap "Not now". Install.show() opens it
   any time (Profile → More, the Calls tab).
═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var SNOOZE_DAYS = 10, FIRST_DELAY_MS = 25000;
  var deferred = null;           // Chrome's saved install prompt
  var shownThisVisit = false;

  function ua() { return navigator.userAgent || ""; }
  function isIOS() { return /iPhone|iPad|iPod/i.test(ua()) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function isAndroid() { return /Android/i.test(ua()); }
  function inAppBrowser() { return /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|GSA\//i.test(ua()); }
  function iosSafari() { return isIOS() && /Safari/i.test(ua()) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua()) && !inAppBrowser(); }
  function installed() {
    return (window.matchMedia && (window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches)) || window.navigator.standalone === true;
  }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function member() {
    var u = window.firebase && firebase.auth && firebase.auth().currentUser;
    return u && !u.isAnonymous ? u : null;
  }
  function markInstalled() {
    set("wpmInstalled", "1");
    var u = member();
    if (u) firebase.database().ref("users/" + u.uid + "/appInstalled").set(Date.now()).catch(function () {});
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();          // we show our own, friendlier sheet
    deferred = e;
  });
  window.addEventListener("appinstalled", function () {
    deferred = null; close(); markInstalled();
    if (typeof showToast === "function") showToast("📲 Whisper+Me is on your Home Screen", "success", 5000);
  });

  var css = "\
.wi-back{position:fixed;inset:0;background:rgba(5,4,12,.62);z-index:99990;display:flex;align-items:flex-end;justify-content:center;animation:wiFade .2s}\
.wi{width:100%;max-width:460px;background:#14121f;color:#f2eefc;border:1px solid rgba(255,255,255,.1);border-radius:22px 22px 0 0;padding:20px 18px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.5);animation:wiUp .25s ease-out;font-family:inherit;text-align:left}\
@media(min-width:600px){.wi-back{align-items:center}.wi{border-radius:22px}}\
.wi-top{display:flex;gap:14px;align-items:center;margin-bottom:12px}\
.wi-top img{width:58px;height:58px;border-radius:14px;flex:none;box-shadow:0 4px 16px rgba(123,47,247,.4)}\
.wi-top b{display:block;font-size:19px;font-weight:900;line-height:1.2}\
.wi-top span{font-size:13px;color:#a9a3c2}\
.wi-perks{list-style:none;padding:0;margin:0 0 14px;font-size:14px;color:#dcd6f2;line-height:1.5}\
.wi-perks li{padding:3px 0}\
.wi-steps{counter-reset:s;list-style:none;padding:0;margin:0 0 14px}\
.wi-steps li>span{flex:1;min-width:0}\
.wi-steps li{counter-increment:s;display:flex;gap:12px;align-items:center;padding:10px 12px;background:#1b1830;border-radius:14px;margin-bottom:8px;font-size:14.5px}\
.wi-steps li::before{content:counter(s);flex:none;width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#7b2ff7,#00e3ae);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}\
.wi-ico{display:inline-flex;vertical-align:-5px;width:22px;height:22px;margin:0 2px;color:#4aa3ff}\
.wi-go{width:100%;min-height:52px;border:0;border-radius:999px;background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff;font-size:16px;font-weight:800;cursor:pointer;margin:0 0 8px}\
.wi-later{width:100%;min-height:44px;border:0;background:none;color:#8f89a8;font-size:14px;cursor:pointer;margin:0}\
.wi-arrow{position:fixed;left:50%;bottom:calc(6px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:99991;font-size:30px;animation:wiBob 1s infinite;pointer-events:none}\
@keyframes wiUp{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}\
@keyframes wiFade{from{opacity:0}to{opacity:1}}\
@keyframes wiBob{50%{transform:translate(-50%,8px)}}\
";
  var styled = false;
  function style() { if (styled) return; styled = true; var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }

  var SHARE_ICON = "<svg class='wi-ico' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-label='Share'><path d='M12 3v12'/><path d='M8 7l4-4 4 4'/><path d='M5 11v9h14v-9'/></svg>";
  var ADD_ICON = "<svg class='wi-ico' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' aria-label='Add'><rect x='4' y='4' width='16' height='16' rx='4'/><path d='M12 8v8M8 12h8'/></svg>";
  var PERKS = "<ul class='wi-perks'><li>📞 Your phone <b>rings for calls</b> even when Whisper+Me is closed</li><li>⚡ Opens in one tap, full screen, like a real app</li><li>🔒 Free, no app store, no download</li></ul>";

  function close() {
    var b = document.getElementById("wi-back"); if (b) b.remove();
    var a = document.getElementById("wi-arrow"); if (a) a.remove();
  }
  function later() { set("wpmInstallSnooze", String(Date.now())); close(); }

  function sheet(inner) {
    style(); close();
    var back = document.createElement("div");
    back.className = "wi-back"; back.id = "wi-back";
    back.setAttribute("role", "dialog"); back.setAttribute("aria-modal", "true"); back.setAttribute("aria-label", "Add Whisper+Me to your Home Screen");
    back.innerHTML = "<div class='wi'><div class='wi-top'><img src='/icon-192.png' alt=''><div><b>Add Whisper+Me to your Home Screen</b><span>Takes 10 seconds</span></div></div>" + inner + "</div>";
    back.addEventListener("click", function (e) { if (e.target === back) later(); });
    document.body.appendChild(back);
    var l = back.querySelector(".wi-later"); if (l) l.onclick = later;
    return back;
  }

  function show(manual) {
    if (installed()) {
      if (manual && typeof showToast === "function") showToast("You're already using the Home Screen app ✓", "success");
      return;
    }
    shownThisVisit = true;
    if (deferred) {
      var b = sheet(PERKS + "<button class='wi-go'>📲 Install the app</button><button class='wi-later'>Not now</button>");
      b.querySelector(".wi-go").onclick = function () {
        var d = deferred; deferred = null; close();
        d.prompt();
        (d.userChoice || Promise.resolve({})).then(function (c) { if (c && c.outcome === "accepted") markInstalled(); else set("wpmInstallSnooze", String(Date.now())); });
      };
      return;
    }
    if (isIOS() && !iosSafari()) {
      var b2 = sheet(PERKS + "<ol class='wi-steps'><li><span>Tap <b>Copy link</b> below</span></li><li><span>Open <b>Safari</b> and paste it</span></li><li><span>Tap " + SHARE_ICON + " then <b>Add to Home Screen</b></span></li></ol>"
        + "<button class='wi-go'>📋 Copy link</button><button class='wi-later'>Not now</button>");
      b2.querySelector(".wi-go").onclick = function () {
        var url = "https://whisperplusme.com/";
        var done = function () { if (typeof showToast === "function") showToast("Link copied. Now open Safari and paste it.", "success", 5000); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt("Copy this link, then open it in Safari:", url); });
        else prompt("Copy this link, then open it in Safari:", url);
      };
      return;
    }
    if (isIOS()) {
      sheet(PERKS + "<ol class='wi-steps'><li><span>Tap the Share button " + SHARE_ICON + " at the bottom of Safari</span></li><li><span>Scroll down and tap " + ADD_ICON + " <b>Add to Home Screen</b></span></li><li><span>Open Whisper+Me from the new icon, then turn on call alerts</span></li></ol>"
        + "<button class='wi-later' style='color:#fff;font-weight:700'>Got it</button>");
      return;
    }
    if (manual || isAndroid()) {
      sheet(PERKS + "<ol class='wi-steps'><li><span>Open your browser menu <b>⋮</b> (top right)</span></li><li><span>Tap <b>Install app</b> or <b>Add to Home screen</b></span></li><li><span>Open Whisper+Me from the new icon</span></li></ol>"
        + "<button class='wi-later' style='color:#fff;font-weight:700'>Got it</button>");
    }
  }

  /* Automatic: members only, after they've had a moment to look around, never mid-call. */
  function maybeAuto() {
    if (shownThisVisit || installed() || !member()) return;
    if (get("wpmInstalled") === "1" && !isIOS()) return;
    var snooze = Number(get("wpmInstallSnooze") || 0);
    if (snooze && Date.now() - snooze < SNOOZE_DAYS * 864e5) return;
    if (window.__activeCallId || window.__liveCallHTML || document.querySelector(".modal-overlay[style*='flex'],#profileModal[style*='flex']")) { setTimeout(maybeAuto, 20000); return; }
    var canHelp = deferred || isIOS() || isAndroid();
    if (canHelp) show(false);
  }

  function boot() {
    if (installed()) { markInstalledOnce(); return; }
    if (!window.firebase || !firebase.auth) return;
    firebase.auth().onAuthStateChanged(function (u) { if (u && !u.isAnonymous) setTimeout(maybeAuto, FIRST_DELAY_MS); });
  }
  function markInstalledOnce() {
    if (!window.firebase || !firebase.auth) return;
    firebase.auth().onAuthStateChanged(function (u) {
      if (!u || u.isAnonymous) return;
      if (get("wpmInstalledSeen_" + u.uid)) return;
      set("wpmInstalledSeen_" + u.uid, "1"); markInstalled();
    });
  }

  window.Install = { show: function () { show(true); }, isInstalled: installed, canPrompt: function () { return !!deferred; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
