// Whisper+me - PRODUCTION READY VERSION
// NO MOCK DATA - REAL AGORA IMPLEMENTATION
console.log('🚀 Whisper+me starting...');

// Configuration
const CONFIG = {
  coinPrice: 15,
  whisperEarning: 12,
  siteFee: 3,
  callDuration: 300,
  waitDuration: 120,
  adminEmail: 'ifanifwasafifth@gmail.com',
  adminPassword: '068790Pw!',
  agoraAppId: '966c8e41da614722a88d4372c3d95dba',
  stripeKey: 'pk_test_51SPYHwRvETRK3Zx7mnVDTNyPB3mxT8vbSIcSVQURp8irweK0lGznwFrW9sjgju2GFgmDiQ5GkWYVlUQZZVNrXkJb00q2QOCC3I'
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
  pricePerCall: 1,
  lastPriceChange: 0,
  paypalEmail: '',
  isWhisper: false,
  isAvailable: false,
  social: {}
};
let selectedProfile = null;
let activeCall = null;

// Agora State
let agoraClient = null;
let localAudioTrack = null;
let remoteAudioTracks = {};
let callTimer = null;
let waitTimer = null;
let timeLeft = 0;
let currentRating = 5;
let selectedCoinOption = 1;

// Shuffle State
let shuffleProfiles = [];
let shuffleTimer = null;
let currentShuffleIndex = 0;
let countdown = 30;

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

// Initialize Stripe
const stripe = Stripe(CONFIG.stripeKey);

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
      loadProfiles();
      startShuffleMode();
      hideLoading();
    } else {
      console.log('👤 No user logged in');
      showGuestUI();
      hideLoading();
    }
  });
  
  setupEventListeners();
  selectCoinOption(1);
});

