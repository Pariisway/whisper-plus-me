/* Whisper+Me push notifications (runs even when the site is closed).
   Call alerts arrive as data-only messages so this file controls exactly how
   they look and behave: Answer / Decline, a long vibration, re-ringing,
   taken down when the call stops, and "Missed call" when they didn't answer.
   Everything else (M&G, Connect Me, announcements) carries its own
   notification, which the Firebase SDK shows by itself. */
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js");
importScripts("https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js");

firebase.initializeApp({
  apiKey:            "AIzaSyDRoFs07YoRd8EWlOKQQPz3XZxiy-GIzTE",
  authDomain:        "whisperplusme-46d9c.firebaseapp.com",
  databaseURL:       "https://whisperplusme-46d9c-default-rtdb.firebaseio.com",
  projectId:         "whisperplusme-46d9c",
  storageBucket:     "whisperplusme-46d9c.firebasestorage.app",
  messagingSenderId: "858087320089",
  appId:             "1:858087320089:web:773c787b9f80075b0fd888"
});

const messaging = firebase.messaging();
const RING_VIBRATE = [900, 300, 900, 300, 900, 300, 900, 300, 900];

/* Calls this phone already turned down (Decline, or swiped the alert away).
   Kept in the Cache API because the browser can stop this file between rings. */
const DONE_CACHE = "wpm-declined-calls";
function markDone(callId){
  if(!callId) return Promise.resolve();
  return caches.open(DONE_CACHE).then(function(c){ return c.put("/declined/" + encodeURIComponent(callId), new Response(String(Date.now()))); }).catch(function(){});
}
function isDone(callId){
  if(!callId) return Promise.resolve(false);
  return caches.open(DONE_CACHE).then(function(c){ return c.match("/declined/" + encodeURIComponent(callId)); }).then(function(r){ return !!r; }).catch(function(){ return false; });
}
/* Ends the call for both people. Tries the site first, then the function directly. */
function declineOnServer(data){
  if(!data.dk || data.test) return Promise.resolve();
  const body = JSON.stringify({ c: data.callId, k: data.dk });
  const post = function(url){ return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body }).then(function(r){ if(!r.ok) throw new Error(r.status); return r; }); };
  return post("/api/declineCall").catch(function(){ return post("https://us-central1-whisperplusme-46d9c.cloudfunctions.net/declineCall"); }).catch(function(){});
}
function declineCall(data){
  return Promise.all([
    markDone(data.callId),
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
      list.forEach(function(c){ c.postMessage({ type: "decline_call", callId: data.callId }); });
    }),
    declineOnServer(data)
  ]);
}

function closeTagged(tag){
  return self.registration.getNotifications({ tag: tag }).then(function(list){ list.forEach(function(n){ n.close(); }); });
}

messaging.onBackgroundMessage(function(payload){
  const data = payload.data || {};

  if(data.type === "incoming_call"){
    /* Arrived late (phone was asleep or offline): the call is over, so don't ring.
       A notification still has to be shown, so it's a quiet "missed call". */
    if(data.exp && Date.now() > Number(data.exp)){
      return closeTagged("call-" + data.callId).then(function(){
        return self.registration.showNotification("Missed call from " + (data.callerName || "someone"), {
          body: "Tap to open Whisper+Me and call them back.", icon: "/icon-192.png", badge: "/favicon-32.png",
          tag: "missed-" + data.callId, silent: true, data: { url: "https://whisperplusme.com/?calls=1", type: "missed_call" }
        });
      });
    }
    return isDone(data.callId).then(function(done){
      /* Already declined on this phone: a ring that was on its way shows quietly instead of popping up again. */
      if(done) return self.registration.showNotification("Call declined", {
        body: (data.callerName || "They") + " will see you're not available.", icon: "/icon-192.png", badge: "/favicon-32.png",
        tag: "call-" + data.callId, silent: true, renotify: false, data: { url: "https://whisperplusme.com/?calls=1", type: "declined_call" }
      });
      return self.registration.showNotification(data.title || "📞 Incoming call", {
      body: data.body || "Tap to answer on Whisper+Me",
      icon: data.callerPhoto || "/icon-192.png",
      badge: "/favicon-32.png",
      tag: "call-" + data.callId,      /* the re-rings replace this one instead of stacking */
      renotify: true,                   /* …but still buzz and sound again each time */
      requireInteraction: true,         /* stays on screen until they answer or decline */
      silent: false,
      vibrate: RING_VIBRATE,
      timestamp: Date.now(),
      actions: [
        { action: "answer",  title: "📞 Answer"  },
        { action: "decline", title: "Decline" }
      ],
      data: { url: data.url || "https://whisperplusme.com", type: "incoming_call", callId: data.callId || "", test: data.test || "", dk: data.dk || "", callerName: data.callerName || "" }
    });
    });
  }

  if(data.type === "call_ended"){
    return closeTagged("call-" + data.callId).then(function(){
      if(!data.missed) return;
      return self.registration.showNotification("Missed call from " + (data.callerName || "someone"), {
        body: "Tap to open Whisper+Me and call them back.",
        icon: "/icon-192.png",
        badge: "/favicon-32.png",
        tag: "missed-" + data.callId,
        data: { url: "https://whisperplusme.com/?calls=1", type: "missed_call" }
      });
    });
  }

  /* A notification message: the SDK already showed it. Only data-only messages need showing here. */
  if(payload.notification) return;
  return self.registration.showNotification(data.title || "Whisper+Me", {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/favicon-32.png",
    data: { url: data.url || "https://whisperplusme.com", type: data.type || "" }
  });
});

self.addEventListener("notificationclick", function(event){
  const data = event.notification.data || {};
  event.notification.close();

  /* Decline: ends the call right away, even with the site closed (the caller sees it at once). */
  if(event.action === "decline"){ event.waitUntil(declineCall(data)); return; }

  /* Answer, or a tap on the alert: open or focus the app. The app's own
     call listener shows the incoming-call screen as soon as it loads. */
  const url = data.url || "https://whisperplusme.com";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(windowClients){
      for(const client of windowClients){
        if("focus" in client){
          if(data.type === "incoming_call") client.postMessage({ type: "answer_call", callId: data.callId });
          return client.focus();
        }
      }
      /* App closed: open it and answer right away if they tapped Answer. */
      return clients.openWindow(event.action === "answer" && data.callId && !data.test ? "https://whisperplusme.com/?answer=" + encodeURIComponent(data.callId) : url);
    })
  );
});

/* Swiping a ringing call alert away turns the call down too, so it stops popping back up. */
self.addEventListener("notificationclose", function(event){
  const data = event.notification.data || {};
  if(data.type === "incoming_call" && data.callId) event.waitUntil(declineCall(data));
});
