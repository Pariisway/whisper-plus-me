"use strict";

/* ═══════════════════════════════════════════
   GLOBALS
═══════════════════════════════════════════ */
let currentUser   = null;
let mapInstance   = null;
let mapContainer  = null;
let mapMarkers    = {};
let screens       = ["phone","chat","map","dashboard","dates"]; /* "dates" = Whisper+me Dates (dates.js) */
let active        = 0;
let profiles      = [];

/* ── GUEST MODE ──
   Guests are signed in via Firebase Anonymous Auth. They can read/post
   in the chat room but everything else (Live Mic, Phone, Map, Dashboard)
   requires a real account. */
function isGuest(){ return !!(currentUser && currentUser.isAnonymous); }
window.isGuest = isGuest;

/* ── ROOM MODERATION ──
   Checks whether the current user moderates the active room, and
   listens for being blocked from it (moderators/admin can block via
   the profile modal). Re-checked on every room switch. */
var isModeratorOfActiveRoom = false;
var moderatorCheckToken = 0;
var roomBlockListenerRef = null, roomBlockListenerFn = null;

function checkModeratorStatus(roomId){
  var myToken = ++moderatorCheckToken;
  isModeratorOfActiveRoom = false;
  if(!currentUser || isGuest() || !roomId) return;
  firebase.database().ref("roomModerators/" + roomId + "/" + currentUser.uid).once("value")
    .then(function(snap){
      if(myToken !== moderatorCheckToken) return; /* room changed again before this resolved */
      isModeratorOfActiveRoom = !!snap.val();
      renderChatMessages(); /* re-render so delete buttons show/hide correctly */
    })
    .catch(function(){});
}

function watchOwnBlockStatus(roomId){
  if(roomBlockListenerRef && roomBlockListenerFn){
    try{ roomBlockListenerRef.off("value", roomBlockListenerFn); }catch(e){}
  }
  roomBlockListenerRef = null; roomBlockListenerFn = null;
  if(!currentUser || !roomId) return;
  roomBlockListenerRef = firebase.database().ref("roomBlocks/" + roomId + "/" + currentUser.uid);
  roomBlockListenerFn = roomBlockListenerRef.on("value", function(snap){
    if(snap.exists() && activeRoom === roomId){
      showToast("You were removed from this room by a moderator","warn",5000);
      window.switchRoom("general");
    }
  });
}

/* Called from the message list — moderators and the message's own
   author can delete it */
window.deleteChatMessage = function(msgKey){
  if(!currentUser || !msgKey) return;
  if(!confirm("Delete this message?")) return;
  firebase.database().ref("chat/" + activeRoom + "/" + msgKey).remove()
    .catch(function(e){ showToast("Couldn't delete: " + e.message, "error"); });
};

/* Called from the profile modal — moderators/admin only. Blocks the
   user from the CURRENT room: removes them live if they're in it right
   now, and stops them posting there again (enforced server-side too). */
window.removeUserFromRoom = function(targetUid, targetName){
  if(!isModeratorOfActiveRoom){ showToast("You're not a moderator of this room","warn"); return; }
  if(!confirm("Remove " + (targetName||"this user") + " from this room? They won't be able to post here again unless a moderator undoes it.")) return;
  firebase.database().ref("roomBlocks/" + activeRoom + "/" + targetUid).set({
    by: currentUser.uid,
    ts: firebase.database.ServerValue.TIMESTAMP
  }).then(function(){
    showToast("Removed " + (targetName||"user") + " from this room","success");
    if(window.closeProfileModal) window.closeProfileModal();
  }).catch(function(e){ showToast("Couldn't remove user: " + e.message, "error"); });
};

function guestDisplayName(){
  var g = sessionStorage.getItem("wpm_guest_name");
  if(!g){
    g = "Guest" + Math.floor(1000 + Math.random()*9000);
    sessionStorage.setItem("wpm_guest_name", g);
  }
  return g;
}

/* ── PRESENCE ──
   One lightweight path covers members AND guests: presence/{uid}.
   Used for (1) admin dashboard "guests online now" count and
   (2) red "someone's here" dot on room cards. onDisconnect() removes
   the record immediately when the tab closes or connection drops. */
var presenceRef = null;
function startPresence(uid, isAnon){
  try{
    presenceRef = firebase.database().ref("presence/" + uid);
    presenceRef.onDisconnect().remove();
    updatePresenceRoom(activeRoom || "general", isAnon);
  }catch(e){}
}
function updatePresenceRoom(roomId, isAnon){
  if(!presenceRef) return;
  presenceRef.set({
    room: roomId,
    isAnonymous: !!isAnon,
    ts: firebase.database.ServerValue.TIMESTAMP
  }).catch(function(){});
}

/* Opens a room from a shared deep link (?room=X). Preset rooms just
   switch normally. Member-created paid rooms ("mr_...") need the real
   paid-join flow instead — coin check, guest block, etc. — so this
   looks the room up first and routes accordingly. Guests can't join
   paid rooms at all, so they get a clear prompt instead of a dead end. */
function openDeepLinkRoom(roomId){
  if(!roomId) return;
  if(roomId.indexOf("mr_") !== 0){
    if(window.switchRoom) window.switchRoom(roomId);
    return;
  }
  if(isGuest()){
    promptGuestUpgrade("This paid room");
    return;
  }
  firebase.database().ref("memberRooms/" + roomId).once("value").then(function(snap){
    var data = snap.val();
    if(!data){
      showToast("That room isn't available anymore","warn");
      return;
    }
    window.joinMemberRoom(roomId, data.name || "Member Room", data.cost || 1);
  }).catch(function(){
    showToast("Couldn't load that room","warn");
  });
}

/* Opens the profile card for a shared profile link (?openProfile=uid).
   Works for guests too — showing the card doesn't require an account,
   only actually placing a call does (already gated elsewhere). */
function openDeepLinkProfile(uid){
  if(!uid) return;
  firebase.database().ref("users/" + uid).once("value").then(function(snap){
    var u = snap.val();
    if(!u){ showToast("That profile isn't available","warn"); return; }
    window.allUsers = window.allUsers || {};
    window.allUsers[uid] = u;
    if(window.showProfileModal) window.showProfileModal(uid);
  }).catch(function(){
    showToast("Couldn't load that profile","warn");
  });
}

/* Live "someone's in this room" dots — one listener drives every
   room card's dot without a full re-render. */
var roomPresenceCounts = {};
function watchRoomPresence(){
  firebase.database().ref("presence").on("value", function(snap){
    var counts = {};
    snap.forEach(function(c){
      var v = c.val();
      if(v && v.room) counts[v.room] = (counts[v.room] || 0) + 1;
    });
    roomPresenceCounts = counts;
    document.querySelectorAll(".room-live-badge").forEach(function(el){
      var roomId = el.getAttribute("data-room");
      var count  = counts[roomId] || 0;
      var card   = el.closest(".room-card");
      if(count > 0){
        el.style.display = "inline-flex";
        var dot = el.querySelector(".room-live-dot");
        el.innerHTML = "";
        if(dot) el.appendChild(dot); else {
          var d = document.createElement("span");
          d.className = "room-live-dot";
          el.appendChild(d);
        }
        el.appendChild(document.createTextNode(count));
        if(card) card.classList.add("room-live-now");
      } else {
        el.style.display = "none";
        if(card) card.classList.remove("room-live-now");
      }
    });
  });
}

window.__liveCallHTML = null;
window.__activeCallId = null;
window.__endedCalls   = {};
window.__callLocks    = { placing: false };

/* ── Member Room state ── */
window.__myRoomId       = null;   /* roomId creator is managing */
window.__myRoomClosed   = false;  /* true once creator clicked Close */
window.__inMemberRoom   = false;  /* fullscreen mode active */
window.__memberRoomBeforeUnload = null;

/* ── Live mic persist ── */
window.__liveMicRestored = false;

let agoraClient     = null;
let localAudioTrack = null;
let agoraJoined     = false;
let agoraJoining    = false;

/* ── Authenticated Agora token fetch helper ──
   FIX: generateAgoraToken now requires Firebase auth — pass Bearer token every call */
/* ── Agora (voice) now loads only when voice is actually used ──
   It's ~1 MB; loading it for every visitor slowed the landing page down.
   Signed-in members get it warmed up quietly a few seconds after load,
   so their first call/mic still starts instantly. */
var __agoraPromise = null;
function loadAgora(){
  if(window.AgoraRTC) return Promise.resolve(window.AgoraRTC);
  if(!__agoraPromise){
    __agoraPromise = new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = "https://download.agora.io/sdk/release/AgoraRTC_N.js";
      s.async = true;
      s.onload = function(){
        try{ AgoraRTC.setLogLevel(3); AgoraRTC.onError = function(e){ console.warn("AgoraRTC error:", e); }; }catch(e){}
        resolve(window.AgoraRTC);
      };
      s.onerror = function(){ __agoraPromise = null; reject(new Error("Voice couldn't load. Check your connection and try again.")); };
      document.head.appendChild(s);
    });
  }
  return __agoraPromise;
}
window.loadAgora = loadAgora;

async function fetchAgoraToken(channel) {
  if (!currentUser) throw new Error("Not logged in");
  var tok = await currentUser.getIdToken();
  var res = await fetch(CF_BASE + "/generateAgoraToken?channel=" + encodeURIComponent(channel) + "&uid=0", {
    headers: { "Authorization": "Bearer " + tok }
  });
  if (!res.ok) throw new Error("Token fetch failed");
  var data = await res.json();
  if (!data.token) throw new Error(data.error || "No token returned");
  return data.token;
}

/* ── Constants — non-secret client config ── */
const AGORA_APP_ID = "605c4549677d4f91b07bfb36df7cd30c";
const CF_BASE      = "https://us-central1-whisperplusme-46d9c.cloudfunctions.net";
const MAPBOX_TOKEN = "pk.eyJ1Ijoic3F1YXJlMXVwIiwiYSI6ImNtbmo1M3BtNjBqcGEycXB1bHowOTNleDEifQ.LVIsUsKb04_SkgZphxD3fg";

let chatMessages = [];
let chatListener = null;
let activeRoom = "general";
window.__getActiveRoom = function(){ return activeRoom; };

let liveMicClient = null, liveMicTrack = null, liveMicActive = false, liveMicTimer = null;
let liveMicAudienceClient = null, liveMicRoomListener = null;

var CHAT_ROOMS = [
  { id:"general",      label:"💬 General",           desc:"Everyone welcome — start here" },
  { id:"vent",         label:"🫂 Vent & Release",     desc:"Safe space to let it all out" },
  { id:"anxiety",      label:"🌿 Anxiety & Stress",   desc:"You are not alone here" },
  { id:"nightowls",    label:"🌙 Night Owls",         desc:"For those awake at 3am" },
  { id:"grief",        label:"🕊️ Grief & Loss",       desc:"Speak your truth, heal together" },
  { id:"mentalhealth", label:"💙 Mental Health",      desc:"No judgment, just support" },
  { id:"gangstalking", label:"🔍 Gang Stalking Help", desc:"Find support, share experiences" },
  { id:"voices",       label:"🎙️ Live Voices",        desc:"Hop on mic and be heard" },
  { id:"connection",   label:"🤝 Real Connection",    desc:"Meet genuine people" },
  { id:"creators",     label:"✨ Creators Lounge",    desc:"Build, share, inspire" },
  { id:"spicy",        label:"🌶️ Spicy",              desc:"18+ · Hot & steamy" },
  { id:"hotdates",     label:"🔥 Hot Dates",          desc:"18+ · Find a date tonight" },
  { id:"sugar",        label:"🍬 Sugar",              desc:"18+ · Sweet arrangements" },
  { id:"lgbt_safe",    label:"🏳️‍🌈 LGBTQ+ Safe Space", desc:"You belong here, always" },
  { id:"lgbt_chat",    label:"💜 Queer Connect",      desc:"LGBTQ+ community & friends" },
  { id:"lgbt_youth",   label:"🌈 Rainbow Youth",      desc:"Young LGBTQ+ voices welcome" },
  { id:"psychics",     label:"🔮 Psychic Circle",      desc:"Readings, insights & intuition" },
  { id:"astrology",    label:"⭐ Astrology Lounge",    desc:"Charts, signs & cosmic energy" },
  { id:"tarot",        label:"🃏 Tarot & Palm Reading", desc:"Cards, palms & divination" },
  { id:"apothecary",   label:"🌿 The Apothecary",      desc:"Herbs, remedies & natural healing" }
];
/* Pristine snapshot of the hardcoded defaults, used to rebuild CHAT_ROOMS
   from scratch on every live update (see loadPresetRoomsIntoApp below) —
   without this, repeated live-listener firings would cumulatively mutate
   CHAT_ROOMS and could duplicate or permanently lose entries. */
var DEFAULT_CHAT_ROOMS_BASE = CHAT_ROOMS.map(function(r){ return Object.assign({}, r); });


/* Load admin-created preset rooms from Firebase — called after auth resolves */
window.__presetRoomsLoaded = false;
function loadPresetRoomsIntoApp(){
  if(window.__presetRoomsLoaded) return;
  window.__presetRoomsLoaded = true;
  try {
    var latestPresetData  = null;
    var latestHiddenData  = null;
    var latestMemberOnly  = null;

    function rebuild(){
      /* Rebuild from the pristine baseline every time — makes this safe
         to call repeatedly from live listeners without duplicating or
         permanently dropping rooms. */
      var hiddenIds = {};
      if(latestHiddenData) {
        Object.keys(latestHiddenData).forEach(function(k){ if(latestHiddenData[k] === true) hiddenIds[k] = true; });
      }

      window.__roomMemberOnlyMap = latestMemberOnly || {};

      var rooms = DEFAULT_CHAT_ROOMS_BASE
        .filter(function(r){ return !hiddenIds[r.id]; })
        .map(function(r){ return Object.assign({}, r); });

      if(latestPresetData){
        var custom = Object.values(latestPresetData)
          .filter(function(r){ return !hiddenIds[r.id]; })
          .map(function(r){
            return {
              id: r.id,
              label: (r.emoji||"💬") + " " + r.label,
              desc: r.desc||"",
              photo: r.photo||"",
              displayMode: r.displayMode||"photo",
              order: (r.order != null) ? r.order : 99
            };
          });
        /* DB entries OVERRIDE hardcoded defaults with the same id (so
           editing "general" in the admin panel actually changes what
           everyone sees) — only truly new ids get appended. */
        custom.forEach(function(r){
          var idx = rooms.findIndex(function(c){ return c.id === r.id; });
          if(idx > -1) rooms[idx] = r;
          else rooms.push(r);
        });
      }

      /* Re-sort by order so admin-set ordering actually takes effect, not
         just append-to-end. Rooms with no order (untouched hardcoded
         defaults) keep their original relative position via stable sort
         + original-index fallback. */
      var withIndex = rooms.map(function(r, i){ return { r:r, i:i }; });
      withIndex.sort(function(a,b){
        var oa = (a.r.order != null) ? a.r.order : a.i;
        var ob = (b.r.order != null) ? b.r.order : b.i;
        return oa - ob;
      });
      CHAT_ROOMS = withIndex.map(function(x){ return x.r; });
      /* Room list only shows on the Chat screen — don't redraw (and wipe
         whatever someone is typing) on other screens. */
      if(typeof render === "function" && currentUser && active === 1 && !window.__liveCallHTML) render();
    }

    /* Live listeners — new/edited/deleted rooms and member-only toggles
       now reach everyone already using the app, not just people who
       load the page after the change. */
    firebase.database().ref("presetRooms").on("value", function(snap){
      latestPresetData = snap.val();
      rebuild();
    }, function(){ /* silently ignore permission errors */ });

    firebase.database().ref("hiddenPresetRooms").on("value", function(snap){
      latestHiddenData = snap.val();
      rebuild();
    }, function(){ /* silently ignore permission errors */ });

    firebase.database().ref("roomMemberOnly").on("value", function(snap){
      latestMemberOnly = snap.val();
      rebuild();
    }, function(){ /* silently ignore permission errors */ });
  } catch(e) {}
}

function isRoomMemberOnly(roomId){
  if(!window.__roomMemberOnlyMap) return true; /* not loaded yet — fail safe/restrictive */
  var v = window.__roomMemberOnlyMap[roomId];
  return v !== false; /* default true unless explicitly set false — matches backend */
}

/* FIX: the check above depends on a cached map that's populated by the
   listener below — but that listener attaches at script load time, before
   a fresh guest's anonymous sign-in has necessarily completed, so a brand
   new visitor clicking the mic quickly could read the map before it's
   ever loaded and get the fail-safe "true" (member-only) even when the
   room is actually open. This does one direct, guaranteed-fresh read of
   just that room's value, so it's never dependent on the cache's timing. */
async function checkRoomMemberOnlyFresh(roomId){
  try {
    var snap = await firebase.database().ref("roomMemberOnly/" + roomId).once("value");
    return snap.exists() ? snap.val() !== false : true; /* default true if never set */
  } catch(e) {
    return true; /* can't verify — fail safe/restrictive rather than silently open the door */
  }
}


/* ═══════════════════════════════════════════
   DYNAMIC NOTIFICATIONS — replaces all alert/confirm
═══════════════════════════════════════════ */
(function(){
  /* inject styles once */
  var style = document.createElement("style");
  style.textContent = [
    "#wpm-toast-container{position:fixed;top:18px;left:50%;transform:translateX(-50%);",
    "z-index:99999;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;width:90%;max-width:360px;}",
    ".wpm-toast{background:#1a1a2e;color:#fff;border-radius:14px;padding:13px 18px;",
    "font-size:13px;line-height:1.45;box-shadow:0 4px 24px rgba(0,0,0,.55);",
    "border:1px solid rgba(123,47,247,.35);pointer-events:none;",
    "animation:wpmToastIn .22s ease;opacity:1;transition:opacity .3s;}",
    ".wpm-toast.wpm-success{border-color:rgba(0,227,174,.4);}",
    ".wpm-toast.wpm-error{border-color:rgba(229,57,53,.45);}",
    ".wpm-toast.wpm-warn{border-color:rgba(255,180,0,.4);}",
    "@keyframes wpmToastIn{from{opacity:0;transform:translateY(-10px);}to{opacity:1;transform:translateY(0);}}",
    "#wpm-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99998;",
    "display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;}",
    "#wpm-confirm-box{background:#0f0f1a;border:1px solid rgba(123,47,247,.4);border-radius:18px;",
    "padding:26px 22px 20px;max-width:320px;width:100%;text-align:center;color:#fff;}",
    "#wpm-confirm-box .wpm-confirm-msg{font-size:15px;font-weight:600;margin-bottom:18px;line-height:1.4;}",
    "#wpm-confirm-box .wpm-confirm-btns{display:flex;gap:10px;}",
    "#wpm-confirm-box button{flex:1;padding:12px;border-radius:14px;border:none;font-size:14px;",
    "font-weight:700;cursor:pointer;min-height:44px;}",
    "#wpm-confirm-ok{background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff;}",
    "#wpm-confirm-cancel{background:#1e1e2a;color:#aaa;border:1px solid rgba(255,255,255,0.1);}"
  ].join("");
  document.head.appendChild(style);

  /* toast container */
  var tc = document.createElement("div");
  tc.id = "wpm-toast-container";
  document.body.appendChild(tc);
})();

window.showToast = function(msg, type, duration){
  /* type: "success" | "error" | "warn" | "" */
  var tc = document.getElementById("wpm-toast-container");
  if(!tc) return;
  var t = document.createElement("div");
  t.className = "wpm-toast" + (type ? " wpm-" + type : "");
  var icon = type === "success" ? "✅ " : type === "error" ? "❌ " : type === "warn" ? "⚠️ " : "ℹ️ ";
  t.textContent = icon + msg;
  tc.appendChild(t);
  var ms = duration || (msg.length > 60 ? 4500 : 3000);
  setTimeout(function(){
    t.style.opacity = "0";
    setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); }, 320);
  }, ms);
};

window.showConfirm = function(msg, onOk, onCancel){
  var existing = document.getElementById("wpm-confirm-overlay");
  if(existing) existing.parentNode.removeChild(existing);
  var ov = document.createElement("div");
  ov.id = "wpm-confirm-overlay";
  ov.innerHTML = "<div id='wpm-confirm-box'>"
    + "<div class='wpm-confirm-msg'>" + msg + "</div>"
    + "<div class='wpm-confirm-btns'>"
    + "<button id='wpm-confirm-cancel'>Cancel</button>"
    + "<button id='wpm-confirm-ok'>Confirm</button>"
    + "</div></div>";
  document.body.appendChild(ov);
  function close(){ if(ov.parentNode) ov.parentNode.removeChild(ov); }
  document.getElementById("wpm-confirm-ok").onclick = function(){ close(); if(onOk) onOk(); };
  document.getElementById("wpm-confirm-cancel").onclick = function(){ close(); if(onCancel) onCancel(); };
  ov.onclick = function(e){ if(e.target === ov){ close(); if(onCancel) onCancel(); } };
};

