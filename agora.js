// Agora RTC - Loaded on demand
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

// Minimal Agora manager
window.AgoraManager = {
    async initCall(channelName, uid) {
        try {
            await loadAgoraSDK();
            const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
            return client;
        } catch (error) {
            console.error('Agora init error:', error);
            return null;
        }
    }
};
