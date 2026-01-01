class AuthManager {
  constructor() {
    this.currentUser = null;
    this.userData = null;
  }

  async initialize() {
    return new Promise((resolve) => {
      firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
          this.currentUser = user;
          await this.loadUserData();
          resolve(true);
        } else {
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
      coins: 10,
      isAvailable: true,
      createdAt: Date.now(),
      lastSeen: Date.now()
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

  async logout() {
    try {
      await firebase.auth().signOut();
      this.currentUser = null;
      this.userData = null;
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

  getCoins() { return this.userData?.coins || 0; }
  isAdmin() { return this.userData?.role === 'admin'; }
  async refreshUserData() { return this.loadUserData(); }
}

window.authManager = new AuthManager();
