// (CONTINUED FROM PREVIOUS CODE)

function preloadAgoraSDK() {
    if (agoraSDKLoaded || window.AgoraRTC) {
        agoraSDKLoaded = true;
        return;
    }
    
    const script = document.createElement('script');
    script.src = 'https://download.agora.io/sdk/release/AgoraRTC_N-4.18.2.js';
    script.onload = () => {
        agoraSDKLoaded = true;
        console.log('✅ Agora SDK loaded');
    };
    script.onerror = () => {
        console.error('Failed to load Agora SDK');
    };
    document.head.appendChild(script);
}

async function joinAgoraChannel(channelName, isCaller = true) {
    if (!agoraSDKLoaded || !window.AgoraRTC) {
        showNotification('Audio system loading, please wait...', 'warning');
        return;
    }
    
    try {
        // Get Agora token from Firebase function
        const tokenResult = await getAgoraToken({ 
            channelName: channelName,
            uid: currentUser.uid
        });
        
        const { token, uid } = tokenResult.data;
        
        // Initialize Agora client
        agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        
        // Set up event listeners
        agoraClient.on("user-published", async (user, mediaType) => {
            if (mediaType === "audio") {
                await agoraClient.subscribe(user, mediaType);
                const remoteAudioTrack = user.audioTrack;
                remoteAudioTrack.play();
                remoteAudioTracks.push(remoteAudioTrack);
            }
        });
        
        agoraClient.on("user-unpublished", (user) => {
            // Handle user leaving
            console.log('User left channel');
        });
        
        agoraClient.on("user-left", (user) => {
            // Handle call end
            if (callStatus === 'active') {
                handleRemoteDisconnect();
            }
        });
        
        // Join the channel
        await agoraClient.join(CONFIG.appId, channelName, token, uid);
        
        // Create and publish local audio track
        localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        await agoraClient.publish([localAudioTrack]);
        
        console.log('✅ Joined Agora channel:', channelName);
        
    } catch (error) {
        console.error('Agora join error:', error);
        showNotification('Audio connection failed', 'error');
        endCallCleanup();
    }
}

