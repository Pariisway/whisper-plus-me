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
    const publishableKey = window.location.hostname === 'localhost' 
      ? 'pk_test_YOUR_TEST_KEY'
      : 'pk_live_YOUR_LIVE_KEY';
    this.stripe = Stripe(publishableKey);
    return true;
  }

  async buyCoins(packageId) {
    if (!window.authManager.currentUser) throw new Error('User not authenticated');
    
    try {
      const sessionResponse = await firebase.functions().httpsCallable('createCheckoutSession')({ packageId });
      const { sessionId } = sessionResponse.data;
      const result = await this.stripe.redirectToCheckout({ sessionId });
      
      if (result.error) throw new Error(result.error.message);
      return { success: true };
    } catch (error) {
      console.error('Buy coins error:', error);
      throw error;
    }
  }

  getCoinPackages() {
    return {
      'coins_100': { amount: 9.99, coins: 100, description: '100 Coins', bonus: '' },
      'coins_250': { amount: 19.99, coins: 250, description: '250 Coins', bonus: '25% bonus' },
      'coins_500': { amount: 34.99, coins: 500, description: '500 Coins', bonus: '40% bonus' },
      'coins_1000': { amount: 59.99, coins: 1000, description: '1000 Coins', bonus: '50% bonus' }
    };
  }

  async handlePaymentReturn() {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    const sessionId = urlParams.get('session_id');

    if (paymentStatus === 'success' && sessionId) {
      window.UI.showToast('Payment successful! Coins will be added shortly.', 'success');
      await window.authManager.refreshUserData();
      window.UI.updateUI();
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (paymentStatus === 'cancelled') {
      window.UI.showToast('Payment cancelled', 'warning');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
}

window.paymentManager = new PaymentManager();
