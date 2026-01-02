// Fixed app.js - Simplified and working version
window.App = {
  auth: null,
  ui: null,
  calls: null,
  payments: null,
  agora: null,
  db: null
};

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Whisper+me Initializing...');
    
    // Initialize Firebase
    if (!firebase.apps.length) {
        firebase.initializeApp({
            apiKey: "AIzaSyALbIJSI2C-p6IyMtj_F0ZqGyN1i79jOd4",
            authDomain: "whisper-chat-live.firebaseapp.com",
            databaseURL: "https://whisper-chat-live-default-rtdb.firebaseio.com",
            projectId: "whisper-chat-live",
            storageBucket: "whisper-chat-live.firebasestorage.app",
            messagingSenderId: "302894848452",
            appId: "1:302894848452:web:61a7ab21a269533c426c91"
        });
    }
    
    // Initialize modules
    window.App.db = firebase.database();
    window.App.auth = new AuthManager();
    window.App.ui = new UIManager();
    window.App.calls = new CallManager();
    window.App.payments = new PaymentManager();
    window.App.agora = new AgoraManager();
    
    // Initialize UI
    window.App.ui.initialize();
    
    // Check auth state
    firebase.auth().onAuthStateChanged(function(user) {
        if (user) {
            console.log('✅ User logged in:', user.email);
            window.App.auth.currentUser = user;
            window.App.auth.loadUserData().then(() => {
                window.App.ui.updateAuthUI('login', user, window.App.auth.userData);
                window.App.auth.updateAvailability(true);
            });
        } else {
            console.log('👤 No user logged in');
            window.App.ui.updateAuthUI('logout', null, null);
        }
        
        // Hide loading screen
        setTimeout(() => {
            document.getElementById('loading-screen').style.display = 'none';
        }, 1000);
    });
    
    // Load profiles
    loadPublicProfiles();
});

function loadPublicProfiles() {
    const container = document.getElementById('profiles-container');
    if (!container) return;
    
    container.innerHTML = '<p class="loading-text">Loading profiles...</p>';
    
    // Use placeholder image
    const placeholder = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2UyZTJlMiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LXNpemU9IjEyIiBkeT0iLjNlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZpbGw9IiM5OTkiPkFVPHQvZXh0Pjwvc3ZnPg==';
    
    if (window.App.db) {
        window.App.db.ref('users').orderByChild('isAvailable').equalTo(true).limitToFirst(20)
            .once('value')
            .then(snapshot => {
                const users = snapshot.val();
                container.innerHTML = '';
                
                if (!users) {
                    container.innerHTML = '<p class="no-users">No users available. Be the first!</p>';
                    return;
                }
                
                Object.entries(users).forEach(([uid, user]) => {
                    if (uid === window.App.auth?.currentUser?.uid) return;
                    
                    const card = document.createElement('div');
                    card.className = 'profile-card';
                    card.innerHTML = `
                        <div class="profile-header">
                            <img src="${user.profilePhoto || placeholder}" 
                                 alt="${user.displayName}" 
                                 class="profile-img"
                                 onerror="this.src='${placeholder}'">
                            <div class="profile-info">
                                <h3>${user.displayName || 'Anonymous'}</h3>
                                <div class="profile-price">${user.callPrice || 1} Coin${(user.callPrice || 1) > 1 ? 's' : ''}</div>
                            </div>
                        </div>
                        <p class="profile-bio">${user.bio || 'Available for calls'}</p>
                        <div class="profile-actions">
                            <button class="btn btn-secondary" onclick="shareProfile('${uid}')">
                                <i class="fas fa-share-alt"></i> Share
                            </button>
                            <button class="btn btn-primary" onclick="startCall('${uid}')">
                                <i class="fas fa-phone"></i> Call Now
                            </button>
                        </div>
                    `;
                    container.appendChild(card);
                });
            })
            .catch(error => {
                console.error('Error loading profiles:', error);
                container.innerHTML = '<p class="error-text">Failed to load profiles</p>';
            });
    }
}

// Global functions
window.startCall = function(userId) {
    if (!window.App.auth?.currentUser) {
        window.App.ui.showAuthModal();
        return;
    }
    
    window.App.ui.showToast('Starting call...', 'info');
    
    // Simulate call for now
    setTimeout(() => {
        window.App.ui.showToast('Call system is being set up', 'info');
    }, 1000);
};

window.shareProfile = function(userId) {
    const url = `${window.location.origin}?ref=${userId}`;
    navigator.clipboard.writeText(url);
    window.App.ui.showToast('Profile link copied!', 'success');
};

window.login = function() {
    window.App.ui.showAuthModal();
};

window.logout = function() {
    if (window.App.auth?.logout) {
        window.App.auth.logout();
    }
};
