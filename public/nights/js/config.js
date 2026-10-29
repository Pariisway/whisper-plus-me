// ===== Whisper+me Dates configuration (venue + admin pages) =====
// 1) Brand: change the name here and it updates the venue and admin pages.
export const BRAND = {
  name: "Whisper+Me M&G",
  first: "Whisper+me ",   // plain part of the logo
  second: "M&G",        // gold part of the logo
  tagline: "Good company, out on the town",
  city: "St. Louis & Metro East",
  supportEmail: "whisper.me.support@gmail.com"
};

// 2) Firebase: the same project as Whisper+me (from public/firebase.js),
//    so members use ONE account for live chat and nights out.
//    These web keys are meant to be public; the security rules protect the data.
export const firebaseConfig = {
  apiKey: "AIzaSyDRoFs07YoRd8EWlOKQQPz3XZxiy-GIzTE",
  authDomain: "whisperplusme-46d9c.firebaseapp.com",
  databaseURL: "https://whisperplusme-46d9c-default-rtdb.firebaseio.com",
  projectId: "whisperplusme-46d9c",
  storageBucket: "whisperplusme-46d9c.firebasestorage.app",
  messagingSenderId: "858087320089",
  appId: "1:858087320089:web:773c787b9f80075b0fd888"
};

// 3) Who can open /nights/admin — the same admin account as Whisper+me.
//    Keep in step with ADMIN_UIDS in functions-nights/index.js and firestore.rules.
export const ADMIN_UIDS = ["v6aIXY12MDY9ci1wWJmCiLOAKoG2"];

// 4) Cloud Functions region.
export const FUNCTIONS_REGION = "us-central1";

// Optional: set true while testing locally with `firebase emulators:start`.
export const USE_EMULATORS = false;
