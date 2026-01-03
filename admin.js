// Whisper+me Admin Panel
console.log('🔐 Admin Panel Loading...');

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyALbIJSI2C-p6IyMtj_F0ZqGyN1i79jOd4",
    authDomain: "whisper-chat-live.firebaseapp.com",
    databaseURL: "https://whisper-chat-live-default-rtdb.firebaseio.com",
    projectId: "whisper-chat-live",
    storageBucket: "whisper-chat-live.firebasestorage.app",
    messagingSenderId: "302894848452",
    appId: "1:302894848452:web:61a7ab21a269533c426c91"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// Global State
let currentAdmin = null;
let usersData = [];
let callsData = [];
let transactionsData = [];
let reviewsData = [];

// DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('📊 Admin Panel Initializing...');
    
    // Check authentication
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // Check if user is admin
            const userSnap = await db.ref(`users/${user.uid}`).once('value');
            const userData = userSnap.val();
            
            if (userData && userData.isAdmin) {
                currentAdmin = user;
                console.log('✅ Admin authenticated:', user.email);
                initAdminPanel();
            } else {
                showNotification('Access denied. Admin privileges required.', 'error');
                setTimeout(() => window.location.href = 'index.html', 2000);
            }
        } else {
            // Not logged in, redirect to main site
            window.location.href = 'index.html';
        }
    });
});

function initAdminPanel() {
    // Load dashboard data
    loadDashboardStats();
    loadRecentCalls();
    loadRecentUsers();
    
    // Set up section switching
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    // Set up auto-refresh every 30 seconds
    setInterval(() => {
        if (document.getElementById('dashboard-section').classList.contains('active')) {
            loadDashboardStats();
        }
    }, 30000);
}

// Section Management
function showSection(sectionId) {
    document.querySelectorAll('.admin-section').forEach(section => {
        section.classList.remove('active');
    });
    
    document.getElementById(`${sectionId}-section`).classList.add('active');
    
    // Load section-specific data
    switch(sectionId) {
        case 'dashboard':
            loadDashboardStats();
            loadRecentCalls();
            loadRecentUsers();
            break;
        case 'users':
            loadUsers();
            break;
        case 'calls':
            loadCalls();
            break;
        case 'transactions':
            loadTransactions();
            break;
        case 'reviews':
            loadReviews();
            break;
    }
}

// Dashboard Functions
async function loadDashboardStats() {
    try {
        // Load all data in parallel
        const [usersSnap, callsSnap, transactionsSnap, reviewsSnap] = await Promise.all([
            db.ref('users').once('value'),
            db.ref('calls').once('value'),
            db.ref('transactions').once('value'),
            db.ref('reviews').once('value')
        ]);
        
        // Process users
        const users = usersSnap.val() || {};
        const totalUsers = Object.keys(users).length;
        const whispers = Object.values(users).filter(u => u.isWhisper).length;
        const activeWhispers = Object.values(users).filter(u => u.isWhisper && u.isAvailable).length;
        
        // Process calls
        const calls = callsSnap.val() || {};
        const totalCalls = Object.keys(calls).length;
        const completedCalls = Object.values(calls).filter(c => c.status === 'completed').length;
        
        // Process transactions
        const transactions = transactionsSnap.val() || {};
        let totalRevenue = 0;
        let totalCoinsSold = 0;
        
        Object.values(transactions).forEach(t => {
            if (t.status === 'completed') {
                totalRevenue += t.price || 0;
                totalCoinsSold += t.coinsAdded || 0;
            }
        });
        
        // Process reviews
        const reviews = reviewsSnap.val() || {};
        const totalReviews = Object.keys(reviews).length;
        let totalRating = 0;
        
        Object.values(reviews).forEach(r => {
            totalRating += r.rating;
        });
        
        const avgRating = totalReviews > 0 ? (totalRating / totalReviews).toFixed(1) : '0.0';
        
        // Calculate total payouts (whispers earn 80% of revenue)
        const totalPayouts = totalRevenue * 0.8;
        
        // Update dashboard stats
        document.getElementById('total-users').textContent = totalUsers;
        document.getElementById('total-calls').textContent = totalCalls;
        document.getElementById('total-revenue').textContent = `$${totalRevenue}`;
        document.getElementById('total-payouts').textContent = `$${totalPayouts.toFixed(2)}`;
        document.getElementById('active-whispers').textContent = activeWhispers;
        document.getElementById('avg-rating').textContent = avgRating;
        
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
        showNotification('Failed to load dashboard data', 'error');
    }
}