/* ═══════════════════════════════════════════
   UTILS
═══════════════════════════════════════════ */
function sanitize(str){
  return String(str||"")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
/* A JS string argument for an inline handler: onclick="fn(" + jsAttr(x) + ")".
   Safe for names with quotes, backslashes or HTML in them. */
function jsAttr(str){ return sanitize(JSON.stringify(String(str == null ? "" : str))); }
/* Only http(s) links from members; anything else (javascript:, data:) is dropped. */
function safeUrl(u, prefix){
  u = String(u || "").trim();
  if(!u) return "";
  if(!/^https?:\/\//i.test(u)) u = (prefix || "https://") + u.replace(/^@/, "");
  try{ var x = new URL(u); if(x.protocol !== "http:" && x.protocol !== "https:") return ""; return x.href; }catch(e){ return ""; }
}
window.jsAttr = jsAttr; window.safeUrl = safeUrl;

function timeAgo(ts){
  var d = Date.now() - ts;
  if(d < 60000)    return "just now";
  if(d < 3600000)  return Math.floor(d/60000)+"m ago";
  if(d < 86400000) return Math.floor(d/3600000)+"h ago";
  return Math.floor(d/86400000)+"d ago";
}

function scrollToTop(){
  window.scrollTo({ top:0, behavior:"smooth" });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

/* ═══════════════════════════════════════════
   HEADER / FOOTER
═══════════════════════════════════════════ */
function renderHeader(){
  var el = document.getElementById("header");
  if(el) el.innerHTML = "<img src='/header-icon.png' alt='' "
    + "style='height:34px;width:34px;vertical-align:middle;margin-right:10px;"
    + "border-radius:50%;box-shadow:0 0 10px rgba(0,227,174,0.35);'>"
    + "<span class='hdr-word'>Whisper</span><span class='hdr-plus'>+</span><span class='hdr-word'>Me</span>";
  var ft = document.getElementById("footer");
  if(ft) ft.innerHTML = "● SYSTEM ACTIVE ●";
}

/* ═══════════════════════════════════════════
   LOGIN PAGE
═══════════════════════════════════════════ */
function renderLoginPage(){
  /* The live landing page (video / picture / color background, social
     sign-in) lives in landing.js and is configured in Admin → Landing. */
  if(window.Landing) return window.Landing.html();
  return "<div style='min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#fff;padding:24px'>"
    + "<h1 style='margin:0'>Whisper+Me</h1>"
    + "<button onclick='signInWithGoogle()' style='padding:14px 22px;border-radius:999px;border:0;font-weight:800'>Continue with Google</button>"
    + "<button onclick='enterAsGuest()' id='lp-guest-btn' style='background:none;border:0;color:#ccc'>Peek inside →</button></div>";
}
/* ── Landing page helpers ── */
window.lpForgotPassword = function(){
  var email = (document.getElementById("email")||{}).value || "";
  if(!email){ showToast("Enter your email first then tap forgot password","warn"); return; }
  firebase.auth().sendPasswordResetEmail(email)
    .then(function(){ showToast("Reset email sent! Check your inbox ✉️","success",5000); })
    .catch(function(e){ showToast(e.message,"error"); });
};

/* Old helpers kept as aliases so older links/buttons still work. */
window.lpSubmit = function(){ if(window.Landing) window.Landing.submit(); };
window.lpScrollToAuth = function(){
  var el = document.getElementById("lp-auth");
  if(el) el.scrollIntoView({behavior:"smooth"});
};

/* Optional profile photo step — shown between form validation and actual
   account creation. Skipping just proceeds with no photo, same as before. */
window.showSignupPhotoStep = function(){
  var modal = document.getElementById("profileModal");
  var body  = document.getElementById("profileModalBody");
  if(!modal || !body){ doSignUp(); return; } /* safety fallback */

  body.innerHTML = "<div style='padding:26px 20px;text-align:center'>"
    + "<div style='font-size:19px;font-weight:800;color:#fff;margin-bottom:6px'>Almost there 🎉</div>"
    + "<div style='font-size:12.5px;color:#999;margin-bottom:16px;line-height:1.5'>Pick the name people will see. A photo is optional, but profiles with one get far more calls.</div>"
    + "<input id='signupName' maxlength='40' placeholder='Display name' autocomplete='nickname' value='" + sanitize(window.__pendingDisplayName || ((document.getElementById("email")||{}).value||"").split("@")[0].slice(0,40)) + "' "
    + "style='width:100%;margin:0 0 16px;padding:13px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.18);background:#0f0d19;color:#fff;font-size:16px;box-sizing:border-box'>"
    + "<img id='signupPhotoPreview' style='display:none;width:100px;height:100px;border-radius:50%;"
    + "object-fit:cover;margin:0 auto 16px;border:2px solid #7b2ff7;box-shadow:0 0 20px rgba(123,47,247,0.4);'>"
    + "<label for='signupPhotoInput' style='display:block;padding:14px;margin-bottom:18px;"
    + "border:1.5px dashed rgba(123,47,247,0.5);border-radius:14px;color:#c9a8ff;font-size:13px;cursor:pointer;'>"
    + "📷 Tap to choose a photo</label>"
    + "<input type='file' id='signupPhotoInput' accept='image/*' style='display:none'>"
    + "<button onclick='completeSignupWithPhoto()' style='width:100%;padding:14px;border:none;border-radius:20px;"
    + "background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff;font-size:14px;font-weight:800;"
    + "cursor:pointer;margin-bottom:12px;'>Create Account</button>"
    + "<a href='#' onclick='document.getElementById(\"signupPhotoInput\").value=\"\";completeSignupWithPhoto();return false;' "
    + "style='font-size:12px;color:#777;text-decoration:underline;'>Skip for now</a>"
    + "</div>";
  modal.style.display = "flex";

  setTimeout(function(){
    var input = document.getElementById("signupPhotoInput");
    if(!input) return;
    input.onchange = function(){
      var f = input.files && input.files[0];
      if(!f) return;
      var reader = new FileReader();
      reader.onload = function(e){
        var img = document.getElementById("signupPhotoPreview");
        if(img){ img.src = e.target.result; img.style.display = "inline-block"; }
      };
      reader.readAsDataURL(f);
    };
  }, 0);
};

/* Called by both the "Create Account" button and "Skip for now" link */
window.completeSignupWithPhoto = function(){
  var nm = ((document.getElementById("signupName")||{}).value||"").trim();
  if(!nm){ showToast("Pick a display name","warn"); var f = document.getElementById("signupName"); if(f) f.focus(); return; }
  window.__pendingDisplayName = nm;
  var input = document.getElementById("signupPhotoInput");
  window.__pendingSignupPhotoFile = (input && input.files && input.files[0]) || null;
  if(window.closeProfileModal) window.closeProfileModal();
  doSignUp();
};

/* ── GUEST ENTRY ── */
window.enterAsGuest = function(){
  var btn = document.getElementById("lp-guest-btn");
  if(btn){ btn.disabled = true; btn.style.opacity = "0.6"; }
  firebase.auth().signInAnonymously().catch(function(e){
    if(btn){ btn.disabled = false; btn.style.opacity = "1"; }
    if(e && e.code === "auth/operation-not-allowed"){
      showToast("Guest chat isn't enabled yet — contact support","error");
    } else {
      showToast("Could not start guest session: " + e.message,"error");
    }
  });
};

/* Prompt shown when a guest taps a members-only feature */
window.promptGuestUpgrade = function(feature){
  var modal = document.getElementById("profileModal");
  var body  = document.getElementById("profileModalBody");
  if(!modal || !body){ showToast("Create a free account to unlock this","warn"); return; }
  body.innerHTML = "<div style='text-align:center;padding:32px 20px;'>"
    + "<div style='font-size:42px;margin-bottom:8px;'>🔒</div>"
    + "<div style='font-size:17px;font-weight:700;color:#fff;margin-bottom:6px;'>Create a Free Account</div>"
    + "<div style='font-size:13px;color:#aaa;margin-bottom:20px;line-height:1.5;'>"
    + sanitize(feature || "This feature") + " is for registered members. Signing up is free and takes seconds.</div>"
    + "<button onclick='exitGuestToSignup()' "
      + "style='width:100%;padding:14px;border-radius:22px;border:none;"
      + "background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff;font-size:15px;"
      + "font-weight:700;cursor:pointer;min-height:48px;margin-bottom:8px;'>Sign Up Free</button>"
    + "<button onclick='window.closeProfileModal()' "
      + "style='width:100%;padding:10px;border-radius:20px;border:1px solid rgba(255,255,255,0.15);"
      + "background:transparent;color:#aaa;font-size:13px;cursor:pointer;min-height:40px;'>Keep Chatting as Guest</button>"
    + "</div>";
  modal.style.display = "flex";
};

/* Leaves the anonymous guest session and drops the visitor on the Sign Up tab */
window.exitGuestToSignup = function(){
  if(window.closeProfileModal) window.closeProfileModal();
  window.__goSignupAfterSignout = true;
  firebase.auth().signOut();
};

/* ═══════════════════════════════════════════
   STAGE HELPERS
═══════════════════════════════════════════ */
function getClass(i){
  /* Legacy — only used by setPhoneCallUI which targets .phone.center */
  if(i === active) return "phone center";
  return "phone phone-hidden-screen";
}

/* Content rendered INSIDE each phone panel — all solid backgrounds */
function deviceContent(type, i){
  /* Live call always wins the center slot */
  if(type === "phone" && i === active && window.__liveCallHTML)
    return window.__liveCallHTML;

  if(type === "phone"){
    var pList = Object.entries(window.allUsers||{}).filter(function(e){
      return e[0] !== (currentUser ? currentUser.uid : "") && !(window.__myBlocks||{})[e[0]];
    });
    var pIdx = window.__phoneIdx || 0;
    if(pIdx >= pList.length) pIdx = 0;
    var pEnt  = pList[pIdx] || null;
    var pp    = pEnt ? pEnt[1] : {};
    var ppUid = pEnt ? pEnt[0] : "";
    var ppPh  = sanitize(pp.photo || "https://dummyimage.com/400x700/111/333&text=W%2BMe");
    var ppNm  = sanitize(pp.name  || "Whisper+Me");
    var ppPr  = pp.price || 1;
    return "<div class='phone-profile-wrap'>"
      + "<img class='profile-bg' src='" + ppPh + "' "
      + "onerror=\"this.src='https://dummyimage.com/400x700/111/333&text=W'\" "
      + "alt='" + ppNm + "'>"
      + "<div class='phone-profile-overlay'></div>"
      + "<div class='phone-profile-info'>"
      + "<div class='phone-profile-name'>" + ppNm + "</div>"
      + "<div class='phone-profile-price'>" + ppPr + " coin" + (ppPr > 1 ? "s" : "") + " · $" + (ppPr*3) + "/call</div>"
      + "<div class='phone-profile-actions'>"
      + "<button class='phone-nav-btn' onclick='event.stopPropagation();phoneNav(-1)' "
          + "aria-label='Previous'>‹</button>"
      + (ppUid ? "<button class='phone-call-btn' data-uid='" + ppUid + "' "
          + "onclick='event.stopPropagation();startCallFromBtn(this)'>📞 Call</button>" : "")
      + "<button class='phone-nav-btn' onclick='event.stopPropagation();phoneNav(1)' "
          + "aria-label='Next'>›</button>"
      + "</div></div></div>";
  }

  if(type === "chat"){
    var rm = CHAT_ROOMS.find(function(r){ return r.id === activeRoom; }) || CHAT_ROOMS[8];
    var liveBtnHtml = liveMicActive
      ? "<span id='liveMicHeaderBar' style='display:flex;align-items:center;gap:6px'>"
        + "<span style='font-size:11px;color:#00e3ae;font-weight:700'>&#128308; LIVE</span>"
        + "<span id='liveMicHeaderTimer' style='font-size:11px;color:#fff;font-weight:600'>3:00</span>"
        + "<button onclick='endLiveMic()' style='background:#e53935;border:none;color:#fff;"
        + "border-radius:8px;padding:4px 9px;font-size:11px;cursor:pointer;min-height:28px;font-weight:700'>End</button></span>"
      : "<button onclick='showLiveMicPanel()' style='background:rgba(123,47,247,.45);border:none;"
        + "color:#fff;border-radius:10px;padding:5px 10px;font-size:11px;cursor:pointer;min-height:32px'>&#127908; Live</button>";
    return "<div class='phone-chat-wrap' id='phoneChatWrap'>"
      + "<div class='phone-chat-header'>"
      + "<span id='phoneChatRoomName'>" + sanitize(rm.label) + "</span>"
      + liveBtnHtml
      + "</div>"
      + "<div id='liveMicBar' class='live-mic-bar'></div>"
      + "<div class='phone-chat-msgs' id='phoneChatMsgs'>"
      + "<p style='text-align:center;color:#444;font-size:12px;padding:20px;'>Loading…</p>"
      + "</div></div>";
  }

  if(type === "dates"){
    return window.Dates ? window.Dates.phoneHTML() : "<div id='datesPhone' class='dt-phone'></div>";
  }

  if(type === "map"){
    return "<div id='mapMount' style='width:100%;height:100%;border-radius:inherit;overflow:hidden;'></div>";
  }

  if(type === "dashboard"){
    return window.Profile ? window.Profile.phoneHTML() : "";
  }
  return "";
}

/* Circular distance from i to active, normalized to the shortest signed
   offset for a ring of `len` screens — e.g. with 4 screens, dashboard(3)
   sits one step LEFT of phone(0) rather than three steps right. */
/* Order the screens appear in (menu, swipes, carousel). The numbers are the
   screen ids used everywhere else: 0 Phone, 1 Chat, 2 Map, 3 Profile, 4 Dates.
   Dates sits between Chat and Map. */
var SCREEN_ORDER = [0, 1, 4, 2, 3];
function screenPos(i){ var p = SCREEN_ORDER.indexOf(i); return p < 0 ? i : p; }
function carouselOffset(i, activeIdx, len){
  var raw = screenPos(i) - screenPos(activeIdx);
  if(raw > len/2)  raw -= len;
  if(raw < -len/2) raw += len;
  return raw;
}

/* Returns the inline style string for a shell at a given carousel offset.
   Uses !important so it reliably wins over legacy .phone-shell /
   .phone-shell-visible / mobile-media-query rules elsewhere in the
   stylesheet, regardless of selector specificity. */
function carouselShellStyle(offset){
  var mobile = window.innerWidth <= 768;

  if(mobile){
    /* Original mobile behavior: exactly one screen shown at a time,
       no 3D tilt, no peeking neighbors — swipe/tap still switches via
       setActive(), this just controls what's visible. */
    if(offset === 0){
      return "display:flex!important;position:relative!important;"
        + "transform:none!important;opacity:1!important;"
        + "z-index:1!important;pointer-events:auto!important;";
    }
    return "display:none!important;";
  }

  var table = {
    "0":  { x:-50,  z:0,    ry:0,   s:1.00, op:1,    zi:5, pe:"auto" },
    "-1": { x:-118, z:-140, ry:30,  s:0.78, op:0.5,  zi:3, pe:"auto" },
    "1":  { x:18,   z:-140, ry:-30, s:0.78, op:0.5,  zi:3, pe:"auto" },
    "-2": { x:-170, z:-280, ry:42,  s:0.6,  op:0,    zi:1, pe:"none" },
    "2":  { x:70,   z:-280, ry:-42, s:0.6,  op:0,    zi:1, pe:"none" }
  };
  var c = table[String(offset)] || table["0"];
  var transform = "translateX(" + c.x + "%) translateZ(" + c.z + "px) "
    + "rotateY(" + c.ry + "deg) scale(" + c.s + ")";
  return "display:flex!important;position:absolute!important;top:28px!important;left:50%!important;"
    + "margin:0!important;transform:" + transform + "!important;"
    + "opacity:" + c.op + "!important;z-index:" + c.zi + "!important;"
    + "pointer-events:" + c.pe + "!important;"
    + "transition:transform .5s cubic-bezier(.22,.9,.32,1),opacity .45s ease!important;";
}

function renderStage(){
  var len = screens.length;
  return "<div class='stage stage-carousel' id='mainStage' style='perspective:1500px;'>"
    + screens.map(function(s,i){
        var visible = (i === active);
        var offset  = carouselOffset(i, active, len);
        var posCls  = offset === 0  ? "carousel-center"
                    : offset === -1 ? "carousel-left"
                    : offset === 1  ? "carousel-right"
                    : offset < 0    ? "carousel-far-left"
                    : "carousel-far-right";
        var shellCls = "phone-shell " + posCls + (visible ? " phone-shell-visible" : "");
        var peekLabels = { phone:"Phone", chat:"Chat", map:"Map", dashboard:"Profile", dates:"M&G" };
        var innerPE = visible ? "" : "pointer-events:none!important;";
        return "<div class='" + shellCls + "' id='phone-shell-" + i + "' "
          + "data-peek-label='" + (peekLabels[s] || "") + "' "
          + "style='" + carouselShellStyle(offset) + "' "
          + "onclick='if(" + i + "!==active)window.setActive(" + i + ")'>"
          + "<div class='phone-notch'>"
          + "<div class='phone-notch-speaker'></div>"
          + "<div class='phone-notch-cam'></div>"
          + "</div>"
          + "<div class='phone-edge-left'></div>"
          + "<div class='phone-edge-right'></div>"
          + "<div class='phone-btn phone-btn-vol-up'></div>"
          + "<div class='phone-btn phone-btn-vol-dn'></div>"
          + "<div class='phone-btn phone-btn-power'></div>"
          + "<div class='phone phone-visible' id='phone-screen-" + i + "' data-screen='" + i + "' style='" + innerPE + "'>"
          + deviceContent(s,i)
          + "</div>"
          + "<div class='phone-home-bar'></div>"
          + "</div>";
      }).join("")
    + "</div>";
}

function renderMenu(){
  var icons  = ["📱","💬","🗺️","👤","⭐"];
  var labels = ["Phone","Chat","Map","Profile","M&G"];
  var guest  = isGuest();
  return "<div class='menu' role='tablist' aria-label='Navigation'>"
    + SCREEN_ORDER.map(function(i){
        var locked = guest && i !== 1 && i !== 4; /* guests can chat and browse M&Gs */
        return "<div role='tab' tabindex='0' "
          + "class='menu-item " + (active===i ? "menu-active" : "") + (locked ? " menu-locked" : "") + "' "
          + "onclick='setActive(" + i + ")' "
          + "onkeydown='if(event.key===\"Enter\"||event.key===\" \")setActive(" + i + ")' "
          + "aria-label='" + labels[i] + (locked ? " \u2014 sign up required" : "") + "' "
          + "aria-selected='" + (active===i) + "'>"
          + "<span class='menu-icon'>" + icons[i] + "</span>"
          + "<span class='menu-label'>" + labels[i] + (locked ? " \ud83d\udd12" : "") + "</span>"
          + "</div>";
      }).join("")
    + "</div>";
}

/* ═══════════════════════════════════════════
   CONTENT PANEL (below phone + menu)
═══════════════════════════════════════════ */
/* ══ SHARE SHEET ══ */
function openShareSheet(title, text, url, embedId, embedType){
  embedType = embedType || "room";
  var full = text + "\n" + url;
  if(navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)){
    navigator.share({ title:title, text:text, url:url }).catch(function(){});
    return;
  }
  var modal = document.getElementById("profileModal");
  var body  = document.getElementById("profileModalBody");
  if(!modal || !body) return;
  var enc  = encodeURIComponent(url);
  var encF = encodeURIComponent(full);
  var encT = encodeURIComponent(title + "\n" + text);
  var platforms = [
    { icon:"&#120143;", label:"X / Twitter", href:"https://twitter.com/intent/tweet?text="+encT+"&url="+enc },
    { icon:"&#128172;", label:"WhatsApp",    href:"https://wa.me/?text="+encF },
    { icon:"&#128216;", label:"Facebook",    href:"https://www.facebook.com/sharer/sharer.php?u="+enc },
    { icon:"&#128231;", label:"Email",       href:"mailto:?subject="+encodeURIComponent(title)+"&body="+encF },
    { icon:"&#128992;", label:"Reddit",      href:"https://reddit.com/submit?url="+enc+"&title="+encodeURIComponent(title) },
    { icon:"&#128188;", label:"LinkedIn",    href:"https://www.linkedin.com/sharing/share-offsite/?url="+enc }
  ];
  var btns = platforms.map(function(p){
    return "<a href='"+p.href+"' target='_blank' rel='noopener' onclick='window.closeProfileModal()' "
      + "style='display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:12px;"
      + "background:#1a1a2e;color:#fff;text-decoration:none;font-size:14px;font-weight:600;' "
      + "onmouseover=\"this.style.background='#2a1a4e'\""
      + " onmouseout=\"this.style.background='#1a1a2e'\">"
      + "<span style='font-size:18px;width:24px;text-align:center'>"+p.icon+"</span>"+p.label+"</a>";
  }).join("");
  window.__shareCopyText = full;
  body.innerHTML = "<div style='padding:20px'>"
    + "<div style='font-size:17px;font-weight:800;color:#fff;margin-bottom:2px'>"+title+"</div>"
    + "<div style='font-size:11px;color:#666;margin-bottom:14px;word-break:break-all'>"+url+"</div>"
    + "<div style='display:flex;flex-direction:column;gap:7px;margin-bottom:14px'>"+btns+"</div>"
    + "<button id='shareCopyBtn' style='width:100%;padding:13px;border-radius:20px;"
    + "border:2px solid #7b2ff7;background:transparent;color:#7b2ff7;"
    + "font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px;'>&#128203; Copy Link + Message</button>"
    + (embedId
        ? "<button onclick=\"showEmbedCode('" + embedId + "','" + embedType + "')\" style='width:100%;padding:13px;border-radius:20px;"
          + "border:1px solid rgba(255,255,255,0.15);background:transparent;color:#aaa;"
          + "font-size:13px;font-weight:600;cursor:pointer;'>&#60;/&#62; Embed on My Website</button>"
        : "")
    + "</div>";
  modal.style.display = "flex";
  setTimeout(function(){
    var btn = document.getElementById("shareCopyBtn");
    if(!btn) return;
    btn.onclick = function(){
      var txt = window.__shareCopyText || url;
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(txt).then(function(){
          showToast("Copied! Paste it anywhere \ud83d\udd17","success");
          window.closeProfileModal();
        }).catch(function(){ _fallbackCopy(txt); });
      } else { _fallbackCopy(txt); }
    };
  }, 0);
}
function _fallbackCopy(txt){
  var ta = document.createElement("textarea");
  ta.value = txt;
  ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;";
  document.body.appendChild(ta); ta.focus(); ta.select();
  try{ document.execCommand("copy"); showToast("Copied! Paste it anywhere \ud83d\udd17","success"); }
  catch(e){ showToast("Copy failed — select link manually","warn"); }
  document.body.removeChild(ta);
  window.closeProfileModal();
}
window.shareRoom = function(roomId, label, desc){
  var shareUrl = "https://whisperplusme.com/live?room=" + encodeURIComponent(roomId);
  var count = roomPresenceCounts[roomId] || 0;
  var text = label + " — " + desc
    + (count > 0
        ? "\n\ud83d\udd34 " + count + " " + (count === 1 ? "person is" : "people are") + " talking here right now."
        : "\n\ud83c\udf99\ufe0f Anonymous voice chat \u2014 tap in and see who shows up.");
  openShareSheet("Whisper+Me \xb7 " + label, text, shareUrl, roomId, "room");
};

/* Share a specific paid member-created room. Unlike free preset rooms,
   this deep-links straight to that room (?room=mr_...) and routes
   through the real paid-join flow — coin check, guest block, etc. —
   handled by openDeepLinkRoom() when the link is opened. */
window.shareMemberRoom = function(roomId, roomName, cost){
  var shareUrl = "https://whisperplusme.com/?room=" + encodeURIComponent(roomId);
  var text = "🎙️ " + roomName + " — join my live room on Whisper+Me."
    + " " + cost + " coin" + (cost > 1 ? "s" : "") + " ($" + (cost*3) + ") to enter.";
  openShareSheet("Whisper+Me \xb7 " + roomName, text, shareUrl);
};

/* Show the <iframe> embed snippet for a room — for blogs, Linktree, personal sites */
window.showEmbedCode = function(embedId, embedType){
  embedType = embedType || "room";
  var embedUrl, heading, blurb, height;
  if(embedType === "profile"){
    embedUrl = "https://whisperplusme.com/profile-embed.html?uid=" + encodeURIComponent(embedId);
    heading  = "Embed This Profile";
    blurb    = "Paste this into your blog, Linktree, or website — visitors can see your profile and call you straight from your page.";
    height   = "340";
  } else {
    embedUrl = "https://whisperplusme.com/embed.html?room=" + encodeURIComponent(embedId);
    heading  = "Embed This Room";
    blurb    = "Paste this into your blog, Linktree, or website — visitors can chat live without leaving your page.";
    height   = "600";
  }
  var snippet = "<iframe src=\"" + embedUrl + "\" width=\"380\" height=\"" + height + "\" "
    + "style=\"border:0;border-radius:14px;\" allow=\"microphone\" loading=\"lazy\"></iframe>";
  var modal = document.getElementById("profileModal");
  var body  = document.getElementById("profileModalBody");
  if(!modal || !body) return;
  body.innerHTML = "<div style='padding:20px'>"
    + "<div style='font-size:17px;font-weight:800;color:#fff;margin-bottom:2px'>" + heading + "</div>"
    + "<div style='font-size:12px;color:#888;margin-bottom:14px;'>" + blurb + "</div>"
    + "<textarea readonly id='embedSnippetBox' style='width:100%;height:90px;padding:10px;border-radius:10px;"
    + "border:1px solid #333;background:#111;color:#0f8;font-size:11px;font-family:monospace;resize:none;'>"
    + snippet.replace(/</g,"&lt;").replace(/>/g,"&gt;")
    + "</textarea>"
    + "<button id='embedCopyBtn' style='width:100%;margin-top:12px;padding:13px;border-radius:20px;"
    + "border:none;background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff;"
    + "font-size:14px;font-weight:700;cursor:pointer'>&#128203; Copy Embed Code</button>"
    + "</div>";
  modal.style.display = "flex";
  setTimeout(function(){
    var btn = document.getElementById("embedCopyBtn");
    if(!btn) return;
    btn.onclick = function(){
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(snippet).then(function(){
          showToast("Embed code copied!","success");
          window.closeProfileModal();
        }).catch(function(){ _fallbackCopy(snippet); });
      } else { _fallbackCopy(snippet); }
    };
  }, 0);
};

