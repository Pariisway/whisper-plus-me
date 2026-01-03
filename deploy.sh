#!/bin/bash

echo "🚀 Deploying Whisper+me..."

# Step 1: Commit all changes
echo "📝 Committing changes..."
git add .
git commit -m "Deploy: $(date '+%Y-%m-%d %H:%M:%S')" || {
    echo "❌ No changes to commit or commit failed"
    echo "Continuing with deployment..."
}

# Step 2: Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin main || {
    echo "❌ Failed to push to GitHub"
    exit 1
}

echo ""
echo "✅ Code pushed to GitHub!"
echo ""
echo "📊 GitHub Actions will now deploy to Pages."
echo "   Check: https://github.com/$(git config --get remote.origin.url | sed 's/.*github.com[:/]//;s/\.git$//')/actions"
echo ""
echo "🌐 Your site will be available at:"
echo "   https://$(git config --get remote.origin.url | sed 's/.*github.com[:/]//;s/\.git$//' | tr ':' '/')"
echo ""
echo "⏳ Please wait a few minutes for deployment to complete."
echo ""
echo "🔧 To deploy Firebase Functions separately, run:"
echo "   cd functions && npm install && firebase deploy --only functions"
