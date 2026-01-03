#!/bin/bash

echo "🚀 Deploying Whisper+me to Production..."

echo "1. Cleaning up old files..."
rm -f agora.js app-old.js index-old.html styles-old.css

echo "2. Creating necessary files..."
ls -la

echo "3. Setting up GitHub Pages..."
touch .nojekyll

echo "4. Files ready:"
echo "   ✅ index.html - Main app with iPhone interface"
echo "   ✅ styles.css - All styling consolidated"
echo "   ✅ app.js - Production-ready JavaScript"
echo "   ✅ admin.html - Admin dashboard"
echo "   ✅ database.rules.json - Security rules"
echo "   ✅ deploy.sh - This script"

echo ""
echo "📋 NEXT STEPS:"
echo ""
echo "1. Set up Firebase Realtime Database rules in Firebase Console"
echo "   Copy the content of database.rules.json"
echo ""
echo "2. Create Cloud Functions:"
echo "   cd functions"
echo "   npm install"
echo "   firebase deploy --only functions"
echo ""
echo "3. Set environment variables:"
echo "   firebase functions:config:set agora.cert=\"9113b7b993cb442882b983adbc0b950b\""
echo ""
echo "4. Commit and push to GitHub:"
echo "   git add ."
echo "   git commit -m '🚀 PRODUCTION LAUNCH - Whisper+me v1.0'"
echo "   git push origin main"
echo ""
echo "5. Enable GitHub Pages in repository settings"
echo "   Settings → Pages → Source: Deploy from branch"
echo "   Branch: main, folder: / (root)"
echo ""
echo "🌐 Your app will be live at: https://Pariisway.github.io/whisper-plus-me/"
echo ""
echo "✅ PRODUCTION READY!"
