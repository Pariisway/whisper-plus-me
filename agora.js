// Agora RTC - Fixed UID consistency
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

// Fixed Agora manager with consistent UID
window.AgoraManager = {
    client: null,
    localTrack: null,
    currentCallId: null,
    heartbeatInterval: null,
    
    async joinChannel(channelName, uid, token) {
        try {
            await this.leaveChannel(); // Clean up any existing session
            
            const AgoraRTC = await loadAgoraSDK();
            
            this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
            
            // FIXED: Use provided UID (Firebase UID converted to number for Agora)
            const agoraUid = this.convertToNumericUid(uid);
            
            console.log('🎯 Joining Agora channel:', { channelName, uid, agoraUid });
            
            await this.client.join(
                "966c8e41da614722a88d4372c3d95dba", // App ID
                channelName,
                token,
                agoraUid
            );
            
            // Create and publish audio track
            this.localTrack = await AgoraRTC.createMicrophoneAudioTrack();
            await this.client.publish([this.localTrack]);
            
            this.currentCallId = channelName;
            
            console.log('✅ Successfully joined Agora channel');
            
            return { client: this.client, track: this.localTrack };
        } catch (error) {
            console.error('Join channel error:', error);
            throw error;
        }
    },
    
    // Convert Firebase UID string to numeric UID for Agora
    convertToNumericUid(uid) {
        // Simple hash function to convert string to number
        let hash = 0;
        for (let i = 0; i < uid.length; i++) {
            const char = uid.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
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
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    },
    
    async setupRemoteUserHandlers(onUserJoined, onUserLeft) {
        
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
