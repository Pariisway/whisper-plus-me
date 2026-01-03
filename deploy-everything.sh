#!/bin/bash

echo "🚀 DEPLOYING EVERYTHING TO GITHUB..."
echo "===================================="

echo "1. Adding all files..."
git add --all

echo "2. Checking status..."
git status --short

echo ""
echo "3. Creating commit..."
git commit -m "🚀 Complete Deployment - All Production Files

✅ Core Application:
- index.html (Main application)
- app.js (Firebase + Agora logic)
- styles.css (Styling)
- agora.js (Agora RTC integration)
- payments.js (Stripe payments)
- database.rules.json (Firebase security)

✅ Configuration:
- .nojekyll (Disable Jekyll processing)
- .gitignore (Ignore unnecessary files)
- package.json (Project metadata)

✅ Deployment:
- Deployment scripts
- Health check page
- GitHub Actions workflow

🌐 Ready for: https://pariisway.github.io/whisper-plus-me/"

echo ""
echo "4. Pushing to GitHub..."
git push origin main

echo ""
echo "✅ PUSHED TO GITHUB!"
echo ""
echo "⚡ NEXT STEPS:"
echo "1. Go to: https://github.com/Pariisway/whisper-plus-me/settings/pages"
echo "2. Enable GitHub Pages:"
echo "   - Source: Deploy from a branch"
echo "   - Branch: main"
echo "   - Folder: / (root)"
echo "3. Click Save"
echo "4. Wait 2 minutes"
echo "5. Visit: https://pariisway.github.io/whisper-plus-me/"
