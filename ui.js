class UIManager {
  constructor() {
    this.modalStack = [];
    this.toastContainer = null;
  }

  initialize() {
    this.createToastContainer();
    this.setupEventListeners();
    window.paymentManager?.handlePaymentReturn();
  }

  createToastContainer() {
    this.toastContainer = document.createElement('div');
    this.toastContainer.id = 'toast-container';
    this.toastContainer.className = 'toast-container';
    document.body.appendChild(this.toastContainer);
  }

  setupEventListeners() {
    const menuBtn = document.getElementById('menu-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', () => this.toggleMenu());
    }
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('dropdown-menu');
      if (menu && !menu.contains(e.target) && !menuBtn?.contains(e.target)) {
        menu.classList.remove('show');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeTopModal();
    });
  }

  toggleMenu() {
    const menu = document.getElementById('dropdown-menu');
    if (menu) menu.classList.toggle('show');
  }

  showToast(message, type = 'info', duration = 5000) {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    toast.innerHTML = `
      <i class="fas fa-${icons[type] || 'info-circle'}"></i>
      <span>${message}</span>
      <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    this.toastContainer.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, duration);
  }

  updateUI() {
    const user = window.authManager?.currentUser;
    const userData = window.authManager?.userData;
    
    if (user && userData) {
      const avatar = document.getElementById('user-avatar');
      if (avatar) avatar.textContent = userData.displayName?.charAt(0)?.toUpperCase() || 'U';
      
      const userName = document.getElementById('user-name');
      if (userName) userName.textContent = userData.displayName || 'User';
      
      const welcomeName = document.getElementById('welcome-name');
      if (welcomeName) welcomeName.textContent = userData.displayName || 'User';
      
      const coinsCount = document.getElementById('coins-count');
      if (coinsCount) coinsCount.textContent = userData.coins || 0;
      
      const userId = document.getElementById('user-id');
      if (userId) userId.textContent = `ID: ${user.uid.substring(0, 8)}...`;
      
      const adminMenuItem = document.getElementById('admin-menu-item');
      if (adminMenuItem) adminMenuItem.style.display = userData.role === 'admin' ? 'block' : 'none';
    }

    const appContainer = document.getElementById('app-container');
    if (appContainer) {
      appContainer.style.display = 'block';
      setTimeout(() => { appContainer.style.opacity = '1'; }, 10);
    }
  }

  showAuthModal() {
    const modalHTML = `
      <div class="modal-overlay" id="auth-modal">
        <div class="modal-content">
          <div class="auth-tabs">
            <button class="auth-tab active" onclick="window.UI.switchAuthTab('login')">Login</button>
            <button class="auth-tab" onclick="window.UI.switchAuthTab('signup')">Sign Up</button>
            <button class="close-btn" onclick="window.UI.closeModal('auth-modal')">&times;</button>
          </div>
          <div class="auth-content">
            <div id="login-form" class="auth-form active">
              <h3>Welcome Back</h3>
              <form onsubmit="event.preventDefault(); window.authManager.login(
                document.getElementById('login-email').value,
                document.getElementById('login-password').value
              ).then(() => window.UI.closeModal('auth-modal')).catch(e => window.UI.showToast(e.message, 'error'))">
                <input type="email" id="login-email" placeholder="Email" required>
                <input type="password" id="login-password" placeholder="Password" required>
                <button type="submit" class="btn btn-primary">Login</button>
              </form>
            </div>
            <div id="signup-form" class="auth-form">
              <h3>Create Account</h3>
              <form onsubmit="event.preventDefault(); window.authManager.signup(
                document.getElementById('signup-name').value,
                document.getElementById('signup-email').value,
                document.getElementById('signup-password').value
              ).then(() => window.UI.closeModal('auth-modal')).catch(e => window.UI.showToast(e.message, 'error'))">
                <input type="text" id="signup-name" placeholder="Full Name" required>
                <input type="email" id="signup-email" placeholder="Email" required>
                <input type="password" id="signup-password" placeholder="Password" required minlength="6">
                <button type="submit" class="btn btn-primary">Create Account</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modalStack.push('auth-modal');
  }

  switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => {
      t.classList.toggle('active', t.textContent.toLowerCase().includes(tab));
    });
    document.getElementById('login-form').classList.toggle('active', tab === 'login');
    document.getElementById('signup-form').classList.toggle('active', tab === 'signup');
  }

  showBuyCoinsModal() {
    const packages = window.paymentManager.getCoinPackages();
    let packagesHTML = '';
    Object.entries(packages).forEach(([id, pkg]) => {
      packagesHTML += `
        <div class="coin-package ${id === 'coins_250' ? 'popular' : ''}">
          ${id === 'coins_250' ? '<div class="popular-badge">MOST POPULAR</div>' : ''}
          <div class="package-header">
            <i class="fas fa-${id === 'coins_1000' ? 'award' : id === 'coins_500' ? 'rocket' : id === 'coins_250' ? 'crown' : 'gem'}"></i>
            <h3>${pkg.description}</h3>
          </div>
          <div class="package-price">$${pkg.amount}</div>
          ${pkg.bonus ? `<div class="package-savings">${pkg.bonus}</div>` : ''}
          <button class="btn btn-primary" onclick="window.paymentManager.buyCoins('${id}').catch(e => window.UI.showToast(e.message, 'error'))">
            Buy Now
          </button>
        </div>
      `;
    });

    const modalHTML = `
      <div class="modal-overlay" id="coins-modal">
        <div class="modal-content">
          <div class="coins-modal">
            <div class="coins-header">
              <h2><i class="fas fa-coins"></i> Buy Coins</h2>
              <p>Purchase coins to start conversations</p>
              <button class="close-btn" onclick="window.UI.closeModal('coins-modal')">&times;</button>
            </div>
            <div class="coins-grid">${packagesHTML}</div>
            <div class="coins-footer">
              <p><i class="fas fa-lock"></i> Secure payment processed by Stripe</p>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modalStack.push('coins-modal');
  }

  showCallUI(callId, otherUserId, isCaller = true) {
    const callControls = document.getElementById('call-controls');
    if (!callControls) return;
    callControls.style.display = 'block';
    callControls.innerHTML = `
      <div class="call-header">
        <div class="call-status">
          <i class="fas fa-phone"></i>
          <span>${isCaller ? 'Calling...' : 'Incoming call...'}</span>
        </div>
        <div class="call-timer" id="call-timer">00:00</div>
      </div>
      <div class="call-controls-grid">
        <button class="call-control-btn mic-btn" onclick="window.agoraManager.toggleMic().catch(e => window.UI.showToast(e.message, 'error'))">
          <i class="fas fa-microphone"></i>
        </button>
        <button class="call-control-btn speaker-btn" onclick="window.agoraManager.toggleSpeaker().catch(e => window.UI.showToast(e.message, 'error'))">
          <i class="fas fa-volume-up"></i>
        </button>
        <button class="call-control-btn end-call-btn" onclick="window.callManager.endCall().catch(e => window.UI.showToast(e.message, 'error'))" style="background: var(--danger);">
          <i class="fas fa-phone-slash"></i>
        </button>
      </div>
    `;
  }

  hideCallUI() {
    const callControls = document.getElementById('call-controls');
    if (callControls) callControls.style.display = 'none';
  }

  showIncomingCallNotification(callData) {
    const notificationHTML = `
      <div class="modal-overlay" id="incoming-call-modal">
        <div class="modal-content">
          <div class="incoming-call">
            <div class="caller-info">
              <div class="caller-avatar">${callData.callerName?.charAt(0) || 'U'}</div>
              <div class="caller-details">
                <h3>${callData.callerName || 'Someone'}</h3>
                <p>Incoming call</p>
              </div>
            </div>
            <div class="call-actions">
              <button class="btn btn-success" onclick="window.callManager.answerCall('${callData.callId}').then(() => window.UI.closeModal('incoming-call-modal')).catch(e => window.UI.showToast(e.message, 'error'))">
                <i class="fas fa-phone"></i> Answer
              </button>
              <button class="btn btn-danger" onclick="window.callManager.declineCall('${callData.callId}').then(() => window.UI.closeModal('incoming-call-modal')).catch(e => window.UI.showToast(e.message, 'error'))">
                <i class="fas fa-phone-slash"></i> Decline
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', notificationHTML);
    this.modalStack.push('incoming-call-modal');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.style.animation = 'fadeOut 0.3s ease';
      setTimeout(() => modal.remove(), 300);
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
      setTimeout(() => { loadingScreen.style.display = 'none'; }, 300);
    }
  }
}

window.UI = new UIManager();