function contentPanel(){
  if(active === 0) return ""; /* profile cards rendered separately below phone */

  if(active === 1){
    /* chat rooms + input bar */
    var roomCards = CHAT_ROOMS.map(function(r){
      var isAct = (r.id === activeRoom);
      var liveCount = roomPresenceCounts[r.id] || 0;
      var isLive = liveCount > 0;
      /* Only show once we actually know the setting (map loaded) and it's
         explicitly open — default/unknown stays silent rather than risk
         showing "Open Mic" on a room that's actually member-only. */
      var isOpenMic = !!(window.__roomMemberOnlyMap && window.__roomMemberOnlyMap[r.id] === false);
      /* Split "🎙️ Live Voices" into icon + name so we can render the
         icon inside a fallback avatar circle when there's no photo */
      var spaceIdx = r.label.indexOf(" ");
      var icon = spaceIdx > -1 ? r.label.slice(0, spaceIdx) : "💬";
      var name = spaceIdx > -1 ? r.label.slice(spaceIdx + 1) : r.label;
      var useEmoji = (r.displayMode === "emoji") || !r.photo;
      var avatarInner = !useEmoji
        ? "<img class='room-card-avatar' src='" + sanitize(r.photo) + "' "
          + "onerror=\"this.parentNode.innerHTML='" + icon.replace(/'/g,"") + "'\" alt=''>"
        : icon;
      return "<div class='room-card" + (isAct ? " active-room" : "") + (isLive ? " room-live-now" : "") + "' "
        + "data-room='" + r.id + "'>"
        + (isOpenMic
            ? "<span class='room-openmic-badge' title='Anyone can use the mic here — no sign up required'>🎤 Open Mic</span>"
            : "")
        + (isLive
            ? "<span class='room-live-badge' data-room='" + r.id + "'>"
              + "<span class='room-live-dot'></span>" + liveCount + "</span>"
            : "<span class='room-live-badge' data-room='" + r.id + "' style='display:none'>"
              + "<span class='room-live-dot'></span><span class='room-live-count'>0</span></span>")
        + "<div class='room-card-avatar-wrap'>" + avatarInner + "</div>"
        + "<div class='room-card-main' role='button' tabindex='0' "
        + "onclick=\"switchRoom('" + r.id + "')\" "
        + "onkeydown=\"if(event.key==='Enter')switchRoom('" + r.id + "')\">"
        + "<div class='room-card-label'>" + sanitize(name) + "</div>"
        + "<div class='room-card-desc'>" + sanitize(r.desc) + "</div></div>"
        + "<button class='room-share-btn' "
        + "onclick=\"shareRoom(" + jsAttr(r.id) + "," + jsAttr(r.label) + "," + jsAttr(r.desc) + ")\" "
        + "aria-label='Share room' title='Share this room'>Share</button>"
        + "</div>";
    }).join("");

    return (isGuest()
        ? "<div class='guest-banner'>"
          + "<div class='guest-banner-text'>"
          + "<b>👋 You're browsing as a guest.</b> Sign up free to go live, get M&G spots, and unlock the map."
          + "</div>"
          + "<button class='guest-banner-btn' onclick='exitGuestToSignup()'>Sign Up Free</button>"
          + "</div>"
        : "")
      + "<div class='chat-input-bar'>"
      + "<button class='chat-promo-btn' onclick='postPromoCard()' "
          + "aria-label='Post promo card' title='Post your card'>📢</button>"
      + "<label class='chat-img-label' title='Send image' aria-label='Send image'>"
          + "📷<input type='file' accept='image/*' style='display:none' "
          + "onchange='sendChatImage(this.files[0]);this.value=\"\"'></label>"
      + "<input id='chatInputBar' placeholder='Message room…' maxlength='300' "
          + "aria-label='Message input' autocomplete='off' "
          + "onkeydown='if(event.key===\"Enter\")sendChat()'>"
      + "<button class='chat-send-btn' onclick='sendChat()' aria-label='Send'>▶</button>"
      + "</div>"
      + "<div class='room-grid' role='list'>" + roomCards + "</div>"
      + "<div class='member-rooms-section'>"
      + "<div class='member-rooms-header'>"
      + "<div class='member-rooms-title'>🏠 Member Rooms</div>"
      + "<button class='create-room-btn' onclick='showCreateRoomModal()'>+ Create Room</button>"
      + "</div>"
      + "<div id='memberRoomsGrid' class='member-rooms-grid'>"
      + "<div style='text-align:center;color:#555;font-size:13px;padding:20px;grid-column:1/-1;'>Loading rooms…</div>"
      + "</div>"
      + "</div>";
  }

  if(active === 4){
    return window.Dates ? window.Dates.panelHTML() : "";
  }

  if(active === 2){
    var locOn = window.__locationOn;
    return "<div class='map-controls'>"
      + "<button class='loc-btn " + (locOn ? "loc-on" : "loc-off") + "' "
          + "onclick='toggleLocation()' aria-pressed='" + (locOn?"true":"false") + "'>"
          + (locOn ? "📍 Location ON" : "📍 Location OFF")
          + "</button>"
      + "<div style='font-size:12px;opacity:.65;text-align:center;'>"
          + (locOn ? "Your pin is visible to members — auto-off in 25 min"
                   : "Your location is hidden")
          + "</div>"
      + "</div>";
  }

  if(active === 3){
    /* 👤 Profile screen: profile.js (tabs Profile · Wallet · Calls · More) */
    return window.Profile ? window.Profile.panelHTML() : "";
  }
  return "";
}

/* ═══════════════════════════════════════════
   RENDER
═══════════════════════════════════════════ */
function render(){
  var app = document.getElementById("app");
  if(!app) return;

  if(!currentUser){
    app.innerHTML = renderLoginPage();
    if(window.Landing) window.Landing.mount();
    /* hide members when logged out */
    var mc = document.getElementById("membersContainer");
    if(mc){ mc.style.display = "none"; mc.innerHTML = ""; }
    return;
  }
  if(window.Landing) window.Landing.unmount();

  /* Authenticated layout:
     stage → menu → content panel
     membersContainer lives OUTSIDE #app so it can sit between menu and footer */
  app.innerHTML = renderStage() + renderMenu()
    + "<div class='content'>" + contentPanel() + "</div>";

  afterRender();
}

function afterRender(){
  attachMapToUI();
  wireCallPhoneButtons();

  var mc = document.getElementById("membersContainer");
  if(mc){
    if(active === 0){
      mc.style.display = "block";
      mc.style.padding = "0";
    } else {
      mc.style.display = "none";
    }
  }
  if(active === 1){ bootChat(); setTimeout(renderMemberRooms, 300); }
  if(active === 4 && window.Dates){ window.Dates.mounted(); }
}

/* ═══════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════ */
window.setActive = function(i){
  if(isGuest() && i !== 1 && i !== 4){
    var featureNames = ["Browsing members","","The live map","Your profile","M&G"];
    promptGuestUpgrade(featureNames[i] || "This feature");
    return;
  }
  if(i === active && i !== 1) return;
  active = i;
  render();
  if(active === 0){ renderProfileCards(); }
  if(active === 1){ bootChat(); setTimeout(renderMemberRooms, 300); }
  if(active === 2){ bootMap(); }
  if(active === 4 && window.Dates){ window.Dates.boot(); }
  scrollToTop();
};

/* ── Carousel resize handling — mobile vs desktop offsets differ ── */
(function initCarouselResize(){
  var lastWasMobile = window.innerWidth <= 768;
  var t = null;
  window.addEventListener("resize", function(){
    clearTimeout(t);
    t = setTimeout(function(){
      var nowMobile = window.innerWidth <= 768;
      if(nowMobile !== lastWasMobile){
        lastWasMobile = nowMobile;
        if(document.getElementById("mainStage")) render();
      }
    }, 150);
  });
})();

/* ── Swipe / touch navigation ── */
(function initSwipe(){
  var startX = 0, startY = 0, threshold = 50, noSwipe = false;
  /* Swiping inside something that scrolls sideways (Dates categories, picture
     strips), a map, a form field or an open popup should never change screens. */
  function blocksSwipe(el){
    for(var n = el; n && n !== document.body; n = n.parentElement){
      if(n.nodeType !== 1) continue;
      if(n.id === "profileModal" || n.id === "mapMount" || n.hasAttribute("data-noswipe")) return true;
      if(/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) return true;
      var cs = window.getComputedStyle ? getComputedStyle(n) : null;
      if(cs && /(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 2) return true;
    }
    return false;
  }
  function onTouchStart(e){
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    noSwipe = blocksSwipe(e.target);
  }
  function onTouchEnd(e){
    if(noSwipe) return;
    var dx = e.changedTouches[0].clientX - startX;
    var dy = e.changedTouches[0].clientY - startY;
    /* Only horizontal swipes that are more horizontal than vertical */
    if(Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy)) return;
    /* Don't swipe while in a call or member room */
    if(window.__liveCallHTML || window.__inMemberRoom) return;
    var next = dx < 0
      ? SCREEN_ORDER[(screenPos(active) + 1) % SCREEN_ORDER.length]                        /* swipe left → next */
      : SCREEN_ORDER[(screenPos(active) - 1 + SCREEN_ORDER.length) % SCREEN_ORDER.length]; /* swipe right → prev */
    window.setActive(next);
  }
  document.addEventListener("touchstart", onTouchStart, { passive:true });
  document.addEventListener("touchend",   onTouchEnd,   { passive:true });
})();

/* ═══════════════════════════════════════════
   PHONE PROFILE NAVIGATION
═══════════════════════════════════════════ */
window.__phoneIdx = 0;

window.phoneNav = function(dir){
  var pList = Object.entries(window.allUsers||{}).filter(function(e){
    return e[0] !== (currentUser ? currentUser.uid : "") && !(window.__myBlocks||{})[e[0]];
  });
  if(!pList.length) return;
  window.__phoneIdx = ((window.__phoneIdx||0) + dir + pList.length) % pList.length;
  if(!window.__liveCallHTML){
    /* Target the browse screen (index 0) directly */
    var screen = document.getElementById("phone-screen-0");
    if(screen) screen.innerHTML = deviceContent("phone", 0);
  }
};

/* auto-advance every 60s */
setInterval(function(){
  if(active === 0 && !window.__liveCallHTML) window.phoneNav(1);
}, 60000);

/* ═══════════════════════════════════════════
   PROFILE MODAL
═══════════════════════════════════════════ */
/* The member card lives in profile.js (Profile.showMember). */
window.showProfileModal = function(uid){
  if(window.Profile) return window.Profile.showMember(uid);
};

window.closeProfileModal = function(){
  var modal = document.getElementById("profileModal");
  if(modal) modal.style.display = "none";
};

/* ── HOW IT WORKS ──
   Shown automatically right after signup, and reachable any time from
   the Dashboard. Real annotated screenshots of the actual app —
   circled + numbered — not a generic mockup. */
var HOW_IT_WORKS_STEPS = [
  { img:"/howitworks-1.png", title:"Pick a room",           text:"Browse free chat rooms by topic — General, Night Owls, Vent & Release, and more. No sign-up needed just to look around." },
  { img:"/howitworks-2.png", title:"Go live with your mic", text:"Tap Live to speak out loud to everyone in the room — free for signed-up members, no coins required." },
  { img:"/howitworks-3.png", title:"Host your own room",    text:"Create a paid room, set your own entry cost, and earn coins every time someone joins to talk with you." },
  { img:"/howitworks-4.png", title:"Add a profile photo",   text:"Profiles with a photo get far more calls. Tap your picture on the 👤 Profile tab." }
];

window.showHowItWorks = function(){
  var modal = document.getElementById("profileModal");
  var body  = document.getElementById("profileModalBody");
  if(!modal || !body) return;

  var html = "<div style='padding:22px 20px'>"
    + "<div style='font-size:18px;font-weight:800;color:#fff;margin-bottom:4px;text-align:center'>How Whisper+Me Works</div>"
    + "<div style='font-size:12px;color:#888;margin-bottom:18px;text-align:center'>Four things to know before you dive in</div>";

  HOW_IT_WORKS_STEPS.forEach(function(s, i){
    html += "<div style='margin-bottom:20px'>"
      + "<img src='" + s.img + "' alt='" + sanitize(s.title) + "' "
      + "style='width:100%;height:auto;border-radius:12px;border:1px solid rgba(123,47,247,0.3);display:block;margin-bottom:8px;'>"
      + "<div style='font-size:13.5px;font-weight:700;color:#f0e9ff;margin-bottom:2px'>" + (i+1) + ". " + s.title + "</div>"
      + "<div style='font-size:12px;color:#aaa;line-height:1.5'>" + s.text + "</div>"
      + "</div>";
  });

  html += "<button onclick='closeProfileModal()' style='width:100%;margin-top:6px;padding:14px;"
    + "border:none;border-radius:20px;background:linear-gradient(90deg,#7b2ff7,#00e3ae);"
    + "color:#fff;font-size:14px;font-weight:800;cursor:pointer;'>Got it — let's go</button>"
    + "</div>";

  body.innerHTML = html;
  modal.style.display = "flex";
};



/* ══ PERFORMANCE: lazy-load Mapbox only when map tab is opened ══ */
window.__mapboxLoaded = false;
function ensureMapboxLoaded(cb){
  if(window.__mapboxLoaded){ cb(); return; }
  var link = document.createElement("link");
  link.rel = "stylesheet"; link.href = "https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css";
  document.head.appendChild(link);
  var script = document.createElement("script");
  script.src = "https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js";
  script.onload = function(){ window.__mapboxLoaded = true; cb(); };
  document.head.appendChild(script);
}
/* ═══════════════════════════════════════════
   MAP
═══════════════════════════════════════════ */
window.__locationOn      = false;
window.__locationWatchId = null;
window.__locationTimer   = null;

function createMapOnce(){
  if(mapInstance) return;
  mapboxgl.accessToken = MAPBOX_TOKEN;
  mapContainer = document.createElement("div");
  mapContainer.style.cssText = "width:100%;height:100%;";
  mapInstance = new mapboxgl.Map({
    container: mapContainer,
    style: "mapbox://styles/mapbox/dark-v11",
    center: [-74.5, 40],
    zoom: 10
  });
}
/* Mapbox is lazy-loaded on first map tab open — no eager init needed */

function attachMapToUI(){
  if(active !== 2) return;
  var mount = document.getElementById("mapMount");
  if(!mount || !mapContainer) return;
  if(!mount.contains(mapContainer)){
    mount.innerHTML = "";
    mount.appendChild(mapContainer);
    setTimeout(function(){
      if(mapInstance) mapInstance.resize();
      /* Jump to user's position if we have a pending flyTo from location toggle */
      if(window.__pendingFlyTo){
        mapInstance.flyTo({ center:window.__pendingFlyTo, zoom:13, speed:1.4 });
        window.__pendingFlyTo = null;
      }
    }, 120);
  }
  refreshMapMarkers();
}

function bootMap(){
  ensureMapboxLoaded(function(){
    createMapOnce();
    setTimeout(attachMapToUI, 150);
  });
}

function refreshMapMarkers(){
  if(!mapInstance) return;
  var users = window.allUsers || {};
  var myUid = currentUser ? currentUser.uid : null;
  var posMap = {};

  Object.entries(users).forEach(function(e){
    var uid = e[0], u = e[1];
    if(!u.lat || !u.lng) return;
    var key = u.lat.toFixed(5) + "," + u.lng.toFixed(5);
    if(!posMap[key]) posMap[key] = [];
    posMap[key].push(uid);
  });

  Object.entries(users).forEach(function(e){
    var uid = e[0], u = e[1];
    if(!u.lat || !u.lng) return;
    var key    = u.lat.toFixed(5) + "," + u.lng.toFixed(5);
    var group  = posMap[key];
    var idx    = group.indexOf(uid);
    var spread = 0.00015;
    var angle  = (idx / Math.max(group.length,1)) * 2 * Math.PI;
    var lat = u.lat + (idx > 0 ? Math.sin(angle)*spread : 0);
    var lng = u.lng + (idx > 0 ? Math.cos(angle)*spread : 0);

    if(mapMarkers[uid]){ mapMarkers[uid].setLngLat([lng,lat]); return; }

    if(uid === myUid){
      var dot = document.createElement("div");
      dot.style.cssText = "width:16px;height:16px;border-radius:50%;background:#e53935;"
        + "border:3px solid #fff;box-shadow:0 0 0 4px rgba(229,57,53,.35);pointer-events:none;";
      mapMarkers[uid] = new mapboxgl.Marker(dot).setLngLat([lng,lat]).addTo(mapInstance);
      return;
    }

    var el = document.createElement("div");
    /* Set all background styles individually — cssText concatenation had a stray semicolon */
    el.style.width           = "44px";
    el.style.height          = "44px";
    el.style.borderRadius    = "50%";
    el.style.border          = "3px solid #00e3ae";
    el.style.cursor          = "pointer";
    el.style.boxShadow       = "0 2px 10px rgba(0,0,0,0.6)";
    el.style.backgroundColor = "#222";
    el.style.backgroundSize  = "cover";
    el.style.backgroundPosition = "center";
    if(u.photo){
      /* No crossOrigin — Firebase Storage doesn't need it and it causes CORS preflight failures */
      var _markerImg = new Image();
      var _markerEl  = el;
      var _markerSrc = u.photo;
      _markerImg.onload = function(){
        _markerEl.style.backgroundImage = "url('" + _markerSrc + "')";
      };
      _markerImg.onerror = function(){
        _markerEl.style.backgroundColor = "#2a1a4a";
      };
      _markerImg.src = _markerSrc;
    }
    var uPr  = u.price || 1;
    var uBio = sanitize(u.bio||"");
    var uPh  = sanitize(u.photo||"");

    var pHtml = "<div style='background:#0f0f18;color:#fff;border-radius:14px;overflow:hidden;"
      + "min-width:200px;max-width:240px;border:1px solid rgba(122,0,255,0.3);'>"
      + (uPh ? "<img src='" + uPh + "' style='width:100%;height:100px;object-fit:cover;display:block;'>" : "")
      + "<div style='padding:10px 12px;'>"
      + "<div style='font-size:15px;font-weight:700;margin-bottom:2px;'>" + sanitize(u.name||"Member") + "</div>"
      + (uBio ? "<div style='font-size:11px;color:#aaa;margin-bottom:5px;line-height:1.3;'>" + uBio + "</div>" : "")
      + "<div style='font-size:11px;color:#00e3ae;margin-bottom:8px;'>" + uPr + " coin" + (uPr>1?"s":"") + " · $" + (uPr*3) + "/call</div>"
      + "<div style='display:flex;gap:6px;'>"
      + "<button data-uid='" + uid + "' onclick='startCallFromBtn(this)' "
          + "style='flex:1;padding:9px;border-radius:16px;border:none;"
          + "background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff;font-size:12px;"
          + "font-weight:700;cursor:pointer;min-height:38px;'>📞 Call</button>"
      + "<button onclick=\"shareProfile('" + uid + "')\" "
          + "style='flex:1;padding:9px;border-radius:16px;border:none;background:#1e1e2a;"
          + "color:#00e3ae;font-size:12px;cursor:pointer;min-height:38px;'>🔗 Share</button>"
      + "</div></div></div>";

    var popup = new mapboxgl.Popup({ offset:26, closeButton:true, closeOnClick:true, maxWidth:"250px" })
      .setHTML(pHtml);
    mapMarkers[uid] = new mapboxgl.Marker(el).setLngLat([lng,lat]).setPopup(popup).addTo(mapInstance);
  });

  Object.keys(mapMarkers).forEach(function(uid){
    var u = users[uid];
    if(!u || !u.lat){ mapMarkers[uid].remove(); delete mapMarkers[uid]; }
  });
}

function stopLocation(){
  window.__locationOn = false;
  if(window.__locationWatchId !== null){
    navigator.geolocation.clearWatch(window.__locationWatchId);
    window.__locationWatchId = null;
  }
  if(window.__locationTimer){ clearTimeout(window.__locationTimer); window.__locationTimer = null; }
  if(currentUser) firebase.database().ref("users/" + currentUser.uid).update({ lat:null, lng:null });
}

window.toggleLocation = function(){
  if(!currentUser){ showToast("Login required","warn"); return; }
  if(window.__locationOn){ stopLocation(); render(); return; }
  if(!navigator.geolocation){ showToast("Geolocation not supported","warn"); return; }
  navigator.geolocation.getCurrentPosition(function(pos){
    window.__locationOn = true;
    pushLocation(pos.coords.latitude, pos.coords.longitude);
    /* Auto-jump map to user's position */
    if(mapInstance){
      mapInstance.flyTo({ center:[pos.coords.longitude, pos.coords.latitude], zoom:13, speed:1.4 });
    } else {
      /* If on map tab but map not yet initialized, store coords for boot */
      window.__pendingFlyTo = [pos.coords.longitude, pos.coords.latitude];
    }
    window.__locationWatchId = navigator.geolocation.watchPosition(
      function(p){ pushLocation(p.coords.latitude, p.coords.longitude); },
      function(err){ console.warn("geo error", err); },
      { enableHighAccuracy:true, maximumAge:15000, timeout:20000 }
    );
    window.__locationTimer = setTimeout(function(){
      stopLocation(); render(); showToast("Location auto-disabled after 25 minutes","warn");
    }, 25*60*1000);
    render();
  }, function(){ showToast("Location permission denied","error"); });
};

function pushLocation(lat, lng){
  if(!currentUser) return;
  var uRef = firebase.database().ref("users/" + currentUser.uid);
  uRef.update({ lat:lat, lng:lng, online:true });
  /* Auto-clear map pin if browser tab closes/phone dies */
  uRef.onDisconnect().update({ lat:null, lng:null, online:false });
}

/* ═══════════════════════════════════════════
   CHAT ROOMS
═══════════════════════════════════════════ */
function bootChat(){
  if(chatListener){
    try{ firebase.database().ref("chat/" + activeRoom).off("value", chatListener); }catch(e){}
    chatListener = null;
  }
  chatMessages = [];
  var ref = firebase.database().ref("chat/" + activeRoom).orderByChild("ts").limitToLast(60);
  chatListener = ref.on("value", function(snap){
    chatMessages = [];
    snap.forEach(function(c){ chatMessages.push(Object.assign({ _key:c.key }, c.val())); });
    if(active === 1) renderChatMessages();
  });
  /* Start audience listener so users can hear live mics */
  watchLiveMicRoom(activeRoom);
  checkModeratorStatus(activeRoom);
  watchOwnBlockStatus(activeRoom);
}

window.switchRoom = function(roomId){
  if(chatListener){
    try{ firebase.database().ref("chat/" + activeRoom).off("value", chatListener); }catch(e){}
    chatListener = null;
  }

  /* If leaving a member room, also leave Agora voice */
  if(activeRoom && activeRoom.startsWith("mr_") && !roomId.startsWith("mr_")){
    leaveMemberRoomVoice();
    /* Remove creator banner if present */
    var banner = document.getElementById("mr-creator-banner");
    if(banner && banner.parentNode) banner.parentNode.removeChild(banner);
    /* Restore live mic button */
    var liveMicBtn = document.querySelector("#phoneChatWrap .phone-chat-header button");
    if(liveMicBtn) liveMicBtn.style.display = "";
  }

  activeRoom = roomId;
  updatePresenceRoom(roomId, isGuest());
  chatMessages = [];
  var box = document.getElementById("phoneChatMsgs");
  if(box) box.innerHTML = "<p style='text-align:center;color:#555;font-size:12px;padding:20px;'>Loading…</p>";
  bootChat();
  scrollToTop(); /* the room grid lives below the chat screen — bring it back into view */
  document.querySelectorAll(".room-card").forEach(function(c){
    if(c.dataset.room === roomId) c.classList.add("active-room");
    else c.classList.remove("active-room");
  });
  var hdr = document.getElementById("phoneChatRoomName");
  if(hdr){
    var r = CHAT_ROOMS.find(function(x){ return x.id === roomId; });
    if(r) hdr.textContent = r.label;
  }
  updateLiveMicBar();
};

/* Old messages are trimmed on the server now (chatPrune runs every 30 min),
   so members can only delete their own messages. */
function pruneRoom(roomId){}

function renderChatMessages(){
  var box = document.getElementById("phoneChatMsgs");
  if(!box) return;

  if(!chatMessages || chatMessages.length === 0){
    box.innerHTML = "<p style='text-align:center;color:#444;font-size:12px;padding:20px;'>No messages yet — say hi!</p>";
    return;
  }

  var myUid = currentUser ? currentUser.uid : "";
  var out   = document.createDocumentFragment();

  for(var i = 0; i < chatMessages.length; i++){
    var m = chatMessages[i];
    if(!m) continue;
    var mine  = (m.uid === myUid);
    var mUid  = (m.uid||"").replace(/[<>"'&]/g,"");
    var mName = sanitize(m.name||"User");
    var mTime = timeAgo(m.ts||0);
    var row   = document.createElement("div");

    if(m.type === "promo"){
      var mPhoto = sanitize(m.photo||"");
      var mPrice = Number(m.price||1);
      var isOwn  = (m.uid === myUid);
      row.style.cssText = "display:block;width:100%;margin:0 0 8px 0;cursor:pointer;";
      row.setAttribute("onclick", "showProfileModal('" + mUid + "')");
      var inner = "<div style='background:rgba(123,47,247,0.15);border:1px solid rgba(123,47,247,0.4);"
        + "border-radius:12px;overflow:hidden;'>"
        + "<div style='display:flex;align-items:center;gap:9px;padding:9px;'>"
        + "<img src='" + mPhoto + "' onerror='this.style.opacity=0' "
          + "style='width:40px;height:40px;min-width:40px;border-radius:50%;object-fit:cover;"
          + "border:2px solid #7b2ff7;flex-shrink:0;'>"
        + "<div style='flex:1;min-width:0;'>"
        + "<div style='font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'>" + mName + "</div>"
        + "<div style='font-size:11px;color:#00e3ae;'>" + mPrice + " coin" + (mPrice>1?"s":"") + " · $" + (mPrice*3) + "/call</div>"
        + "</div></div>";
      if(!isOwn)
        inner += "<div style='padding:0 9px 8px;'>"
          + "<button data-uid='" + mUid + "' "
            + "onclick='event.stopPropagation();startCallFromBtn(this)' "
            + "style='width:100%;padding:9px;border-radius:16px;border:none;"
            + "background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff;"
            + "font-size:12px;font-weight:700;cursor:pointer;min-height:38px;'>📞 Call " + mName + "</button></div>";
      else
        inner += "<div style='text-align:center;font-size:10px;color:rgba(255,255,255,0.3);"
          + "padding:2px 9px 8px;'>Your Promo Card</div>";
      inner += "</div>";
      row.innerHTML = inner;

    } else {
      if(!m.text && m.type !== "image") continue;
      row.style.cssText = "display:block;width:100%;margin:0 0 8px 0;text-align:" + (mine?"right":"left") + ";";
      var msg = "";
      if(!mine){
        var isOfficial = (m.uid === "whisper_support_official");
        var nameOnClick = isOfficial ? "" : "onclick=\"showProfileModal('" + mUid + "')\" ";
        msg += "<span " + nameOnClick
          + "style='display:block;font-size:10px;font-weight:700;color:#a78bfa;"
          + (isOfficial ? "" : "cursor:pointer;") + "margin-bottom:2px;'>" + mName
          + (isOfficial
              ? " <span style='display:inline-block;background:rgba(0,227,174,0.18);"
                + "color:#00e3ae;border:1px solid rgba(0,227,174,0.4);border-radius:6px;"
                + "padding:1px 5px;font-size:8px;font-weight:800;vertical-align:middle;'>OFFICIAL</span>"
              : "")
          + "</span>";
      }
      if(m.type === "image" && m.img){
        var iUrl = (m.img||"").replace(/"/g,"&quot;");
        msg += "<img src='" + iUrl + "' "
          + "style='display:block;max-width:180px;border-radius:10px;cursor:pointer;" + (mine?"margin-left:auto;":"") + "' "
          + "onclick='window.open(this.src)' alt='Shared image'>";
      } else if(mine){
        msg += "<span style='display:inline-block;background:linear-gradient(135deg,#7b2ff7,#5b1fd4);"
          + "color:#fff;padding:7px 11px;border-radius:14px 14px 3px 14px;font-size:12px;"
          + "line-height:1.45;word-break:break-word;max-width:80%;text-align:left;'>"
          + sanitize(m.text) + "</span>";
      } else {
        msg += "<span style='display:inline-block;background:#1a1a2a;color:#ddd;"
          + "padding:7px 11px;border-radius:14px 14px 14px 3px;font-size:12px;"
          + "line-height:1.45;word-break:break-word;max-width:80%;'>"
          + sanitize(m.text) + "</span>";
      }
      var canDelete = mine || isModeratorOfActiveRoom;
      msg += "<br><span style='font-size:9px;color:rgba(255,255,255,0.22);'>" + mTime + "</span>";
      if(canDelete && m._key){
        msg += " <span onclick=\"deleteChatMessage('" + m._key + "')\" "
          + "style='font-size:9px;color:rgba(255,92,92,0.5);cursor:pointer;padding:2px 4px;' "
          + "title='Delete message'>🗑️</span>";
      }
      row.innerHTML = msg;
    }
    out.appendChild(row);
  }
  box.innerHTML = "";
  box.appendChild(out);

  /* Scroll to the true bottom — and keep re-checking briefly, since
     message photos (promo cards, avatars) load asynchronously and can
     grow the box's height AFTER the first scroll, leaving the view
     stranded partway up once they finish loading. */
  function scrollChatToBottom(){ box.scrollTop = box.scrollHeight; }
  requestAnimationFrame(scrollChatToBottom);
  setTimeout(scrollChatToBottom, 150);
  setTimeout(scrollChatToBottom, 500);
  box.querySelectorAll("img").forEach(function(img){
    if(!img.complete) img.addEventListener("load", scrollChatToBottom, { once:true });
  });
}

/* send text message — client-side, authenticated via Firebase rules */
window.sendChat = function(){
  if(!currentUser){ showToast("Login required","warn"); return; }
  var input = document.getElementById("chatInputBar");
  if(!input) return;
  var text = (input.value||"").trim();
  if(!text || text.length > 300) return;
  input.value = "";
  var me = window.me || {};
  firebase.database().ref("chat/" + activeRoom).push({
    uid:  currentUser.uid,
    name: me.name  || "User",
    photo:me.photo || "",
    text: text,
    type: "text",
    ts:   Date.now()
  }).then(function(){ pruneRoom(activeRoom); }).catch(console.error);
};

/* post promo card — rate-limited client-side, 5-min cooldown */
window.postPromoCard = function(){
  if(!currentUser){ showToast("Login required","warn"); return; }
  if(isGuest()){ promptGuestUpgrade("Promo cards"); return; }
  var me = window.me || {};
  if(!me.name){ showToast("Add your name in Dashboard first","warn"); return; }
  var lastPromo = window.__lastPromoTs || 0;
  if(Date.now() - lastPromo < 300000){
    var wait = Math.ceil((300000 - (Date.now()-lastPromo)) / 1000);
    showToast("Wait " + wait + "s before posting another promo","warn");
    return;
  }
  window.__lastPromoTs = Date.now();
  firebase.database().ref("chat/" + activeRoom).push({
    uid:   currentUser.uid,
    name:  me.name,
    photo: me.photo || "",
    price: me.price || 1,
    type:  "promo",
    text:  "",
    ts:    Date.now()
  }).then(function(){ pruneRoom(activeRoom); }).catch(console.error);
};

/* send image — stored in Firebase Storage, secure URL in DB */
window.sendChatImage = function(file){
  if(!currentUser){ showToast("Login required","warn"); return; }
  if(!file) return;
  if(file.size > 5 * 1024 * 1024){ showToast("Max image size is 5MB","warn"); return; }
  var me = window.me || {};
  firebase.storage().ref("chatImages/" + activeRoom + "/" + Date.now() + "_" + currentUser.uid)
    .put(file)
    .then(function(s){ return s.ref.getDownloadURL(); })
    .then(function(url){
      return firebase.database().ref("chat/" + activeRoom).push({
        uid:   currentUser.uid,
        name:  me.name  || "User",
        photo: me.photo || "",
        text:  "",
        img:   url,
        type:  "image",
        ts:    Date.now()
      });
    })
    .then(function(){ pruneRoom(activeRoom); })
    .catch(function(e){ showToast("Upload failed: " + e.message,"error"); });
};

/* ═══════════════════════════════════════════
   LIVE MIC
═══════════════════════════════════════════ */
window.showLiveMicPanel = async function(){
  if(!currentUser){ showToast("Login required","warn"); return; }
  if(isGuest() && await checkRoomMemberOnlyFresh(activeRoom)){ promptGuestUpgrade("Live Mic"); return; }
  var modal = document.getElementById("profileModal");
  var body  = document.getElementById("profileModalBody");
  if(!modal || !body) return;

  if(liveMicActive){
    body.innerHTML = "<div style='text-align:center;padding:32px 20px;'>"
      + "<div style='font-size:42px;margin-bottom:8px;'>🎤</div>"
      + "<div style='font-size:17px;font-weight:700;color:#fff;margin-bottom:6px;'>You are LIVE</div>"
      + "<div id='liveMicCountdown' style='font-size:42px;font-weight:800;color:#00e3ae;margin-bottom:20px;'>3:00</div>"
      + "<div style='display:flex;gap:10px;justify-content:center;'>"
      + "<button id='liveMicMuteBtn' onclick='toggleLiveMicMute()' "
          + "style='flex:1;padding:12px;border-radius:20px;border:none;background:#222;color:#fff;"
          + "font-size:14px;cursor:pointer;min-height:44px;'>🔇 Mute</button>"
      + "<button onclick='endLiveMic()' "
          + "style='flex:1;padding:12px;border-radius:20px;border:none;background:#e53935;color:#fff;"
          + "font-size:14px;font-weight:700;cursor:pointer;min-height:44px;'>End</button>"
      + "</div></div>";
    modal.style.display = "flex";
    return;
  }

  body.innerHTML = "<div style='text-align:center;padding:32px 20px;'>"
    + "<div style='font-size:42px;margin-bottom:8px;'>🎤</div>"
    + "<div style='font-size:17px;font-weight:700;color:#fff;margin-bottom:6px;'>Go Live in Room</div>"
    + "<div style='font-size:13px;color:#aaa;margin-bottom:6px;'>Speak to everyone in <b style='color:#00e3ae'>" + sanitize(activeRoom) + "</b></div>"
    + "<div style='font-size:13px;color:#00e3ae;font-weight:700;margin-bottom:20px;'>&#9989; Free &#183; 3 minutes max</div>"
    + "<button onclick='startLiveMic()' "
      + "style='width:100%;padding:14px;border-radius:22px;border:none;"
      + "background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff;font-size:15px;"
      + "font-weight:700;cursor:pointer;min-height:48px;'>&#127908; Go Live Now</button>"
    + "</div>";
  modal.style.display = "flex";
};

/* startLiveMic — calls server CF which atomically checks 5-mic limit; live mic is FREE */
window.startLiveMic = async function(){
  if(!currentUser) return;
  if(isGuest() && await checkRoomMemberOnlyFresh(activeRoom)){ promptGuestUpgrade("Live Mic"); return; }

  /* Optimistically close modal and show spinner */
  window.closeProfileModal();
  showToast("Starting live mic…","");

  currentUser.getIdToken(true).then(function(tok){
    return fetch(CF_BASE + "/liveMicCharge", {
      method:  "POST",
      headers: { "Content-Type":"application/json", "Authorization":"Bearer " + tok },
      body:    JSON.stringify({ room: activeRoom })
    });
  }).then(function(res){ return res.json().then(function(d){ return { ok: res.ok, d: d }; }); })
  .then(function(r){
    if(!r.ok){
      showToast(r.d.error || "Could not go live","error");
      return;
    }
    /* Start Agora audio with server-confirmed endTs */
    startLiveMicAudio(r.d.endTs, activeRoom, currentUser.uid);
    /* Show the live panel */
    setTimeout(window.showLiveMicPanel, 400);
  }).catch(function(e){
    showToast("Live mic error: " + e.message,"error");
  });
};

async function startLiveMicAudio(endTs, room, uid){
  await loadAgora();
  liveMicActive = true;
  /* Leave audience client before joining as host */
  await stopLiveMicAudience();
  try {
    /* Must create in "live" mode then explicitly set role before join */
    liveMicClient = AgoraRTC.createClient({ mode:"rtc", codec:"vp8" });
    liveMicTrack = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: "music_standard", AEC: true, AGC: true, ANS: true });
    var liveHostToken = await fetchAgoraToken("livemic_" + room);
    await liveMicClient.join(AGORA_APP_ID, "livemic_" + room, liveHostToken, null);
    await liveMicClient.publish([liveMicTrack]);
  } catch(e) {
    showToast("Mic error: " + e.message,"error");
    endLiveMic();
    return;
  }

  /* Ticker — updates countdown in modal AND live bar */
  function tickLiveMic(){
    var secs = Math.max(0, Math.round((endTs - Date.now()) / 1000));
    var mm = Math.floor(secs/60), ss = secs % 60;
    var label = mm + ":" + String(ss).padStart(2,"0");
    var el = document.getElementById("liveMicCountdown");
    if(el) el.textContent = label;
    var hdr = document.getElementById("liveMicHeaderTimer");
    if(hdr) hdr.textContent = label;
    updateLiveMicBar();
    if(secs <= 0){ clearInterval(liveMicTimer); endLiveMic(); }
  }
  liveMicTimer = setInterval(tickLiveMic, 1000);
  tickLiveMic();
  updateLiveMicBar();
  /* Swap header button to LIVE+timer+End */
  var liveBtn = document.querySelector("#phoneChatWrap .phone-chat-header button");
  if(liveBtn){
    liveBtn.outerHTML = "<span id='liveMicHeaderBar' style='display:flex;align-items:center;gap:6px'>"
      + "<span style='font-size:11px;color:#00e3ae;font-weight:700'>&#128308; LIVE</span>"
      + "<span id='liveMicHeaderTimer' style='font-size:11px;color:#fff;font-weight:600'>3:00</span>"
      + "<button onclick='endLiveMic()' style='background:#e53935;border:none;color:#fff;"
      + "border-radius:8px;padding:4px 9px;font-size:11px;cursor:pointer;min-height:28px;font-weight:700'>End</button></span>";
  }
}

window.toggleLiveMicMute = function(){
  if(!liveMicTrack) return;
  var en = !liveMicTrack.enabled;
  liveMicTrack.setEnabled(en);
  var b = document.getElementById("liveMicMuteBtn");
  if(b) b.textContent = en ? "🔇 Mute" : "🔊 Unmute";
};

window.endLiveMic = function(){
  if(!liveMicActive) return;
  liveMicActive = false;
  clearInterval(liveMicTimer);
  if(liveMicTrack){ try{ liveMicTrack.stop(); liveMicTrack.close(); }catch(e){} liveMicTrack = null; }
  if(liveMicClient){ try{ liveMicClient.leave(); }catch(e){} liveMicClient = null; }
  if(currentUser) firebase.database().ref("liveMics/" + activeRoom + "/" + currentUser.uid).update({ active:false });
  updateLiveMicBar();
  var hdrBar = document.getElementById("liveMicHeaderBar");
  if(hdrBar){
    hdrBar.outerHTML = "<button onclick='showLiveMicPanel()' style='background:rgba(123,47,247,.45);"
      + "border:none;color:#fff;border-radius:10px;padding:5px 10px;font-size:11px;"
      + "cursor:pointer;min-height:32px'>&#127908; Live</button>";
  }
};

function updateLiveMicBar(){
  var bar = document.getElementById("liveMicBar");
  if(!bar) return;
  firebase.database().ref("liveMics/" + activeRoom).once("value").then(function(snap){
    var mics = [];
    var now  = Date.now();
    snap.forEach(function(c){
      var v = c.val();
      if(v && v.active && v.endTs > now) mics.push(v);
    });
    if(!mics.length){
      bar.style.display = "none";
      bar.innerHTML = "";
    } else {
      bar.style.display = "block";
      bar.innerHTML = "🎤 Live: " + mics.map(function(m){
        var secsLeft = Math.max(0, Math.round((m.endTs - now) / 1000));
        var mm = Math.floor(secsLeft/60), ss = secsLeft % 60;
        var timeStr = mm + ":" + String(ss).padStart(2,"0");
        return "<b style='color:#00e3ae'>" + sanitize(m.name||"?") + "</b>"
          + "<span style='color:#888;font-size:10px;margin-left:4px;'>(" + timeStr + ")</span>";
      }).join(" · ");
    }
  });
}

setInterval(function(){ if(active === 1) updateLiveMicBar(); }, 20000);

/* ═══════════════════════════════════════════
   LIVE MIC AUDIENCE — lets other devices hear
═══════════════════════════════════════════ */
async function startLiveMicAudience(room){
  await loadAgora();
  /* Don't create a second audience client if we're already the host */
  if(liveMicActive) return;
  /* Don't create audience client if we're in a P2P call */
  if(agoraJoined || agoraJoining) return;
  /* Member-only rooms also gate listening, not just hosting — fail with a
     friendly prompt instead of a silent server-side 403 from the token
     endpoint. */
  if(isGuest() && await checkRoomMemberOnlyFresh(room)){ promptGuestUpgrade("Live Mic"); return; }
  if(liveMicAudienceClient) return; /* already listening */
  try {
    liveMicAudienceClient = AgoraRTC.createClient({ mode:"rtc", codec:"vp8" });

    liveMicAudienceClient.on("user-published", async function(remoteUser, mediaType){
      if(!liveMicAudienceClient) return;
      await liveMicAudienceClient.subscribe(remoteUser, mediaType);
      if(mediaType === "audio"){
        try{ await AgoraRTC.resumeAudioContext(); }catch(e){}
        remoteUser.audioTrack.play();
      }
    });
    liveMicAudienceClient.on("user-unpublished", function(remoteUser){
      if(remoteUser.audioTrack) remoteUser.audioTrack.stop();
    });

    var liveAudToken = await fetchAgoraToken("livemic_" + room);
    await liveMicAudienceClient.join(AGORA_APP_ID, "livemic_" + room, liveAudToken, null);
  } catch(e) {
    console.warn("Audience join error:", e);
    liveMicAudienceClient = null;
  }
}

async function stopLiveMicAudience(){
  if(!liveMicAudienceClient) return;
  try { await liveMicAudienceClient.leave(); } catch(e){}
  liveMicAudienceClient = null;
}

/* Watch the room for active mics — auto-join/leave as audience */
function watchLiveMicRoom(room){
  if(liveMicRoomListener){
    firebase.database().ref("liveMics/" + (window._liveMicWatchedRoom||room)).off("value", liveMicRoomListener);
    liveMicRoomListener = null;
  }
  window._liveMicWatchedRoom = room;

  liveMicRoomListener = firebase.database().ref("liveMics/" + room).on("value", function(snap){
    var hasActive = false;
    snap.forEach(function(c){ if(c.val() && c.val().active) hasActive = true; });
    if(hasActive && !liveMicActive){
      startLiveMicAudience(room);
    } else if(!hasActive){
      stopLiveMicAudience();
    }
    updateLiveMicBar();
  });
}

/* ═══════════════════════════════════════════
   CALL UI TEMPLATES
═══════════════════════════════════════════ */
function setPhoneCallUI(html){
  window.__liveCallHTML = html;
  if(active !== 0){ window.setActive(0); }
  var inject = function(){
    var screen = document.getElementById("phone-screen-0");
    if(!screen) screen = document.querySelector(".phone-shell-visible .phone");
    if(screen){ screen.innerHTML = html; wireCallPhoneButtons(); }
  };
  if(active !== 0){ setTimeout(inject, 180); } else { inject(); }
}
function clearPhoneCallUI(){
  window.__liveCallHTML = null;
  render();
  renderProfileCards();
}
function wireCallPhoneButtons(){
  var endBtn = document.getElementById("phone-end-call-btn");
  if(endBtn) endBtn.onclick = function(){ window.endCall(endBtn.dataset.callid); };
}

function tplCalling(targetUser, callId){
  return "<div class='call-screen'>"
    + "<img src='" + sanitize(targetUser.photo||"") + "' onerror='this.style.display=\"none\"' "
        + "class='call-avatar' alt=''>"
    + "<div class='call-status'>Calling…</div>"
    + "<div class='call-name'>" + sanitize(targetUser.name||"Whisper") + "</div>"
    + "<button id='phone-end-call-btn' data-callid='" + callId + "' class='call-end-btn'>End</button>"
    + "</div>";
}
function tplLiveCall(callId, targetUser){
  return "<div class='call-screen'>"
    + "<img src='" + sanitize((targetUser&&targetUser.photo)||"") + "' "
        + "onerror='this.style.display=\"none\"' class='call-avatar' alt=''>"
    + "<div class='call-name'>" + sanitize((targetUser&&targetUser.name)||"Connected") + "</div>"
    + "<div id='call-timer' class='call-timer'>03:00</div>"
    + "<button id='phone-end-call-btn' data-callid='" + callId + "' class='call-end-btn'>End Call</button>"
    + "</div>";
}
function tplIncoming(callId, callerData){
  return "<div class='call-screen'>"
    + "<div class='call-status'>Incoming Call</div>"
    + "<img src='" + sanitize(callerData.callerPhoto||"") + "' "
        + "onerror='this.style.display=\"none\"' class='call-avatar' alt=''>"
    + "<div class='call-name'>" + sanitize(callerData.callerName||"Caller") + "</div>"
    + "<div style='display:flex;gap:20px;justify-content:center;margin-top:24px;'>"
    + "<button id='phone-accept-btn' data-callid='" + callId + "' class='call-accept-btn'>Answer</button>"
    + "<button id='phone-reject-btn' data-callid='" + callId + "' class='call-end-btn'>Decline</button>"
    + "</div></div>";
}

/* ═══════════════════════════════════════════
   VISUAL TIMER
═══════════════════════════════════════════ */
window.callSecondsRemaining = 180;
window.visualTimerStarted   = false;

function startVisualTimer(callId){
  if(window.visualTimerStarted) return;
  window.visualTimerStarted   = true;
  window.callSecondsRemaining = 180;
  clearInterval(window.callTimerInterval);
  function tick(){
    var el = document.getElementById("call-timer");
    if(!el){
      clearInterval(window.callTimerInterval);
      window.visualTimerStarted = false;
      window.callSecondsRemaining = 180;
      return;
    }
    var s = window.callSecondsRemaining;
    el.innerText = String(Math.floor(s/60)).padStart(2,"0") + ":" + String(s%60).padStart(2,"0");
    if(s <= 0){
      clearInterval(window.callTimerInterval);
      window.visualTimerStarted = false;
      window.callSecondsRemaining = 180;
      window.endCall(callId);
      return;
    }
    window.callSecondsRemaining--;
  }
  tick();
  window.callTimerInterval = setInterval(tick, 1000);
}

/* ═══════════════════════════════════════════
   AGORA VOICE (P2P, secure via server token)
═══════════════════════════════════════════ */
async function setupAgora(callId, targetUser){
  await loadAgora();
  agoraClient = AgoraRTC.createClient({ mode:"rtc", codec:"vp8" });
  agoraClient.on("user-published", async function(remote, mediaType){
    await agoraClient.subscribe(remote, mediaType);
    if(mediaType === "audio"){
      try{ await AgoraRTC.resumeAudioContext(); }catch(e){}
      remote.audioTrack.play();
      /* ── Timer starts only when BOTH sides have audio connected ── */
      startVisualTimer(callId);
    }
  });
  agoraClient.on("user-left", async function(){
    if(window.__activeCallId) await window.endCall(window.__activeCallId);
  });
  /* Token generated by Cloud Function — never exposed client-side */
  var callToken = await fetchAgoraToken(callId);
  await agoraClient.join(AGORA_APP_ID, callId, callToken, null);
  localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig:"music_standard" });
  await agoraClient.publish([localAudioTrack]);
  localAudioTrack.setEnabled(true);
  setPhoneCallUI(tplLiveCall(callId, targetUser));
  /* Timer will start in user-published handler when remote audio arrives */
}