function showCallInProgressInterface(isWhisper = false) {
    const otherUser = isWhisper ? activeCall.callerName : activeCall.whisperName;
    const otherPhoto = isWhisper ? activeCall.callerPhoto : activeCall.whisperPhoto;
    const otherId = isWhisper ? activeCall.callerWhisperId : activeCall.whisperIdNum;
    const role = isWhisper ? 'Whisper (You earn)' : 'Caller (You pay)';
    const costEarn = isWhisper ? `$${(activeCall.coins || 1) * CONFIG.whisperEarnings}` : `${activeCall.coins || 1} Coin`;
    
    const iphoneScreen = document.querySelector('.phone-content');
    if (!iphoneScreen) return;
    
    iphoneScreen.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <div class="shuffle-indicator" style="background: rgba(16, 185, 129, 0.2); color: #10b981;">
                <i class="fas fa-phone-alt"></i> LIVE CALL - ${role}
            </div>
            
            <img src="${otherPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(otherUser)}&background=10b981&color=fff`}" 
                 alt="${otherUser}" 
                 class="shuffle-profile-img" 
                 style="border: 4px solid #10b981; animation: pulse 2s infinite;">
            
            <h3 class="shuffle-profile-name">${otherUser}</h3>
            <div class="whisper-id-display">ID: ${otherId}</div>
            
            <div style="margin: 1.5rem 0; background: rgba(16, 185, 129, 0.1); padding: 1rem; border-radius: 12px;">
                <p style="color: #10b981; margin-bottom: 0.5rem; font-weight: 600;">
                    <i class="fas fa-clock"></i> Call in progress
                </p>
                <div style="font-size: 2rem; color: white; font-weight: bold;" id="call-timer">
                    ${formatTime(CONFIG.callDuration)}
                </div>
                <p style="color: rgba(255, 255, 255, 0.7); font-size: 0.9rem; margin-top: 0.5rem;">
                    ${isWhisper ? `Earning: ${costEarn}` : `Cost: ${costEarn}`}
                </p>
            </div>
            
            <div class="phone-controls">
                <button class="phone-btn phone-btn-secondary" onclick="toggleMute()" id="mute-btn" style="background: rgba(255, 255, 255, 0.1);">
                    <i class="fas fa-microphone"></i>
                </button>
                <button class="phone-btn phone-btn-call" onclick="endCall()" style="background: #ef4444; width: 70px; height: 70px;">
                    <i class="fas fa-phone-slash"></i>
                </button>
                <button class="phone-btn phone-btn-secondary" onclick="toggleSpeaker()" id="speaker-btn" style="background: rgba(255, 255, 255, 0.1);">
                    <i class="fas fa-volume-up"></i>
                </button>
            </div>
            
            <div class="shuffle-timer">
                <i class="fas fa-info-circle"></i> Speak freely - call ends automatically after 5 minutes
            </div>
        </div>
    `;
    
    // Start call timer
    startCallTimer();
}

function startCallTimer() {
    timeLeft = CONFIG.callDuration;
    updateCallTimerDisplay();
    
    callTimer = setInterval(() => {
        timeLeft--;
        updateCallTimerDisplay();
        
        if (timeLeft <= 0) {
            clearInterval(callTimer);
            endCall();
        }
    }, 1000);
}

function updateCallTimerDisplay() {
    const timerDisplay = document.getElementById('call-timer');
    if (timerDisplay) {
        timerDisplay.textContent = formatTime(timeLeft);
    }
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function startRingTimer(seconds, isIncoming = false) {
    let time = seconds;
    const timerElement = isIncoming ? 
        document.getElementById('ring-timer') : 
        document.querySelector('#ring-timer');
    
    if (timerElement) timerElement.textContent = time;
    
    ringTimer = setInterval(() => {
        time--;
        if (timerElement) timerElement.textContent = time;
        
        if (time <= 0) {
            clearInterval(ringTimer);
            if (isIncoming) {
                declineIncomingCall();
            } else {
                cancelCall();
            }
        }
    }, 1000);
}

function handleRemoteDisconnect() {
    if (callStatus === 'active') {
        showNotification('Other user disconnected', 'info');
        endCallCleanup();
        showRatingModal();
    }
}

window.toggleMute = function() {
    if (localAudioTrack) {
        const muted = localAudioTrack.muted;
        localAudioTrack.setMuted(!muted);
        
        const muteBtn = document.getElementById('mute-btn');
        if (muteBtn) {
            muteBtn.innerHTML = muted ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
            muteBtn.style.background = muted ? 'rgba(255, 255, 255, 0.1)' : 'rgba(239, 68, 68, 0.3)';
        }
    }
};

window.toggleSpeaker = function() {
    // This would require more advanced audio routing
    showNotification('Speaker control not available in browser', 'info');
};

window.endCall = async function() {
    if (!activeCall) return;
    
    try {
        await endCallFn({
            callId: activeCall.id
        });
        
        endCallCleanup();
        showRatingModal();
        
    } catch (error) {
        console.error('End call error:', error);
        showNotification('Error ending call', 'error');
        endCallCleanup();
    }
};

function endCallCleanup() {
    // Stop all timers
    if (callTimer) clearInterval(callTimer);
    if (ringTimer) clearInterval(ringTimer);
    
    // Leave Agora channel
    if (agoraClient) {
        agoraClient.leave();
        agoraClient = null;
    }
    
    // Stop local audio track
    if (localAudioTrack) {
        localAudioTrack.close();
        localAudioTrack = null;
    }
    
    // Stop remote audio tracks
    remoteAudioTracks.forEach(track => track.close());
    remoteAudioTracks = [];
    
    // Reset state
    callStatus = 'idle';
    activeCall = null;
    incomingCall = null;
    selectedProfile = null;
    
    // Reset interface
    resetPhoneInterface();
    
    // Reload user data to update coins
    if (currentUser) {
        loadUserData();
        loadAvailableProfiles();
    }
}

function resetPhoneInterface() {
    const phoneContent = document.querySelector('.phone-content');
    if (!phoneContent) return;
    
    // Restore original shuffle interface
    phoneContent.innerHTML = `
        <div class="shuffle-indicator" id="shuffle-indicator">
            <i class="fas fa-random"></i> SHUFFLE MODE
        </div>
        
        <div class="shuffle-profile" id="shuffle-profile">
            <div class="availability-indicator" id="shuffle-availability">
                <div class="availability-dot"></div>
                <span>Loading...</span>
            </div>
            <img src="https://ui-avatars.com/api/?name=User&background=7c3aed&color=fff" 
                 alt="Profile" class="shuffle-profile-img" id="shuffle-img">
            <h3 class="shuffle-profile-name" id="shuffle-name">Loading...</h3>
            <div class="shuffle-profile-price" id="shuffle-price">1 Coin</div>
            <div class="whisper-id-display" id="shuffle-id">ID: 00000</div>
            <p class="shuffle-profile-bio" id="shuffle-bio">Swipe to find whispers...</p>
            
            <div class="shuffle-social-links" id="shuffle-social">
                <!-- Social links will appear here -->
            </div>
        </div>
        
        <div class="phone-controls">
            <button class="phone-btn phone-btn-secondary" onclick="prevShuffleProfile()">
                <i class="fas fa-arrow-left"></i>
            </button>
            <button class="phone-btn phone-btn-call" onclick="startCallFromShuffle()" id="shuffle-call-btn">
                <i class="fas fa-phone-alt"></i>
            </button>
            <button class="phone-btn phone-btn-secondary" onclick="nextShuffleProfile()">
                <i class="fas fa-arrow-right"></i>
            </button>
        </div>
        
        <div class="shuffle-timer" id="shuffle-timer">
            <i class="fas fa-sync-alt"></i> Swipe to see next whisper
        </div>
    `;
    
    // Update with current profiles
    if (shuffleProfiles.length > 0) {
        updateShuffleProfile();
    } else {
        showNoProfilesAvailable();
    }
}

// ==================== RATING SYSTEM ====================
function showRatingModal() {
    showModal('rating-modal');
    
    // Reset stars
    const stars = document.querySelectorAll('#rating-stars i');
    stars.forEach(star => star.classList.remove('active'));
    
    // Set default rating
    setRating(5);
}

window.setRating = function(rating) {
    currentRating = rating;
    const stars = document.querySelectorAll('#rating-stars i');
    stars.forEach((star, index) => {
        if (index < rating) {
            star.classList.add('active');
        } else {
            star.classList.remove('active');
        }
    });
};

window.submitRating = async function() {
    if (!lastCallId) {
        closeModal('rating-modal');
        return;
    }
    
    const comment = document.getElementById('rating-comment').value.trim();
    
    try {
        await submitReviewFn({
            callId: lastCallId,
            rating: currentRating,
            comment: comment
        });
        
        showNotification('Thank you for your feedback!', 'success');
        closeModal('rating-modal');
        
    } catch (error) {
        console.error('Submit rating error:', error);
        showNotification('Failed to submit rating', 'error');
        closeModal('rating-modal');
    }
};

// ==================== DASHBOARD FUNCTIONS ====================
window.showDashboard = function() {
    if (!currentUser) {
        showAuthModal('login');
        return;
    }
    
    showModal('dashboard-modal');
};

window.toggleAvailability = async function() {
    if (!currentUser) return;
    
    const toggle = document.getElementById('availability-toggle');
    const isAvailable = toggle.checked;
    
    try {
        await db.ref('publicProfiles/' + currentUser.uid).update({
            isAvailable: isAvailable
        });
        
        // Also update user's own data
        if (userData) {
            userData.isAvailable = isAvailable;
        }
        
        showNotification(isAvailable ? '✅ Available to receive calls' : '❌ No longer available', 'success');
        
    } catch (error) {
        console.error('Toggle availability error:', error);
        toggle.checked = !isAvailable;
        showNotification('Failed to update availability', 'error');
    }
};

window.saveProfile = async function() {
    if (!currentUser) return;
    
    const displayName = document.getElementById('profile-name').value.trim();
    const bio = document.getElementById('profile-bio').value.trim();
    const twitter = document.getElementById('profile-twitter').value.trim();
    const instagram = document.getElementById('profile-instagram').value.trim();
    const tiktok = document.getElementById('profile-tiktok').value.trim();
    const photoURL = document.getElementById('profile-photo').value.trim();
    const paypalEmail = document.getElementById('paypal-email').value.trim();
    
    if (!displayName) {
        showNotification('Display name is required', 'error');
        return;
    }
    
    // If user wants to become a whisper (first time setting up profile)
    const wantsToBeWhisper = !userData.isWhisper;
    
    const profileData = {
        displayName: displayName,
        bio: bio || 'Available for anonymous calls',
        photoURL: photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=7c3aed&color=fff`,
        social: {
            twitter: twitter.replace('@', ''),
            instagram: instagram.replace('@', ''),
            tiktok: tiktok.replace('@', '')
        },
        isWhisper: true,
        callPrice: 1, // Default price
        lastUpdated: Date.now()
    };
    
    if (paypalEmail) {
        profileData.paypalEmail = paypalEmail;
    }
    
    try {
        // Update public profile
        await db.ref('publicProfiles/' + currentUser.uid).update(profileData);
        
        // Update user data
        await db.ref('users/' + currentUser.uid).update({
            isWhisper: true
        });
        
        // Update local state
        userData = { ...userData, ...profileData };
        
        showNotification('✅ Profile saved successfully!', 'success');
        
        // Reload profiles to show updated one
        loadAvailableProfiles();
        
    } catch (error) {
        console.error('Save profile error:', error);
        showNotification('Failed to save profile', 'error');
    }
};

