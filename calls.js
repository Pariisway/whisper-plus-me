class CallManager {
  constructor() {
    this.currentCall = null;
    this.callListener = null;
    this.callTimer = null;
    this.callStartTime = null;
    this.isInCall = false;
  }

  static STATUS = {
    RINGING: 'ringing', ANSWERED: 'answered', CONNECTED: 'connected',
    ENDED: 'ended', DECLINED: 'declined', TIMEOUT: 'timeout', CANCELLED: 'cancelled'
  };

  async startCall(receiverId) {
    if (!window.authManager.currentUser) throw new Error('User not authenticated');
    
    try {
      const result = await firebase.functions().httpsCallable('deductCallCoin')({ receiverId });
      const { callId, remainingCoins } = result.data;
      
      if (window.authManager.userData) {
        window.authManager.userData.coins = remainingCoins;
        window.UI.updateUI();
      }

      this.setupCallListener(callId);
      this.currentCall = { callId, receiverId, isCaller: true, status: CallManager.STATUS.RINGING };
      window.UI.showCallUI(callId, receiverId, true);
      
      return { success: true, callId };
    } catch (error) {
      console.error('Start call error:', error);
      if (error.message.includes('Insufficient coins')) window.UI.showBuyCoinsModal();
      throw error;
    }
  }

  async answerCall(callId) {
    try {
      await firebase.functions().httpsCallable('updateCallStatus')({
        callId, status: CallManager.STATUS.ANSWERED
      });

      const callSnapshot = await firebase.database().ref(`calls/${callId}`).once('value');
      const callData = callSnapshot.val();
      this.clearCallNotification(callId);
      this.setupCallListener(callId);
      this.currentCall = { callId, callerId: callData.callerId, isCaller: false, status: CallManager.STATUS.ANSWERED };
      window.UI.showCallUI(callId, callData.callerId, false);
      
      return { success: true };
    } catch (error) {
      console.error('Answer call error:', error);
      throw error;
    }
  }

  async declineCall(callId) {
    try {
      await firebase.functions().httpsCallable('updateCallStatus')({
        callId, status: CallManager.STATUS.DECLINED
      });
      this.clearCallNotification(callId);
      this.cleanupCall();
      return { success: true };
    } catch (error) {
      console.error('Decline call error:', error);
      throw error;
    }
  }

  async connectToAgora() {
    if (!this.currentCall) throw new Error('No active call');
    
    try {
      await window.agoraManager.joinChannel(this.currentCall.callId);
      await firebase.functions().httpsCallable('updateCallStatus')({
        callId: this.currentCall.callId, status: CallManager.STATUS.CONNECTED
      });
      
      this.isInCall = true;
      this.callStartTime = Date.now();
      this.startCallTimer();
      return { success: true };
    } catch (error) {
      console.error('Connect to Agora error:', error);
      throw error;
    }
  }

  async endCall() {
    if (!this.currentCall) return;
    
    try {
      await window.agoraManager.leaveChannel();
      await firebase.functions().httpsCallable('updateCallStatus')({
        callId: this.currentCall.callId, status: CallManager.STATUS.ENDED
      });
      this.cleanupCall();
      return { success: true };
    } catch (error) {
      console.error('End call error:', error);
      throw error;
    }
  }

  setupCallListener(callId) {
    if (this.callListener) {
      firebase.database().ref(`calls/${callId}`).off('value', this.callListener);
    }

    this.callListener = firebase.database().ref(`calls/${callId}`).on('value', async (snapshot) => {
      const callData = snapshot.val();
      if (!callData) return;
      
      switch (callData.status) {
        case CallManager.STATUS.CONNECTED:
          if (!this.isInCall) await this.connectToAgora();
          break;
        case CallManager.STATUS.DECLINED:
        case CallManager.STATUS.TIMEOUT:
        case CallManager.STATUS.CANCELLED:
          window.UI.showToast(`Call ${callData.status}`, 'warning');
          this.cleanupCall();
          break;
        case CallManager.STATUS.ENDED:
          this.cleanupCall();
          break;
      }
    });
  }

  clearCallNotification(callId) {
    const userId = window.authManager.currentUser?.uid;
    if (!userId) return;
    const notificationRef = firebase.database().ref(`notifications/${userId}`);
    notificationRef.orderByChild('callId').equalTo(callId).once('value').then((snapshot) => {
      snapshot.forEach((child) => child.ref.remove());
    });
  }

  startCallTimer() {
    if (this.callTimer) clearInterval(this.callTimer);
    this.callTimer = setInterval(() => {
      if (this.callStartTime) {
        const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const timerElement = document.getElementById('call-timer');
        if (timerElement) {
          timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
      }
    }, 1000);
  }

  cleanupCall() {
    if (this.callTimer) {
      clearInterval(this.callTimer);
      this.callTimer = null;
    }
    if (this.callListener && this.currentCall?.callId) {
      firebase.database().ref(`calls/${this.currentCall.callId}`).off('value', this.callListener);
      this.callListener = null;
    }
    this.currentCall = null;
    this.callStartTime = null;
    this.isInCall = false;
    window.UI.hideCallUI();
  }
}

window.callManager = new CallManager();
