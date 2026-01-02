// Main Production Application Logic for Whisper+me - FIXED VERSION

// Global App Object
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
    console.log('🚀 Whisper+me Initializing...');
    
    // Show loading state
    document.getElementById('loading-screen')?.classList.add('loading');
    
    try {
        // Check if Firebase is loaded
        if (typeof firebase === 'undefined') {
            throw new Error('Firebase SDK not loaded. Please refresh the page.');
        }
        
        // Initialize Firebase if needed
        if (!firebase.apps.length) {
            const firebaseConfig = {
                apiKey: "AIzaSyALbIJSI2C-p6IyMtj_F0ZqGyN1i79jOd4",
                authDomain: "whisper-chat-live.firebaseapp.com",
                databaseURL: "https://whisper-chat-live-default-rtdb.firebaseio.com",
                projectId: "whisper-chat-live",
                storageBucket: "whisper-chat-live.firebasestorage.app",
                messagingSenderId: "302894848452",
                appId: "1:302894848452:web:61a7ab21a269533c426c91"
            };
            
            firebase.initializeApp(firebaseConfig);
            console.log('✅ Firebase initialized');
        }
        
        // Initialize modules
        window.App.db = firebase.database();
        window.App.auth = new AuthManager();
        window.App.ui = new UIManager();
        window.App.payments = new PaymentManager();
        window.App.calls = new CallManager();
        window.App.agora = new AgoraManager();
        
        // Initialize UI first
        if (window.App.ui && window.App.ui.initialize) {
            window.App.ui.initialize();
        }
        
        // Initialize auth (non-blocking)
        setTimeout(async () => {
            try {
                const isAuthenticated = await window.App.auth.initialize();
                
                if (isAuthenticated) {
                    await setupAuthenticatedUser();
                } else {
                    // Show auth modal after delay
                    setTimeout(() => {
                        if (window.App.ui && window.App.ui.showAuthModal) {
                            window.App.ui.showAuthModal();
                        }
                    }, 2000);
                }
            } catch (authError) {
                console.warn('Auth initialization warning:', authError);
                // Continue without auth
            }
        }, 100);
        
        // Load profiles (public data - doesn't require auth)
        loadPublicProfiles();
        
        // Hide loading screen
        setTimeout(() => {
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.style.opacity = '0';
                setTimeout(() => {
                    loadingScreen.style.display = 'none';
                }, 300);
            }
        }, 1000);
        
    } catch (error) {
        console.error('Initialization error:', error);
        
        // Show error but don't crash
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.innerHTML = `
                <div style="text-align: center; padding: 2rem;">
                    <h3 style="color: #ef4444;">Initialization Error</h3>
                    <p style="color: #666; margin: 1rem 0;">${error.message}</p>
                    <button onclick="location.reload()" style="
                        background: #7c3aed; 
                        color: white; 
                        border: none; 
                        padding: 0.75rem 1.5rem; 
                        border-radius: 8px; 
                        cursor: pointer;
                    ">Refresh Page</button>
                </div>
            `;
        }
    }
});

// Load public profiles
function loadPublicProfiles() {
    const container = document.getElementById('profiles-container');
    if (!container) return;
    
    // Show loading
    container.innerHTML = '<p style="text-align: center; color: #888;">Loading profiles...</p>';
    
    // Use placeholder image
    const placeholderImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2UyZTJlMiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LXNpemU9IjEyIiBkeT0iLjNlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZpbGw9IiM5OTkiPkFVPHQvZXh0Pjwvc3ZnPg==';
    
    // Try to load from Firebase
    if (window.App.db) {
        // Set timeout to prevent hanging
        const timeout = setTimeout(() => {
            container.innerHTML = '<p style="text-align: center; color: #888;">No users available. Be the first!</p>';
        }, 5000);
        
        window.App.db.ref('users').once('value')
            .then(snapshot => {
                clearTimeout(timeout);
                const users = snapshot.val();
                
                if (!users) {
                    container.innerHTML = '<p style="text-align: center; color: #888;">No users available at the moment</p>';
                    return;
                }
                
                renderProfiles(users, container, placeholderImage);
            })
            .catch(error => {
                clearTimeout(timeout);
                console.warn('Failed to load profiles:', error);
                container.innerHTML = '<p style="text-align: center; color: #888;">No users available. Be the first!</p>';
            });
    }
}

// Render profiles
function renderProfiles(users, container, placeholderImage) {
    container.innerHTML = '';
    
    Object.entries(users).forEach(([uid, user]) => {
        // Skip current user
        if (window.App.auth?.currentUser?.uid === uid) return;
        
        // Only show available users
        if (user.isAvailable !== true) return;
        
        const card = document.createElement('div');
        card.className = 'profile-card';
        card.innerHTML = `
            <div class="profile-header">
                <img src="${user.profilePhoto || placeholderImage}" 
                     alt="${user.displayName}" class="profile-img" 
                     loading="lazy" onerror="this.src='${placeholderImage}'">
                <div class="profile-info">
                    <h3>${user.displayName || 'Anonymous'}</h3>
                    <div class="profile-price">${user.callPrice || 1} Coin${(user.callPrice || 1) > 1 ? 's' : ''}</div>
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
    
    if (container.children.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #888;">No users available at the moment</p>';
    }
}

// Setup authenticated user
async function setupAuthenticatedUser() {
    try {
        // Update UI
        if (window.App.ui && window.App.ui.updateUI) {
            window.App.ui.updateUI();
        }
        
        // Set availability
        if (window.App.auth && window.App.auth.updateAvailability) {
            window.App.auth.updateAvailability(true);
        }
        
    } catch (error) {
        console.warn('User setup warning:', error);
    }
}

// Global functions
window.startCallWithUser = async function(userId) {
    if (!window.App.auth?.currentUser) {
        if (window.App.ui?.showAuthModal) {
            window.App.ui.showAuthModal();
        }
        return;
    }
    
    try {
        if (window.App.calls?.startCall) {
            await window.App.calls.startCall(userId);
        }
    } catch (error) {
        console.error('Call error:', error);
        if (window.App.ui?.showToast) {
            window.App.ui.showToast(error.message, 'error');
        }
    }
};

window.shareUserProfile = function(userId) {
    const shareUrl = `${window.location.origin}?ref=${userId}`;
    
    if (navigator.share) {
        navigator.share({
            title: 'Whisper+me User',
            text: 'Check out this user on Whisper+me!',
            url: shareUrl
        });
    } else {
        navigator.clipboard.writeText(shareUrl);
        if (window.App.ui?.showToast) {
            window.App.ui.showToast('Link copied to clipboard!', 'success');
        }
    }
};
