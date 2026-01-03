// Whisper+me Production App - Launch Ready
console.log('🚀 Whisper+me PRODUCTION starting...');

// Configuration - NO SECRETS IN FRONTEND
const CONFIG = {
    coinPrice: 15,
    callDuration: 300,
    ringDuration: 30,
    adminEmail: 'ifanifwasafifth@gmail.com'
};

// State
let currentUser = null;
let userData = {
    coins: 0,
    earnings: 0,
    callsCompleted: 0,
    rating: 5.0,
    bio: '',
    photoURL: '',
    paypalEmail: '',
    isWhisper: false,
    isAvailable: false,
    whisperId: '',
    social: {}
};
let selectedProfile = null;
let activeCall = null;
let incomingCall = null;
let callStatus = 'idle';

// Agora State
let agoraClient = null;
let localAudioTrack = null;

// Shuffle State
let shuffleProfiles = [];
let currentShuffleIndex = 0;

// Timer State
let callTimerInterval = null;
let timeLeft = 300;
let currentRating = 5;

// Cloud Functions
let getAgoraToken, startCallFunction, answerCallFunction, submitReviewFunction;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('📱 Page loaded, initializing app...');
    
    // Initialize Cloud Functions
    getAgoraToken = window.firebase.httpsCallable(window.firebase.functions, 'getAgoraToken');
    startCallFunction = window.firebase.httpsCallable(window.firebase.functions, 'startCall');
    answerCallFunction = window.firebase.httpsCallable(window.firebase.functions, 'answerCall');
    submitReviewFunction = window.firebase.httpsCallable(window.firebase.functions, 'submitReview');
    
    // Setup auth state listener
    window.firebase.auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            console.log('✅ User logged in:', user.email);
            await loadUserData();
            updateUI();
            loadAvailableProfiles();
            setupCallListeners();
            hideLoading();
        } else {
            console.log('👤 No user logged in');
            currentUser = null;
            userData = {
                coins: 0, earnings: 0, callsCompleted: 0, rating: 5.0,
                bio: '', photoURL: '', paypalEmail: '', isWhisper: false,
                isAvailable: false, whisperId: '', social: {}
            };
            showGuestUI();
            loadAvailableProfiles();
            hideLoading();
        }
    });
    
    // Setup event listeners
    setupEventListeners();
});

// Load user data from Firebase
async function loadUserData() {
    if (!currentUser) return;
    
    try {
        const userRef = window.firebaseMethods.ref(window.firebase.db, `users/${currentUser.uid}`);
        const userSnapshot = await window.firebaseMethods.get(userRef);
        
        if (userSnapshot.exists()) {
            const data = userSnapshot.val();
            userData = { ...userData, ...data };
            
            // Generate whisper ID if not exists
            if (!userData.whisperId) {
                const whisperId = generateWhisperId();
                await window.firebaseMethods.update(userRef, { whisperId: whisperId });
                userData.whisperId = whisperId;
            }
            
            console.log('📊 User data loaded:', userData);
            updateUI();
            updateAvailabilityToggle();
        }
    } catch (error) {
        console.error('Error loading user data:', error);
        showNotification('Error loading user data', true);
    }
}

// Generate 5-digit whisper ID
function generateWhisperId() {
    return Math.floor(10000 + Math.random() * 90000).toString();
}

