class UIManager {
  constructor() {
    this.modalStack = [];
    this.toastContainer = null;
    this.authListeners = [];
  }

  initialize() {
    this.createToastContainer();
    this.setupEventListeners();
    this.setupAuthUI();
    window.App.payments?.handlePaymentReturn();
  }

  setupAuthUI() {
    // Listen for auth changes
    if (window.App.auth) {
      window.App.auth.addListener((event, user, userData) => {
        this.updateAuthUI(event, user, userData);
      });
    }
  }

  updateAuthUI(event, user, userData) {
    const guestMenu = document.getElementById('guest-menu');
    const loggedInMenu = document.getElementById('logged-in-menu');
    
    if (user) {
      if (guestMenu) guestMenu.style.display = 'none';
      if (loggedInMenu) loggedInMenu.style.display = 'block';
      
      // Update user info
      this.updateUserInfo(userData);
    } else {
      if (guestMenu) guestMenu.style.display = 'block';
      if (loggedInMenu) loggedInMenu.style.display = 'none';
    }
  }

  updateUserInfo(userData) {
    // Update coins count
    const coinsCount = document.getElementById('coins-count');
    if (coinsCount) coinsCount.textContent = userData?.coins || 0;
    
    // Update dashboard stats
    this.updateDashboardStats(userData);
  }

