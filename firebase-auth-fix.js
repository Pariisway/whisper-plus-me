// Firebase Auth Quick Fix
(function() {
    console.log('🔧 Applying Firebase auth fix...');
    
    // Override Firebase auth to handle network errors
    const originalSignIn = firebase.auth().signInWithEmailAndPassword;
    firebase.auth().signInWithEmailAndPassword = function(email, password) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Login timeout. Please check your internet connection.'));
            }, 10000);
            
            originalSignIn.call(this, email, password)
                .then(result => {
                    clearTimeout(timeout);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timeout);
                    console.error('Auth error:', error.code, error.message);
                    
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
                    }
                    
                    reject(new Error(message));
                });
        });
    };
    
    // Fix database connection
    const originalOnAuthStateChanged = firebase.auth().onAuthStateChanged;
    firebase.auth().onAuthStateChanged = function(callback, errorCallback) {
        return originalOnAuthStateChanged.call(this, 
            user => {
                console.log('Auth state changed:', user ? 'User logged in' : 'No user');
                if (callback) callback(user);
            },
            error => {
                console.error('Auth state error:', error);
                if (errorCallback) errorCallback(error);
                // Don't crash on auth errors
            }
        );
    };
    
    console.log('✅ Firebase auth fix applied');
})();
