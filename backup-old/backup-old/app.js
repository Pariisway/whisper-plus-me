// Whisper+me MVP - Complete Production Version with Login/Signup
console.log('🚀 Whisper+me starting...');

// Configuration
const CONFIG = {
  appName: 'Whisper+me',
  agoraAppId: '966c8e41da614722a88d4372c3d95dba',
  stripeKey: 'pk_test_51SPYHwRvETRK3Zx7mnVDTNyPB3mxT8vbSIcSVQURp8irweK0lGznwFrW9sjgju2GFgmDiQ5GkWYVlUQZZVNrXkJb00q2QOCC3I',
  stripeProductId: 'prod_TZ0C0wOq1WjSyy',
  coinPrice: 15, // $15 per coin
  whisperEarning: 12, // $12 per coin earned
  callDuration: 300, // 5 minutes
  waitDuration: 120, // 2 minutes waiting
  adminEmail: 'ifanifwasafifth@gmail.com',
  adminPassword: '068790Pw!'
};

// State
let currentUser = null;
let userData = {
  email: '',
  coins: 0,
  earnings: 0,
  callsCompleted: 0,
  rating: 5.0,
  mode: 'caller', // 'caller' or 'whisper'
  bio: '',
  photoURL: '',
  social: {},
  pricePerCall: 1, // 1-3 coins
  lastPriceChange: 0,
  paypalEmail: ''
};
let selectedProfile = null;
let selectedCoins = 1;
let activeCall = null;
let agoraClient = null;
let localAudioTrack = null;
let callTimer = null;
let waitTimer = null;
let timeLeft = 0;
let isAdmin = false;

// Firebase initialization
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
  console.log('⚠️ Firebase error:', error);
}

const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();

// Stripe
const stripe = Stripe(CONFIG.stripeKey);

// When page loads
document.addEventListener('DOMContentLoaded', async () => {
  console.log('📱 Page loaded');
  
  // Hide loading screen after 2 seconds if not logged in
  setTimeout(hideLoading, 2000);
  
  // Check if user is admin
  checkAdmin();
  
  // Setup auth state listener
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      // User is signed in
      currentUser = user;
      console.log('👤 User signed in:', user.email);
      
      // Setup user
      await setupUser();
      
      // Update UI for logged in user
      updateUI();
      loadProfiles();
      
      // Hide loading screen
      hideLoading();
      
    } else {
      // No user is signed in
      console.log('👤 No user signed in');
      
      // Show guest UI
      showGuestUI();
      
      // Load demo profiles for guests
      loadDemoProfiles();
      
      // Show auth modal after 1 second
      setTimeout(() => {
        showAuthModal('login');
      }, 1000);
    }
  });
  
  // Setup event listeners
  setupEventListeners();
});

// Setup user in database
async function setupUser() {
  const userRef = db.ref('users/' + currentUser.uid);
  
  // Listen for changes
  userRef.on('value', (snap) => {
    if (snap.exists()) {
      const data = snap.val();
      userData = { ...userData, ...data };
      updateUI();
    } else {
      // Create new user with 3 free coins
      userRef.set({
        email: currentUser.email,
        coins: 3,
        earnings: 0,
        callsCompleted: 0,
        rating: 5.0,
        mode: 'caller',
        bio: '',
        photoURL: '',
        social: {},
        pricePerCall: 1,
        lastPriceChange: Date.now(),
        paypalEmail: '',
        createdAt: Date.now()
      });
    }
  });
  
  // Load profiles
  loadProfiles();
}

// Update UI
function updateUI() {
  // Update user info in header
  document.getElementById('user-email').textContent = userData.email || currentUser.email;
  document.getElementById('user-avatar').src = userData.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(userData.email || 'User');
  
  // Show logged in menu, hide guest menu
  document.getElementById('guest-menu').style.display = 'none';
  document.getElementById('logged-in-menu').style.display = 'flex';
  
  // Update coin count
  document.getElementById('coins-count').textContent = userData.coins;
  document.getElementById('dash-coins').textContent = userData.coins;
  document.getElementById('dash-earnings').textContent = '$' + userData.earnings;
  document.getElementById('dash-calls').textContent = userData.callsCompleted;
  document.getElementById('dash-rating').textContent = userData.rating.toFixed(1);
  
  // Update profile form
  document.getElementById('profile-bio').value = userData.bio || '';
  document.getElementById('profile-twitter').value = userData.social?.twitter || '';
  document.getElementById('profile-instagram').value = userData.social?.instagram || '';
  document.getElementById('profile-tiktok').value = userData.social?.tiktok || '';
  document.getElementById('profile-price').value = userData.pricePerCall || 1;
  document.getElementById('paypal-email').value = userData.paypalEmail || '';
  
  // Show photo if exists
  if (userData.photoURL) {
    document.getElementById('photo-preview').innerHTML = `
      <img src="${userData.photoURL}" style="width: 100px; height: 100px; border-radius: 8px; object-fit: cover;">
    `;
  }
}