window.copyWhisperId = function() {
    if (!userData?.whisperId) return;
    
    navigator.clipboard.writeText(userData.whisperId).then(() => {
        showNotification('Whisper ID copied to clipboard!', 'success');
    });
};

// ==================== COINS & PAYMENTS ====================
let selectedCoinAmount = 1;

window.selectCoinOption = function(amount) {
    selectedCoinAmount = amount;
    
    // Update UI
    document.querySelectorAll('.coin-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    const selectedOption = document.querySelector(`[onclick="selectCoinOption(${amount})"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
};

window.buyCoins = async function() {
    if (!currentUser) {
        showAuthModal('login');
        return;
    }
    
    const amount = selectedCoinAmount;
    const totalPrice = amount * CONFIG.coinPrice;
    
    // In production, this would integrate with Stripe
    // For now, we'll simulate with Firebase function
    
    try {
        const result = await buyCoinsFn({
            amount: amount,
            price: totalPrice
        });
        
        if (result.data.success) {
            showNotification(`✅ Purchased ${amount} coins for $${totalPrice}!`, 'success');
            
            // Update user data
            if (userData) {
                userData.coins = (userData.coins || 0) + amount;
                updateUI();
            }
            
        } else {
            showNotification('Payment failed or cancelled', 'error');
        }
        
    } catch (error) {
        console.error('Buy coins error:', error);
        showNotification('Payment system error. Please try again.', 'error');
    }
};

// ==================== ADMIN FUNCTIONS ====================
window.checkAdminAccess = function() {
    const password = prompt('Enter admin password:');
    if (password === 'Whisper+me2024!') {
        window.location.href = 'admin.html';
    } else {
        showNotification('Incorrect password', 'error');
    }
};

// ==================== UTILITY FUNCTIONS ====================
function updateCurrentTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timeElement = document.getElementById('current-time');
    if (timeElement) timeElement.textContent = timeString;
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'flex';
}

