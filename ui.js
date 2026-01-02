// Simple UI Manager
console.log('🎨 UI Manager loaded');

class UIManager {
    constructor() {
        this.modals = {};
    }
    
    initialize() {
        console.log('UI Manager initialized');
    }
    
    showToast(message, type = 'info') {
        console.log(`Toast [${type}]: ${message}`);
        
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            padding: 12px 24px;
            border-radius: 6px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            z-index: 9999;
            animation: slideIn 0.3s ease;
            border-left: 4px solid #667eea;
        `;
        
        if (type === 'success') toast.style.borderLeftColor = '#28a745';
        if (type === 'error') toast.style.borderLeftColor = '#dc3545';
        if (type === 'warning') toast.style.borderLeftColor = '#ffc107';
        
        document.body.appendChild(toast);
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
    
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
        }
    }
    
    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    updateUserUI(user, userData) {
        const userMenu = document.getElementById('user-menu');
        if (!userMenu) return;
        
        if (user) {
            userMenu.innerHTML = `
                <div class="user-info">
                    <span class="user-avatar">
                        ${user.email?.charAt(0).toUpperCase() || 'U'}
                    </span>
                    <span class="user-name">${user.email || 'User'}</span>
                    <div class="user-actions">
                        <button class="btn btn-coins">
                            <i class="fas fa-coins"></i> ${userData?.coins || 0} Coins
                        </button>
                        <button class="btn btn-logout" onclick="logout()">
                            <i class="fas fa-sign-out-alt"></i>
                        </button>
                    </div>
                </div>
            `;
        } else {
            userMenu.innerHTML = `
                <button class="btn btn-outline" onclick="showLoginModal()">
                    <i class="fas fa-sign-in-alt"></i> Sign In
                </button>
            `;
        }
    }
}

window.UIManager = UIManager;
