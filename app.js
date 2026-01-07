/**************************************************
 * Whisper+me — STABLE PRODUCTION VERSION
 * All buttons working, proper error handling
 **************************************************/

console.log('🚀 Whisper+me Production v2.2 - ALL BUTTONS WORKING');

// Global state
const STATE = {
  user: null,
  userData: {},
  profiles: [],
  shuffleIndex: 0,
  selectedProfile: null,
  selectedCoins: 1,
  currentCall: null,
  callTimer: null,
  ratingStars: 0,
  isInitialized: false
};

// Core application object
window.App = {
  // UI Functions
  UI: {
    showModal: function(id) {
      const modal = document.getElementById(id);
      if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      }
    },
    
    closeModal: function(id) {
      const modal = document.getElementById(id);
      if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
      }
    },
    
    showNotification: function(msg, isError = false) {
      let notification = document.getElementById('notification');
      if (!notification) {
        notification = document.createElement('div');
        notification.id = 'notification';
        notification.className = 'notification';
        document.body.appendChild(notification);
      }
      
      notification.textContent = msg;
      notification.className = `notification show ${isError ? 'error' : ''}`;
      
      setTimeout(() => {
        notification.classList.remove('show');
      }, 3000);
    }
  },

  // Auth Functions
  showAuthModal: function(type) {
    const title = document.getElementById('auth-modal-title');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    
    if (!title || !loginForm || !signupForm) {
      console.error('Auth modal elements not found');
      return;
    }
    
    if (type === 'login') {
      title.textContent = 'Login to Whisper+me';
      loginForm.style.display = 'block';
      signupForm.style.display = 'none';
    } else {
      title.textContent = 'Sign Up for Whisper+me';
      loginForm.style.display = 'none';
      signupForm.style.display = 'block';
    }
    
    this.UI.showModal('auth-modal');
  },

  login: async function() {
    const email = document.getElementById('login-email')?.value;
    const password = document.getElementById('login-password')?.value;
    
    if (!email || !password) {
      this.UI.showNotification('Please enter email and password', true);
      return;
    }
    
    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      this.UI.closeModal('auth-modal');
      this.UI.showNotification('Login successful!');
    } catch (error) {
      this.UI.showNotification(error.message, true);
    }
  },

  signup: async function() {
    const email = document.getElementById('signup-email')?.value;
    const password = document.getElementById('signup-password')?.value;
    const confirm = document.getElementById('signup-confirm')?.value;
    
    if (!email || !password) {
      this.UI.showNotification('Please enter email and password', true);
      return;
    }
    
    if (password !== confirm) {
      this.UI.showNotification('Passwords do not match', true);
      return;
    }
    
    if (password.length < 6) {
      this.UI.showNotification('Password must be at least 6 characters', true);
      return;
    }
    
    try {
      const result = await firebase.auth().createUserWithEmailAndPassword(email, password);
      
      // Create user profile
      await firebase.database().ref('users/' + result.user.uid).set({
        uid: result.user.uid,
        email: email,
        displayName: email.split('@')[0],
        coins: 10,
        isWhisper: false,
        isAvailable: false,
        rating: 5.0,
        callsCompleted: 0,
        earnings: 0,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      });
      
      this.UI.closeModal('auth-modal');
      this.UI.showNotification('Account created! You received 10 free coins!');
    } catch (error) {
      this.UI.showNotification(error.message, true);
    }
  },

  logout: async function() {
    try {
      await firebase.auth().signOut();
      this.UI.showNotification('Logged out successfully');
    } catch (error) {
      this.UI.showNotification('Logout failed', true);
    }
  },

  // Profile Functions
  showDashboard: function() {
    if (!STATE.user) {
      this.showAuthModal('login');
      return;
    }
    this.UI.showModal('dashboard-modal');
  },

  updateDisplayName: function() {
    const name = prompt('Enter new display name:', STATE.userData.displayName || '');
    if (name && name.trim()) {
      this.updateUserProfile({ displayName: name.trim() });
    }
  },

  updateEmail: function() {
    const email = prompt('Enter new email:', STATE.user.email || '');
    if (email && email.trim()) {
      STATE.user.updateEmail(email).then(() => {
        this.updateUserProfile({ email: email.trim() });
        this.UI.showNotification('Email updated successfully');
      }).catch(error => {
        this.UI.showNotification(error.message, true);
      });
    }
  },

  updatePassword: function() {
    const password = prompt('Enter new password:', '');
    if (password && password.length >= 6) {
      STATE.user.updatePassword(password).then(() => {
        this.UI.showNotification('Password updated successfully');
      }).catch(error => {
        this.UI.showNotification(error.message, true);
      });
    } else {
      this.UI.showNotification('Password must be at least 6 characters', true);
    }
  },

  resetPassword: function() {
    const email = STATE.user.email;
    if (email) {
      firebase.auth().sendPasswordResetEmail(email).then(() => {
        this.UI.showNotification('Password reset email sent to ' + email);
      }).catch(error => {
        this.UI.showNotification(error.message, true);
      });
    }
  },

  updateUserProfile: async function(updates) {
    try {
      await firebase.database().ref('users/' + STATE.user.uid).update({
        ...updates,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      });
      await loadUserData();
      this.UI.showNotification('Profile updated');
    } catch (error) {
      this.UI.showNotification(error.message, true);
    }
  },

  // Profile Management
  saveProfile: async function() {
    if (!STATE.user) return;
    
    const updates = {
      bio: document.getElementById('profile-bio')?.value || '',
      photoURL: document.getElementById('profile-photo')?.value || '',
      paypalEmail: document.getElementById('paypal-email')?.value || '',
      twitter: document.getElementById('profile-twitter')?.value || '',
      instagram: document.getElementById('profile-instagram')?.value || '',
      tiktok: document.getElementById('profile-tiktok')?.value || '',
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    };
    
    try {
      await firebase.database().ref('users/' + STATE.user.uid).update(updates);
      this.UI.showNotification('Profile saved!');
      this.UI.closeModal('dashboard-modal');
      await loadUserData();
      await loadPublicProfiles();
      await loadAllProfiles();
    } catch (error) {
      this.UI.showNotification('Error saving profile: ' + error.message, true);
    }
  },

  previewProfilePic: function() {
    const url = document.getElementById('profile-photo')?.value || '';
    const preview = document.getElementById('profile-pic-preview');
    
    if (preview) {
      if (url) {
        preview.src = url;
        preview.style.display = 'block';
        preview.onerror = function() {
          preview.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(STATE.userData.displayName || STATE.user.email)}&background=7c3aed&color=fff`;
        };
      } else {
        preview.style.display = 'none';
      }
    }
  },

  uploadProfilePic: function() {
    // Create a file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    
    fileInput.onchange = async function(e) {
      const file = e.target.files[0];
      if (!file) return;
      
      if (!file.type.match('image.*')) {
        App.UI.showNotification('Please select an image file', true);
        return;
      }
      
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        App.UI.showNotification('Image must be less than 5MB', true);
        return;
      }
      
      try {
        App.UI.showNotification('Uploading image...');
        
        // Create a storage reference
        const storage = firebase.storage();
        const storageRef = storage.ref();
        const fileRef = storageRef.child(`profile_pictures/${STATE.user.uid}/${Date.now()}_${file.name}`);
        
        // Upload the file
        const snapshot = await fileRef.put(file);
        
        // Get download URL
        const downloadURL = await snapshot.ref.getDownloadURL();
        
        // Update profile photo field
        const photoInput = document.getElementById('profile-photo');
        if (photoInput) {
          photoInput.value = downloadURL;
          App.previewProfilePic();
        }
        
        App.UI.showNotification('Image uploaded successfully!');
        
      } catch (error) {
        console.error('Upload error:', error);
        App.UI.showNotification('Upload failed: ' + error.message, true);
      }
    };
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  },

  // Coin Functions
  selectCoinOption: function(amount) {
    STATE.selectedCoins = amount;
    
    // Update UI
    document.querySelectorAll('.coin-option').forEach(opt => {
      opt.classList.remove('selected');
    });
    
    // Find and select the clicked option
    const options = document.querySelectorAll('.coin-option');
    options.forEach(opt => {
      const coinAmount = parseInt(opt.querySelector('.coin-amount').textContent);
      if (coinAmount === amount) {
        opt.classList.add('selected');
      }
    });
  },

  buyCoins: async function() {
    if (!STATE.user) {
      this.showAuthModal('login');
      return;
    }
    
    try {
      const functions = firebase.functions();
      const createCheckout = functions.httpsCallable('createCheckout');
      
      this.UI.showNotification('Processing payment...');
      
      const result = await createCheckout({ amount: STATE.selectedCoins * 1500 });
      
      if (result.data && result.data.url) {
        window.open(result.data.url, '_blank');
      } else {
        this.UI.showNotification('Payment setup failed', true);
      }
    } catch (error) {
      this.UI.showNotification('Payment error: ' + error.message, true);
    }
  },

  // Call Functions
  startCall: async function() {
    if (!STATE.selectedProfile) {
      this.UI.showNotification('Please select a whisper first', true);
      return;
    }
    await this.startCallFromProfile(STATE.selectedProfile.uid);
  },

  startCallFromProfile: async function(whisperId) {
    if (!STATE.user) {
      this.showAuthModal('login');
      return;
    }
    
    // Check coins
    if (!STATE.userData.coins || STATE.userData.coins < 1) {
      this.UI.showNotification('Not enough coins. Please buy coins first.', true);
      return;
    }
    
    try {
      const functions = firebase.functions();
      const startCall = functions.httpsCallable('startCall');
      
      this.UI.showNotification('Starting call...');
      
      const result = await startCall({ whisperId: whisperId });
      
      if (result.data && result.data.callId) {
        STATE.currentCall = {
          id: result.data.callId,
          whisperId: whisperId,
          status: 'ringing',
          startTime: Date.now()
        };
        
        // Show call interface
        this.showCallInterface('ringing');
        
        // Listen for call updates
        listenForCallUpdates(result.data.callId);
        
        this.UI.showNotification('Call ringing... Waiting for answer');
      }
    } catch (error) {
      this.UI.showNotification('Call failed: ' + error.message, true);
    }
  },

  startCallFromModal: function() {
    this.startCall();
  },

  // Call Interface
  showCallInterface: function(status) {
    const interfaceEl = document.getElementById('call-interface');
    const statusEl = document.getElementById('call-status');
    
    if (interfaceEl) {
      interfaceEl.style.display = 'block';
    }
    
    if (statusEl) {
      statusEl.textContent = status === 'ringing' ? 'Ringing...' :
                           status === 'accepted' ? 'Call Accepted' :
                           status === 'active' ? 'Call Active' : 'Call Ended';
      statusEl.className = `call-status ${status}`;
    }
  },

  endCall: async function() {
    if (!STATE.currentCall) return;
    
    try {
      const functions = firebase.functions();
      const endCall = functions.httpsCallable('endCall');
      
      await endCall({ callId: STATE.currentCall.id });
      
      // Clear timer
      if (STATE.callTimer) {
        clearInterval(STATE.callTimer);
        STATE.callTimer = null;
      }
      
      // Hide interface
      const interfaceEl = document.getElementById('call-interface');
      if (interfaceEl) interfaceEl.style.display = 'none';
      
      // Show rating modal if call was active
      if (STATE.currentCall.status === 'active') {
        setTimeout(() => {
          this.UI.showModal('rating-modal');
        }, 1000);
      }
      
      STATE.currentCall = null;
      this.UI.showNotification('Call ended');
    } catch (error) {
      this.UI.showNotification('Error ending call: ' + error.message, true);
    }
  },

  // Rating Functions
  setRating: function(stars) {
    STATE.ratingStars = stars;
    
    // Update star display
    const starElements = document.querySelectorAll('#rating-stars i');
    starElements.forEach((star, index) => {
      if (index < stars) {
        star.style.color = '#fbbf24';
      } else {
        star.style.color = '#666';
      }
    });
  },

  submitRating: async function() {
    if (!STATE.currentCall || STATE.ratingStars === 0) {
      this.UI.showNotification('Please select a rating', true);
      return;
    }
    
    const comment = document.getElementById('rating-comment')?.value || '';
    
    try {
      // Save rating to database
      await firebase.database().ref('ratings').push({
        callId: STATE.currentCall.id,
        userId: STATE.user.uid,
        whisperId: STATE.currentCall.whisperId,
        rating: STATE.ratingStars,
        comment: comment,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      });
      
      this.UI.showNotification('Thank you for your rating!');
      this.UI.closeModal('rating-modal');
      
      // Reset
      STATE.ratingStars = 0;
      if (document.getElementById('rating-comment')) {
        document.getElementById('rating-comment').value = '';
      }
      
      // Reset stars
      const starElements = document.querySelectorAll('#rating-stars i');
      starElements.forEach(star => {
        star.style.color = '#666';
      });
    } catch (error) {
      this.UI.showNotification('Failed to submit rating', true);
    }
  },

  // Admin Functions
  checkAdminAccess: function() {
    const adminBtn = document.getElementById('admin-login-btn');
    if (adminBtn && STATE.user) {
      adminBtn.style.display = 'block';
      adminBtn.onclick = async () => {
        try {
          // Navigate to admin page
          window.location.href = 'admin.html';
        } catch (error) {
          this.UI.showNotification('Admin access error: ' + error.message, true);
        }
      };
    }
  },

  // Shuffle Functions
  nextShuffleProfile: function() {
    if (!STATE.profiles.length) return;
    
    STATE.shuffleIndex = (STATE.shuffleIndex + 1) % STATE.profiles.length;
    STATE.selectedProfile = STATE.profiles[STATE.shuffleIndex];
    updateShuffleCard();
  },

  // Share Functions
  shareProfile: function() {
    if (!STATE.selectedProfile) return;
    
    const profileUrl = window.location.origin + '?profile=' + STATE.selectedProfile.uid;
    const shareText = `Chat with ${STATE.selectedProfile.displayName} on Whisper+me - Live Anonymous Audio Chat`;
    
    if (navigator.share) {
      navigator.share({
        title: 'Whisper+me Profile',
        text: shareText,
        url: profileUrl
      }).catch(() => {
        // Share cancelled or failed
      });
    } else {
      navigator.clipboard.writeText(profileUrl).then(() => {
        this.UI.showNotification('Profile link copied to clipboard!');
      });
    }
  },

  // Availability Toggle
  toggleAvailability: async function() {
    if (!STATE.user) return;
    
    const toggle = document.getElementById('availability-toggle');
    const isAvailable = toggle ? toggle.checked : false;
    
    try {
      await firebase.database().ref('users/' + STATE.user.uid).update({
        isAvailable: isAvailable,
        isWhisper: isAvailable
      });
      
      this.UI.showNotification(isAvailable ? 'You are now available as a Whisper!' : 'You are now unavailable');
      await loadUserData();
      await loadPublicProfiles();
      await loadAllProfiles();
    } catch (error) {
      this.UI.showNotification('Failed to update availability', true);
      if (toggle) toggle.checked = !isAvailable;
    }
  }
};

/* ================= HELPER FUNCTIONS ================= */

async function loadUserData() {
  if (!STATE.user) return;
  
  try {
    const snapshot = await firebase.database().ref('users/' + STATE.user.uid).once('value');
    STATE.userData = snapshot.val() || {};
    
    // Update UI
    const coinsEl = document.getElementById('coins-count');
    if (coinsEl) coinsEl.textContent = STATE.userData.coins || 0;
    
    // Update dashboard
    const dashEmail = document.getElementById('dash-email');
    const dashUserId = document.getElementById('dash-user-id');
    const dashProfilePic = document.getElementById('dash-profile-pic');
    
    if (dashEmail) dashEmail.textContent = STATE.userData.email || STATE.user.email;
    if (dashUserId) dashUserId.textContent = STATE.user.uid ? `ID: ${STATE.user.uid.substring(0, 8)}...` : '';
    
    // Profile picture
    const profilePicUrl = STATE.userData.photoURL || 
      `https://ui-avatars.com/api/?name=${encodeURIComponent(STATE.userData.displayName || STATE.user.email)}&background=7c3aed&color=fff`;
    
    if (dashProfilePic) {
      dashProfilePic.src = profilePicUrl;
      dashProfilePic.onerror = function() {
        this.src = `https://ui-avatars.com/api/?name=User&background=7c3aed&color=fff`;
      };
    }
    
    // Update dashboard inputs
    const updateInput = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value || '';
    };
    
    updateInput('profile-bio', STATE.userData.bio);
    updateInput('profile-photo', STATE.userData.photoURL);
    updateInput('paypal-email', STATE.userData.paypalEmail);
    updateInput('profile-twitter', STATE.userData.twitter);
    updateInput('profile-instagram', STATE.userData.instagram);
    updateInput('profile-tiktok', STATE.userData.tiktok);
    
    // Update availability toggle
    const toggle = document.getElementById('availability-toggle');
    if (toggle) {
      toggle.checked = STATE.userData.isAvailable || false;
    }
    
    // Update profile preview
    App.previewProfilePic();
    
  } catch (error) {
    console.error('Error loading user data:', error);
  }
}

