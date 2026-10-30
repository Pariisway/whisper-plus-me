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

function closeTagged(tag){
  return self.registration.getNotifications({ tag: tag }).then(function(list){ list.forEach(function(n){ n.close(); }); });
}

messaging.onBackgroundMessage(function(payload){
  const data = payload.data || {};

  if(data.type === "incoming_call"){
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
      data: { url: data.url || "https://whisperplusme.com", type: "incoming_call", callId: data.callId || "", test: data.test || "" }
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
        data: { url: data.url || "https://whisperplusme.com", type: "missed_call" }
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

  /* Decline: tell the open app (if any); otherwise the call times out on its own. */
  if(event.action === "decline"){
    event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
      list.forEach(function(c){ c.postMessage({ type: "decline_call", callId: data.callId }); });
    }));
    return;
  }

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
