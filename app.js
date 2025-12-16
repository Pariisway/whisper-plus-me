// Whisper+me - COMPLETE FIXED VERSION
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
let agoraClient = null;
let localAudioTrack = null;
let callTimer = null;
let waitTimer = null;
let timeLeft = 0;
let currentRating = 5;
let selectedCoinOption = 1;
let shuffleProfiles = [];
let shuffleTimer = null;
let currentShuffleIndex = 0;
let countdown = 30;

// Shuffle Profiles Data
const DEMO_PROFILES = [
  {
    id: 'demo1',
    name: 'Alex Johnson',
    bio: 'Tech entrepreneur & startup advisor. Love discussing innovation and business strategies.',
    photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=face',
    price: 2,
    social: { twitter: 'https://twitter.com/alex', instagram: 'https://instagram.com/alex' }
  },
  {
    id: 'demo2',
    name: 'Sam Wilson',
    bio: 'Fitness coach & nutrition expert. Let\'s talk health, wellness, and motivation!',
    photo: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?w=400&h=400&fit=crop&crop=face',
    price: 1,
    social: { instagram: 'https://instagram.com/samfitness' }
  },
  {
    id: 'demo3',
    name: 'Taylor Smith',
    bio: 'Digital artist and creative consultant. Passionate about art, design, and creativity.',
    photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=400&fit=crop&crop=face',
    price: 3,
    social: { twitter: 'https://twitter.com/taylorart', instagram: 'https://instagram.com/taylorart' }
  },
  {
    id: 'demo4',
    name: 'Jordan Lee',
    bio: 'Music producer and songwriter. Let\'s create something amazing together!',
    photo: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=400&fit=crop&crop=face',
    price: 2,
    social: { instagram: 'https://instagram.com/jordanmusic', tiktok: 'https://tiktok.com/@jordanmusic' }
  },
  {
    id: 'demo5',
    name: 'Casey Kim',
    bio: 'Travel blogger and photographer. Love sharing stories from around the world.',
    photo: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=400&fit=crop&crop=face',
    price: 1,
    social: { instagram: 'https://instagram.com/caseytravels' }
  }
];

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
      // User is logged in
      currentUser = user;
      console.log('👤 User logged in:', user.email);
      await setupUser();
      updateUI();
      loadProfiles();
      startShuffleMode();
      hideLoading();
    } else {
      // No user logged in
      console.log('👤 No user logged in');
      showGuestUI();
      loadProfiles();
      startShuffleMode();
      hideLoading();
    }
  });
  
  // Setup event listeners
  setupEventListeners();
  
  // Initialize coin selection
  selectCoinOption(1);
});

// Setup user
async function setupUser() {
  if (!currentUser) return;
  
  const userRef = db.ref('users/' + currentUser.uid);
  
  // Listen for user data changes
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
      // Create new user - NO FREE COINS
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
        createdAt: Date.now()
      });
    }
  });
}

// Update UI
function updateUI() {
  // Show logged in menu
  document.getElementById('guest-menu').style.display = 'none';
  document.getElementById('logged-in-menu').style.display = 'block';
  
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
    console.log('🔄 Availability toggle set to:', toggle.checked);
  }
}

// FIXED: Toggle availability
window.toggleAvailability = async function() {
  if (!currentUser) {
    showNotification('Please login first', true);
    return;
  }
  
  const toggle = document.getElementById('availability-toggle');
  const isAvailable = toggle.checked;
  
  console.log('🔄 Toggling availability to:', isAvailable);
  
  try {
    await db.ref('users/' + currentUser.uid).update({
      isAvailable: isAvailable,
      isWhisper: isAvailable
    });
    
    showNotification(isAvailable ? '✅ You are now available to receive calls' : '⏸️ You are now unavailable');
    
    // Reload profiles to reflect availability
    loadProfiles();
    
  } catch (error) {
    console.log('Toggle error:', error);
    showNotification('Failed to update availability', true);
  }
};

// Show guest UI
function showGuestUI() {
  document.getElementById('guest-menu').style.display = 'block';
  document.getElementById('logged-in-menu').style.display = 'none';
}

// FIXED: Load profiles from Firebase
async function loadProfiles() {
  console.log('🔍 Loading profiles...');
  
  try {
    const snapshot = await db.ref('users').once('value');
    const profiles = [];
    
    snapshot.forEach(child => {
      const user = child.val();
      // Only show users who are available and have a bio
      if (user.bio && child.key !== currentUser?.uid && user.isAvailable === true) {
        profiles.push({
          id: child.key,
          name: user.bio.split(' ').slice(0, 2).join(' ') || 'Anonymous',
          bio: user.bio,
          photo: user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.bio.split(' ')[0] || 'User'),
          price: user.pricePerCall || 1,
          social: user.social || {},
          rating: user.rating || 5.0,
          calls: user.callsCompleted || 0,
          isAvailable: user.isAvailable || false
        });
      }
    });
    
    console.log(`📊 Found ${profiles.length} available profiles from Firebase`);
    
    // Add demo profiles if no real profiles
    if (profiles.length === 0) {
      console.log('📱 Using demo profiles');
      profiles.push(...DEMO_PROFILES);
    }
    
    displayProfiles(profiles);
    
  } catch (error) {
    console.log('Error loading profiles:', error);
    // Show demo profiles if error
    displayProfiles(DEMO_PROFILES);
  }
}

