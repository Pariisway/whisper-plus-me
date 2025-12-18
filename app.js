// Whisper+me - LAUNCH READY VERSION
console.log('🚀 Whisper+me LAUNCH READY starting...');

// Check if we're on admin page - if so, don't run main app code
if (window.location.pathname.includes('admin.html')) {
    console.log('📊 Admin page detected - skipping main app initialization');
    // Exit early, admin.html has its own code
    throw new Error('Admin page - app.js not needed here');
}

// Configuration - SIMPLIFIED
const CONFIG = {
  coinPrice: 15, // $15 per coin
  agoraAppId: '966c8e41da614722a88d4372c3d95dba',
  stripeKey: 'pk_test_51SPYHwRvETRK3Zx7mnVDTNyPB3mxT8vbSIcSVQURp8irweK0lGznwFrW9sjgju2GFgmDiQ5GkWYVlUQZZVNrXkJb00q2QOCC3I',
  adminEmail: 'ifanifwasafifth@gmail.com',
  adminPassword: '068790Pw!',
  callDuration: 300, // 5 minutes
  ringDuration: 30   // 30 seconds to answer
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
  whisperId: '', // User's public whisper ID
  social: {}
};
let selectedProfile = null;
let activeCall = null;

// Agora State
let agoraClient = null;
let localAudioTrack = null;

// Shuffle State - SIMPLIFIED (no timer)
let shuffleProfiles = [];
let currentShuffleIndex = 0;

// Call State
let incomingCall = null;
let callStatus = 'idle';

// Timer State
let callTimerInterval = null;
let timeLeft = 300;

// Initialize Firebase
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
  console.log('Firebase error:', error);
}

const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();

// When page loads
document.addEventListener('DOMContentLoaded', async () => {
  console.log('📱 Page loaded');
  
  // Setup auth state listener
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      currentUser = user;
      console.log('👤 User logged in:', user.email);
      await setupUser();
      updateUI();
      await loadProfiles();
      setupCallListeners();
      hideLoading();
    } else {
      console.log('👤 No user logged in');
      showGuestUI();
      await loadProfiles();
      hideLoading();
    }
  });
  
  setupEventListeners();
  setupCoinOption();
  
  // Initialize phone interface
  initPhoneInterface();
});

// Setup user with whisper ID
async function setupUser() {
  if (!currentUser) return;
  
  const userRef = db.ref('users/' + currentUser.uid);
  
  userRef.on('value', async (snap) => {
    if (snap.exists()) {
      const data = snap.val();
      userData = { ...userData, ...data };
      
      // Generate whisper ID if not exists
      if (!userData.whisperId) {
        const whisperId = generateWhisperId();
        await userRef.update({ whisperId: whisperId });
        userData.whisperId = whisperId;
      }
      
      console.log('📊 User data loaded:', userData);
      updateUI();
      updateAvailabilityToggle();
    }
  });
}

// Generate short whisper ID (5-digit number)
function generateWhisperId() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

