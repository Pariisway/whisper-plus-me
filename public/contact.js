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