// Display profiles
function displayProfiles(profiles) {
  const container = document.getElementById('profiles-container');
  if (!container) return;
  
  if (profiles.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #888;">
        <i class="fas fa-users" style="font-size: 3rem; margin-bottom: 1rem;"></i>
        <p>No whispers available at the moment</p>
        <p style="font-size: 0.9rem;">Become a whisper by enabling availability in your dashboard</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = '';
  
  profiles.forEach(profile => {
    const card = document.createElement('div');
    card.className = 'profile-card';
    card.onclick = () => viewProfile(profile.id);
    card.innerHTML = `
      <div class="profile-header">
        <img src="${profile.photo}" alt="${profile.name}" class="profile-img" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name)}'">
        <div class="profile-info">
          <h3>${profile.name}</h3>
          <div class="profile-price">${profile.price} Coin${profile.price > 1 ? 's' : ''}</div>
        </div>
      </div>
      <p class="profile-bio">${profile.bio.substring(0, 80)}${profile.bio.length > 80 ? '...' : ''}</p>
      <button class="btn btn-primary" onclick="event.stopPropagation(); viewProfile('${profile.id}')" style="width: 100%;">
        <i class="fas fa-phone-alt"></i> Call
      </button>
    `;
    container.appendChild(card);
  });
  
  // Update shuffle profiles
  shuffleProfiles = profiles;
  if (!shuffleTimer) {
    startShuffleMode();
  }
}

// SHUFFLE MODE FUNCTIONS
function startShuffleMode() {
  console.log('🎲 Starting shuffle mode...');
  
  // Clear existing timer
  if (shuffleTimer) {
    clearInterval(shuffleTimer);
  }
  
  // Start with first profile
  updateShuffleProfile();
  
  // Start countdown timer
  startCountdown();
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
  if (shuffleProfiles.length === 0) {
    console.log('No profiles to shuffle');
    return;
  }
  
  currentShuffleIndex = (currentShuffleIndex + 1) % shuffleProfiles.length;
  updateShuffleProfile();
  countdown = 30;
  document.getElementById('countdown').textContent = countdown;
};

function updateShuffleProfile() {
  if (shuffleProfiles.length === 0) {
    console.log('No profiles available for shuffle');
    return;
  }
  
  const profile = shuffleProfiles[currentShuffleIndex];
  
  document.getElementById('shuffle-img').src = profile.photo;
  document.getElementById('shuffle-name').textContent = profile.name;
  document.getElementById('shuffle-price').textContent = profile.price + ' Coin' + (profile.price > 1 ? 's' : '');
  document.getElementById('shuffle-bio').textContent = profile.bio;
  
  // Store for call
  selectedProfile = profile;
}

window.startCallFromShuffle = function() {
  if (!currentUser) {
    showAuthModal('login');
    showNotification('Please login to make calls', true);
    return;
  }
  
  if (!selectedProfile) {
    showNotification('No profile selected', true);
    return;
  }
  
  startCall();
};

// View profile modal
window.viewProfile = function(profileId) {
  if (!currentUser) {
    showAuthModal('login');
    showNotification('Please login to view profiles', true);
    return;
  }
  
  // Find profile
  const profile = DEMO_PROFILES.find(p => p.id === profileId) || 
                  shuffleProfiles.find(p => p.id === profileId);
  
  if (!profile) {
    showNotification('Profile not found', true);
    return;
  }
  
  selectedProfile = profile;
  
  // Update modal
  document.getElementById('modal-profile-img').src = profile.photo;
  document.getElementById('modal-profile-name').textContent = profile.name;
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
  
  // Show modal
  showModal('profile-modal');
};

// FIXED: Save profile function - NOW WORKING
window.saveProfile = async function() {
  console.log('💾 Attempting to save profile...');
  
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
  
  // Validate required fields
  if (!bio) {
    showNotification('Please enter a bio for your profile', true);
    return;
  }
  
  // Validate price (1-3 coins)
  if (price < 1 || price > 3) {
    showNotification('Price must be between 1-3 coins', true);
    return;
  }
  
  // Check if price changed and user can change it
  const priceChanged = price !== userData.pricePerCall;
  if (priceChanged && !canChangePrice()) {
    showNotification('You can only change your price once per day', true);
    return;
  }
  
  // Prepare updates
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
  
  console.log('💾 Saving profile updates:', updates);
  
  try {
    // Save to Firebase
    await db.ref('users/' + currentUser.uid).update(updates);
    
    console.log('✅ Profile saved successfully to Firebase');
    showNotification('✅ Profile saved successfully!');
    
    // Close modal IMMEDIATELY
    closeModal('dashboard-modal');
    
    // Update local data
    userData = { ...userData, ...updates };
    updateUI();
    
    // Reload profiles after a short delay
    setTimeout(() => {
      console.log('🔄 Reloading profiles after save...');
      loadProfiles();
    }, 1000);
    
  } catch (error) {
    console.error('❌ Save error:', error);
    showNotification('Failed to save profile: ' + error.message, true);
  }
};

// Helper function to check if user can change price
function canChangePrice() {
  if (!userData.lastPriceChange) return true;
  
  const now = Date.now();
  const lastChange = userData.lastPriceChange;
  const oneDay = 24 * 60 * 60 * 1000;
  
  return (now - lastChange) >= oneDay;
}

// FIXED: Profile photo upload
document.addEventListener('DOMContentLoaded', function() {
  const photoInput = document.getElementById('profile-photo');
  if (photoInput) {
    photoInput.addEventListener('change', async function(e) {
      if (!currentUser) {
        showNotification('Please login first', true);
        return;
      }
      
      const file = e.target.files[0];
      if (!file) return;
      
      if (!file.type.startsWith('image/')) {
        showNotification('Please upload an image file (JPEG, PNG, etc.)', true);
        return;
      }
      
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        showNotification('File size must be less than 5MB', true);
        return;
      }
      
      showNotification('📤 Uploading photo...');
      
      try {
        // Create a unique filename
        const timestamp = Date.now();
        const fileExtension = file.name.split('.').pop();
        const fileName = `${currentUser.uid}_${timestamp}.${fileExtension}`;
        
        const storageRef = storage.ref('profile-photos/' + fileName);
        const snapshot = await storageRef.put(file);
        const downloadURL = await snapshot.ref.getDownloadURL();
        
        // Update user profile with photo URL
        await db.ref('users/' + currentUser.uid).update({ 
          photoURL: downloadURL 
        });
        
        // Show preview
        document.getElementById('photo-preview').innerHTML = `
          <img src="${downloadURL}" style="width: 100px; height: 100px; border-radius: 8px; object-fit: cover; margin-top: 0.5rem;">
          <p style="color: #10b981; margin-top: 0.5rem; font-size: 0.9rem;">Photo uploaded successfully!</p>
        `;
        
        showNotification('✅ Photo uploaded successfully!');
        
      } catch (error) {
        console.log('Upload error:', error);
        showNotification('Failed to upload photo: ' + error.message, true);
      }
    });
  }
});