async function loadRecentCalls() {
    try {
        const callsSnap = await db.ref('calls').orderByChild('createdAt').limitToLast(10).once('value');
        const calls = callsSnap.val() || {};
        
        const tableBody = document.getElementById('recent-calls-body');
        tableBody.innerHTML = '';
        
        // Convert to array and sort by date
        const callsArray = Object.entries(calls).map(([id, call]) => ({ id, ...call }));
        callsArray.sort((a, b) => b.createdAt - a.createdAt);
        
        for (const call of callsArray.slice(0, 10)) {
            // Get user names
            const callerSnap = await db.ref(`publicProfiles/${call.callerId}`).once('value');
            const whisperSnap = await db.ref(`publicProfiles/${call.whisperId}`).once('value');
            
            const callerName = callerSnap.val()?.displayName || 'Unknown';
            const whisperName = whisperSnap.val()?.displayName || 'Unknown';
            
            // Calculate duration
            let duration = 'N/A';
            if (call.answeredAt && call.endedAt) {
                const mins = Math.floor((call.endedAt - call.answeredAt) / 60000);
                const secs = Math.floor(((call.endedAt - call.answeredAt) % 60000) / 1000);
                duration = `${mins}m ${secs}s`;
            }
            
            // Format time
            const startedTime = new Date(call.createdAt).toLocaleString();
            const endedTime = call.endedAt ? new Date(call.endedAt).toLocaleString() : 'N/A';
            
            // Status badge
            let statusBadge = '';
            switch(call.status) {
                case 'completed':
                    statusBadge = '<span class="badge badge-success">Completed</span>';
                    break;
                case 'cancelled':
                    statusBadge = '<span class="badge badge-warning">Cancelled</span>';
                    break;
                case 'expired':
                    statusBadge = '<span class="badge badge-danger">Expired</span>';
                    break;
                case 'active':
                    statusBadge = '<span class="badge badge-info">Active</span>';
                    break;
                case 'ringing':
                    statusBadge = '<span class="badge badge-info">Ringing</span>';
                    break;
                default:
                    statusBadge = `<span class="badge">${call.status}</span>`;
            }
            
            const row = `
                <tr>
                    <td><small style="color: #666;">${call.id.substring(0, 8)}...</small></td>
                    <td>${callerName}</td>
                    <td>${whisperName}</td>
                    <td>${duration}</td>
                    <td>${call.callPrice || 1} coin</td>
                    <td>${statusBadge}</td>
                    <td><small>${startedTime}</small></td>
                </tr>
            `;
            
            tableBody.innerHTML += row;
        }
        
    } catch (error) {
        console.error('Error loading recent calls:', error);
        document.getElementById('recent-calls-body').innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: #666;">
                    <i class="fas fa-exclamation-triangle"></i> Failed to load calls
                </td>
            </tr>
        `;
    }
}

async function loadRecentUsers() {
    try {
        const usersSnap = await db.ref('users').orderByChild('createdAt').limitToLast(10).once('value');
        const users = usersSnap.val() || {};
        
        const tableBody = document.getElementById('recent-users-body');
        tableBody.innerHTML = '';
        
        // Convert to array and sort by date
        const usersArray = Object.entries(users).map(([id, user]) => ({ id, ...user }));
        usersArray.sort((a, b) => b.createdAt - a.createdAt);
        
        for (const user of usersArray.slice(0, 10)) {
            // Get profile data
            const profileSnap = await db.ref(`publicProfiles/${user.id}`).once('value');
            const profile = profileSnap.val() || {};
            
            // Status indicator
            const statusDot = profile.isAvailable ? 
                '<span class="user-status status-online"></span>' : 
                '<span class="user-status status-offline"></span>';
            
            const statusText = profile.isWhisper ? 'Whisper' : 'Caller';
            
            // Format join date
            const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A';
            
            const row = `
                <tr>
                    <td>
                        ${statusDot}
                        <strong>${profile.displayName || user.email?.split('@')[0] || 'User'}</strong>
                    </td>
                    <td><small>${user.email || 'No email'}</small></td>
                    <td><code>${user.whisperId || 'N/A'}</code></td>
                    <td>${user.coins || 0}</td>
                    <td>$${user.earnings || 0}</td>
                    <td>${statusText}</td>
                    <td><small>${joinDate}</small></td>
                </tr>
            `;
            
            tableBody.innerHTML += row;
        }
        
    } catch (error) {
        console.error('Error loading recent users:', error);
        document.getElementById('recent-users-body').innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: #666;">
                    <i class="fas fa-exclamation-triangle"></i> Failed to load users
                </td>
            </tr>
        `;
    }
}

