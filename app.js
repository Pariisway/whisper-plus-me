// Whisper+me Application
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded, initializing app...');
  
  // Show loading screen immediately
  const loadingScreen = document.getElementById('loading-screen');
  const mainContent = document.getElementById('main-content');
  const authBtn = document.getElementById('auth-btn');
  const userProfilePic = document.getElementById('user-profile-pic');
  const tokenBalance = document.getElementById('token-balance');
  
  // Firebase configuration
  const firebaseConfig = {
    apiKey: "AIzaSyALbIJSI2C-p6IyMtj_F0ZqGyN1i79jOd4",
    authDomain: "whisper-chat-live.firebaseapp.com",
    databaseURL: "https://whisper-chat-live-default-rtdb.firebaseio.com",
    projectId: "whisper-chat-live",
    storageBucket: "whisper-chat-live.firebasestorage.app",
    messagingSenderId: "302894848452",
    appId: "1:302894848452:web:61a7ab21a269533c426c91"
  };
  
  console.log('Firebase config loaded');
  
  // Initialize Firebase
  let firebaseInitialized = false;
  try {
    // Check if Firebase is already initialized
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      console.log('Firebase initialized successfully');
    } else {
      firebase.app(); // if already initialized, use that one
      console.log('Firebase already initialized');
    }
    firebaseInitialized = true;
  } catch (error) {
    console.error('Firebase initialization error:', error);
    showMainContent();
    showNotification('Firebase initialization failed. Please check your connection.', true);
    return;
  }
  
  // Get Firebase services
  const auth = firebase.auth();
  const db = firebase.database();
  const storage = firebase.storage();
  
  console.log('Firebase services loaded');
  
  // State management
  let currentUser = null;
  let userData = null;
  let agoraClient = null;
  let localAudioTrack = null;
  let currentCall = null;
  let callTimer = null;
  let timeLeft = 300;
  let currentRating = 0;
  
  // Initialize application
  init();
  
  async function init() {
    console.log('Starting app initialization...');
    
    // Set a timeout to hide loading screen if auth takes too long
    const loadingTimeout = setTimeout(() => {
      console.log('Loading timeout - showing content anyway');
      showMainContent();
    }, 5000);
    
    // Check authentication state
    auth.onAuthStateChanged(async (user) => {
      clearTimeout(loadingTimeout);
      console.log('Auth state changed, user:', user ? 'logged in' : 'not logged in');
      
      if (user) {
        currentUser = user;
        console.log('User UID:', user.uid);
        await loadUserData();
        showMainContent();
        updateUIForLoggedInUser();
        loadAvailableProfiles();
        startUserPresence();
      } else {
        console.log('No user, showing public content');
        showMainContent();
        updateUIForLoggedOutUser();
        loadAvailableProfiles();
      }
    }, (error) => {
      console.error('Auth state change error:', error);
      clearTimeout(loadingTimeout);
      showMainContent();
      showNotification('Authentication error. Please refresh.', true);
    });
    
    // Setup event listeners
    setupEventListeners();
    
    console.log('App initialization complete');
  }
  
  function setupEventListeners() {
    console.log('Setting up event listeners...');
    
    // Auth button
    authBtn.addEventListener('click', () => {
      if (currentUser) {
        showTab('dashboard');
      } else {
        showAuthModal();
      }
    });
    
    // Buy tokens button
    document.getElementById('buy-tokens-btn')?.addEventListener('click', showTokensModal);
    
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.target.getAttribute('data-tab');
        switchTab(tab);
      });
    });
    
    // Close modals
    document.querySelectorAll('.close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        closeAllModals();
      });
    });
    
    console.log('Event listeners setup complete');
  }
  
  // Basic UI Functions (simplified for now)
  function showMainContent() {
    console.log('Showing main content');
    loadingScreen.style.display = 'none';
    mainContent.style.display = 'block';
    document.getElementById('main-footer').style.display = 'block';
  }
  
  function updateUIForLoggedInUser() {
    console.log('Updating UI for logged in user');
    authBtn.textContent = 'Dashboard';
    authBtn.onclick = () => showTab('dashboard');
    
    if (tokenBalance) tokenBalance.style.display = 'flex';
    if (userProfilePic) userProfilePic.style.display = 'block';
  }
  
  function updateUIForLoggedOutUser() {
    console.log('Updating UI for logged out user');
    authBtn.textContent = 'Sign In';
    authBtn.onclick = showAuthModal;
    
    if (tokenBalance) tokenBalance.style.display = 'none';
    if (userProfilePic) userProfilePic.style.display = 'none';
  }
  
  function showAuthModal() {
    console.log('Showing auth modal');
    document.getElementById('auth-modal').style.display = 'flex';
  }
  
  function closeAllModals() {
    document.getElementById('auth-modal').style.display = 'none';
    document.getElementById('tokens-modal').style.display = 'none';
    document.getElementById('rating-modal').style.display = 'none';
  }
  
  function showTab(tabName) {
    console.log('Showing tab:', tabName);
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.style.display = 'none';
    });
    
    // Show selected tab
    if (tabName === 'dashboard' && currentUser) {
      document.getElementById('dashboard-tab').style.display = 'block';
    } else {
      document.getElementById('home-tab').style.display = 'block';
    }
  }
  
  function switchTab(tab) {
    showTab(tab === 'whispers' ? 'home' : tab);
  }
  
  function showNotification(message, isError = false) {
    console.log('Notification:', message);
    const notification = document.getElementById('notification');
    const notificationMessage = document.getElementById('notification-message');
    
    if (notification && notificationMessage) {
      notificationMessage.textContent = message;
      notification.style.background = isError ? '#EF4444' : '#8B5CF6';
      notification.classList.add('show');
      
      setTimeout(() => {
        notification.classList.remove('show');
      }, 3000);
    } else {
      // Fallback to alert if notification element doesn't exist
      alert(message);
    }
  }
  
  // Load sample profiles for now
  function loadAvailableProfiles() {
    console.log('Loading profiles...');
    const profilesContainer = document.getElementById('profiles-container');
    
    if (!profilesContainer) {
      console.error('Profiles container not found');
      return;
    }
    
    // Sample profiles for testing
    const sampleProfiles = [
      {
        id: '1',
        displayName: 'Alex Johnson',
        bio: 'Love chatting about tech and music',
        profilePicUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop',
        isAvailable: true,
        mode: 'whisper',
        twitter: 'https://twitter.com/alex',
        instagram: 'https://instagram.com/alex'
      },
      {
        id: '2',
        displayName: 'Sam Wilson',
        bio: 'Fitness coach and motivational speaker',
        profilePicUrl: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?w=150&h=150&fit=crop',
        isAvailable: true,
        mode: 'whisper',
        twitter: 'https://twitter.com/sam',
        instagram: 'https://instagram.com/sam'
      },
      {
        id: '3',
        displayName: 'Taylor Smith',
        bio: 'Digital artist and creative mind',
        profilePicUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop',
        isAvailable: true,
        mode: 'whisper',
        twitter: 'https://twitter.com/taylor',
        instagram: 'https://instagram.com/taylor'
      }
    ];
    
    // Clear container
    profilesContainer.innerHTML = '';
    
    // Add profile cards
    sampleProfiles.forEach(profile => {
      const card = document.createElement('div');
      card.className = 'profile-card';
      card.innerHTML = `
        <div class="profile-card-header">
          <img src="${profile.profilePicUrl}" 
               alt="${profile.displayName}" 
               class="profile-card-img">
          <h3 class="profile-card-name">${profile.displayName}</h3>
          <div class="status-badge status-available">Available Now</div>
          <p class="profile-card-bio">${profile.bio}</p>
        </div>
        <div class="profile-card-body">
          <div class="social-links">
            ${profile.twitter ? `<a href="${profile.twitter}" target="_blank" class="social-link"><i class="fab fa-twitter"></i></a>` : ''}
            ${profile.instagram ? `<a href="${profile.instagram}" target="_blank" class="social-link"><i class="fab fa-instagram"></i></a>` : ''}
          </div>
          <button class="call-btn" onclick="window.startCall('${profile.id}')">
            <i class="fas fa-phone"></i> Start 5-Min Chat (1 Token)
          </button>
        </div>
      `;
      profilesContainer.appendChild(card);
    });
    
    console.log('Profiles loaded');
  }
  
  // Mock functions for testing
  async function loadUserData() {
    console.log('Loading user data...');
    // For now, just set some dummy data
    userData = {
      displayName: 'Test User',
      tokens: 5,
      earnings: 0,
      callsAnswered: 0,
      mode: 'whisper'
    };
    
    // Update UI
    document.getElementById('token-count').textContent = userData.tokens;
    document.getElementById('earnings').textContent = '$' + userData.earnings.toFixed(2);
    document.getElementById('calls-answered').textContent = userData.callsAnswered;
    document.getElementById('tokens-dashboard').textContent = userData.tokens;
    
    // Update profile picture if available
    if (userProfilePic) {
      userProfilePic.src = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&h=150&fit=crop';
    }
  }
  
  function startUserPresence() {
    console.log('Starting user presence tracking');
    // Implement later
  }
  
  // Make functions available globally
  window.startCall = function(whisperId) {
    console.log('Start call clicked for whisper:', whisperId);
    if (!currentUser) {
      showAuthModal();
      showNotification('Please sign in to start a call');
      return;
    }
    
    if (!userData || userData.tokens < 1) {
      showTokensModal();
      showNotification('You need at least 1 token to start a call', true);
      return;
    }
    
    // For now, just show a message
    showNotification('Call functionality will be enabled after Firebase setup is complete');
    
    // In the future, this will initiate the actual call
    // joinCallRoom('test-call-id');
  };
  
  window.joinCallRoom = function(callId) {
    console.log('Joining call room:', callId);
    showNotification('Joining call...');
    // Implement later
  };
  
  window.showTab = showTab;
  window.leaveChat = function() {
    console.log('Leaving chat');
    // Implement later
  };
  
  console.log('App setup complete');
});
