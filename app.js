// Whisper+me Production App
class WhisperApp {
    constructor() {
        console.log('🚀 WhisperApp constructor called');
        this.user = null;
        this.userData = null;
        this.agoraClient = null;
        this.localAudioTrack = null;
        this.currentCall = null;
        this.callTimer = null;
        
        // Make instance globally available
        window.WhisperApp = this;
        
        // Initialize
        this.init();
    }
    
    async init() {
        console.log('🚀 Whisper+me Initializing...');
        
        // Hide loading screen immediately
        setTimeout(() => {
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) loadingScreen.style.display = 'none';
        }, 500);
        
        // Wait for Firebase
        if (!window.firebase) {
            console.log('⏳ Waiting for Firebase...');
            setTimeout(() => this.init(), 100);
            return;
        }
        
        console.log('✅ Firebase available');
        
        // Listen for auth state changes
        window.firebase.auth.onAuthStateChanged(async (user) => {
            if (user) {
                console.log('✅ User logged in:', user.email);
                this.user = user;
                await this.loadUserData();
                this.showLoggedInUI();
                this.loadAvailableProfiles();
            } else {
                console.log('👤 No user logged in');
                this.user = null;
                this.userData = null;
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
    
    // Auth Methods
    showAuthModal(mode) {
        console.log('📱 Showing auth modal:', mode);
        const modal = document.createElement('div');
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 10000;';
        
        modal.innerHTML = `
            <div style="background: white; border-radius: 15px; padding: 40px; max-width: 400px; width: 90%; position: relative;">
                <div onclick="this.parentElement.parentElement.remove()" style="position: absolute; top: 15px; right: 15px; font-size: 1.5rem; cursor: pointer; color: #666;">×</div>
                <h2 style="margin-bottom: 30px; text-align: center;">${mode === 'login' ? 'Login' : 'Sign Up'}</h2>
                
                ${mode === 'register' ? `
                    <div style="margin-bottom: 20px;">
                        <input type="text" id="register-name" placeholder="Display Name" 
                               style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 15px; font-size: 16px;">
                    </div>
                ` : ''}
                
                <div style="margin-bottom: 20px;">
                    <input type="email" id="${mode === 'login' ? 'login-email' : 'register-email'}" 
                           placeholder="Email" 
                           style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 15px; font-size: 16px;">
                </div>
                
                <div style="margin-bottom: 30px;">
                    <input type="password" id="${mode === 'login' ? 'login-password' : 'register-password'}" 
                           placeholder="Password" 
                           style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 15px; font-size: 16px;">
                </div>
                
                <button class="btn btn-primary" onclick="window.WhisperApp.handleAuth('${mode}')" 
                        style="width: 100%; padding: 12px; margin-bottom: 20px;">
                    ${mode === 'login' ? 'Login' : 'Sign Up'}
                </button>
                
                <div style="text-align: center; margin: 20px 0; color: #666;">or</div>
                
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <button class="btn" onclick="window.WhisperApp.loginWithGoogle()" 
                            style="background: #DB4437; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;">
                        <i class="fab fa-google"></i> Continue with Google
                    </button>
                    <button class="btn" onclick="window.WhisperApp.loginWithFacebook()" 
                            style="background: #4267B2; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;">
                        <i class="fab fa-facebook"></i> Continue with Facebook
                    </button>
                </div>
                
                ${mode === 'login' ? `
                    <div style="text-align: center; margin-top: 20px;">
                        <p>Don't have an account? <a href="#" onclick="window.WhisperApp.showAuthModal('register'); this.closest('.modal').remove(); return false;" style="color: #667eea;">Sign up</a></p>
                    </div>
                ` : `
                    <div style="text-align: center; margin-top: 20px;">
                        <p>Already have an account? <a href="#" onclick="window.WhisperApp.showAuthModal('login'); this.closest('.modal').remove(); return false;" style="color: #667eea;">Login</a></p>
                    </div>
                `}
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    async handleAuth(mode) {
        console.log('🔐 Handling auth:', mode);
        if (mode === 'login') {
            const email = document.getElementById('login-email')?.value;
            const password = document.getElementById('login-password')?.value;
            if (email && password) {
                await this.loginWithEmail(email, password);
            } else {
                this.showToast('Please enter email and password', 'error');
            }
        } else {
            const email = document.getElementById('register-email')?.value;
            const password = document.getElementById('register-password')?.value;
            const name = document.getElementById('register-name')?.value;
            if (email && password && name) {
                await this.signUpWithEmail(email, password, name);
            } else {
                this.showToast('Please fill all fields', 'error');
            }
        }
    }
    
    async loginWithEmail(email, password) {
        try {
            const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            await signInWithEmailAndPassword(window.firebase.auth, email, password);
            this.showToast('Logged in successfully!', 'success');
            document.querySelector('.modal')?.remove();
        } catch (error) {
            console.error('Login error:', error);
            this.showToast(error.message, 'error');
        }
    }
    
    async signUpWithEmail(email, password, displayName) {
        try {
            const { createUserWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            const { set, ref } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
            
            const userCredential = await createUserWithEmailAndPassword(window.firebase.auth, email, password);
            const user = userCredential.user;
            
            // Create user profile
            const userData = {
                email: email,
                displayName: displayName,
                coins: 5, // Free signup bonus
                isAvailable: false,
                createdAt: Date.now(),
                profileId: 'user_' + Math.random().toString(36).substr(2, 9),
                profilePhoto: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=667eea&color=fff`,
                callPrice: 1,
                bio: 'New whisper user',
                lastSeen: Date.now()
            };
            
            // Set both private and public data
            await set(ref(window.firebase.database, `users/${user.uid}`), {
                email: email,
                coins: 5,
                createdAt: Date.now(),
                isAdmin: false
            });
            
            await set(ref(window.firebase.database, `publicProfiles/${user.uid}`), userData);
            
            this.showToast('Account created! 5 free coins added.', 'success');
            document.querySelector('.modal')?.remove();
            
        } catch (error) {
            console.error('Signup error:', error);
            this.showToast(error.message, 'error');
        }
    }
    
    async loginWithGoogle() {
        try {
            const { signInWithPopup } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            const { GoogleAuthProvider } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            const provider = new GoogleAuthProvider();
            await signInWithPopup(window.firebase.auth, provider);
            this.showToast('Logged in with Google!', 'success');
            document.querySelector('.modal')?.remove();
        } catch (error) {
            console.error('Google login error:', error);
            this.showToast(error.message, 'error');
        }
    }
    
    async loginWithFacebook() {
        try {
            const { signInWithPopup } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            const { FacebookAuthProvider } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            const provider = new FacebookAuthProvider();
            await signInWithPopup(window.firebase.auth, provider);
            this.showToast('Logged in with Facebook!', 'success');
            document.querySelector('.modal')?.remove();
        } catch (error) {
            console.error('Facebook login error:', error);
            this.showToast(error.message, 'error');
        }
    }
    
    async logout() {
        try {
            await window.firebase.auth.signOut();
            this.showToast('Logged out successfully', 'success');
        } catch (error) {
            console.error('Logout error:', error);
        }
    }
    
    // Other methods (stubs for now)
    startCall(userId) {
        this.showToast('Starting call... (Feature coming soon)', 'info');
    }
    
    toggleAvailability() {
        this.showToast('Toggle availability (Feature coming soon)', 'info');
    }
    
    shareProfile(userId, userName) {
        const url = window.location.origin;
        navigator.clipboard.writeText(url);
        this.showToast('Profile link copied!', 'success');
    }
    
    showProfileModal() {
        this.showToast('Profile editing coming soon', 'info');
    }
    
    showInviteModal() {
        const url = window.location.origin;
        navigator.clipboard.writeText(url);
        this.showToast('Invite link copied! Share with friends.', 'success');
    }
    
    showBuyCoinsModal() {
        this.showToast('Payment system coming soon', 'info');
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('📱 DOM ready - initializing WhisperApp');
    window.whisperAppInstance = new WhisperApp();
});
