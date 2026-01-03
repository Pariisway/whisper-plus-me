// Firebase Auth Configuration
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔐 Setting up Firebase Auth...');
    
    // Initialize Firebase
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
        console.log('✅ Firebase initialized');
    }
    
    // Set up OAuth providers
    const googleProvider = new firebase.auth.GoogleAuthProvider();
    googleProvider.addScope('profile');
    googleProvider.addScope('email');
    
    const facebookProvider = new firebase.auth.FacebookAuthProvider();
    facebookProvider.addScope('email');
    facebookProvider.addScope('public_profile');
    
    // Global auth functions
    window.signInWithEmail = function() {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        if (!email || !password) {
            showToast('Please enter email and password', 'error');
            return;
        }
        
        firebase.auth().signInWithEmailAndPassword(email, password)
            .then((userCredential) => {
                showToast('Successfully logged in!', 'success');
                closeModal();
            })
            .catch((error) => {
                console.error('Login error:', error);
                showToast(error.message, 'error');
            });
    };
    
    window.signUpWithEmail = function() {
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const displayName = document.getElementById('register-name').value;
        
        if (!email || !password || !displayName) {
            showToast('Please fill all fields', 'error');
            return;
        }
        
        if (password.length < 6) {
            showToast('Password must be at least 6 characters', 'error');
            return;
        }
        
        firebase.auth().createUserWithEmailAndPassword(email, password)
            .then((userCredential) => {
                // Create user profile
                const user = userCredential.user;
                const userData = {
                    email: email,
                    displayName: displayName,
                    coins: 5, // Free 5 coins for signup
                    isAvailable: false,
                    createdAt: Date.now(),
                    profileId: 'user_' + Math.random().toString(36).substr(2, 9),
                    profilePhoto: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=667eea&color=fff`,
                    callPrice: 1,
                    bio: 'New whisper user',
                    lastSeen: Date.now()
                };
                
                // Write to both private and public data
                const updates = {};
                updates[`users/${user.uid}`] = {
                    email: email,
                    coins: 5,
                    createdAt: Date.now(),
                    isAdmin: false
                };
                updates[`publicProfiles/${user.uid}`] = userData;
                
                return firebase.database().ref().update(updates);
            })
            .then(() => {
                showToast('Account created! 5 free coins added.', 'success');
                closeModal();
            })
            .catch((error) => {
                console.error('Signup error:', error);
                showToast(error.message, 'error');
            });
    };
    
    window.signInWithGoogle = function() {
        firebase.auth().signInWithPopup(googleProvider)
            .then((result) => {
                const user = result.user;
                // Check if user exists in database
                return firebase.database().ref(`users/${user.uid}`).once('value')
                    .then(snapshot => {
                        if (!snapshot.exists()) {
                            // Create new user
                            const userData = {
                                email: user.email,
                                displayName: user.displayName,
                                coins: 5,
                                isAvailable: false,
                                createdAt: Date.now(),
                                profileId: 'user_' + Math.random().toString(36).substr(2, 9),
                                profilePhoto: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=667eea&color=fff`,
                                callPrice: 1,
                                bio: 'New whisper user',
                                lastSeen: Date.now()
                            };
                            
                            const updates = {};
                            updates[`users/${user.uid}`] = {
                                email: user.email,
                                coins: 5,
                                createdAt: Date.now(),
                                isAdmin: false
                            };
                            updates[`publicProfiles/${user.uid}`] = userData;
                            
                            return firebase.database().ref().update(updates);
                        }
                    });
            })
            .then(() => {
                showToast('Successfully logged in with Google!', 'success');
                closeModal();
            })
            .catch((error) => {
                console.error('Google signin error:', error);
                showToast(error.message, 'error');
            });
    };
    
    window.signInWithFacebook = function() {
        firebase.auth().signInWithPopup(facebookProvider)
            .then((result) => {
                const user = result.user;
                return firebase.database().ref(`users/${user.uid}`).once('value')
                    .then(snapshot => {
                        if (!snapshot.exists()) {
                            const userData = {
                                email: user.email,
                                displayName: user.displayName,
                                coins: 5,
                                isAvailable: false,
                                createdAt: Date.now(),
                                profileId: 'user_' + Math.random().toString(36).substr(2, 9),
                                profilePhoto: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=667eea&color=fff`,
                                callPrice: 1,
                                bio: 'New whisper user',
                                lastSeen: Date.now()
                            };
                            
                            const updates = {};
                            updates[`users/${user.uid}`] = {
                                email: user.email,
                                coins: 5,
                                createdAt: Date.now(),
                                isAdmin: false
                            };
                            updates[`publicProfiles/${user.uid}`] = userData;
                            
                            return firebase.database().ref().update(updates);
                        }
                    });
            })
            .then(() => {
                showToast('Successfully logged in with Facebook!', 'success');
                closeModal();
            })
            .catch((error) => {
                console.error('Facebook signin error:', error);
                showToast(error.message, 'error');
            });
    };
    
    window.logout = function() {
        firebase.auth().signOut()
            .then(() => {
                showToast('Logged out successfully', 'success');
                window.location.reload();
            })
            .catch((error) => {
                console.error('Logout error:', error);
            });
    };
    
    console.log('✅ Auth setup complete');
});

// Helper functions
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        color: white;
        padding: 12px 24px;
        border-radius: 4px;
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function closeModal() {
    const modal = document.querySelector('.modal');
    if (modal) modal.remove();
}