// Initialize phone interface - SIMPLIFIED
function initPhoneInterface() {
  console.log('📱 Initializing phone interface...');
  
  const iphoneScreen = document.querySelector('.iphone-screen');
  if (!iphoneScreen) {
    console.log('❌ iPhone screen not found');
    return;
  }
  
  // Set basic structure
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
        <img src="https://ui-avatars.com/api/?name=User&background=7c3aed&color=fff" alt="Profile" class="shuffle-profile-img" id="shuffle-img">
        <h3 class="shuffle-profile-name" id="shuffle-name">Loading...</h3>
        <div class="shuffle-profile-price">1 Coin ($15)</div>
        <div class="whisper-id-display" id="shuffle-id">ID: Loading...</div>
        <p class="shuffle-profile-bio" id="shuffle-bio">Loading profiles...</p>
      </div>
      
      <div class="phone-controls">
        <button class="phone-btn phone-btn-next" onclick="nextShuffleProfile()">
          <i class="fas fa-arrow-right"></i>
        </button>
        <button class="phone-btn phone-btn-call" onclick="startCallFromShuffle()">
          <i class="fas fa-phone-alt"></i>
        </button>
      </div>
      
      <div style="margin-top: 1rem; font-size: 0.9rem; color: #888;">
        Tap arrow to see next whisper
      </div>
    </div>
  `;
  
  // Update with current shuffle profile
  if (shuffleProfiles.length > 0) {
    updateShuffleProfile();
  }
}

// Setup call listeners
function setupCallListeners() {
  if (!currentUser) return;
  
  console.log('🔔 Setting up call listeners for user:', currentUser.uid);
  
  // Listen for incoming calls
  db.ref('calls').orderByChild('whisperId').equalTo(currentUser.uid).on('child_added', (snap) => {
    const call = snap.val();
    const callId = snap.key;
    
    if (call.status === 'ringing' && callStatus === 'idle') {
      handleIncomingCall(callId, call);
    }
  });
  
  // Listen for call updates
  db.ref('calls').on('child_changed', (snap) => {
    const call = snap.val();
    const callId = snap.key;
    
    // If we're the caller and whisper answered
    if (activeCall && activeCall.id === callId && call.callerId === currentUser.uid) {
      if (call.status === 'answered' && callStatus === 'waiting') {
        startAudioCall(callId);
      } else if (call.status === 'declined' && callStatus === 'waiting') {
        endCallEarly(true);
        showNotification('Call declined. Coin refunded.');
      }
    }
    
    // If we're the whisper and call was cancelled
    if (incomingCall && incomingCall.id === callId && call.whisperId === currentUser.uid) {
      if (call.status === 'cancelled' || call.status === 'ended') {
        declineCallCleanup();
      }
    }
  });
}

// Update UI - SAFE VERSION (checks elements exist)
function updateUI() {
  if (currentUser) {
    const guestMenu = document.getElementById('guest-menu');
    const loggedInMenu = document.getElementById('logged-in-menu');
    if (guestMenu) guestMenu.style.display = 'none';
    if (loggedInMenu) loggedInMenu.style.display = 'block';
  } else {
    const guestMenu = document.getElementById('guest-menu');
    const loggedInMenu = document.getElementById('logged-in-menu');
    if (guestMenu) guestMenu.style.display = 'block';
    if (loggedInMenu) loggedInMenu.style.display = 'none';
  }
  
  // Update user info - check each element exists
  const coinsCount = document.getElementById('coins-count');
  if (coinsCount) coinsCount.textContent = userData.coins || 0;
  
  // Update dashboard - check each element exists
  const dashCoins = document.getElementById('dash-coins');
  const dashEarnings = document.getElementById('dash-earnings');
  const dashCalls = document.getElementById('dash-calls');
  const dashRating = document.getElementById('dash-rating');
  const dashId = document.getElementById('dash-id');
  
  if (dashCoins) dashCoins.textContent = userData.coins || 0;
  if (dashEarnings) dashEarnings.textContent = '$' + (userData.earnings || 0);
  if (dashCalls) dashCalls.textContent = userData.callsCompleted || 0;
  if (dashRating) dashRating.textContent = userData.rating ? userData.rating.toFixed(1) : '5.0';
  if (dashId) dashId.textContent = userData.whisperId || 'Not set';
  
  // Update profile form - check each element exists
  const profileBio = document.getElementById('profile-bio');
  const profilePaypal = document.getElementById('profile-paypal');
  const profileId = document.getElementById('profile-id');
  const profileTwitter = document.getElementById('profile-twitter');
  const profileInstagram = document.getElementById('profile-instagram');
  const profileTiktok = document.getElementById('profile-tiktok');
  
  if (profileBio) profileBio.value = userData.bio || '';
  if (profilePaypal) profilePaypal.value = userData.paypalEmail || '';
  if (profileId) profileId.value = userData.whisperId || '';
  if (profileTwitter) profileTwitter.value = userData.social?.twitter || '';
  if (profileInstagram) profileInstagram.value = userData.social?.instagram || '';
  if (profileTiktok) profileTiktok.value = userData.social?.tiktok || '';
}

// Update availability toggle
function updateAvailabilityToggle() {
  const toggle = document.getElementById('availability-toggle');
  if (toggle) {
    toggle.checked = userData.isAvailable || false;
  }
}

// Toggle availability
window.toggleAvailability = async function() {
  if (!currentUser) return;
  
  const toggle = document.getElementById('availability-toggle');
  const isAvailable = toggle.checked;
  
  try {
    await db.ref('users/' + currentUser.uid).update({
      isAvailable: isAvailable,
      isWhisper: isAvailable
    });
    
    showNotification(isAvailable ? '✅ You are now available to receive calls' : '⏸️ You are now unavailable');
    loadProfiles();
    
  } catch (error) {
    console.log('Toggle error:', error);
    showNotification('Failed to update availability', true);
  }
};

// Load profiles from Firebase
async function loadProfiles() {
  console.log('🔍 Loading profiles from Firebase...');
  
  const container = document.getElementById('profiles-container');
  if (!container) return;
  
  container.innerHTML = '<div style="text-align: center; padding: 2rem; color: #888;">Loading profiles...</div>';
  
  try {
    const snapshot = await db.ref('users').once('value');
    const profiles = [];
    
    snapshot.forEach(child => {
      const user = child.val();
      
      // Show users with bio and isWhisper = true
      if (user.bio && user.isWhisper === true) {
        const isCurrentUser = currentUser && child.key === currentUser.uid;
        
        profiles.push({
          id: child.key,
          uid: child.key,
          name: user.bio.split(' ').slice(0, 2).join(' ') || user.email?.split('@')[0] || 'Anonymous',
          bio: user.bio,
          photo: user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.email?.split('@')[0] || 'User') + '&background=7c3aed&color=fff&size=150',
          whisperId: user.whisperId || '00000',
          social: user.social || {},
          rating: user.rating || 5.0,
          calls: user.callsCompleted || 0,
          isAvailable: user.isAvailable || false,
          isCurrentUser: isCurrentUser
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
    
  } catch (error) {
    console.log('Error loading profiles:', error);
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
    
    html += `
      <div class="profile-card" onclick="viewProfile('${profile.id}')">
        <div class="profile-header">
          <img src="${profile.photo}" alt="${profile.name}" class="profile-img" 
               onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name)}&background=7c3aed&color=fff'">
          <div class="profile-info">
            <h3>${profile.name} ${isCurrentUser ? '<span style="color: #7c3aed; font-size: 0.8rem;">(YOU)</span>' : ''}</h3>
            <div class="profile-price">1 Coin ($15)</div>
            <div class="whisper-id-small">ID: ${profile.whisperId}</div>
            ${profile.isAvailable ? '<span style="color: #10b981; font-size: 0.8rem;">● Online</span>' : 
              '<span style="color: #888; font-size: 0.8rem;">● Offline</span>'}
          </div>
        </div>
        <p class="profile-bio">${profile.bio.substring(0, 80)}${profile.bio.length > 80 ? '...' : ''}</p>
        <button class="btn btn-primary" onclick="event.stopPropagation(); viewProfile('${profile.id}')" 
                style="width: 100%;" ${isCurrentUser ? 'disabled' : ''}>
          <i class="fas fa-phone-alt"></i> ${isCurrentUser ? 'Your Profile' : 'Call Now'}
        </button>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // Update shuffle profiles
  shuffleProfiles = profiles.filter(p => !p.isCurrentUser && p.isAvailable);
  if (shuffleProfiles.length === 0) {
    shuffleProfiles = profiles.filter(p => !p.isCurrentUser);
  }
  
  console.log(`🎲 ${shuffleProfiles.length} profiles in shuffle mode`);
  
  // Update shuffle display
  updateShuffleProfile();
}

