// Stripe payments - Loaded on demand
console.log('💰 Payments system ready');

// Global function to load Stripe SDK
window.loadStripeSDK = function() {
    return new Promise((resolve, reject) => {
        if (window.Stripe) {
            resolve(window.Stripe);
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://js.stripe.com/v3/';
        script.onload = () => resolve(window.Stripe);
        script.onerror = reject;
        document.head.appendChild(script);
    });
};

// Minimal Payments manager
window.PaymentsManager = {
    async buyCoins(amount = 10) {
        try {
            await loadStripeSDK();
            // For now, show a message
            alert('Payment system will be integrated soon. For now, contact admin for coins.');
            return null;
        } catch (error) {
            console.error('Payments error:', error);
            return null;
        }
    }
};