// User Management
async function loadUsers(page = 1, search = '', filters = {}) {
    try {
        const usersSnap = await db.ref('users').once('value');
        const users = usersSnap.val() || {};
        
        // Convert to array
        let usersArray = Object.entries(users).map(([id, user]) => ({ id, ...user }));
        
        // Apply search
        if (search) {
            usersArray = usersArray.filter(user => {
                const email = user.email || '';
                const name = user.displayName || '';
                const whisperId = user.whisperId || '';
                
                return email.toLowerCase().includes(search.toLowerCase()) ||
                       name.toLowerCase().includes(search.toLowerCase()) ||
                       whisperId.toLowerCase().includes(search.toLowerCase());
            });
        }
        
        // Apply filters
        if (filters.type) {
            if (filters.type === 'whisper') {
                usersArray = usersArray.filter(user => user.isWhisper);
            } else if (filters.type === 'caller') {
                usersArray = usersArray.filter(user => !user.isWhisper);
            } else if (filters.type === 'admin') {
                usersArray = usersArray.filter(user => user.isAdmin);
            }
        }
        
        if (filters.status) {
            // This would need more sophisticated status tracking
        }
        
        // Apply sorting
        if (filters.sort === 'oldest') {
            usersArray.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        } else if (filters.sort === 'coins') {
            usersArray.sort((a, b) => (b.coins || 0) - (a.coins || 0));
        } else if (filters.sort === 'earnings') {
            usersArray.sort((a, b) => (b.earnings || 0) - (a.earnings || 0));
        } else {
            // Default: most recent
            usersArray.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        }
        
        // Pagination
        const pageSize = 20;
        const totalPages = Math.ceil(usersArray.length / pageSize);
        const startIdx = (page - 1) * pageSize;
        const endIdx = startIdx + pageSize;
        const pageUsers = usersArray.slice(startIdx, endIdx);
        
        // Load profile data for each user
        const usersWithProfiles = await Promise.all(
            pageUsers.map(async (user) => {
                const profileSnap = await db.ref(`publicProfiles/${user.id}`).once('value');
                return {
                    ...user,
                    profile: profileSnap.val() || {}
                };
            })
        );
        
        // Update table
        updateUsersTable(usersWithProfiles);
        
        // Update pagination
        updatePagination('users', page, totalPages);
        
    } catch (error) {
        console.error('Error loading users:', error);
        showNotification('Failed to load users', 'error');
    }
}