// Shuffle Functions - SIMPLIFIED (no timer)
window.nextShuffleProfile = function() {
  if (shuffleProfiles.length === 0 || callStatus !== 'idle') return;
  
  currentShuffleIndex = (currentShuffleIndex + 1) % shuffleProfiles.length;
  updateShuffleProfile();
};

function updateShuffleProfile() {
  if (shuffleProfiles.length === 0) return;
  
  const profile = shuffleProfiles[currentShuffleIndex];
  
  // Update DOM elements
  const shuffleImg = document.getElementById('shuffle-img');
  const shuffleName = document.getElementById('shuffle-name');
  const shuffleBio = document.getElementById('shuffle-bio');
  const shuffleId = document.getElementById('shuffle-id');
  
  if (shuffleImg) shuffleImg.src = profile.photo;
  if (shuffleName) shuffleName.textContent = profile.name;
  if (shuffleBio) shuffleBio.textContent = profile.bio.substring(0, 100) + (profile.bio.length > 100 ? '...' : '');
  if (shuffleId) shuffleId.textContent = `ID: ${profile.whisperId}`;
  
  selectedProfile = profile;
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
  const modalImg = document.getElementById('modal-profile-img');
  const modalName = document.getElementById('modal-profile-name');
  const modalBio = document.getElementById('modal-profile-bio');
  const modalId = document.getElementById('modal-profile-id');
  const modalPrice = document.getElementById('modal-profile-price');
  
  if (modalImg) modalImg.src = profile.photo;
  if (modalName) modalName.textContent = profile.name + (isCurrentUser ? ' (YOU)' : '');
  if (modalBio) modalBio.textContent = profile.bio;
  if (modalId) modalId.textContent = `Whisper ID: ${profile.whisperId}`;
  if (modalPrice) modalPrice.textContent = '1 Coin ($15)';
  
  // Update social links
  const socialLinks = document.getElementById('modal-social-links');
  if (socialLinks) {
    socialLinks.innerHTML = '';
    
    if (profile.social?.twitter) {
      socialLinks.innerHTML += `<a href="${profile.social.twitter}" target="_blank" class="social-link"><i class="fab fa-twitter"></i></a>`;
    }
    if (profile.social?.instagram) {
      socialLinks.innerHTML += `<a href="${profile.social.instagram}" target="_blank" class="social-link"><i class="fab fa-instagram"></i></a>`;
    }
    if (profile.social?.tiktok) {
      socialLinks.innerHTML += `<a href="${profile.social.tiktok}" target="_blank" class="social-link"><i class="fab fa-tiktok"></i></a>`;
    }
  }
  
  // Update call button
  const callButton = document.querySelector('#profile-modal .btn-primary');
  if (callButton) {
    if (isCurrentUser) {
      callButton.innerHTML = '<i class="fas fa-user"></i> This is Your Profile';
      callButton.disabled = true;
      callButton.classList.remove('btn-primary');
      callButton.classList.add('btn-secondary');
      callButton.onclick = null;
    } else {
      callButton.innerHTML = '<i class="fas fa-phone-alt"></i> Call Now (1 Coin)';
      callButton.disabled = false;
      callButton.classList.remove('btn-secondary');
      callButton.classList.add('btn-primary');
      callButton.onclick = startCall;
    }
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
  
  // Check coins - 1 coin required
  if (userData.coins < 1) {
    showNotification('You need 1 coin ($15) to call', true);
    return;
  }
  
  // Check if whisper is available
  if (!selectedProfile.isAvailable) {
    showNotification('This whisper is currently unavailable', true);
    return;
  }
  
  closeModal('profile-modal');
  showNotification('Calling ' + selectedProfile.name + '...');
  
  // Create call record
  const callRef = db.ref('calls').push();
  const callId = callRef.key;
  const channelName = 'call_' + callId;
  
  const callData = {
    id: callId,
    callerId: currentUser.uid,
    callerEmail: currentUser.email,
    callerName: userData.bio || currentUser.email.split('@')[0],
    whisperId: selectedProfile.uid,
    whisperName: selectedProfile.name,
    whisperIdNum: selectedProfile.whisperId,
    coins: 1,
    status: 'ringing',
    channel: channelName,
    createdAt: Date.now()
  };
  
  console.log('📞 Creating call record:', callData);
  await callRef.set(callData);
  
  // Deduct 1 coin
  await db.ref('users/' + currentUser.uid).update({
    coins: (userData.coins || 0) - 1
  });
  
  // Set active call
  activeCall = {
    id: callId,
    whisperId: selectedProfile.uid,
    whisperName: selectedProfile.name,
    whisperPhoto: selectedProfile.photo,
    coins: 1,
    channel: channelName,
    status: 'ringing'
  };
  
  // Update call status
  callStatus = 'waiting';
  
  // Show caller waiting interface
  showCallerWaitingInterface();
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
        1 coin ($15) deducted
      </p>
    </div>
  `;
}

// Handle incoming call
async function handleIncomingCall(callId, call) {
  if (callStatus !== 'idle') return;
  
  // Get caller info
  const callerSnap = await db.ref('users/' + call.callerId).once('value');
  const callerData = callerSnap.val() || {};
  
  incomingCall = {
    id: callId,
    callerId: call.callerId,
    callerName: callerData.bio || call.callerName || 'Anonymous',
    callerPhoto: callerData.photoURL || 'https://ui-avatars.com/api/?name=Caller&background=7c3aed&color=fff',
    coins: 1,
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
        1 Coin ($15) Earned
      </div>
      
      <div class="phone-controls">
        <button class="phone-btn phone-btn-accept" onclick="answerCall()" style="background: #10b981;">
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

// Whisper answers the call
window.answerCall = async function() {
  if (!incomingCall) return;
  
  console.log('✅ Whisper answering call:', incomingCall.id);
  
  // Update call status
  await db.ref('calls/' + incomingCall.id).update({
    status: 'answered',
    answeredAt: Date.now()
  });
  
  // Set active call for whisper
  activeCall = {
    id: incomingCall.id,
    callerId: incomingCall.callerId,
    callerName: incomingCall.callerName,
    callerPhoto: incomingCall.callerPhoto,
    channel: incomingCall.channel,
    coins: 1
  };
  
  callStatus = 'active';
  
  // Show call in progress interface
  showCallInProgressInterface(true);
  
  // Join Agora channel
  const joined = await joinAgoraChannel(incomingCall.channel, true);
  if (joined) {
    console.log('✅ Whisper joined Agora channel');
    startCallTimer();
    showNotification('✅ Connected! Speak now.');
  }
  
  incomingCall = null;
};

// AGORA Functions
async function initializeAgora() {
  if (!agoraClient && typeof AgoraRTC !== 'undefined') {
    agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    console.log('✅ Agora client initialized');
  }
  return agoraClient;
}

async function joinAgoraChannel(channelName, isWhisper = false) {
  try {
    await initializeAgora();
    
    const localUid = currentUser ? currentUser.uid : Math.floor(Math.random() * 100000).toString();
    
    try {
      localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      console.log('🎤 Microphone track created');
    } catch (micError) {
      showNotification('Microphone permission required', true);
      return false;
    }
    
    await agoraClient.join(CONFIG.agoraAppId, channelName, null, localUid);
    await agoraClient.publish([localAudioTrack]);
    
    agoraClient.on('user-published', async (user, mediaType) => {
      if (mediaType === 'audio') {
        try {
          const remoteTrack = await agoraClient.subscribe(user, mediaType);
          remoteTrack.play();
          remoteTrack.setVolume(100);
          showNotification('✅ Audio connected!');
        } catch (error) {
          console.error('Subscribe error:', error);
        }
      }
    });
    
    return true;
  } catch (error) {
    console.error('❌ Agora error:', error);
    showNotification('Failed to connect audio', true);
    return false;
  }
}

async function leaveAgoraChannel() {
  try {
    if (localAudioTrack) {
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

// Whisper declines the call
window.declineCall = async function() {
  if (!incomingCall) return;
  
  console.log('❌ Whisper declining call:', incomingCall.id);
  
  await db.ref('calls/' + incomingCall.id).update({
    status: 'declined',
    declinedAt: Date.now()
  });
  
  // Refund caller
  const callerSnap = await db.ref('users/' + incomingCall.callerId).once('value');
  const callerData = callerSnap.val() || {};
  
  await db.ref('users/' + incomingCall.callerId).update({
    coins: (callerData.coins || 0) + 1
  });
  
  declineCallCleanup();
  showNotification('Call declined. Coin refunded.');
};

// Cleanup for declined call
function declineCallCleanup() {
  resetPhoneInterface();
  incomingCall = null;
  callStatus = 'idle';
}

// Caller cancels the call
window.cancelCall = async function() {
  if (!activeCall) return;
  
  console.log('❌ Caller cancelling call:', activeCall.id);
  
  await db.ref('calls/' + activeCall.id).update({
    status: 'cancelled',
    cancelledAt: Date.now()
  });
  
  // Refund 1 coin
  await db.ref('users/' + currentUser.uid).update({
    coins: (userData.coins || 0) + 1
  });
  
  endCallCleanup();
  resetPhoneInterface();
  
  showNotification('Call cancelled. 1 coin refunded.');
};

// Start audio call (when whisper answers)
async function startAudioCall(callId) {
  console.log('🎧 Starting audio call...');
  
  await db.ref('calls/' + activeCall.id).update({
    status: 'active',
    startedAt: Date.now()
  });
  
  callStatus = 'active';
  
  // Update UI
  showCallInProgressInterface(false);
  
  // Join Agora channel
  const joined = await joinAgoraChannel(activeCall.channel, false);
  if (joined) {
    console.log('✅ Caller joined Agora channel');
    showNotification('✅ Call connected!');
    startCallTimer();
  }
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

// Start call timer (5 minutes)
function startCallTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
  }
  
  timeLeft = CONFIG.callDuration;
  updateCallTimer();
  
  callTimerInterval = setInterval(async () => {
    timeLeft--;
    updateCallTimer();
    
    if (timeLeft <= 0) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
      await completeCall();
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

// End call
window.endCall = async function() {
  if (!activeCall) return;
  
  console.log('📞 Ending call:', activeCall.id);
  
  await db.ref('calls/' + activeCall.id).update({
    status: 'ended',
    endedAt: Date.now(),
    endedBy: currentUser.uid
  });
  
  // Pay whisper $15 if call was active
  if (callStatus === 'active' && activeCall.whisperId) {
    await payWhisper(activeCall.whisperId);
  }
  
  // Clear timer
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  
  // Leave Agora channel
  await leaveAgoraChannel();
  
  // Cleanup
  endCallCleanup();
  resetPhoneInterface();
  
  showNotification('Call ended');
  
  // Show rating modal
  if (currentUser.uid !== activeCall.whisperId && callStatus === 'active') {
    setTimeout(() => {
      showModal('rating-modal');
    }, 1000);
  }
};

// Complete call (5-minute timer ends)
async function completeCall() {
  if (activeCall && activeCall.id) {
    console.log('✅ Call completed by timer');
    
    await db.ref('calls/' + activeCall.id).update({
      status: 'completed',
      completedAt: Date.now(),
      duration: CONFIG.callDuration
    });
    
    // Pay whisper $15
    if (activeCall.whisperId) {
      await payWhisper(activeCall.whisperId);
    }
    
    await leaveAgoraChannel();
    endCallCleanup();
    resetPhoneInterface();
    
    showNotification('✅ Call completed!');
    
    // Show rating modal
    if (currentUser.uid !== activeCall.whisperId) {
      setTimeout(() => {
        showModal('rating-modal');
      }, 1000);
    }
  }
}

// End call early
window.endCallEarly = async function(refund = false) {
  if (!activeCall) return;
  
  if (refund) {
    await db.ref('users/' + currentUser.uid).update({
      coins: (userData.coins || 0) + 1
    });
  }
  
  if (activeCall.id) {
    await db.ref('calls/' + activeCall.id).update({
      status: 'ended',
      endedAt: Date.now(),
      reason: 'timeout'
    });
  }
  
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  
  endCallCleanup();
  resetPhoneInterface();
};

// Pay whisper $15 per call
async function payWhisper(whisperId) {
  const whisperRef = db.ref('users/' + whisperId);
  const snapshot = await whisperRef.once('value');
  const whisperData = snapshot.val() || {};
  
  await whisperRef.update({
    earnings: (whisperData.earnings || 0) + 15, // $15 per call
    callsCompleted: (whisperData.callsCompleted || 0) + 1
  });
  
  // Create payout record
  await db.ref('payouts').push().set({
    whisperId: whisperId,
    whisperIdNum: whisperData.whisperId,
    amount: 15,
    date: Date.now(),
    status: 'pending'
  });
}

// End call cleanup
function endCallCleanup() {
  leaveAgoraChannel();
  activeCall = null;
  selectedProfile = null;
  incomingCall = null;
  callStatus = 'idle';
  
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
}

// Reset phone interface to shuffle mode
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
        <div class="shuffle-profile-price">1 Coin ($15)</div>
        <div class="whisper-id-display" id="shuffle-id">ID: Loading...</div>
        <p class="shuffle-profile-bio" id="shuffle-bio"></p>
      </div>
      
      <div class="phone-controls">
        <button class="phone-btn phone-btn-next" onclick="nextShuffleProfile()">
          <i class="fas fa-arrow-right"></i>
        </button>
        <button class="phone-btn phone-btn-call" onclick="startCallFromShuffle()">
          <i class="fas fa-phone-alt"></i>
        </button>
      </div>
      
      <div style="margin-top: 1rem; font-size: 0.9rem; color: #888;">
        Tap arrow to see next whisper
      </div>
    </div>
  `;
  
  // Update with current shuffle profile
  if (shuffleProfiles.length > 0) {
    updateShuffleProfile();
  }
}

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

// Profile save function
window.saveProfile = async function() {
  if (!currentUser) return;
  
  const bio = document.getElementById('profile-bio').value.trim();
  const paypalEmail = document.getElementById('profile-paypal').value.trim();
  const twitter = document.getElementById('profile-twitter').value.trim();
  const instagram = document.getElementById('profile-instagram').value.trim();
  const tiktok = document.getElementById('profile-tiktok').value.trim();
  
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
    isWhisper: true,
    updatedAt: Date.now()
  };
  
  try {
    await db.ref('users/' + currentUser.uid).update(updates);
    showNotification('✅ Profile saved successfully!');
    closeModal('dashboard-modal');
    setTimeout(() => {
      loadProfiles();
    }, 1000);
    
  } catch (error) {
    console.log('Save error:', error);
    showNotification('Failed to save profile', true);
  }
};

