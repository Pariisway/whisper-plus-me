// Firebase Configuration - Fixed Version
const firebaseConfig = {
    apiKey: "AIzaSyALbIJSI2C-p6IyMtj_F0ZqGyN1i79jOd4",
    authDomain: "whisper-chat-live.firebaseapp.com",
    databaseURL: "https://whisper-chat-live-default-rtdb.firebaseio.com",
    projectId: "whisper-chat-live",
    storageBucket: "whisper-chat-live.firebasestorage.app",
    messagingSenderId: "302894848452",
    appId: "1:302894848452:web:61a7ab21a269533c426c91"
};

// Initialize Firebase with error handling
try {
    if (typeof firebase !== 'undefined' && typeof firebase.initializeApp === 'function') {
        // Check if already initialized
        if (!firebase.apps.length) {
            const app = firebase.initializeApp(firebaseConfig);
            console.log('✅ Firebase initialized successfully');
            
            // Initialize services
            window.firebaseAuth = firebase.auth();
            window.firebaseDb = firebase.database();
            window.firebaseStorage = firebase.storage();
            
            // Set persistence
            firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
                .catch(error => console.log('Persistence error:', error));
        } else {
            console.log('✅ Firebase already initialized');
            window.firebaseAuth = firebase.auth();
            window.firebaseDb = firebase.database();
            window.firebaseStorage = firebase.storage();
        }
    } else {
        console.error('❌ Firebase SDK not loaded');
        // Load Firebase dynamically if not available
        setTimeout(() => {
            if (typeof firebase === 'undefined') {
                console.warn('Firebase still not loaded, checking for CDN issues');
            }
        }, 2000);
    }
} catch (error) {
    console.error('❌ Firebase initialization error:', error);
}

// Export for global use
window.firebaseConfig = firebaseConfig;