// Start call function
window.startCall = function() {
  if (!selectedProfile) {
    showNotification('No profile selected', true);
    return;
  }
  
  if (!currentUser) {
    showAuthModal('login');
    return;
  }
  
  const callPrice = selectedProfile.price;
  
  // Check if user has enough coins
  if (userData.coins < callPrice) {
    showNotification(`You need ${callPrice} coin${callPrice > 1 ? 's' : ''} to call`, true);
    showNotification('Please buy more coins from the coins section', true);
    return;
  }
  
  // Close profile modal
  closeModal('profile-modal');
  
  // Show call interface
  showNotification('Starting call with ' + selectedProfile.name + '...');
  
  // In production, you would start the actual Agora call here
  // For demo, we'll simulate the call
  simulateCall(callPrice);
};

function simulateCall(callPrice) {
  // Simulate call process
  setTimeout(() => {
    showNotification('🔊 Call connected! Timer started (5 minutes)');
    
    // Deduct coins
    db.ref('users/' + currentUser.uid).update({
      coins: userData.coins - callPrice
    });
    
    // Simulate call completion after 3 seconds (demo)
    setTimeout(() => {
      showNotification('✅ Call completed! Rating modal will appear.');
      
      // Show rating modal
      setTimeout(() => {
        showModal('rating-modal');
      }, 1000);
    }, 3000);
  }, 2000);
}

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
  
  // Hide all forms
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
    showNotification('Login failed: ' + error.message, true);
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
    showNotification('Signup failed: ' + error.message, true);
  }
};

// Logout function
window.logout = async function() {
  try {
    // End any active call
    if (activeCall) {
      endCallCleanup();
    }
    
    // Stop shuffle timer
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

// Hide loading
function hideLoading() {
  document.getElementById('loading-screen').style.display = 'none';
}

// Show notification
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

// Setup event listeners
function setupEventListeners() {
  // Close modals when clicking outside
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', function(e) {
      if (e.target === this) {
        this.style.display = 'none';
      }
    });
  });
  
  // Enter key in auth forms
  document.getElementById('login-password')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') login();
  });
  
  document.getElementById('signup-confirm')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') signup();
  });
}

// Coin purchase functions
window.selectCoinOption = function(coins) {
  selectedCoinOption = coins;
  
  // Update UI
  document.querySelectorAll('.coin-option').forEach(option => {
    option.classList.remove('selected');
  });
  
  // Find and select clicked option
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
    // Simulate Stripe payment
    setTimeout(async () => {
      await db.ref('users/' + currentUser.uid).update({
        coins: (userData.coins || 0) + selectedCoinOption
      });
      
      // Record purchase
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
    showNotification('Payment failed: ' + error.message, true);
  }
};

// Rating functions
window.setRating = function(rating) {
  currentRating = rating;
  
  // Update stars
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
  
  // Save rating (simulated)
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

console.log('✅ Whisper+me FIXED and ready with iPhone design!');
