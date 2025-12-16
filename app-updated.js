// Updated Agora handling with better error management

// Check for secure context
function isSecureContext() {
    return window.isSecureContext || 
           location.protocol === 'https:' || 
           location.hostname === 'localhost' || 
           location.hostname === '127.0.0.1' ||
           location.hostname === '[::1]' ||
           location.protocol === 'file:';
}

// Modified startAgoraCall function with better error handling
async function startAgoraCall(channelName) {
    try {
        // Check if we're in a secure context
        if (!isSecureContext()) {
            showNotification('Audio calls require HTTPS or localhost. Please access via https:// or localhost.', true);
            throw new Error('Insecure context');
        }
        
        // Check microphone permissions first
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
        } catch (micError) {
            showNotification('Microphone access denied. Please allow microphone permissions.', true);
            throw micError;
        }
        
        // Initialize Agora
        agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        
        // For testing, use a temporary token (in production, generate on server)
        const token = null; // For testing without token
        
        // Join channel
        await agoraClient.join(agoraConfig.appId, channelName, token, currentUser.uid);
        
        // Create and publish local audio track
        localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        await agoraClient.publish([localAudioTrack]);
        
        // Update UI for active call
        document.getElementById('chat-status').style.display = 'none';
        document.getElementById('call-controls').style.display = 'flex';
        
        // Start timer
        startCallTimer();
        
        // Listen for remote user leaving
        agoraClient.on('user-left', async (user) => {
            endCall();
        });
        
        // Listen for errors
        agoraClient.on('connection-state-change', (curState, prevState) => {
            if (curState === 'DISCONNECTED' || curState === 'FAILED') {
                showNotification('Connection lost. Please try again.', true);
                endCall();
            }
        });
        
        // Update call status in database
        if (currentCall) {
            await db.ref('calls/' + currentCall.id).update({
                status: 'active'
            });
        }
        
    } catch (error) {
        console.error('Agora error:', error);
        
        if (error.code === 'PERMISSION_DENIED' || error.name === 'NotAllowedError') {
            showNotification('Microphone permission denied. Please allow microphone access in your browser settings.', true);
        } else if (error.message.includes('insecure')) {
            showNotification('Please access via HTTPS or localhost for audio calls.', true);
        } else if (error.message.includes('token')) {
            showNotification('Connection error. Please refresh and try again.', true);
        } else {
            showNotification('Error starting audio: ' + error.message, true);
        }
        
        leaveChat();
    }
}

// Add this check on page load
document.addEventListener('DOMContentLoaded', function() {
    if (!isSecureContext() && location.protocol !== 'file:') {
        showNotification(
            'For full audio call functionality, please use HTTPS or localhost. ' +
            'Some features may be limited in this context.', 
            true
        );
    }
});
