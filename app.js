// Whisper+me - PRODUCTION FIXED VERSION
console.log('🚀 Whisper+me starting...');

// Configuration
const CONFIG = {
    coinPrice: 15,
    callDuration: 300,
    ringDuration: 30
};

// State
let currentUser = null;
let userData = {};
let selectedProfile = null;
let activeCall = null;
let incomingCall = null;
let callStatus = 'idle';
let agoraClient = null;
let localAudioTrack = null;
let shuffleProfiles = [];
let currentShuffleIndex = 0;
let callTimerInterval = null;
let timeLeft = 300;
let currentRating = 5;
let lastCallId = null; // For rating submission
let activeCallListener = null; // 🚨 Fix: Track active call listener
let ratingShown = false; // ⚠️ Fix: Prevent duplicate rating modal

// Firebase initialization - FIXED: SDKs now loaded in HTML
try {
    firebase.initializeApp({
        apiKey: "AIzaSyALbIJSI2C-p6IyMtj_F0ZqGyN1i79jOd4",
        authDomain: "whisper-chat-live.firebaseapp.com",
        databaseURL: "https://whisper-chat-live-default-rtdb.firebaseio.com",
        projectId: "whisper-chat-live",
        storageBucket: "whisper-chat-live.firebasestorage.app",
        messagingSenderId: "302894848452",
        appId: "1:302894848452:web:61a7ab21a269533c426c91"
    });
    console.log('✅ Firebase connected');
} catch (error) {
    console.log('Firebase already initialized:', error);
}

const auth = firebase.auth();
const db = firebase.database();
// FIXED: Add region to functions
const functions = firebase.functions('us-central1');

// Initialize App Check if available - ⚠️ Optional fix
try {
    if (typeof self !== 'undefined' && self.FirebaseAppCheck) {
        const appCheck = firebase.appCheck();
        appCheck.activate('6LceBRMqAAAAAMRgxPP5u-l8Xr9-syk7A1RQgfoV', true);
        console.log('✅ App Check initialized');
    }
} catch (error) {
    console.log('App Check not available:', error);
}

// Cloud Functions
let getAgoraToken, startCallFn, answerCallFn, submitReviewFn, cancelCallFn, declineCallFn, buyCoinsFn;

// 🚨 FIX: Cloud Function wrapper with token refresh
async function callFn(fn, payload) {
    if (auth.currentUser) {
        try {
            await auth.currentUser.getIdToken(true); // Force refresh token
        } catch (tokenError) {
            console.warn('Token refresh failed:', tokenError);
        }
    }
    return fn(payload);
}

// When page loads
document.addEventListener('DOMContentLoaded', async () => {
    console.log('📱 Page loaded');
    
    // Initialize Cloud Functions
    try {
        getAgoraToken = functions.httpsCallable('getAgoraToken');
        startCallFn = functions.httpsCallable('startCall');
        answerCallFn = functions.httpsCallable('answerCall');
        submitReviewFn = functions.httpsCallable('submitReview');
        cancelCallFn = functions.httpsCallable('cancelCall');
        declineCallFn = functions.httpsCallable('declineCall');
        buyCoinsFn = functions.httpsCallable('buyCoins');
        console.log('✅ Cloud Functions initialized');
    } catch (error) {
        console.error('Cloud Functions error:', error);
        showNotification('Some features may be unavailable. Please refresh.', true);
    }
    
    // Setup auth state listener
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            console.log('👤 User logged in:', user.email);
            await loadUserData();
            updateUI();
            await loadAvailableProfiles();
            setupCallListeners();
            hideLoading();
        } else {
            console.log('👤 No user logged in');
            showGuestUI();
            await loadAvailableProfiles();
            hideLoading();
        }
    });
    
    // Setup event listeners
    setupEventListeners();
    
    // Initialize shuffle
    updateShuffleProfile();
});

// Load user data
async function loadUserData() {
    if (!currentUser) return;
    
    try {
        const userRef = db.ref('users/' + currentUser.uid);
        userRef.on('value', (snap) => {
            if (snap.exists()) {
                userData = snap.val();
                
                // Generate whisper ID if not exists
                if (!userData.whisperId) {
                    const whisperId = generateWhisperId();
                    userRef.update({ whisperId: whisperId });
                    userData.whisperId = whisperId;
                }
                
                console.log('📊 User data loaded:', userData);
                updateUI();
                updateAvailabilityToggle();
            }
        });
    } catch (error) {
        console.error('Error loading user data:', error);
    }
}

// 🚨 FIX: Generate non-colliding whisper ID
function generateWhisperId() {
    // Use timestamp to avoid collisions
    return Date.now().toString().slice(-5); // Last 5 digits of timestamp
}

