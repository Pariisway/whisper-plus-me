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
    this.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    return true;
  }

  async joinChannel(channelName) {
    if (!this.client) await this.initialize();
    
    try {
      const tokenResponse = await firebase.functions().httpsCallable('generateAgoraToken')({
        channelName
      });

      const { token, appId, uid } = tokenResponse.data;
      await this.client.join(appId, channelName, token, uid);
      this.currentChannel = channelName;

      this.localTrack = await AgoraRTC.createMicrophoneAudioTrack();
      await this.client.publish([this.localTrack]);

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
    
    if (this.localTrack) {
      this.localTrack.stop();
      this.localTrack.close();
      this.localTrack = null;
    }

    Object.values(this.remoteTracks).forEach(track => {
      if (track) track.close();
    });
    this.remoteTracks = {};

    await this.client.leave();
    this.currentChannel = null;
  }

  async toggleMic() {
    if (!this.localTrack) throw new Error('Not in a call');
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

  isInCall() { return !!this.currentChannel; }
}

window.agoraManager = new AgoraManager();
