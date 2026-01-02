// Main Production Application Logic for Whisper+me
// NO DEMO CODE - Real Firebase only

// Global App Object (PHASE 1.2)
window.App = {
  auth: null,
  ui: null,
  calls: null,
  payments: null,
  agora: null,
  db: null
};

// Initialize when page loads
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 Whisper+me Production Initializing...');
    
    try {
        // Initialize Firebase
        if (!firebase.apps.length) {
            firebase.initializeApp({
                apiKey: "YOUR_FIREBASE_API_KEY",
                authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
                databaseURL: "YOUR_FIREBASE_DATABASE_URL",
                projectId: "YOUR_FIREBASE_PROJECT_ID",
                storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
                messagingSenderId: "YOUR_FIREBASE_SENDER_ID",
                appId: "YOUR_FIREBASE_APP_ID"
            });
        }
        
        // Initialize modules
        window.App.db = firebase.database();
        window.App.auth = new AuthManager();
        window.App.ui = new UIManager();
        window.App.calls = new CallManager();
        window.App.payments = new PaymentManager();
        window.App.agora = new AgoraManager();
        
        // Initialize auth
        const isAuthenticated = await window.App.auth.initialize();
        
        if (isAuthenticated) {
            await setupAuthenticatedUser();
        } else {
            setTimeout(() => { 
                window.App.ui.showAuthModal(); 
            }, 1000);
        }
        
        // Load real profiles from Firebase
        loadRealProfiles();
        
        // Start shuffle with real data
        startRealShuffle();
        
        // Hide loading screen
        window.App.ui.hideLoadingScreen();
        
    } catch (error) {
        console.error('Initialization error:', error);
        window.App.ui.showToast('Failed to initialize app. Please refresh.', 'error');
    }
});

// Setup authenticated user
async function setupAuthenticatedUser() {
    try {
        window.App.ui.updateUI();
        window.App.auth.updateAvailability(true);
        setupDatabaseListeners();
        
        window.addEventListener('beforeunload', () => {
            if (window.App.auth.currentUser) {
                firebase.database().ref(`users/${window.App.auth.currentUser.uid}/isAvailable`).set(false);
            }
        });
    } catch (error) {
        console.error('User setup error:', error);
    }
}

// Setup Firebase listeners
function setupDatabaseListeners() {
    const userId = window.App.auth.currentUser?.uid;
    if (!userId) return;

    // Listen for incoming calls
    const notificationsRef = window.App.db.ref(`notifications/${userId}`);
    notificationsRef.orderByChild('status').equalTo('unread').on('child_added', (snapshot) => {
        const notification = snapshot.val();
        if (notification.type === 'incoming_call') {
            window.App.ui.showIncomingCallNotification(notification);
        }
    });

    // Listen for available whispers
    const whispersRef = window.App.db.ref('users').orderByChild('isAvailable').equalTo(true);
    whispersRef.on('value', (snapshot) => {
        updateAvailableWhispers(snapshot.val());
    });
}