window.closeModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
};

function hideLoading() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        setTimeout(() => {
            loadingScreen.style.opacity = '0';
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 300);
        }, 500);
    }
}

function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    if (!notification) return;
    
    notification.textContent = message;
    notification.className = 'notification';
    notification.classList.add(type);
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function setupEventListeners() {
    // Modal close on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
            }
        });
    });
    
    // Enter key in auth forms
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const activeModal = document.querySelector('.modal-overlay[style*="display: flex"]');
            if (activeModal) {
                if (activeModal.id === 'auth-modal') {
                    const loginForm = document.getElementById('login-form');
                    if (loginForm.style.display !== 'none') {
                        login();
                    } else {
                        signup();
                    }
                }
            }
        }
    });
}

// Initialize coin selection
window.onload = function() {
    selectCoinOption(1);
    
    // Set up form placeholders
    document.getElementById('login-email')?.setAttribute('placeholder', 'your@email.com');
    document.getElementById('login-password')?.setAttribute('placeholder', '••••••••');
    document.getElementById('signup-email')?.setAttribute('placeholder', 'your@email.com');
    document.getElementById('signup-password')?.setAttribute('placeholder', '••••••••');
    document.getElementById('signup-confirm')?.setAttribute('placeholder', '••••••••');
};

// ==================== FALLBACK FUNCTIONS ====================
// For browsers that don't support clipboard API
if (!navigator.clipboard) {
    window.copyWhisperId = function() {
        if (!userData?.whisperId) return;
        
        const textArea = document.createElement('textarea');
        textArea.value = userData.whisperId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        showNotification('Whisper ID copied to clipboard!', 'success');
    };
}

console.log('🎉 Whisper+me App Initialized Successfully!');
