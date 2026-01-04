// Admin Dashboard - Fixed with Firebase Auth check
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🛡️ Admin dashboard loading...');
    
    // Initialize Firebase
    try {
        firebase.initializeApp({
            apiKey: "AIzaSyALbIJSI2C-p6IyMtj_F0ZqGyN1i79jOd4",
            authDomain: "whisper-chat-live.firebaseapp.com",
            databaseURL: "https://whisper-chat-live-default-rtdb.firebaseio.com",
            projectId: "whisper-chat-live",
            storageBucket: "whisper-chat-live.firebasestorage.app",
            messagingSenderId: "302894848452",
            appId: "1:302894848452:web:61a7ab21a269533c426c91"
        });
    } catch (error) {
        console.log('Firebase already initialized:', error);
    }
    
    const auth = firebase.auth();
    const db = firebase.database();
    
    // Check admin auth using custom claims
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            alert('Please login first');
            window.location.href = 'index.html';
            return;
        }
        
        try {
            const idTokenResult = await user.getIdTokenResult();
            
            if (!idTokenResult.claims.admin) {
                alert('Admin access required');
                window.location.href = 'index.html';
                return;
            }
            
            console.log('✅ Admin authenticated');
            currentAdmin = user;
            
            // Load all data
            loadDashboardStats();
            loadUsers();
            loadCalls();
            loadPayouts();
            loadDisputes();
            
        } catch (error) {
            console.error('Admin auth error:', error);
            alert('Error checking admin status');
            window.location.href = 'index.html';
        }
    });
    
    // Helper function to escape HTML to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Admin functions
    window.showTab = function(tabName) {
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        document.getElementById(tabName + '-tab').classList.add('active');
    };
    
    async function loadDashboardStats() {
        try {
            const usersSnapshot = await db.ref('users').limitToLast(1000).once('value');
            const callsSnapshot = await db.ref('calls').limitToLast(500).once('value');
            const payoutsSnapshot = await db.ref('payouts').limitToLast(500).once('value');
            const disputesSnapshot = await db.ref('callDisputes').limitToLast(200).once('value');
            
            let totalUsers = 0;
            let totalWhispers = 0;
            let totalEarnings = 0;
            let totalCalls = 0;
            let pendingPayouts = 0;
            let openDisputes = 0;
            
            usersSnapshot.forEach((child) => {
                totalUsers++;
                const user = child.val();
                if (user.isWhisper) {
                    totalWhispers++;
                }
            });
            
            callsSnapshot.forEach((child) => {
                const call = child.val();
                if (call.status === 'ended') {
                    totalCalls++;
                    totalEarnings += (call.coinsCharged || 1) * 15; // $15 per coin
                }
            });
            
            payoutsSnapshot.forEach((child) => {
                const payout = child.val();
                if (payout.status === 'pending') {
                    pendingPayouts++;
                }
            });
            
            disputesSnapshot.forEach((child) => {
                const dispute = child.val();
                if (dispute.status === 'open') {
                    openDisputes++;
                }
            });
            
            // Update UI - mark earnings as estimated
            document.getElementById('total-users').textContent = totalUsers;
            document.getElementById('total-whispers').textContent = totalWhispers;
            document.getElementById('total-earnings').textContent = `$${totalEarnings.toFixed(2)} (est.)`;
            document.getElementById('total-calls').textContent = totalCalls;
            document.getElementById('pending-payouts').textContent = pendingPayouts;
            document.getElementById('open-disputes').textContent = openDisputes;
            
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }
    
    async function loadUsers() {
        try {
            const usersSnapshot = await db.ref('users').limitToLast(1000).once('value');
            const tbody = document.getElementById('users-table');
            tbody.innerHTML = '';
            
            usersSnapshot.forEach((child) => {
                const user = child.val();
                const uid = child.key;
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><span class="user-id">${escapeHtml(user.whisperId || 'N/A')}</span></td>
                    <td>${escapeHtml(user.email || 'No email')}</td>
                    <td>${escapeHtml(user.displayName || 'Anonymous')}</td>
                    <td>${user.coins || 0}</td>
                    <td>$${(user.earnings || 0).toFixed(2)}</td>
                    <td>${user.callsCompleted || 0}</td>
                    <td>
                        <span class="badge ${user.isAvailable ? 'badge-success' : 'badge-warning'}">
                            ${user.isAvailable ? 'Online' : 'Offline'}
                        </span>
                        <!-- Admin badge removed - admin status only from custom claims -->
                    </td>
                `;
                tbody.appendChild(row);
            });
            
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }
    
    async function loadCalls() {
        try {
            const callsSnapshot = await db.ref('calls').limitToLast(500).once('value');
            const tbody = document.getElementById('calls-table');
            tbody.innerHTML = '';
            
            callsSnapshot.forEach((child) => {
                const call = child.val();
                const callId = child.key;
                
                const duration = call.duration || 0;
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><span class="user-id">${escapeHtml(callId.substring(0, 8))}...</span></td>
                    <td>${escapeHtml(call.callerName || 'Anonymous')}</td>
                    <td>${escapeHtml(call.whisperName || 'Anonymous')}</td>
                    <td>${minutes}:${seconds.toString().padStart(2, '0')}</td>
                    <td>$${((call.coinsCharged || 1) * 15).toFixed(2)}</td>
                    <td>
                        <span class="badge ${getStatusBadgeClass(call.status)}">
                            ${escapeHtml(call.status || 'unknown')}
                        </span>
                    </td>
                    <td>${formatDate(call.createdAt || Date.now())}</td>
                `;
                tbody.appendChild(row);
            });
            
        } catch (error) {
            console.error('Error loading calls:', error);
        }
    }
    
    async function loadPayouts() {
        try {
            const payoutsSnapshot = await db.ref('payouts').limitToLast(500).once('value');
            const tbody = document.getElementById('payouts-table');
            tbody.innerHTML = '';
            
            payoutsSnapshot.forEach((child) => {
                const payout = child.val();
                const payoutId = child.key;
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${escapeHtml(payout.whisperId || 'N/A')}</td>
                    <td>$${(payout.amount || 0).toFixed(2)}</td>
                    <td>${formatDate(payout.createdAt || Date.now())}</td>
                    <td>${escapeHtml(payout.paypalEmail || 'Not set')}</td>
                    <td>
                        <span class="badge ${payout.status === 'paid' ? 'badge-success' : 'badge-warning'}">
                            ${escapeHtml(payout.status || 'pending')}
                        </span>
                    </td>
                `;
                tbody.appendChild(row);
            });
            
        } catch (error) {
            console.error('Error loading payouts:', error);
        }
    }
    
    async function loadDisputes() {
        try {
            const disputesSnapshot = await db.ref('callDisputes').limitToLast(200).once('value');
            const tbody = document.getElementById('disputes-table');
            tbody.innerHTML = '';
            
            disputesSnapshot.forEach((child) => {
                const dispute = child.val();
                const disputeId = child.key;
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><span class="user-id">${escapeHtml((dispute.callId || 'N/A').substring(0, 8))}...</span></td>
                    <td>${escapeHtml(dispute.callerName || 'Anonymous')}</td>
                    <td>${escapeHtml(dispute.whisperName || 'Anonymous')}</td>
                    <td>${escapeHtml(dispute.reason || 'No reason')}</td>
                    <td>${escapeHtml((dispute.message || 'No message').substring(0, 50))}...</td>
                    <td>
                        <span class="badge ${dispute.status === 'resolved' ? 'badge-success' : 'badge-danger'}">
                            ${escapeHtml(dispute.status || 'open')}
                        </span>
                    </td>
                    <td>${formatDate(dispute.createdAt || Date.now())}</td>
                `;
                tbody.appendChild(row);
            });
            
        } catch (error) {
            console.error('Error loading disputes:', error);
        }
    }
    
    function getStatusBadgeClass(status) {
        switch(status) {
            case 'ended': return 'badge-success';
            case 'active': return 'badge-warning';
            case 'ringing': return 'badge-info';
            case 'expired': return 'badge-danger';
            case 'declined': return 'badge-danger';
            default: return 'badge-warning';
        }
    }
    
    function formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    
    window.filterCalls = function(filter) {
        const rows = document.querySelectorAll('#calls-table tr');
        rows.forEach(row => {
            const statusCell = row.querySelector('td:nth-child(6)');
            if (!statusCell) return;
            
            const status = statusCell.textContent.trim().toLowerCase();
            
            if (filter === 'all' || status.includes(filter)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    };
    
    window.searchUsers = function() {
        const searchTerm = document.getElementById('user-search').value.toLowerCase();
        const rows = document.querySelectorAll('#users-table tr');
        
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            if (text.includes(searchTerm)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    };
    
    window.logout = async function() {
        try {
            await auth.signOut();
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Logout error:', error);
            alert('Logout failed');
        }
    };
});