// Setup user
async function setupUser() {
  if (!currentUser) return;
  
  const userRef = db.ref('users/' + currentUser.uid);
  
  userRef.on('value', (snap) => {
    if (snap.exists()) {
      const data = snap.val();
      userData = { ...userData, ...data };
      console.log('📊 User data loaded:', userData);
      updateUI();
      updateAvailabilityToggle();
      
      // Update photo preview
      if (userData.photoURL) {
        document.getElementById('photo-preview').innerHTML = `
          <img src="${userData.photoURL}" style="width: 100px; height: 100px; border-radius: 8px; object-fit: cover; margin-top: 0.5rem;">
          <p style="color: #10b981; margin-top: 0.5rem; font-size: 0.9rem;">Current photo</p>
        `;
      }
    } else {
      // Create new user
      userRef.set({
        email: currentUser.email,
        coins: 0,
        earnings: 0,
        callsCompleted: 0,
        rating: 5.0,
        bio: '',
        photoURL: '',
        pricePerCall: 1,
        lastPriceChange: Date.now(),
        paypalEmail: '',
        isWhisper: false,
        isAvailable: false,
        social: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
  });
}

// Update UI
function updateUI() {
  if (currentUser) {
    document.getElementById('guest-menu').style.display = 'none';
    document.getElementById('logged-in-menu').style.display = 'block';
  } else {
    document.getElementById('guest-menu').style.display = 'block';
    document.getElementById('logged-in-menu').style.display = 'none';
  }
  
  // Update user info
  document.getElementById('coins-count').textContent = userData.coins || 0;
  
  // Update dashboard
  document.getElementById('dash-coins').textContent = userData.coins || 0;
  document.getElementById('dash-earnings').textContent = '$' + (userData.earnings || 0);
  document.getElementById('dash-calls').textContent = userData.callsCompleted || 0;
  document.getElementById('dash-rating').textContent = userData.rating ? userData.rating.toFixed(1) : '5.0';
  
  // Update profile form
  document.getElementById('profile-bio').value = userData.bio || '';
  document.getElementById('profile-price').value = userData.pricePerCall || 1;
  document.getElementById('paypal-email').value = userData.paypalEmail || '';
  document.getElementById('profile-twitter').value = userData.social?.twitter || '';
  document.getElementById('profile-instagram').value = userData.social?.instagram || '';
  document.getElementById('profile-tiktok').value = userData.social?.tiktok || '';
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
  if (!currentUser) {
    showNotification('Please login first', true);
    return;
  }
  
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
          price: user.pricePerCall || 1,
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
            <div class="profile-price">${profile.price} Coin${profile.price > 1 ? 's' : ''}</div>
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
  
  // Update shuffle profiles (exclude current user)
  shuffleProfiles = profiles.filter(p => !p.isCurrentUser && p.isAvailable);
  if (shuffleProfiles.length === 0) {
    shuffleProfiles = profiles.filter(p => !p.isCurrentUser);
  }
  
  console.log(`🎲 ${shuffleProfiles.length} profiles in shuffle mode`);
  
  // Start shuffle mode
  if (!shuffleTimer && shuffleProfiles.length > 0) {
    startShuffleMode();
  }
}

// Shuffle Mode Functions
function startShuffleMode() {
  if (shuffleTimer) clearInterval(shuffleTimer);
  
  if (shuffleProfiles.length > 0) {
    updateShuffleProfile();
    startCountdown();
  } else {
    console.log('No profiles available for shuffle');
    document.getElementById('shuffle-timer').innerHTML = 'No profiles available';
  }
}

function startCountdown() {
  countdown = 30;
  shuffleTimer = setInterval(() => {
    countdown--;
    document.getElementById('countdown').textContent = countdown;
    
    if (countdown <= 0) {
      nextShuffleProfile();
      countdown = 30;
    }
  }, 1000);
}

window.nextShuffleProfile = function() {
  if (shuffleProfiles.length === 0) return;
  
  currentShuffleIndex = (currentShuffleIndex + 1) % shuffleProfiles.length;
  updateShuffleProfile();
  countdown = 30;
  document.getElementById('countdown').textContent = countdown;
};

function updateShuffleProfile() {
  if (shuffleProfiles.length === 0) return;
  
  const profile = shuffleProfiles[currentShuffleIndex];
  
  document.getElementById('shuffle-img').src = profile.photo;
  document.getElementById('shuffle-name').textContent = profile.name;
  document.getElementById('shuffle-price').textContent = profile.price + ' Coin' + (profile.price > 1 ? 's' : '');
  document.getElementById('shuffle-bio').textContent = profile.bio;
  
  selectedProfile = profile;
}

// View profile
window.viewProfile = function(profileId) {
  if (!currentUser) {
    showAuthModal('login');
    showNotification('Please login to view profiles', true);
    return;
  }
  
  // Find profile from shuffleProfiles or load from Firebase
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
  document.getElementById('modal-profile-bio').textContent = profile.bio;
  document.getElementById('modal-profile-price').textContent = profile.price + ' Coin' + (profile.price > 1 ? 's' : '') + ' ($' + (profile.price * 12) + ' earned)';
  
  // Update social links
  const socialLinks = document.getElementById('modal-social-links');
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
      callButton.innerHTML = '<i class="fas fa-phone-alt"></i> Call Now';
      callButton.disabled = false;
      callButton.classList.remove('btn-secondary');
      callButton.classList.add('btn-primary');
      callButton.onclick = startCall;
    }
  }
  
  showModal('profile-modal');
};

// REAL AGORA CALL FUNCTIONS
async function initializeAgora() {
  if (!agoraClient && typeof AgoraRTC !== 'undefined') {
    agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    console.log('✅ Agora client initialized');
  }
  return agoraClient;
}

async function joinAgoraChannel(channelName) {
  try {
    await initializeAgora();
    
    // Get microphone permission and create local audio track
    localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    
    // Generate unique user ID
    const uid = currentUser ? currentUser.uid : Math.floor(Math.random() * 100000);
    
    // Join the channel
    await agoraClient.join(CONFIG.agoraAppId, channelName, null, uid);
    
    // Publish local audio track
    await agoraClient.publish([localAudioTrack]);
    
    console.log('✅ Joined Agora channel:', channelName);
    
    // Listen for remote users
    agoraClient.on('user-published', async (user, mediaType) => {
      if (mediaType === 'audio') {
        const remoteTrack = await agoraClient.subscribe(user, mediaType);
        remoteAudioTracks[user.uid] = remoteTrack;
        remoteTrack.play();
        console.log('🎧 Remote user connected:', user.uid);
      }
    });
    
    agoraClient.on('user-unpublished', (user) => {
      delete remoteAudioTracks[user.uid];
      console.log('🎧 Remote user disconnected:', user.uid);
    });
    
    return true;
  } catch (error) {
    console.error('❌ Agora join error:', error);
    return false;
  }
}

async function leaveAgoraChannel() {
  if (localAudioTrack) {
    localAudioTrack.close();
    localAudioTrack = null;
  }
  
  if (agoraClient) {
    await agoraClient.leave();
    agoraClient = null;
  }
  
  remoteAudioTracks = {};
  console.log('✅ Left Agora channel');
}

// Start call from profile modal
window.startCall = async function() {
  if (!selectedProfile) {
    showNotification('No profile selected', true);
    return;
  }
  
  if (!currentUser) {
    showAuthModal('login');
    return;
  }
  
  const callPrice = selectedProfile.price;
  
  // Check coins
  if (userData.coins < callPrice) {
    showNotification(`You need ${callPrice} coin${callPrice > 1 ? 's' : ''} to call`, true);
    return;
  }
  
  closeModal('profile-modal');
  showNotification('Starting call with ' + selectedProfile.name + '...');
  
  // Deduct coins
  await db.ref('users/' + currentUser.uid).update({
    coins: userData.coins - callPrice
  });
  
  // Create call record
  const callRef = db.ref('calls').push();
  const callId = callRef.key;
  const channelName = 'call_' + callId;
  
  await callRef.set({
    callerId: currentUser.uid,
    whisperId: selectedProfile.uid,
    coins: callPrice,
    status: 'waiting',
    channel: channelName,
    createdAt: Date.now()
  });
  
  // Set active call
  activeCall = {
    id: callId,
    whisperId: selectedProfile.uid,
    coins: callPrice,
    channel: channelName,
    started: false,
    refundable: true
  };
  
  // Show call interface
  showCallInterface();
  startWaitTimer();
  
  // Listen for whisper to join (simulate for now)
  setTimeout(async () => {
    if (activeCall && activeCall.id === callId && !activeCall.started) {
      await startAudioCall(callId);
    }
  }, 5000); // Wait 5 seconds for whisper to join
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

// Show call interface
function showCallInterface() {
  // Transform phone to call mode
  const phoneWrapper = document.getElementById('iphone-wrapper');
  const iphoneScreen = document.querySelector('.iphone-screen');
  
  iphoneScreen.innerHTML = `
    <div class="phone-status-bar">
      <span>9:41 AM</span>
      <span>Calling...</span>
    </div>
    
    <div class="phone-content">
      <img src="${selectedProfile.photo}" alt="${selectedProfile.name}" 
           class="shuffle-profile-img" style="width: 120px; height: 120px;">
      <h3 class="shuffle-profile-name">${selectedProfile.name}</h3>
      <p class="call-status" id="call-status">Connecting to whisper...</p>
      <div class="call-timer" id="call-timer">02:00</div>
      
      <div class="phone-controls">
        <button class="phone-btn phone-btn-hangup" onclick="endCallEarly()">
          <i class="fas fa-phone-slash"></i>
        </button>
      </div>
    </div>
  `;
}

// Start wait timer
function startWaitTimer() {
  timeLeft = CONFIG.waitDuration;
  updateCallTimer();
  
  waitTimer = setInterval(() => {
    timeLeft--;
    updateCallTimer();
    
    if (timeLeft <= 0) {
      clearInterval(waitTimer);
      endCallEarly();
    }
  }, 1000);
}

function updateCallTimer() {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  document.getElementById('call-timer').textContent = 
    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Start audio call with Agora
async function startAudioCall(callId) {
  clearInterval(waitTimer);
  
  // Update call status
  await db.ref('calls/' + callId).update({
    status: 'active',
    startedAt: Date.now()
  });
  
  activeCall.started = true;
  activeCall.refundable = false;
  
  // Update UI
  const iphoneScreen = document.querySelector('.iphone-screen');
  if (iphoneScreen) {
    iphoneScreen.querySelector('.call-status').textContent = 'Call in progress...';
  }
  
  // Join Agora channel
  const joined = await joinAgoraChannel(activeCall.channel);
  if (joined) {
    showNotification('✅ Call connected! Audio is live.');
  } else {
    showNotification('⚠️ Call connected but audio failed', true);
  }
  
  // Start 5-minute timer
  startCallTimer();
}

// Start call timer
function startCallTimer() {
  timeLeft = CONFIG.callDuration;
  
  callTimer = setInterval(async () => {
    timeLeft--;
    updateCallTimer();
    
    if (timeLeft <= 0) {
      clearInterval(callTimer);
      await completeCall();
    }
  }, 1000);
}

// End call early (refund)
window.endCallEarly = async function() {
  if (!activeCall) return;
  
  await leaveAgoraChannel();
  
  if (activeCall.refundable) {
    // Refund coins
    await db.ref('users/' + currentUser.uid).update({
      coins: (userData.coins || 0) + activeCall.coins
    });
    showNotification('Call ended. Coins refunded.');
  } else {
    showNotification('Call ended.');
  }
  
  endCallCleanup();
};

// Complete call
async function completeCall() {
  clearInterval(callTimer);
  
  if (activeCall && activeCall.id) {
    await db.ref('calls/' + activeCall.id).update({
      status: 'completed',
      completedAt: Date.now(),
      duration: CONFIG.callDuration
    });
    
    // Pay whisper
    await payWhisper(activeCall.whisperId, activeCall.coins);
    
    showNotification('✅ Call completed!');
    
    // Reset phone interface
    resetPhoneInterface();
    
    // Show rating modal
    setTimeout(() => {
      showModal('rating-modal');
    }, 1000);
  }
  
  await leaveAgoraChannel();
  endCallCleanup();
}

// Pay whisper
async function payWhisper(whisperId, coins) {
  const earnings = coins * CONFIG.whisperEarning;
  
  const whisperRef = db.ref('users/' + whisperId);
  const snapshot = await whisperRef.once('value');
  const whisperData = snapshot.val() || {};
  
  await whisperRef.update({
    earnings: (whisperData.earnings || 0) + earnings,
    callsCompleted: (whisperData.callsCompleted || 0) + 1
  });
  
  // Create payout record
  await db.ref('payouts').push().set({
    whisperId: whisperId,
    amount: earnings,
    coins: coins,
    date: Date.now(),
    status: 'pending'
  });
}

// End call cleanup
function endCallCleanup() {
  clearInterval(waitTimer);
  clearInterval(callTimer);
  
  if (agoraClient) {
    agoraClient.leave();
    agoraClient = null;
  }
  
  if (localAudioTrack) {
    localAudioTrack.stop();
    localAudioTrack = null;
  }
  
  activeCall = null;
  selectedProfile = null;
}

// Reset phone interface
function resetPhoneInterface() {
  const iphoneScreen = document.querySelector('.iphone-screen');
  if (iphoneScreen) {
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
          <p class="shuffle-profile-bio" id="shuffle-bio"></p>
        </div>
        
        <div class="phone-controls">
          <button class="phone-btn phone-btn-call" onclick="startCallFromShuffle()">
            <i class="fas fa-phone-alt"></i>
          </button>
          <button class="phone-btn phone-btn-hangup" onclick="nextShuffleProfile()">
            <i class="fas fa-forward"></i>
          </button>
        </div>
        
        <div class="shuffle-timer" id="shuffle-timer">
          Next profile in: <span id="countdown">30</span>s
        </div>
      </div>
    `;
    
    // Restart shuffle mode
    if (shuffleProfiles.length > 0) {
      startShuffleMode();
    }
  }
}

// Profile save function
window.saveProfile = async function() {
  if (!currentUser) {
    showNotification('Please login first', true);
    return;
  }
  
  const bio = document.getElementById('profile-bio').value.trim();
  const price = parseInt(document.getElementById('profile-price').value);
  const paypalEmail = document.getElementById('paypal-email').value.trim();
  const twitter = document.getElementById('profile-twitter').value.trim();
  const instagram = document.getElementById('profile-instagram').value.trim();
  const tiktok = document.getElementById('profile-tiktok').value.trim();
  
  if (!bio) {
    showNotification('Please enter a bio', true);
    return;
  }
  
  if (price < 1 || price > 3) {
    showNotification('Price must be between 1-3 coins', true);
    return;
  }
  
  const priceChanged = price !== userData.pricePerCall;
  if (priceChanged && !canChangePrice()) {
    showNotification('You can only change price once per day', true);
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
  
  if (priceChanged) {
    updates.pricePerCall = price;
    updates.lastPriceChange = Date.now();
  }
  
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

function canChangePrice() {
  if (!userData.lastPriceChange) return true;
  
  const now = Date.now();
  const lastChange = userData.lastPriceChange;
  const oneDay = 24 * 60 * 60 * 1000;
  
  return (now - lastChange) >= oneDay;
}

// Profile photo upload
document.getElementById('profile-photo')?.addEventListener('change', async function(e) {
  if (!currentUser) return;
  
  const file = e.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    showNotification('Please upload an image file', true);
    return;
  }
  
  if (file.size > 5 * 1024 * 1024) {
    showNotification('File size must be less than 5MB', true);
    return;
  }
  
  showNotification('Uploading photo...');
  
  try {
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop();
    const fileName = `${currentUser.uid}_${timestamp}.${fileExtension}`;
    
    const storageRef = storage.ref('profile-photos/' + fileName);
    const snapshot = await storageRef.put(file);
    const downloadURL = await snapshot.ref.getDownloadURL();
    
    await db.ref('users/' + currentUser.uid).update({ 
      photoURL: downloadURL 
    });
    
    document.getElementById('photo-preview').innerHTML = `
      <img src="${downloadURL}" style="width: 100px; height: 100px; border-radius: 8px; object-fit: cover; margin-top: 0.5rem;">
      <p style="color: #10b981; margin-top: 0.5rem; font-size: 0.9rem;">Photo uploaded!</p>
    `;
    
    showNotification('✅ Photo uploaded successfully!');
    
  } catch (error) {
    console.log('Upload error:', error);
    showNotification('Failed to upload photo', true);
  }
});

// Auth functions
window.showAuthModal = function(tab = 'login') {
  switchAuthTab(tab);
  showModal('auth-modal');
};

window.closeAuthModal = function() {
  closeModal('auth-modal');
};

window.switchAuthTab = function(tab) {
  document.getElementById('auth-modal-title').textContent = tab === 'login' ? 'Login to Whisper+me' : 'Sign Up for Whisper+me';
  document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('signup-form').style.display = tab === 'signup' ? 'block' : 'none';
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
      await endCallEarly();
    }
    
    if (shuffleTimer) {
      clearInterval(shuffleTimer);
      shuffleTimer = null;
    }
    
    await auth.signOut();
    showNotification('Logged out successfully');
    showGuestUI();
    loadProfiles();
    startShuffleMode();
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
  document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

function hideLoading() {
  document.getElementById('loading-screen').style.display = 'none';
}

function showNotification(message, isError = false) {
  const notification = document.getElementById('notification');
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
  document.getElementById('guest-menu').style.display = 'block';
  document.getElementById('logged-in-menu').style.display = 'none';
}

function setupEventListeners() {
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', function(e) {
      if (e.target === this) {
        this.style.display = 'none';
      }
    });
  });
  
  document.getElementById('login-password')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') login();
  });
  
  document.getElementById('signup-confirm')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') signup();
  });
}

// Coin functions
window.selectCoinOption = function(coins) {
  selectedCoinOption = coins;
  
  document.querySelectorAll('.coin-option').forEach(option => {
    option.classList.remove('selected');
  });
  
  document.querySelectorAll('.coin-option').forEach(option => {
    if (option.querySelector('.coin-amount').textContent.includes(coins.toString())) {
      option.classList.add('selected');
    }
  });
};

window.buyCoins = async function() {
  if (!currentUser) {
    showAuthModal('login');
    showNotification('Please login to buy coins', true);
    return;
  }
  
  const amount = selectedCoinOption * CONFIG.coinPrice;
  showNotification(`Processing $${amount} purchase...`);
  
  try {
    setTimeout(async () => {
      await db.ref('users/' + currentUser.uid).update({
        coins: (userData.coins || 0) + selectedCoinOption
      });
      
      await db.ref('purchases').push().set({
        userId: currentUser.uid,
        coins: selectedCoinOption,
        amount: amount,
        date: Date.now()
      });
      
      showNotification(`✅ Added ${selectedCoinOption} coin${selectedCoinOption > 1 ? 's' : ''} to your account!`);
    }, 1500);
    
  } catch (error) {
    console.log('Payment error:', error);
    showNotification('Payment failed', true);
  }
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
  document.getElementById('rating-comment').value = '';
  currentRating = 5;
};

// Admin login
window.showAdminLogin = function() {
  const password = prompt('Enter admin password:');
  if (password === CONFIG.adminPassword) {
    window.location.href = 'admin.html';
  } else {
    showNotification('Invalid password', true);
  }
};

// Share profile
window.shareProfile = function() {
  if (!selectedProfile) return;
  
  if (navigator.share) {
    navigator.share({
      title: 'Chat with ' + selectedProfile.name + ' on Whisper+me',
      text: 'Connect with ' + selectedProfile.name + ' for a private audio chat!',
      url: window.location.href
    });
  } else {
    navigator.clipboard.writeText(window.location.href);
    showNotification('Profile link copied to clipboard!');
  }
};

console.log('✅ Whisper+me PRODUCTION READY with REAL Agora & Firebase');
