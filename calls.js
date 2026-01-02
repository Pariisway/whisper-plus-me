class CallManager {
  constructor() {
    this.currentCall = null;
    this.callListener = null;
    this.callTimer = null;
    this.callStartTime = null;
    this.isInCall = false;
  }

  static STATUS = {
    WAITING: 'waiting',
    RINGING: 'ringing', 
    ANSWERED: 'answered', 
    CONNECTED: 'connected',
    ENDED: 'ended', 
    DECLINED: 'declined', 
    TIMEOUT: 'timeout', 
    CANCELLED: 'cancelled'
  };

  async startCall(receiverId) {
    if (!window.App.auth.currentUser) {
      throw new Error('User not authenticated');
    }
    
    try {
      // Call Cloud Function to deduct coin and create call
      const deductCallCoin = firebase.functions().httpsCallable('deductCallCoin');
      const result = await deductCallCoin({ receiverId });
      
      const { callId, remainingCoins } = result.data;
      
      // Update local coins display
      if (window.App.auth.userData) {
        window.App.auth.userData.coins = remainingCoins;
        window.App.ui.updateUserInfo(window.App.auth.userData);
      }

      // Setup call listener
      this.setupCallListener(callId);
      
      this.currentCall = { 
        callId, 
        receiverId, 
        isCaller: true, 
        status: CallManager.STATUS.RINGING 
      };
      
      window.App.ui.showNotification('Call initiated! Waiting for answer...', 'success');
      
      return { success: true, callId };
      
    } catch (error) {
      console.error('Start call error:', error);
      
      if (error.message.includes('Insufficient coins')) {
        window.App.ui.showBuyCoinsModal();
      }
      
      throw error;
    }
  }

  async answerCall(callId) {
    try {
      // Update call status to answered
      const updateCallStatus = firebase.functions().httpsCallable('updateCallStatus');
      await updateCallStatus({
        callId, 
        status: CallManager.STATUS.ANSWERED
      });

      // Get call data
      const callSnapshot = await firebase.database().ref(`calls/${callId}`).once('value');
      const callData = callSnapshot.val();
      
      // Clear notification
      this.clearCallNotification(callId);
      
      // Setup call listener
      this.setupCallListener(callId);
      
      this.currentCall = { 
        callId, 
        callerId: callData.callerId, 
        isCaller: false, 
        status: CallManager.STATUS.ANSWERED 
      };
      
      window.App.ui.showNotification('Connecting call...', 'success');
      
      return { success: true };
      
    } catch (error) {
      console.error('Answer call error:', error);
      throw error;
    }
  }

  async declineCall(callId) {
    try {
      const updateCallStatus = firebase.functions().httpsCallable('updateCallStatus');
      await updateCallStatus({
        callId, 
        status: CallManager.STATUS.DECLINED
      });
      
      this.clearCallNotification(callId);
      this.cleanupCall();
      
      window.App.ui.showNotification('Call declined', 'info');
      
      return { success: true };
      
    } catch (error) {
      console.error('Decline call error:', error);
      throw error;
    }
  }

  async connectToAgora() {
    if (!this.currentCall) {
      throw new Error('No active call');
    }
    
    try {
      // Generate Agora token server-side
      const generateToken = firebase.functions().httpsCallable('generateAgoraToken');
      const tokenResponse = await generateToken({
        channelName: this.currentCall.callId
      });
      
      const { token, appId, uid } = tokenResponse.data;
      
      // Join Agora channel
      await window.App.agora.joinChannel(this.currentCall.callId, token, appId, uid);
      
      // Update call status to connected
      const updateCallStatus = firebase.functions().httpsCallable('updateCallStatus');
      await updateCallStatus({
        callId: this.currentCall.callId, 
        status: CallManager.STATUS.CONNECTED
      });
      
      this.isInCall = true;
      this.callStartTime = Date.now();
      this.startCallTimer();
      
      window.App.ui.showNotification('Call connected!', 'success');
      
      return { success: true };
      
    } catch (error) {
      console.error('Connect to Agora error:', error);
      throw error;
    }
  }

  async endCall() {
    if (!this.currentCall) return;
    
    try {
      // Leave Agora channel
      await window.App.agora.leaveChannel();
      
      // Update call status to ended
      const updateCallStatus = firebase.functions().httpsCallable('updateCallStatus');
      await updateCallStatus({
        callId: this.currentCall.callId, 
        status: CallManager.STATUS.ENDED
      });
      
      this.cleanupCall();
      window.App.ui.showNotification('Call ended', 'info');
      
      // Show rating modal
      setTimeout(() => {
        window.App.ui.showModal('rating-modal');
      }, 1000);
      
      return { success: true };
      
    } catch (error) {
      console.error('End call error:', error);
      throw error;
    }
  }

  setupCallListener(callId) {
    // Remove existing listener
    if (this.callListener) {
      firebase.database().ref(`calls/${callId}`).off('value', this.callListener);
    }

    // Setup new listener
    this.callListener = firebase.database().ref(`calls/${callId}`).on('value', async (snapshot) => {
      const callData = snapshot.val();
      if (!callData) return;
      
      switch (callData.status) {
        case CallManager.STATUS.CONNECTED:
          if (!this.isInCall) {
            await this.connectToAgora();
          }
          break;
          
        case CallManager.STATUS.DECLINED:
        case CallManager.STATUS.TIMEOUT:
        case CallManager.STATUS.CANCELLED:
          window.App.ui.showNotification(`Call ${callData.status}`, 'warning');
          this.cleanupCall();
          break;
          
        case CallManager.STATUS.ENDED:
          this.cleanupCall();
          break;
      }
    });
  }

  clearCallNotification(callId) {
    const userId = window.App.auth.currentUser?.uid;
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
        
        // Auto-end after 5 minutes (300 seconds)
        if (elapsed >= 300) {
          this.endCall();
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
    
    // Hide call UI if exists
    const callUI = document.getElementById('call-ui');
    if (callUI) callUI.style.display = 'none';
  }
}