async function loadPublicProfiles() {
  try {
    const snapshot = await firebase.database().ref('users').once('value');
    STATE.profiles = [];
    
    snapshot.forEach(child => {
      const profile = child.val();
      if (profile && profile.uid && profile.uid !== STATE.user?.uid && profile.isWhisper && profile.isAvailable) {
        STATE.profiles.push(profile);
      }
    });
    
    console.log(`Loaded ${STATE.profiles.length} public profiles`);
    
    if (STATE.profiles.length > 0) {
      STATE.shuffleIndex = 0;
      STATE.selectedProfile = STATE.profiles[0];
      updateShuffleCard();
    } else {
      // Show default message
      updateEmptyShuffleCard();
    }
    
  } catch (error) {
    console.error('Error loading profiles:', error);
    updateEmptyShuffleCard();
  }
}

function updateShuffleCard() {
  if (!STATE.selectedProfile || !STATE.selectedProfile.uid) {
    updateEmptyShuffleCard();
    return;
  }
  
  const profile = STATE.selectedProfile;
  const nameEl = document.getElementById('shuffle-name');
  const bioEl = document.getElementById('shuffle-bio');
  const imgEl = document.getElementById('shuffle-img');
  const priceEl = document.getElementById('shuffle-price');
  const idEl = document.getElementById('shuffle-id');
  
  if (nameEl) nameEl.textContent = profile.displayName || 'User';
  if (bioEl) bioEl.textContent = profile.bio || 'No bio available';
  if (priceEl) priceEl.textContent = '1 Coin';
  if (idEl) idEl.textContent = `ID: ${profile.uid.substring(0, 8)}...`;
  
  // Profile picture
  const profilePicUrl = profile.photoURL || 
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.displayName || 'User')}&background=7c3aed&color=fff`;
  
  if (imgEl) {
    imgEl.src = profilePicUrl;
    imgEl.onerror = function() {
      this.src = `https://ui-avatars.com/api/?name=User&background=7c3aed&color=fff`;
    };
  }
}