// Update UI
function updateUI() {
    const guestMenu = document.getElementById('guest-menu');
    const loggedInMenu = document.getElementById('logged-in-menu');
    
    if (currentUser) {
        if (guestMenu) guestMenu.style.display = 'none';
        if (loggedInMenu) loggedInMenu.style.display = 'flex';
        
        // Update coins
        const coinsCount = document.getElementById('coins-count');
        const dashCoins = document.getElementById('dash-coins');
        const dashEarnings = document.getElementById('dash-earnings');
        const dashCalls = document.getElementById('dash-calls');
        const dashRating = document.getElementById('dash-rating');
        
        if (coinsCount) coinsCount.textContent = userData.coins || 0;
        if (dashCoins) dashCoins.textContent = userData.coins || 0;
        if (dashEarnings) dashEarnings.textContent = '$' + (userData.earnings || 0);
        if (dashCalls) dashCalls.textContent = userData.callsCompleted || 0;
        if (dashRating) dashRating.textContent = userData.rating ? userData.rating.toFixed(1) : '5.0';
        
        // Update profile form
        const profileBio = document.getElementById('profile-bio');
        const profileTwitter = document.getElementById('profile-twitter');
        const profileInstagram = document.getElementById('profile-instagram');
        const profileTiktok = document.getElementById('profile-tiktok');
        const profilePhoto = document.getElementById('profile-photo');
        const paypalEmail = document.getElementById('paypal-email');
        
        if (profileBio) profileBio.value = userData.bio || '';
        if (profileTwitter) profileTwitter.value = userData.social?.twitter || '';
        if (profileInstagram) profileInstagram.value = userData.social?.instagram || '';
        if (profileTiktok) profileTiktok.value = userData.social?.tiktok || '';
        if (profilePhoto) profilePhoto.value = userData.photoURL || '';
        if (paypalEmail) paypalEmail.value = userData.paypalEmail || '';
    } else {
        if (guestMenu) guestMenu.style.display = 'block';
        if (loggedInMenu) loggedInMenu.style.display = 'none';
    }
}

function updateAvailabilityToggle() {
    const toggle = document.getElementById('availability-toggle');
    if (toggle) {
        toggle.checked = userData.isAvailable || false;
    }
}

