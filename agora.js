class AgoraManager {
    constructor() {
        this.client = null;
        this.localAudioTrack = null;
        this.remoteUsers = {};
        this.channel = null;
        this.appId = "966c8e41da614722a88d4372c3d95dba";
        this.certificate = "9113b7b993cb442882b983adbc0b950b";
    }
    
    async initiateCall(callId, targetUserId) {
        try {
            // Create Agora client
            this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
            
            // Initialize
            await this.client.join(this.appId, callId, this.certificate, targetUserId);
            
            // Create and publish local audio track
            this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
            await this.client.publish([this.localAudioTrack]);
            
            console.log("✅ Agora call initiated");
            
            // Subscribe to remote users
            this.client.on("user-published", async (user, mediaType) => {
                await this.client.subscribe(user, mediaType);
                if (mediaType === "audio") {
                    user.audioTrack.play();
                    this.remoteUsers[user.uid] = user;
                }
            });
            
            this.client.on("user-unpublished", (user) => {
                delete this.remoteUsers[user.uid];
            });
            
            return true;
            
        } catch (error) {
            console.error("❌ Agora error:", error);
            return false;
        }
    }
    
    async endCall() {
        try {
            if (this.localAudioTrack) {
                this.localAudioTrack.close();
            }
            
            if (this.client) {
                await this.client.leave();
            }
            
            this.client = null;
            this.localAudioTrack = null;
            this.remoteUsers = {};
            
            console.log("✅ Agora call ended");
            
        } catch (error) {
            console.error("Error ending Agora call:", error);
        }
    }
    
    toggleMic() {
        if (this.localAudioTrack) {
            if (this.localAudioTrack.muted) {
                this.localAudioTrack.setMuted(false);
                return true;
            } else {
                this.localAudioTrack.setMuted(true);
                return false;
            }
        }
        return false;
    }
}

// Initialize global Agora manager
window.AgoraManager = AgoraManager;
window.agoraManager = new AgoraManager();
