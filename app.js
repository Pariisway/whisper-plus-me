// Whisper+me Production App - Server-Authoritative Architecture
class WhisperApp {
    constructor() {
        console.log('🚀 WhisperApp constructor called');
        this.user = null;
        this.userData = null;
        this.currentCall = null;
        this.callTimer = null;
        this.heartbeatInterval = null;
        this.incomingCallListener = null;
        
        // Initialize Firebase first
        this.initFirebase();
        
        // Make instance globally available
        window.WhisperApp = this;
    }
    
    async initFirebase() {
        console.log('🔥 Initializing Firebase...');
        
        // Load Firebase SDKs
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, GoogleAuthProvider, FacebookAuthProvider } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { getDatabase } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
        
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
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const database = getDatabase(app);
        const functions = getFunctions(app);
        
        // Make available globally
        window.firebase = { 
            app, 
            auth, 
            database, 
            functions,
            providers: { GoogleAuthProvider, FacebookAuthProvider },
            httpsCallable: (name) => httpsCallable(functions, name)
        };
        
        console.log('✅ Firebase v10 initialized');
        
        // Hide loading screen
        setTimeout(() => {
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) loadingScreen.style.display = 'none';
        }, 1000);
        
        // Initialize app
        this.init();
    }
    
    async init() {
        // Listen for auth state changes
        window.firebase.auth.onAuthStateChanged(async (user) => {
            if (user) {
                console.log('✅ User logged in:', user.email);
                this.user = user;
                await this.loadUserData();
                this.setupIncomingCallListener();
                this.showLoggedInUI();
                this.loadAvailableProfiles();
                
                // Check for call to resume
                this.checkResumeCall();
            } else {
                console.log('👤 No user logged in');
                this.user = null;
                this.userData = null;
                this.cleanupCallListeners();
                this.showLoggedOutUI();
            }
        });
        
        // Show initial UI
        this.showLoggedOutUI();
    }
    
    async loadUserData() {
        try {
            const { get, ref } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
            
            // Load private user data
            const userSnapshot = await get(ref(window.firebase.database, `users/${this.user.uid}`));
            // Load public profile
            const profileSnapshot = await get(ref(window.firebase.database, `publicProfiles/${this.user.uid}`));
            
            this.userData = {
                ...(userSnapshot.val() || {}),
                ...(profileSnapshot.val() || {}),
                uid: this.user.uid
            };
            
            console.log('📊 User data loaded:', this.userData);
            
        } catch (error) {
            console.error('Error loading user data:', error);
            this.showToast('Error loading user data', 'error');
        }
    }
    
    async loadAvailableProfiles() {
        const container = document.getElementById('profiles-container');
        if (!container) return;
        
        try {
            const { get, query, ref, orderByChild, equalTo, limitToFirst } = 
                await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
            
            // Query available profiles (excluding current user)
            const profilesQuery = query(
                ref(window.firebase.database, 'publicProfiles'),
                orderByChild('isAvailable'),
                equalTo(true),
                limitToFirst(50)
            );
            
            const snapshot = await get(profilesQuery);
            const profiles = snapshot.val() || {};
            
            // Update UI
            this.renderProfileGrid(container, profiles);
            
        } catch (error) {
            console.error('Error loading profiles:', error);
            this.showToast('Error loading profiles', 'error');
        }
    }
    
    renderProfileGrid(container, profiles) {
        const profilesArray = Object.entries(profiles)
            .filter(([uid]) => uid !== this.user?.uid)
            .map(([uid, profile]) => ({ uid, ...profile }));
        
        if (profilesArray.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px;">
                    <i class="fas fa-users-slash" style="font-size: 48px; color: #667eea; margin-bottom: 20px;"></i>
                    <h3 style="margin-bottom: 10px; color: white;">No whispers available</h3>
                    <p style="margin-bottom: 20px; color: rgba(255,255,255,0.8);">Be the first to list yourself as available!</p>
                    ${this.user ? `
                        <button class="btn btn-primary" onclick="window.WhisperApp.toggleAvailability()">
                            <i class="fas fa-toggle-on"></i> Go Available
                        </button>
                    ` : ''}
                </div>
            `;
            return;
        }
        
        container.innerHTML = profilesArray.map(profile => `
            <div class="profile-card" style="background: white; border-radius: 15px; padding: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
                <div style="display: flex; align-items: center; margin-bottom: 15px;">
                    <img src="${profile.profilePhoto || this.getDefaultAvatar(profile.displayName)}" 
                         style="width: 60px; height: 60px; border-radius: 50%; margin-right: 15px;"
                         onerror="this.src='${this.getDefaultAvatar(profile.displayName)}'">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 10px; height: 10px; background: #4CAF50; border-radius: 50%;" class="pulse"></div>
                            <h3 style="margin: 0; color: #333;">${profile.displayName || 'Anonymous'}</h3>
                        </div>
                        <div style="background: #4CAF50; color: white; padding: 3px 10px; border-radius: 15px; font-size: 0.9rem; margin-top: 5px; display: inline-block;">
                            ${profile.callPrice || 1} Coin
                        </div>
                    </div>
                </div>
                <p style="margin-bottom: 15px; color: #666; font-size: 0.9rem;">${profile.bio || 'Available for anonymous calls'}</p>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" onclick="window.WhisperApp.shareProfile('${profile.uid}', '${profile.displayName}')">
                        <i class="fas fa-share-alt"></i> Share
                    </button>
                    <button class="btn btn-primary" onclick="window.WhisperApp.startCall('${profile.uid}')">
                        <i class="fas fa-phone"></i> Call (${profile.callPrice || 1} Coin)
                    </button>
                </div>
            </div>
        `).join('');
    }
    
    // Helper methods
    getDefaultAvatar(name) {
        const encodedName = encodeURIComponent(name || 'User');
        return `https://ui-avatars.com/api/?name=${encodedName}&background=667eea&color=fff&size=200`;
    }
    
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = 'position: fixed; top: 20px; right: 20px; background: ' + 
            (type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3') + 
            '; color: white; padding: 12px 24px; border-radius: 4px; z-index: 10000;';
        
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
    
    // UI Methods
    showLoggedInUI() {
        const container = document.getElementById('app-container');
        container.innerHTML = `
            <!-- Navbar -->
            <nav style="background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 100;">
                <a href="#" style="color: white; font-size: 1.5rem; font-weight: bold; text-decoration: none;">Whisper+me</a>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span style="background: rgba(255,255,255,0.2); padding: 5px 15px; border-radius: 20px; color: white;">
                        ${this.userData?.coins || 0} Coins
                    </span>
                    <button class="btn btn-secondary" onclick="window.WhisperApp.showProfileModal()">
                        <i class="fas fa-user"></i>
                    </button>
                    <button class="btn btn-secondary" onclick="window.WhisperApp.logout()">
                        <i class="fas fa-sign-out-alt"></i>
                    </button>
                </div>
            </nav>
            
            <!-- iPhone Display -->
            <div style="max-width: 400px; margin: 20px auto; background: #000; border-radius: 40px; padding: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); border: 10px solid #333;">
                <div style="background: #fff; border-radius: 20px; padding: 20px; min-height: 400px; display: flex; flex-direction: column; justify-content: center; align-items: center;" id="iphone-screen">
                    <i class="fas fa-phone" style="font-size: 48px; color: #667eea; margin-bottom: 20px;"></i>
                    <h3 style="margin-bottom: 10px;">Select a whisper to call</h3>
                    <p style="color: #666; text-align: center;">Profiles will appear here when available</p>
                </div>
            </div>
            
            <!-- Available Whispers -->
            <div style="max-width: 1200px; margin: 40px auto 20px; padding: 0 20px; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="color: white; font-size: 1.8rem;">
                    <i class="fas fa-users"></i> Available Whispers
                </h2>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-primary" onclick="window.WhisperApp.toggleAvailability()" id="availability-toggle">
                        <i class="fas fa-toggle-off"></i> ${this.userData?.isAvailable ? 'Available' : 'Go Available'}
                    </button>
                    <button class="btn btn-secondary" onclick="window.WhisperApp.showInviteModal()">
                        <i class="fas fa-user-plus"></i> Invite Friend
                    </button>
                </div>
            </div>
            
            <!-- Profiles Grid -->
            <div id="profiles-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; padding: 20px; max-width: 1400px; margin: 0 auto;">
                Loading profiles...
            </div>
            
            <!-- Quick Actions -->
            <div style="max-width: 600px; margin: 40px auto; display: flex; gap: 15px; justify-content: center; padding: 20px;">
                <button class="btn btn-primary" onclick="window.WhisperApp.showBuyCoinsModal()" style="padding: 12px 30px; font-size: 16px;">
                    <i class="fas fa-coins"></i> Buy 10 Coins ($15)
                </button>
            </div>
        `;
        
        // Update availability button color
        const toggleBtn = document.getElementById('availability-toggle');
        if (toggleBtn && this.userData?.isAvailable) {
            toggleBtn.innerHTML = '<i class="fas fa-toggle-on"></i> Available';
            toggleBtn.classList.add('btn-success');
        }
    }
    
    showLoggedOutUI() {
        const container = document.getElementById('app-container');
        container.innerHTML = `
            <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;">
                <div style="background: rgba(255,255,255,0.95); border-radius: 20px; padding: 40px; max-width: 800px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <h1 style="font-size: 3rem; margin-bottom: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Whisper+me</h1>
                    <p style="font-size: 1.2rem; color: #666; margin-bottom: 40px;">Anonymous Audio Chat • Get Paid to Listen</p>
                    
                    <div style="margin: 40px auto; max-width: 300px;">
                        <div style="background: #000; border-radius: 30px; padding: 15px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); border: 8px solid #333;">
                            <div style="background: #fff; border-radius: 15px; padding: 20px; min-height: 300px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                                <img src="https://ui-avatars.com/api/?name=Whisper&background=667eea&color=fff&size=100" 
                                     style="width: 100px; height: 100px; border-radius: 50%; margin-bottom: 20px;">
                                <h3 style="margin-bottom: 5px;">Anonymous Whisper</h3>
                                <p style="color: #666; margin-bottom: 15px;">Available for 1 coin/min</p>
                                <div style="width: 12px; height: 12px; background: #4CAF50; border-radius: 50%;" class="pulse"></div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin: 40px 0;">
                        <button class="btn btn-primary btn-large" onclick="window.WhisperApp.showAuthModal('login')" style="padding: 15px 40px; font-size: 18px; margin: 10px;">
                            <i class="fas fa-sign-in-alt"></i> Login
                        </button>
                        <button class="btn btn-secondary btn-large" onclick="window.WhisperApp.showAuthModal('register')" style="padding: 15px 40px; font-size: 18px; margin: 10px;">
                            <i class="fas fa-user-plus"></i> Sign Up Free
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    // Call System Methods
    async startCall(whisperId) {
        try {
            // Check coins client-side first (UX optimization)
            if ((this.userData?.coins || 0) < 1) {
                this.showToast('Not enough coins. Please buy more.', 'error');
                return;
            }
            
            // Call server function to start call (authoritative)
            const startCallFn = window.firebase.httpsCallable('startCall');
            const result = await startCallFn({ whisperId });
            const callId = result.data.callId;
            
            // Store current call
            this.currentCall = { callId, whisperId, callerId: this.user.uid };
            
            // Show calling UI
            this.showCallingUI(callId);
            
            // Listen for call status changes
            this.setupCallStatusListener(callId);
            
        } catch (error) {
            console.error('Start call error:', error);
            this.showToast(error.message || 'Failed to start call', 'error');
        }
    }
    
    showCallingUI(callId) {
        const screen = document.getElementById('iphone-screen');
        if (!screen) return;
        
        screen.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div class="loader" style="margin: 0 auto 20px;"></div>
                <h3 style="margin-bottom: 10px;">Calling...</h3>
                <p style="color: #666; margin-bottom: 30px;">Waiting for whisper to answer</p>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button class="btn btn-danger" onclick="window.WhisperApp.endCall()">
                        <i class="fas fa-phone-slash"></i> Cancel Call
                    </button>
                </div>
            </div>
        `;
    }
    
    async toggleAvailability() {
        try {
            const { set, ref } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
            
            const newAvailability = !this.userData?.isAvailable;
            await set(ref(window.firebase.database, `publicProfiles/${this.user.uid}/isAvailable`), newAvailability);
            
            this.userData.isAvailable = newAvailability;
            this.showToast(newAvailability ? 'You are now available for calls' : 'You are now unavailable', 'success');
            
            // Refresh UI
            this.showLoggedInUI();
            this.loadAvailableProfiles();
            
        } catch (error) {
            console.error('Toggle availability error:', error);
            this.showToast('Failed to update availability', 'error');
        }
    }
    
    shareProfile(userId, userName) {
        const url = window.location.origin;
        navigator.clipboard.writeText(url);
        this.showToast('Profile link copied!', 'success');
    }
    
    logout() {
        window.firebase.auth.signOut().then(() => {
            this.showToast('Logged out successfully', 'success');
        }).catch(error => {
            console.error('Logout error:', error);
        });
    }
    
    // Keep other existing methods...
    showProfileModal() {
        this.showToast('Profile editing coming soon', 'info');
    }
    
    showInviteModal() {
        const url = window.location.origin;
        navigator.clipboard.writeText(url);
        this.showToast('Invite link copied! Share with friends.', 'success');
    }
    
    showBuyCoinsModal() {
        if (window.PaymentsManager) {
            window.PaymentsManager.buyCoins(10);
        } else {
            this.showToast('Payment system coming soon', 'info');
        }
    }
    
    showAuthModal(mode) {
        // ... (keep existing auth modal code)
        this.showToast('Auth modal coming soon', 'info');
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('📱 DOM ready - initializing WhisperApp');
    window.whisperAppInstance = new WhisperApp();
});