// Load available profiles
async function loadAvailableProfiles() {
    console.log('🔍 Loading profiles...');
    
    const container = document.getElementById('profiles-container');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #888;">Loading profiles...</div>';
    
    try {
        const snapshot = await db.ref('publicProfiles').once('value');
        const profiles = [];
        
        snapshot.forEach((child) => {
            const user = child.val();
            const userId = child.key;
            
            if (user.bio && user.isWhisper === true) {
                const isCurrentUser = currentUser && userId === currentUser.uid;
                
                profiles.push({
                    id: userId,
                    uid: userId,
                    name: user.displayName || user.bio.split(' ').slice(0, 2).join(' ') || 'Anonymous',
                    bio: user.bio,
                    photo: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email?.split('@')[0] || 'User')}&background=7c3aed&color=fff&size=150`,
                    whisperId: user.whisperId || '00000',
                    social: user.social || {},
                    rating: user.rating || 5.0,
                    calls: user.callsCompleted || 0,
                    isAvailable: user.isAvailable || false,
                    isCurrentUser: isCurrentUser,
                    callPrice: user.callPrice || 1
                });
            }
        });
        
        console.log(`📊 Found ${profiles.length} whisper profiles`);
        
        if (profiles.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #888;">
                    <i class="fas fa-users" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                    <p>No whispers available yet</p>
                    <p style="font-size: 0.9rem;">Become a whisper by enabling availability in your dashboard</p>
                </div>
            `;
            return;
        }
        
        displayProfiles(profiles);
        
        // Update shuffle profiles
        shuffleProfiles = profiles.filter(p => !p.isCurrentUser && p.isAvailable);
        if (shuffleProfiles.length === 0) {
            shuffleProfiles = profiles.filter(p => !p.isCurrentUser);
        }
        
        console.log(`🎲 ${shuffleProfiles.length} profiles in shuffle mode`);
        updateShuffleProfile();
        
    } catch (error) {
        console.error('Error loading profiles:', error);
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #888;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 1rem; color: #ef4444;"></i>
                <p>Error loading profiles</p>
                <p style="font-size: 0.9rem;">Please check your connection</p>
            </div>
        `;
    }
}

// Display profiles
function displayProfiles(profiles) {
    const container = document.getElementById('profiles-container');
    if (!container) return;
    
    let html = '';
    
    profiles.forEach(profile => {
        const isCurrentUser = profile.isCurrentUser;
        const socialLinks = profile.social || {};
        
        html += `
            <div class="profile-card" onclick="viewProfile('${profile.id}')">
                <div class="profile-header">
                    <img src="${profile.photo}" alt="${profile.name}" class="profile-img" 
                         onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name)}&background=7c3aed&color=fff'">
                    <div class="profile-info">
                        <h3>${profile.name} ${isCurrentUser ? '<span style="color: #7c3aed; font-size: 0.8rem;">(YOU)</span>' : ''}</h3>
                        <div class="profile-price">${profile.callPrice || 1} Coin ($${(profile.callPrice || 1) * 15})</div>
                        <div class="whisper-id-small">ID: ${profile.whisperId}</div>
                        <div class="availability-indicator">
                            <div class="availability-dot" style="background: ${profile.isAvailable ? '#10b981' : '#888'};"></div>
                            <span>${profile.isAvailable ? 'Available' : 'Offline'}</span>
                        </div>
                    </div>
                </div>
                <p class="profile-bio">${profile.bio.substring(0, 80)}${profile.bio.length > 80 ? '...' : ''}</p>
                
                ${Object.keys(socialLinks).length > 0 ? `
                <div class="profile-social-links">
                    ${socialLinks.twitter ? `<a href="${socialLinks.twitter}" target="_blank" class="social-link-small"><i class="fab fa-twitter"></i> Twitter</a>` : ''}
                    ${socialLinks.instagram ? `<a href="${socialLinks.instagram}" target="_blank" class="social-link-small"><i class="fab fa-instagram"></i> Instagram</a>` : ''}
                    ${socialLinks.tiktok ? `<a href="${socialLinks.tiktok}" target="_blank" class="social-link-small"><i class="fab fa-tiktok"></i> TikTok</a>` : ''}
                </div>
                ` : ''}
                
                <button class="btn btn-primary" onclick="event.stopPropagation(); viewProfile('${profile.id}')" 
                        style="width: 100%; margin-top: 10px;" ${isCurrentUser ? 'disabled' : ''}>
                    <i class="fas fa-phone-alt"></i> ${isCurrentUser ? 'Your Profile' : `Call (${profile.callPrice || 1} Coin)`}
                </button>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Update shuffle profile
function updateShuffleProfile() {
    if (shuffleProfiles.length === 0) {
        document.getElementById('shuffle-img').src = 'https://ui-avatars.com/api/?name=User&background=7c3aed&color=fff';
        document.getElementById('shuffle-name').textContent = 'No whispers available';
        document.getElementById('shuffle-price').textContent = '1 Coin';
        document.getElementById('shuffle-id').textContent = 'ID: 00000';
        document.getElementById('shuffle-bio').textContent = 'Check back soon for available whispers';
        selectedProfile = null;
        return;
    }
    
    const profile = shuffleProfiles[currentShuffleIndex];
    selectedProfile = profile;
    
    document.getElementById('shuffle-img').src = profile.photo;
    document.getElementById('shuffle-name').textContent = profile.name;
    document.getElementById('shuffle-price').textContent = `${profile.callPrice || 1} Coin`;
    document.getElementById('shuffle-id').textContent = `ID: ${profile.whisperId}`;
    document.getElementById('shuffle-bio').textContent = profile.bio.substring(0, 100) + (profile.bio.length > 100 ? '...' : '');
}

// View profile
window.viewProfile = function(profileId) {
    if (!currentUser) {
        showAuthModal('login');
        showNotification('Please login to view profiles', true);
        return;
    }
    
    let profile = shuffleProfiles.find(p => p.id === profileId);
    
    if (!profile) {
        showNotification('Profile not found', true);
        return;
    }
    
    selectedProfile = profile;
    const isCurrentUser = currentUser && profile.uid === currentUser.uid;
    
    // Update modal
    document.getElementById('modal-profile-img').src = profile.photo;
    document.getElementById('modal-profile-name').textContent = profile.name + (isCurrentUser ? ' (YOU)' : '');
    document.getElementById('modal-profile-price').textContent = `${profile.callPrice || 1} Coin ($${(profile.callPrice || 1) * 15})`;
    document.getElementById('modal-profile-id').textContent = `ID: ${profile.whisperId}`;
    document.getElementById('modal-profile-bio').textContent = profile.bio;
    
    // Update social links
    const socialLinks = document.getElementById('modal-social-links');
    socialLinks.innerHTML = '';
    
    const socials = profile.social || {};
    if (socials.twitter) {
        socialLinks.innerHTML += `<a href="${socials.twitter}" target="_blank" class="modal-social-link"><i class="fab fa-twitter"></i></a>`;
    }
    if (socials.instagram) {
        socialLinks.innerHTML += `<a href="${socials.instagram}" target="_blank" class="modal-social-link"><i class="fab fa-instagram"></i></a>`;
    }
    if (socials.tiktok) {
        socialLinks.innerHTML += `<a href="${socials.tiktok}" target="_blank" class="modal-social-link"><i class="fab fa-tiktok"></i></a>`;
    }
    
    // Update call button
    const callButton = document.querySelector('#profile-modal .btn-primary');
    if (isCurrentUser) {
        callButton.innerHTML = '<i class="fas fa-user"></i> This is Your Profile';
        callButton.disabled = true;
        callButton.classList.remove('btn-primary');
        callButton.classList.add('btn-secondary');
        callButton.onclick = null;
    } else {
        callButton.innerHTML = `<i class="fas fa-phone-alt"></i> Call Now (${profile.callPrice || 1} Coin)`;
        callButton.disabled = false;
        callButton.classList.remove('btn-secondary');
        callButton.classList.add('btn-primary');
        callButton.onclick = startCall;
    }
    
    showModal('profile-modal');
};

// Start call
window.startCall = async function() {
    if (!selectedProfile) {
        showNotification('No profile selected', true);
        return;
    }
    
    if (!currentUser) {
        showAuthModal('login');
        return;
    }
    
    if (!selectedProfile.isAvailable) {
        showNotification('This whisper is currently unavailable', true);
        return;
    }
    
    closeModal('profile-modal');
    showNotification(`Calling ${selectedProfile.name}...`);
    
    try {
        // 🚨 FIX: Use wrapper with token refresh
        const result = await callFn(startCallFn, {
            whisperId: selectedProfile.uid
        });
        
        const callId = result.data.callId;
        
        activeCall = {
            id: callId,
            whisperId: selectedProfile.uid,
            whisperName: selectedProfile.name,
            whisperPhoto: selectedProfile.photo,
            whisperIdNum: selectedProfile.whisperId,
            coins: selectedProfile.callPrice || 1
        };
        
        callStatus = 'waiting';
        showCallerWaitingInterface();
        
        // 🚨 FIX: Attach listener for this specific call only
        attachActiveCallListener(callId);
        
    } catch (error) {
        console.error('Start call error:', error);
        showNotification(error.message || 'Failed to start call', true);
    }
};

// Start call from shuffle
window.startCallFromShuffle = function() {
    if (!currentUser) {
        showAuthModal('login');
        return;
    }
    
    if (!selectedProfile) {
        showNotification('No profile selected', true);
        return;
    }
    
    startCall();
};

// Next shuffle profile
window.nextShuffleProfile = function() {
    if (shuffleProfiles.length === 0 || callStatus !== 'idle') return;
    
    currentShuffleIndex = (currentShuffleIndex + 1) % shuffleProfiles.length;
    updateShuffleProfile();
};

// Show caller waiting interface
function showCallerWaitingInterface() {
    const iphoneScreen = document.querySelector('.iphone-screen');
    if (!iphoneScreen) return;
    
    iphoneScreen.innerHTML = `
        <div class="phone-status-bar">
            <span>9:41 AM</span>
            <span>Calling...</span>
        </div>
        
        <div class="phone-content">
            <img src="${selectedProfile.photo}" alt="${selectedProfile.name}" 
                 class="shuffle-profile-img" style="width: 120px; height: 120px; border-radius: 50%; border: 3px solid #7c3aed;">
            <h3 class="shuffle-profile-name">${selectedProfile.name}</h3>
            <p style="color: #666; margin: 0.5rem 0;">ID: ${selectedProfile.whisperId}</p>
            <p class="call-status" id="call-status" style="color: #fbbf24; margin: 1rem 0;">
                <i class="fas fa-phone-alt"></i> Ringing... Waiting for answer
            </p>
            
            <div class="phone-controls">
                <button class="phone-btn phone-btn-hangup" onclick="cancelCall()" style="background: #ef4444;">
                    <i class="fas fa-phone-slash"></i>
                </button>
            </div>
            
            <p style="font-size: 0.9rem; color: #888; margin-top: 1rem;">
                ${selectedProfile.callPrice || 1} coin${(selectedProfile.callPrice || 1) > 1 ? 's' : ''} ($${(selectedProfile.callPrice || 1) * 15}) deducted
            </p>
        </div>
    `;
}

// Setup call listeners
function setupCallListeners() {
    if (!currentUser) return;
    
    console.log('🔔 Setting up call listeners for user:', currentUser.uid);
    
    // Listen for incoming calls (only for whispers)
    if (userData.isWhisper) {
        db.ref('calls').orderByChild('whisperId').equalTo(currentUser.uid).on('child_added', (snap) => {
            const call = snap.val();
            if (call.status === 'ringing' && callStatus === 'idle') {
                handleIncomingCall(snap.key, call);
            }
        });
    }
}

// 🚨 FIX: Attach listener for specific active call only
function attachActiveCallListener(callId) {
    // Remove previous listener if exists
    if (activeCallListener) {
        db.ref(`calls/${callId}`).off('value', activeCallListener);
    }
    
    activeCallListener = (snap) => {
        const call = snap.val();
        if (!call) return;
        
        // If we're the caller and whisper answered
        if (activeCall && activeCall.id === callId && call.callerId === currentUser.uid) {
            if (call.status === 'answered' && callStatus === 'waiting') {
                startAudioCall(callId);
            } else if (call.status === 'declined' && callStatus === 'waiting') {
                endCallEarly(true);
                showNotification('Call declined. Coin refunded.');
            } else if (call.status === 'expired' && callStatus === 'waiting') {
                endCallEarly(true);
                showNotification('Call expired. Coin refunded.');
            }
        }
        
        // If call ended (server authoritative)
        if (activeCall && activeCall.id === callId && call.status === 'ended') {
            if (callStatus === 'active') {
                lastCallId = activeCall.id; // Store for rating
                endCallCleanup();
                resetPhoneInterface();
                showNotification('Call ended');
                
                // Show rating modal for caller
                if (currentUser.uid !== activeCall.whisperId) {
                    setTimeout(() => {
                        showRatingOnce(); // ⚠️ FIX: Prevent duplicate
                    }, 1000);
                }
            }
        }
    };
    
    db.ref(`calls/${callId}`).on('value', activeCallListener);
}

// Handle incoming call
async function handleIncomingCall(callId, call) {
    if (callStatus !== 'idle') return;
    
    // Get caller info
    const callerSnap = await db.ref(`publicProfiles/${call.callerId}`).once('value');
    const callerData = callerSnap.val() || {};
    
    incomingCall = {
        id: callId,
        callerId: call.callerId,
        callerName: callerData.displayName || call.callerName || 'Anonymous',
        callerPhoto: callerData.photoURL || 'https://ui-avatars.com/api/?name=Caller&background=7c3aed&color=fff',
        coins: call.coinsCharged || 1
    };
    
    callStatus = 'ringing';
    showIncomingCallInterface();
    
    // Attach listener for this incoming call
    attachActiveCallListener(callId);
}

// Show incoming call interface
function showIncomingCallInterface() {
    const iphoneScreen = document.querySelector('.iphone-screen');
    if (!iphoneScreen) return;
    
    iphoneScreen.innerHTML = `
        <div class="phone-status-bar">
            <span>9:41 AM</span>
            <span style="color: #fbbf24;">Incoming Call</span>
        </div>
        
        <div class="phone-content">
            <img src="${incomingCall.callerPhoto}" alt="${incomingCall.callerName}" 
                 class="shuffle-profile-img" style="width: 140px; height: 140px; border-radius: 50%; border: 5px solid #fbbf24;">
            
            <h3 class="shuffle-profile-name" style="margin-top: 1rem;">${incomingCall.callerName}</h3>
            <p class="call-status" id="call-status" style="color: #10b981; margin: 0.5rem 0;">INCOMING CALL</p>
            <div class="call-price" style="margin: 1rem 0; font-size: 1.5rem; color: #10b981; font-weight: bold;">
                ${incomingCall.coins} Coin${incomingCall.coins > 1 ? 's' : ''} ($${incomingCall.coins * 12}) Earned
            </div>
            
            <div class="phone-controls">
                <button class="phone-btn phone-btn-call" onclick="answerCall()" style="background: #10b981;">
                    <i class="fas fa-phone-alt"></i>
                </button>
                <button class="phone-btn phone-btn-hangup" onclick="declineCall()" style="background: #ef4444;">
                    <i class="fas fa-phone-slash"></i>
                </button>
            </div>
            
            <div class="ring-timer" style="margin-top: 1rem; font-size: 0.9rem; color: #888;">
                Tap to answer
            </div>
        </div>
    `;
}

// Answer call
window.answerCall = async function() {
    if (!incomingCall) return;
    
    console.log('✅ Whisper answering call:', incomingCall.id);
    
    try {
        // 🚨 FIX: Use wrapper with token refresh
        await callFn(answerCallFn, {
            callId: incomingCall.id
        });
        
        activeCall = {
            id: incomingCall.id,
            callerId: incomingCall.callerId,
            callerName: incomingCall.callerName,
            callerPhoto: incomingCall.callerPhoto,
            coins: incomingCall.coins
        };
        
        callStatus = 'active';
        showCallInProgressInterface(true);
        
        await joinAgoraChannel(incomingCall.id, true);
        showNotification('✅ Connected! Speak now.');
        
        incomingCall = null;
        
    } catch (error) {
        console.error('Answer call error:', error);
        showNotification('Failed to answer call', true);
    }
};

// Start audio call (caller side)
async function startAudioCall(callId) {
    if (!activeCall || !callId) return;
    
    callStatus = 'active';
    showCallInProgressInterface(false);
    
    try {
        await joinAgoraChannel(callId, false);
        showNotification('✅ Connected! Speak now.');
    } catch (error) {
        console.error('Start audio call error:', error);
        showNotification('Failed to connect audio', true);
    }
}

// Join Agora channel - 🚨 FIXED: Get App ID from server
async function joinAgoraChannel(callId, isWhisper = false) {
    try {
        // Get token and appId from Cloud Function
        // 🚨 FIX: Use wrapper with token refresh
        const tokenResult = await callFn(getAgoraToken, {
            channel: callId,
            uid: currentUser.uid
        });
        
        const { token, appId } = tokenResult.data; // 🚨 FIX: Get appId from server
        
        // Load Agora SDK if needed - FIXED: Use proper loading
        if (!window.AgoraRTC) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://download.agora.io/sdk/release/AgoraRTC_N-4.18.2.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        
        // FIXED: Use consistent UID logic - string for simplicity
        const agoraUid = currentUser.uid.substring(0, 32); // Agora max 32 chars
        
        // Create client and join
        agoraClient = window.AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        
        // FIXED: Add connection state listener for crash recovery
        agoraClient.on('connection-state-change', (curState, prevState) => {
            console.log('Agora connection state:', prevState, '->', curState);
            if (curState === 'DISCONNECTED' && callStatus === 'active') {
                console.error('Agora disconnected unexpectedly');
                endCallCleanup();
                resetPhoneInterface();
                showNotification('Connection lost. Call ended.', true);
            }
        });
        
        // FIXED: Subscribe to remote user's audio
        agoraClient.on('user-published', async (user, mediaType) => {
            await agoraClient.subscribe(user, mediaType);
            if (mediaType === 'audio') {
                user.audioTrack.play();
                console.log('Remote audio subscribed and playing');
            }
        });
        
        // 🚨 FIX: Use appId from server, not hardcoded
        await agoraClient.join(
            appId, // 🚨 FIXED: Get from server
            callId,
            token,
            agoraUid
        );
        
        localAudioTrack = await window.AgoraRTC.createMicrophoneAudioTrack();
        await agoraClient.publish([localAudioTrack]);
        
        console.log('✅ Successfully joined Agora channel');
        
        // Start call timer
        startCallTimer();
        
        return true;
    } catch (error) {
        console.error('Agora join error:', error);
        showNotification('Failed to connect audio', true);
        return false;
    }
}

// Start call timer
function startCallTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
    }
    
    timeLeft = CONFIG.callDuration;
    updateCallTimer();
    
    callTimerInterval = setInterval(() => {
        timeLeft--;
        updateCallTimer();
        
        if (timeLeft <= 0) {
            clearInterval(callTimerInterval);
            callTimerInterval = null;
            endCall();
        }
    }, 1000);
}

