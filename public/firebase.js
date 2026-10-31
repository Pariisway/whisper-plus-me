const firebaseConfig = {
  apiKey: "AIzaSyDRoFs07YoRd8EWlOKQQPz3XZxiy-GIzTE",
  authDomain: "whisperplusme-46d9c.firebaseapp.com",
  databaseURL: "https://whisperplusme-46d9c-default-rtdb.firebaseio.com",
  projectId: "whisperplusme-46d9c",
  storageBucket: "whisperplusme-46d9c.firebasestorage.app",
  messagingSenderId: "858087320089",
  appId: "1:858087320089:web:773c787b9f80075b0fd888"
};

firebase.initializeApp(firebaseConfig);

/* App Check (bot protection): proves requests come from the real site, not a script.
   Uses a reCAPTCHA Enterprise (Fraud Defense) key. Firebase 8 has no built-in Enterprise
   option, so this small provider does what the newer SDK does: get an invisible
   reCAPTCHA Enterprise token, then trade it with Firebase for an App Check token.
   Nothing is blocked until you press Enforce in the Firebase console. */
var APP_CHECK_SITE_KEY = "6LcwcwkuAAAAAGGdo39hhjtGFmRME0D_FD5agtKP";
(function () {
  if (!APP_CHECK_SITE_KEY || !firebase.appCheck || !window.fetch) return;
  var ready = null;
  function recaptcha() {
    if (ready) return ready;
    ready = new Promise(function (resolve, reject) {
      if (window.grecaptcha && grecaptcha.enterprise) return grecaptcha.enterprise.ready(function () { resolve(grecaptcha.enterprise); });
      var s = document.createElement("script");
      s.src = "https://www.google.com/recaptcha/enterprise.js?render=" + encodeURIComponent(APP_CHECK_SITE_KEY);
      s.async = true;
      s.onload = function () { grecaptcha.enterprise.ready(function () { resolve(grecaptcha.enterprise); }); };
      s.onerror = function () { ready = null; reject(new Error("reCAPTCHA didn't load")); };
      document.head.appendChild(s);
    });
    return ready;
  }
  function getToken() {
    return recaptcha().then(function (g) {
      return g.execute(APP_CHECK_SITE_KEY, { action: "fire_app_check" });
    }).then(function (rt) {
      var o = firebaseConfig;
      return fetch("https://content-firebaseappcheck.googleapis.com/v1/projects/" + o.projectId + "/apps/" + o.appId + ":exchangeRecaptchaEnterpriseToken?key=" + o.apiKey, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recaptcha_enterprise_token: rt })
      });
    }).then(function (r) {
      if (!r.ok) throw new Error("App Check exchange failed (" + r.status + ")");
      return r.json();
    }).then(function (b) {
      var ttl = parseFloat(String(b.ttl || "3600s")) * 1000;
      return { token: b.token, expireTimeMillis: Date.now() + ttl };
    });
  }
  try { firebase.appCheck().activate(new firebase.appCheck.CustomProvider({ getToken: getToken }), true); }
  catch (e) { console.warn("App Check", e.message); }
})();

console.log("🔥 Firebase Connected");
