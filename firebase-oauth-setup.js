// Firebase OAuth Configuration
// Add this script BEFORE firebase initialization

class FirebaseOAuthConfig {
    static providers = {
        facebook: {
            enabled: false,
            appId: 'YOUR_FACEBOOK_APP_ID',
            appSecret: 'YOUR_FACEBOOK_APP_SECRET'
        },
        google: {
            enabled: false,
            clientId: 'YOUR_GOOGLE_CLIENT_ID',
            clientSecret: 'YOUR_GOOGLE_CLIENT_SECRET'
        },
        instagram: {
            enabled: false,
            clientId: 'YOUR_INSTAGRAM_CLIENT_ID',
            clientSecret: 'YOUR_INSTAGRAM_CLIENT_SECRET'
        }
    };

    static initialize() {
        console.log('🔧 Configuring Firebase OAuth...');
        
        // Set up Facebook provider if enabled
        if (this.providers.facebook.enabled && this.providers.facebook.appId) {
            this.setupFacebook();
        }
        
        // Set up Google provider if enabled
        if (this.providers.google.enabled && this.providers.google.clientId) {
            this.setupGoogle();
        }
        
        // Instagram requires custom implementation
        if (this.providers.instagram.enabled) {
            this.setupInstagram();
        }
    }

    static setupFacebook() {
        console.log('📘 Setting up Facebook login...');
        // Facebook config is handled in Firebase Console
        // Go to: Firebase Console → Authentication → Sign-in method → Facebook
        // Enter App ID and App Secret from Facebook Developer Console
    }

    static setupGoogle() {
        console.log('🔴 Setting up Google login...');
        // Google config is handled in Firebase Console
        // Go to: Firebase Console → Authentication → Sign-in method → Google
        // Enable Google provider
    }

    static setupInstagram() {
        console.log('📸 Setting up Instagram login (custom)...');
        // Instagram requires custom OAuth flow
        // See: https://firebase.google.com/docs/auth/web/custom-oauth
    }

    // Helper to get provider config for UI
    static getProviderConfig(provider) {
        return this.providers[provider] || null;
    }

    // Check if any OAuth provider is configured
    static hasOAuthProviders() {
        return Object.values(this.providers).some(p => p.enabled);
    }
}

// Initialize when Firebase is ready
if (typeof firebase !== 'undefined') {
    firebase.auth().onAuthStateChanged(() => {
        FirebaseOAuthConfig.initialize();
    });
}

// Export for global use
window.FirebaseOAuthConfig = FirebaseOAuthConfig;