// Update call timer display
function updateCallTimer() {
    const timerEl = document.getElementById('call-timer');
    if (!timerEl) return;
    
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Show call in progress interface
function showCallInProgressInterface(isWhisper = false) {
    const iphoneScreen = document.querySelector('.iphone-screen');
    if (!iphoneScreen) return;
    
    const otherUser = isWhisper 
        ? { name: activeCall?.callerName || 'Caller', photo: activeCall?.callerPhoto }
        : { name: selectedProfile?.name || 'Whisper', photo: selectedProfile?.photo };
    
    iphoneScreen.innerHTML = `
        <div class="phone-status-bar">
            <span>9:41 AM</span>
            <span style="color: #10b981;">Live Call</span>
        </div>
        
        <div class="phone-content">
            <img src="${otherUser.photo}" alt="${otherUser.name}" 
                 class="shuffle-profile-img" style="width: 120px; height: 120px; border-radius: 50%; border: 3px solid #10b981;">
            <h3 class="shuffle-profile-name">${otherUser.name}</h3>
            <p class="call-status" id="call-status" style="color: #10b981;">
                <i class="fas fa-circle" style="font-size: 0.8rem; margin-right: 0.5rem;"></i> Connected
            </p>
            <div class="call-timer" id="call-timer" style="font-size: 2rem; font-weight: bold; margin: 1rem 0; color: #7c3aed;">05:00</div>
            
            <div class="phone-controls">
                <button class="phone-btn phone-btn-hangup" onclick="endCall()" style="background: #ef4444;">
                    <i class="fas fa-phone-slash"></i>
                </button>
            </div>
            
            <div class="mic-status" style="margin-top: 1rem; font-size: 0.9rem; color: #10b981;">
                <i class="fas fa-microphone"></i> Microphone is live
            </div>
        </div>
    `;
}

// End call
window.endCall = async function() {
    if (!activeCall) return;
    
    console.log('📞 Ending call:', activeCall.id);
    
    // Leave Agora channel
    await leaveAgoraChannel();
    
    // Cleanup
    endCallCleanup();
    resetPhoneInterface();
    
    showNotification('Call ended');
    
    // Show rating modal for caller
    if (currentUser.uid !== activeCall.whisperId) {
        setTimeout(() => {
            showRatingOnce(); // ⚠️ FIX: Prevent duplicate
        }, 1000);
    }
};

// Leave Agora channel
async function leaveAgoraChannel() {
    try {
        if (localAudioTrack) {
            localAudioTrack.stop();
            localAudioTrack.close();
            localAudioTrack = null;
        }
        
        if (agoraClient) {
            await agoraClient.leave();
            agoraClient = null;
        }
    } catch (error) {
        console.error('Error leaving channel:', error);
    }
}

// End call cleanup
function endCallCleanup() {
    // Remove active call listener
    if (activeCallListener) {
        const callId = activeCall ? activeCall.id : (incomingCall ? incomingCall.id : null);
        if (callId) {
            db.ref(`calls/${callId}`).off('value', activeCallListener);
        }
        activeCallListener = null;
    }
    
    if (activeCall) {
        lastCallId = activeCall.id; // Store for rating
    }
    
    activeCall = null;
    selectedProfile = null;
    incomingCall = null;
    callStatus = 'idle';
    
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
}

// Reset phone interface
function resetPhoneInterface() {
    const iphoneScreen = document.querySelector('.iphone-screen');
    if (!iphoneScreen) return;
    
    iphoneScreen.innerHTML = `
        <div class="phone-status-bar">
            <span>9:41 AM</span>
            <span>Whisper+me</span>
        </div>
        
        <div class="phone-content">
            <div class="shuffle-indicator">
                <i class="fas fa-random"></i> SHUFFLE MODE
            </div>
            
            <div class="shuffle-profile" id="shuffle-profile">
                <img src="" alt="Profile" class="shuffle-profile-img" id="shuffle-img">
                <h3 class="shuffle-profile-name" id="shuffle-name"></h3>
                <div class="shuffle-profile-price" id="shuffle-price"></div>
                <div class="whisper-id-display" id="shuffle-id"></div>
                <p class="shuffle-profile-bio" id="shuffle-bio"></p>
            </div>
            
            <div class="phone-controls">
                <button class="phone-btn phone-btn-call" onclick="startCallFromShuffle()">
                    <i class="fas fa-phone-alt"></i>
                </button>
                <button class="phone-btn" onclick="nextShuffleProfile()" style="background: #666; color: white;">
                    <i class="fas fa-arrow-right"></i>
                </button>
            </div>
            
            <div class="shuffle-timer">
                Swipe to see next whisper
            </div>
        </div>
    `;
    
    updateShuffleProfile();
}

// Cancel call - FIXED: Now calls server function
window.cancelCall = async function() {
    if (!activeCall) return;
    
    showNotification('Cancelling call...');
    
    try {
        // 🚨 FIX: Use wrapper with token refresh
        await callFn(cancelCallFn, {
            callId: activeCall.id
        });
        
        showNotification('Call cancelled');
    } catch (error) {
        console.error('Cancel call error:', error);
        showNotification('Failed to cancel call', true);
    }
    
    endCallCleanup();
    resetPhoneInterface();
};

// Decline call - FIXED: Now calls server function
window.declineCall = async function() {
    if (!incomingCall) return;
    
    showNotification('Declining call...');
    
    try {
        // 🚨 FIX: Use wrapper with token refresh
        await callFn(declineCallFn, {
            callId: incomingCall.id
        });
        
        showNotification('Call declined');
    } catch (error) {
        console.error('Decline call error:', error);
        showNotification('Failed to decline call', true);
    }
    
    endCallCleanup();
    resetPhoneInterface();
};

// End call early
window.endCallEarly = function(refund = false) {
    showNotification(refund ? 'Call ended. Coin refunded.' : 'Call ended.');
    endCallCleanup();
    resetPhoneInterface();
};

// Profile management
window.saveProfile = async function() {
    if (!currentUser) return;
    
    const bio = document.getElementById('profile-bio').value.trim();
    const paypalEmail = document.getElementById('paypal-email').value.trim();
    const twitter = document.getElementById('profile-twitter').value.trim();
    const instagram = document.getElementById('profile-instagram').value.trim();
    const tiktok = document.getElementById('profile-tiktok').value.trim();
    const photoURL = document.getElementById('profile-photo').value.trim();
    
    if (!bio) {
        showNotification('Please enter a bio', true);
        return;
    }
    
    const updates = {
        bio: bio,
        paypalEmail: paypalEmail,
        social: {
            twitter: twitter,
            instagram: instagram,
            tiktok: tiktok
        },
        photoURL: photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.email?.split('@')[0] || 'User')}&background=7c3aed&color=fff&size=150`,
        isWhisper: true,
        displayName: bio.split(' ').slice(0, 2).join(' ') || 'Anonymous',
        updatedAt: Date.now()
    };
    
    try {
        await db.ref('users/' + currentUser.uid).update(updates);
        await db.ref('publicProfiles/' + currentUser.uid).update(updates);
        
        showNotification('✅ Profile saved successfully!');
        closeModal('dashboard-modal');
        
        await loadUserData();
        loadAvailableProfiles();
        
    } catch (error) {
        console.log('Save error:', error);
        showNotification('Failed to save profile', true);
    }
};

window.toggleAvailability = async function() {
    if (!currentUser) return;
    
    const toggle = document.getElementById('availability-toggle');
    const isAvailable = toggle.checked;
    
    try {
        await db.ref('users/' + currentUser.uid).update({
            isAvailable: isAvailable,
            isWhisper: isAvailable
        });
        
        await db.ref('publicProfiles/' + currentUser.uid).update({
            isAvailable: isAvailable,
            isWhisper: isAvailable
        });
        
        showNotification(isAvailable ? '✅ You are now available to receive calls' : '⏸️ You are now unavailable');
        
        userData.isAvailable = isAvailable;
        userData.isWhisper = isAvailable;
        
        loadAvailableProfiles();
        
    } catch (error) {
        console.log('Toggle error:', error);
        showNotification('Failed to update availability', true);
    }
};

// Auth functions
window.showAuthModal = function(tab = 'login') {
    switchAuthTab(tab);
    showModal('auth-modal');
};

window.switchAuthTab = function(tab) {
    const authModalTitle = document.getElementById('auth-modal-title');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    
    if (authModalTitle) authModalTitle.textContent = tab === 'login' ? 'Login to Whisper+me' : 'Sign Up for Whisper+me';
    if (loginForm) loginForm.style.display = tab === 'login' ? 'block' : 'none';
    if (signupForm) signupForm.style.display = tab === 'signup' ? 'block' : 'none';
};

window.login = async function() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    
    if (!email || !password) {
        showNotification('Please enter email and password', true);
        return;
    }
    
    showNotification('Logging in...');
    
    try {
        await auth.signInWithEmailAndPassword(email, password);
        showNotification('✅ Login successful!');
        closeModal('auth-modal');
    } catch (error) {
        console.log('Login error:', error);
        showNotification('Login failed. Check your credentials.', true);
    }
};

window.signup = async function() {
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    
    if (!email || !password || !confirm) {
        showNotification('Please fill all fields', true);
        return;
    }
    
    if (password.length < 6) {
        showNotification('Password must be at least 6 characters', true);
        return;
    }
    
    if (password !== confirm) {
        showNotification('Passwords do not match', true);
        return;
    }
    
    showNotification('Creating account...');
    
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        const userData = {
            email: email,
            coins: 5,
            isAvailable: false,
            isWhisper: false,
            createdAt: Date.now(),
            whisperId: generateWhisperId(),
            bio: 'New whisper user',
            displayName: email.split('@')[0],
            photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(email.split('@')[0])}&background=7c3aed&color=fff&size=150`,
            social: {},
            rating: 5.0,
            callsCompleted: 0,
            earnings: 0
        };
        
        await db.ref('users/' + user.uid).set(userData);
        await db.ref('publicProfiles/' + user.uid).set(userData);
        
        showNotification('✅ Account created! 5 free coins added.');
        closeModal('auth-modal');
    } catch (error) {
        console.log('Signup error:', error);
        showNotification('Signup failed. Email may already be in use.', true);
    }
};

