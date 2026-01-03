// Whisper+me Production App - FIXED VERSION
class WhisperApp {
    constructor() {
        this.user = null;
        this.userData = null;
        this.agoraClient = null;
        this.localAudioTrack = null;
        this.currentCall = null; // FIXED: Added currentCall initialization
        this.callTimer = null;
        
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
            setTimeout(() => this.init(), 100);
            return;
        }
        
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
        
        // Make globally available
        window.WhisperApp = this;
        
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
                        <button class="btn btn-primary" onclick="WhisperApp.toggleAvailability()">
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
                            <div style="width: 10px; height: 10px; background: #4CAF50; border-radius: 50%;"></div>
                            <h3 style="margin: 0; color: #333;">${profile.displayName || 'Anonymous'}</h3>
                        </div>
                        <div style="background: #4CAF50; color: white; padding: 3px 10px; border-radius: 15px; font-size: 0.9rem; margin-top: 5px; display: inline-block;">
                            ${profile.callPrice || 1} Coin
                        </div>
                    </div>
                </div>
                <p style="margin-bottom: 15px; color: #666; font-size: 0.9rem;">${profile.bio || 'Available for anonymous calls'}</p>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" onclick="WhisperApp.shareProfile('${profile.uid}', '${profile.displayName}')">
                        <i class="fas fa-share-alt"></i> Share
                    </button>
                    <button class="btn btn-primary" onclick="WhisperApp.startCall('${profile.uid}')">
                        <i class="fas fa-phone"></i> Call (${profile.callPrice || 1} Coin)
                    </button>
                </div>
            </div>
        `).join('');
    }
    
    showLoggedInUI() {
        const container = document.getElementById('app-container');
        container.innerHTML = `
            <!-- Navbar -->
            <nav style="background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 100;">
                <a href="#" style="color: white; font-size: 1.5rem; font-weight: bold; text-decoration: none;" onclick="WhisperApp.showHome(); return false;">Whisper+me</a>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span style="background: rgba(255,255,255,0.2); padding: 5px 15px; border-radius: 20px; color: white;">
                        ${this.userData?.coins || 0} Coins
                    </span>
                    <button class="btn btn-secondary" onclick="WhisperApp.showProfileModal()">
                        <i class="fas fa-user"></i>
                    </button>
                    <button class="btn btn-secondary" onclick="WhisperApp.logout()">
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
                    <button class="btn btn-primary" onclick="WhisperApp.toggleAvailability()" id="availability-toggle">
                        <i class="fas fa-toggle-off"></i> ${this.userData?.isAvailable ? 'Available' : 'Go Available'}
                    </button>
                    <button class="btn btn-secondary" onclick="WhisperApp.showInviteModal()">
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
                <button class="btn btn-primary" onclick="WhisperApp.showBuyCoinsModal()" style="padding: 12px 30px; font-size: 16px;">
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
                                <div style="width: 12px; height: 12px; background: #4CAF50; border-radius: 50%; animation: pulse 2s infinite;"></div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin: 40px 0;">
                        <button class="btn btn-primary btn-large" onclick="WhisperApp.showAuthModal('login')" style="padding: 15px 40px; font-size: 18px; margin: 10px;">
                            <i class="fas fa-sign-in-alt"></i> Login
                        </button>
                        <button class="btn btn-secondary btn-large" onclick="WhisperApp.showAuthModal('register')" style="padding: 15px 40px; font-size: 18px; margin: 10px;">
                            <i class="fas fa-user-plus"></i> Sign Up Free
                        </button>
                    </div>
                </div>
            </div>
            
