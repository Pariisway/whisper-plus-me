// Main Application Logic for Whisper+me

// Global variables
let currentUser = null;
let userData = null;
let availableUsers = [];
let shuffleInterval = null;
let countdownInterval = null;
let selectedCoins = 1;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    console.log('Whisper+me app initializing...');
    
    // Hide loading screen after 2 seconds
    setTimeout(() => {
        document.getElementById('loading-screen').style.display = 'none';
    }, 2000);
    
    // Initialize shuffle timer
    startShuffleCountdown();
    
    // Load sample profiles
    loadSampleProfiles();
    
    // Initialize event listeners
    initializeEventListeners();
});

// Event Listeners
function initializeEventListeners() {
    // Auth form submissions
    document.getElementById('login-email')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') login();
    });
    document.getElementById('login-password')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') login();
    });
    document.getElementById('signup-email')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') signup();
    });
    document.getElementById('signup-password')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') signup();
    });
    document.getElementById('signup-confirm')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') signup();
    });
}

// Authentication Functions
function showAuthModal(type) {
    const modal = document.getElementById('auth-modal');
    const title = document.getElementById('auth-modal-title');
    
    if (type === 'login') {
        title.textContent = 'Login to Whisper+me';
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('signup-form').style.display = 'none';
    } else {
        title.textContent = 'Create Account';
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('signup-form').style.display = 'block';
    }
    
    modal.style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function switchAuthTab(type) {
    showAuthModal(type);
}

async function login() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    if (!email || !password) {
        showNotification('Please fill in all fields', 'error');
        return;
    }
    
    try {
        // Simulate login - In production, this would connect to Firebase
        console.log('Login attempt:', email);
        
        // Simulate successful login
        simulateLoginSuccess(email);
        
        showNotification('Login successful!', 'success');
        closeModal('auth-modal');
        
    } catch (error) {
        showNotification('Login failed: ' + error.message, 'error');
    }
}

async function signup() {
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    
    if (!email || !password || !confirm) {
        showNotification('Please fill in all fields', 'error');
        return;
    }
    
    if (password !== confirm) {
        showNotification('Passwords do not match', 'error');
        return;
    }
    
    if (password.length < 6) {
        showNotification('Password must be at least 6 characters', 'error');
        return;
    }
    
    try {
        // Simulate signup - In production, this would connect to Firebase
        console.log('Signup attempt:', email);
        
        // Simulate successful signup
        simulateLoginSuccess(email);
        
        showNotification('Account created successfully!', 'success');
        closeModal('auth-modal');
        
    } catch (error) {
        showNotification('Signup failed: ' + error.message, 'error');
    }
}

function simulateLoginSuccess(email) {
    currentUser = {
        uid: 'user_' + Date.now(),
        email: email
    };
    
    userData = {
        coins: 10,
        earnings: 0,
        callsCompleted: 0,
        rating: 5.0
    };
    
    // Update UI for logged in state
    document.getElementById('guest-menu').style.display = 'none';
    document.getElementById('logged-in-menu').style.display = 'block';
    document.getElementById('coins-count').textContent = userData.coins;
    
    // Update dashboard stats
    updateDashboardStats();
}

function logout() {
    currentUser = null;
    userData = null;
    
    // Update UI for logged out state
    document.getElementById('guest-menu').style.display = 'block';
    document.getElementById('logged-in-menu').style.display = 'none';
    
    showNotification('Logged out successfully', 'success');
}

// Shuffle Functions
let shuffleIndex = 0;
const sampleProfiles = [
    {
        name: "Alex Johnson",
        price: "2 Coins",
        bio: "Tech entrepreneur & startup advisor. Love discussing innovation and business strategies.",
        img: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=face"
    },
    {
        name: "Sarah Miller",
        price: "3 Coins",
        bio: "Mental health advocate and mindfulness coach. Let's talk about self-care and personal growth.",
        img: "https://images.unsplash.com/photo-1494790108755-2616b786d4d7?w=400&h=400&fit=crop&crop=face"
    },
    {
        name: "Marcus Chen",
        price: "1 Coin",
        bio: "Professional musician and producer. Ask me anything about the music industry!",
        img: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=400&fit=crop&crop=face"
    },
    {
        name: "Jessica Williams",
        price: "2 Coins",
        bio: "Travel blogger and adventure seeker. Let's share stories from around the world.",
        img: "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400&h=400&fit=crop&crop=face"
    },
    {
        name: "David Park",
        price: "3 Coins",
        bio: "AI researcher and futurist. Passionate about technology's impact on society.",
        img: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&h=400&fit=crop&crop=face"
    }
];