window.logout = async function() {
    try {
        if (activeCall) {
            await endCall();
        }
        
        await auth.signOut();
        showNotification('Logged out successfully');
        showGuestUI();
        loadAvailableProfiles();
        resetPhoneInterface();
    } catch (error) {
        console.log('Logout error:', error);
        showNotification('Logout failed', true);
    }
};

// Dashboard
window.showDashboard = function() {
    if (!currentUser) {
        showAuthModal('login');
        return;
    }
    showModal('dashboard-modal');
};

// Modal functions
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

function hideLoading() {
    const loading = document.getElementById('loading-screen');
    if (loading) {
        loading.style.display = 'none';
    }
}

// Notification
function showNotification(message, isError = false) {
    const notification = document.getElementById('notification');
    if (!notification) return;
    
    notification.textContent = message;
    notification.className = 'notification show';
    
    if (isError) {
        notification.classList.add('error');
    }
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function showGuestUI() {
    const guestMenu = document.getElementById('guest-menu');
    const loggedInMenu = document.getElementById('logged-in-menu');
    if (guestMenu) guestMenu.style.display = 'block';
    if (loggedInMenu) loggedInMenu.style.display = 'none';
}

function setupEventListeners() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
            }
        });
    });
    
    // Enter key for login/signup
    document.getElementById('login-password')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') login();
    });
    
    document.getElementById('signup-confirm')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') signup();
    });
    
    // ⚠️ FIX: Send beacon for crash cleanup
    window.addEventListener('beforeunload', function() {
        if (activeCall && callStatus === 'active') {
            console.warn('User is leaving during active call, sending cleanup beacon');
            navigator.sendBeacon(
                'https://us-central1-whisper-chat-live.cloudfunctions.net/cleanupCall',
                JSON.stringify({ callId: activeCall.id, userId: currentUser?.uid })
            );
        }
    });
}

