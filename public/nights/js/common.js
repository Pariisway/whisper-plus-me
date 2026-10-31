// Shared Firebase setup and UI helpers for every ConnectUs page.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut, sendPasswordResetEmail, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { BRAND, firebaseConfig, FUNCTIONS_REGION, USE_EMULATORS, ADMIN_UIDS } from "./config.js";

/** Admin = the Whisper+me admin account (or anyone given the admin claim). */
export const isAdminToken = token => token.claims.admin === true || ADMIN_UIDS.includes(token.claims.user_id || token.claims.sub);

export { BRAND };
export const app = initializeApp(firebaseConfig);
if (!USE_EMULATORS) { try { initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider("6LcwcwkuAAAAAGGdo39hhjtGFmRME0D_FD5agtKP"), isTokenAutoRefreshEnabled: true }); } catch (e) { console.warn("App Check", e.message); } }
export const auth = getAuth(app);
export const db = getFirestore(app);
export const fns = getFunctions(app, FUNCTIONS_REGION);
export const storage = getStorage(app);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

/** Call a Cloud Function and return its data, turning errors into readable messages. */
export async function call(name, data = {}) {
  try {
    const res = await httpsCallable(fns, name)(data);
    return res.data;
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).replace(/^.*?:\s*/, "");
    throw new Error(msg || "Something went wrong. Try again.");
  }
}

/* ---------- auth helpers ---------- */
export const authApi = {
  onChange: cb => onAuthStateChanged(auth, cb),
  signIn: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
  signUp: (email, pw) => createUserWithEmailAndPassword(auth, email, pw),
  google: () => signInWithPopup(auth, new GoogleAuthProvider()),
  reset: email => sendPasswordResetEmail(auth, email),
  signOut: () => signOut(auth)
};
export function authErrorText(e) {
  const code = e && e.code || "";
  return ({
    "auth/invalid-credential": "That email and password don't match. Try again or reset your password.",
    "auth/wrong-password": "That email and password don't match. Try again or reset your password.",
    "auth/user-not-found": "No account uses that email yet. Create one instead.",
    "auth/email-already-in-use": "An account already uses that email. Sign in instead.",
    "auth/weak-password": "Use at least 6 characters for your password.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/popup-closed-by-user": "The Google window closed before you finished.",
    "auth/user-disabled": "This account is suspended. Contact support if you think that's a mistake."
  })[code] || (e && e.message) || "Couldn't sign in. Try again.";
}

