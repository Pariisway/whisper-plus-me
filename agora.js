class AgoraManager {
  constructor() {
    this.client = null;
    this.localTrack = null;
    this.remoteTracks = {};
    this.currentChannel = null;
    this.isMuted = false;
    this.isSpeakerOn = true;
  }

  async initialize() {
    if (typeof AgoraRTC === 'undefined') {
      throw new Error('Agora SDK not loaded');
    }
    
    this.client = AgoraRTC.createClient({ 
      mode: "rtc", 
      codec: "vp8" 
    });
    
    return true;
  }

  async joinChannel(channelName, token, appId, uid) {
    if (!this.client) await this.initialize();
    
    try {
      await this.client.join(appId, channelName, token, uid);
      this.currentChannel = channelName;

      // Create and publish local audio track
      this.localTrack = await AgoraRTC.createMicrophoneAudioTrack();
      await this.client.publish([this.localTrack]);

      // Setup remote track handling
      this.setupRemoteTracks();
      
      return { success: true, uid };
      
    } catch (error) {
      console.error('Join channel error:', error);
      throw error;
    }
  }

  setupRemoteTracks() {
    this.client.on('user-published', async (user, mediaType) => {
      await this.client.subscribe(user, mediaType);
      
      if (mediaType === 'audio') {
        this.remoteTracks[user.uid] = user.audioTrack;
        user.audioTrack.play();
      }
    });

    this.client.on('user-unpublished', (user) => {
      delete this.remoteTracks[user.uid];
    });
  }

  async leaveChannel() {
    if (!this.client) return;
    
    // Stop and close local track
    if (this.localTrack) {
      this.localTrack.stop();
      this.localTrack.close();
      this.localTrack = null;
    }

    // Close all remote tracks
    Object.values(this.remoteTracks).forEach(track => {
      if (track) track.close();
    });
    
    this.remoteTracks = {};

    // Leave channel
    await this.client.leave();
    this.currentChannel = null;
  }

  async toggleMic() {
    if (!this.localTrack) {
      throw new Error('Not in a call');
    }
    
    this.isMuted = !this.isMuted;
    await this.localTrack.setEnabled(!this.isMuted);
    
    return !this.isMuted;
  }

  async toggleSpeaker() {
    this.isSpeakerOn = !this.isSpeakerOn;
    
    Object.values(this.remoteTracks).forEach(track => {
      if (track) track.setVolume(this.isSpeakerOn ? 100 : 0);
    });
    
    return this.isSpeakerOn;
  }

  isInCall() { 
    return !!this.currentChannel; 
  }
}
