#!/bin/bash

echo "🔥 Fixing Firebase SDK loading issues..."

# Create new index.html with Firebase v8 (compatible version)
cat > index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Whisper+me - Live Anonymous Audio Chat</title>
    
    <!-- Favicon -->
    <link rel="icon" href="https://img.icons8.com/color/96/000000/voice-id.png">
    
    <!-- Styles -->
    <link rel="stylesheet" href="styles.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    
    <!-- Firebase 8.10 (Compatible version) -->
    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js"></script>
    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-auth.js"></script>
    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-database.js"></script>
    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-storage.js"></script>
    
    <!-- Agora SDK -->
    <script src="https://download.agora.io/sdk/release/AgoraRTC_N-4.18.2.js"></script>
    
    <!-- Stripe -->
    <script src="https://js.stripe.com/v3/"></script>
    
    <!-- Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-4QYRJLTXTT"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-4QYRJLTXTT');
    </script>
    
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        
        .loading-screen {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            color: white;
        }
        
        .loader {
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top: 4px solid white;
            width: 50px;
            height: 50px;
            animation: spin 1s linear infinite;
            margin-bottom: 20px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <!-- Loading Screen -->
    <div id="loading-screen" class="loading-screen">
        <div class="loader"></div>
        <p>Loading Whisper+me...</p>
    </div>
    
    <!-- Main App Container -->
    <div id="app-container"></div>
    
    <!-- Firebase Configuration -->
    <script>
        // Initialize Firebase
        const firebaseConfig = {
            apiKey: "AIzaSyALbIJSI2C-p6IyMtj_F0ZqGyN1i79jOd4",
            authDomain: "whisper-chat-live.firebaseapp.com",
            databaseURL: "https://whisper-chat-live-default-rtdb.firebaseio.com",
            projectId: "whisper-chat-live",
            storageBucket: "whisper-chat-live.firebasestorage.app",
            messagingSenderId: "302894848452",
            appId: "1:302894848452:web:61a7ab21a269533c426c91"
        };
        
        // Initialize Firebase
        firebase.initializeApp(firebaseConfig);
        
        // Make firebase available globally
        window.firebase = firebase;
        window.db = firebase.database();
        window.auth = firebase.auth();
        window.storage = firebase.storage();
        
        console.log('✅ Firebase initialized successfully');
    </script>
    
    <!-- OAuth Providers Setup -->
    <script>
        // Setup Google provider
        const googleProvider = new firebase.auth.GoogleAuthProvider();
        googleProvider.addScope('profile');
        googleProvider.addScope('email');
        
        // Setup Facebook provider
        const facebookProvider = new firebase.auth.FacebookAuthProvider();
        facebookProvider.addScope('email');
        facebookProvider.addScope('public_profile');
        
        window.googleProvider = googleProvider;
        window.facebookProvider = facebookProvider;
        
        console.log('✅ OAuth providers setup complete');
    </script>
    
    <!-- Core App Modules -->
    <script src="auth.js"></script>
    <script src="ui.js"></script>
    <script src="calls.js"></script>
    <script src="payments.js"></script>
    <script src="agora.js"></script>
    
    <!-- Main Application -->
    <script src="app.js"></script>
    
    <!-- Google AdSense -->
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1184595877548269" crossorigin="anonymous"></script>
    
    <script>
        // Hide loading screen after 3 seconds max
        setTimeout(() => {
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.style.display = 'none';
            }
        }, 3000);
    </script>
</body>
</html>
