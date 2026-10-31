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
   Paste your reCAPTCHA v3 SITE key below to turn it on (see docs/CHANGES.md → App Check).
   Turning it on only adds the proof; nothing is blocked until you press Enforce in
   the Firebase console, so it's safe to switch on first and watch the numbers. */
var APP_CHECK_SITE_KEY = "";
try { if (APP_CHECK_SITE_KEY && firebase.appCheck) firebase.appCheck().activate(APP_CHECK_SITE_KEY, true); } catch (e) { console.warn("App Check", e.message); }

console.log("🔥 Firebase Connected");
