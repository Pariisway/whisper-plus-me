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
        this.callStatusListener = null;
        
        // Initialize Firebase first
        this.initFirebase();
        
        // Make instance globally available
        window.WhisperApp = this;
    }
    
    async initFirebase() {
        console.log('🔥 Initializing Firebase...');
        
        // Load Firebase SDKs
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, GoogleAuthProvider, FacebookAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
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
            authMethods: { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup },
            databaseMethods: { ref, get, set, update, query, orderByChild, equalTo, limitToFirst, onChildAdded, onValue },
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
            const userSnapshot = await get(ref(window.firebase.database, `users/${this.user.uid}`));
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
                    <button class="btn btn-primary" onclick="window.WhisperApp.startCall('${profile.uid}')" ${(this.userData?.coins || 0) < 1 ? 'disabled style="opacity:0.5;"' : ''}>
                        <i class="fas fa-phone"></i> Call (${profile.callPrice || 1} Coin)
                    </button>
                </div>
            </div>
        `).join('');
    }
    
    setupIncomingCallListener() {
        // Clean up existing listener
        if (this.incomingCallListener) {
            this.incomingCallListener();
        }
        
        // Listen for incoming calls where user is the whisper
        const callsQuery = query(
            ref(window.firebase.database, 'calls'),
            orderByChild('whisperId'),
            equalTo(this.user.uid)
        );
        
        this.incomingCallListener = onChildAdded(callsQuery, async (snapshot) => {
            const call = snapshot.val();
            if (call.status === 'ringing') {
                this.showIncomingCallModal(call);
            }
        });
    }
    
    // ========== CALL SYSTEM ==========
    
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
            
            // Store in localStorage for crash recovery
            localStorage.setItem('currentCall', JSON.stringify(this.currentCall));
            
            // Show calling UI
            this.showCallingUI(callId);
            
            // Listen for call status changes
            this.setupCallStatusListener(callId);
            
        } catch (error) {
            console.error('Start call error:', error);
            this.showToast(error.message || 'Failed to start call', 'error');
        }
    }
    
    setupCallStatusListener(callId) {
        if (this.callStatusListener) {
            this.callStatusListener();
        }
        
        this.callStatusListener = onValue(ref(window.firebase.database, `calls/${callId}/status`), (snapshot) => {
            const status = snapshot.val();
            
            switch(status) {
                case 'active':
                    this.onCallAnswered(callId);
                    break;
                case 'ended':
                case 'expired':
                case 'failed':
                case 'rejected':
                    this.endCall();
                    break;
            }
        });
    }
    
    async onCallAnswered(callId) {
        try {
            // Load Agora SDK
            if (!window.AgoraManager) {
                const agoraScript = document.createElement('script');
                agoraScript.src = 'agora.js';
                document.head.appendChild(agoraScript);
                
                // Wait for Agora to load
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Join Agora channel
            await window.AgoraManager.joinChannel(callId);
            
            // Show active call UI
            this.showActiveCallUI();
            
            // Start timer
            this.startCallTimer();
            
        } catch (error) {
            console.error('Call answered error:', error);
            this.showToast('Failed to join call', 'error');
        }
    }
    
    startCallTimer() {
        let timeLeft = 300; // 5 minutes in seconds
        
        this.callTimer = setInterval(() => {
            timeLeft--;
            
            // Update timer display
            const timerElement = document.getElementById('call-timer');
            if (timerElement) {
                const minutes = Math.floor(timeLeft / 60);
                const seconds = timeLeft % 60;
                timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
            
            // End call when time's up
            if (timeLeft <= 0) {
                this.endCall();
            }
        }, 1000);
    }
    
    async endCall() {
        // Clear timer
        if (this.callTimer) {
            clearInterval(this.callTimer);
            this.callTimer = null;
        }
        
        // Leave Agora channel if exists
        if (window.AgoraManager) {
            await window.AgoraManager.leaveChannel();
        }
        
        // Clean up listeners
        this.cleanupCallListeners();
        
        // Clear localStorage
        localStorage.removeItem('currentCall');
        
        // Show review modal if call was active
        if (this.currentCall) {
            this.showReviewModal();
        }
        
        // Reset current call
        this.currentCall = null;
        
        // Return to main UI
        setTimeout(() => {
            this.showLoggedInUI();
            this.loadAvailableProfiles();
        }, 100);
    }
    
    async acceptCall(callId) {
        try {
            // Update call status to active
            await update(ref(window.firebase.database, `calls/${callId}`), {
                status: 'active',
                answeredAt: Date.now()
            });
            
            // Set current call
            this.currentCall = { callId };
            
            // Load Agora SDK
            if (!window.AgoraManager) {
                const agoraScript = document.createElement('script');
                agoraScript.src = 'agora.js';
                document.head.appendChild(agoraScript);
                
                // Wait for Agora to load
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Join Agora channel
            await window.AgoraManager.joinChannel(callId);
            
            // Show active call UI
            this.showActiveCallUI();
            
            // Start timer
            this.startCallTimer();
            
        } catch (error) {
            console.error('Accept call error:', error);
            this.showToast('Failed to accept call', 'error');
        }
    }
    
    async rejectCall(callId) {
        try {
            await update(ref(window.firebase.database, `calls/${callId}`), {
                status: 'rejected',
                endedAt: Date.now()
            });
            this.showToast('Call rejected', 'info');
        } catch (error) {
            console.error('Reject call error:', error);
        }
    }
    
    // ========== UI METHODS ==========
    
    showLoggedInUI() {
        const container = document.getElementById('app-container');
        container.innerHTML = `
            <!-- Navbar -->
            <nav style="background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 100;">
                <a href="#" style="color: white; font-size: 1.5rem; font-weight: bold; text-decoration: none;" onclick="window.WhisperApp.showLoggedInUI()">Whisper+me</a>
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
            
            <!-- Main Content -->
            <div style="max-width: 1400px; margin: 0 auto; padding: 20px;">
                <!-- iPhone Display -->
                <div class="iphone">
                    <div class="screen" id="iphone-screen">
                        <div style="text-align: center; padding: 40px;">
                            <i class="fas fa-phone" style="font-size: 48px; color: #667eea; margin-bottom: 20px;"></i>
                            <h3 style="margin-bottom: 10px;">Ready for whispers</h3>
                            <p style="color: #666; text-align: center;">Select a whisper below to start a call</p>
                            <div style="margin-top: 30px; display: flex; gap: 10px; justify-content: center;">
                                <button class="btn btn-primary" onclick="window.WhisperApp.toggleAvailability()" id="availability-toggle">
                                    <i class="fas fa-toggle-off"></i> ${this.userData?.isAvailable ? 'Available' : 'Go Available'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Available Whispers -->
                <div style="margin: 40px 0; display: flex; justify-content: space-between; align-items: center;">
                    <h2 style="color: white; font-size: 1.8rem;">
                        <i class="fas fa-users"></i> Available Whispers
                    </h2>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-secondary" onclick="window.WhisperApp.showInviteModal()">
                            <i class="fas fa-user-plus"></i> Invite Friend
                        </button>
                    </div>
                </div>
                
                <!-- Profiles Grid -->
                <div id="profiles-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; padding: 20px;">
                    Loading profiles...
                </div>
                
                <!-- Quick Actions -->
                <div style="margin: 40px auto; display: flex; gap: 15px; justify-content: center; padding: 20px;">
                    <button class="btn btn-primary" onclick="window.WhisperApp.showBuyCoinsModal()" style="padding: 12px 30px; font-size: 16px;">
                        <i class="fas fa-coins"></i> Buy 10 Coins ($15)
                    </button>
                </div>
            </div>
            
            <!-- Admin Link (if admin) -->
            ${this.userData?.isAdmin ? `
                <div style="position: fixed; bottom: 20px; right: 20px;">
                    <a href="#admin" class="btn btn-danger" onclick="window.WhisperApp.showAdminDashboard()">
                        <i class="fas fa-shield-alt"></i> Admin
                    </a>
                </div>
            ` : ''}
        `;
        
        // Update availability button
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
    
    showActiveCallUI() {
        const screen = document.getElementById('iphone-screen');
        if (!screen) return;
        
        screen.innerHTML = `
            <div style="text-align: center; padding: 40px; height: 100%; display: flex; flex-direction: column; justify-content: center;">
                <div style="width: 100px; height: 100px; border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                    <i class="fas fa-phone" style="font-size: 40px; color: white;"></i>
                </div>
                <h3 style="margin-bottom: 10px;">Live Call</h3>
                <div id="call-timer" style="font-size: 2.5rem; font-weight: bold; color: #4CAF50; margin: 20px 0;">5:00</div>
                <p style="color: #666; margin-bottom: 30px;">Anonymous whisper connected</p>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button class="btn btn-danger" onclick="window.WhisperApp.endCall()" style="padding: 15px 30px; font-size: 16px;">
                        <i class="fas fa-phone-slash"></i> End Call
                    </button>
                </div>
            </div>
        `;
    }
    
    showIncomingCallModal(call) {
        const modal = document.createElement('div');
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-close" onclick="this.parentElement.parentElement.remove()">×</div>
                <div style="text-align: center;">
                    <div style="width: 80px; height: 80px; border-radius: 50%; background: #4CAF50; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; animation: pulse 2s infinite;">
                        <i class="fas fa-phone" style="font-size: 30px; color: white;"></i>
                    </div>
                    <h2 style="margin-bottom: 10px;">Incoming Call!</h2>
                    <p style="color: #666; margin-bottom: 30px;">Anonymous caller wants to connect</p>
                    <div style="display: flex; gap: 15px; justify-content: center;">
                        <button class="btn btn-danger" onclick="this.closest('.modal-backdrop').remove(); window.WhisperApp.rejectCall('${call.callId}')" style="padding: 12px 30px;">
                            <i class="fas fa-times"></i> Reject
                        </button>
                        <button class="btn btn-success" onclick="window.WhisperApp.acceptCall('${call.callId}'); this.closest('.modal-backdrop').remove()" style="padding: 12px 30px;">
                            <i class="fas fa-phone"></i> Accept
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    showReviewModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-close" onclick="this.parentElement.parentElement.remove()">×</div>
                <div style="text-align: center;">
                    <h2 style="margin-bottom: 20px;">Rate your call</h2>
                    <div style="font-size: 2rem; margin-bottom: 20px; color: #FFD700;">
                        ${[1,2,3,4,5].map(i => `
                            <i class="far fa-star" onclick="window.WhisperApp.setRating(${i})" 
                               style="cursor: pointer; margin: 0 5px;" 
                               id="star-${i}"></i>
                        `).join('')}
                    </div>
                    <textarea id="review-comment" placeholder="Optional feedback..." 
                              style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 20px; min-height: 100px;"></textarea>
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">
                            Skip
                        </button>
                        <button class="btn btn-primary" onclick="window.WhisperApp.submitReview()">
                            Submit Review
                        </button>
                    </div>
                    <div style="margin-top: 20px;">
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input type="checkbox" id="report-issue">
                            <span>Report an issue with this call</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Star rating interaction
        window.WhisperApp.setRating = (rating) => {
            for (let i = 1; i <= 5; i++) {
                const star = document.getElementById(`star-${i}`);
                if (star) {
                    if (i <= rating) {
                        star.className = 'fas fa-star';
                    } else {
                        star.className = 'far fa-star';
                    }
                }
            }
            window.WhisperApp.currentRating = rating;
        };
    }
    
    // ========== CORE METHODS ==========
    
    async toggleAvailability() {
        try {
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
    
    async submitReview() {
        try {
            const rating = window.WhisperApp.currentRating;
            const comment = document.getElementById('review-comment')?.value;
            const reportIssue = document.getElementById('report-issue')?.checked;
            
            if (!rating) {
                this.showToast('Please select a rating', 'error');
                return;
            }
            
            const submitReviewFn = window.firebase.httpsCallable('submitReview');
            await submitReviewFn({
                callId: this.currentCall?.callId,
                rating,
                comment,
                reportIssue
            });
            
            this.showToast('Thank you for your feedback!', 'success');
            
            // Close modal
            document.querySelector('.modal-backdrop')?.remove();
            
        } catch (error) {
            console.error('Submit review error:', error);
            this.showToast('Failed to submit review', 'error');
        }
    }
    
    // ========== UTILITY METHODS ==========
    
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
    
    async checkResumeCall() {
        const savedCall = localStorage.getItem('currentCall');
        if (savedCall) {
            try {
                const callData = JSON.parse(savedCall);
                const callSnap = await get(ref(window.firebase.database, `calls/${callData.callId}`));
                const call = callSnap.val();
                
                if (call?.status === 'active') {
                    this.currentCall = callData;
                    await this.onCallAnswered(callData.callId);
                }
            } catch (error) {
                console.error('Resume call error:', error);
                localStorage.removeItem('currentCall');
            }
        }
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
    }
    
    // ========== AUTH METHODS (from original) ==========
    
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
            await window.firebase.authMethods.signInWithEmailAndPassword(window.firebase.auth, email, password);
            this.showToast('Logged in successfully!', 'success');
            document.querySelector('.modal')?.remove();
        } catch (error) {
            console.error('Login error:', error);
            this.showToast(error.message, 'error');
        }
    }
    
    async signUpWithEmail(email, password, displayName) {
        try {
            const userCredential = await window.firebase.authMethods.createUserWithEmailAndPassword(window.firebase.auth, email, password);
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
            const provider = new window.firebase.providers.GoogleAuthProvider();
            await window.firebase.authMethods.signInWithPopup(window.firebase.auth, provider);
            this.showToast('Logged in with Google!', 'success');
            document.querySelector('.modal')?.remove();
        } catch (error) {
            console.error('Google login error:', error);
            this.showToast(error.message, 'error');
        }
    }
    
    async loginWithFacebook() {
        try {
            const provider = new window.firebase.providers.FacebookAuthProvider();
            await window.firebase.authMethods.signInWithPopup(window.firebase.auth, provider);
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
    
    // ========== HELPER METHODS ==========
    
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
