// Agora RTC - Secure token-based implementation
console.log('🎙️ Agora SDK loaded on demand');

// Global function to load Agora SDK
window.loadAgoraSDK = function() {
    return new Promise((resolve, reject) => {
        if (window.AgoraRTC) {
            resolve(window.AgoraRTC);
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://download.agora.io/sdk/release/AgoraRTC_N-4.18.2.js';
        script.onload = () => resolve(window.AgoraRTC);
        script.onerror = reject;
        document.head.appendChild(script);
    });
};

// Secure Agora manager
window.AgoraManager = {
    client: null,
    localTrack: null,
    currentCallId: null,
    
    async getToken(channelName) {
        try {
            const getTokenFn = window.firebase.functions().httpsCallable('getAgoraToken');
            const result = await getTokenFn({ channel: channelName });
            return result.data.token;
        } catch (error) {
            console.error('Token error:', error);
            throw error;
        }
    },
    
    async joinChannel(channelName) {
        try {
            await this.leaveChannel(); // Clean up any existing session
            
            const AgoraRTC = await loadAgoraSDK();
            const token = await this.getToken(channelName);
            
            this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
            
            // Join with UID from Firebase auth
            await this.client.join(
                "966c8e41da614722a88d4372c3d95dba", // App ID
                channelName,
                token,
                window.firebase.auth().currentUser.uid
            );
            
            // Create and publish audio track
            this.localTrack = await AgoraRTC.createMicrophoneAudioTrack();
            await this.client.publish([this.localTrack]);
            
            this.currentCallId = channelName;
            
            // Start heartbeat for crash detection
            this.startHeartbeat(channelName);
            
            return { client: this.client, track: this.localTrack };
        } catch (error) {
            console.error('Join channel error:', error);
            throw error;
        }
    },
    
    async leaveChannel() {
        if (this.localTrack) {
            this.localTrack.stop();
            this.localTrack.close();
            this.localTrack = null;
        }
        
        if (this.client) {
            await this.client.leave();
            this.client = null;
        }
        
        this.currentCallId = null;
        this.stopHeartbeat();
    },
    
    startHeartbeat(callId) {
        this.heartbeatInterval = setInterval(() => {
            const userId = window.firebase.auth().currentUser?.uid;
            if (userId && callId) {
                const role = window.whisperAppInstance?.currentCall?.callerId === userId ? 'caller' : 'whisper';
                window.firebase.database().ref(`calls/${callId}/lastHeartbeat${role}`).set(Date.now());
            }
        }, 5000);
    },
    
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    },
    
    async setupRemoteUserHandlers(onUserJoined, onUserLeft) {
        if (!this.client) return;
        
        this.client.on("user-published", async (user, mediaType) => {
            if (mediaType === "audio") {
                await this.client.subscribe(user, mediaType);
                if (onUserJoined) onUserJoined(user);
            }
        });
        
        this.client.on("user-left", (user) => {
            if (onUserLeft) onUserLeft(user);
        });
    }
};