/* ---------- formatting ---------- */
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** Money is stored in cents everywhere. */
export const money = cents => {
  const n = (cents || 0) / 100;
  return "$" + (Number.isInteger(n) ? n.toString() : n.toFixed(2));
};
export const toDate = v => v && typeof v.toDate === "function" ? v.toDate() : (v ? new Date(v) : null);
export function fmtWhen(v) {
  const d = toDate(v); if (!d || isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
export function ago(v) {
  const d = toDate(v); if (!d) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 172800) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
export function timeLeft(v) {
  const d = toDate(v); if (!d) return "";
  const m = Math.round((d.getTime() - Date.now()) / 60000);
  if (m <= 0) return "expired";
  if (m < 60) return m + "m left";
  return Math.round(m / 60) + "h left";
}
export const hueFrom = str => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const grad = h => `linear-gradient(135deg, hsl(${h} 55% 26%), hsl(${(h + 38) % 360} 60% 14%) 70%, hsl(${(h + 70) % 360} 50% 10%))`;
export const agrad = h => `linear-gradient(135deg, hsl(${h} 50% 40%), hsl(${(h + 50) % 360} 55% 28%))`;
export function avatar(user, size = "md", live = false) {
  const name = user?.name || "?";
  const inner = user?.photoURL ? `<img src="${esc(user.photoURL)}" alt="">` : esc(name[0].toUpperCase());
  return `<span class="avatar ${size}" style="background:${agrad(hueFrom(user?.id || name))}">${inner}${live ? '<span class="live" title="Out tonight"></span>' : ""}</span>`;
}
export const ageFrom = birthYear => birthYear ? new Date().getFullYear() - birthYear : "";

/* ---------- brand ---------- */
export function brandMark(sub = "") {
  return `${esc(BRAND.first)}<b>${esc(BRAND.second)}</b>${sub ? ` <small>${esc(sub)}</small>` : ""}`;
}
export function applyBrand(sub) {
  $$("[data-brand]").forEach(el => el.innerHTML = brandMark(sub));
  document.title = BRAND.name + (sub ? " · " + sub : "");
}

/* ---------- toast & sheets ---------- */
let toastTimer;
export function toast(msg) {
  clearTimeout(toastTimer);
  $$(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 3200);
}
export function openSheet(html, label = "Dialog") {
  let layer = $("#layer");
  if (!layer) { layer = document.createElement("div"); layer.id = "layer"; document.body.appendChild(layer); }
  layer.innerHTML = `<div class="overlay" data-sheet-dismiss><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div></div>`;
  const first = layer.querySelector("input,select,textarea,button:not(.close)");
  if (first) first.focus();
  return layer.querySelector(".sheet");
}
export function closeSheet() { const l = $("#layer"); if (l) l.innerHTML = ""; }
document.addEventListener("click", e => {
  const o = e.target.closest("[data-sheet-dismiss]");
  if (o && e.target === o) closeSheet();
  if (e.target.closest("[data-sheet-close]")) closeSheet();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

/** Show a busy state on a button while an async task runs. */
export async function busy(btn, fn) {
  if (!btn) return fn();
  const label = btn.innerHTML; btn.classList.add("busy"); btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>`;
  try { return await fn(); }
  finally { btn.classList.remove("busy"); btn.disabled = false; btn.innerHTML = label; }
}

/** In-page confirm (the browser confirm() is unreliable in some app views). */
export function confirmSheet({ title, body = "", yes = "Confirm", danger = false }) {
  return new Promise(resolve => {
    const sheet = openSheet(`<div class="sheet-body"><h3 class="display" style="font-size:30px">${esc(title)}</h3>${body ? `<p class="muted" style="margin:0">${body}</p>` : ""}
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><button class="btn ghost" data-ans="no">Cancel</button><button class="btn ${danger ? "" : "gold"}" data-ans="yes" ${danger ? 'style="border-color:var(--rose);color:var(--rose)"' : ""}>${esc(yes)}</button></div></div>`, title);
    sheet.addEventListener("click", e => {
      const b = e.target.closest("[data-ans]"); if (!b) return;
      closeSheet(); resolve(b.dataset.ans === "yes");
    });
  });
}

/* ---------- ticket card ---------- */
export function seatDots(size, filled = 0) {
  return `<span class="seat-dots">${Array.from({ length: size }, (_, i) => `<i class="${i < filled ? "on" : ""}"></i>`).join("")}</span>`;
}
export function posterHTML(t, extra = "") {
  const h = t.hue ?? hueFrom(t.title);
  const img = t.imageURL ? `<img class="ticket-img" src="${esc(t.imageURL)}" alt="">` : "";
  return `<div class="poster" style="background:${grad(h)}">${img}<div class="cat"><span>${esc(t.category || "")}</span><span>For ${t.size}</span></div><h3>${esc(t.title)}</h3>${extra}</div>`;
}
export function ticketCardHTML(t, { asButton = true } = {}) {
  const tag = asButton ? "button" : "div";
  const left = Math.max(0, (t.quantity || 0) - (t.sold || 0) - (t.held || 0));
  const [day, time] = fmtWhen(t.startsAt).split(" · ");
  return `<${tag} class="ticket" ${asButton ? `data-open="${esc(t.id)}"` : ""} aria-label="${esc(t.title)}, ${money(t.price)}">
    ${posterHTML(t)}
    <div class="perf"></div>
    <div class="ticket-body">
      <div class="venue-line"><strong>${esc(t.venueName || "")}</strong><span class="mono">${esc(day || "Date TBD")}</span></div>
      <div class="includes">${(t.items || []).slice(0, 3).map(i => `<span class="tag">${esc(i)}</span>`).join("")}${(t.items || []).length > 3 ? `<span class="tag">+${t.items.length - 3} more</span>` : ""}</div>
      <div class="ticket-foot">
        <div><div class="price">${money(t.price)}</div><div class="price-sub">or ${money(Math.ceil((t.price || 0) / (t.size || 2)))} each split</div></div>
        <div style="text-align:right"><div class="seats">${seatDots(t.size || 2)} ${t.size} seats</div><div class="price-sub">${left <= 3 ? `<span style="color:var(--rose)">${left} left</span>` : `${left} available`}${time ? " · " + esc(time) : ""}</div></div>
      </div>
    </div>
  </${tag}>`;
}

/** Simple sign-in card used by the venue and admin dashboards. */
export function renderSimpleAuth(container, { eyebrow, title, note = "" }) {
  let mode = "signin";
  const draw = () => {
    container.innerHTML = `<div class="auth"><form class="auth-card" id="sAuth" novalidate>
      <div><div class="eyebrow">${esc(eyebrow)}</div><h1 class="display" style="margin-top:8px">${esc(title)}</h1>${note ? `<p class="muted" style="margin:8px 0 0">${note}</p>` : ""}</div>
      <button type="button" class="btn block" id="sGoogle">Continue with Google</button>
      <div class="or">or</div>
      <div class="field"><label for="s-email">Email</label><input id="s-email" type="email" autocomplete="email"></div>
      <div class="field"><label for="s-pw">Password</label><input id="s-pw" type="password" autocomplete="${mode === "signin" ? "current-password" : "new-password"}"></div>
      <div id="sErr" class="note" style="border-left-color:var(--rose)" hidden></div>
      <button class="btn gold block" type="submit">${mode === "signin" ? "Sign in" : "Create account"}</button>
      <span class="muted" style="font-size:14px">${mode === "signin" ? "No account yet?" : "Have an account?"} <button type="button" class="linkish" id="sSwap">${mode === "signin" ? "Create one" : "Sign in"}</button></span>
    </form></div>`;
    const err = m => { const e = $("#sErr", container); e.hidden = false; e.textContent = m; };
    $("#sSwap", container).onclick = () => { mode = mode === "signin" ? "signup" : "signin"; draw(); };
    $("#sGoogle", container).onclick = () => authApi.google().catch(e => err(authErrorText(e)));
    $("#sAuth", container).onsubmit = async e => {
      e.preventDefault();
      const email = $("#s-email", container).value.trim(), pw = $("#s-pw", container).value;
      if (!email || pw.length < 6) return err("Enter your email and a password of at least 6 characters.");
      await busy(e.submitter, () => (mode === "signin" ? authApi.signIn(email, pw) : authApi.signUp(email, pw)).catch(x => err(authErrorText(x))));
    };
  };
  draw();
}
