#!/bin/bash
echo "🔍 Diagnosing Git issues..."

# Check current status
echo "1. Checking Git status..."
git status

echo ""
echo "2. Checking remote repository..."
git remote -v

echo ""
echo "3. Checking current branch..."
git branch -a

echo ""
echo "4. Checking Git configuration..."
git config --list | grep -E "(user\.|remote\.)"

echo ""
echo "5. Checking for uncommitted changes..."
git diff --name-only

echo ""
echo "🚀 Attempting to fix Git issues..."

# Make sure we have the correct remote
echo ""
echo "6. Setting correct remote URL..."
git remote set-url origin https://github.com/Pariisway/whisper-plus-me.git
git remote -v

# Add all changes
echo ""
echo "7. Adding all files..."
git add .

# Commit changes
echo ""
echo "8. Committing changes..."
git commit -m "Production deployment: Fixed all buttons, call flow, and authentication"

# Try to push
echo ""
echo "9. Attempting to push to repository..."
git push origin main || git push origin master

# If that fails, try force push
if [ $? -ne 0 ]; then
    echo ""
    echo "⚠️  Regular push failed, trying force push..."
    echo "   (This will overwrite remote changes - make sure you want this)"
    read -p "   Continue with force push? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push --force origin main || git push --force origin master
    fi
fi

echo ""
echo "✅ Git operations completed!"
echo "   If you still have issues, check:"
echo "   1. GitHub account permissions"
echo "   2. Personal Access Token (required instead of password)"
echo "   3. Internet connectivity"
echo ""
echo "📝 To create a Personal Access Token:"
echo "   Go to GitHub → Settings → Developer settings → Personal access tokens"
echo "   Create token with 'repo' scope and use it as password when prompted"
