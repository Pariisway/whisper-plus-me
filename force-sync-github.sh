#!/bin/bash

echo "🚀 DEPLOYING WHISPER+ME TO GITHUB PAGES..."
echo "=========================================="

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Not a git repository. Initializing git..."
    git init
fi

# Add all files
echo "1. Adding all files to git..."
git add --all

echo "2. Checking status..."
git status --short

echo ""
echo "3. Checking for remote..."
if ! git remote | grep -q origin; then
    echo "Adding remote origin..."
    git remote add origin https://github.com/Pariisway/whisper-plus-me.git
fi

echo ""
echo "4. Pulling latest changes..."
git pull origin main --rebase --allow-unrelated-histories || echo "Continuing with force push..."

echo ""
echo "5. Creating commit..."
git commit -m "🚀 Production Deployment $(date '+%Y-%m-%d %H:%M:%S')

✅ Production fixes:
- GitHub Actions workflow fixed (v3 → v4)
- Firebase modular SDK properly implemented
- Agora UID consistency fixed
- Profile upload & social links added
- Security rules enhanced
- Login flow fixed

🌐 Live at: https://pariisway.github.io/whisper-plus-me/"

echo ""
echo "6. Pushing to GitHub..."
git push origin main --force

echo ""
echo "✅ DEPLOYMENT INITIATED!"
echo ""
echo "📊 Check GitHub Actions:"
echo "   https://github.com/Pariisway/whisper-plus-me/actions"
echo ""
echo "⏱️  Wait 1-2 minutes for deployment to complete"
echo "🌐 Live URL: https://pariisway.github.io/whisper-plus-me/"
echo ""
echo "🔄 To monitor deployment:"
echo "   git log --oneline -5"
echo "   curl -s https://pariisway.github.io/whisper-plus-me/ | head -c 100"
