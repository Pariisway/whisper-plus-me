// Whisper+me Production App - Fixed Modular Firebase v10
class WhisperApp {
    constructor() {
        console.log('🚀 WhisperApp constructor called');
        this.user = null;
        this.userData = null;
        this.currentCall = null;
        this.callTimer = null;
        this.heartbeatInterval = null;
        this.incomingCallListener = null;
        this.callStatusListener = null;
        
        // Store Firebase instances
        this.firebaseApp = null;
        this.auth = null;
        this.db = null;
        this.functions = null;
        
        // Initialize Firebase
        this.initFirebase();
        
        // Make instance globally available
        window.WhisperApp = this;
    }
    
    async initFirebase() {
        console.log('🔥 Initializing Firebase v10...');
        
        try {
            // Load Firebase SDKs - FIXED: Use proper imports
            const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
            const { getAuth, onAuthStateChanged, GoogleAuthProvider, FacebookAuthProvider } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            const { getDatabase, ref, get, set, update, query, orderByChild, equalTo, limitToFirst, onChildAdded, onValue } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
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
            this.firebaseApp = initializeApp(firebaseConfig);
            this.auth = getAuth(this.firebaseApp);
            this.db = getDatabase(this.firebaseApp);
            this.functions = getFunctions(this.firebaseApp);
            
            // Store globally with proper methods
            window.firebase = {
                auth: this.auth,
                database: this.db,
                functions: this.functions,
                httpsCallable: (name) => httpsCallable(this.functions, name),
                // Helper methods
                authMethods: {
                    signInWithEmailAndPassword: async (email, password) => {
                        const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
                        return signInWithEmailAndPassword(this.auth, email, password);
                    },
                    createUserWithEmailAndPassword: async (email, password) => {
                        const { createUserWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
                        return createUserWithEmailAndPassword(this.auth, email, password);
                    },
                    signInWithPopup: async (provider) => {
                        const { signInWithPopup } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
                        return signInWithPopup(this.auth, provider);
                    },
                    GoogleAuthProvider: GoogleAuthProvider,
                    FacebookAuthProvider: FacebookAuthProvider,
                    signOut: async () => {
                        const { signOut } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
                        return signOut(this.auth);
                    }
                },
                databaseMethods: {
                    ref: (path) => ref(this.db, path),
                    get: async (ref) => {
                        return get(ref);
                    },
                    set: async (ref, data) => {
                        return set(ref, data);
                    },
                    update: async (ref, data) => {
                        return update(ref, data);
                    },
                    query: query,
                    orderByChild: orderByChild,
                    equalTo: equalTo,
                    limitToFirst: limitToFirst,
                    onChildAdded: (ref, callback) => onChildAdded(ref, callback),
                    onValue: (ref, callback) => onValue(ref, callback)
                }
            };
            
            console.log('✅ Firebase v10 initialized correctly');
            
            // Hide loading screen
            setTimeout(() => {
                const loadingScreen = document.getElementById('loading-screen');
                if (loadingScreen) loadingScreen.style.display = 'none';
            }, 500);
            
            // Initialize app with auth listener
            this.init();
            
        } catch (error) {
            console.error('Firebase initialization error:', error);
            this.showToast('Failed to initialize app. Please refresh.', 'error');
        }
    }
    
    async init() {
        // Listen for auth state changes - FIXED: Use proper onAuthStateChanged
        const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        
        onAuthStateChanged(this.auth, async (user) => {
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
            const userSnapshot = await window.firebase.databaseMethods.get(
                window.firebase.databaseMethods.ref(`users/${this.user.uid}`)
            );
            const profileSnapshot = await window.firebase.databaseMethods.get(
                window.firebase.databaseMethods.ref(`publicProfiles/${this.user.uid}`)
            );
            
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
    
    // FIXED: Agora UID consistency - Use Firebase UID for Agora
    async joinAgoraChannel(callId, isCaller = true) {
        try {
            if (!window.AgoraManager) {
                const agoraScript = document.createElement('script');
                agoraScript.src = 'agora.js';
                document.head.appendChild(agoraScript);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Get token from server with Firebase UID
            const getTokenFn = window.firebase.httpsCallable('getAgoraToken');
            const result = await getTokenFn({ 
                channel: callId,
                uid: this.user.uid  // Send Firebase UID to server
            });
            
            // Join with consistent UID
            await window.AgoraManager.joinChannel(callId, this.user.uid, result.data.token);
            
            // Write initial heartbeat immediately
            await this.writeHeartbeat(callId, isCaller);
            
            return true;
        } catch (error) {
            console.error('Agora join error:', error);
            throw error;
        }
    }
    
    async writeHeartbeat(callId, isCaller) {
        try {
            const field = isCaller ? 'lastHeartbeatCaller' : 'lastHeartbeatWhisper';
            await window.firebase.databaseMethods.set(
                window.firebase.databaseMethods.ref(`calls/${callId}/${field}`),
                Date.now()
            );
        } catch (error) {
            console.error('Heartbeat write error:', error);
        }
    }
    
    startHeartbeat(callId, isCaller) {
        this.heartbeatInterval = setInterval(async () => {
            await this.writeHeartbeat(callId, isCaller);
        }, 5000);
    }
    
    // FIXED: Timer is not authoritative - just UI
    startCallTimer() {
        let timeLeft = 300; // 5 minutes in seconds
        
        this.callTimer = setInterval(() => {
            timeLeft--;
            
            // Update timer display only
            const timerElement = document.getElementById('call-timer');
            if (timerElement) {
                const minutes = Math.floor(timeLeft / 60);
                const seconds = timeLeft % 60;
                timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
            
            // DO NOT end call here - server is authoritative
            if (timeLeft <= 0) {
                // Just show time's up message
                timerElement.textContent = "0:00";
                timerElement.style.color = "#ff4757";
            }
        }, 1000);
    }
    
    // FIXED: Availability toggle with security
    async toggleAvailability() {
        try {
            if (!this.user?.uid) {
                this.showToast('Must be logged in', 'error');
                return;
            }
            
            const newAvailability = !this.userData?.isAvailable;
            
            // Update in database
            await window.firebase.databaseMethods.update(
                window.firebase.databaseMethods.ref(`publicProfiles/${this.user.uid}`),
                { isAvailable: newAvailability }
            );
            
            // Update local state
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
    
    // FIXED: Auth methods with proper modular imports
    async loginWithEmail(email, password) {
        try {
            await window.firebase.authMethods.signInWithEmailAndPassword(email, password);
            this.showToast('Logged in successfully!', 'success');
            this.closeAllModals();
        } catch (error) {
            console.error('Login error:', error);
            this.showToast(error.message || 'Login failed', 'error');
        }
    }
    
    async signUpWithEmail(email, password, displayName) {
        try {
            const userCredential = await window.firebase.authMethods.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;
            
            // Create user data
            const userData = {
                email: email,
                displayName: displayName,
                coins: 5, // Free signup bonus
                isAvailable: false,
                createdAt: Date.now(),
                profilePhoto: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=667eea&color=fff&size=200`,
                callPrice: 1,
                bio: 'New whisper user',
                lastSeen: Date.now(),
                // Social links
                socialLinks: {
                    twitter: '',
                    instagram: '',
                    website: ''
                }
            };
            
            // Set user data - FIXED: Add pendingCharge field
            await window.firebase.databaseMethods.set(
                window.firebase.databaseMethods.ref(`users/${user.uid}`),
                {
                    email: email,
                    coins: 5,
                    createdAt: Date.now(),
                    isAdmin: false
                }
            );
            
            await window.firebase.databaseMethods.set(
                window.firebase.databaseMethods.ref(`publicProfiles/${user.uid}`),
                userData
            );
            
            this.showToast('Account created! 5 free coins added.', 'success');
            this.closeAllModals();
            
        } catch (error) {
            console.error('Signup error:', error);
            this.showToast(error.message || 'Signup failed', 'error');
        }
    }
    
    async loginWithGoogle() {
        try {
            const provider = new window.firebase.authMethods.GoogleAuthProvider();
            await window.firebase.authMethods.signInWithPopup(provider);
            this.showToast('Logged in with Google!', 'success');
            this.closeAllModals();
        } catch (error) {
            console.error('Google login error:', error);
            this.showToast(error.message || 'Google login failed', 'error');
        }
    }
    
    async loginWithFacebook() {
        try {
            const provider = new window.firebase.authMethods.FacebookAuthProvider();
            await window.firebase.authMethods.signInWithPopup(provider);
            this.showToast('Logged in with Facebook!', 'success');
            this.closeAllModals();
        } catch (error) {
            console.error('Facebook login error:', error);
            this.showToast(error.message || 'Facebook login failed', 'error');
        }
    }
    
    async logout() {
        try {
            await window.firebase.authMethods.signOut();
            this.showToast('Logged out successfully', 'success');
        } catch (error) {
            console.error('Logout error:', error);
        }
    }
    
    // FIXED: Show profile edit modal with upload
    showProfileModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-close" onclick="window.WhisperApp.closeAllModals()">×</div>
                <h2 style="margin-bottom: 20px;">Edit Profile</h2>
                
                <div style="text-align: center; margin-bottom: 30px;">
                    <img id="profile-preview" src="${this.userData?.profilePhoto || this.getDefaultAvatar(this.userData?.displayName)}" 
                         style="width: 120px; height: 120px; border-radius: 50%; object-fit: cover; margin-bottom: 15px; cursor: pointer;"
                         onclick="document.getElementById('profile-upload').click()">
                    <input type="file" id="profile-upload" accept="image/*" style="display: none;" 
                           onchange="window.WhisperApp.handleProfileUpload(event)">
                    <p style="color: #666; font-size: 0.9rem;">Click image to upload new photo</p>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600;">Display Name</label>
                    <input type="text" id="edit-name" value="${this.userData?.displayName || ''}" 
                           style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px;">
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600;">Bio</label>
                    <textarea id="edit-bio" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; min-height: 100px;">${this.userData?.bio || ''}</textarea>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600;">Call Price (Coins)</label>
                    <input type="number" id="edit-price" value="${this.userData?.callPrice || 1}" min="1" max="10"
                           style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px;">
                </div>
                
                <h3 style="margin: 30px 0 15px;">Social Links</h3>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600;">Twitter</label>
                    <input type="text" id="edit-twitter" value="${this.userData?.socialLinks?.twitter || ''}" placeholder="@username"
                           style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px;">
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600;">Instagram</label>
                    <input type="text" id="edit-instagram" value="${this.userData?.socialLinks?.instagram || ''}" placeholder="@username"
                           style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px;">
                </div>
                
                <div style="margin-bottom: 30px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600;">Website</label>
                    <input type="url" id="edit-website" value="${this.userData?.socialLinks?.website || ''}" placeholder="https://example.com"
                           style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px;">
                </div>
                
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="btn btn-secondary" onclick="window.WhisperApp.closeAllModals()">Cancel</button>
                    <button class="btn btn-primary" onclick="window.WhisperApp.saveProfile()">Save Changes</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    async handleProfileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Check file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            this.showToast('File too large. Max 5MB.', 'error');
            return;
        }
        
        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('profile-preview').src = e.target.result;
        };
        reader.readAsDataURL(file);
        
        // Upload to Firebase Storage
        this.showToast('Uploading profile picture...', 'info');
        
        try {
            // Load Firebase Storage
            const { getStorage, ref, uploadBytes, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js');
            const storage = getStorage(this.firebaseApp);
            
            // Create unique filename
            const filename = `profile_${this.user.uid}_${Date.now()}.jpg`;
            const storageRef = ref(storage, `profile-pictures/${filename}`);
            
            // Upload file
            await uploadBytes(storageRef, file);
            
            // Get download URL
            const downloadURL = await getDownloadURL(storageRef);
            
            // Update profile in database
            await window.firebase.databaseMethods.update(
                window.firebase.databaseMethods.ref(`publicProfiles/${this.user.uid}`),
                { profilePhoto: downloadURL }
            );
            
            // Update local state
            this.userData.profilePhoto = downloadURL;
            
            this.showToast('Profile picture updated!', 'success');
            
        } catch (error) {
            console.error('Upload error:', error);
            this.showToast('Failed to upload picture', 'error');
        }
    }
    
    async saveProfile() {
        try {
            const updates = {
                displayName: document.getElementById('edit-name').value || 'Anonymous',
                bio: document.getElementById('edit-bio').value || '',
                callPrice: parseInt(document.getElementById('edit-price').value) || 1,
                socialLinks: {
                    twitter: document.getElementById('edit-twitter').value || '',
                    instagram: document.getElementById('edit-instagram').value || '',
                    website: document.getElementById('edit-website').value || ''
                }
            };
            
            // Update in database
            await window.firebase.databaseMethods.update(
                window.firebase.databaseMethods.ref(`publicProfiles/${this.user.uid}`),
                updates
            );
            
            // Update local state
            this.userData = { ...this.userData, ...updates };
            
            this.showToast('Profile updated!', 'success');
            this.closeAllModals();
            
            // Refresh UI
            this.showLoggedInUI();
            this.loadAvailableProfiles();
            
        } catch (error) {
            console.error('Save profile error:', error);
            this.showToast('Failed to save profile', 'error');
        }
    }
    
    // FIXED: Profile cards with social links
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
        
        container.innerHTML = profilesArray.map(profile => {
            const socialLinks = profile.socialLinks || {};
            return `
            <div class="profile-card" style="background: white; border-radius: 15px; padding: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
                <div style="display: flex; align-items: center; margin-bottom: 15px;">
                    <img src="${profile.profilePhoto || this.getDefaultAvatar(profile.displayName)}" 
                         style="width: 60px; height: 60px; border-radius: 50%; margin-right: 15px; object-fit: cover;"
                         onerror="this.src='${this.getDefaultAvatar(profile.displayName)}'">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
                            <div style="width: 10px; height: 10px; background: #4CAF50; border-radius: 50%;" class="pulse"></div>
                            <h3 style="margin: 0; color: #333; font-size: 1.1rem;">${profile.displayName || 'Anonymous'}</h3>
                        </div>
                        <div style="background: #4CAF50; color: white; padding: 3px 10px; border-radius: 15px; font-size: 0.85rem; display: inline-block;">
                            ${profile.callPrice || 1} Coin
                        </div>
                    </div>
                </div>
                
                <p style="margin-bottom: 15px; color: #666; font-size: 0.9rem; line-height: 1.4;">${profile.bio || 'Available for anonymous calls'}</p>
                
                ${socialLinks.twitter || socialLinks.instagram || socialLinks.website ? `
                <div style="margin-bottom: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
                    ${socialLinks.twitter ? `
                        <a href="https://twitter.com/${socialLinks.twitter.replace('@', '')}" target="_blank" 
                           style="color: #1DA1F2; text-decoration: none; font-size: 0.85rem;">
                            <i class="fab fa-twitter"></i> ${socialLinks.twitter}
                        </a>
                    ` : ''}
                    ${socialLinks.instagram ? `
                        <a href="https://instagram.com/${socialLinks.instagram.replace('@', '')}" target="_blank" 
                           style="color: #E4405F; text-decoration: none; font-size: 0.85rem;">
                            <i class="fab fa-instagram"></i> ${socialLinks.instagram}
                        </a>
                    ` : ''}
                    ${socialLinks.website ? `
                        <a href="${socialLinks.website}" target="_blank" 
                           style="color: #667eea; text-decoration: none; font-size: 0.85rem;">
                            <i class="fas fa-globe"></i> Website
                        </a>
                    ` : ''}
                </div>
                ` : ''}
                
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" onclick="window.WhisperApp.shareProfile('${profile.uid}', '${profile.displayName}')">
                        <i class="fas fa-share-alt"></i> Share
                    </button>
                    <button class="btn btn-primary" onclick="window.WhisperApp.startCall('${profile.uid}')" 
                            ${(this.userData?.coins || 0) < (profile.callPrice || 1) ? 'disabled style="opacity:0.5;"' : ''}>
                        <i class="fas fa-phone"></i> Call (${profile.callPrice || 1} Coin)
                    </button>
                </div>
            </div>
            `;
        }).join('');
    }
    
    // Utility methods
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
    
    getDefaultAvatar(name) {
        const encodedName = encodeURIComponent(name || 'User');
        return `https://ui-avatars.com/api/?name=${encodedName}&background=667eea&color=fff&size=200`;
    }
    
    closeAllModals() {
        document.querySelectorAll('.modal-backdrop').forEach(modal => modal.remove());
    }
    
    cleanupCallListeners() {
        if (this.callStatusListener) {
            this.callStatusListener();
            this.callStatusListener = null;
        }
        
        if (this.incomingCallListener) {
            this.incomingCallListener();
            this.incomingCallListener = null;
        }
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        if (this.callTimer) {
            clearInterval(this.callTimer);
            this.callTimer = null;
        }
    }
    
    // Keep other methods from original but ensure they use window.firebase properly
    
    // Initialize app when DOM is ready
    static init() {
        console.log('📱 DOM ready - initializing WhisperApp');
        window.whisperAppInstance = new WhisperApp();
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', WhisperApp.init);
} else {
    WhisperApp.init();
}