  updateDashboardStats(userData) {
    if (!userData) return;
    
    const elements = {
      'dash-coins': userData.coins || 0,
      'dash-earnings': `$${userData.earnings || 0}`,
      'dash-calls': userData.callsCompleted || 0,
      'dash-rating': userData.rating?.toFixed(1) || '5.0'
    };
    
    Object.entries(elements).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    });
  }

  createToastContainer() {
    this.toastContainer = document.createElement('div');
    this.toastContainer.id = 'toast-container';
    this.toastContainer.className = 'toast-container';
    document.body.appendChild(this.toastContainer);
  }

  setupEventListeners() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeTopModal();
    });
  }

  showToast(message, type = 'info', duration = 5000) {
    if (!this.toastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = { 
      success: 'check-circle', 
      error: 'exclamation-circle', 
      warning: 'exclamation-triangle', 
      info: 'info-circle' 
    };
    
    toast.innerHTML = `
      <i class="fas fa-${icons[type] || 'info-circle'}"></i>
      <span>${message}</span>
      <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    
    this.toastContainer.appendChild(toast);
    
    setTimeout(() => { 
      if (toast.parentNode) toast.remove(); 
    }, duration);
  }

  showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    if (!notification) return;
    
    notification.textContent = message;
    notification.className = 'notification show';
    
    if (type === 'error') {
      notification.classList.add('error');
    }
    
    setTimeout(() => {
      notification.classList.remove('show');
    }, 3000);
  }

  showAuthModal() {
    const modalHTML = `
      <div class="modal-overlay" id="auth-modal">
        <div class="modal">
          <div class="modal-header">
            <h3 id="auth-modal-title">Login to Whisper+me</h3>
            <button class="close-btn" onclick="window.App.ui.closeModal('auth-modal')">×</button>
          </div>
          <div class="modal-body">
            <!-- Social Login Buttons -->
            <div style="margin-bottom: 1.5rem;">
              <button class="btn btn-secondary" onclick="window.App.auth.loginWithFacebook()" style="width: 100%; margin-bottom: 0.5rem; background: #1877F2; color: white;">
                <i class="fab fa-facebook"></i> Continue with Facebook
              </button>
              <button class="btn btn-secondary" onclick="window.App.auth.loginWithInstagram()" style="width: 100%; background: #E4405F; color: white;">
                <i class="fab fa-instagram"></i> Continue with Instagram
              </button>
              <p style="text-align: center; color: #888; margin: 1rem 0;">or</p>
            </div>
            
            <!-- Login Form -->
            <div class="auth-form active" id="login-form">
              <div class="form-group">
                <label>Email</label>
                <input type="email" id="login-email" placeholder="your@email.com">
              </div>
              <div class="form-group">
                <label>Password</label>
                <input type="password" id="login-password" placeholder="••••••••">
              </div>
              <button class="btn btn-primary" onclick="window.App.auth.login(
                document.getElementById('login-email').value,
                document.getElementById('login-password').value
              ).then(() => window.App.ui.closeModal('auth-modal')).catch(e => window.App.ui.showToast(e.message, 'error'))" 
              style="width: 100%; padding: 1rem;">
                <i class="fas fa-sign-in-alt"></i> Login
              </button>
              <p style="text-align: center; color: #888; margin-top: 1rem;">
                Don't have an account? <a href="#" onclick="window.App.ui.switchAuthTab('signup')" style="color: #7c3aed; text-decoration: none;">Sign up</a>
              </p>
            </div>
            
            <!-- Signup Form -->
            <div class="auth-form" id="signup-form" style="display: none;">
              <div class="form-group">
                <label>Email</label>
                <input type="email" id="signup-email" placeholder="your@email.com">
              </div>
              <div class="form-group">
                <label>Password (min 6 characters)</label>
                <input type="password" id="signup-password" placeholder="••••••••">
              </div>
              <div class="form-group">
                <label>Confirm Password</label>
                <input type="password" id="signup-confirm" placeholder="••••••••">
              </div>
              <button class="btn btn-primary" onclick="window.App.auth.signup(
                document.getElementById('signup-email').value.split('@')[0],
                document.getElementById('signup-email').value,
                document.getElementById('signup-password').value
              ).then(() => window.App.ui.closeModal('auth-modal')).catch(e => window.App.ui.showToast(e.message, 'error'))" 
              style="width: 100%; padding: 1rem;">
                <i class="fas fa-user-plus"></i> Sign Up
              </button>
              <p style="text-align: center; color: #888; margin-top: 1rem;">
                Already have an account? <a href="#" onclick="window.App.ui.switchAuthTab('login')" style="color: #7c3aed; text-decoration: none;">Login</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    `;
    
    if (!document.getElementById('auth-modal')) {
      document.body.insertAdjacentHTML('beforeend', modalHTML);
    }
    
    this.showModal('auth-modal');
  }

  switchAuthTab(tab) {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const title = document.getElementById('auth-modal-title');
    
    if (tab === 'login') {
      title.textContent = 'Login to Whisper+me';
      loginForm.style.display = 'block';
      signupForm.style.display = 'none';
    } else {
      title.textContent = 'Create Account';
      loginForm.style.display = 'none';
      signupForm.style.display = 'block';
    }
  }

  showBuyCoinsModal() {
    const packages = window.App.payments?.getCoinPackages() || {};
    let packagesHTML = '';
    
    Object.entries(packages).forEach(([id, pkg]) => {
      packagesHTML += `
        <div class="coin-option" onclick="selectCoinOption('${id}')">
          <div class="coin-amount">${pkg.coins} Coin${pkg.coins > 1 ? 's' : ''}</div>
          <div class="coin-price">$${pkg.amount}</div>
        </div>
      `;
    });

    const modalHTML = `
      <div class="modal-overlay" id="coins-modal">
        <div class="modal">
          <div class="modal-header">
            <h3><i class="fas fa-coins"></i> Buy Whisper Coins</h3>
            <button class="close-btn" onclick="window.App.ui.closeModal('coins-modal')">×</button>
          </div>
          <div class="modal-body">
            <p style="text-align: center; color: #888; margin-bottom: 1rem;">
              1 Coin = $15 • Each call costs 1-3 coins • Whispers earn $12 per coin
            </p>
            
            <div class="coins-options">
              ${packagesHTML}
            </div>
            
            <button class="btn btn-primary" onclick="window.App.payments.buyCoins(window.selectedCoinId || 'coins_1')" 
            style="width: 100%; padding: 1rem; font-size: 1.1rem; margin-top: 1rem;">
              <i class="fas fa-shopping-cart"></i> Buy Coins Now
            </button>
            
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(124, 58, 237, 0.1); border-radius: 12px;">
              <p style="color: #7c3aed; font-size: 0.9rem; text-align: center;">
                <i class="fas fa-lock"></i> Secure payment processed by Stripe
              </p>
            </div>
          </div>
        </div>
      </div>
    `;
    
    if (!document.getElementById('coins-modal')) {
      document.body.insertAdjacentHTML('beforeend', modalHTML);
    }
    
    this.showModal('coins-modal');
  }

  showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'flex';
      this.modalStack.push(modalId);
    }
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'none';
    }
    this.modalStack = this.modalStack.filter(id => id !== modalId);
  }

  closeTopModal() {
    if (this.modalStack.length > 0) {
      this.closeModal(this.modalStack[this.modalStack.length - 1]);
    }
  }

  hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.opacity = '0';
      setTimeout(() => { 
        loadingScreen.style.display = 'none'; 
      }, 300);
    }
  }

  showIncomingCallNotification(callData) {
    const notificationHTML = `
      <div class="modal-overlay" id="incoming-call-modal">
        <div class="modal">
          <div class="modal-body">
            <div style="text-align: center;">
              <div style="width: 80px; height: 80px; border-radius: 50%; background: #7c3aed; color: white; display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 1rem;">
                <i class="fas fa-phone"></i>
              </div>
              <h3>Incoming Call</h3>
              <p style="color: #888; margin-bottom: 1rem;">${callData.callerName || 'Someone'} is calling you</p>
              
              <div style="display: flex; gap: 1rem; justify-content: center;">
                <button class="btn btn-success" onclick="window.App.calls.answerCall('${callData.callId}').then(() => window.App.ui.closeModal('incoming-call-modal')).catch(e => window.App.ui.showToast(e.message, 'error'))">
                  <i class="fas fa-phone"></i> Answer
                </button>
                <button class="btn btn-danger" onclick="window.App.calls.declineCall('${callData.callId}').then(() => window.App.ui.closeModal('incoming-call-modal')).catch(e => window.App.ui.showToast(e.message, 'error'))">
                  <i class="fas fa-phone-slash"></i> Decline
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', notificationHTML);
    this.modalStack.push('incoming-call-modal');
  }
}

// Global function for coin selection
function selectCoinOption(packageId) {
  window.selectedCoinId = packageId;
  
  document.querySelectorAll('.coin-option').forEach(option => {
    option.classList.remove('selected');
  });
  
  event.target.closest('.coin-option').classList.add('selected');
}