async function joinVoiceChannel(callId, targetUser){
  if(agoraJoining) return;
  if(agoraJoined)  return;
  agoraJoining = true;
  try {
    await setupAgora(callId, targetUser);
    agoraJoined = true;
  } catch(err){
    showToast("Voice connection failed","error");
    await window.endCall(callId);
  }
  agoraJoining = false;
}

async function leaveVoiceChannel(){
  agoraJoined  = false;
  agoraJoining = false;
  try {
    if(localAudioTrack){ localAudioTrack.stop(); localAudioTrack.close(); localAudioTrack = null; }
    if(agoraClient){ await agoraClient.leave(); agoraClient = null; }
  } catch(e){ agoraClient = null; }
}

/* ═══════════════════════════════════════════
   CALL PERSISTENCE (session only)
═══════════════════════════════════════════ */
function persistCall(callId, targetUser){
  try{ sessionStorage.setItem("__wpm_call", JSON.stringify({ callId, targetUser })); }catch(e){}
}
function clearPersistedCall(){
  try{ sessionStorage.removeItem("__wpm_call"); }catch(e){}
}
async function resumeCallIfNeeded(){
  var saved;
  try{ saved = JSON.parse(sessionStorage.getItem("__wpm_call")||"null"); }catch(e){ return; }
  if(!saved) return;
  var callId = saved.callId, targetUser = saved.targetUser;
  try {
    var snap = await firebase.database().ref("calls/" + callId).once("value");
    var call = snap.val();
    if(!call || call.status === "ended"){ clearPersistedCall(); return; }
    window.__activeCallId = callId;
    setPhoneCallUI(tplLiveCall(callId, targetUser));
    await joinVoiceChannel(callId, targetUser);
    firebase.database().ref("calls/" + callId).on("value", async function(s2){
      var c = s2.val();
      if(c && c.status === "ended"){
        firebase.database().ref("calls/" + callId).off();
        await window.endCall(callId);
      }
    });
  } catch(e){ clearPersistedCall(); }
}

