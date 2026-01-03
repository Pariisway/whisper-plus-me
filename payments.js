// Stripe payments - Server-controlled payments
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

// Payments manager with server-side validation
window.PaymentsManager = {
    async buyCoins(amount = 10) {
        try {
            if (!window.firebase || !window.firebase.functions) {
                throw new Error('Firebase not initialized');
            }
            
            const buyCoinsFn = window.firebase.functions().httpsCallable('buyCoins');
            const result = await buyCoinsFn({ amount });
            
            return result.data;
        } catch (error) {
            console.error('Payments error:', error);
            this.showToast(error.message, 'error');
            return null;
        }
    },
    
    showToast(message, type = 'info') {
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
            border-radius: 8px;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
};
