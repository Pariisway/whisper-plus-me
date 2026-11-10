/* 🔗 Picture from a link
   Every "choose a picture" spot on the site gets a small "🔗 Use a picture link"
   button. Paste a picture's web address → the server downloads it (fetchPicture)
   → it's dropped into that same file box, as if it had been picked from the phone.
   So every existing upload (profile photo, M&G picture, admin uploads…) just works.

   Opt out:   <input type="file" data-nolink>
   Placement: data-linkafter=".css-selector"  (put the button after that element)
              otherwise after the input's <label>, or after the input itself.   */
(function () {
  "use strict";
  var CSS = ".pl-btn{display:inline-flex;align-items:center;gap:5px;margin:6px 0 0;padding:6px 11px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#cfc6ff;font:600 12.5px system-ui,-apple-system,sans-serif;cursor:pointer;min-height:0;line-height:1.2;width:auto}"
    + ".pl-btn:hover{background:rgba(255,255,255,.12)}"
    + ".pl-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(5,4,12,.72);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif}"
    + ".pl-box{width:100%;max-width:420px;background:#161325;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:18px;color:#ece8ff;box-shadow:0 20px 60px rgba(0,0,0,.5)}"
    + ".pl-box h3{margin:0 0 6px;font-size:17px}.pl-box p{margin:0 0 12px;color:#a59cc6;font-size:13px;line-height:1.45}"
    + ".pl-in{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:#0d0b18;color:#fff;font-size:15px}"
    + ".pl-pv{display:none;margin:12px auto 0;max-width:100%;max-height:180px;border-radius:12px}"
    + ".pl-err{color:#ff7a8a;font-size:13px;min-height:18px;margin-top:8px}"
    + ".pl-row{display:flex;gap:8px;margin-top:10px}.pl-row button{flex:1;padding:12px;border-radius:999px;border:0;font-weight:800;font-size:14px;cursor:pointer}"
    + ".pl-go{background:linear-gradient(90deg,#7b2ff7,#ff4f8b);color:#fff}.pl-go[disabled]{opacity:.6}.pl-no{background:rgba(255,255,255,.08);color:#ddd}";

  function addCss() {
    if (document.getElementById("pl-css")) return;
    var st = document.createElement("style"); st.id = "pl-css"; st.textContent = CSS; document.head.appendChild(st);
  }
  function wants(input) {
    if (!input || input.type !== "file" || input.hasAttribute("data-nolink") || input.dataset.piclink) return false;
    var acc = (input.getAttribute("accept") || "").toLowerCase();
    if (acc.indexOf("image") < 0 && acc.indexOf(".gif") < 0) return false;
    if (input.closest && input.closest(".chat-input-bar")) return false;   // the 📷 in chat stays a single tap
    return true;
  }
  function anchorFor(input) {
    var sel = input.getAttribute("data-linkafter");
    if (sel) { var root = input.closest(input.getAttribute("data-linkroot") || "body") || document; var el = root.querySelector(sel); if (el) return el; }
    var lab = input.closest("label");
    if (lab) return lab;
    if (input.id) { var l2 = document.querySelector("label[for='" + input.id.replace(/'/g, "") + "']"); if (l2) return l2; }
    if (input.hidden || input.style.display === "none") return null;
    return input;
  }
  function enhance(input) {
    if (!wants(input)) return;
    var after = anchorFor(input);
    if (!after || !after.parentNode) return;
    input.dataset.piclink = "1";
    var b = document.createElement("button");
    b.type = "button"; b.className = "pl-btn"; b.textContent = "🔗 Use a picture link";
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); open(input); });
    after.parentNode.insertBefore(b, after.nextSibling);
  }
  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.tagName === "INPUT") enhance(root);
    var list = root.querySelectorAll("input[type=file]");
    for (var i = 0; i < list.length; i++) enhance(list[i]);
  }

  function b64File(d) {
    var bin = atob(d.data), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var ext = (d.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    var name = /\.[a-z0-9]{2,5}$/i.test(d.name || "") ? d.name : (d.name || "picture") + "." + ext;
    return new File([arr], name, { type: d.type, lastModified: Date.now() });
  }
  function deliver(input, file) {
    try {
      var dt = new DataTransfer(); dt.items.add(file);
      input.files = dt.files;
    } catch (e) {
      // Very old browsers: hand the picture to the handler directly.
      var fake = { files: [file], value: "" };
      if (typeof input.onchange === "function") return input.onchange.call(fake, { target: fake });
      throw e;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function needFunctions() {
    if (window.firebase && firebase.functions) return Promise.resolve();
    if (!window.firebase || !firebase.SDK_VERSION) return Promise.reject(new Error("Still loading. Try again in a second."));
    var v = firebase.SDK_VERSION, major = parseInt(v, 10);
    return new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = "https://www.gstatic.com/firebasejs/" + v + "/firebase-functions" + (major >= 9 ? "-compat" : "") + ".js";
      s.onload = function () { ok(); }; s.onerror = function () { no(new Error("Couldn't load. Check your connection.")); };
      document.head.appendChild(s);
    });
  }
  function call(url) {
    return needFunctions().then(function () {
      var u = firebase.auth && firebase.auth().currentUser;
      if (!u) throw new Error("Sign in first, then paste the link.");
      return firebase.functions().httpsCallable("fetchPicture")({ url: url }).then(function (r) { return r.data; });
    });
  }
  function open(input) {
    addCss();
    var ov = document.createElement("div");
    ov.className = "pl-ov";
    ov.innerHTML = "<div class='pl-box' role='dialog' aria-label='Use a picture link'><h3>🔗 Use a picture link</h3>"
      + "<p>Find the picture online, then <b>long-press</b> it (phone) or <b>right-click</b> it (computer) and choose <b>Copy image address</b>. Paste it here.</p>"
      + "<input class='pl-in' type='url' inputmode='url' placeholder='https://…/picture.jpg' autocomplete='off'>"
      + "<img class='pl-pv' alt=''><div class='pl-err'></div>"
      + "<div class='pl-row'><button class='pl-no' type='button'>Cancel</button><button class='pl-go' type='button'>Use this picture</button></div></div>";
    document.body.appendChild(ov);
    var inp = ov.querySelector(".pl-in"), err = ov.querySelector(".pl-err"), go = ov.querySelector(".pl-go"), pv = ov.querySelector(".pl-pv");
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.querySelector(".pl-no").onclick = close;
    inp.addEventListener("input", function () {
      var v = inp.value.trim(); err.textContent = "";
      if (/^https?:\/\/\S+$/i.test(v)) { pv.onerror = function () { pv.style.display = "none"; }; pv.onload = function () { pv.style.display = "block"; }; pv.src = v; } else pv.style.display = "none";
    });
    var run = function () {
      var v = inp.value.trim();
      if (!/^https?:\/\/\S+$/i.test(v)) { err.textContent = "Paste a link that starts with https://"; return; }
      go.disabled = true; go.textContent = "Getting it…"; err.textContent = "";
      call(v).then(function (d) {
        deliver(input, b64File(d)); close();
      }, function (e) {
        go.disabled = false; go.textContent = "Use this picture";
        err.textContent = (e && e.message) || "Couldn't get that picture. Try another link.";
      });
    };
    go.onclick = run;
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });
    setTimeout(function () { inp.focus(); }, 30);
  }

  window.PicLink = { open: open, scan: scan };
  function start() {
    addCss(); scan(document.body);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) for (var j = 0; j < muts[i].addedNodes.length; j++) {
        var n = muts[i].addedNodes[j];
        if (n.nodeType === 1) scan(n);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