function updateEmptyShuffleCard() {
  const nameEl = document.getElementById('shuffle-name');
  const bioEl = document.getElementById('shuffle-bio');
  const imgEl = document.getElementById('shuffle-img');
  const priceEl = document.getElementById('shuffle-price');
  const idEl = document.getElementById('shuffle-id');
  
  if (nameEl) nameEl.textContent = 'No whispers available';
  if (bioEl) bioEl.textContent = 'Check back later or become a whisper yourself!';
  if (priceEl) priceEl.textContent = '0 Coins';
  if (idEl) idEl.textContent = 'ID: N/A';
  
  if (imgEl) {
    imgEl.src = 'https://ui-avatars.com/api/?name=No+Users&background=666&color=fff';
  }
}

async function loadAllProfiles() {
  try {
    const snapshot = await firebase.database().ref('users').once('value');
    const container = document.getElementById('profiles-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    let hasProfiles = false;
    snapshot.forEach(child => {
      const profile = child.val();
      if (profile && profile.uid && profile.uid !== STATE.user?.uid && profile.isWhisper && profile.isAvailable) {
        createProfileCard(profile, container);
        hasProfiles = true;
      }
    });
    
    if (!hasProfiles) {
      container.innerHTML = `
        <div class="no-profiles">
          <i class="fas fa-users-slash fa-3x" style="color: #666; margin-bottom: 1rem;"></i>
          <h3 style="color: #888; margin-bottom: 0.5rem;">No whispers available</h3>
          <p style="color: #666;">Be the first to become a whisper!</p>
          <button class="btn btn-primary" onclick="App.toggleAvailability()" style="margin-top: 1rem;">
            <i class="fas fa-microphone-alt"></i> Become a Whisper
          </button>
        </div>
      `;
    }
    
  } catch (error) {
    console.error('Error loading all profiles:', error);
    const container = document.getElementById('profiles-container');
    if (container) {
      container.innerHTML = '<p class="text-center text-muted">Error loading profiles. Please refresh.</p>';
    }
  }
}

function createProfileCard(profile, container) {
  const card = document.createElement('div');
  card.className = 'profile-card';
  
  const safeUid = profile.uid || 'unknown';
  const safeDisplayName = profile.displayName || 'User';
  
  const profilePicUrl = profile.photoURL || 
    `https://ui-avatars.com/api/?name=${encodeURIComponent(safeDisplayName)}&background=7c3aed&color=fff`;
  
  card.innerHTML = `
    <div class="profile-header">
      <img src="${profilePicUrl}" alt="${safeDisplayName}" class="profile-img"
           onerror="this.src='https://ui-avatars.com/api/?name=User&background=7c3aed&color=fff'">
      <div class="profile-info">
        <h3>${safeDisplayName}</h3>
        <div class="profile-price">1 Coin</div>
        <div class="whisper-id-small">ID: ${safeUid.substring(0, 8)}...</div>
        <div class="availability-indicator">
          <span class="availability-dot"></span>
          <span>Available</span>
        </div>
      </div>
    </div>
    <p class="profile-bio">${profile.bio || 'No bio available'}</p>
    <div class="profile-social-links">
      ${profile.twitter ? `<a href="${profile.twitter}" target="_blank" class="social-link-small"><i class="fab fa-twitter"></i></a>` : ''}
      ${profile.instagram ? `<a href="${profile.instagram}" target="_blank" class="social-link-small"><i class="fab fa-instagram"></i></a>` : ''}
      ${profile.tiktok ? `<a href="${profile.tiktok}" target="_blank" class="social-link-small"><i class="fab fa-tiktok"></i></a>` : ''}
    </div>
    <button class="btn btn-primary" onclick="App.startCallFromProfile('${safeUid}')" style="width: 100%; margin-top: 10px;">
      <i class="fas fa-phone-alt"></i> Call Now (1 Coin)
    </button>
  `;
  
  // Add click to open modal
  card.addEventListener('click', (e) => {
    if (!e.target.closest('button')) {
      showProfileModal(profile);
    }
  });
  
  container.appendChild(card);
}

function showProfileModal(profile) {
  const modalImg = document.getElementById('modal-profile-img');
  const modalName = document.getElementById('modal-profile-name');
  const modalBio = document.getElementById('modal-profile-bio');
  const modalId = document.getElementById('modal-profile-id');
  const socialLinks = document.getElementById('modal-social-links');
  
  if (!profile) return;
  
  const profilePicUrl = profile.photoURL || 
    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.displayName || 'User')}&background=7c3aed&color=fff`;
  
  if (modalImg) {
    modalImg.src = profilePicUrl;
    modalImg.onerror = function() {
      this.src = `https://ui-avatars.com/api/?name=User&background=7c3aed&color=fff`;
    };
  }
  
  if (modalName) modalName.textContent = profile.displayName || 'User';
  if (modalBio) modalBio.textContent = profile.bio || 'No bio available';
  if (modalId) modalId.textContent = `ID: ${profile.uid || 'unknown'}`;
  
  if (socialLinks) {
    let html = '';
    if (profile.twitter) html += `<a href="${profile.twitter}" target="_blank" class="modal-social-link"><i class="fab fa-twitter"></i></a>`;
    if (profile.instagram) html += `<a href="${profile.instagram}" target="_blank" class="modal-social-link"><i class="fab fa-instagram"></i></a>`;
    if (profile.tiktok) html += `<a href="${profile.tiktok}" target="_blank" class="modal-social-link"><i class="fab fa-tiktok"></i></a>`;
    socialLinks.innerHTML = html;
  }
  
  // Store selected profile
  STATE.selectedProfile = profile;
  
  App.UI.showModal('profile-modal');
}

