// Simple Auth Manager for production
console.log('🔐 Auth Manager loaded');

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.userData = null;
    }
    
    async signInWithEmail(email, password) {
        try {
            const result = await firebase.auth().signInWithEmailAndPassword(email, password);
            return { success: true, user: result.user };
        } catch (error) {
            console.error('Sign in error:', error);
            return { success: false, error: error.message };
        }
    }
    
    async signUpWithEmail(email, password, displayName) {
        try {
            const result = await firebase.auth().createUserWithEmailAndPassword(email, password);
            await result.user.updateProfile({ displayName });
            
            // Save user to database
            await firebase.database().ref('users/' + result.user.uid).set({
                email: email,
                displayName: displayName,
                coins: 10, // Start with 10 free coins
                isAvailable: true,
                createdAt: firebase.database.ServerValue.TIMESTAMP
            });
            
            return { success: true, user: result.user };
        } catch (error) {
            console.error('Sign up error:', error);
            return { success: false, error: error.message };
        }
    }
    
    async signOut() {
        try {
            await firebase.auth().signOut();
            return { success: true };
        } catch (error) {
            console.error('Sign out error:', error);
            return { success: false, error: error.message };
        }
    }
    
    async loadUserData(uid) {
        try {
            const snapshot = await firebase.database().ref('users/' + uid).once('value');
            this.userData = snapshot.val();
            return this.userData;
        } catch (error) {
            console.error('Load user data error:', error);
            return null;
        }
    }
}

// Export for global use
window.AuthManager = AuthManager;
