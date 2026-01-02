class PaymentManager {
  constructor() {
    this.stripe = null;
    this.initializeStripe();
  }

  initializeStripe() {
    if (typeof Stripe === 'undefined') {
      console.error('Stripe SDK not loaded');
      return false;
    }
    
    // Use environment detection
    const isProduction = window.location.hostname !== 'localhost' && 
                        window.location.hostname !== '127.0.0.1';
    
    const publishableKey = isProduction
      ? 'pk_live_YOUR_LIVE_KEY'  // Production key
      : 'pk_test_YOUR_TEST_KEY'; // Test key
    
    this.stripe = Stripe(publishableKey);
    return true;
  }

  async buyCoins(packageId) {
    if (!window.App.auth.currentUser) {
      throw new Error('User not authenticated');
    }
    
    try {
      // Call Cloud Function to create checkout session
      const createCheckoutSession = firebase.functions().httpsCallable('createCheckoutSession');
      const sessionResponse = await createCheckoutSession({ packageId });
      
      const { sessionId } = sessionResponse.data;
      
      // Redirect to Stripe Checkout
      const result = await this.stripe.redirectToCheckout({
        sessionId: sessionId
      });
      
      if (result.error) {
        throw new Error(result.error.message);
      }
      
      return { success: true };
      
    } catch (error) {
      console.error('Buy coins error:', error);
      
      // Handle specific errors
      if (error.message.includes('functions') || error.message.includes('not deployed')) {
        throw new Error('Payment system is currently unavailable. Please try again later.');
      }
      
      throw error;
    }
  }

  getCoinPackages() {
    return {
      'coins_1': { amount: 15, coins: 1, description: '1 Coin' },
      'coins_3': { amount: 45, coins: 3, description: '3 Coins' },
      'coins_5': { amount: 75, coins: 5, description: '5 Coins' },
      'coins_10': { amount: 135, coins: 10, description: '10 Coins (10% off)' },
      'coins_20': { amount: 240, coins: 20, description: '20 Coins (20% off)' }
    };
  }

  async handlePaymentReturn() {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    const sessionId = urlParams.get('session_id');

    if (paymentStatus === 'success' && sessionId) {
      window.App.ui.showToast('Payment successful! Coins will be added shortly.', 'success');
      
      // Refresh user data to show updated coins
      if (window.App.auth) {
        await window.App.auth.refreshUserData();
        window.App.ui.updateUserInfo(window.App.auth.userData);
      }
      
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
      
    } else if (paymentStatus === 'cancelled') {
      window.App.ui.showToast('Payment cancelled', 'warning');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  getPayoutMethods() {
    return {
      paypal: {
        name: 'PayPal',
        description: 'Instant transfer to PayPal',
        minPayout: 20,
        fee: 0,
        icon: 'fab fa-paypal'
      },
      bank: {
        name: 'Bank Transfer',
        description: 'Direct bank deposit (2-3 business days)',
        minPayout: 50,
        fee: 1.5,
        icon: 'fas fa-university'
      },
      crypto: {
        name: 'Crypto (USDT)',
        description: 'Cryptocurrency transfer',
        minPayout: 100,
        fee: 0.5,
        icon: 'fab fa-bitcoin'
      }
    };
  }
}