/* ═══════════════════════════════════════════
   STUCK CALL CLEANUP
═══════════════════════════════════════════ */
async function cleanupStuckCalls(){
  if(!currentUser) return;
  var uid = currentUser.uid, now = Date.now(), promises = [];
  try {
    var doClean = function(snap){
      snap.forEach(function(s){
        var c = s.val(); if(!c) return;
        if((c.status === "ringing" || c.status === "connecting") && (now - (c.createdAt||0)) > 120000){
          promises.push(firebase.database().ref("calls/" + s.key).update({
            status:"ended", endedAt:now, endReason:"stuck_cleanup"
          }));
        }
      });
    };
    doClean(await firebase.database().ref("calls").orderByChild("from").equalTo(uid).once("value"));
    doClean(await firebase.database().ref("calls").orderByChild("to").equalTo(uid).once("value"));
    await Promise.all(promises);
  } catch(e){ console.warn("cleanup error", e); }
}

/* ═══════════════════════════════════════════
   END CALL — server-side payout via Cloud Function
═══════════════════════════════════════════ */
window.endCall = async function(callId){
  if(!callId) return;
  window.__endedCalls = window.__endedCalls || {};
  if(window.__endedCalls[callId]) return;
  window.__endedCalls[callId] = true;
  clearInterval(window.callTimerInterval);
  window.visualTimerStarted = false;
  window.callSecondsRemaining = 180;

  Ring.stop();
  try{ await firebase.database().ref("calls/" + callId).update({ status:"ended", endedAt:Date.now(), endedBy:(firebase.auth().currentUser || {}).uid || null }); }catch(e){}

  /* completeCallPayout is a Cloud Function that:
     - verifies call duration
     - deducts coins from caller
     - credits earnings to receiver
     - writes audit log */
  try {
    var tok = await firebase.auth().currentUser.getIdToken(true);
    await fetch(CF_BASE + "/completeCallPayout", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":"Bearer " + tok },
      body: JSON.stringify({ callId })
    });
  } catch(e){}

  await leaveVoiceChannel();
  window.__activeCallId       = null;
  window.visualTimerStarted   = false;
  window.callSecondsRemaining = 180;
  window.__callLocks          = { placing:false };
  clearPersistedCall();
  clearPhoneCallUI();
  scrollToTop();
};

/* ═══════════════════════════════════════════
   START CALL — server-side coin check + call creation
═══════════════════════════════════════════ */
window.startCallFromBtn = async function(btn){
  if(window.__activeCallId){ showToast("You're already in a call","warn"); return; }
  if(window.__callLocks.placing) return;
  window.__callLocks.placing = true;
  try {
    var user = firebase.auth().currentUser;
    if(!user){ showToast("Login required","warn"); return; }
    var targetUid = btn.dataset.uid;
    if(!targetUid || targetUid === user.uid){ showToast("Invalid target","error"); return; }
    var targetUser = (window.allUsers||{})[targetUid] || {};
    var wasOnPhone = (active === 0);
    if(!wasOnPhone){ window.setActive(0); } else { scrollToTop(); }
    /* Wait for screen transition before showing call UI */
    setTimeout(function(){ setPhoneCallUI(tplCalling(targetUser, "pending")); }, wasOnPhone ? 0 : 180);

    /* startCall Cloud Function:
       - verifies caller has enough coins
       - creates call record in DB
       - sends incoming call notification to receiver */
    var tok = await user.getIdToken(true);
    var res = await fetch(CF_BASE + "/startCall", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":"Bearer " + tok },
      body: JSON.stringify({ targetUid })
    });
    var data = await res.json();
    if(!res.ok){ showToast(data.error||"Call failed","error"); clearPhoneCallUI(); return; }

    var callId = data.callId;
    window.__activeCallId = callId;
    setPhoneCallUI(tplCalling(targetUser, callId));
    persistCall(callId, targetUser);

    var callRef = firebase.database().ref("calls/" + callId);
    callRef.on("value", async function(snap){
      var call = snap.val(); if(!call) return;
      if(call.status === "connecting" && !agoraJoined && !agoraJoining){
        callRef.off();
        await joinVoiceChannel(callId, targetUser);
      }
      if(call.status === "ended"){
        callRef.off();
        if(window.__activeCallId === callId) await window.endCall(callId);
      }
    });

    /* auto-cancel if no answer in 45s */
    setTimeout(async function(){
      if(window.__activeCallId !== callId) return;
      var s = await firebase.database().ref("calls/" + callId).once("value");
      if(s.val() && s.val().status === "ringing") await window.endCall(callId);
    }, 45000);

  } catch(e){
    console.error("startCallFromBtn error", e);
    clearPhoneCallUI();
  } finally {
    window.__callLocks.placing = false;
  }
};

/* ═══════════════════════════════════════════
   INCOMING CALL LISTENER
═══════════════════════════════════════════ */
var __incomingCallListenerUid = null;

