// Whisper+me - Main Application
console.log('🚀 Whisper+me Initializing...');

// Global App State
window.App = {
    config: {
        agoraAppId: 'a6fcd5c405c641b8a3c9aabed4a4e5b1', // REPLACE with real App ID
        stripePublicKey: 'pk_live_51K...', // REPLACE with real Stripe key
        callPricePerMinute: 1,
        minimumCallDuration: 1,
        maximumCallDuration: 60
    },
    state: {
        currentUser: null,
        userData: null,
        activeCall: null,
        coins: 0,
        isAvailable: false
    },
    modules: {}
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
    console.log('📱 DOM Ready - Initializing App...');
    
    try {
        // Initialize modules
        await initializeModules();
        
        // Set up auth state listener
        setupAuthListener();
        
        // Load initial UI
        loadHomePage();
        
        // Initialize event listeners
        setupGlobalListeners();
        
        console.log('✅ App initialized successfully');
        
        // Hide loading screen
        setTimeout(() => {
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.style.display = 'none';
            }
        }, 1000);
        
    } catch (error) {
        console.error('❌ App initialization failed:', error);
        showError('Failed to initialize app. Please refresh the page.');
    }
});

async function initializeModules() {
    console.log('🛠 Initializing modules...');
    
    // Check if Firebase is available
    if (!window.firebase || !window.firebase.app) {
        throw new Error('Firebase not loaded. Check internet connection.');
    }
    
    // Initialize Auth Manager
    if (typeof AuthManager === 'function') {
        App.modules.auth = new AuthManager();
    } else {
        console.warn('⚠️ AuthManager not found, loading fallback');
        await loadModule('auth-manager-fallback.js');
    }
    
    // Initialize UI Manager
    if (typeof UIManager === 'function') {
        App.modules.ui = new UIManager();
        App.modules.ui.initialize();
    }
    
    // Initialize other modules as needed
    console.log('✅ Modules initialized');
}

function setupAuthListener() {
    if (!window.auth) {
        console.warn('⚠️ Firebase auth not available');
        return;
    }
    
    window.auth.onAuthStateChanged(async (user) => {
        console.log('👤 Auth state changed:', user ? 'Logged in' : 'Logged out');
        
        if (user) {
            // User is signed in
            App.state.currentUser = user;
            
            // Load user data
            await loadUserData(user.uid);
            
            // Update UI
            updateUIForLoggedInUser();
            
        } else {
            // User is signed out
            App.state.currentUser = null;
            App.state.userData = null;
            
            // Update UI
            updateUIForLoggedOutUser();
        }
    });
}

async function loadUserData(uid) {
    try {
        const snapshot = await window.db.ref('users/' + uid).once('value');
        App.state.userData = snapshot.val() || {};
        App.state.coins = App.state.userData.coins || 0;
        App.state.isAvailable = App.state.userData.isAvailable || false;
        
        console.log('📊 User data loaded:', App.state.userData);
    } catch (error) {
        console.error('❌ Failed to load user data:', error);
    }
}