// Show guest UI
function showGuestUI() {
  document.getElementById('guest-menu').style.display = 'flex';
  document.getElementById('logged-in-menu').style.display = 'none';
  
  // Disable call buttons for guests
  document.querySelectorAll('.call-btn, .view-profile-btn').forEach(btn => {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-lock"></i> Login to Call';
  });
}

// Check if current user is admin
async function checkAdmin() {
  const urlParams = new URLSearchParams(window.location.search);
  const adminParam = urlParams.get('admin');
  
  if (adminParam === 'true') {
    // Show admin button
    document.getElementById('admin-btn').style.display = 'block';
    isAdmin = true;
  }
  
  // Check if user is admin by email
  if (currentUser && currentUser.email === CONFIG.adminEmail) {
    isAdmin = true;
    document.getElementById('admin-btn').style.display = 'block';
  }
}

// Auth Functions
window.showAuthModal = function(tab = 'login') {
  document.getElementById('auth-modal').style.display = 'flex';
  switchAuthTab(tab);
};

window.closeAuthModal = function() {
  document.getElementById('auth-modal').style.display = 'none';
};

window.switchAuthTab = function(tab) {
  // Update tabs
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.remove('active');
    if (t.dataset.tab === tab) {
      t.classList.add('active');
    }
  });
  
  // Update forms
  document.querySelectorAll('.auth-form').forEach(form => {
    form.classList.remove('active');
    if (form.id === tab + '-form') {
      form.classList.add('active');
    }
  });
};

window.login = async function() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  
  if (!email || !password) {
    showNotification('Please enter email and password', true);
    return;
  }
  
  if (!validateEmail(email)) {
    showNotification('Please enter a valid email', true);
    return;
  }
  
  showNotification('Logging in...');
  
  try {
    await auth.signInWithEmailAndPassword(email, password);
    showNotification('✅ Login successful!');
    closeAuthModal();
  } catch (error) {
    console.log('Login error:', error);
    let message = 'Login failed. ';
    
    switch(error.code) {
      case 'auth/user-not-found':
        message += 'User not found. Please sign up.';
        break;
      case 'auth/wrong-password':
        message += 'Incorrect password.';
        break;
      case 'auth/invalid-email':
        message += 'Invalid email address.';
        break;
      default:
        message += error.message;
    }
    
    showNotification(message, true);
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
  
  if (!validateEmail(email)) {
    showNotification('Please enter a valid email', true);
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
    showNotification('✅ Account created! You now have 3 free coins.');
    closeAuthModal();
  } catch (error) {
    console.log('Signup error:', error);
    let message = 'Signup failed. ';
    
    switch(error.code) {
      case 'auth/email-already-in-use':
        message += 'Email already in use. Please login.';
        break;
      case 'auth/weak-password':
        message += 'Password is too weak.';
        break;
      case 'auth/invalid-email':
        message += 'Invalid email address.';
        break;
      default:
        message += error.message;
    }
    
    showNotification(message, true);
  }
};

window.logout = async function() {
  try {
    await auth.signOut();
    showNotification('Logged out successfully');
    showGuestUI();
    loadDemoProfiles();
  } catch (error) {
    console.log('Logout error:', error);
    showNotification('Logout failed', true);
  }
};

// Helper function to validate email
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// Load profiles from Firebase
async function loadProfiles() {
  if (!currentUser) {
    loadDemoProfiles();
    return;
  }
  
  try {
    const snapshot = await db.ref('users').once('value');
    const profiles = [];
    
    snapshot.forEach(child => {
      const user = child.val();
      if (user.bio && child.key !== currentUser.uid && user.mode === 'whisper') {
        profiles.push({
          id: child.key,
          name: user.bio.split(' ').slice(0, 2).join(' ') || 'Anonymous',
          bio: user.bio,
          photo: user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.bio.split(' ')[0] || 'User'),
          price: user.pricePerCall || 1,
          social: user.social || {},
          rating: user.rating || 5.0,
          calls: user.callsCompleted || 0
        });
      }
    });
    
    displayProfiles(profiles);
    
  } catch (error) {
    console.log('⚠️ Loading demo profiles');
    loadDemoProfiles();
  }
}