/* ═══════════════════════════════════════════
   RINGTONE (made with Web Audio, no sound file needed)
   Plays a phone ring + vibration while a call is ringing in the open app.
═══════════════════════════════════════════ */
var Ring = (function(){
  var ctx = null, timer = null, stopAt = 0;
  function audio(){
    try{ if(!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if(ctx.state === "suspended") ctx.resume(); }catch(e){ ctx = null; }
    return ctx;
  }
  /* Browsers only allow sound after the person has tapped the page once. */
  ["pointerdown","keydown","touchstart"].forEach(function(ev){ document.addEventListener(ev, function(){ audio(); }, { once:true, passive:true }); });
  function burst(){
    var c = audio(); if(!c) return;
    var t = c.currentTime;
    [[0, 0.4], [0.6, 1.0]].forEach(function(seg){       /* two short rings, like a phone */
      [440, 480].forEach(function(f){
        var o = c.createOscillator(), g = c.createGain();
        o.frequency.value = f; o.type = "sine";
        g.gain.setValueAtTime(0, t + seg[0]);
        g.gain.linearRampToValueAtTime(0.18, t + seg[0] + 0.02);
        g.gain.setValueAtTime(0.18, t + seg[1] - 0.03);
        g.gain.linearRampToValueAtTime(0, t + seg[1]);
        o.connect(g); g.connect(c.destination); o.start(t + seg[0]); o.stop(t + seg[1] + 0.05);
      });
    });
    try{ if(navigator.vibrate) navigator.vibrate([400, 200, 400]); }catch(e){}
  }
  return {
    start: function(maxMs){
      if(timer) return;
      stopAt = Date.now() + (maxMs || 45000);
      burst();
      timer = setInterval(function(){ if(Date.now() > stopAt) return Ring.stop(); burst(); }, 3000);
    },
    stop: function(){ clearInterval(timer); timer = null; try{ if(navigator.vibrate) navigator.vibrate(0); }catch(e){} },
    test: function(){ burst(); }
  };
})();
window.Ring = Ring;

function handleIncomingCallSnap(snap){
  var call   = snap.val();
  var callId = snap.key;
  if(!call) return;

  /* The call stopped ringing (answered, declined, caller hung up, timed out). */
  if(call.status !== "ringing" && window.__activeCallId === callId){
    Ring.stop();
    if(call.status === "ended" && !call.answeredAt && !agoraJoined && !agoraJoining){
      window.__activeCallId = null;
      (window.__endedCalls = window.__endedCalls || {})[callId] = true;
      clearPersistedCall();
      clearPhoneCallUI();
      if(call.endedBy !== (firebase.auth().currentUser || {}).uid){ showToast("📞 Missed call from " + (call.callerName || "someone"), "warn", 6000); }
    }
    return;
  }

  /* Respect calls disabled toggle, and people you blocked */
  if((window.me && window.me.callsEnabled === false) || (call.status === "ringing" && (window.__myBlocks||{})[call.from])){
    firebase.database().ref("calls/" + snap.key)
      .update({ status:"ended", endedAt:Date.now(), endReason:"unavailable" });
    return;
  }

  /* Only act on fresh ringing calls */
  if(call.status !== "ringing") return;
  if((Date.now() - (call.createdAt||0)) > 90000){
    firebase.database().ref("calls/" + callId)
      .update({ status:"ended", endedAt:Date.now(), endReason:"stale" });
    return;
  }
  if(window.__activeCallId && window.__activeCallId !== callId) return;
  if((window.__endedCalls||{})[callId]) return;

  window.__activeCallId = callId;

  /* Ring in the open app. A tab in the background also gets the push alert
     (same tag as the push, so they never show twice). */
  Ring.start(Math.max(5000, 45000 - (Date.now() - (call.createdAt || Date.now()))));
  if(document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted" && !window.__fcmReady){
    try{
      new Notification("📞 " + (call.callerName || "Someone") + " is calling", {
        body: "Tap to answer on Whisper+Me",
        icon: "/icon-192.png",
        tag:  "call-" + callId,
        requireInteraction: true
      });
    }catch(e){}
  }

  if(active !== 0){ window.setActive(0); } else { scrollToTop(); }
  /* Small delay ensures render completes before injecting call UI */
  setTimeout(function(){
    setPhoneCallUI(tplIncoming(callId, call));
  }, active !== 0 ? 180 : 0);

  setTimeout(function(){
    var acc = document.getElementById("phone-accept-btn");
    var rej = document.getElementById("phone-reject-btn");
    var user = firebase.auth().currentUser;
    if(!acc || !user) return;

    acc.onclick = async function(){
      Ring.stop();
      acc.disabled = true;
      try {
        var tok = await user.getIdToken(true);
        var r   = await fetch(CF_BASE + "/acceptCallBilling", {
          method: "POST",
          headers: { "Content-Type":"application/json", "Authorization":"Bearer " + tok },
          body: JSON.stringify({ callId })
        });
        var d = await r.json();
        if(!r.ok){ showToast(d.error||"Billing failed","error"); await window.endCall(callId); return; }
      } catch(e){ await window.endCall(callId); return; }

      await firebase.database().ref("calls/" + callId)
        .update({ status:"connecting", answeredAt:Date.now() });
      var callerUser = (window.allUsers||{})[call.from]
        || { name:call.callerName, photo:call.callerPhoto };
      persistCall(callId, callerUser);
      await joinVoiceChannel(callId, callerUser);
    };

    if(rej) rej.onclick = async function(){ Ring.stop(); await window.endCall(callId); };
    /* Opened by tapping "Answer" on the phone's call alert */
    var auto = new URLSearchParams(window.__initialSearch || "").get("answer");
    if(auto && auto === callId && !window.__autoAnswered){ window.__autoAnswered = true; setTimeout(function(){ if(!acc.disabled) acc.click(); }, 400); }
  }, 80);
}

function attachIncomingCallListener(uid){
  if(__incomingCallListenerUid === uid) return; /* already attached */
  __incomingCallListenerUid = uid;

  var ref = firebase.database().ref("calls")
    .orderByChild("to").equalTo(uid);

  /* child_added fires for all existing + new ringing calls */
  ref.on("child_added", handleIncomingCallSnap);

  /* child_changed catches a call that was written before listener attached
     and whose status just changed to ringing */
  ref.on("child_changed", handleIncomingCallSnap);

  /* Request notification permission once */
  if(typeof Notification !== "undefined" && Notification.permission === "default"){
    Notification.requestPermission().catch(function(){});
  }
}

/* Answer / Decline tapped on the phone's call alert while the app is open */
if(navigator.serviceWorker){
  navigator.serviceWorker.addEventListener("message", function(e){
    var d = e.data || {};
    if(!d.callId || d.callId !== window.__activeCallId) return;
    if(d.type === "decline_call"){ window.endCall(d.callId); }
    if(d.type === "answer_call"){ var b = document.getElementById("phone-accept-btn"); if(b && !b.disabled) b.click(); }
  });
}

/* People this member blocked (Profile card → Block): no calls, hidden from lists */
window.__myBlocks = {};
firebase.auth().onAuthStateChanged(function(user){
  if(window.__blocksRef){ try{ window.__blocksRef.off(); }catch(e){} window.__blocksRef = null; }
  window.__myBlocks = {};
  if(!user || user.isAnonymous) return;
  window.__blocksRef = firebase.database().ref("blocks/" + user.uid);
  window.__blocksRef.on("value", function(s){ window.__myBlocks = s.val() || {}; }, function(){});
});

/* Attach as soon as auth is ready — works even after refresh */
firebase.auth().onAuthStateChanged(function(user){
  if(user) attachIncomingCallListener(user.uid);
  else     __incomingCallListenerUid = null;
});

/* ── Site Notification Banner ──
   Admin can post a dismissible in-app banner from the admin dashboard
   (siteNotifications/). Shows the newest active one; once a user dismisses
   a given notification it won't reappear for them (tracked by id). */
function showSiteNotificationBanner(id, title, body, linkUrl, linkText){
  var existing = document.getElementById("site-notif-banner");
  if(existing) existing.remove();

  var dismissed;
  try { dismissed = JSON.parse(localStorage.getItem("wpm_dismissed_notifs") || "[]"); } catch(e){ dismissed = []; }
  if(dismissed.indexOf(id) !== -1) return;

  /* one-time keyframes for the slide-down entrance, injected once */
  if(!document.getElementById("site-notif-style")){
    var styleEl = document.createElement("style");
    styleEl.id = "site-notif-style";
    styleEl.textContent = "@keyframes wpmBannerIn{from{transform:translateY(-100%);opacity:0;}to{transform:translateY(0);opacity:1;}}"
      + "#site-notif-banner a{color:#fff;text-decoration:underline;font-weight:700;white-space:nowrap;}"
      + "#site-notif-banner a:hover{opacity:0.85;}";
    document.head.appendChild(styleEl);
  }

  var el = document.createElement("div");
  el.id = "site-notif-banner";
  el.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9998;"
    + "background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff;"
    + "padding:12px 20px;display:flex;align-items:center;justify-content:center;"
    + "flex-wrap:wrap;gap:10px 16px;row-gap:6px;"
    + "font-size:13px;line-height:1.4;box-shadow:0 2px 10px rgba(0,0,0,0.3);"
    + "animation:wpmBannerIn 0.35s ease-out;box-sizing:border-box;";

  var textWrap = document.createElement("div");
  textWrap.style.cssText = "max-width:640px;text-align:center;display:flex;align-items:center;flex-wrap:wrap;justify-content:center;gap:8px;";
  textWrap.innerHTML = "<span><b>" + title.replace(/</g,"&lt;") + "</b>"
    + (body ? " — " + body.replace(/</g,"&lt;") : "") + "</span>"
    + (linkUrl ? "<a href='" + linkUrl.replace(/"/g,"%22") + "' target='_blank' rel='noopener noreferrer'>" + (linkText||"Learn more").replace(/</g,"&lt;") + " \u2192</a>" : "");

  var dismissBtn = document.createElement("button");
  dismissBtn.id = "site-notif-dismiss";
  dismissBtn.setAttribute("aria-label", "Dismiss");
  dismissBtn.textContent = "\u2715";
  dismissBtn.style.cssText = "flex-shrink:0;background:rgba(0,0,0,0.2);border:none;color:#fff;"
    + "width:24px;height:24px;min-width:24px;padding:0;margin:0;border-radius:50%;cursor:pointer;"
    + "font-size:13px;line-height:1;box-sizing:border-box;"
    + "display:flex;align-items:center;justify-content:center;";

  el.appendChild(textWrap);
  el.appendChild(dismissBtn);
  document.body.appendChild(el);

  dismissBtn.onclick = function(){
    el.remove();
    try {
      var d = JSON.parse(localStorage.getItem("wpm_dismissed_notifs") || "[]");
      d.push(id);
      if(d.length > 50) d = d.slice(-50); /* keep it from growing forever */
      localStorage.setItem("wpm_dismissed_notifs", JSON.stringify(d));
    } catch(e){}
  };
}

firebase.auth().onAuthStateChanged(function(user){
  if(!user) return;
  firebase.database().ref("siteNotifications").orderByChild("ts").limitToLast(1)
    .on("value", function(snap){
      snap.forEach(function(s){
        var n = s.val();
        if(n && n.active !== false) showSiteNotificationBanner(s.key, n.title || "", n.body || "", n.linkUrl || "", n.linkText || "");
      });
    });
});


/* ═══════════════════════════════════════════
   PROFILE CARDS (screen 0, below phone)
═══════════════════════════════════════════ */
window.renderProfileCards = function(){
  if(!currentUser) return;
  var container = document.getElementById("membersContainer");
  if(!container) return;

  if(active !== 0){
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  container.style.display = "block";

  var users  = Object.entries(window.allUsers||{});
  var myUid  = currentUser.uid;
  var others = users.filter(function(e){ return e[0] !== myUid && !(window.__myBlocks||{})[e[0]]; });

  /* If allUsers not yet loaded from Firebase, wait and retry */
  if(!window.__usersListenerAttached || (users.length === 0 && !window.__allUsersLoaded)){
    container.style.cssText = "display:block;width:100%;max-width:960px;margin:0 auto;box-sizing:border-box;";
    container.innerHTML = "<p style='text-align:center;color:#555;font-size:13px;padding:30px;'>Loading members…</p>";
    if(!window.__profileCardRetryTimer){
      window.__profileCardRetryTimer = setTimeout(function(){
        window.__profileCardRetryTimer = null;
        window.renderProfileCards();
      }, 1500);
    }
    return;
  }
  window.__allUsersLoaded = true;

  /* max-width matches .content, fully centered */
  container.style.cssText = "display:block;width:100%;max-width:960px;margin:0 auto;box-sizing:border-box;";

  var bannerHTML = "<div class='hiw-wrap'><div class='hiw-banner'>"
    + "<div class='hiw-title'>✨ How Whisper+Me Works</div>"
    + "<div class='hiw-cols'>"
    + "<div class='hiw-col'><div class='hiw-icon'>🪙</div><div class='hiw-label'>Buy Coins</div><div class='hiw-desc'>$3 per coin to call members</div></div>"
    + "<div class='hiw-col'><div class='hiw-icon'>📞</div><div class='hiw-label'>Call a Whisper</div><div class='hiw-desc'>Browse & tap Call to connect</div></div>"
    + "<div class='hiw-col'><div class='hiw-icon'>💰</div><div class='hiw-label'>Earn Money</div><div class='hiw-desc'>Set your rate · $2/coin earned</div></div>"
    + "</div></div></div>";

  if(!others.length){
    container.innerHTML = bannerHTML
      + "<p style='text-align:center;color:#444;font-size:13px;padding:20px;'>No other members yet</p>";
    return;
  }

  var html = "<div class='cards-wrap'><div class='member-cards-grid'>";
  for(var i = 0; i < others.length; i++){
    var uid   = others[i][0];
    var u     = others[i][1];
    var photo = sanitize(u.photo||"");
    var fb    = "https://dummyimage.com/300x300/111/444&text=W%2BMe";
    var name  = sanitize(u.name||"User");
    var bio   = sanitize(u.bio||"");
    var price = Number(u.price||1);
    var soc   = "";
    if(u.instagram) soc += "<a href='" + (u.instagram.startsWith("http") ? u.instagram : "https://instagram.com/" + u.instagram)
      + "' target='_blank' rel='noopener noreferrer' style='text-decoration:none;font-size:12px;'>📸</a>";
    if(u.twitter)   soc += "<a href='" + sanitize(u.twitter) + "' target='_blank' rel='noopener noreferrer' "
      + "style='text-decoration:none;font-size:12px;'>🐦</a>";
    if(u.website)   soc += "<a href='" + sanitize(u.website) + "' target='_blank' rel='noopener noreferrer' "
      + "style='text-decoration:none;font-size:12px;'>🌐</a>";

    html += "<div class='member-card' onclick=\"showProfileModal('" + uid + "')\">";
    html += "<div class='member-card-img'>";
    html += "<img src='" + (photo||fb) + "' onerror=\"this.src='" + fb + "'\" alt='" + name + "'>";
    if(u.online) html += "<div class='member-card-live-dot'></div>";
    html += "</div>";
    html += "<div class='member-card-body'>";
    html += "<div class='member-card-name'>" + name + "</div>";
    if(u.online) html += "<div style='font-size:10px;font-weight:700;color:#00e3ae;margin-bottom:2px'>&#9679; Online</div>";
    html += "<div class='member-card-bio'>" + bio + "</div>";
    html += "<div class='member-card-price'>" + price + "🪙 $" + (price*3) + "/call</div>";
    if(soc) html += "<div class='member-card-socials'>" + soc + "</div>";
    html += "</div>";
    html += "<div class='member-card-actions' onclick='event.stopPropagation()'>";
    html += "<button class='member-call-btn' data-uid='" + uid + "' onclick='startCallFromBtn(this)'>📞 Call</button>";
    html += "<button class='member-share-btn' onclick=\"shareProfile('" + uid + "')\" aria-label='Share'>🔗</button>";
    html += "</div></div>";
  }
  html += "</div></div>";
  container.innerHTML = bannerHTML + html;
};

/* ═══════════════════════════════════════════
   MEMBER CHAT ROOMS
═══════════════════════════════════════════ */
var memberRoomsListener = null;

function renderMemberRooms(){
  var grid = document.getElementById("memberRoomsGrid");
  if(!grid) return;

  /* Detach any previous listener */
  if(memberRoomsListener){
    try{ firebase.database().ref("memberRooms").off("value", memberRoomsListener); }catch(e){}
    memberRoomsListener = null;
  }

  memberRoomsListener = firebase.database().ref("memberRooms").orderByChild("createdAt").on("value", function(snap){
    var grid2 = document.getElementById("memberRoomsGrid");
    if(!grid2) return;
    var rooms = [];
    snap.forEach(function(c){ rooms.push(Object.assign({ id: c.key }, c.val())); });
    rooms.reverse();

    if(!rooms.length){
      grid2.innerHTML = "<div style='text-align:center;color:#555;font-size:13px;padding:20px;grid-column:1/-1;'>No member rooms yet — be the first to create one!</div>";
      return;
    }

    var html = "";
    rooms.forEach(function(r){
      var ownerPhoto = sanitize(r.ownerPhoto || "https://dummyimage.com/200x200/111/444&text=W");
      var ownerName  = sanitize(r.ownerName  || "Host");
      var roomName   = sanitize(r.name       || "Room");
      var cost       = Number(r.cost || 1);
      var occupants  = Number(r.occupants || 0);
      var available  = Math.max(0, 10 - occupants);
      var isActive   = activeRoom === r.id;
      var isMine     = currentUser && r.ownerId === currentUser.uid;

      html += "<div class='mroom-card" + (isActive ? " mroom-active" : "") + "' data-roomid='" + sanitize(r.id) + "'>";
      html += "<div class='mroom-avatar-wrap'>"
        + "<img class='mroom-avatar' src='" + ownerPhoto + "' "
        + "onerror=\"this.src='https://dummyimage.com/200x200/111/444&text=W'\" alt='" + ownerName + "'>"
        + "</div>";
      html += "<div class='mroom-body'>";
      html += "<div class='mroom-name'>" + roomName + "</div>";
      html += "<div class='mroom-host'>by " + ownerName + "</div>";
      html += "<div class='mroom-meta'>"
        + "<span class='mroom-cost'>" + cost + "🪙 · 3 min</span>"
        + "<span class='mroom-slots" + (available === 0 ? " mroom-full" : "") + "'>"
        + (available === 0 ? "🔴 Full" : available + " open")
        + "</span></div>";
      html += "<div class='mroom-actions'>";
      var isClosing = !!r.closing;
      if(isMine){
        /* Creator is always in the fullscreen page — just show a re-enter button */
        html += "<button class='mroom-join-btn' onclick='restoreCreatorRoomIfNeeded()' "
          + "style='background:rgba(123,47,247,0.3);'>🏠 Manage Room</button>";
      } else if(isClosing){
        html += "<button class='mroom-join-btn mroom-join-disabled' disabled>⏳ Closing…</button>";
      } else if(available > 0){
        html += "<button class='mroom-join-btn' onclick=\"joinMemberRoom(" + jsAttr(r.id) + "," + jsAttr(r.name || "Room") + "," + cost + ")\">Enter " + cost + "🪙</button>";
      } else {
        html += "<button class='mroom-join-btn mroom-join-disabled' disabled>Room Full</button>";
      }
      html += "</div></div></div>";
    });
    grid2.innerHTML = html;
  });
}

window.showCreateRoomModal = function(){
  if(!currentUser){ showToast("Login required","warn"); return; }
  if(isGuest()){ promptGuestUpgrade("Creating a member room"); return; }
  var modal = document.getElementById("profileModal");
  var body  = document.getElementById("profileModalBody");
  if(!modal || !body) return;

  body.innerHTML = "<div style='padding:28px 20px;'>"
    + "<div style='font-size:20px;font-weight:800;color:#fff;margin-bottom:4px;text-align:center;'>🏠 Create a Room</div>"
    + "<div style='font-size:13px;color:#888;text-align:center;margin-bottom:20px;'>Up to 10 members · 3 min sessions · You earn the coins</div>"
    + "<div style='margin-bottom:14px;'>"
    + "<label style='font-size:12px;color:#aaa;display:block;margin-bottom:6px;'>Room Name</label>"
    + "<input id='newRoomName' placeholder='e.g. Late Night Vibes' maxlength='40' "
    + "style='width:100%;padding:12px 14px;border-radius:14px;border:1px solid rgba(123,47,247,0.4);"
    + "background:#0d0d1a;color:#fff;font-size:14px;box-sizing:border-box;outline:none;'>"
    + "</div>"
    + "<div style='margin-bottom:20px;'>"
    + "<label style='font-size:12px;color:#aaa;display:block;margin-bottom:6px;'>Entry Cost (1–10 coins per member)</label>"
    + "<select id='newRoomCost' style='width:100%;padding:12px 14px;border-radius:14px;border:1px solid rgba(123,47,247,0.4);"
    + "background:#0d0d1a;color:#fff;font-size:14px;box-sizing:border-box;'>"
    + [1,2,3,4,5,6,7,8,9,10].map(function(n){
        return "<option value='" + n + "'>" + n + " coin" + (n>1?"s":"") + " ($" + (n*3) + " value)</option>";
      }).join("")
    + "</select>"
    + "</div>"
    + "<button onclick='doCreateMemberRoom()' "
    + "style='width:100%;padding:14px;border-radius:22px;border:none;"
    + "background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff;font-size:15px;"
    + "font-weight:700;cursor:pointer;min-height:48px;'>🏠 Create Room</button>"
    + "</div>";

  modal.style.display = "flex";
};

window.doCreateMemberRoom = function(){
  if(!currentUser){ showToast("Login required","warn"); return; }

  /* Enforce 1 room per member */
  firebase.database().ref("memberRooms")
    .orderByChild("ownerId").equalTo(currentUser.uid)
    .once("value").then(function(existing){
      var hasRoom = false;
      existing.forEach(function(c){ if(c.val() && !c.val().closing) hasRoom = true; });
      if(hasRoom){
        showToast("You already have an open room — close it first","warn");
        window.closeProfileModal();
        restoreCreatorRoomIfNeeded();
        return;
      }

      var nameEl = document.getElementById("newRoomName");
      var costEl = document.getElementById("newRoomCost");
      var name   = (nameEl ? nameEl.value : "").trim();
      var cost   = Number(costEl ? costEl.value : 1);

      if(!name){ showToast("Enter a room name","warn"); return; }

      var me     = window.me || {};
      var roomId = "mr_" + currentUser.uid.slice(0,8) + "_" + Date.now();

      firebase.database().ref("memberRooms/" + roomId).set({
        id:         roomId,
        name:       name,
        cost:       cost,
        ownerId:    currentUser.uid,
        ownerName:  me.name  || "Host",
        ownerPhoto: me.photo || "",
        occupants:  0,
        closing:    false,
        createdAt:  Date.now()
      }).then(function(){
        window.closeProfileModal();
        window.openMemberRoomPage(roomId, name, cost);
      }).catch(function(e){ showToast("Error creating room: " + e.message,"error"); });
    }).catch(function(e){ showToast("Error checking rooms: " + e.message,"error"); });
};

window.deleteMemberRoom = function(roomId){
  if(!currentUser) return;
  showConfirm("Close this room?", function(){
    firebase.database().ref("memberRooms/" + roomId).remove()
      .catch(function(e){ showToast("Error: " + e.message,"error"); });
  });
};

/* ── Member room Agora voice state ── */
var memberRoomAgoraClient = null;
var memberRoomAgoraTrack  = null;
var memberRoomAgoraJoined = false;

async function joinMemberRoomVoice(roomId, publishImmediately){
  await loadAgora();
  if(memberRoomAgoraJoined) return;
  try {
    /* Request mic permission up-front so the first member doesn't hit a permission error */
    if(publishImmediately !== false){
      try { await navigator.mediaDevices.getUserMedia({ audio: true }); } catch(permErr){
        showToast("Microphone access denied — please allow mic in browser settings","error");
        return;
      }
    }

    /* FIX: Use "rtc" mode (not "live") — in "live" mode hosts don't receive audio from
       other hosts who were already publishing when they joined, so members never heard
       the creator. "rtc" mode is fully bidirectional — everyone hears everyone. */
    memberRoomAgoraClient = AgoraRTC.createClient({ mode:"rtc", codec:"vp8" });

    memberRoomAgoraClient.on("user-published", async function(remote, mediaType){
      await memberRoomAgoraClient.subscribe(remote, mediaType);
      if(mediaType === "audio"){
        try{ await AgoraRTC.resumeAudioContext(); }catch(e){}
        remote.audioTrack.play();
      }
    });
    memberRoomAgoraClient.on("user-unpublished", function(remote){
      if(remote.audioTrack) remote.audioTrack.stop();
    });

    /* rtc mode: no setClientRole needed — all participants publish/subscribe freely */
    var mrToken = await fetchAgoraToken("mroom_" + roomId);
    await memberRoomAgoraClient.join(AGORA_APP_ID, "mroom_" + roomId, mrToken, null);

    /* Only create + publish mic track if publishImmediately === true (members) OR
       if we are a member (not the creator waiting for members) */
    if(publishImmediately !== false){
      memberRoomAgoraTrack = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig:"music_standard" });
      await memberRoomAgoraClient.publish([memberRoomAgoraTrack]);
    }
    memberRoomAgoraJoined = true;
  } catch(e){
    console.warn("Member room voice error:", e);
    showToast("Voice connection failed: " + e.message, "error");
  }
}

/* Creator calls this to start their mic once the first member arrives */
async function publishCreatorMic(){
  await loadAgora();
  if(!memberRoomAgoraClient || !memberRoomAgoraJoined) return;
  if(memberRoomAgoraTrack) return; /* already publishing */
  try {
    memberRoomAgoraTrack = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig:"music_standard" });
    await memberRoomAgoraClient.publish([memberRoomAgoraTrack]);
  } catch(e){ console.warn("publishCreatorMic error", e); }
}

async function leaveMemberRoomVoice(){
  try{
    if(memberRoomAgoraTrack){ memberRoomAgoraTrack.stop(); memberRoomAgoraTrack.close(); memberRoomAgoraTrack = null; }
    if(memberRoomAgoraClient){ await memberRoomAgoraClient.leave(); memberRoomAgoraClient = null; }
  }catch(e){}
  memberRoomAgoraJoined = false;
}

window.joinMemberRoom = function(roomId, roomName, cost){
  if(!currentUser){ showToast("Login required","warn"); return; }
  if(isGuest()){ promptGuestUpgrade("Paid member rooms"); return; }

  /* ── Double-tap debounce (client-side UI guard only) ── */
  if(window.__joiningRoomId === roomId) return;
  window.__joiningRoomId = roomId;

  /* Quick coin pre-check so user gets instant feedback */
  var coins = (window.me && window.me.coins) || 0;
  if(coins < cost){
    showToast("You need " + cost + " coin" + (cost>1?"s":"") + " to enter — buy coins in Dashboard","warn");
    window.__joiningRoomId = null;
    return;
  }

  currentUser.getIdToken(true).then(function(tok){
    return fetch(CF_BASE + "/joinMemberRoom", {
      method:  "POST",
      headers: { "Content-Type":"application/json", "Authorization":"Bearer " + tok },
      body:    JSON.stringify({ roomId: roomId })
    });
  }).then(function(res){ return res.json().then(function(d){ return { ok: res.ok, status: res.status, d: d }; }); })
  .then(function(r){
    window.__joiningRoomId = null;
    var d = r.d;

    if(!r.ok){
      /* 429 cooldown — user is within 4-min window, let them back in view only */
      if(r.status === 429 && d.cooldown){
        var waitMsg = d.waitSecs > 0
          ? "⏳ " + d.waitSecs + "s cooldown before next session (1 min after your 3-min call)"
          : "Re-entering room…";
        showToast(waitMsg,"warn",5000);
        /* Re-fetch room data so we can pass it to switchToMemberRoom */
        firebase.database().ref("memberRooms/" + roomId).once("value").then(function(snap){
          var rr = snap.val() || {};
          if(active !== 1) window.setActive(1);
          switchToMemberRoom(roomId, roomName, rr);
          joinMemberRoomVoice(roomId, true);
        });
        return;
      }
      showToast(d.error || "Could not join room","error");
      return;
    }

    /* Success */
    var endTs = d.endTs;

    /* Update local coin cache */
    if(window.me && !d.alreadyIn) window.me.coins = Math.max(0, (window.me.coins||0) - cost);

    /* Re-fetch room data for creator banner */
    firebase.database().ref("memberRooms/" + roomId).once("value").then(function(snap){
      var rr = snap.val() || {};
      if(active !== 1) window.setActive(1);
      switchToMemberRoom(roomId, roomName, rr);

      if(!d.alreadyIn) showToast("You're in! 3 minutes starts now 🎉","success");

      /* Join Agora voice — members publish mic immediately */
      joinMemberRoomVoice(roomId, true);

      /* Auto-release on client side (CF does server-side cleanup too) */
      var msLeft = Math.max(0, endTs - Date.now());
      window.__mrSessionTimeout = setTimeout(function(){
        leaveMemberRoomVoice();
        firebase.database().ref("memberRoomSessions/" + roomId + "/" + currentUser.uid).remove();
        firebase.database().ref("memberRooms/" + roomId + "/occupants").transaction(function(c){
          return Math.max(0, (Number(c||0)) - 1);
        });
        showToast("Your 3-minute session ended — returning to General","warn",4000);
        window.switchRoom("general");
      }, msLeft);
    });

  }).catch(function(e){
    window.__joiningRoomId = null;
    showToast("Error joining room: " + e.message,"error");
  });
};

/* Lets a JOINING member (not the creator) leave a paid room before their
   3-minute session runs out. Cancels the auto-expiry timer so occupants
   doesn't get decremented twice. */
window.leaveMemberRoomEarly = function(){
  if(!currentUser || !activeRoom || activeRoom.indexOf("mr_") !== 0) return;
  var roomId = activeRoom;

  if(window.__mrSessionTimeout){
    clearTimeout(window.__mrSessionTimeout);
    window.__mrSessionTimeout = null;
  }

  leaveMemberRoomVoice();
  firebase.database().ref("memberRoomSessions/" + roomId + "/" + currentUser.uid).remove();
  firebase.database().ref("memberRooms/" + roomId + "/occupants").transaction(function(c){
    return Math.max(0, (Number(c||0)) - 1);
  });

  var banner = document.getElementById("mr-creator-banner");
  if(banner && banner.parentNode) banner.parentNode.removeChild(banner);

  showToast("You left the room","");
  window.switchRoom("general");
};

function switchToMemberRoom(roomId, roomName, roomData){
  /* Navigate to chat tab first */
  if(active !== 1){
    active = 1;
    render();
  }

  if(chatListener){
    try{ firebase.database().ref("chat/" + activeRoom).off("value", chatListener); }catch(e){}
    chatListener = null;
  }
  activeRoom = roomId;
  chatMessages = [];
  updatePresenceRoom(roomId, isGuest());

  var hdr = document.getElementById("phoneChatRoomName");
  if(hdr) hdr.textContent = "🏠 " + sanitize(roomName);

  /* Hide the live mic button — not allowed in member rooms */
  var liveMicBtn = document.querySelector("#phoneChatWrap .phone-chat-header button");
  if(liveMicBtn) liveMicBtn.style.display = "none";

  /* Show creator info at the top of the chat */
  var chatWrap = document.getElementById("phoneChatWrap");
  if(chatWrap && roomData){
    var ownerPhoto = sanitize(roomData.ownerPhoto || "https://dummyimage.com/200x200/111/444&text=W");
    var ownerName  = sanitize(roomData.ownerName  || "Host");
    var existingBanner = document.getElementById("mr-creator-banner");
    if(!existingBanner){
      var banner = document.createElement("div");
      banner.id = "mr-creator-banner";
      banner.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 14px;"
        + "background:rgba(123,47,247,0.15);border-bottom:1px solid rgba(123,47,247,0.3);"
        + "flex-shrink:0;";
      banner.innerHTML = "<img src='" + ownerPhoto + "' "
        + "onerror=\"this.src='https://dummyimage.com/200x200/111/444&text=W'\" "
        + "style='width:38px;height:38px;border-radius:50%;object-fit:cover;"
        + "border:2px solid #7b2ff7;flex-shrink:0;'>"
        + "<div>"
        + "<div style='font-size:12px;color:#888;font-weight:600;'>Room Host</div>"
        + "<div style='font-size:14px;font-weight:700;color:#fff;'>" + ownerName + "</div>"
        + "</div>"
        + "<div style='margin-left:auto;display:flex;align-items:center;gap:10px;'>"
        + "<div style='font-size:11px;color:#00e3ae;font-weight:600;'>🎙️ Live Voice</div>"
        + "<button onclick=\"shareMemberRoom(" + jsAttr(activeRoom) + "," + jsAttr(roomName) + "," + jsAttr(roomData.cost||1) + ")\" "
        + "style='background:rgba(123,47,247,0.25);border:1px solid rgba(123,47,247,0.5);"
        + "color:#fff;border-radius:14px;padding:5px 10px;font-size:11px;font-weight:700;"
        + "cursor:pointer;flex-shrink:0;' aria-label='Share this room' title='Share this room'>🔗 Share</button>"
        + "<button onclick='leaveMemberRoomEarly()' "
        + "style='background:rgba(229,57,53,0.2);border:1px solid rgba(229,57,53,0.5);"
        + "color:#ff8080;border-radius:14px;padding:5px 10px;font-size:11px;font-weight:700;"
        + "cursor:pointer;flex-shrink:0;' aria-label='Leave this room' title='Leave this room'>🚪 Leave</button>"
        + "</div>";
      /* Insert after header */
      var header = chatWrap.querySelector(".phone-chat-header");
      if(header && header.nextSibling){
        chatWrap.insertBefore(banner, header.nextSibling);
      } else {
        chatWrap.insertBefore(banner, chatWrap.firstChild);
      }
    }
  }

  var box = document.getElementById("phoneChatMsgs");
  if(box) box.innerHTML = "<p style='text-align:center;color:#555;font-size:12px;padding:20px;'>Loading…</p>";

  document.querySelectorAll(".room-card").forEach(function(c){ c.classList.remove("active-room"); });
  document.querySelectorAll(".mroom-card").forEach(function(c){
    if(c.getAttribute("data-roomid") === roomId) c.classList.add("mroom-active");
    else c.classList.remove("mroom-active");
  });

  bootChat();
}

/* ═══════════════════════════════════════════
   SHARE PROFILE
═══════════════════════════════════════════ */
/* ── DELETE ACCOUNT ──
   Real friction on purpose — this is irreversible. Confirm dialog
   explaining consequences, then require typing DELETE to proceed. */
