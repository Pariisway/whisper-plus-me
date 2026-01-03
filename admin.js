class AdminManager {
    constructor() {
        this.adminUsers = ['YOUR_ADMIN_UID']; // Add your admin UID
    }
    
    async verifyAdmin(userId) {
        const snapshot = await firebase.database().ref('users/' + userId).once('value');
        const userData = snapshot.val();
        return userData && userData.isAdmin === true;
    }
    
    async addCoinsToUser(userId, coins, reason) {
        if (!await this.verifyAdmin(window.App.currentUser.uid)) {
            throw new Error('Admin access required');
        }
        
        // Get current coins
        const snapshot = await firebase.database().ref('users/' + userId + '/coins').once('value');
        const currentCoins = snapshot.val() || 0;
        
        // Update coins
        await firebase.database().ref('users/' + userId).update({
            coins: currentCoins + coins
        });
        
        // Log admin action
        await firebase.database().ref('admin/actions').push({
            adminId: window.App.currentUser.uid,
            targetUserId: userId,
            action: 'add_coins',
            amount: coins,
            reason: reason,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    async refundCall(callId, reason) {
        if (!await this.verifyAdmin(window.App.currentUser.uid)) {
            throw new Error('Admin access required');
        }
        
        const callSnapshot = await firebase.database().ref('calls/' + callId).once('value');
        const call = callSnapshot.val();
        
        if (!call) {
            throw new Error('Call not found');
        }
        
        // Refund coin to caller
        const callerSnapshot = await firebase.database().ref('users/' + call.callerId + '/coins').once('value');
        const callerCoins = callerSnapshot.val() || 0;
        
        await firebase.database().ref('users/' + call.callerId).update({
            coins: callerCoins + call.price
        });
        
        // Mark call as refunded
        await firebase.database().ref('calls/' + callId).update({
            status: 'refunded',
            refundReason: reason,
            refundedAt: Date.now()
        });
        
        // Log admin action
        await firebase.database().ref('admin/actions').push({
            adminId: window.App.currentUser.uid,
            callId: callId,
            action: 'refund',
            amount: call.price,
            reason: reason,
            timestamp: Date.now()
        });
        
        return true;
    }
    
    async getFlaggedCalls() {
        const snapshot = await firebase.database().ref('calls')
            .orderByChild('status')
            .equalTo('flagged')
            .once('value');
        
        return snapshot.val() || {};
    }
    
    async sendAdminNotification(message, type = 'info') {
        await firebase.database().ref('admin/notifications').push({
            message: message,
            type: type,
            timestamp: Date.now(),
            read: false
        });
    }
}

window.AdminManager = AdminManager;
window.adminManager = new AdminManager();
