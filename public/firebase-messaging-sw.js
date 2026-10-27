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

messaging.onBackgroundMessage(function(payload){
  const data = payload.data || {};
  const isCall = data.type === "incoming_call";
  self.registration.showNotification(data.title || "Whisper+Me", {
    body:  data.body  || "",
    icon:  isCall ? (data.callerPhoto || "/favicon-32.png") : "/favicon-32.png",
    badge: "/favicon-32.png",
    image: data.image || undefined,
    tag:   isCall ? ("call-" + data.callId) : undefined,
    requireInteraction: isCall,
    actions: isCall ? [
      { action: "answer",  title: "Answer"  },
      { action: "decline", title: "Decline" }
    ] : undefined,
    data: {
      url:    data.url || "https://whisperplusme.com",
      type:   data.type || "",
      callId: data.callId || ""
    }
  });
});

self.addEventListener("notificationclick", function(event){
  const data = event.notification.data || {};
  event.notification.close();

  /* Decline: just dismiss — no need to open/focus the app.
     (The call will naturally time out on its own after the ~3min ring
     window if never answered — this just clears the phone's notification.) */
  if(event.action === "decline") return;

  /* Answer, or tapping the notification body itself: open/focus the app.
     No special URL param needed — app.js's attachIncomingCallListener
     already watches for any ringing call addressed to this user and shows
     the full incoming-call UI automatically once the app loads and auth
     resolves. */
  const url = data.url || "https://whisperplusme.com";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(windowClients){
      for(const client of windowClients){
        if("focus" in client){ client.focus(); return; }
      }
      return clients.openWindow(url);
    })
  );
});
