#!/bin/bash
echo "🚀 Pushing Whisper+me updates to GitHub..."

# Check if there are any changes
if [[ -z $(git status --porcelain) ]]; then
  echo "✅ No changes to commit"
  exit 0
fi

echo "📦 Staging changes..."
git add .

echo "💾 Creating commit..."
git commit -m "Production fixes: Working X buttons, image upload, admin access, and call system"

echo "📤 Pushing to GitHub..."
git push origin dashboard-fixes-v2

echo ""
echo "✅ Successfully pushed to GitHub!"
echo "📋 Branch: dashboard-fixes-v2"
echo "🔗 Repository: https://github.com/Pariisway/whisper-plus-me"
