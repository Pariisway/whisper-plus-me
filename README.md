# Whisper+me - Live Anonymous Audio Chat

## Setup Instructions

### 1. Firebase Setup
1. Create a Firebase project at [firebase.google.com](https://firebase.google.com)
2. Enable Authentication (Email/Password)
3. Enable Realtime Database
4. Enable Cloud Functions
5. Add your web app to Firebase and get your configuration

### 2. Agora Setup
1. Sign up at [agora.io](https://agora.io)
2. Create a new project and get:
   - App ID
   - App Certificate (for token generation)
3. Update the Cloud Functions with your Agora credentials

### 3. Deploy Cloud Functions
```bash
cd functions
npm install
firebase deploy --only functions

