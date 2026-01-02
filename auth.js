class AuthManager {
  constructor() {
    this.currentUser = null;
    this.userData = null;
    this.authListeners = [];
  }

  async initialize() {
    return new Promise((resolve) => {
      firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
          this.currentUser = user;
          await this.loadUserData();
          this.notifyListeners('login');
          resolve(true);
        } else {
          this.currentUser = null;
          this.userData = null;
          this.notifyListeners('logout');
          resolve(false);
        }
      });
    });
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

  async login(email, password) {
    try {
      const result = await firebase.auth().signInWithEmailAndPassword(email, password);
      await this.loadUserData();
      return { success: true, user: result.user };
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  async signup(name, email, password) {
    try {
      const result = await firebase.auth().createUserWithEmailAndPassword(email, password);
      await result.user.updateProfile({ displayName: name });
      await this.createUserProfile();
      return { success: true, user: result.user };
    } catch (error) {
      console.error('Signup error:', error);
      throw error;
    }
  }

  async loginWithFacebook() {
    try {
      const provider = new firebase.auth.FacebookAuthProvider();
      provider.addScope('email');
      const result = await firebase.auth().signInWithPopup(provider);
      await this.loadUserData();
      return { success: true, user: result.user };
    } catch (error) {
      console.error('Facebook login error:', error);
      throw error;
    }
  }

  async loginWithInstagram() {
    try {
      // Note: Instagram doesn't have direct Firebase provider
      // You would need to implement OAuth flow separately
      // For now, we'll use a placeholder that redirects to Instagram OAuth
      const clientId = 'YOUR_INSTAGRAM_CLIENT_ID';
      const redirectUri = `${window.location.origin}/auth/instagram/callback`;
      const scope = 'user_profile,user_media';
      const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`;
      
      window.location.href = authUrl;
      return { success: true, redirect: true };
    } catch (error) {
      console.error('Instagram login error:', error);
      throw error;
    }
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

  async uploadProfilePhoto(file) {
    if (!this.currentUser) throw new Error('Not authenticated');
    
    try {
      const storageRef = firebase.storage().ref();
      const photoRef = storageRef.child(`profile-photos/${this.currentUser.uid}/${Date.now()}_${file.name}`);
      const snapshot = await photoRef.put(file);
      const downloadURL = await snapshot.ref.getDownloadURL();
      
      await this.updateProfile({ profilePhoto: downloadURL });
      return { success: true, url: downloadURL };
    } catch (error) {
      console.error('Photo upload error:', error);
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
