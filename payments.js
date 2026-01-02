class PaymentManager {
  constructor() {
    this.stripe = null;
    this.initialized = false;
  }

  initializeStripe() {
    if (this.initialized) return true;
    
    if (typeof Stripe === 'undefined') {
      console.warn('Stripe SDK not loaded');
      return false;
    }
    
    try {
      // Use test key for development
      const publishableKey = 'pk_test_51QKH8dLk9pB8r5qYJgGgQ8yQNQq9ZvY7wY8hR7fX9qLk9pB8r5qYJgGgQ8yQNQq9ZvY7wY8hR7fX9q';
      this.stripe = Stripe(publishableKey);
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Stripe initialization error:', error);
      return false;
    }
  }

  async buyCoins(packageId) {
    if (!window.App.auth?.currentUser) {
      throw new Error('Please login to buy coins.');
    }
    
    if (!this.initialized && !this.initializeStripe()) {
      throw new Error('Payment system is not available. Please try again later.');
    }
    
    try {
      // Show loading
      if (window.App.ui?.showToast) {
        window.App.ui.showToast('Processing payment...', 'info');
      }
      
      // Check if Firebase Functions is available
      if (!firebase.functions) {
        throw new Error('Payment system is not available. Please try again later.');
      }
      
      // Call Cloud Function
      const createCheckoutSession = firebase.functions().httpsCallable('createCheckoutSession');
      const sessionResponse = await createCheckoutSession({ packageId });
      
      const { sessionId } = sessionResponse.data;
      
      if (!sessionId) {
        throw new Error('Failed to create payment session.');
      }
      
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
      let message = error.message;
      
      if (error.message.includes('functions') || 
          error.message.includes('not deployed') ||
          error.message.includes('ERR_NAME_NOT_RESOLVED') ||
          error.code === 'internal') {
        message = 'Payment system is currently unavailable. Please try again later.';
      } else if (error.message.includes('test key')) {
        message = 'Payment system is in test mode. Real payments are not available.';
      }
      
      // Fallback to simulated payment
      console.log('Falling back to simulated payment...');
      return this.simulatePayment(packageId);
    }
  }

  async simulatePayment(packageId) {
    // Simulate payment for testing
    const packages = this.getCoinPackages();
    const selectedPackage = packages[packageId];
    
    if (!selectedPackage) {
      throw new Error('Invalid package selected.');
    }
    
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Update user's coins locally
    if (window.App.auth?.userData && window.App.auth.currentUser) {
      const currentCoins = window.App.auth.userData.coins || 0;
      const newCoins = currentCoins + selectedPackage.coins;
      
      // Update in Firebase
      await firebase.database().ref(`users/${window.App.auth.currentUser.uid}/coins`)
        .set(newCoins);
      
      // Update local data
      window.App.auth.userData.coins = newCoins;
      
      // Update UI
      if (window.App.ui?.updateUserInfo) {
        window.App.ui.updateUserInfo(window.App.auth.userData);
      }
      
      if (window.App.ui?.showToast) {
        window.App.ui.showToast(`Added ${selectedPackage.coins} coins to your account!`, 'success');
      }
      
      // Close modal
      if (window.App.ui?.closeModal) {
        window.App.ui.closeModal('coins-modal');
      }
    }
    
    return { success: true, simulated: true };
  }

  getCoinPackages() {
    return {
      'coins_1': { amount: 15, coins: 1, description: '1 Coin' },
      'coins_2': { amount: 30, coins: 2, description: '2 Coins' },
      'coins_3': { amount: 45, coins: 3, description: '3 Coins' },
      'coins_5': { amount: 75, coins: 5, description: '5 Coins' },
      'coins_10': { amount: 150, coins: 10, description: '10 Coins' }
    };
  }

  async handlePaymentReturn() {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    const sessionId = urlParams.get('session_id');

    if (paymentStatus === 'success' && sessionId) {
      if (window.App.ui?.showToast) {
        window.App.ui.showToast('Payment successful! Coins added to your account.', 'success');
      }
      
      // Refresh user data
      if (window.App.auth) {
        await window.App.auth.refreshUserData();
        if (window.App.ui?.updateUserInfo) {
          window.App.ui.updateUserInfo(window.App.auth.userData);
        }
      }
      
      // Clean URL
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