// Load real profiles from Firebase
function loadRealProfiles() {
    const container = document.getElementById('profiles-container');
    if (!container) return;
    
    window.App.db.ref('users').orderByChild('isAvailable').equalTo(true).on('value', (snapshot) => {
        const users = snapshot.val();
        container.innerHTML = '';
        
        if (!users) {
            container.innerHTML = '<p style="text-align: center; color: #888;">No users available at the moment</p>';
            return;
        }
        
        Object.entries(users).forEach(([uid, user]) => {
            if (uid === window.App.auth.currentUser?.uid) return;
            
            const card = document.createElement('div');
            card.className = 'profile-card';
            card.innerHTML = `
                <div class="profile-header">
                    <img src="${user.profilePhoto || 'https://images.unsplash.com/photo-1494790108755-2616b786d4d7?w=400&h=400&fit=crop&crop=face'}" 
                         alt="${user.displayName}" class="profile-img">
                    <div class="profile-info">
                        <h3>${user.displayName || 'Anonymous'}</h3>
                        <div class="profile-price">${user.callPrice || 1} Coin${user.callPrice > 1 ? 's' : ''}</div>
                    </div>
                </div>
                <p class="profile-bio">${user.bio || 'Available for calls'}</p>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-secondary" onclick="shareUserProfile('${uid}')" style="flex: 1;">
                        <i class="fas fa-share-alt"></i> Share
                    </button>
                    <button class="btn btn-primary" onclick="startCallWithUser('${uid}')" style="flex: 2;">
                        <i class="fas fa-phone"></i> Call Now
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    });
}

// Update available whispers for shuffle
function updateAvailableWhispers(users) {
    if (!users || !window.App.auth.currentUser) return;
    
    // Filter out current user
    const availableUsers = Object.entries(users).filter(([uid, user]) => {
        return uid !== window.App.auth.currentUser.uid && user.isAvailable === true;
    });
    
    // Update shuffle if we have users
    if (availableUsers.length > 0 && window.shuffleUsers) {
        window.shuffleUsers = availableUsers;
    }
}

// Start real shuffle with Firebase data
function startRealShuffle() {
    window.App.db.ref('users').orderByChild('isAvailable').equalTo(true).once('value').then((snapshot) => {
        const users = snapshot.val();
        if (!users) return;
        
        const availableUsers = Object.entries(users).filter(([uid, user]) => {
            return uid !== (window.App.auth.currentUser?.uid) && user.isAvailable === true;
        });
        
        if (availableUsers.length > 0) {
            window.shuffleUsers = availableUsers;
            window.shuffleIndex = 0;
            updateShuffleWithRealUser();
            startShuffleCountdown();
        }
    });
}

// Update shuffle with real user
function updateShuffleWithRealUser() {
    if (!window.shuffleUsers || window.shuffleUsers.length === 0) return;
    
    const [uid, user] = window.shuffleUsers[window.shuffleIndex];
    document.getElementById('shuffle-img').src = user.profilePhoto || 'https://images.unsplash.com/photo-1494790108755-2616b786d4d7?w=400&h=400&fit=crop&crop=face';
    document.getElementById('shuffle-name').textContent = user.displayName || 'Anonymous';
    document.getElementById('shuffle-price').textContent = `${user.callPrice || 1} Coin${(user.callPrice || 1) > 1 ? 's' : ''}`;
    document.getElementById('shuffle-bio').textContent = user.bio || 'Available for calls';
}

// Start shuffle countdown
function startShuffleCountdown() {
    let seconds = 30;
    const countdownElement = document.getElementById('countdown');
    
    if (window.shuffleInterval) clearInterval(window.shuffleInterval);
    
    window.shuffleInterval = setInterval(() => {
        seconds--;
        countdownElement.textContent = seconds;
        
        if (seconds <= 0) {
            nextRealShuffleProfile();
            seconds = 30;
        }
    }, 1000);
}

// Next real shuffle profile
function nextRealShuffleProfile() {
    if (!window.shuffleUsers || window.shuffleUsers.length === 0) return;
    
    window.shuffleIndex = (window.shuffleIndex + 1) % window.shuffleUsers.length;
    updateShuffleWithRealUser();
}

// Start call from shuffle
async function startCallFromShuffle() {
    if (!window.App.auth.currentUser) {
        window.App.ui.showNotification('Please login to start a call', 'error');
        window.App.ui.showAuthModal();
        return;
    }
    
    if (!window.shuffleUsers || window.shuffleUsers.length === 0) return;
    
    const [uid, user] = window.shuffleUsers[window.shuffleIndex];
    await startCallWithUser(uid);
}

// Start call with user
async function startCallWithUser(userId) {
    if (!window.App.auth.currentUser) {
        window.App.ui.showNotification('Please login to start a call', 'error');
        window.App.ui.showAuthModal();
        return;
    }
    
    try {
        const result = await window.App.calls.startCall(userId);
        window.App.ui.showNotification('Call initiated! Waiting for answer...', 'success');
    } catch (error) {
        window.App.ui.showNotification(error.message, 'error');
        if (error.message.includes('coins')) {
            window.App.ui.showBuyCoinsModal();
        }
    }
}

// Share user profile
function shareUserProfile(userId) {
    const shareUrl = `${window.location.origin}?ref=${userId}`;
    
    if (navigator.share) {
        navigator.share({
            title: 'Whisper+me User',
            text: 'Check out this user on Whisper+me!',
            url: shareUrl
        });
    } else {
        navigator.clipboard.writeText(shareUrl);
        window.App.ui.showNotification('Profile link copied to clipboard!', 'success');
    }
}

// View profile modal
function viewProfile(uid) {
    window.App.db.ref(`users/${uid}`).once('value').then((snapshot) => {
        const user = snapshot.val();
        if (!user) return;
        
        document.getElementById('modal-profile-img').src = user.profilePhoto || 'https://images.unsplash.com/photo-1494790108755-2616b786d4d7?w=400&h=400&fit=crop&crop=face';
        document.getElementById('modal-profile-name').textContent = user.displayName || 'Anonymous';
        document.getElementById('modal-profile-price').textContent = `${user.callPrice || 1} Coin${(user.callPrice || 1) > 1 ? 's' : ''}`;
        document.getElementById('modal-profile-bio').textContent = user.bio || 'Available for calls';
        
        // Add social links
        const socialLinks = document.getElementById('modal-social-links');
        socialLinks.innerHTML = '';
        if (user.socialLinks) {
            if (user.socialLinks.twitter) {
                socialLinks.innerHTML += `<a href="${user.socialLinks.twitter}" target="_blank" class="social-link"><i class="fab fa-twitter"></i></a>`;
            }
            if (user.socialLinks.instagram) {
                socialLinks.innerHTML += `<a href="${user.socialLinks.instagram}" target="_blank" class="social-link"><i class="fab fa-instagram"></i></a>`;
            }
            if (user.socialLinks.tiktok) {
                socialLinks.innerHTML += `<a href="${user.socialLinks.tiktok}" target="_blank" class="social-link"><i class="fab fa-tiktok"></i></a>`;
            }
        }
        
        // Add call button
        const actionButtons = document.querySelector('#profile-modal .action-buttons');
        actionButtons.innerHTML = `
            <button class="btn btn-secondary" onclick="shareUserProfile('${uid}')" style="flex: 1;">
                <i class="fas fa-share-alt"></i> Share
            </button>
            <button class="btn btn-primary" onclick="startCallWithUser('${uid}')" style="flex: 2;">
                <i class="fas fa-phone-alt"></i> Call Now
            </button>
        `;
        
        window.App.ui.showModal('profile-modal');
    });
}

// Initialize event listeners
function initializeEventListeners() {
    // Auth form submissions
    document.getElementById('login-email')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') window.App.auth.login();
    });
    document.getElementById('login-password')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') window.App.auth.login();
    });
}

// Export functions for global access
window.nextShuffleProfile = nextRealShuffleProfile;
window.startCallFromShuffle = startCallFromShuffle;
window.viewProfile = viewProfile;
window.startCallWithUser = startCallWithUser;
window.shareUserProfile = shareUserProfile;

// Initialize on load
initializeEventListeners();