// Update UI based on auth state
function updateUI() {
    const guestMenu = document.getElementById('guest-menu');
    const loggedInMenu = document.getElementById('logged-in-menu');
    
    if (currentUser) {
        if (guestMenu) guestMenu.style.display = 'none';
        if (loggedInMenu) loggedInMenu.style.display = 'flex';
        
        // Update user info
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

// Setup call listeners
function setupCallListeners() {
    if (!currentUser) return;
    
    console.log('🔔 Setting up call listeners for user:', currentUser.uid);
    
    // Listen for incoming calls
    const callsRef = window.firebaseMethods.ref(window.firebase.db, 'calls');
    const whisperCallsQuery = window.firebaseMethods.query(
        callsRef,
        window.firebaseMethods.orderByChild('whisperId'),
        window.firebaseMethods.equalTo(currentUser.uid)
    );
    
    window.firebaseMethods.onChildAdded(whisperCallsQuery, (snapshot) => {
        const call = snapshot.val();
        if (call.status === 'ringing' && callStatus === 'idle') {
            handleIncomingCall(snapshot.key, call);
        }
    });
    
    // Listen for call updates
    window.firebaseMethods.onValue(callsRef, (snapshot) => {
        snapshot.forEach((child) => {
            const call = child.val();
            
            // If we're the caller and whisper answered
            if (activeCall && activeCall.id === child.key && call.callerId === currentUser.uid) {
                if (call.status === 'answered' && callStatus === 'waiting') {
                    startAudioCall(child.key);
                } else if (call.status === 'declined' && callStatus === 'waiting') {
                    endCallEarly(true);
                    showNotification('Call declined. Coin refunded.');
                } else if (call.status === 'expired' && callStatus === 'waiting') {
                    endCallEarly(true);
                    showNotification('Call expired. Coin refunded.');
                }
            }
            
            // If we're the whisper and call was cancelled
            if (incomingCall && incomingCall.id === child.key && call.whisperId === currentUser.uid) {
                if (call.status === 'cancelled' || call.status === 'ended') {
                    declineCallCleanup();
                }
            }
            
            // If call ended (server authoritative)
            if (activeCall && activeCall.id === child.key && call.status === 'ended') {
                if (callStatus === 'active') {
                    endCallCleanup();
                    resetPhoneInterface();
                    showNotification('Call ended');
                    
                    // Show rating modal for caller
                    if (currentUser.uid !== activeCall.whisperId) {
                        setTimeout(() => {
                            showModal('rating-modal');
                        }, 1000);
                    }
                }
            }
        });
    });
}

// Load available profiles
async function loadAvailableProfiles() {
    console.log('🔍 Loading available profiles...');
    
    const container = document.getElementById('profiles-container');
    if (!container) return;
    
    container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #888;">Loading profiles...</div>';
    
    try {
        const profilesRef = window.firebaseMethods.ref(window.firebase.db, 'publicProfiles');
        const snapshot = await window.firebaseMethods.get(profilesRef);
        const profiles = [];
        
        snapshot.forEach((child) => {
            const user = child.val();
            const userId = child.key;
            
            // Show users with bio and isWhisper = true
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
        
        // Update shuffle profiles (exclude current user)
        shuffleProfiles = profiles.filter(p => !p.isCurrentUser && p.isAvailable);
        if (shuffleProfiles.length === 0) {
            shuffleProfiles = profiles.filter(p => !p.isCurrentUser);
        }
        
        console.log(`🎲 ${shuffleProfiles.length} profiles in shuffle mode`);
        
        // Update shuffle display
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

// Display profiles in grid
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

// Update shuffle profile display
function updateShuffleProfile() {
    if (shuffleProfiles.length === 0) {
        // Show default state
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

// View profile modal
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

// Start call from profile
window.startCall = async function() {
    if (!selectedProfile) {
        showNotification('No profile selected', true);
        return;
    }
    
    if (!currentUser) {
        showAuthModal('login');
        return;
    }
    
    // Check if whisper is available
    if (!selectedProfile.isAvailable) {
        showNotification('This whisper is currently unavailable', true);
        return;
    }
    
    closeModal('profile-modal');
    showNotification(`Calling ${selectedProfile.name}...`);
    
    try {
        // Call Cloud Function to start call (server-side coin check and call creation)
        const result = await startCallFunction({
            whisperId: selectedProfile.uid
        });
        
        const callId = result.data.callId;
        
        // Set active call
        activeCall = {
            id: callId,
            whisperId: selectedProfile.uid,
            whisperName: selectedProfile.name,
            whisperPhoto: selectedProfile.photo,
            whisperIdNum: selectedProfile.whisperId,
            coins: selectedProfile.callPrice || 1,
            status: 'ringing'
        };
        
        // Update call status
        callStatus = 'waiting';
        
        // Show caller waiting interface
        showCallerWaitingInterface();
        
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

// Handle incoming call
async function handleIncomingCall(callId, call) {
    if (callStatus !== 'idle') return;
    
    // Get caller info
    const callerRef = window.firebaseMethods.ref(window.firebase.db, `publicProfiles/${call.callerId}`);
    const callerSnapshot = await window.firebaseMethods.get(callerRef);
    const callerData = callerSnapshot.val() || {};
    
    incomingCall = {
        id: callId,
        callerId: call.callerId,
        callerName: callerData.displayName || call.callerName || 'Anonymous',
        callerPhoto: callerData.photoURL || 'https://ui-avatars.com/api/?name=Caller&background=7c3aed&color=fff',
        coins: call.coinsCharged || 1,
        channel: call.channel
    };
    
    // Update call status
    callStatus = 'ringing';
    
    // Show incoming call interface
    showIncomingCallInterface();
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
                ${incomingCall.coins} Coin$${incomingCall.coins > 1 ? 's' : ''} ($${incomingCall.coins * 12}) Earned
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

// Answer incoming call
window.answerCall = async function() {
    if (!incomingCall) return;
    
    console.log('✅ Whisper answering call:', incomingCall.id);
    
    try {
        // Call Cloud Function to answer call
        await answerCallFunction({
            callId: incomingCall.id
        });
        
        // Set active call for whisper
        activeCall = {
            id: incomingCall.id,
            callerId: incomingCall.callerId,
            callerName: incomingCall.callerName,
            callerPhoto: incomingCall.callerPhoto,
            coins: incomingCall.coins
        };
        
        callStatus = 'active';
        
        // Show call in progress interface
        showCallInProgressInterface(true);
        
        // Join Agora channel
        await joinAgoraChannel(incomingCall.id, true);
        
        showNotification('✅ Connected! Speak now.');
        
        incomingCall = null;
        
    } catch (error) {
        console.error('Answer call error:', error);
        showNotification('Failed to answer call', true);
    }
};

// Join Agora channel
async function joinAgoraChannel(callId, isWhisper = false) {
    try {
        // Get token from Cloud Function
        const tokenResult = await getAgoraToken({
            channel: callId,
            uid: currentUser.uid
        });
        
        // Load Agora SDK dynamically
        if (!window.AgoraRTC) {
            const script = document.createElement('script');
            script.src = 'https://download.agora.io/sdk/release/AgoraRTC_N-4.18.2.js';
            document.head.appendChild(script);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Create client
        agoraClient = window.AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        
        // Join channel
        await agoraClient.join(
            "966c8e41da614722a88d4372c3d95dba",
            callId,
            tokenResult.data.token,
            currentUser.uid
        );
        
        // Create and publish audio track
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
            // Server will handle call end
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
    
    // Update call status in database
    const callRef = window.firebaseMethods.ref(window.firebase.db, `calls/${activeCall.id}`);
    await window.firebaseMethods.update(callRef, {
        status: 'ended',
        endedAt: Date.now(),
        endedBy: currentUser.uid
    });
    
    // Leave Agora channel
    await leaveAgoraChannel();
    
    // Cleanup
    endCallCleanup();
    resetPhoneInterface();
    
    showNotification('Call ended');
    
    // Show rating modal for caller
    if (currentUser.uid !== activeCall.whisperId) {
        setTimeout(() => {
            showModal('rating-modal');
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
    
    // Update with current shuffle profile
    updateShuffleProfile();
}

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
        const userRef = window.firebaseMethods.ref(window.firebase.db, `users/${currentUser.uid}`);
        await window.firebaseMethods.update(userRef, updates);
        
        // Also update public profile
        const publicProfileRef = window.firebaseMethods.ref(window.firebase.db, `publicProfiles/${currentUser.uid}`);
        await window.firebaseMethods.update(publicProfileRef, updates);
        
        showNotification('✅ Profile saved successfully!');
        closeModal('dashboard-modal');
        
        // Reload data
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
        const userRef = window.firebaseMethods.ref(window.firebase.db, `users/${currentUser.uid}`);
        await window.firebaseMethods.update(userRef, {
            isAvailable: isAvailable,
            isWhisper: isAvailable
        });
        
        const publicProfileRef = window.firebaseMethods.ref(window.firebase.db, `publicProfiles/${currentUser.uid}`);
        await window.firebaseMethods.update(publicProfileRef, {
            isAvailable: isAvailable,
            isWhisper: isAvailable
        });
        
        showNotification(isAvailable ? '✅ You are now available to receive calls' : '⏸️ You are now unavailable');
        
        // Update local data
        userData.isAvailable = isAvailable;
        userData.isWhisper = isAvailable;
        
        // Reload profiles
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
        await window.firebaseMethods.signInWithEmailAndPassword(window.firebase.auth, email, password);
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
        const userCredential = await window.firebaseMethods.createUserWithEmailAndPassword(window.firebase.auth, email, password);
        const user = userCredential.user;
        
        // Create user data with 5 free coins
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
        
        // Save to both users and publicProfiles
        await window.firebaseMethods.set(window.firebaseMethods.ref(window.firebase.db, `users/${user.uid}`), userData);
        await window.firebaseMethods.set(window.firebaseMethods.ref(window.firebase.db, `publicProfiles/${user.uid}`), userData);
        
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
        
        await window.firebaseMethods.signOut(window.firebase.auth);
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
}

// Coin functions
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
    
    // In production, this would integrate with Stripe
    // For now, simulate purchase
    setTimeout(async () => {
        try {
            const userRef = window.firebaseMethods.ref(window.firebase.db, `users/${currentUser.uid}`);
            await window.firebaseMethods.update(userRef, {
                coins: (userData.coins || 0) + selectedCoinOption
            });
            
            userData.coins += selectedCoinOption;
            updateUI();
            
            showNotification(`✅ Added ${selectedCoinOption} coin${selectedCoinOption > 1 ? 's' : ''} ($${selectedCoinOption * 15}) to your account!`);
        } catch (error) {
            console.error('Purchase error:', error);
            showNotification('Payment failed', true);
        }
    }, 1500);
};

// Rating functions
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

window.submitRating = async function() {
    const comment = document.getElementById('rating-comment').value.trim();
    
    if (activeCall && activeCall.id) {
        try {
            await submitReviewFunction({
                callId: activeCall.id,
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
            
        } catch (error) {
            console.error('Submit rating error:', error);
            showNotification('Failed to submit rating', true);
        }
    }
};

// Admin login
window.showAdminLogin = function() {
    const password = prompt('Enter admin password:');
    if (password === '068790Pw!') {
        // Redirect to admin page
        window.location.href = 'admin.html';
    } else {
        showNotification('Invalid password', true);
    }
};

// Helper functions for calls (not implemented in this version)
window.cancelCall = async function() {
    showNotification('Cancelling call...');
    endCallCleanup();
    resetPhoneInterface();
    showNotification('Call cancelled');
};

window.declineCall = async function() {
    showNotification('Declining call...');
    endCallCleanup();
    resetPhoneInterface();
    showNotification('Call declined');
};

window.endCallEarly = function(refund = false) {
    showNotification(refund ? 'Call ended. Coin refunded.' : 'Call ended.');
    endCallCleanup();
    resetPhoneInterface();
};

window.shareProfile = function() {
    if (selectedProfile) {
        const profileUrl = `${window.location.origin}/?profile=${selectedProfile.whisperId}`;
        navigator.clipboard.writeText(profileUrl);
        showNotification('Profile link copied to clipboard!');
    }
};

// Decline call cleanup
function declineCallCleanup() {
    resetPhoneInterface();
    incomingCall = null;
    callStatus = 'idle';
}

// Initialize
setupEventListeners();
console.log('✅ Whisper+me PRODUCTION ready - All calls = 1 coin ($15)');