function listenForCallUpdates(callId) {
  firebase.database().ref('calls/' + callId).on('value', snapshot => {
    const call = snapshot.val();
    if (!call) return;
    
    STATE.currentCall = { ...STATE.currentCall, ...call };
    
    if (call.status === 'accepted') {
      App.showCallInterface('accepted');
      App.UI.showNotification('Call accepted! Mic will start soon...');
    } else if (call.status === 'active') {
      App.showCallInterface('active');
      startCallTimer();
      App.UI.showNotification('Call active! Timer started.');
    } else if (call.status === 'ended') {
      App.endCall();
    }
  });
}

function startCallTimer() {
  const timerEl = document.getElementById('call-timer');
  if (!timerEl) return;
  
  let seconds = 300; // 5 minutes
  
  STATE.callTimer = setInterval(() => {
    seconds--;
    
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    
    if (seconds <= 0) {
      clearInterval(STATE.callTimer);
      App.endCall();
    }
  }, 1000);
}

/* ================= INITIALIZATION ================= */

document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ App initialized');
  
  // Time display
  setInterval(() => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.querySelectorAll('#current-time, #call-time').forEach(el => {
      if (el) el.textContent = timeStr;
    });
  }, 1000);
  
  // Hide loading screen
  setTimeout(() => {
    const loading = document.getElementById('loading-screen');
    if (loading) loading.style.display = 'none';
  }, 1000);
  
  // Auth state listener
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      console.log('User authenticated:', user.email);
      STATE.user = user;
      await loadUserData();
      await loadPublicProfiles();
      await loadAllProfiles();
      
      // Show logged in menu
      const guestMenu = document.getElementById('guest-menu');
      const loggedInMenu = document.getElementById('logged-in-menu');
      if (guestMenu) guestMenu.style.display = 'none';
      if (loggedInMenu) loggedInMenu.style.display = 'flex';
      
      // Check admin access
      App.checkAdminAccess();
    } else {
      console.log('User not authenticated');
      STATE.user = null;
      STATE.userData = {};
      
      // Show guest menu
      const guestMenu = document.getElementById('guest-menu');
      const loggedInMenu = document.getElementById('logged-in-menu');
      if (guestMenu) guestMenu.style.display = 'block';
      if (loggedInMenu) loggedInMenu.style.display = 'none';
    }
  });
  
  // Initialize coin selection
  App.selectCoinOption(1);
  
  // Add event listeners for close buttons
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('close-btn') || e.target.closest('.close-btn')) {
      const modal = e.target.closest('.modal-overlay');
      if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
      }
    }
  });
});

// Expose functions for HTML onclick handlers
window.startCall = App.startCall;
window.nextShuffleProfile = App.nextShuffleProfile;
window.closeModal = App.UI.closeModal;

console.log('✅ App.js loaded successfully');