window.confirmDeleteOwnAccount = function(){
  if(!currentUser || isGuest()) return;
  if(!confirm("Delete your account permanently?\n\nThis removes your profile, coin balance, Stripe connection, and call history from your account. It cannot be undone. Your past chat messages stay in the rooms — this only removes your account itself.")) return;
  var typed = prompt("Type DELETE to confirm — this cannot be undone.");
  if(typed !== "DELETE"){
    if(typed !== null) showToast("Didn't match — account not deleted","warn");
    return;
  }
  runDeleteAccount(currentUser.uid, true);
};

/* Shared by both the member's own delete button and the admin panel's
   version. selfDelete signs the browser out afterward; admin-triggered
   deletions of someone else's account don't need that. */
function runDeleteAccount(targetUid, selfDelete){
  if(!currentUser) return;
  /* Private email isn't covered by the server cleanup yet, so clear it first */
  firebase.database().ref("userPrivate/" + targetUid).remove().catch(function(){})
  .then(function(){ return currentUser.getIdToken(); }).then(function(idToken){
    return fetch(CF_BASE + "/deleteAccount", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + idToken },
      body: JSON.stringify({ targetUid: targetUid })
    });
  }).then(function(res){ return res.json().then(function(data){ return { ok: res.ok, data: data }; }); })
    .then(function(result){
      if(!result.ok) throw new Error(result.data.error || "Delete failed");
      showToast("Account deleted","success");
      if(selfDelete){
        setTimeout(function(){ firebase.auth().signOut(); }, 800);
      }
    })
    .catch(function(e){
      showToast("Couldn't delete account: " + e.message, "error");
    });
}

window.shareProfile = function(uid){
  if(!uid && currentUser) uid = currentUser.uid;
  if(!uid){ showToast("Not logged in","warn"); return; }
  var isSelf = currentUser && uid === currentUser.uid;
  var user   = isSelf ? (window.me||{}) : ((window.allUsers||{})[uid]||{});
  var name   = user.name  || "a creator";
  var bio    = user.bio   || "";
  var price  = user.price || 1;
  var calls  = user.calls || 0;
  var url    = location.origin + "/u/" + uid;
  var blurb  = bio ? "\u201c" + bio.slice(0,60) + (bio.length>60?"\u2026":"") + "\u201d" : "anonymous voice calls";

  var statLine = (calls > 0)
    ? calls + " call" + (calls === 1 ? "" : "s") + " taken \u00b7 " + price + " coin ($" + (price*3) + ") per call"
    : price + " coin ($" + (price*3) + ") per call";

  var text = "\ud83c\udfa4 " + name + " \u2014 " + blurb
             + "\n" + statLine + " \u00b7 Whisper+Me";

  /* Real-time online check makes this genuinely dynamic, not boilerplate */
  firebase.database().ref("presence/" + uid).once("value").then(function(snap){
    if(snap.exists()){
      text = "\ud83c\udfa4 " + name + " \u2014 \ud83d\udfe2 Online now\n" + blurb
             + "\n" + statLine + " \u00b7 Whisper+Me";
    }
  }).catch(function(){}).then(function(){
    openShareSheet("Whisper+Me \xb7 " + name, text, url, uid, "profile");
  });
};

/* ═══════════════════════════════════════════
   INFO MODALS — Profile Setup / How It Works / Earn & Advertise
═══════════════════════════════════════════ */
window.showInfoModal = function(type){
  var modal = document.getElementById("profileModal");
  var body  = document.getElementById("profileModalBody");
  if(!modal || !body) return;

  var content = {
    setup: {
      icon: "🪄",
      title: "Setting Up Your Profile",
      color: "#b08fff",
      sections: [
        { emoji: "📛", head: "1. Display Name", text: "Open the 👤 Profile tab, type your name and tap Save changes. It shows on your card everywhere." },
        { emoji: "📸", head: "2. Profile Photo", text: "Tap your picture at the top of the Profile tab. A clear, friendly photo gets far more calls. It uploads right away." },
        { emoji: "✍️", head: "3. Write a Bio", text: "A short bio (1–2 sentences) tells callers what you're about. Be genuine — 'great listener, love deep talks' converts better than vague." },
        { emoji: "💲", head: "4. Set Your Price", text: "Profile → Calls: tap 1–10 coins per call ($3–$30). New members do well starting at 1–2 coins. Raise it as you grow." },
        { emoji: "🏦", head: "5. Set Up Payouts", text: "Profile → Wallet → Set up payouts. Stripe is free and pays your earnings to your bank. Without it, earnings add up but you can't cash out." },
        { emoji: "📞", head: "6. Be Reachable", text: "Profile → Calls: keep Let people call me on, and turn on call alerts so your phone rings even when the app is closed." }
      ]
    },
    howworks: {
      icon: "⚡",
      title: "How Whisper+Me Works",
      color: "#00e3ae",
      sections: [
        { emoji: "🎙️", head: "1-on-1 Voice Calls", text: "Members spend coins to call people they want to talk to. Calls are voice-only, so you choose what you share." },
        { emoji: "🪙", head: "The Coin System", text: "Callers buy coins at $3 each. Each coin spent during a call pays you $2 (you keep 67%). The site keeps $1 per coin to cover hosting and payment fees." },
        { emoji: "💬", head: "Live Rooms", text: "Free public rooms let anyone chat or grab the Live Mic, no coins needed. The fastest way to get seen." },
        { emoji: "🏠", head: "Member Rooms", text: "Create a private voice room and charge a per-minute coin fee. Callers pay to join; you earn the same $2/coin rate." },
        { emoji: "💰", head: "Payouts", text: "Earnings accumulate in your account. Payouts happen every 24 hours for any balance over $50. Connect Stripe to receive transfers automatically." },
        { emoji: "📵", head: "Early Hang-Ups", text: "Disconnecting a call early (under ~30 seconds) can flag the payment for review. Repeated early hang-ups may result in payment suspension for that session. Finish calls properly." },
        { emoji: "🔒", head: "You're in control", text: "No face required. Turn calls on or off any time in Profile → Calls. Block or report anyone from the call screen." }
      ]
    },
    earn: {
      icon: "💰",
      title: "Earning & Advertising",
      color: "#ff9f43",
      sections: [
        { emoji: "💵", head: "Your Earnings Rate", text: "You earn $2 for every coin a caller spends with you. Example: a 5-coin call = $10 in your pocket. The more callers, the more you earn." },
        { emoji: "⏱️", head: "Payout Schedule", text: "Payouts are processed every 24 hours. Any balance over $50 is sent to your Stripe account automatically. No minimum waiting period after that threshold." },
        { emoji: "📵", head: "Hang-Up Policy", text: "Ending a call within the first ~30 seconds can trigger a payment hold. Repeated early disconnects may result in earnings being withheld for those sessions. Stay on calls." },
        { emoji: "🔗", head: "Share Button = Your Best Ad", text: "The 🔗 Share profile button generates a direct link with your name, bio, and price. Sharing it sends a concise message: your name + bio + cost per call. Post it everywhere — social media, forums, groups." },
        { emoji: "📢", head: "Advertising Tips", text: "• Post your profile link on TikTok, Twitter/X, Instagram, Reddit, or Facebook groups related to your niche.\n• Use the Share Room button in the Chat tab to promote free rooms — it drives traffic to the site where people discover creators.\n• A short TikTok or Reel about what you talk about (emotions, advice, fun, tarot, etc.) with your link in bio converts extremely well.\n• Consistency beats volume — post once a day for 2 weeks and you'll build a caller base." },
        { emoji: "🏷️", head: "Boosting Your Card", text: "A complete profile (name + photo + bio + price set) ranks higher in the Members grid. Members with photos get 3× more clicks. Callers sort by price, so new members starting at 1–2 coins get discovered faster." },
        { emoji: "🏠", head: "Host Member Rooms", text: "Create paid voice rooms from the Chat tab. Charge per-minute coin fees. Rooms appear in the Members list — it's free real-estate advertising for your profile while you earn at the same time." }
      ]
    }
  }[type];

  if(!content) return;

  var sectionsHtml = content.sections.map(function(s){
    var textHtml = s.text.split("\n").map(function(line){
      return "<div style='margin-bottom:4px;'>" + line + "</div>";
    }).join("");
    return "<div style='background:rgba(255,255,255,0.04);border-radius:12px;padding:13px 14px;margin-bottom:10px;'>"
      + "<div style='font-size:13px;font-weight:700;color:#fff;margin-bottom:5px;'>" + s.emoji + " " + s.head + "</div>"
      + "<div style='font-size:12px;color:#aaa;line-height:1.6;'>" + textHtml + "</div>"
      + "</div>";
  }).join("");

  body.innerHTML = "<div style='padding:20px;max-height:80vh;overflow-y:auto;'>"
    + "<div style='display:flex;align-items:center;gap:10px;margin-bottom:18px;'>"
    + "<span style='font-size:28px;'>" + content.icon + "</span>"
    + "<span style='font-size:18px;font-weight:800;color:" + content.color + ";'>" + content.title + "</span>"
    + "</div>"
    + sectionsHtml
    + "<button onclick='closeProfileModal()' "
        + "style='width:100%;margin-top:8px;padding:12px;border-radius:14px;border:none;"
        + "background:rgba(255,255,255,0.07);color:#888;font-size:13px;font-weight:600;cursor:pointer;'>"
        + "✕ Close</button>"
    + "</div>";

  modal.style.display = "flex";
};

/* ═══════════════════════════════════════════
   CONTACT EMAIL — sends to Whisper.me.support@gmail.com via mailto
═══════════════════════════════════════════ */
window.sendContactEmail = function(){
  var subject = (document.getElementById("contact-subject")||{}).value || "";
  var msg     = (document.getElementById("contact-msg")||{}).value || "";
  if(!subject.trim() && !msg.trim()){ showToast("Please enter a subject and message","warn"); return; }
  if(!msg.trim()){ showToast("Please enter a message","warn"); return; }

  var userName = (window.me && window.me.name) || "Member";
  var userEmail= (window.me && window.me.email) || ((window.currentUser && window.currentUser.email) || "");
  var uid      = window.currentUser ? window.currentUser.uid : "unknown";

  var fullBody = msg
    + "\n\n---\nFrom: " + userName
    + (userEmail ? "\nEmail: " + userEmail : "")
    + "\nUID: " + uid;

  var link = "mailto:Whisper.me.support@gmail.com"
    + "?subject=" + encodeURIComponent(subject || "Member Message")
    + "&body="    + encodeURIComponent(fullBody);

  window.open(link, "_blank");
  showToast("📨 Opening your email app…","success");

  /* Clear fields */
  var subEl = document.getElementById("contact-subject");
  var msgEl = document.getElementById("contact-msg");
  if(subEl) subEl.value = "";
  if(msgEl) msgEl.value = "";
};
window.saveProfile = function(){
  var user = firebase.auth().currentUser;
  if(!user){ showToast("Not logged in","warn"); return; }
  var g = function(id){ return ((document.getElementById(id)||{}).value||"").trim(); };
  var updates = {};
  var name = g("fi-name"); if(name) updates.name = name;
  var bio  = g("fi-bio");  if(bio)  updates.bio  = bio;
  var ig   = g("fi-ig");   if(ig)   updates.instagram = ig;
  var tw   = g("fi-tw");   if(tw)   updates.twitter   = tw;
  var web  = g("fi-web");  if(web)  updates.website   = web;

  var fileEl = document.getElementById("photoInput");
  var file   = fileEl && fileEl.files && fileEl.files[0];

  var commit = function(photoUrl){
    if(photoUrl) updates.photo = photoUrl;
    firebase.database().ref("users/" + user.uid).update(updates)
      .then(function(){ showToast("Profile saved ✓","success"); })
      .catch(function(e){ showToast("Save failed: " + e.message,"error"); });
  };

  if(file){
    /* max 3MB */
    if(file.size > 3 * 1024 * 1024){ showToast("Photo must be under 3MB","warn"); return; }
    firebase.storage().ref("profilePhotos/" + user.uid).put(file)
      .then(function(s){ return s.ref.getDownloadURL(); })
      .then(function(url){ commit(url); })
      .catch(function(e){ showToast("Photo upload failed: " + e.message,"error"); });
  } else {
    commit();
  }
};

window.savePrice = function(){
  var user = firebase.auth().currentUser;
  if(!user){ showToast("Not logged in","warn"); return; }
  var sel = document.getElementById("priceSelect"); if(!sel) return;
  var price = Number(sel.value||1);
  firebase.database().ref("users/" + user.uid).update({ price:price })
    .then(function(){ showToast("Price updated ✓","success"); })
    .catch(function(e){ showToast("Error: " + e.message,"error"); });
};

/* ═══════════════════════════════════════════
   BUY COINS — Stripe Checkout via Cloud Function
═══════════════════════════════════════════ */
window.updateCoinTotal = function(val){
  var qty   = Math.max(1, Math.min(500, parseInt(val)||1));
  var label = document.getElementById("coinTotalLabel");
  if(label) label.textContent = qty + " coin" + (qty>1?"s":"") + " = $" + (qty*3).toFixed(2);
};

window.buyCoinsCustom = async function(){
  var input = document.getElementById("coinQtyInput");
  var qty   = Math.max(1, Math.min(500, parseInt((input&&input.value)||"1")));
  await window.buyCoins(qty);
};

window.buyCoins = async function(qty){
  if(!currentUser){ showToast("Login required","warn"); return; }
  if(!qty){ showToast("Enter a quantity","warn"); return; }
  try {
    var tok = await currentUser.getIdToken(true);
    var res = await fetch(CF_BASE + "/createCoinCheckout", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":"Bearer " + tok },
      body: JSON.stringify({ qty })
    });
    var data = await res.json();
    if(!res.ok){ showToast(data.error||"Checkout failed","error"); return; }
    window.location.href = data.url;
  } catch(e){ showToast("Could not start checkout — please try again","error"); }
};

/* ═══════════════════════════════════════════
   STRIPE — all via Cloud Functions (server-side)
═══════════════════════════════════════════ */
window.connectStripe = async function(){
  if(!currentUser){ showToast("Login required","warn"); return; }
  try {
    var tok = await currentUser.getIdToken(true);
    var res = await fetch(CF_BASE + "/createStripeConnectLink", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":"Bearer " + tok }
    });
    var data = await res.json();
    if(!res.ok){ showToast(data.error||"Stripe connect failed","error"); return; }
    window.location.href = data.url;
  } catch(e){ showToast("Could not connect Stripe","error"); }
};

window.openStripeDashboard = async function(){
  if(!currentUser) return;
  try {
    var tok = await currentUser.getIdToken(true);
    var res = await fetch(CF_BASE + "/stripeDashboardLink", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":"Bearer " + tok }
    });
    var data = await res.json();
    if(!res.ok){ showToast(data.error||"Error","error"); return; }
    window.open(data.url, "_blank");
  } catch(e){ showToast("Could not open Stripe dashboard","error"); }
};

/* ═══════════════════════════════════════════
   AUTH
═══════════════════════════════════════════ */
window.doLogin = function(){
  var email = (document.getElementById("email")||{}).value;
  var pass  = (document.getElementById("password")||{}).value;
  if(!email || !pass){ showToast("Enter email and password","warn"); return; }
  firebase.auth().signInWithEmailAndPassword(email, pass)
    .catch(function(e){ showToast(e.message,"error"); });
};

window.doSignUp = function(){
  var email = (document.getElementById("email")||{}).value;
  var pass  = (document.getElementById("password")||{}).value;
  if(!email || !pass){ showToast("Enter email and password","warn"); return; }
  if(pass.length < 6){ showToast("Password must be at least 6 characters","warn"); return; }
  firebase.auth().createUserWithEmailAndPassword(email, pass)
    .then(function(cred){
      /* Save display name from landing page sign-up form */
      var name = (window.__pendingDisplayName || "").trim();
      if(name && cred.user){
        firebase.database().ref("users/" + cred.user.uid).update({ name: name });
        window.__pendingDisplayName = null;
      }

      var afterSetup = function(){
        /* Land brand-new members on Dashboard so the setup checklist
           (name/photo/coins/Stripe) is the first thing they see —
           not buried on a tab they may never visit. */
        active = 3;
        if(typeof render === "function") render();
        setTimeout(function(){ if(window.showHowItWorks) window.showHowItWorks(); }, 400);
      };

      var photoFile = window.__pendingSignupPhotoFile;
      window.__pendingSignupPhotoFile = null;

      if(photoFile && cred.user){
        if(photoFile.size > 20 * 1024 * 1024){
          showToast("Photo too large — add it later from your Profile","warn");
          afterSetup();
          return;
        }
        (window.shrinkImage ? window.shrinkImage(photoFile, 720) : Promise.resolve(photoFile))
          .then(function(blob){ return firebase.storage().ref("profilePhotos/" + cred.user.uid).put(blob, { contentType: blob.type || "image/jpeg" }); })
          .then(function(s){ return s.ref.getDownloadURL(); })
          .then(function(url){
            return firebase.database().ref("users/" + cred.user.uid).update({ photo: url });
          })
          .catch(function(){ showToast("Photo upload failed — add it later from your Profile","warn"); })
          .then(afterSetup);
      } else {
        afterSetup();
      }
    })
    .catch(function(e){ showToast(e.message,"error"); });
};

window.signInWithGoogle = function(){
  var provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  firebase.auth().signInWithPopup(provider)
    .then(function(result){
      /* If brand new user, save their Google display name + photo */
      var user = result.user;
      if(result.additionalUserInfo && result.additionalUserInfo.isNewUser){
        firebase.database().ref("users/" + user.uid).update({
          name:  user.displayName || "Member",
          photo: user.photoURL    || ""
        });
        /* Email stays private (only you and the admin can read it) */
        if(user.email) firebase.database().ref("userPrivate/" + user.uid).update({ email: user.email }).catch(function(){});
        active = 3; /* same reasoning as email signup above */
        if(typeof render === "function") render();
        setTimeout(function(){ if(window.showHowItWorks) window.showHowItWorks(); }, 400);
      }
    })
    .catch(function(e){
      if(e.code === "auth/popup-closed-by-user") return;
      showToast(e.message, "error");
    });
};

firebase.auth().onAuthStateChanged(async function(user){
  currentUser = user;
  if(!user){
    /* A shared room or profile link should drop a brand-new visitor
       straight into guest mode instead of the landing page. */
    if((window.__deepLinkRoom || window.__deepLinkProfile) && !window.__goSignupAfterSignout){
      firebase.auth().signInAnonymously().catch(function(){ render(); });
      return;
    }
    render();
    /* If we just exited a guest session heading for sign-up, jump to that tab */
    if(window.__goSignupAfterSignout){
      window.__goSignupAfterSignout = false;
      setTimeout(function(){ if(window.lpTab) window.lpTab(1); }, 50);
    }
    return;
  }

  if(user.isAnonymous){
    /* ── GUEST SESSION ──
       Chat-only: no Firebase profile document, lands on the Chat tab,
       Live Mic / Phone / Map / Dashboard are gated behind sign-up. */
    window.me = { name: guestDisplayName(), photo: "", isGuest: true };
    window.userData = window.me;
    active = 1;
    render();
    startPresence(user.uid, true);
    watchRoomPresence();
    loadPresetRoomsIntoApp(); /* guests were never loading custom rooms/photos before this */
    if(window.__deepLinkRoom){
      var dr = window.__deepLinkRoom;
      window.__deepLinkRoom = null;
      setTimeout(function(){ openDeepLinkRoom(dr); }, 300);
    }
    if(window.__deepLinkProfile){
      var dp = window.__deepLinkProfile;
      window.__deepLinkProfile = null;
      setTimeout(function(){ openDeepLinkProfile(dp); }, 500);
    }
    return;
  }

  await new Promise(function(r){
    firebase.database().ref("users/" + user.uid).once("value")
      .then(function(s){ window.me = s.val()||{}; window.userData = window.me; r(); })
      .catch(function(){ r(); });
  });

  /* Move an old public email into private storage (one time per member) */
  if(window.me && window.me.email){
    var __em = window.me.email;
    firebase.database().ref("userPrivate/" + user.uid).update({ email: __em })
      .then(function(){ return firebase.database().ref("users/" + user.uid + "/email").remove(); })
      .catch(function(){});
  }

  /* Set online presence and lastSeen on every login/page load */
  var presRef = firebase.database().ref("users/" + user.uid);
  presRef.update({ online: true, lastSeen: firebase.database.ServerValue.TIMESTAMP });
  presRef.onDisconnect().update({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP });

  startPresence(user.uid, false);
  watchRoomPresence();

  /* Load admin preset rooms now that auth is ready */
  loadPresetRoomsIntoApp();

  loadAllUsers();
  render();
  renderProfileCards();
  cleanupStuckCalls();
  resumeCallIfNeeded();
  restoreLiveMicIfActive(); /* re-join Agora if mic was live before refresh */
  restoreCreatorRoomIfNeeded(); /* re-open room page if creator refreshed */
  /* Warm up voice in the background so the first call starts instantly */
  setTimeout(function(){ loadAgora().catch(function(){}); }, 4000);

  if(window.__deepLinkRoom){
    var __dlr = window.__deepLinkRoom;
    window.__deepLinkRoom = null;
    active = 1;
    render();
    setTimeout(function(){ openDeepLinkRoom(__dlr); }, 300);
  }
  if(window.__deepLinkProfile){
    var __dlp = window.__deepLinkProfile;
    window.__deepLinkProfile = null;
    setTimeout(function(){ openDeepLinkProfile(__dlp); }, 500);
  }

  firebase.database().ref("users/" + user.uid).on("value", function(snap){
    window.me = snap.val()||{};
    window.userData = window.me;
    if(window.__liveCallHTML) return;
    /* Profile screen: refresh numbers without wiping what you're typing */
    if(active === 3){
      if(window.Profile) window.Profile.refresh(); else render();
    }
    /* Update any visible coin balance displays without full re-render */
    var coinEls = document.querySelectorAll(".dash-coin-count, #dash-coins-display");
    coinEls.forEach(function(el){ el.textContent = window.me.coins || 0; });
    /* Update buy coins balance preview in dashboard content panel */
    var balEl = document.querySelector(".coin-balance-inline");
    if(balEl) balEl.textContent = (window.me.coins || 0) + " coins";
  });
});

/* ═══════════════════════════════════════════
   LOAD ALL USERS (real-time)
═══════════════════════════════════════════ */
window.allUsers = {};
function loadAllUsers(){
  if(window.__usersListenerAttached) return;
  window.__usersListenerAttached = true;
  /* Only the 1,500 most recently active members are kept live, so the app
     stays fast as the community grows. Anyone else is fetched on demand. */
  firebase.database().ref("users").orderByChild("lastSeen").limitToLast(1500).on("value", function(snap){
    var list = [];
    snap.forEach(function(c){ list.push([c.key, c.val()]); });
    var fresh = {};
    list.reverse().forEach(function(e){ fresh[e[0]] = e[1]; }); /* most recent first */
    window.allUsers = fresh;
    window.__allUsersLoaded = true;
    profiles = Object.values(window.allUsers);
    if(!window.__liveCallHTML){
      if(active === 0) renderProfileCards();
      if(active === 2) refreshMapMarkers();
    }
  });
}