function updateUsersTable(users) {
    const tableBody = document.getElementById('users-table-body');
    tableBody.innerHTML = '';
    
    if (users.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 3rem; color: #666;">
                    <i class="fas fa-users-slash"></i> No users found
                </td>
            </tr>
        `;
        return;
    }
    
    users.forEach(user => {
        const profile = user.profile;
        const statusDot = profile.isAvailable ? 
            '<span class="user-status status-online"></span>' : 
            '<span class="user-status status-offline"></span>';
        
        // User role
        let role = 'Caller';
        if (user.isAdmin) {
            role = '<span class="badge badge-danger">Admin</span>';
        } else if (user.isWhisper) {
            role = '<span class="badge badge-success">Whisper</span>';
        }
        
        // Account status
        let status = '<span class="badge badge-success">Active</span>';
        // Add more status logic as needed
        
        // Rating
        const rating = profile.rating ? profile.rating.toFixed(1) : 'N/A';
        
        const row = `
            <tr>
                <td>
                    ${statusDot}
                    <strong>${profile.displayName || user.email?.split('@')[0] || 'User'}</strong>
                    <br><small style="color: #666;">${user.id.substring(0, 8)}...</small>
                </td>
                <td><small>${user.email || 'No email'}</small></td>
                <td>${role}</td>
                <td><strong>${user.coins || 0}</strong></td>
                <td>$${user.earnings || 0}</td>
                <td>${profile.callsCompleted || 0}</td>
                <td>${rating}</td>
                <td>${status}</td>
                <td>
                    <button class="action-btn btn-primary" onclick="editUser('${user.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${!user.isAdmin ? `
                    <button class="action-btn btn-danger" onclick="deleteUser('${user.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                    ` : ''}
                </td>
            </tr>
        `;
        
        tableBody.innerHTML += row;
    });
}

function searchUsers() {
    const searchTerm = document.getElementById('user-search').value;
    const typeFilter = document.getElementById('user-type-filter').value;
    const statusFilter = document.getElementById('user-status-filter').value;
    const sortBy = document.getElementById('user-sort').value;
    
    const filters = {
        type: typeFilter,
        status: statusFilter,
        sort: sortBy
    };
    
    loadUsers(1, searchTerm, filters);
}

function editUser(userId) {
    // Load user data and show edit modal
    db.ref(`users/${userId}`).once('value').then(userSnap => {
        db.ref(`publicProfiles/${userId}`).once('value').then(profileSnap => {
            const user = userSnap.val();
            const profile = profileSnap.val() || {};
            
            // Fill modal fields
            document.getElementById('edit-user-id').value = userId;
            document.getElementById('edit-user-email').value = user.email || '';
            document.getElementById('edit-user-name').value = profile.displayName || '';
            document.getElementById('edit-user-whisper-id').value = user.whisperId || '';
            document.getElementById('edit-user-coins').value = user.coins || 0;
            document.getElementById('edit-user-earnings').value = user.earnings || 0;
            
            // Set role
            const roleSelect = document.getElementById('edit-user-role');
            if (user.isAdmin) {
                roleSelect.value = 'admin';
            } else if (user.isWhisper) {
                roleSelect.value = 'whisper';
            } else {
                roleSelect.value = 'user';
            }
            
            // Set status (simplified)
            document.getElementById('edit-user-status').value = 'active';
            
            // Show modal
            showModal('edit-user-modal');
        });
    });
}

async function saveUserChanges() {
    const userId = document.getElementById('edit-user-id').value;
    const displayName = document.getElementById('edit-user-name').value;
    const whisperId = document.getElementById('edit-user-whisper-id').value;
    const coins = parseInt(document.getElementById('edit-user-coins').value);
    const earnings = parseFloat(document.getElementById('edit-user-earnings').value);
    const role = document.getElementById('edit-user-role').value;
    const status = document.getElementById('edit-user-status').value;
    
    try {
        // Update user data
        const updates = {
            coins: coins,
            earnings: earnings,
            whisperId: whisperId,
            isWhisper: role === 'whisper' || role === 'admin',
            isAdmin: role === 'admin'
        };
        
        await db.ref(`users/${userId}`).update(updates);
        
        // Update profile
        await db.ref(`publicProfiles/${userId}`).update({
            displayName: displayName,
            isWhisper: role === 'whisper' || role === 'admin'
        });
        
        // Handle status changes
        if (status === 'banned') {
            // Additional logic for banning user
            await db.ref(`publicProfiles/${userId}`).update({
                isAvailable: false
            });
        }
        
        closeModal('edit-user-modal');
        showNotification('User updated successfully', 'success');
        
        // Refresh users table
        loadUsers();
        
    } catch (error) {
        console.error('Error updating user:', error);
        showNotification('Failed to update user', 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
        return;
    }
    
    try {
        // Mark user as deleted instead of actually deleting
        await db.ref(`users/${userId}`).update({
            isDeleted: true,
            deletedAt: Date.now(),
            deletedBy: currentAdmin.uid
        });
        
        await db.ref(`publicProfiles/${userId}`).update({
            isAvailable: false,
            isDeleted: true
        });
        
        showNotification('User marked as deleted', 'success');
        loadUsers();
        
    } catch (error) {
        console.error('Error deleting user:', error);
        showNotification('Failed to delete user', 'error');
    }
}

function exportUsers() {
    // This would generate a CSV file in a real implementation
    showNotification('Export feature coming soon', 'info');
}

// Call Management
async function loadCalls(page = 1, search = '', filters = {}) {
    try {
        const callsSnap = await db.ref('calls').once('value');
        const calls = callsSnap.val() || {};
        
        // Convert to array
        let callsArray = Object.entries(calls).map(([id, call]) => ({ id, ...call }));
        
        // Apply filters
        if (filters.status) {
            callsArray = callsArray.filter(call => call.status === filters.status);
        }
        
        if (filters.date) {
            const now = Date.now();
            let cutoff = 0;
            
            switch(filters.date) {
                case 'today':
                    cutoff = now - (24 * 60 * 60 * 1000);
                    break;
                case 'week':
                    cutoff = now - (7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    cutoff = now - (30 * 24 * 60 * 60 * 1000);
                    break;
            }
            
            if (cutoff > 0) {
                callsArray = callsArray.filter(call => call.createdAt >= cutoff);
            }
        }
        
        // Apply search
        if (search) {
            // This would search by user names in a real implementation
        }
        
        // Sort by date (newest first)
        callsArray.sort((a, b) => b.createdAt - a.createdAt);
        
        // Pagination
        const pageSize = 20;
        const totalPages = Math.ceil(callsArray.length / pageSize);
        const startIdx = (page - 1) * pageSize;
        const endIdx = startIdx + pageSize;
        const pageCalls = callsArray.slice(startIdx, endIdx);
        
        // Load user data for each call
        const callsWithUsers = await Promise.all(
            pageCalls.map(async (call) => {
                const [callerSnap, whisperSnap] = await Promise.all([
                    db.ref(`publicProfiles/${call.callerId}`).once('value'),
                    db.ref(`publicProfiles/${call.whisperId}`).once('value')
                ]);
                
                return {
                    ...call,
                    callerName: callerSnap.val()?.displayName || 'Unknown',
                    whisperName: whisperSnap.val()?.displayName || 'Unknown'
                };
            })
        );
        
        // Update table
        updateCallsTable(callsWithUsers);
        
        // Update pagination
        updatePagination('calls', page, totalPages);
        
    } catch (error) {
        console.error('Error loading calls:', error);
        showNotification('Failed to load calls', 'error');
    }
}

function updateCallsTable(calls) {
    const tableBody = document.getElementById('calls-table-body');
    tableBody.innerHTML = '';
    
    if (calls.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 3rem; color: #666;">
                    <i class="fas fa-phone-slash"></i> No calls found
                </td>
            </tr>
        `;
        return;
    }
    
    calls.forEach(call => {
        // Calculate duration
        let duration = 'N/A';
        if (call.answeredAt && call.endedAt) {
            const mins = Math.floor((call.endedAt - call.answeredAt) / 60000);
            const secs = Math.floor(((call.endedAt - call.answeredAt) % 60000) / 1000);
            duration = `${mins}m ${secs}s`;
        }
        
        // Earnings (whisper earns $12 per coin)
        const earnings = (call.callPrice || 1) * 12;
        
        // Status badge
        let statusBadge = '';
        switch(call.status) {
            case 'completed':
                statusBadge = '<span class="badge badge-success">Completed</span>';
                break;
            case 'cancelled':
                statusBadge = '<span class="badge badge-warning">Cancelled</span>';
                break;
            case 'expired':
                statusBadge = '<span class="badge badge-danger">Expired</span>';
                break;
            case 'active':
                statusBadge = '<span class="badge badge-info">Active</span>';
                break;
            default:
                statusBadge = `<span class="badge">${call.status}</span>`;
        }
        
        // Format times
        const startedTime = new Date(call.createdAt).toLocaleString();
        const endedTime = call.endedAt ? new Date(call.endedAt).toLocaleString() : 'N/A';
        
        const row = `
            <tr>
                <td><small style="color: #666;">${call.id.substring(0, 8)}...</small></td>
                <td>${call.callerName}</td>
                <td>${call.whisperName}</td>
                <td>${duration}</td>
                <td>${call.callPrice || 1} coin</td>
                <td>$${earnings}</td>
                <td>${statusBadge}</td>
                <td><small>${startedTime}</small></td>
                <td><small>${endedTime}</small></td>
            </tr>
        `;
        
        tableBody.innerHTML += row;
    });
}

