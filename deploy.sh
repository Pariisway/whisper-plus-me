#!/bin/bash

echo "🚀 Deploying to GitHub Pages..."

# 1. Check if we're on master or main
CURRENT_BRANCH=$(git branch --show-current)
echo "Current branch: $CURRENT_BRANCH"

# 2. If branch is master, rename to main
if [ "$CURRENT_BRANCH" = "master" ]; then
    echo "Renaming branch from master to main..."
    git branch -M main
    CURRENT_BRANCH="main"
fi

# 3. Clean up files
echo "🧹 Cleaning up..."
find . -name "*.backup*" -type f -delete 2>/dev/null || true
rm -f test-login.html 2>/dev/null || true

# 4. Add all files
echo "📦 Adding files..."
git add .

# 5. Commit
echo "💾 Committing..."
git commit -m "Deploy: Enhanced OAuth support and cleanup" || echo "No changes to commit"

# 6. Push to GitHub
echo "📤 Pushing to GitHub..."
git push -u origin $CURRENT_BRANCH --force

echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "1. Visit: https://github.com/Pariisway/whisper-plus-me"
echo "2. Go to Settings → Pages"
echo "3. Set Source to 'main' branch"
echo "4. Save and wait for deployment"
echo ""
echo "🌐 Your site will be at: https://pariisway.github.io/whisper-plus-me/"
