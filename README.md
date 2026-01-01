# Whisper+me

A platform for buying and selling 5-minute private audio chats.

## Features
- Buy tokens with Stripe ($15 per token)
- Sell 5-minute chats and earn $12 per call
- Real-time audio with Agora
- Mobile-optimized PWA
- Firebase authentication and database
- Social media sharing

## Setup Instructions

### 1. Firebase Setup
1. Go to https://console.firebase.google.com/
2. Create a new project "Whisper+me"
3. Enable Authentication (Email/Password)
4. Enable Realtime Database
5. Enable Storage
6. Update firebase-config.js with your credentials

### 2. Agora Setup
1. Sign up at https://www.agora.io/
2. Create a new project
3. Get your App ID
4. Update the appId in app.js

### 3. Stripe Setup
1. Sign up at https://stripe.com/
2. Get your publishable key
3. Update the Stripe key in app.js
4. Create product with ID: prod_TZ0C0wOq1WjSyy

### 4. Deployment

#### Option A: GitHub Pages
1. Create a new GitHub repository
2. Push all files to the repository
3. Go to Settings > Pages
4. Select main branch as source

#### Option B: DreamHost
1. Upload all files to your DreamHost public_html directory
2. Ensure .htaccess is configured for SPA routing

#### Option C: Firebase Hosting
1. Install Firebase CLI: `npm install -g firebase-tools`
2. Login: `firebase login`
3. Initialize: `firebase init`
4. Deploy: `firebase deploy`

## File Structure
- index.html - Main application
- app.js - Application logic
- firebase-config.js - Firebase configuration
- manifest.json - PWA manifest
- sw.js - Service worker
- assets/ - Images and icons

## Important Notes
1. For production, move sensitive keys to environment variables
2. Implement Firebase Functions for server-side operations
3. Add proper error handling and security rules
4. Test payment flow thoroughly
5. Add analytics tracking for user behavior

## Support
For issues or questions, please contact support.