function nextShuffleProfile() {
    shuffleIndex = (shuffleIndex + 1) % sampleProfiles.length;
    updateShuffleProfile();
    resetShuffleCountdown();
}

function updateShuffleProfile() {
    const profile = sampleProfiles[shuffleIndex];
    document.getElementById('shuffle-img').src = profile.img;
    document.getElementById('shuffle-name').textContent = profile.name;
    document.getElementById('shuffle-price').textContent = profile.price;
    document.getElementById('shuffle-bio').textContent = profile.bio;
}

function startShuffleCountdown() {
    let seconds = 30;
    const countdownElement = document.getElementById('countdown');
    
    countdownInterval = setInterval(() => {
        seconds--;
        countdownElement.textContent = seconds;
        
        if (seconds <= 0) {
            nextShuffleProfile();
            seconds = 30;
        }
    }, 1000);
}

function resetShuffleCountdown() {
    clearInterval(countdownInterval);
    document.getElementById('countdown').textContent = '30';
    startShuffleCountdown();
}

function startCallFromShuffle() {
    if (!currentUser) {
        showNotification('Please login to start a call', 'error');
        showAuthModal('login');
        return;
    }
    
    if (userData.coins < 1) {
        showNotification('Not enough coins. Please buy more coins.', 'error');
        return;
    }
    
    // Simulate call start
    userData.coins -= 2; // Deduct for this call
    document.getElementById('coins-count').textContent = userData.coins;
    
    showNotification(`Calling ${sampleProfiles[shuffleIndex].name}...`, 'success');
    
    // Simulate call success after 3 seconds
    setTimeout(() => {
        showNotification('Call connected! Talk for up to 5 minutes.', 'success');
        // In production, this would start the actual Agora call
    }, 3000);
}

// Profile Functions
function loadSampleProfiles() {
    const container = document.getElementById('profiles-container');
    container.innerHTML = '';
    
    const profiles = [
        {
            name: "Dr. Maya Rodriguez",
            price: "3 Coins",
            bio: "Clinical psychologist specializing in relationships. Let's talk about communication and emotional wellness.",
            img: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=400&fit=crop&crop=face"
        },
        {
            name: "James Wilson",
            price: "2 Coins",
            bio: "Former professional athlete turned motivational speaker. Let's discuss discipline and achieving goals.",
            img: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop&crop=face"
        },
        {
            name: "Priya Patel",
            price: "1 Coin",
            bio: "Software engineer at a FAANG company. Happy to chat about career advice and tech interviews.",
            img: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=400&fit=crop&crop=face"
        },
        {
            name: "Carlos Garcia",
            price: "2 Coins",
            bio: "Master chef and restaurant owner. Let's talk food, culture, and entrepreneurship.",
            img: "https://images.unsplash.com/photo-1507591064344-4c6ce005b128?w=400&h=400&fit=crop&crop=face"
        },
        {
            name: "Lisa Thompson",
            price: "3 Coins",
            bio: "Investment banker turned financial educator. Learn about personal finance and wealth building.",
            img: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400&h=400&fit=crop&crop=face"
        },
        {
            name: "Ryan Cooper",
            price: "1 Coin",
            bio: "Stand-up comedian and writer. Need a laugh? Let's chat about comedy and creativity.",
            img: "https://images.unsplash.com/photo-1517423440428-a5a00ad493e8?w=400&h=400&fit=crop&crop=face"
        }
    ];
    
    profiles.forEach(profile => {
        const card = document.createElement('div');
        card.className = 'profile-card';
        card.innerHTML = `
            <div class="profile-header">
                <img src="${profile.img}" alt="${profile.name}" class="profile-img">
                <div class="profile-info">
                    <h3>${profile.name}</h3>
                    <div class="profile-price">${profile.price}</div>
                </div>
            </div>
            <p class="profile-bio">${profile.bio}</p>
            <button class="btn btn-primary" onclick="viewProfile('${profile.name}', '${profile.price}', '${profile.bio.replace(/'/g, "\\'")}', '${profile.img}')">
                <i class="fas fa-phone"></i> Call Now
            </button>
        `;
        container.appendChild(card);
    });
}

function viewProfile(name, price, bio, img) {
    if (!currentUser) {
        showNotification('Please login to view profiles', 'error');
        showAuthModal('login');
        return;
    }
    
    document.getElementById('modal-profile-img').src = img;
    document.getElementById('modal-profile-name').textContent = name;
    document.getElementById('modal-profile-price').textContent = price;
    document.getElementById('modal-profile-bio').textContent = bio;
    
    closeModal('profile-modal');
}

