class AuthManager {
  constructor() {
    this.currentUser = null;
    this.userData = null;
    this.authListeners = [];
    this.oauthHandlers = {
      facebook: this.loginWithFacebook.bind(this),
      google: this.loginWithGoogle.bind(this),
      instagram: this.loginWithInstagram.bind(this)
    };
  }

  async initialize() {
    return new Promise((resolve) => {
      if (!firebase.auth) {
        console.error('Firebase auth not available');
        resolve(false);
        return;
      }
      
      firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
          this.currentUser = user;
          try {
            await this.loadUserData();
            this.notifyListeners('login');
            resolve(true);
          } catch (error) {
            console.error('Error loading user data:', error);
            resolve(false);
          }
        } else {
          this.currentUser = null;
          this.userData = null;
          this.notifyListeners('logout');
          resolve(false);
        }
      });
    });
  }

  // Use Firebase OAuth handler URL for all providers
  async loginWithOAuth(providerName) {
    const providerMap = {
      'facebook': firebase.auth.FacebookAuthProvider.PROVIDER_ID,
      'google': firebase.auth.GoogleAuthProvider.PROVIDER_ID,
      'github': firebase.auth.GithubAuthProvider.PROVIDER_ID,
      'twitter': firebase.auth.TwitterAuthProvider.PROVIDER_ID
    };

    const providerId = providerMap[providerName];
    if (!providerId) {
      throw new Error(`Provider ${providerName} not supported`);
    }

    try {
      // Use Firebase Auth handler URL
      const auth = firebase.auth();
      let provider;
      
      switch(providerName) {
        case 'facebook':
          provider = new firebase.auth.FacebookAuthProvider();
          provider.addScope('email');
          break;
        case 'google':
          provider = new firebase.auth.GoogleAuthProvider();
          provider.addScope('email');
          provider.addScope('profile');
          break;
        case 'github':
          provider = new firebase.auth.GithubAuthProvider();
          provider.addScope('user:email');
          break;
        case 'twitter':
          provider = new firebase.auth.TwitterAuthProvider();
          break;
        default:
          throw new Error('Unsupported provider');
      }

      // Try popup first, fallback to redirect
      try {
        const result = await auth.signInWithPopup(provider);
        await this.loadUserData();
        return { success: true, user: result.user };
      } catch (popupError) {
        if (popupError.code === 'auth/popup-blocked') {
          // Use redirect for popup-blocked
          await auth.signInWithRedirect(provider);
          return { success: true, redirect: true };
        }
        throw popupError;
      }
    } catch (error) {
      console.error(`${providerName} login error:`, error);
      throw this.getOAuthErrorMessage(error, providerName);
    }
  }

  // Simplified Facebook login using OAuth handler
  async loginWithFacebook() {
    return this.loginWithOAuth('facebook');
  }

  // Google login
  async loginWithGoogle() {
    return this.loginWithOAuth('google');
  }

  // Instagram requires custom OAuth flow
  async loginWithInstagram() {
    try {
      // Instagram OAuth requires client ID and redirect URI
      const clientId = 'YOUR_INSTAGRAM_CLIENT_ID'; // Get from Instagram Developer
      const redirectUri = `${window.location.origin}/auth/instagram/callback`;
      const scope = 'user_profile,user_media';
      
      const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code`;
      
      // Store state for verification
      const state = Math.random().toString(36).substring(7);
      localStorage.setItem('instagram_oauth_state', state);
      
      window.location.href = `${authUrl}&state=${state}`;
      return { success: true, redirect: true };
    } catch (error) {
      console.error('Instagram login error:', error);
      throw new Error('Instagram login requires setup. Please use email login.');
    }
  }

  // Helper to get user-friendly error messages
  getOAuthErrorMessage(error, provider) {
    let message = error.message;
    
    switch(error.code) {
      case 'auth/popup-blocked':
        message = `Pop-up blocked. Please allow pop-ups for ${provider} login or try email login.`;
        break;
      case 'auth/popup-closed-by-user':
        message = `Login pop-up was closed. Please try again.`;
        break;
      case 'auth/unauthorized-domain':
        message = `This domain is not authorized for ${provider} login.`;
        break;
      case 'auth/account-exists-with-different-credential':
        message = 'An account already exists with the same email address.';
        break;
      default:
        message = `${provider} login failed. Please try email login.`;
    }
    
    return new Error(message);
  }

  async login(email, password) {
    try {
      if (!email || !email.trim()) {
        throw new Error('Please enter your email address.');
      }
      
      if (!password || !password.trim()) {
        throw new Error('Please enter your password.');
      }
      
      const trimmedEmail = email.trim();
      const trimmedPassword = password.trim();
      
      const result = await firebase.auth().signInWithEmailAndPassword(trimmedEmail, trimmedPassword);
      await this.loadUserData();
      return { success: true, user: result.user };
    } catch (error) {
      console.error('Login error:', error);
      throw this.getAuthErrorMessage(error);
    }
  }

  async signup(name, email, password) {
    try {
      if (!name || !name.trim()) {
        throw new Error('Please enter your name.');
      }
      
      if (!email || !email.trim()) {
        throw new Error('Please enter your email address.');
      }
      
      if (!password || !password.trim()) {
        throw new Error('Please enter your password.');
      }
      
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters.');
      }
      
      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      const trimmedPassword = password.trim();
      
      const result = await firebase.auth().createUserWithEmailAndPassword(trimmedEmail, trimmedPassword);
      await result.user.updateProfile({ displayName: trimmedName });
      await this.createUserProfile();
      return { success: true, user: result.user };
    } catch (error) {
      console.error('Signup error:', error);
      throw this.getAuthErrorMessage(error);
    }
  }

  getAuthErrorMessage(error) {
    let message = error.message;
    
    switch(error.code) {
      case 'auth/network-request-failed':
        message = 'Network error. Please check your internet connection.';
        break;
      case 'auth/user-not-found':
        message = 'No account found with this email.';
        break;
      case 'auth/wrong-password':
        message = 'Incorrect password.';
        break;
      case 'auth/invalid-email':
        message = 'Invalid email address.';
        break;
      case 'auth/email-already-in-use':
        message = 'Email already in use.';
        break;
      case 'auth/weak-password':
        message = 'Password should be at least 6 characters.';
        break;
    }
    
    return new Error(message);
  }

  async loadUserData() {
    if (!this.currentUser) return null;
    
    try {
      const snapshot = await firebase.database().ref(`users/${this.currentUser.uid}`).once('value');
      this.userData = snapshot.val();
      
      if (!this.userData) {
        await this.createUserProfile();
        await this.loadUserData();
      }
      
      return this.userData;
    } catch (error) {
      console.error('Error loading user data:', error);
      return null;
    }
  }

  async createUserProfile() {
    if (!this.currentUser) return;
    
    const userData = {
      userId: this.currentUser.uid,
      displayName: this.currentUser.displayName || 'User',
      email: this.currentUser.email,
      profilePhoto: this.currentUser.photoURL || '',
      coins: 0,
      earnings: 0,
      callsCompleted: 0,
      rating: 5.0,
      isAvailable: true,
      isWhisper: true,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      whisperId: 'W' + Math.floor(100000 + Math.random() * 900000),
      bio: 'New Whisper+me user',
      callPrice: 1,
      socialLinks: {},
      payoutMethods: {
        paypal: '',
        bank: null
      }
    };
    
    await firebase.database().ref(`users/${this.currentUser.uid}`).set(userData);
    this.userData = userData;
  }

  async logout() {
    try {
      await firebase.auth().signOut();
      this.currentUser = null;
      this.userData = null;
      this.notifyListeners('logout');
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  }

  updateAvailability(isAvailable) {
    if (!this.currentUser) return;
    firebase.database().ref(`users/${this.currentUser.uid}/isAvailable`).set(isAvailable);
    firebase.database().ref(`users/${this.currentUser.uid}/lastSeen`).set(Date.now());
  }

  addListener(callback) {
    this.authListeners.push(callback);
  }

  removeListener(callback) {
    this.authListeners = this.authListeners.filter(listener => listener !== callback);
  }

  notifyListeners(event) {
    this.authListeners.forEach(listener => {
      try {
        listener(event, this.currentUser, this.userData);
      } catch (error) {
        console.error('Auth listener error:', error);
      }
    });
  }

  // Getters
  getCoins() { return this.userData?.coins || 0; }
  getEarnings() { return this.userData?.earnings || 0; }
  getCallsCompleted() { return this.userData?.callsCompleted || 0; }
  getRating() { return this.userData?.rating || 5.0; }
  getWhisperId() { return this.userData?.whisperId || ''; }
  isAdmin() { return this.userData?.role === 'admin'; }
  
  async refreshUserData() { 
    return this.loadUserData(); 
  }
}