// Coin functions - FIXED: Now server-side only
let selectedCoinOption = 1;

window.selectCoinOption = function(coins) {
    selectedCoinOption = coins;
    document.querySelectorAll('.coin-option').forEach(opt => opt.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
};

window.buyCoins = async function() {
    if (!currentUser) {
        showAuthModal('login');
        showNotification('Please login to buy coins', true);
        return;
    }
    
    showNotification(`Processing $${selectedCoinOption * 15} purchase...`);
    
    try {
        // 🚨 FIX: Use wrapper with token refresh
        const result = await callFn(buyCoinsFn, {
            amount: selectedCoinOption
        });
        
        // Update local state
        userData.coins = (userData.coins || 0) + selectedCoinOption;
        updateUI();
        
        showNotification(`✅ Added ${selectedCoinOption} coin${selectedCoinOption > 1 ? 's' : ''} ($${selectedCoinOption * 15}) to your account!`);
    } catch (error) {
        console.error('Purchase error:', error);
        showNotification('Payment failed: ' + (error.message || 'Unknown error'), true);
    }
};

// Rating functions - ⚠️ FIX: Prevent duplicate rating modal
window.setRating = function(rating) {
    currentRating = rating;
    
    const stars = document.querySelectorAll('#rating-modal .fa-star');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.style.color = '#fbbf24';
        } else {
            star.style.color = '#666';
        }
    });
};

