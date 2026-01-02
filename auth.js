class AuthManager {
  constructor() {
    this.currentUser = null;
    this.userData = null;
    this.authListeners = [];
  }

  async initialize() {
    return new Promise((resolve) => {
      if (!firebase.auth) {
        console.error('Firebase auth not available');
        resolve(false);
        return;
      }
      
      const unsubscribe = firebase.auth().onAuthStateChanged(async (user) => {
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
        unsubscribe();
      });
    });
  }

  async login(email, password) {
    try {
      // Validate inputs
      if (!email || !email.trim()) {
        throw new Error('Please enter your email address.');
      }
      
      if (!password || !password.trim()) {
        throw new Error('Please enter your password.');
      }
      
      const trimmedEmail = email.trim();
      const trimmedPassword = password.trim();
      
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        throw new Error('Please enter a valid email address.');
      }
      
      const result = await firebase.auth().signInWithEmailAndPassword(trimmedEmail, trimmedPassword);
      await this.loadUserData();
      return { success: true, user: result.user };
    } catch (error) {
      console.error('Login error:', error);
      
      // User-friendly error messages
      let message = error.message;
      if (error.code === 'auth/network-request-failed') {
        message = 'Network error. Please check your internet connection.';
      } else if (error.code === 'auth/user-not-found') {
        message = 'No account found with this email.';
      } else if (error.code === 'auth/wrong-password') {
        message = 'Incorrect password.';
      } else if (error.code === 'auth/invalid-email') {
        message = 'Invalid email address.';
      } else if (error.code === 'auth/missing-email') {
        message = 'Please enter your email address.';
      } else if (error.code === 'auth/missing-password') {
        message = 'Please enter your password.';
      }
      
      throw new Error(message);
    }
  }

  async signup(name, email, password) {
    try {
      // Validate inputs
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
      
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        throw new Error('Please enter a valid email address.');
      }
      
      const result = await firebase.auth().createUserWithEmailAndPassword(trimmedEmail, trimmedPassword);
      await result.user.updateProfile({ displayName: trimmedName });
      await this.createUserProfile();
      return { success: true, user: result.user };
    } catch (error) {
      console.error('Signup error:', error);
      
      let message = error.message;
      if (error.code === 'auth/email-already-in-use') {
        message = 'Email already in use.';
      } else if (error.code === 'auth/weak-password') {
        message = 'Password should be at least 6 characters.';
      } else if (error.code === 'auth/invalid-email') {
        message = 'Invalid email address.';
      } else if (error.code === 'auth/network-request-failed') {
        message = 'Network error. Please check your internet connection.';
      }
      
      throw new Error(message);
    }
  }

  async loginWithFacebook() {
    try {
      const provider = new firebase.auth.FacebookAuthProvider();
      provider.addScope('email');
      
      // Check if we're on HTTPS
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        throw new Error('Facebook login requires HTTPS. Please use email login.');
      }
      
      // Try popup first
      try {
        const result = await firebase.auth().signInWithPopup(provider);
        await this.loadUserData();
        return { success: true, user: result.user };
      } catch (popupError) {
        if (popupError.code === 'auth/popup-blocked') {
          // Fallback to redirect
          await firebase.auth().signInWithRedirect(provider);
          return { success: true, redirect: true };
        }
        throw popupError;
      }
    } catch (error) {
      console.error('Facebook login error:', error);
      
      let message = error.message;
      if (error.code === 'auth/popup-blocked') {
        message = 'Popup blocked. Please allow popups or use email login.';
      } else if (error.code === 'auth/popup-closed-by-user') {
        message = 'Login popup was closed. Please try again.';
      } else if (error.code === 'auth/unauthorized-domain') {
        message = 'Facebook login not configured for this domain. Please use email login.';
      }
      
      throw new Error(message);
    }
  }

  async loginWithInstagram() {
    throw new Error('Instagram login is not available. Please use email or Facebook login.');
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

  async updateProfile(updates) {
    if (!this.currentUser) throw new Error('Not authenticated');
    
    try {
      await firebase.database().ref(`users/${this.currentUser.uid}`).update(updates);
      await this.loadUserData();
      this.notifyListeners('profile-update');
      return { success: true };
    } catch (error) {
      console.error('Profile update error:', error);
      throw error;
    }
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