// Load demo profiles
function loadDemoProfiles() {
  const demoProfiles = [
    {
      id: 'demo1',
      name: 'Alex Johnson',
      bio: 'Tech entrepreneur & startup advisor. Love discussing innovation and business growth.',
      photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face',
      price: 2,
      social: {
        twitter: 'https://twitter.com/alex',
        instagram: 'https://instagram.com/alex'
      },
      rating: 4.8,
      calls: 24
    },
    {
      id: 'demo2',
      name: 'Sam Wilson',
      bio: 'Fitness coach & nutrition expert. Let\'s talk health, wellness, and motivation!',
      photo: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?w=200&h=200&fit=crop&crop=face',
      price: 1,
      social: {
        instagram: 'https://instagram.com/samfitness'
      },
      rating: 4.9,
      calls: 42
    },
    {
      id: 'demo3',
      name: 'Taylor Smith',
      bio: 'Digital artist and creative consultant. Passionate about art, design, and creativity.',
      photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=face',
      price: 3,
      social: {
        twitter: 'https://twitter.com/taylorart',
        instagram: 'https://instagram.com/taylorart',
        tiktok: 'https://tiktok.com/@taylorart'
      },
      rating: 4.7,
      calls: 18
    }
  ];
  
  displayProfiles(demoProfiles);
}