function startCall() {
    if (!currentUser) {
        showNotification('Please login to start a call', 'error');
        showAuthModal('login');
        return;
    }
    
    const price = document.getElementById('modal-profile-price').textContent;
    const coinCost = parseInt(price.split(' ')[0]);
    
    if (userData.coins < coinCost) {
        showNotification(`Not enough coins. You need ${coinCost} coins for this call.`, 'error');
        return;
    }
    
    // Simulate call start
    userData.coins -= coinCost;
    document.getElementById('coins-count').textContent = userData.coins;
    
    const name = document.getElementById('modal-profile-name').textContent;
    showNotification(`Calling ${name}...`, 'success');
    closeModal('profile-modal');
    
    // Simulate call success after 3 seconds
    setTimeout(() => {
        showNotification('Call connected! Talk for up to 5 minutes.', 'success');
        // In production, this would start the actual Agora call
    }, 3000);
}

// Coin Functions
function selectCoinOption(coins) {
    selectedCoins = coins;
    
    // Update UI
    document.querySelectorAll('.coin-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    event.target.closest('.coin-option').classList.add('selected');
}

function buyCoins() {
    if (!currentUser) {
        showNotification('Please login to buy coins', 'error');
        showAuthModal('login');
        return;
    }
    
    const price = selectedCoins * 15;
    showNotification(`Redirecting to payment for ${selectedCoins} coins ($${price})...`, 'success');
    
    // Simulate payment success after 2 seconds
    setTimeout(() => {
        userData.coins += selectedCoins;
        document.getElementById('coins-count').textContent = userData.coins;
        showNotification(`Successfully purchased ${selectedCoins} coins!`, 'success');
    }, 2000);
}

// Dashboard Functions
function showDashboard() {
    if (!currentUser) {
        showNotification('Please login to view dashboard', 'error');
        showAuthModal('login');
        return;
    }
    
    updateDashboardStats();
    const modal = document.getElementById('dashboard-modal');
    modal.style.display = 'flex';
}

function updateDashboardStats() {
    if (userData) {
        document.getElementById('dash-coins').textContent = userData.coins;
        document.getElementById('dash-earnings').textContent = '$' + userData.earnings;
        document.getElementById('dash-calls').textContent = userData.callsCompleted;
        document.getElementById('dash-rating').textContent = userData.rating.toFixed(1);
    }
}

function toggleAvailability() {
    const toggle = document.getElementById('availability-toggle');
    const status = toggle.checked ? 'available' : 'unavailable';
    showNotification(`You are now ${status} to receive calls`, 'success');
}

function saveProfile() {
    const bio = document.getElementById('profile-bio').value;
    const price = document.getElementById('profile-price').value;
    
    if (bio) {
        showNotification('Profile saved successfully!', 'success');
        closeModal('dashboard-modal');
    } else {
        showNotification('Please add a bio to your profile', 'error');
    }
}

// Rating Functions
function setRating(stars) {
    // Highlight selected stars
    const starElements = document.querySelectorAll('#rating-modal .fa-star');
    starElements.forEach((star, index) => {
        star.style.color = index < stars ? '#fbbf24' : '#666';
    });
}

function submitRating() {
    showNotification('Thank you for your rating!', 'success');
    closeModal('rating-modal');
}

// Notification System
function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = 'notification show';
    
    if (type === 'error') {
        notification.classList.add('error');
    }
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Admin Functions
function showAdminLogin() {
    const email = prompt('Enter admin email:');
    const password = prompt('Enter admin password:');
    
    if (email === 'ifanifwasafifth@gmail.com' && password === 'admin123') {
        window.location.href = 'admin.html';
    } else {
        showNotification('Invalid admin credentials', 'error');
    }
}

// Share Profile
function shareProfile() {
    if (navigator.share) {
        navigator.share({
            title: 'Whisper+me',
            text: 'Check out this awesome anonymous audio chat platform!',
            url: window.location.href
        });
    } else {
        navigator.clipboard.writeText(window.location.href);
        showNotification('Link copied to clipboard!', 'success');
    }
}

// Initialize shuffle on page load
updateShuffleProfile();

// Export functions for global access
window.showAuthModal = showAuthModal;
window.closeModal = closeModal;
window.switchAuthTab = switchAuthTab;
window.login = login;
window.signup = signup;
window.logout = logout;
window.nextShuffleProfile = nextShuffleProfile;
window.startCallFromShuffle = startCallFromShuffle;
window.viewProfile = viewProfile;
window.startCall = startCall;
window.selectCoinOption = selectCoinOption;
window.buyCoins = buyCoins;
window.showDashboard = showDashboard;
window.toggleAvailability = toggleAvailability;
window.saveProfile = saveProfile;
window.setRating = setRating;
window.submitRating = submitRating;
window.showAdminLogin = showAdminLogin;
window.shareProfile = shareProfile;