            <style>
                @keyframes pulse {
                    0% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.5; transform: scale(1.1); }
                    100% { opacity: 1; transform: scale(1); }
                }
            </style>
        `;
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
    
    // FIXED: Added currentCall assignment
    async startCall(targetUserId) {
        if (!this.user) {
            this.showAuthModal('login');
            return;
        }
        
        // Check coin balance
        if ((this.userData?.coins || 0) < 1) {
            this.showToast('Not enough coins. Please buy more to call.', 'error');
            this.showBuyCoinsModal();
            return;
        }
        
        this.showToast('Starting call...', 'info');
        
        try {
            // Use transaction to safely deduct coins
            const { runTransaction, ref } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
            
            // Transaction to deduct coins
            const result = await runTransaction(ref(window.firebase.database, `users/${this.user.uid}/coins`), (currentCoins) => {
                if (currentCoins === null) return 0;
                if (currentCoins < 1) return currentCoins; // Not enough coins
                return currentCoins - 1; // Deduct 1 coin
            });
            
            if (!result.committed) {
                this.showToast('Failed to deduct coins. Please try again.', 'error');
                return;
            }
            
            // Update local data
            this.userData.coins = this.userData.coins - 1;
            
            // FIXED: Set currentCall object
            const callId = 'call_' + Date.now();
            this.currentCall = {
                id: callId,
                startTime: Date.now(),
                targetId: targetUserId,
                callerId: this.user.uid
            };
            
            // Create call record
            const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
            
            await set(ref(window.firebase.database, `calls/${callId}`), {
                callerId: this.user.uid,
                callerName: this.userData.displayName,
                targetId: targetUserId,
                status: 'initiated',
                price: 1,
                startTime: Date.now(),
                createdAt: Date.now(),
                coinsDeducted: true
            });
            
            // Notify target user
            await set(ref(window.firebase.database, `notifications/${targetUserId}/${Date.now()}`), {
                type: 'incoming_call',
                callId: callId,
                callerId: this.user.uid,
                callerName: this.userData.displayName,
                timestamp: Date.now()
            });
            
            // Show calling interface
            this.showCallInterface(callId, targetUserId);
            
        } catch (error) {
            console.error('Error starting call:', error);
            this.showToast('Failed to start call. Please try again.', 'error');
        }
    }
    
    showCallInterface(callId, targetUserId) {
        const container = document.getElementById('app-container');
        
        // Get target user info
        this.getTargetUserInfo(targetUserId).then(targetUser => {
            container.innerHTML = `
                <div style="min-height: 100vh; background: linear-gradient(135deg, #000428 0%, #004e92 100%); color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px;">
                    <h2 style="margin-bottom: 20px;"><i class="fas fa-phone"></i> Calling...</h2>
                    
                    <div style="text-align: center; margin-bottom: 30px;">
                        <img src="${targetUser.profilePhoto || this.getDefaultAvatar(targetUser.displayName)}" 
                             style="width: 120px; height: 120px; border-radius: 50%; margin-bottom: 20px; border: 4px solid #4CAF50;">
                        <h3 style="font-size: 1.8rem; margin-bottom: 10px;">${targetUser.displayName || 'Anonymous'}</h3>
                        <p style="color: #aaa;">Waiting for answer...</p>
                    </div>
                    
                    <div id="call-timer" style="font-size: 3rem; font-weight: bold; margin: 30px 0; font-family: monospace;">01:00</div>
                    
                    <div style="display: flex; gap: 30px; margin: 40px 0;">
                        <div id="mic-toggle" onclick="WhisperApp.toggleMic()" 
                             style="width: 70px; height: 70px; border-radius: 50%; background: #4CAF50; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1.5rem;">
                            <i class="fas fa-microphone"></i>
                        </div>
                        <div onclick="WhisperApp.endCall('${callId}')" 
                             style="width: 80px; height: 80px; border-radius: 50%; background: #ff4757; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1.8rem;">
                            <i class="fas fa-phone-slash"></i>
                        </div>
                    </div>
                    
                    <div style="text-align: center; max-width: 500px; margin-top: 30px; color: #aaa;">
                        <p><i class="fas fa-info-circle"></i> Call will be refunded if not answered in 60 seconds</p>
                    </div>
                </div>
            `;
            
            // Start 60-second answer timer
            this.startAnswerTimer(callId, 60);
        });
    }
    
    async getTargetUserInfo(userId) {
        try {
            const { get, ref } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
            const snapshot = await get(ref(window.firebase.database, `publicProfiles/${userId}`));
            return snapshot.val() || { displayName: 'Anonymous' };
        } catch (error) {
            return { displayName: 'Anonymous' };
        }
    }
    
    startAnswerTimer(callId, seconds) {
        let remaining = seconds;
        const timerElement = document.getElementById('call-timer');
        
        this.callTimer = setInterval(() => {
            remaining--;
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            timerElement.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            
            if (remaining <= 0) {
                clearInterval(this.callTimer);
                this.endCall(callId, 'unanswered');
                this.showToast('Call was not answered. Coin refunded.', 'info');
            }
        }, 1000);
    }
    
    async endCall(callId, reason = 'ended') {
        if (this.callTimer) {
            clearInterval(this.callTimer);
        }
        
        try {
            const { update, ref } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
            
            // FIXED: Use this.currentCall.startTime
            const duration = this.currentCall ? Math.floor((Date.now() - this.currentCall.startTime) / 1000) : 0;
            
            await update(ref(window.firebase.database, `calls/${callId}`), {
                status: reason,
                endTime: Date.now(),
                duration: duration
            });
            
            // If call was unanswered, refund coin
            if (reason === 'unanswered') {
                const { runTransaction } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
                
                await runTransaction(ref(window.firebase.database, `users/${this.user.uid}/coins`), (currentCoins) => {
                    if (currentCoins === null) return 1;
                    return currentCoins + 1;
                });
                
                // Update local data
                this.userData.coins = (this.userData.coins || 0) + 1;
            }
            
            // End Agora call
            if (this.agoraClient) {
                await this.agoraClient.leave();
                this.agoraClient = null;
            }
            
            if (this.localAudioTrack) {
                this.localAudioTrack.close();
                this.localAudioTrack = null;
            }
            
            // Show rating modal if call was answered
            if (reason === 'ended') {
                this.showRatingModal(callId);
            } else {
                this.showLoggedInUI();
                this.loadAvailableProfiles();
            }
            
        } catch (error) {
            console.error('Error ending call:', error);
            this.showToast('Error ending call', 'error');
        }
    }
    
    // FIXED: Wire up Agora token generation via Cloud Functions
    async setupAgoraCall(channelName) {
        try {
            // Load Agora SDK on demand
            await loadAgoraSDK();
            
            // Get Agora token from Cloud Function
            const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
            const functions = getFunctions(window.firebase.app);
            
            try {
                const generateToken = httpsCallable(functions, 'generateAgoraToken');
                const tokenResult = await generateToken({
                    channelName: channelName,
                    uid: this.user.uid
                });
                
                const { token, appId } = tokenResult.data;
                
                // Create Agora client
                this.agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
                
                // Join channel with token
                await this.agoraClient.join(appId, channelName, token, this.user.uid);
                
                // Create and publish local audio track
                this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
                await this.agoraClient.publish([this.localAudioTrack]);
                
                console.log('✅ Agora call connected with token');
                
                // Listen for remote users
                this.agoraClient.on("user-published", async (user, mediaType) => {
                    await this.agoraClient.subscribe(user, mediaType);
                    if (mediaType === "audio") {
                        user.audioTrack.play();
                        this.showToast('Connected! 5-minute timer started.', 'success');
                        this.startCallTimer(300); // 5 minutes
                    }
                });
                
            } catch (error) {
                console.error('Error getting Agora token:', error);
                this.showToast('Audio connection error', 'error');
            }
            
        } catch (error) {
            console.error('Agora setup error:', error);
            this.showToast('Audio system error', 'error');
        }
    }
    
    startCallTimer(seconds) {
        let remaining = seconds;
        const timerElement = document.getElementById('call-timer');
        
        if (this.callTimer) clearInterval(this.callTimer);
        
        this.callTimer = setInterval(() => {
            remaining--;
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            timerElement.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            
            if (remaining <= 0) {
                clearInterval(this.callTimer);
                this.endCall(this.currentCall?.id, 'timeout');
                this.showToast('Call ended after 5 minutes', 'info');
            }
        }, 1000);
    }
    
    toggleMic() {
        if (this.localAudioTrack) {
            if (this.localAudioTrack.muted) {
                this.localAudioTrack.setMuted(false);
                document.getElementById('mic-toggle').style.background = '#4CAF50';
                this.showToast('Microphone on', 'info');
            } else {
                this.localAudioTrack.setMuted(true);
                document.getElementById('mic-toggle').style.background = '#f44336';
                this.showToast('Microphone muted', 'info');
            }
        }
    }
    
    showAuthModal(mode) {
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
                
                <button class="btn btn-primary" onclick="WhisperApp.handleAuth('${mode}')" 
                        style="width: 100%; padding: 12px; margin-bottom: 20px;">
                    ${mode === 'login' ? 'Login' : 'Sign Up'}
                </button>
                
                <div style="text-align: center; margin: 20px 0; color: #666;">or</div>
                
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <button class="btn" onclick="WhisperApp.loginWithGoogle()" 
                            style="background: #DB4437; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;">
                        <i class="fab fa-google"></i> Continue with Google
                    </button>
                    <button class="btn" onclick="WhisperApp.loginWithFacebook()" 
                            style="background: #4267B2; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;">
                        <i class="fab fa-facebook"></i> Continue with Facebook
                    </button>
                </div>
                
                ${mode === 'login' ? `
                    <div style="text-align: center; margin-top: 20px;">
                        <p>Don't have an account? <a href="#" onclick="WhisperApp.showAuthModal('register'); this.closest('.modal').remove(); return false;" style="color: #667eea;">Sign up</a></p>
                    </div>
                ` : `
                    <div style="text-align: center; margin-top: 20px;">
                        <p>Already have an account? <a href="#" onclick="WhisperApp.showAuthModal('login'); this.closest('.modal').remove(); return false;" style="color: #667eea;">Login</a></p>
                    </div>
                `}
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    async handleAuth(mode) {
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
    
    async toggleAvailability() {
        if (!this.user) return;
        
        try {
            const { update, ref } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
            const newStatus = !this.userData?.isAvailable;
            
            await update(ref(window.firebase.database, `publicProfiles/${this.user.uid}`), {
                isAvailable: newStatus,
                lastSeen: Date.now()
            });
            
            this.userData.isAvailable = newStatus;
            this.showToast(`You are now ${newStatus ? 'available' : 'unavailable'}`, 'success');
            
            // Update button
            const toggleBtn = document.getElementById('availability-toggle');
            if (toggleBtn) {
                toggleBtn.innerHTML = `<i class="fas fa-toggle-${newStatus ? 'on' : 'off'}"></i> ${newStatus ? 'Available' : 'Go Available'}`;
                if (newStatus) {
                    toggleBtn.classList.add('btn-success');
                } else {
                    toggleBtn.classList.remove('btn-success');
                }
            }
            
            this.loadAvailableProfiles();
            
        } catch (error) {
            console.error('Error toggling availability:', error);
            this.showToast('Error updating availability', 'error');
        }
    }
    
    showBuyCoinsModal() {
        this.showToast('Payment system coming soon. For now, coins are added manually by admin.', 'info');
    }
    
    shareProfile(userId, userName) {
        const url = `${window.location.origin}?ref=${userId}`;
        if (navigator.share) {
            navigator.share({
                title: `Check out ${userName} on Whisper+me`,
                text: `Connect with ${userName} on Whisper+me`,
                url: url
            });
        } else {
            navigator.clipboard.writeText(url);
            this.showToast('Profile link copied!', 'success');
        }
    }
    
    showRatingModal(callId) {
        const modal = document.createElement('div');
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 10000;';
        
        modal.innerHTML = `
            <div style="background: white; border-radius: 15px; padding: 40px; max-width: 400px; width: 90%;">
                <h2 style="margin-bottom: 20px; text-align: center;">Rate Your Call</h2>
                <div id="star-rating" style="display: flex; justify-content: center; gap: 10px; margin-bottom: 30px; font-size: 2rem;">
                    <i class="fas fa-star" onclick="WhisperApp.setRating(1)" style="cursor: pointer; color: #ddd;"></i>
                    <i class="fas fa-star" onclick="WhisperApp.setRating(2)" style="cursor: pointer; color: #ddd;"></i>
                    <i class="fas fa-star" onclick="WhisperApp.setRating(3)" style="cursor: pointer; color: #ddd;"></i>
                    <i class="fas fa-star" onclick="WhisperApp.setRating(4)" style="cursor: pointer; color: #ddd;"></i>
                    <i class="fas fa-star" onclick="WhisperApp.setRating(5)" style="cursor: pointer; color: #ddd;"></i>
                </div>
                <textarea id="call-comment" placeholder="How was your experience? (optional)" 
                          style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 20px; font-size: 16px; height: 100px;"></textarea>
                <button class="btn btn-primary" onclick="WhisperApp.submitRating('${callId}')" style="width: 100%; padding: 12px;">
                    Submit Rating
                </button>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    setRating(rating) {
        const stars = document.querySelectorAll('#star-rating .fa-star');
        stars.forEach((star, index) => {
            star.style.color = index < rating ? '#FFD700' : '#ddd';
        });
        this.currentRating = rating;
    }
    
    async submitRating(callId) {
        const rating = this.currentRating || 5;
        const comment = document.getElementById('call-comment')?.value || '';
        
        try {
            const { set, ref } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
            
            await set(ref(window.firebase.database, `ratings/${Date.now()}`), {
                callId: callId,
                rating: rating,
                comment: comment,
                reviewerId: this.user.uid,
                timestamp: Date.now()
            });
            
            this.showToast('Thank you for your rating!', 'success');
            document.querySelector('.modal')?.remove();
            
            // Return to main view
            this.showLoggedInUI();
            this.loadAvailableProfiles();
            
        } catch (error) {
            console.error('Error submitting rating:', error);
            this.showToast('Error submitting rating', 'error');
        }
    }
    
    showHome() {
        if (this.user) {
            this.showLoggedInUI();
            this.loadAvailableProfiles();
        } else {
            this.showLoggedOutUI();
        }
    }
    
    showProfileModal() {
        this.showToast('Profile editing coming soon', 'info');
    }
    
    showInviteModal() {
        const url = window.location.origin;
        if (navigator.share) {
            navigator.share({
                title: 'Join me on Whisper+me',
                text: 'Connect anonymously and get paid for conversations!',
                url: url
            });
        } else {
            navigator.clipboard.writeText(url);
            this.showToast('Invite link copied! Share with friends.', 'success');
        }
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new WhisperApp());
} else {
    new WhisperApp();
}
