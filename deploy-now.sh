#!/bin/bash

echo "🚀 WHISPER+ME DEPLOYMENT SCRIPT"
echo "================================"
echo ""

# Get repository info
REPO_URL=$(git config --get remote.origin.url)
if [[ -z "$REPO_URL" ]]; then
    echo "❌ No Git repository found!"
    echo "Please initialize Git first:"
    echo "  git init"
    echo "  git remote add origin YOUR_GITHUB_REPO_URL"
    exit 1
fi

REPO_NAME=$(echo "$REPO_URL" | sed 's/.*github.com[:/]//;s/\.git$//')
SITE_URL="https://${REPO_NAME/\//.github.io/}"

echo "📁 Repository: $REPO_NAME"
echo "🌐 Site URL: $SITE_URL"
echo ""

# Step 1: Verify files
echo "📋 Verifying files..."
if [ ! -f "index.html" ]; then echo "❌ Missing: index.html"; exit 1; fi
if [ ! -f "styles.css" ]; then echo "❌ Missing: styles.css"; exit 1; fi
if [ ! -f "app.js" ]; then echo "❌ Missing: app.js"; exit 1; fi
if [ ! -f ".nojekyll" ]; then echo "⚠️  Missing: .nojekyll (creating...)" && touch .nojekyll; fi
if [ ! -f ".github/workflows/deploy.yml" ]; then echo "❌ Missing: .github/workflows/deploy.yml"; exit 1; fi
echo "✅ All required files present!"
echo ""

# Step 2: Stage changes
echo "📝 Staging changes..."
git add --all
CHANGES=$(git status --porcelain)
if [ -z "$CHANGES" ]; then
    echo "⚠️  No changes to commit!"
else
    echo "📦 Changes found:"
    echo "$CHANGES" | while read line; do echo "   $line"; done
fi
echo ""

# Step 3: Commit
echo "💾 Committing changes..."
read -p "Commit message (press enter for default): " COMMIT_MSG
if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="Deploy: $(date '+%Y-%m-%d %H:%M:%S')"
fi
git commit -m "$COMMIT_MSG" || {
    echo "⚠️  No changes to commit or commit failed"
    echo "Continuing with push..."
}
echo ""

# Step 4: Push to GitHub
echo "📤 Pushing to GitHub..."
if git push origin main; then
    echo "✅ Successfully pushed to GitHub!"
    echo ""
    echo "================================="
    echo "🎉 DEPLOYMENT INITIATED!"
    echo "================================="
    echo ""
    echo "📊 Monitor deployment at:"
    echo "   https://github.com/$REPO_NAME/actions"
    echo ""
    echo "🌐 Your site will be available at:"
    echo "   $SITE_URL"
    echo ""
    echo "⏳ Please wait 1-2 minutes for GitHub Pages to deploy."
    echo ""
    echo "🔧 Additional steps:"
    echo "   1. Go to GitHub → Settings → Pages"
    echo "   2. Select 'GitHub Actions' as source"
    echo "   3. Save settings"
    echo ""
    echo "📞 For Firebase Functions:"
    echo "   cd functions && npm install && firebase deploy --only functions"
else
    echo "❌ Failed to push to GitHub!"
    echo "Check your Git configuration and try again."
fi
