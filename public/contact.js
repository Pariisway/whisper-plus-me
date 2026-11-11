/* Whisper+Me contact email, the same on every page.
   Change it in Admin → Landing → 📮 Contact email. Pages keep the old address
   in their HTML (for Google and for no-JavaScript visitors); this swaps in the
   current one. Mark spots with data-contact:
     <a data-contact href="mailto:x">x</a>   → link + text
     <span data-contact></span>             → text only            */
(function () {
  var RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
  function apply(e) {
    if (!RE.test(e || "")) return;
    window.WPM_CONTACT = e;
    var els = document.querySelectorAll("[data-contact]");
    for (var i = 0; i < els.length; i++) {
      var a = els[i];
      if (a.textContent !== e) a.textContent = e;
      if (a.tagName === "A") a.setAttribute("href", "mailto:" + e);
    }
  }
  window.wpmContact = function () { return window.WPM_CONTACT || "whisper.me.support@gmail.com"; };
  window.wpmApplyContact = function () { apply(window.WPM_CONTACT); };
  var saved = ""; try { saved = localStorage.getItem("wpmContact") || ""; } catch (e) {}
  function start() {
    apply(saved);
    if (!window.fetch) return;
    fetch("/site-info").then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) {
      if (!j || !RE.test(j.email || "")) return;
      try { localStorage.setItem("wpmContact", j.email); } catch (e) {}
      apply(j.email);
    }).catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();

/* 🤝 Opened from a partner's link (?via=CODE)? Count the visit once and keep the code on every
   link to the rest of the site, so the partner gets credit wherever the visitor goes next. */
(function(){try{var q=new URLSearchParams(location.search),v=(q.get("via")||"").toLowerCase().replace(/[^a-z0-9-]/g,"").slice(0,20);if(!v)return;if(!q.get("vc")){var k="wpmViaPing_"+v,d=false;try{d=!!sessionStorage.getItem(k);sessionStorage.setItem(k,"1")}catch(e){}if(!d)fetch("/go/"+v+"/ping",{keepalive:true}).catch(function(){})}var fix=function(){[].forEach.call(document.querySelectorAll("a[href]"),function(a){try{var u=new URL(a.getAttribute("href"),location.href);if(u.origin!==location.origin||/^\/go\//.test(u.pathname)||u.searchParams.has("via")||/\.(png|jpe?g|webp|xml|txt|mp4|pdf)$/i.test(u.pathname))return;u.searchParams.set("via",v);u.searchParams.set("vc","1");a.href=u.href}catch(e){}})};fix();document.addEventListener("DOMContentLoaded",fix)}catch(e){}})();

/* 🍪 Cookie choice. One small card, asked once, a real yes and a real no.
   Yes  → nothing changes (Google Analytics + personalized AdSense ads).
   No   → analytics off, ads still show but aren't based on the visitor.
   Visitors in Europe get Google's own consent message instead (AdSense → Privacy & messaging),
   so this card stays out of the way there. Reopen any time: wpmCookies.open()          */
(function () {
  var KEY = "wpmCookies", NO = { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" },
      YES = { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted" };
  function get() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function apply(v) {
    try {
      window.dataLayer = window.dataLayer || [];
      (function () { window.dataLayer.push(arguments); })("consent", "update", v === "no" ? NO : YES);
      (window.adsbygoogle = window.adsbygoogle || []).requestNonPersonalizedAds = v === "no" ? 1 : 0;
      if (window.fbq) window.fbq("consent", v === "no" ? "revoke" : "grant");
    } catch (e) {}
  }
  function close() { var el = document.getElementById("wpmCk"); if (el && el.parentNode) el.parentNode.removeChild(el); }
  function choose(v) { try { localStorage.setItem(KEY, v); } catch (e) {} apply(v); close(); }
  function open() {
    if (document.getElementById("wpmCk")) return;
    if (!document.getElementById("wpmCkCss")) {
      var st = document.createElement("style"); st.id = "wpmCkCss";
      st.textContent = "#wpmCk{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147482000;max-width:400px;margin:0 auto;background:#161325;color:#ece8ff;border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:14px 16px;box-shadow:0 16px 48px rgba(0,0,0,.55);font:14px/1.45 system-ui,-apple-system,sans-serif;animation:wpmCkUp .35s ease}"
        + "@keyframes wpmCkUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}@media(prefers-reduced-motion:reduce){#wpmCk{animation:none}}"
        + "#wpmCk b.t{display:block;font-size:15.5px;margin-bottom:4px;color:#fff}#wpmCk p{margin:0 0 12px;color:#bdb5dc}#wpmCk a{color:#cfc6ff}"
        + "#wpmCk .r{display:flex;gap:8px}#wpmCk button{flex:1;min-height:44px;border-radius:999px;font:800 14px system-ui,-apple-system,sans-serif;cursor:pointer;padding:0 12px}"
        + "#wpmCk .y{border:0;background:linear-gradient(90deg,#7b2ff7,#ff4f8b);color:#fff}#wpmCk .n{border:1px solid rgba(255,255,255,.22);background:transparent;color:#ece8ff}";
      document.head.appendChild(st);
    }
    var d = document.createElement("div"); d.id = "wpmCk"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "Cookie choice");
    d.innerHTML = "<b class='t'>🍪 Cookies keep Whisper+Me free</b>"
      + "<p>Ads pay the bills so you never have to. Say yes and the ads you see are at least about things you like. Say no and nothing is locked. You just get random ads. <a href='/privacy.html#cookies'>What we use</a></p>"
      + "<div class='r'><button type='button' class='n'>No thanks</button><button type='button' class='y'>I'm in 🍪</button></div>";
    d.querySelector(".y").onclick = function () { choose("yes"); };
    d.querySelector(".n").onclick = function () { choose("no"); };
    document.body.appendChild(d);
  }
  window.wpmCookies = { open: open, get: get };
  var v = get();
  if (v) apply(v);
  function start() {
    if (get()) return;
    var tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    if (/^(Europe|Atlantic\/(Reykjavik|Canary|Madeira|Azores|Faroe))/.test(tz)) return;   // Google's message handles these
    if (window.self !== window.top) return;                                                // never inside an embed
    setTimeout(open, 2500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
