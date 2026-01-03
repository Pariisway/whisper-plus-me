class PaymentManager {
    constructor() {
        this.stripe = Stripe('pk_live_YOUR_STRIPE_PUBLIC_KEY'); // Replace with your key
        this.elements = null;
    }
    
    async createCheckout(options) {
        try {
            const response = await fetch('/create-checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    price: options.price,
                    coins: options.coins,
                    userId: window.App.currentUser.uid
                })
            });
            
            const session = await response.json();
            
            const result = await this.stripe.redirectToCheckout({
                sessionId: session.id
            });
            
            if (result.error) {
                showToast(result.error.message, 'error');
            }
            
        } catch (error) {
            console.error('Payment error:', error);
            showToast('Payment failed. Please try again.', 'error');
        }
    }
    
    async handlePaymentSuccess(sessionId) {
        try {
            const response = await fetch('/payment-success', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sessionId })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showToast(`Success! ${result.coins} coins added to your account.`, 'success');
                // Update user coins
                window.App.userData.coins = (window.App.userData.coins || 0) + result.coins;
                document.getElementById('coin-balance').textContent = `${window.App.userData.coins} Coins`;
            }
            
        } catch (error) {
            console.error('Error processing payment:', error);
        }
    }
}

window.PaymentManager = PaymentManager;
window.paymentManager = new PaymentManager();