function searchCalls() {
    const searchTerm = document.getElementById('call-search').value;
    const statusFilter = document.getElementById('call-status-filter').value;
    const dateFilter = document.getElementById('call-date-filter').value;
    
    const filters = {
        status: statusFilter,
        date: dateFilter
    };
    
    loadCalls(1, searchTerm, filters);
}

// Transaction Management
async function loadTransactions(page = 1, search = '', filters = {}) {
    try {
        const transactionsSnap = await db.ref('transactions').once('value');
        const transactions = transactionsSnap.val() || {};
        
        // Convert to array
        let transactionsArray = Object.entries(transactions).map(([id, trans]) => ({ id, ...trans }));
        
        // Sort by date (newest first)
        transactionsArray.sort((a, b) => b.createdAt - a.createdAt);
        
        // Calculate stats
        let totalAmount = 0;
        let totalCoins = 0;
        let todayAmount = 0;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        transactionsArray.forEach(trans => {
            if (trans.status === 'completed') {
                totalAmount += trans.price || 0;
                totalCoins += trans.coinsAdded || 0;
                
                const transDate = new Date(trans.createdAt);
                if (transDate >= today) {
                    todayAmount += trans.price || 0;
                }
            }
        });
        
        const avgOrder = transactionsArray.length > 0 ? totalAmount / transactionsArray.length : 0;
        
        // Update stats
        document.getElementById('total-transactions').textContent = `$${totalAmount.toFixed(2)}`;
        document.getElementById('total-coins-sold').textContent = totalCoins;
        document.getElementById('today-revenue').textContent = `$${todayAmount.toFixed(2)}`;
        document.getElementById('avg-order').textContent = `$${avgOrder.toFixed(2)}`;
        
        // Pagination
        const pageSize = 20;
        const totalPages = Math.ceil(transactionsArray.length / pageSize);
        const startIdx = (page - 1) * pageSize;
        const endIdx = startIdx + pageSize;
        const pageTransactions = transactionsArray.slice(startIdx, endIdx);
        
        // Load user data for each transaction
        const transactionsWithUsers = await Promise.all(
            pageTransactions.map(async (trans) => {
                const userSnap = await db.ref(`users/${trans.userId}`).once('value');
                const user = userSnap.val() || {};
                
                return {
                    ...trans,
                    userName: user.email?.split('@')[0] || 'Unknown'
                };
            })
        );
        
        // Update table
        updateTransactionsTable(transactionsWithUsers);
        
        // Update pagination
        updatePagination('transactions', page, totalPages);
        
    } catch (error) {
        console.error('Error loading transactions:', error);
        showNotification('Failed to load transactions', 'error');
    }
}

