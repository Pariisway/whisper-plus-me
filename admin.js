// admin.js - Production Admin Dashboard
console.log('🛡️ Admin dashboard loading...');

// Firebase already initialized in index.html
const auth = firebase.auth();
const db = firebase.database();

// Admin email
const ADMIN_EMAIL = 'ifanifwasafifth@gmail.com';

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Admin page loaded');
  
  // Show loading state
  document.body.style.display = 'block';
  
  // Check auth state
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      // Not logged in, redirect to home
      window.location.href = 'index.html';
      return;
    }

    console.log('Admin check for:', user.email);
    
    // Check if user is admin
    if (user.email === ADMIN_EMAIL) {
      console.log('✅ Admin authenticated');
      showAdminContent();
      loadDashboardStats();
      loadUsers();
      loadCalls();
    } else {
      console.log('❌ Not an admin');
      showAccessDenied();
    }
  });
});

function showAccessDenied() {
  const accessDenied = document.getElementById('access-denied');
  const adminContent = document.getElementById('admin-content');
  
  if (accessDenied) accessDenied.style.display = 'block';
  if (adminContent) adminContent.style.display = 'none';
}

function showAdminContent() {
  const accessDenied = document.getElementById('access-denied');
  const adminContent = document.getElementById('admin-content');
  
  if (accessDenied) accessDenied.style.display = 'none';
  if (adminContent) adminContent.style.display = 'block';
}

// UI Tabs
window.showTab = function(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected tab
  const tabElement = document.getElementById(tabName + '-tab');
  if (tabElement) {
    tabElement.classList.add('active');
  }
};

// Dashboard Stats
async function loadDashboardStats() {
  try {
    const [usersSnap, callsSnap] = await Promise.all([
      db.ref('users').once('value'),
      db.ref('calls').once('value')
    ]);

    let totalUsers = 0;
    let totalWhispers = 0;
    let totalEarnings = 0;
    let totalCalls = 0;
    let pendingPayouts = 0;
    let openDisputes = 0;

    if (usersSnap.exists()) {
      usersSnap.forEach((child) => {
        totalUsers++;
        const user = child.val();
        if (user && user.isWhisper) totalWhispers++;
        
        // Calculate pending payouts
        const earnings = Number(user.earnings) || 0;
        if (earnings > 0) pendingPayouts++;
      });
    }

    if (callsSnap.exists()) {
      callsSnap.forEach((child) => {
        const call = child.val();
        if (call && (call.status === 'completed' || call.status === 'ended')) {
          totalCalls++;
          totalEarnings += (Number(call.coinsCharged) || 1) * 15; // $15 per coin
        }
        
        // Check for flagged calls
        if (call && call.flagged) {
          openDisputes++;
        }
      });
    }

    // Update UI
    const updateStat = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    
    updateStat('total-users', totalUsers);
    updateStat('total-whispers', totalWhispers);
    updateStat('total-earnings', `$${totalEarnings.toFixed(2)}`);
    updateStat('total-calls', totalCalls);
    updateStat('pending-payouts', pendingPayouts);
    updateStat('open-disputes', openDisputes);

  } catch (error) {
    console.error('Error loading dashboard stats:', error);
  }
}

// Users Table
async function loadUsers() {
  try {
    const snap = await db.ref('users').once('value');
    const tbody = document.getElementById('users-table');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!snap.exists()) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading">No users found</td></tr>';
      return;
    }

    snap.forEach((child) => {
      const user = child.val();
      if (!user) return;
      
      const tr = document.createElement('tr');
      
      const userId = user.uid || child.key;
      const shortId = userId ? userId.substring(0, 8) : 'N/A';
      
      tr.innerHTML = `
        <td><span class="user-id">${shortId}</span></td>
        <td>${user.email || 'No email'}</td>
        <td>${user.displayName || 'Anonymous'}</td>
        <td>${Number(user.coins) || 0}</td>
        <td>$${((Number(user.earnings) || 0) * 12).toFixed(2)}</td>
        <td>${Number(user.callsCompleted) || 0}</td>
        <td>
          <span class="badge ${user.isAvailable ? 'badge-success' : 'badge-warning'}">
            ${user.isAvailable ? 'Online' : 'Offline'}
          </span>
        </td>
      `;
      
      // Add admin function to add coins
      tr.onclick = () => {
        const coins = prompt(`Add coins to ${user.displayName || shortId}:`, "10");
        if (coins && !isNaN(coins)) {
          addCoinsToUser(userId, parseInt(coins));
        }
      };
      
      tr.style.cursor = 'pointer';
      tr.title = 'Click to add coins to this user';
      
      tbody.appendChild(tr);
    });

  } catch (error) {
    console.error('Error loading users:', error);
    const tbody = document.getElementById('users-table');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading">Error loading users</td></tr>';
    }
  }
}

// Add coins to user
async function addCoinsToUser(userId, coins) {
  try {
    const userRef = db.ref(`users/${userId}`);
    const userSnap = await userRef.once('value');
    const user = userSnap.val();
    
    if (!user) {
      alert('User not found');
      return;
    }
    
    const currentCoins = Number(user.coins) || 0;
    await userRef.update({ coins: currentCoins + coins });
    
    alert(`Added ${coins} coins to ${user.displayName || userId}. New balance: ${currentCoins + coins}`);
    loadUsers();
  } catch (error) {
    console.error('Error adding coins:', error);
    alert('Failed to add coins: ' + error.message);
  }
}

// Calls Table
async function loadCalls() {
  try {
    const snap = await db.ref('calls').once('value');
    const tbody = document.getElementById('calls-table');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!snap.exists()) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading">No calls found</td></tr>';
      return;
    }

    snap.forEach((child) => {
      const call = child.val();
      if (!call) return;
      
      const duration = Number(call.duration) || 0;
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);
      
      // Determine badge class
      let badgeClass = 'badge-warning';
      if (call.status === 'completed' || call.status === 'ended') badgeClass = 'badge-success';
      if (call.status === 'expired' || call.flagged) badgeClass = 'badge-danger';
      if (call.status === 'ringing') badgeClass = 'badge-info';

      const tr = document.createElement('tr');
      
      const callId = call.id || child.key;
      const shortCallId = callId ? callId.substring(0, 8) : 'N/A';
      
      tr.innerHTML = `
        <td><span class="user-id">${shortCallId}</span></td>
        <td>${call.callerName || 'Anonymous'}</td>
        <td>${call.whisperName || 'Anonymous'}</td>
        <td>${minutes}:${seconds.toString().padStart(2, '0')}</td>
        <td>$${((Number(call.coinsCharged) || 1) * 15).toFixed(2)}</td>
        <td>
          <span class="badge ${badgeClass}">
            ${call.status || 'unknown'}
          </span>
        </td>
        <td>${formatDate(call.createdAt)}</td>
      `;
      
      tbody.appendChild(tr);
    });

  } catch (error) {
    console.error('Error loading calls:', error);
    const tbody = document.getElementById('calls-table');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading">Error loading calls</td></tr>';
    }
  }
}

function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  try {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } catch {
    return 'Invalid Date';
  }
}

// Logout
window.logout = async function() {
  try {
    await auth.signOut();
    window.location.href = 'index.html';
  } catch (error) {
    console.error('Logout error:', error);
    alert('Logout failed: ' + error.message);
  }
};

// Initialize with dashboard tab
showTab('dashboard');

console.log('✅ Admin dashboard loaded');