// Auth functions
window.showAuthModal = function(tab = 'login') {
  switchAuthTab(tab);
  showModal('auth-modal');
};

window.closeAuthModal = function() {
  closeModal('auth-modal');
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
    showNotification('Login failed', true);
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
    await auth.createUserWithEmailAndPassword(email, password);
    showNotification('✅ Account created successfully!');
    closeModal('auth-modal');
  } catch (error) {
    console.log('Signup error:', error);
    showNotification('Signup failed', true);
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
    loadProfiles();
    resetPhoneInterface();
  } catch (error) {
    console.log('Logout error:', error);
    showNotification('Logout failed', true);
  }
};

// Dashboard functions
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
  
  const loginPassword = document.getElementById('login-password');
  const signupConfirm = document.getElementById('signup-confirm');
  
  if (loginPassword) {
    loginPassword.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') login();
    });
  }
  
  if (signupConfirm) {
    signupConfirm.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') signup();
    });
  }
}

// Coin functions - SIMPLIFIED (only 1 coin option)
function setupCoinOption() {
  // Only show 1 coin for $15
  const coinContainer = document.querySelector('.coin-options');
  if (coinContainer) {
    coinContainer.innerHTML = `
      <div class="coin-option selected" onclick="selectCoinOption(1)">
        <div class="coin-icon">
          <i class="fas fa-coins"></i>
        </div>
        <div class="coin-details">
          <div class="coin-amount">1 Coin</div>
          <div class="coin-price">$15</div>
        </div>
      </div>
    `;
  }
}