function loadHomePage() {
    const container = document.getElementById('app-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="app-layout">
            <!-- Header -->
            <header class="app-header">
                <div class="header-content">
                    <div class="logo">
                        <i class="fas fa-comment-dots"></i>
                        <h1>Whisper+me</h1>
                    </div>
                    <div class="user-menu" id="user-menu">
                        <button class="btn btn-outline" onclick="showLoginModal()">
                            <i class="fas fa-sign-in-alt"></i> Sign In
                        </button>
                    </div>
                </div>
            </header>
            
            <!-- Main Content -->
            <main class="main-content">
                <!-- Hero Section -->
                <section class="hero-section">
                    <div class="hero-content">
                        <h2>Anonymous Live Audio Chat</h2>
                        <p>Connect with real people for private, anonymous conversations. No video, just voice.</p>
                        
                        <div class="hero-stats">
                            <div class="stat">
                                <i class="fas fa-users"></i>
                                <span id="online-count">25+</span>
                                <small>Online Now</small>
                            </div>
                            <div class="stat">
                                <i class="fas fa-phone"></i>
                                <span id="calls-count">1000+</span>
                                <small>Calls Today</small>
                            </div>
                            <div class="stat">
                                <i class="fas fa-star"></i>
                                <span id="rating">4.8</span>
                                <small>Avg Rating</small>
                            </div>
                        </div>
                        
                        <div class="hero-actions">
                            <button class="btn btn-primary btn-large" onclick="startQuickCall()">
                                <i class="fas fa-bolt"></i> Quick Call
                            </button>
                            <button class="btn btn-secondary btn-large" onclick="browseProfiles()">
                                <i class="fas fa-search"></i> Browse Profiles
                            </button>
                        </div>
                    </div>
                </section>
                
                <!-- How it Works -->
                <section class="features-section">
                    <h3>How It Works</h3>
                    <div class="features-grid">
                        <div class="feature-card">
                            <div class="feature-icon">
                                <i class="fas fa-user-plus"></i>
                            </div>
                            <h4>Create Profile</h4>
                            <p>Sign up in seconds, set your price, and describe what you offer</p>
                        </div>
                        
                        <div class="feature-card">
                            <div class="feature-icon">
                                <i class="fas fa-coins"></i>
                            </div>
                            <h4>Buy Coins</h4>
                            <p>Purchase coins to start calling others. Only pay for what you use</p>
                        </div>
                        
                        <div class="feature-card">
                            <div class="feature-icon">
                                <i class="fas fa-phone-alt"></i>
                            </div>
                            <h4>Start Calling</h4>
                            <p>Browse profiles, connect instantly, and have private conversations</p>
                        </div>
                        
                        <div class="feature-card">
                            <div class="feature-icon">
                                <i class="fas fa-money-bill-wave"></i>
                            </div>
                            <h4>Earn Money</h4>
                            <p>Get paid for your time. Withdraw earnings anytime via Stripe</p>
                        </div>
                    </div>
                </section>
                
                <!-- Live Profiles -->
                <section class="profiles-section">
                    <div class="section-header">
                        <h3>Live Profiles Available Now</h3>
                        <button class="btn btn-refresh" onclick="loadLiveProfiles()">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>
                    
                    <div class="profiles-container" id="profiles-container">
                        <!-- Profiles will load here -->
                        <div class="loading-profiles">
                            <div class="loader-small"></div>
                            <p>Loading live profiles...</p>
                        </div>
                    </div>
                </section>
            </main>
            
            <!-- Footer -->
            <footer class="app-footer">
                <div class="footer-content">
                    <div class="footer-section">
                        <h4>Whisper+me</h4>
                        <p>Anonymous audio conversations for meaningful connections</p>
                    </div>
                    
                    <div class="footer-section">
                        <h4>Quick Links</h4>
                        <a href="#" onclick="loadHomePage()">Home</a>
                        <a href="#" onclick="showHowItWorks()">How It Works</a>
                        <a href="#" onclick="showPricing()">Pricing</a>
                        <a href="#" onclick="showPrivacy()">Privacy</a>
                    </div>
                    
                    <div class="footer-section">
                        <h4>Contact</h4>
                        <p>support@whisperplus.me</p>
                        <p>© 2024 Whisper+me. All rights reserved.</p>
                    </div>
                </div>
            </footer>
        </div>
        
        <!-- Auth Modal -->
        <div class="modal" id="auth-modal" style="display: none;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Sign In to Whisper+me</h3>
                    <button class="close-modal" onclick="closeModal('auth-modal')">&times;</button>
                </div>
                
                <div class="modal-body">
                    <div class="auth-methods">
                        <button class="btn btn-google" onclick="signInWithGoogle()">
                            <i class="fab fa-google"></i> Continue with Google
                        </button>
                        
                        <button class="btn btn-facebook" onclick="signInWithFacebook()">
                            <i class="fab fa-facebook"></i> Continue with Facebook
                        </button>
                        
                        <div class="divider">
                            <span>or</span>
                        </div>
                        
                        <div class="email-auth">
                            <input type="email" id="auth-email" placeholder="Email address" class="form-input">
                            <input type="password" id="auth-password" placeholder="Password" class="form-input">
                            <button class="btn btn-primary" onclick="signInWithEmail()">Sign In</button>
                            <p class="auth-switch">New user? <a href="#" onclick="showSignUp()">Create account</a></p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Call Modal -->
        <div class="modal" id="call-modal" style="display: none;">
            <div class="modal-content call-modal">
                <div class="modal-header">
                    <h3>Starting Call...</h3>
                    <button class="close-modal" onclick="endCall()">&times;</button>
                </div>
                
                <div class="modal-body">
                    <div class="call-info">
                        <div class="caller-avatar">
                            <i class="fas fa-user"></i>
                        </div>
                        <h4>Connecting to user...</h4>
                        <p class="call-price">1 coin/minute</p>
                        
                        <div class="call-controls">
                            <div class="call-timer">
                                <i class="fas fa-clock"></i>
                                <span id="call-timer">00:00</span>
                            </div>
                            
                            <div class="call-buttons">
                                <button class="btn btn-call-end" onclick="endCall()">
                                    <i class="fas fa-phone-slash"></i> End Call
                                </button>
                                
                                <button class="btn btn-call-mute" onclick="toggleMute()">
                                    <i class="fas fa-microphone"></i> Mute
                                </button>
                            </div>
                            
                            <div class="coins-info">
                                <i class="fas fa-coins"></i>
                                <span id="coins-balance">0</span> coins remaining
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Toast Container -->
        <div id="toast-container" class="toast-container"></div>
    `;
    
    // Load live profiles
    loadLiveProfiles();
}

function setupGlobalListeners() {
    // Handle clicks on auth buttons
    document.addEventListener('click', function(e) {
        if (e.target.matches('.btn-login, .btn-signup')) {
            showLoginModal();
        }
    });
    
    // Handle profile refresh
    window.loadLiveProfiles = loadLiveProfiles;
}

async function loadLiveProfiles() {
    const container = document.getElementById('profiles-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="loading-profiles">
            <div class="loader-small"></div>
            <p>Loading live profiles...</p>
        </div>
    `;
    
    try {
        // For demo - show sample profiles
        // In production, this would fetch from Firebase
        setTimeout(() => {
            showSampleProfiles(container);
        }, 1000);
        
    } catch (error) {
        console.error('❌ Error loading profiles:', error);
        container.innerHTML = `
            <div class="error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Failed to load profiles. Please try again.</p>
                <button class="btn btn-retry" onclick="loadLiveProfiles()">Retry</button>
            </div>
        `;
    }
}

function showSampleProfiles(container) {
    const sampleProfiles = [
        {
            id: '1',
            name: 'Confidant',
            bio: 'Great listener, available for deep conversations',
            price: 1,
            rating: 4.9,
            calls: 127
        },
        {
            id: '2',
            name: 'Wisdom Seeker',
            bio: 'Love discussing philosophy and life',
            price: 2,
            rating: 4.7,
            calls: 89
        },
        {
            id: '3',
            name: 'Storyteller',
            bio: 'Share stories and listen to yours',
            price: 1,
            rating: 4.8,
            calls: 203
        },
        {
            id: '4',
            name: 'Life Coach',
            bio: 'Help you navigate challenges',
            price: 3,
            rating: 4.9,
            calls: 156
        },
        {
            id: '5',
            name: 'Friendly Voice',
            bio: 'Just need someone to talk to? I\'m here',
            price: 1,
            rating: 4.6,
            calls: 78
        },
        {
            id: '6',
            name: 'Tech Guru',
            bio: 'Discuss tech, startups, and innovation',
            price: 2,
            rating: 4.7,
            calls: 92
        }
    ];
    
    let html = '<div class="profiles-grid">';
    
    sampleProfiles.forEach(profile => {
        html += `
            <div class="profile-card">
                <div class="profile-header">
                    <div class="profile-avatar">
                        <i class="fas fa-user"></i>
                    </div>
                    <div class="profile-info">
                        <h4>${profile.name}</h4>
                        <div class="profile-stats">
                            <span class="rating">
                                <i class="fas fa-star"></i> ${profile.rating}
                            </span>
                            <span class="calls">
                                <i class="fas fa-phone"></i> ${profile.calls}
                            </span>
                        </div>
                    </div>
                </div>
                
                <p class="profile-bio">${profile.bio}</p>
                
                <div class="profile-price">
                    <i class="fas fa-coins"></i>
                    <span>${profile.price} coin${profile.price > 1 ? 's' : ''}/min</span>
                </div>
                
                <div class="profile-actions">
                    <button class="btn btn-outline" onclick="viewProfile('${profile.id}')">
                        <i class="fas fa-eye"></i> View
                    </button>
                    <button class="btn btn-primary" onclick="startCall('${profile.id}')">
                        <i class="fas fa-phone"></i> Call Now
                    </button>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Global Functions
window.showLoginModal = function() {
    const modal = document.getElementById('auth-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
};

window.closeModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
};

window.signInWithGoogle = async function() {
    try {
        const result = await window.auth.signInWithPopup(window.googleProvider);
        console.log('✅ Google sign-in successful:', result.user.email);
        closeModal('auth-modal');
        showToast('Welcome! You are now signed in.', 'success');
    } catch (error) {
        console.error('❌ Google sign-in failed:', error);
        showToast('Sign-in failed. Please try again.', 'error');
    }
};

window.signInWithFacebook = async function() {
    try {
        const result = await window.auth.signInWithPopup(window.facebookProvider);
        console.log('✅ Facebook sign-in successful:', result.user.email);
        closeModal('auth-modal');
        showToast('Welcome! You are now signed in.', 'success');
    } catch (error) {
        console.error('❌ Facebook sign-in failed:', error);
        showToast('Sign-in failed. Please try again.', 'error');
    }
};

window.startCall = function(userId) {
    if (!App.state.currentUser) {
        showLoginModal();
        showToast('Please sign in to start a call', 'warning');
        return;
    }
    
    if (App.state.coins < 1) {
        showToast('You need coins to make calls. Please purchase first.', 'warning');
        return;
    }
    
    const modal = document.getElementById('call-modal');
    if (modal) {
        modal.style.display = 'flex';
        
        // Start call timer
        startCallTimer();
        
        // Initialize Agora call
        initializeAgoraCall(userId);
    }
};

window.endCall = function() {
    const modal = document.getElementById('call-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    // Stop call timer
    stopCallTimer();
    
    // End Agora call
    endAgoraCall();
    
    showToast('Call ended', 'info');
};

function startCallTimer() {
    let seconds = 0;
    const timerElement = document.getElementById('call-timer');
    
    window.callTimer = setInterval(() => {
        seconds++;
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        
        if (timerElement) {
            timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        
        // Deduct coins every minute
        if (seconds % 60 === 0 && seconds > 0) {
            if (App.state.coins > 0) {
                App.state.coins--;
                updateCoinsDisplay();
                
                if (App.state.coins === 0) {
                    showToast('You\'re out of coins! Call will end.', 'warning');
                    setTimeout(endCall, 5000);
                }
            }
        }
    }, 1000);
}

function stopCallTimer() {
    if (window.callTimer) {
        clearInterval(window.callTimer);
    }
}

function updateCoinsDisplay() {
    const coinsElement = document.getElementById('coins-balance');
    if (coinsElement) {
        coinsElement.textContent = App.state.coins;
    }
}

function updateUIForLoggedInUser() {
    const userMenu = document.getElementById('user-menu');
    if (userMenu && App.state.currentUser) {
        userMenu.innerHTML = `
            <div class="user-info">
                <span class="user-avatar">
                    ${App.state.currentUser.email.charAt(0).toUpperCase()}
                </span>
                <span class="user-name">${App.state.currentUser.email}</span>
                <div class="user-actions">
                    <button class="btn btn-coins">
                        <i class="fas fa-coins"></i> ${App.state.coins} Coins
                    </button>
                    <button class="btn btn-logout" onclick="logout()">
                        <i class="fas fa-sign-out-alt"></i>
                    </button>
                </div>
            </div>
        `;
    }
}

function updateUIForLoggedOutUser() {
    const userMenu = document.getElementById('user-menu');
    if (userMenu) {
        userMenu.innerHTML = `
            <button class="btn btn-outline" onclick="showLoginModal()">
                <i class="fas fa-sign-in-alt"></i> Sign In
            </button>
        `;
    }
}

window.logout = async function() {
    try {
        await window.auth.signOut();
        showToast('Signed out successfully', 'success');
    } catch (error) {
        console.error('❌ Logout failed:', error);
        showToast('Logout failed', 'error');
    }
};

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    // Remove toast after 3 seconds
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function showError(message) {
    const container = document.getElementById('app-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="error-screen">
            <div class="error-content">
                <i class="fas fa-exclamation-triangle"></i>
                <h2>Something went wrong</h2>
                <p>${message}</p>
                <button class="btn btn-primary" onclick="location.reload()">
                    <i class="fas fa-redo"></i> Reload Page
                </button>
            </div>
        </div>
    `;
}

// Agora Functions (Placeholder - Needs real implementation)
async function initializeAgoraCall(userId) {
    console.log('📞 Initializing Agora call to user:', userId);
    showToast('Connecting to call...', 'info');
    
    // TODO: Implement real Agora call
    // This requires Agora App ID and proper setup
}

function endAgoraCall() {
    console.log('📞 Ending Agora call');
    // TODO: Implement Agora call ending
}

function toggleMute() {
    console.log('🎤 Toggling mute');
    // TODO: Implement mute toggle
}

console.log('👋 Whisper+me app.js loaded');