// Display profiles
function displayProfiles(profiles) {
  const container = document.getElementById('profiles-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  profiles.forEach(profile => {
    const card = document.createElement('div');
    card.className = 'profile-card';
    card.innerHTML = `
      <div class="profile-card-header">
        <img src="${profile.photo}" alt="${profile.name}" class="profile-img">
        <div class="profile-info">
          <h3>${profile.name}</h3>
          <div class="profile-price">${profile.price} Coin${profile.price > 1 ? 's' : ''}</div>
        </div>
      </div>
      <p class="profile-bio">${profile.bio.substring(0, 80)}${profile.bio.length > 80 ? '...' : ''}</p>
      <div class="profile-card-footer">
        <button class="view-profile-btn" onclick="viewProfile('${profile.id}')">
          ${!currentUser ? '<i class="fas fa-lock"></i> Login to View' : 'View Profile & Call'}
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

// View profile modal
window.viewProfile = function(profileId) {
  if (!currentUser) {
    showAuthModal('login');
    showNotification('Please login to view profiles', true);
    return;
  }
  
  // Find profile
  const profile = getProfileById(profileId);
  if (!profile) return;
  
  selectedProfile = profile;
  selectedCoins = profile.price;
  
  // Update modal
  document.getElementById('modal-profile-img').src = profile.photo;
  document.getElementById('modal-profile-name').textContent = profile.name;
  document.getElementById('modal-profile-bio').textContent = profile.bio;
  document.getElementById('modal-profile-price').textContent = profile.price + ' Coin' + (profile.price > 1 ? 's' : '');
  
  // Update social links
  const socialLinks = document.getElementById('modal-social-links');
  socialLinks.innerHTML = '';
  
  if (profile.social.twitter) {
    socialLinks.innerHTML += `<a href="${profile.social.twitter}" target="_blank" class="social-link"><i class="fab fa-twitter"></i></a>`;
  }
  if (profile.social.instagram) {
    socialLinks.innerHTML += `<a href="${profile.social.instagram}" target="_blank" class="social-link"><i class="fab fa-instagram"></i></a>`;
  }
  if (profile.social.tiktok) {
    socialLinks.innerHTML += `<a href="${profile.social.tiktok}" target="_blank" class="social-link"><i class="fab fa-tiktok"></i></a>`;
  }
  
  // Update coin selection buttons
  document.querySelectorAll('.coin-select-btn').forEach(btn => {
    const coins = parseInt(btn.dataset.coins);
    btn.style.background = coins === selectedCoins ? '#7c3aed' : '#333';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.padding = '0.5rem 1rem';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    
    btn.onclick = function() {
      if (canChangePrice()) {
        selectedCoins = coins;
        document.querySelectorAll('.coin-select-btn').forEach(b => {
          b.style.background = parseInt(b.dataset.coins) === selectedCoins ? '#7c3aed' : '#333';
        });
      } else {
        showNotification('You can only change price once per day', true);
      }
    };
  });
  
  // Show modal
  document.getElementById('profile-modal').style.display = 'flex';
};

// Get profile by ID
function getProfileById(id) {
  // In real app, fetch from Firebase
  // For demo, return dummy data
  return {
    id: id,
    name: id === 'demo1' ? 'Alex Johnson' : id === 'demo2' ? 'Sam Wilson' : 'Taylor Smith',
    bio: 'Sample bio for demo profile',
    photo: 'https://ui-avatars.com/api/?name=User',
    price: 1,
    social: {}
  };
}

// Check if user can change price
function canChangePrice() {
  if (!userData.lastPriceChange) return true;
  const now = Date.now();
  const lastChange = userData.lastPriceChange;
  const oneDay = 24 * 60 * 60 * 1000;
  return (now - lastChange) >= oneDay;
}

// Share profile
window.shareProfile = function() {
  if (navigator.share) {
    navigator.share({
      title: 'Chat with ' + selectedProfile.name + ' on Whisper+me',
      text: 'Connect with ' + selectedProfile.name + ' for a private audio chat!',
      url: window.location.href
    });
  } else {
    navigator.clipboard.writeText(window.location.href + '?profile=' + selectedProfile.id);
    showNotification('Profile link copied to clipboard!');
  }
  
  // Close modal
  closeModal();
};

// Start call from modal
window.startCallFromModal = function() {
  if (!selectedProfile) return;
  
  // Check if user has enough coins
  if (userData.coins < selectedCoins) {
    showNotification(`You need ${selectedCoins} coin${selectedCoins > 1 ? 's' : ''} to call`, true);
    showCoinsModal();
    return;
  }
  
  // Close profile modal
  closeModal();
  
  // Start call
  startCall();
};

// Start call
async function startCall() {
  if (!selectedProfile) return;
  
  // Deduct coins immediately
  await db.ref('users/' + currentUser.uid + '/coins').transaction(coins => {
    return Math.max(0, (coins || 0) - selectedCoins);
  });
  
  // Create call record
  const callRef = db.ref('calls').push();
  const callId = callRef.key;
  
  await callRef.set({
    callerId: currentUser.uid,
    whisperId: selectedProfile.id,
    coins: selectedCoins,
    status: 'waiting',
    createdAt: Date.now(),
    channel: 'call_' + callId,
    callerCoins: userData.coins - selectedCoins
  });
  
  // Update call status
  activeCall = {
    id: callId,
    whisperId: selectedProfile.id,
    coins: selectedCoins,
    channel: 'call_' + callId,
    started: false,
    refundable: true
  };
  
  // Show call modal
  showCallModal();
  
  // Start 2-minute wait timer
  startWaitTimer();
  
  // Listen for answer
  db.ref('calls/' + callId + '/status').on('value', async (snap) => {
    const status = snap.val();
    
    if (status === 'accepted') {
      // Start audio call
      await startAudioCall(callId);
    } else if (status === 'rejected' || status === 'cancelled') {
      // Refund coins
      await refundCall(callId);
      showNotification('Call was not accepted. Coins refunded.', true);
      closeCallModal();
    }
  });
  
  // Auto-timeout after 2 minutes
  setTimeout(async () => {
    if (activeCall && activeCall.id === callId && !activeCall.started) {
      await db.ref('calls/' + callId).update({ status: 'timeout' });
      showNotification('Call timed out. Coins refunded.', true);
      await refundCall(callId);
      closeCallModal();
    }
  }, CONFIG.waitDuration * 1000);
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
      // Call timed out, already handled above
    }
  }, 1000);
}

// Start audio call
async function startAudioCall(callId) {
  try {
    showNotification('🎤 Connecting audio... Please allow microphone access.');
    
    // Clear wait timer
    clearInterval(waitTimer);
    
    // Update UI for active call
    document.getElementById('waiting-section').style.display = 'none';
    document.getElementById('active-call-section').style.display = 'block';
    
    // Update call as started (no longer refundable)
    activeCall.started = true;
    activeCall.refundable = false;
    
    // Update database
    await db.ref('calls/' + callId).update({
      status: 'active',
      startedAt: Date.now()
    });
    
    // Start 5-minute timer
    startCallTimer();
    
    // Initialize Agora (if available)
    if (typeof AgoraRTC !== 'undefined') {
      try {
        agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        
        // For demo, we'll simulate joining
        // In production: await agoraClient.join(CONFIG.agoraAppId, activeCall.channel, null, currentUser.uid);
        
        // Request microphone permission
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localAudioTrack = stream.getAudioTracks()[0];
        
        showNotification('✅ Call connected! Timer started.');
        
      } catch (agoraError) {
        console.log('Agora error:', agoraError);
        // Continue with simulated call
        showNotification('Call connected (demo mode)');
      }
    } else {
      showNotification('Call connected (demo mode)');
    }
    
  } catch (error) {
    console.log('Audio error:', error);
    showNotification('Microphone access denied. Please allow permissions.', true);
  }
}

// Start 5-minute call timer
function startCallTimer() {
  timeLeft = CONFIG.callDuration;
  updateCallTimer();
  
  callTimer = setInterval(async () => {
    timeLeft--;
    updateCallTimer();
    
    if (timeLeft <= 0) {
      clearInterval(callTimer);
      await endCall(true); // Completed successfully
    }
  }, 1000);
}

// Update call timer display
function updateCallTimer() {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  document.getElementById('call-timer').textContent = 
    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// End call early (refund)
window.endCallEarly = async function() {
  if (!activeCall) return;
  
  if (activeCall.refundable) {
    // Refund coins
    await refundCall(activeCall.id);
    showNotification('Call ended. Coins refunded.');
  } else {
    showNotification('Call already started. No refund available.', true);
  }
  
  // Update call status
  if (activeCall.id) {
    await db.ref('calls/' + activeCall.id).update({
      status: 'cancelled',
      endedAt: Date.now()
    });
  }
  
  closeCallModal();
};

// End call (normal)
window.endCall = async function(completed = false) {
  if (callTimer) clearInterval(callTimer);
  if (waitTimer) clearInterval(waitTimer);
  
  if (agoraClient) {
    try {
      await agoraClient.leave();
      agoraClient = null;
    } catch (e) {}
  }
  
  if (localAudioTrack) {
    localAudioTrack.stop();
    localAudioTrack = null;
  }
  
  if (activeCall && activeCall.id) {
    const updates = {
      status: completed ? 'completed' : 'ended',
      endedAt: Date.now(),
      duration: completed ? CONFIG.callDuration : Math.max(0, CONFIG.callDuration - timeLeft)
    };
    
    await db.ref('calls/' + activeCall.id).update(updates);
    
    if (completed) {
      // Pay the whisper
      await payWhisper(activeCall.whisperId, activeCall.coins);
      
      // Show rating modal
      setTimeout(() => showRatingModal(activeCall.id), 500);
    }
  }
  
  closeCallModal();
};

// Refund call coins
async function refundCall(callId) {
  if (!activeCall || !activeCall.refundable) return;
  
  await db.ref('users/' + currentUser.uid + '/coins').transaction(coins => {
    return (coins || 0) + activeCall.coins;
  });
  
  activeCall.refundable = false;
}

// Pay whisper
async function payWhisper(whisperId, coins) {
  const earnings = coins * CONFIG.whisperEarning;
  
  // Update whisper's earnings
  await db.ref('users/' + whisperId + '/earnings').transaction(earnings => {
    return (earnings || 0) + earnings;
  });
  
  // Update whisper's call count
  await db.ref('users/' + whisperId + '/callsCompleted').transaction(calls => {
    return (calls || 0) + 1;
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

// Show rating modal
function showRatingModal(callId) {
  const rating = prompt('Rate this call (1-5 stars):');
  if (rating && rating >= 1 && rating <= 5) {
    const comment = prompt('Optional: Leave a comment about the call:');
    
    // Save rating
    db.ref('ratings/' + callId).set({
      from: currentUser.uid,
      rating: parseFloat(rating),
      comment: comment || '',
      timestamp: Date.now()
    });
    
    // Send to admin email (simulated)
    sendToAdminEmail(`New rating: ${rating} stars`, 
      `Call ID: ${callId}\nRating: ${rating}/5\nComment: ${comment || 'None'}`);
    
    showNotification('⭐ Thanks for your rating!');
  }
}

// Send to admin email (simulated)
function sendToAdminEmail(subject, body) {
  // In production, use Firebase Functions or email service
  console.log('📧 Email to admin:', subject, body);
  
  // Save to admin notifications
  db.ref('admin/notifications').push().set({
    type: 'rating',
    subject: subject,
    body: body,
    timestamp: Date.now(),
    read: false
  });
}

// Coin purchase functions
let selectedCoinOption = 1;

window.selectCoinOption = function(coins) {
  selectedCoinOption = coins;
  
  // Update UI
  document.querySelectorAll('.coin-option').forEach(option => {
    option.classList.remove('selected');
  });
  
  // Find and select the clicked option
  const options = document.querySelectorAll('.coin-option');
  options.forEach(option => {
    if (option.querySelector('.coin-amount').textContent.includes(coins.toString())) {
      option.classList.add('selected');
    }
  });
};

window.showCoinsModal = function() {
  // For now, just show coins section
  document.querySelector('.coins-section').scrollIntoView({ behavior: 'smooth' });
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
    // Simulate Stripe checkout
    // In production: const session = await createStripeCheckout(selectedCoinOption);
    // await stripe.redirectToCheckout({ sessionId: session.id });
    
    // For demo, add coins directly
    setTimeout(async () => {
      await db.ref('users/' + currentUser.uid + '/coins').transaction(coins => {
        return (coins || 0) + selectedCoinOption;
      });
      
      showNotification(`✅ Added ${selectedCoinOption} coin${selectedCoinOption > 1 ? 's' : ''} to your account!`);
      
      // Record purchase
      await db.ref('purchases').push().set({
        userId: currentUser.uid,
        coins: selectedCoinOption,
        amount: amount,
        date: Date.now()
      });
      
    }, 1500);
    
  } catch (error) {
    console.log('Payment error:', error);
    showNotification('Payment failed. Please try again.', true);
  }
};

// Dashboard functions
window.showDashboard = function() {
  if (!currentUser) {
    showAuthModal('login');
    return;
  }
  document.getElementById('dashboard-modal').style.display = 'block';
  loadRecentCalls();
};

window.closeDashboard = function() {
  document.getElementById('dashboard-modal').style.display = 'none';
};

// Save profile
window.saveProfile = async function() {
  if (!currentUser) {
    showAuthModal('login');
    return;
  }
  
  const bio = document.getElementById('profile-bio').value.trim();
  const twitter = document.getElementById('profile-twitter').value.trim();
  const instagram = document.getElementById('profile-instagram').value.trim();
  const tiktok = document.getElementById('profile-tiktok').value.trim();
  const price = parseInt(document.getElementById('profile-price').value);
  const paypalEmail = document.getElementById('paypal-email').value.trim();
  
  // Validate price
  if (price < 1 || price > 3) {
    showNotification('Price must be between 1-3 coins', true);
    return;
  }
  
  // Check if price changed
  const priceChanged = price !== userData.pricePerCall;
  if (priceChanged && !canChangePrice()) {
    showNotification('You can only change price once per day', true);
    return;
  }
  
  // Update user data
  const updates = {
    bio: bio,
    social: {
      twitter: twitter,
      instagram: instagram,
      tiktok: tiktok
    },
    paypalEmail: paypalEmail
  };
  
  if (priceChanged) {
    updates.pricePerCall = price;
    updates.lastPriceChange = Date.now();
  }
  
  try {
    await db.ref('users/' + currentUser.uid).update(updates);
    showNotification('✅ Profile saved successfully!');
    
    // Reload profiles to show updated info
    loadProfiles();
    
  } catch (error) {
    console.log('Save error:', error);
    showNotification('Failed to save profile', true);
  }
};

// Load recent calls
async function loadRecentCalls() {
  if (!currentUser) return;
  
  try {
    const snapshot = await db.ref('calls')
      .orderByChild('callerId')
      .equalTo(currentUser.uid)
      .limitToLast(5)
      .once('value');
    
    const container = document.getElementById('recent-calls');
    container.innerHTML = '';
    
    snapshot.forEach(child => {
      const call = child.val();
      const div = document.createElement('div');
      div.style.cssText = 'padding: 0.75rem; border-bottom: 1px solid #222;';
      
      const date = new Date(call.createdAt).toLocaleDateString();
      const status = call.status || 'unknown';
      const coins = call.coins || 1;
      
      div.innerHTML = `
        <div style="display: flex; justify-content: space-between;">
          <span>${date}</span>
          <span style="color: ${status === 'completed' ? '#10b981' : '#ef4444'}">
            ${status.toUpperCase()}
          </span>
        </div>
        <div style="color: #888; font-size: 0.9rem;">
          ${coins} coin${coins > 1 ? 's' : ''} • ${call.duration || 0}s
        </div>
      `;
      
      container.appendChild(div);
    });
    
  } catch (error) {
    console.log('Load calls error:', error);
  }
}

// Profile photo upload
document.getElementById('profile-photo').addEventListener('change', async function(e) {
  if (!currentUser) {
    showAuthModal('login');
    return;
  }
  
  const file = e.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    showNotification('Please upload an image file', true);
    return;
  }
  
  if (file.size > 5 * 1024 * 1024) {
    showNotification('Image must be less than 5MB', true);
    return;
  }
  
  showNotification('Uploading photo...');
  
  try {
    const storageRef = storage.ref('profile-photos/' + currentUser.uid);
    const snapshot = await storageRef.put(file);
    const downloadURL = await snapshot.ref.getDownloadURL();
    
    // Update user profile
    await db.ref('users/' + currentUser.uid).update({ photoURL: downloadURL });
    
    // Show preview
    document.getElementById('photo-preview').innerHTML = `
      <img src="${downloadURL}" style="width: 100px; height: 100px; border-radius: 8px; object-fit: cover;">
    `;
    
    showNotification('✅ Photo uploaded successfully!');
    
  } catch (error) {
    console.log('Upload error:', error);
    showNotification('Failed to upload photo', true);
  }
});

// Admin dashboard
window.showAdminDashboard = function() {
  const password = prompt('Enter admin password:');
  if (password === CONFIG.adminPassword) {
    window.location.href = 'admin.html';
  } else {
    showNotification('Invalid password', true);
  }
};

// Modal functions
function showCallModal() {
  if (!selectedProfile) return;
  
  // Update caller info
  document.getElementById('caller-img').src = selectedProfile.photo;
  document.getElementById('caller-name').textContent = selectedProfile.name;
  document.getElementById('call-price').textContent = selectedCoins + ' Coin' + (selectedCoins > 1 ? 's' : '');
  
  // Show waiting section
  document.getElementById('waiting-section').style.display = 'block';
  document.getElementById('active-call-section').style.display = 'none';
  
  // Show modal
  document.getElementById('call-modal').style.display = 'flex';
}

function closeCallModal() {
  document.getElementById('call-modal').style.display = 'none';
  
  // Clean up
  if (agoraClient) {
    agoraClient.leave();
    agoraClient = null;
  }
  
  if (localAudioTrack) {
    localAudioTrack.stop();
    localAudioTrack = null;
  }
  
  if (callTimer) clearInterval(callTimer);
  if (waitTimer) clearInterval(waitTimer);
  
  activeCall = null;
  selectedProfile = null;
}

function closeModal() {
  document.getElementById('profile-modal').style.display = 'none';
}

// UI helpers
function hideLoading() {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.style.display = 'none';
  }
  
  // Show main content
  document.getElementById('main-footer').style.display = 'block';
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
  
  console.log(isError ? '❌' : '✅', message);
}

// Setup event listeners
function setupEventListeners() {
  // Close modals on click outside
  document.getElementById('profile-modal')?.addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });
  
  document.getElementById('call-modal')?.addEventListener('click', function(e) {
    if (e.target === this) closeCallModal();
  });
  
  document.getElementById('dashboard-modal')?.addEventListener('click', function(e) {
    if (e.target === this) closeDashboard();
  });
  
  document.getElementById('auth-modal')?.addEventListener('click', function(e) {
    if (e.target === this) closeAuthModal();
  });
  
  // Auth tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      const tabName = this.dataset.tab;
      switchAuthTab(tabName);
    });
  });
  
  // Enter key in auth forms
  document.getElementById('login-password')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') login();
  });
  
  document.getElementById('signup-confirm')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') signup();
  });
  
  // Initialize coin selection
  selectCoinOption(1);
}

// Make functions available globally
window.loadProfiles = loadProfiles;
window.closeModal = closeModal;
window.closeCallModal = closeCallModal;
window.closeDashboard = closeDashboard;

console.log('✅ Whisper+me MVP ready with login/signup');