window.selectCoinOption = function(coins) {
  // Only 1 coin option
  selectedCoinOption = 1;
};

window.buyCoins = async function() {
  if (!currentUser) {
    showAuthModal('login');
    showNotification('Please login to buy coins', true);
    return;
  }
  
  showNotification(`Processing $15 purchase...`);
  
  try {
    setTimeout(async () => {
      await db.ref('users/' + currentUser.uid).update({
        coins: (userData.coins || 0) + 1
      });
      
      showNotification(`✅ Added 1 coin ($15) to your account!`);
    }, 1500);
    
  } catch (error) {
    console.log('Payment error:', error);
    showNotification('Payment failed', true);
  }
};

// Rating functions
let currentRating = 5;

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
    await db.ref('ratings/' + activeCall.id).set({
      from: currentUser.uid,
      rating: currentRating,
      comment: comment,
      timestamp: Date.now()
    });
  }
  
  showNotification('⭐ Thank you for your rating!');
  closeModal('rating-modal');
  
  // Reset
  const stars = document.querySelectorAll('#rating-modal .fa-star');
  stars.forEach(star => star.style.color = '#666');
  const commentInput = document.getElementById('rating-comment');
  if (commentInput) commentInput.value = '';
  currentRating = 5;
};

// Admin login - CONNECTED TO ADMIN DASHBOARD
window.showAdminLogin = function() {
  const password = prompt('Enter admin password:');
  if (password === CONFIG.adminPassword) {
    // Redirect to admin.html which should have access to all user data
    window.location.href = 'admin.html';
  } else {
    showNotification('Invalid password', true);
  }
};

console.log('✅ Whisper+me LAUNCH READY - All calls = 1 coin ($15)');
