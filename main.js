class WhisperApp {
  constructor() {
    this.isInitialized = false;
    this.listeners = [];
  }

  async initialize() {
    if (this.isInitialized) return;
    console.log('🚀 Initializing Whisper+me...');

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp({
          apiKey: "AIzaSyALbIJSI2C-p6IyMtj_F0ZqGyN1i79jOd4",
          authDomain: "whisper-chat-live.firebaseapp.com",
          databaseURL: "https://whisper-chat-live-default-rtdb.firebaseio.com",
          projectId: "whisper-chat-live",
          storageBucket: "whisper-chat-live.firebasestorage.app",
          messagingSenderId: "302894848452",
          appId: "1:302894848452:web:61a7ab21a269533c426c91"
        });
      }

      window.UI.initialize();
      const isAuthenticated = await window.authManager.initialize();
      
      if (isAuthenticated) {
        await this.setupAuthenticatedUser();
      } else {
        setTimeout(() => { window.UI.showAuthModal(); }, 1000);
      }

      window.agoraManager.initialize();
      this.isInitialized = true;
      window.UI.hideLoadingScreen();

    } catch (error) {
      console.error('Initialization error:', error);
      window.UI.showToast('Failed to initialize app. Please refresh.', 'error');
    }
  }

  async setupAuthenticatedUser() {
    try {
      window.UI.updateUI();
      window.authManager.updateAvailability(true);
      this.setupDatabaseListeners();
      
      window.addEventListener('beforeunload', () => {
        if (window.authManager.currentUser) {
          firebase.database().ref(`users/${window.authManager.currentUser.uid}/isAvailable`).set(false);
        }
      });
    } catch (error) {
      console.error('User setup error:', error);
    }
  }

  setupDatabaseListeners() {
    const userId = window.authManager.currentUser?.uid;
    if (!userId) return;

    const notificationsRef = firebase.database().ref(`notifications/${userId}`);
    notificationsRef.orderByChild('status').equalTo('unread').on('child_added', (snapshot) => {
      const notification = snapshot.val();
      if (notification.type === 'incoming_call') {
        window.UI.showIncomingCallNotification(notification);
      }
    });

    const whispersRef = firebase.database().ref('users').orderByChild('isAvailable').equalTo(true);
    whispersRef.on('value', (snapshot) => {
      this.updateAvailableWhispers(snapshot.val());
    });

    this.listeners.push(notificationsRef, whispersRef);
  }

  updateAvailableWhispers(users) {
    if (!users || !window.authManager.currentUser) return;
    const currentUserId = window.authManager.currentUser.uid;
    const whispersGrid = document.getElementById('whispers-grid');
    const carousel = document.getElementById('profile-carousel');
    
    if (!whispersGrid || !carousel) return;

    const availableUsers = Object.entries(users).filter(([uid, user]) => {
      return uid !== currentUserId && user.isAvailable === true;
    });

    if (availableUsers.length > 0) {
      const [firstUid, firstUser] = availableUsers[0];
      carousel.innerHTML = `
        <div class="profile-card">
          <div class="profile-avatar">${firstUser.displayName?.charAt(0) || 'U'}</div>
          <div class="profile-info">
            <h3>${firstUser.displayName || 'Anonymous'}</h3>
            <p class="profile-id">ID: ${firstUid.substring(0, 8)}...</p>
            <p class="profile-bio">${firstUser.bio || 'Ready to connect!'}</p>
            <button class="call-button" onclick="window.callManager.startCall('${firstUid}').catch(e => window.UI.showToast(e.message, 'error'))">
              <i class="fas fa-phone"></i> Start Voice Call (1 coin)
            </button>
          </div>
        </div>
      `;
    }

    whispersGrid.innerHTML = '';
    availableUsers.slice(0, 6).forEach(([uid, user]) => {
      const card = document.createElement('div');
      card.className = 'whisper-card';
      card.innerHTML = `
        <div class="whisper-avatar">${user.displayName?.charAt(0) || 'U'}</div>
        <h4>${user.displayName || 'Anonymous'}</h4>
        <p>Available now</p>
        <button class="btn btn-primary" onclick="window.callManager.startCall('${uid}').catch(e => window.UI.showToast(e.message, 'error'))">
          <i class="fas fa-phone"></i> Call
        </button>
      `;
      whispersGrid.appendChild(card);
    });
  }

  cleanup() {
    this.listeners.forEach(ref => ref.off());
    this.listeners = [];
    if (window.authManager.currentUser) {
      firebase.database().ref(`users/${window.authManager.currentUser.uid}/isAvailable`).set(false);
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  window.whisperApp = new WhisperApp();
  await window.whisperApp.initialize();
});

window.logout = async () => {
  try {
    window.whisperApp.cleanup();
    await window.authManager.logout();
    window.location.reload();
  } catch (error) {
    console.error('Logout error:', error);
    window.UI.showToast('Logout failed: ' + error.message, 'error');
  }
};

window.showDashboard = () => window.UI.showToast('Dashboard loaded', 'info');
window.showSettings = () => window.UI.showToast('Settings opened', 'info');
window.showProfile = () => window.UI.showToast('Profile loaded', 'info');
window.shareProfile = () => {
  if (navigator.share) {
    navigator.share({ title: 'Whisper+me', text: 'Join me on Whisper+me!', url: window.location.href });
  } else {
    navigator.clipboard.writeText(window.location.href);
    window.UI.showToast('Link copied to clipboard', 'success');
  }
};
window.showAdminDashboard = () => window.UI.showToast('Admin dashboard - Coming soon', 'info');
window.refreshAvailableWhispers = () => {
  window.whisperApp.updateAvailableWhispers({});
  window.UI.showToast('Refreshing available users...', 'info');
};
window.prevProfile = () => window.UI.showToast('Previous profile', 'info');
window.nextProfile = () => window.UI.showToast('Next profile', 'info');