/* ═══════════════════════════════════════════
   LIVE MIC — RESTORE AFTER REFRESH
═══════════════════════════════════════════ */
function restoreLiveMicIfActive(){
  if(!currentUser || window.__liveMicRestored) return;
  window.__liveMicRestored = true;
  firebase.database().ref("liveMics").once("value").then(function(snap){
    snap.forEach(function(roomSnap){
      var roomId = roomSnap.key;
      roomSnap.forEach(function(userSnap){
        var v = userSnap.val();
        if(v && v.uid === currentUser.uid && v.active && v.endTs > Date.now()){
          /* We were live — restore */
          showToast("Restoring your live mic…","");
          activeRoom = roomId;
          liveMicActive = false; /* let startLiveMicAudio set it */
          startLiveMicAudio(v.endTs, roomId, currentUser.uid);
          /* Show the live panel so user sees the countdown */
          setTimeout(window.showLiveMicPanel, 800);
        }
      });
    });
  }).catch(function(){});
}

/* ═══════════════════════════════════════════
   MEMBER ROOM — FULLSCREEN PAGE
   Creator sees a dedicated full-screen room
   manager that locks them in until they close.
═══════════════════════════════════════════ */

/* ── Inject member room page styles once ── */
(function injectMRStyles(){
  var s = document.createElement("style");
  s.id  = "mr-page-styles";
  s.textContent = [
    /* Full-screen overlay that covers everything */
    "#mr-page{position:fixed;inset:0;z-index:10000;background:#08080f;",
    "display:flex;flex-direction:column;overflow:hidden;",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}",

    /* Header bar */
    "#mr-page .mrp-header{display:flex;align-items:center;justify-content:space-between;",
    "padding:14px 16px;background:#0d0d1a;border-bottom:1px solid rgba(123,47,247,0.3);}",
    "#mr-page .mrp-title{font-size:16px;font-weight:800;color:#fff;display:flex;",
    "align-items:center;gap:8px;}",
    "#mr-page .mrp-badge{background:rgba(0,227,174,0.15);border:1px solid rgba(0,227,174,0.4);",
    "color:#00e3ae;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;}",
    "#mr-page .mrp-badge.mr-closing{background:rgba(229,57,53,0.15);",
    "border-color:rgba(229,57,53,0.4);color:#e53935;}",

    /* Share button */
    "#mr-page .mrp-share-btn{background:rgba(123,47,247,0.2);border:1px solid rgba(123,47,247,0.5);",
    "color:#c9a8ff;border-radius:14px;padding:8px 14px;font-size:13px;font-weight:700;",
    "cursor:pointer;min-height:38px;transition:background .2s;margin-right:8px;}",
    "#mr-page .mrp-share-btn:hover{background:rgba(123,47,247,0.35);}",

    /* Close room button */
    "#mr-page .mrp-close-btn{background:rgba(229,57,53,0.2);border:1px solid rgba(229,57,53,0.5);",
    "color:#e53935;border-radius:14px;padding:8px 14px;font-size:13px;font-weight:700;",
    "cursor:pointer;min-height:38px;transition:background .2s;}",
    "#mr-page .mrp-close-btn:hover{background:rgba(229,57,53,0.35);}",
    "#mr-page .mrp-close-btn:disabled{opacity:.4;cursor:not-allowed;}",

    /* Session list */
    "#mr-page .mrp-sessions{flex:1;overflow-y:auto;padding:14px 16px;}",
    "#mr-page .mrp-sessions-title{font-size:12px;color:#888;font-weight:600;",
    "letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px;}",
    "#mr-page .mrp-no-sessions{text-align:center;color:#444;font-size:13px;padding:40px 20px;}",

    /* Session card */
    "#mr-page .mrp-session-card{display:flex;align-items:center;gap:12px;",
    "background:#0d0d1a;border:1px solid rgba(255,255,255,0.07);",
    "border-radius:14px;padding:12px 14px;margin-bottom:8px;}",
    "#mr-page .mrp-session-avatar{width:44px;height:44px;border-radius:50%;",
    "object-fit:cover;border:2px solid #7b2ff7;flex-shrink:0;}",
    "#mr-page .mrp-session-name{font-size:14px;font-weight:700;color:#fff;}",
    "#mr-page .mrp-session-timer{font-size:22px;font-weight:800;color:#00e3ae;",
    "font-variant-numeric:tabular-nums;min-width:48px;text-align:right;margin-left:auto;}",
    "#mr-page .mrp-session-timer.mrp-expiring{color:#f5a623;}",

    /* Earnings ticker */
    "#mr-page .mrp-earn{background:#0d1a14;border:1px solid rgba(0,227,174,0.25);",
    "border-radius:14px;margin:0 16px 14px;padding:12px 16px;",
    "display:flex;align-items:center;justify-content:space-between;}",
    "#mr-page .mrp-earn-label{font-size:12px;color:#888;}",
    "#mr-page .mrp-earn-val{font-size:20px;font-weight:800;color:#00e3ae;}",

    /* Instructions banner */
    "#mr-page .mrp-info{background:rgba(123,47,247,0.1);border:1px solid rgba(123,47,247,0.25);",
    "border-radius:12px;margin:0 16px 14px;padding:10px 14px;font-size:12px;",
    "color:#a78bfa;line-height:1.5;}",
    "#mr-page .mrp-closing-msg{background:rgba(229,57,53,0.1);border:1px solid rgba(229,57,53,0.25);",
    "border-radius:12px;margin:0 16px 14px;padding:10px 14px;font-size:13px;",
    "color:#e53935;font-weight:600;text-align:center;}",
  ].join("");
  document.head.appendChild(s);
})();

/* ── Open the creator room page ── */
window.openMemberRoomPage = function(roomId, roomName, roomCost){
  /* Guard: if already in THIS room skip; but allow re-entry after close */
  if(window.__inMemberRoom && window.__myRoomId === roomId) return;
  window.__inMemberRoom  = true;
  window.__myRoomId      = roomId;
  window.__myRoomClosed  = false;
  window.__mrRoomCost    = roomCost || 1;
  window.__mrCoinsEarned = 0;           /* reset per-session earnings counter */
  window.__mrCountedSessions = {};      /* track which session startTs already counted */

  /* Prevent accidental navigation away */
  window.__memberRoomBeforeUnload = function(e){
    if(window.__inMemberRoom && !window.__myRoomClosed){
      e.preventDefault();
      e.returnValue = "Your room is still open — close it first!";
      return e.returnValue;
    }
  };
  window.addEventListener("beforeunload", window.__memberRoomBeforeUnload);

  /* Build the page */
  var page = document.createElement("div");
  page.id  = "mr-page";
  page.innerHTML =
    "<div class='mrp-header'>"
      + "<div class='mrp-title'>🏠 <span id='mrp-room-name'>" + sanitize(roomName) + "</span>"
        + "<span class='mrp-badge' id='mrp-status-badge'>LIVE</span></div>"
      + "<button class='mrp-share-btn' id='mrp-share-btn' onclick=\"shareMemberRoom(" + jsAttr(roomId) + "," + jsAttr(roomName) + "," + jsAttr(roomCost||1) + ")\">🔗 Share</button>"
      + "<button class='mrp-close-btn' id='mrp-close-btn' onclick='creatorCloseRoom()'>Close Room</button>"
    + "</div>"
    + "<div class='mrp-info'>You are locked in as host. Members join for "
      + "<b style='color:#00e3ae'>" + (roomCost||1) + " coin"
      + ((roomCost||1)>1?"s":"") + "</b> each · 3-min sessions · "
      + "You cannot leave until the last session ends.</div>"
    + "<div class='mrp-earn'>"
      + "<span class='mrp-earn-label'>Coins Earned This Room</span>"
      + "<span class='mrp-earn-val' id='mrp-earn-val'>0</span>"
    + "</div>"
    + "<div id='mrp-chat-panel' style='margin:0 16px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(123,47,247,0.2);border-radius:14px;overflow:hidden;'>" + "<div style='font-size:12px;color:#888;font-weight:600;padding:10px 14px;border-bottom:1px solid rgba(123,47,247,0.15);'>💬 Live Chat</div>" + "<div id='mrp-chat-msgs' style='overflow-y:auto;padding:10px 14px;max-height:180px;display:flex;flex-direction:column;gap:6px;'></div>" + "</div>" + "<div class='mrp-sessions'>"
      + "<div class='mrp-sessions-title'>Active Sessions</div>"
      + "<div id='mrp-sessions-list'><div class='mrp-no-sessions'>Waiting for members…</div></div>"
    + "</div>";

  document.body.appendChild(page);
  /* ── Creator live chat listener ── */
  (function(){
    var chatRef = firebase.database().ref("chat/" + roomId)
      .orderByChild("ts").limitToLast(50);
    chatRef.on("value", function(snap){
      var msgs = [];
      snap.forEach(function(c){ msgs.push(c.val()); });
      var box = document.getElementById("mrp-chat-msgs");
      if(!box) return;
      box.innerHTML = msgs.map(function(m){
        return "<div style='font-size:12px;line-height:1.4;'>"
          + "<span style='color:#b08fff;font-weight:600;'>"
          + sanitize(m.name||"?") + "</span> "
          + "<span style='color:#ccc;'>" + sanitize(m.text||"") + "</span>"
          + (m.img ? "<br><img src='" + sanitize(m.img)
          + "' style='max-width:100%;border-radius:8px;margin-top:4px;'>" : "")
          + "</div>";
      }).join("");
      box.scrollTop = box.scrollHeight;
    });
    window.__mrChatRef = chatRef;
  })();

  /* ── Creator joins the room voice channel but does NOT publish yet
        (saves Agora minutes — mic goes live when first member joins) ── */
  joinMemberRoomVoice(roomId, true); // FIX: publish immediately

  /* Watch sessions in real time */
  window.__mrSessionsRef = firebase.database().ref("memberRoomSessions/" + roomId);
  window.__mrSessionsListener = window.__mrSessionsRef.on("value", function(snap){
    renderMRSessions(snap, roomCost || 1);
  });

  /* Kick the per-session countdown ticker */
  window.__mrTickInterval = setInterval(function(){
    var snap = window.__mrLastSnap;
    if(snap) renderMRSessions(snap, window.__mrRoomCost);
  }, 1000);
};

/* ── Render active sessions inside the room page ── */
function renderMRSessions(snap, roomCost){
  window.__mrLastSnap = snap;
  var list = document.getElementById("mrp-sessions-list");
  if(!list) return;

  var now      = Date.now();
  var sessions = [];
  snap.forEach(function(c){
    var v = c.val();
    if(v && v.endTs > now) sessions.push(v);
  });

  /* Track earnings: count unique session startTs we haven't counted yet */
  if(!window.__mrCountedSessions) window.__mrCountedSessions = {};
  snap.forEach(function(c){
    var v = c.val();
    if(v && v.startTs && !window.__mrCountedSessions[v.uid + "_" + v.startTs]){
      window.__mrCountedSessions[v.uid + "_" + v.startTs] = true;
      window.__mrCoinsEarned = (window.__mrCoinsEarned || 0) + roomCost;
    }
  });
  var earnEl = document.getElementById("mrp-earn-val");
  if(earnEl) earnEl.textContent = window.__mrCoinsEarned || 0;

  /* ── Creator mic: publish when members present, unpublish when room empty ── */
  if(sessions.length > 0 && memberRoomAgoraJoined && !memberRoomAgoraTrack){
    publishCreatorMic();
  } else if(sessions.length === 0 && memberRoomAgoraTrack && !window.__inMemberRoom){
    try{ memberRoomAgoraTrack.stop(); memberRoomAgoraTrack.close(); }catch(e){}
    try{ memberRoomAgoraClient.unpublish(); }catch(e){}
    memberRoomAgoraTrack = null;
  }

  /* If closing and no active sessions — safe to exit */
  if(window.__myRoomClosed && sessions.length === 0){
    finalizeMemberRoomClose();
    return;
  }

  /* Update close button state */
  var closeBtn = document.getElementById("mrp-close-btn");
  if(closeBtn){
    closeBtn.disabled    = window.__myRoomClosed;
    closeBtn.textContent = window.__myRoomClosed ? "⏳ Waiting for sessions…" : "Close Room";
  }

  /* Update status badge */
  var badge = document.getElementById("mrp-status-badge");
  if(badge){
    if(window.__myRoomClosed){
      badge.textContent = "CLOSING";
      badge.className   = "mrp-badge mr-closing";
    } else {
      badge.textContent = "LIVE";
      badge.className   = "mrp-badge";
    }
  }

  if(!sessions.length){
    list.innerHTML = "<div class='mrp-no-sessions'>"
      + (window.__myRoomClosed ? "All sessions ended — closing…" : "Waiting for members…")
      + "</div>";
    return;
  }

  list.innerHTML = sessions.map(function(s){
    var secsLeft = Math.max(0, Math.round((s.endTs - now) / 1000));
    var mm = Math.floor(secsLeft/60), ss = secsLeft % 60;
    var timeStr  = mm + ":" + String(ss).padStart(2,"0");
    var expiring = secsLeft < 30;
    return "<div class='mrp-session-card'>"
      + "<img class='mrp-session-avatar' src='" + sanitize(s.photo||"https://dummyimage.com/44x44/111/444&text=W") + "' "
        + "onerror=\"this.src='https://dummyimage.com/44x44/111/444&text=W'\">"
      + "<div class='mrp-session-name'>" + sanitize(s.name||"Member") + "</div>"
      + "<div class='mrp-session-timer" + (expiring ? " mrp-expiring" : "") + "'>" + timeStr + "</div>"
      + "</div>";
  }).join("");
}

/* ── Creator clicks "Close Room" ── */
window.creatorCloseRoom = function(){
  if(!currentUser || !window.__myRoomId) return;
  showConfirm(
    "Close this room? No new members can join. You'll stay until active sessions finish.",
    function(){
      window.__myRoomClosed = true;
      /* Mark room as closing in Firebase so the card stops showing "Enter" */
      firebase.database().ref("memberRooms/" + window.__myRoomId).update({ closing: true })
        .catch(function(){});

      /* Check immediately — if no sessions, close now */
      firebase.database().ref("memberRoomSessions/" + window.__myRoomId).once("value")
        .then(function(snap){
          var now      = Date.now();
          var hasLive  = false;
          snap.forEach(function(c){ if(c.val() && c.val().endTs > now) hasLive = true; });
          if(!hasLive) finalizeMemberRoomClose();
          else showToast("Room closing after last session ends…","warn");
        });
    }
  );
};

/* ── Tear down and return to main site ── */
function finalizeMemberRoomClose(){
  if(!window.__inMemberRoom) return;

  /* Clean up Firebase */
  var rid = window.__myRoomId;
  if(rid){
    /* Sessions first: the security rules only let the room's owner clear
       its sessions while the room still exists. */
    firebase.database().ref("memberRoomSessions/" + rid).remove()
      .catch(function(){})
      .then(function(){ return firebase.database().ref("memberRooms/" + rid).remove(); })
      .catch(function(){});
  }

  /* Stop listeners + timers */
  if(window.__mrSessionsRef && window.__mrSessionsListener){
    window.__mrSessionsRef.off("value", window.__mrSessionsListener);
  }
  clearInterval(window.__mrTickInterval);

  /* Leave Agora voice */
  leaveMemberRoomVoice();

  /* Remove beforeunload guard */
  if(window.__memberRoomBeforeUnload){
    window.removeEventListener("beforeunload", window.__memberRoomBeforeUnload);
    window.__memberRoomBeforeUnload = null;
  }

  /* Remove the page overlay */
  var page = document.getElementById("mr-page");
  if(page) page.parentNode.removeChild(page);

  /* Reset state */
  window.__inMemberRoom      = false;
  window.__myRoomId          = null;
  window.__myRoomClosed      = false;
  window.__mrLastSnap        = null;
  window.__mrCoinsEarned     = 0;
  window.__mrCountedSessions = {};

  showToast("Room closed — thanks for hosting! 🎉","success");

  /* Return to main site — chat tab */
  active = 1;
  render();
  afterRender();
}

/* ── Restore creator page after refresh ── */
function restoreCreatorRoomIfNeeded(){
  if(!currentUser) return;
  firebase.database().ref("memberRooms")
    .orderByChild("ownerId").equalTo(currentUser.uid)
    .once("value").then(function(snap){
      snap.forEach(function(c){
        var r = c.val();
        /* If they own an open room and not in closing state already, restore */
        if(r && !r.closing && !window.__inMemberRoom){
          showToast("Restoring your room: " + r.name,"");
          window.openMemberRoomPage(c.key, r.name, r.cost);
        }
      });
    }).catch(function(){});
}

/* ═══════════════════════════════════════════
   BOOT
═══════════════════════════════════════════ */
renderHeader();
render();

/* ═══════════════════════════════════════════
   AGORA MINUTE-SAVER: leave all channels when tab goes hidden/closed
   Prevents phantom Agora sessions burning free-tier minutes.
═══════════════════════════════════════════ */
document.addEventListener("visibilitychange", function(){
  if(document.visibilityState === "hidden"){
    stopLiveMicAudience();
    if(!liveMicActive && memberRoomAgoraJoined && !window.__activeCallId && !window.__inMemberRoom){
      leaveMemberRoomVoice();
    }
  }
  if(document.visibilityState === "visible"){
    if(window.__inMemberRoom && memberRoomAgoraJoined && !memberRoomAgoraTrack){
      var roomId = window.__myRoomId;
      if(roomId) joinMemberRoomVoice(roomId, true);
    }
    /* Reconnect call mic if in active call */
    resumeCallIfNeeded();
  }
});

/* Hard cleanup on page unload — belt AND suspenders */
window.addEventListener("pagehide", function(){
  try {
    if(liveMicTrack)       { liveMicTrack.stop();      liveMicTrack.close();  }
    if(localAudioTrack)    { localAudioTrack.stop();   localAudioTrack.close(); }
    if(memberRoomAgoraTrack){ memberRoomAgoraTrack.stop(); memberRoomAgoraTrack.close(); }
    if(liveMicClient)       liveMicClient.leave();
    if(agoraClient)         agoraClient.leave();
    if(liveMicAudienceClient) liveMicAudienceClient.leave();
    if(memberRoomAgoraClient) memberRoomAgoraClient.leave();
  } catch(e){}
  /* Clear map pin */
  if(currentUser)
    firebase.database().ref("users/" + currentUser.uid).update({ lat:null, lng:null, online:false, lastSeen: firebase.database.ServerValue.TIMESTAMP });
  /* Mark live mic as inactive */
  if(liveMicActive && currentUser)
    firebase.database().ref("liveMics/" + activeRoom + "/" + currentUser.uid).update({ active:false });
});

/* ═══════════════════════════════════════════
   STRIPE REDIRECT HANDLER
   After Stripe checkout, user lands on:
     /?coins_success=1&session_id=...
     /?coins_cancel=1
     /?stripe_connected=1
     /?stripe_refresh=1
   Handle each case and clean the URL so refreshing doesn't re-trigger.
═══════════════════════════════════════════ */
(function handleStripeReturn(){
  var params = new URLSearchParams(window.location.search);
  if(!params.toString()) return;
  /* dates.js (M&G) loads after this file and needs ?dates= / ?meetup= too */
  window.__initialSearch = window.location.search;

  /* Capture a shared room link (?room=xyz) before we wipe the query string.
     Consumed by the auth-state handlers below, for both guests and members. */
  var deepRoom = (params.get("room") || "").replace(/[^a-z0-9_]/gi, "");
  if(deepRoom) window.__deepLinkRoom = deepRoom;

  /* Same idea for a shared profile link (?openProfile=uid), set by the
     profileOG redirect after someone taps a share link. */
  var deepProfile = (params.get("openProfile") || "").replace(/[^a-zA-Z0-9]/g, "");
  if(deepProfile) window.__deepLinkProfile = deepProfile;

  /* Clean URL immediately so a page refresh doesn't re-show the toast */
  var cleanUrl = window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);

  if(params.get("coins_success") === "1"){
    /* Coins are credited server-side via webhook — Firebase listener will
       update window.me.coins automatically. Switch to dashboard to show balance. */
    active = 3;
    render();
    /* Poll for a moment in case webhook hasn't fired yet */
    var attempts = 0;
    var prevCoins = (window.me && window.me.coins) || 0;
    var pollInterval = setInterval(function(){
      attempts++;
      var nowCoins = (window.me && window.me.coins) || 0;
      if(nowCoins > prevCoins || attempts >= 15){
        clearInterval(pollInterval);
        showToast("🪙 Coins added to your account!", "success", 5000);
        if(active === 3) render();
      }
    }, 1000);
    /* Also show immediate toast — coins may already be there */
    showToast("Payment successful! Coins are being added…", "success", 4000);
  }

  if(params.get("coins_cancel") === "1"){
    showToast("Checkout cancelled — no charge was made.", "warn");
  }

  if(params.get("stripe_connected") === "1"){
    showToast("Stripe account connected! You can now receive payouts. ✅", "success", 5000);
    /* Refresh user data so stripeAccountId shows in dashboard */
    if(currentUser){
      firebase.database().ref("users/" + currentUser.uid).once("value").then(function(s){
        window.me = s.val()||{};
        window.userData = window.me;
        active = 3;
        render();
      });
    }
  }

  if(params.get("stripe_refresh") === "1"){
    showToast("Reconnecting Stripe — please try again.", "warn");
    active = 3;
    render();
  }
})();

document.addEventListener("visibilitychange", function(){
  if(document.visibilityState === "hidden"){
    stopLiveMicAudience();
    if(!liveMicActive && memberRoomAgoraJoined && !window.__activeCallId && !window.__inMemberRoom){
      leaveMemberRoomVoice();
    }
  }
  if(document.visibilityState === "visible"){
    if(window.__inMemberRoom && memberRoomAgoraJoined && !memberRoomAgoraTrack){
      var roomId = window.__myRoomId;
      if(roomId) joinMemberRoomVoice(roomId, true);
    }
    resumeCallIfNeeded();
  }
});

/* ═══════════════════════════════════════════
   Incoming calls toggle
═══════════════════════════════════════════ */
window.toggleCallsEnabled = function(){
  if(!currentUser) return;
  var current = window.me && window.me.callsEnabled !== false;
  var newVal = !current;
  firebase.database().ref("users/" + currentUser.uid).update({ callsEnabled: newVal })
    .then(function(){
      if(window.me) window.me.callsEnabled = newVal;
      showToast(newVal ? "📞 Calls enabled — members can reach you" : "🔕 Calls disabled — you won't be disturbed", newVal ? "success" : "warn", 3000);
      if(active === 3){ if(window.Profile) window.Profile.tab("calls"); else render(); }
    });
};