function updateTransactionsTable(transactions) {
    const tableBody = document.getElementById('transactions-table-body');
    tableBody.innerHTML = '';
    
    if (transactions.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 3rem; color: #666;">
                    <i class="fas fa-receipt"></i> No transactions found
                </td>
            </tr>
        `;
        return;
    }
    
    transactions.forEach(trans => {
        // Status badge
        let statusBadge = '';
        switch(trans.status) {
            case 'completed':
                statusBadge = '<span class="badge badge-success">Completed</span>';
                break;
            case 'pending':
                statusBadge = '<span class="badge badge-warning">Pending</span>';
                break;
            case 'failed':
                statusBadge = '<span class="badge badge-danger">Failed</span>';
                break;
            default:
                statusBadge = `<span class="badge">${trans.status}</span>`;
        }
        
        // Format date
        const transDate = new Date(trans.createdAt).toLocaleString();
        
        const row = `
            <tr>
                <td><small style="color: #666;">${trans.id.substring(0, 8)}...</small></td>
                <td>${trans.userName}</td>
                <td>Coin Purchase</td>
                <td><strong>$${trans.price || 0}</strong></td>
                <td>${trans.coinsAdded || 0} coins</td>
                <td>${statusBadge}</td>
                <td><small>${transDate}</small></td>
                <td>
                    <button class="action-btn btn-primary" onclick="viewTransaction('${trans.id}')">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `;
        
        tableBody.innerHTML += row;
    });
}

function viewTransaction(transactionId) {
    // Load transaction data
    db.ref(`transactions/${transactionId}`).once('value').then(transSnap => {
        const trans = transSnap.val();
        
        // Load user data
        db.ref(`users/${trans.userId}`).once('value').then(userSnap => {
            const user = userSnap.val() || {};
            
            // Fill modal
            document.getElementById('view-transaction-id').value = transactionId;
            document.getElementById('view-transaction-user').value = user.email || 'Unknown';
            document.getElementById('view-transaction-amount').value = `$${trans.price || 0}`;
            document.getElementById('view-transaction-coins').value = trans.coinsAdded || 0;
            document.getElementById('view-transaction-status').value = trans.status || 'Unknown';
            document.getElementById('view-transaction-date').value = new Date(trans.createdAt).toLocaleString();
            
            // Show modal
            showModal('view-transaction-modal');
        });
    });
}

function searchTransactions() {
    const searchTerm = document.getElementById('transaction-search').value;
    loadTransactions(1, searchTerm);
}

// Review Management
async function loadReviews(page = 1, search = '', filters = {}) {
    try {
        const reviewsSnap = await db.ref('reviews').once('value');
        const reviews = reviewsSnap.val() || {};
        
        // Convert to array
        let reviewsArray = Object.entries(reviews).map(([id, review]) => ({ id, ...review }));
        
        // Sort by date (newest first)
        reviewsArray.sort((a, b) => b.createdAt - a.createdAt);
        
        // Calculate stats
        const totalReviews = reviewsArray.length;
        let totalRating = 0;
        let positiveReviews = 0;
        let negativeReviews = 0;
        
        reviewsArray.forEach(review => {
            totalRating += review.rating;
            if (review.rating >= 4) {
                positiveReviews++;
            } else if (review.rating <= 2) {
                negativeReviews++;
            }
        });
        
        const avgRating = totalReviews > 0 ? (totalRating / totalReviews).toFixed(1) : '0.0';
        
        // Update stats
        document.getElementById('avg-platform-rating').textContent = avgRating;
        document.getElementById('total-reviews').textContent = totalReviews;
        document.getElementById('positive-reviews').textContent = positiveReviews;
        document.getElementById('negative-reviews').textContent = negativeReviews;
        
        // Pagination
        const pageSize = 20;
        const totalPages = Math.ceil(reviewsArray.length / pageSize);
        const startIdx = (page - 1) * pageSize;
        const endIdx = startIdx + pageSize;
        const pageReviews = reviewsArray.slice(startIdx, endIdx);
        
        // Load user data for each review
        const reviewsWithUsers = await Promise.all(
            pageReviews.map(async (review) => {
                const [fromUserSnap, toUserSnap] = await Promise.all([
                    db.ref(`users/${review.reviewerId}`).once('value'),
                    db.ref(`users/${review.ratedUserId}`).once('value')
                ]);
                
                return {
                    ...review,
                    fromUserName: fromUserSnap.val()?.email?.split('@')[0] || 'Unknown',
                    toUserName: toUserSnap.val()?.email?.split('@')[0] || 'Unknown'
                };
            })
        );
        
        // Update table
        updateReviewsTable(reviewsWithUsers);
        
        // Update pagination
        updatePagination('reviews', page, totalPages);
        
    } catch (error) {
        console.error('Error loading reviews:', error);
        showNotification('Failed to load reviews', 'error');
    }
}

function updateReviewsTable(reviews) {
    const tableBody = document.getElementById('reviews-table-body');
    tableBody.innerHTML = '';
    
    if (reviews.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 3rem; color: #666;">
                    <i class="fas fa-star"></i> No reviews found
                </td>
            </tr>
        `;
        return;
    }
    
    reviews.forEach(review => {
        // Stars display
        let stars = '';
        for (let i = 1; i <= 5; i++) {
            if (i <= review.rating) {
                stars += '<i class="fas fa-star" style="color: #fbbf24;"></i>';
            } else {
                stars += '<i class="far fa-star" style="color: #ddd;"></i>';
            }
        }
        
        // Format date
        const reviewDate = new Date(review.createdAt).toLocaleString();
        
        // Truncate long comments
        const comment = review.comment || '';
        const truncatedComment = comment.length > 50 ? comment.substring(0, 50) + '...' : comment;
        
        const row = `
            <tr>
                <td><small style="color: #666;">${review.id.substring(0, 8)}...</small></td>
                <td>${review.fromUserName}</td>
                <td>${review.toUserName}</td>
                <td>
                    ${stars}
                    <br><small>${review.rating}/5</small>
                </td>
                <td title="${comment}">${truncatedComment}</td>
                <td><small style="color: #666;">${review.callId?.substring(0, 8) || 'N/A'}...</small></td>
                <td><small>${reviewDate}</small></td>
                <td>
                    <button class="action-btn btn-danger" onclick="deleteReview('${review.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
        
        tableBody.innerHTML += row;
    });
}

async function deleteReview(reviewId) {
    if (!confirm('Are you sure you want to delete this review?')) {
        return;
    }
    
    try {
        await db.ref(`reviews/${reviewId}`).remove();
        showNotification('Review deleted successfully', 'success');
        loadReviews();
        
    } catch (error) {
        console.error('Error deleting review:', error);
        showNotification('Failed to delete review', 'error');
    }
}

function searchReviews() {
    const searchTerm = document.getElementById('review-search').value;
    loadReviews(1, searchTerm);
}

// Utility Functions
function updatePagination(type, currentPage, totalPages) {
    const paginationDiv = document.getElementById(`${type}-pagination`);
    if (!paginationDiv) return;
    
    if (totalPages <= 1) {
        paginationDiv.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Previous button
    if (currentPage > 1) {
        html += `<button class="page-btn" onclick="load${type.charAt(0).toUpperCase() + type.slice(1)}(${currentPage - 1})">Previous</button>`;
    }
    
    // Page numbers
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="load${type.charAt(0).toUpperCase() + type.slice(1)}(${i})">${i}</button>`;
    }
    
    // Next button
    if (currentPage < totalPages) {
        html += `<button class="page-btn" onclick="load${type.charAt(0).toUpperCase() + type.slice(1)}(${currentPage + 1})">Next</button>`;
    }
    
    paginationDiv.innerHTML = html;
}

function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = 'notification';
    notification.style.display = 'block';
    
    if (type === 'error') {
        notification.classList.add('error');
    }
    
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

function logout() {
    auth.signOut().then(() => {
        window.location.href = 'index.html';
    }).catch(error => {
        console.error('Logout error:', error);
    });
}

// Initialize pagination functions
window.loadUsers = loadUsers;
window.loadCalls = loadCalls;
window.loadTransactions = loadTransactions;
window.loadReviews = loadReviews;

console.log('🎉 Admin Panel Ready!');
