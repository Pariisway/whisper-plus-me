#!/bin/bash
echo "🚀 Deploying Whisper+me to production..."

echo "📦 Creating backups..."
cp index.html index.html.backup
cp app.js app.js.backup
cp admin.js admin.js.backup

echo "✅ Files updated"
echo ""
echo "To deploy:"
echo "1. Run: firebase deploy --only hosting"
echo "2. For Firebase Functions:"
echo "   cd functions && npm install"
echo "   firebase deploy --only functions"
echo ""
echo "Configure environment variables:"
echo "firebase functions:config:set stripe.secret=YOUR_STRIPE_SECRET"
echo "firebase functions:config:set stripe.webhook_secret=YOUR_WEBHOOK_SECRET"
echo "firebase functions:config:set agora.app_id=966c8e41da614722a88d4372c3d95dba"
echo "firebase functions:config:set agora.certificate=9113b7b993cb442882b983adbc0b950b"
echo ""
echo "Admin: ifanifwasafifth@gmail.com"