// ⚠️ FIX: Show rating modal only once
function showRatingOnce() {
    if (ratingShown) return;
    ratingShown = true;
    showModal('rating-modal');
    
    // Reset after modal closes
    const modal = document.getElementById('rating-modal');
    const observer = new MutationObserver(() => {
        if (modal.style.display === 'none') {
            ratingShown = false;
            observer.disconnect();
        }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['style'] });
}

window.submitRating = async function() {
    const comment = document.getElementById('rating-comment').value.trim();
    
    if (!lastCallId) {
        showNotification('No call found to rate', true);
        return;
    }
    
    try {
        // 🚨 FIX: Use wrapper with token refresh
        await callFn(submitReviewFn, {
            callId: lastCallId,
            rating: currentRating,
            comment: comment,
            reportIssue: false
        });
        
        showNotification('⭐ Thank you for your rating!');
        closeModal('rating-modal');
        
        // Reset
        const stars = document.querySelectorAll('#rating-modal .fa-star');
        stars.forEach(star => star.style.color = '#666');
        document.getElementById('rating-comment').value = '';
        currentRating = 5;
        lastCallId = null;
        
    } catch (error) {
        console.error('Submit rating error:', error);
        showNotification('Failed to submit rating', true);
    }
};

// Share profile
window.shareProfile = function() {
    if (selectedProfile) {
        const profileUrl = `${window.location.origin}/?profile=${selectedProfile.whisperId}`;
        navigator.clipboard.writeText(profileUrl);
        showNotification('Profile link copied to clipboard!');
    }
};

// Admin access - FIXED: Use Firebase Admin custom claims check
window.checkAdminAccess = async function() {
    if (!currentUser) {
        showAuthModal('login');
        return;
    }
    
    try {
        // Get ID token to check custom claims
        const idTokenResult = await currentUser.getIdTokenResult();
        
        if (idTokenResult.claims.admin === true) {
            window.location.href = 'admin.html';
        } else {
            showNotification('Admin access required', true);
        }
    } catch (error) {
        console.error('Admin check error:', error);
        showNotification('Error checking admin access', true);
    }
};

console.log('✅ Whisper+me PRODUCTION FIXED - Ready to launch');
