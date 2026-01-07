#!/bin/bash

# Whisper+me GitHub Setup Script

echo "🚀 Setting up GitHub repository..."

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git not found. Please install git first."
    exit 1
fi

# Initialize git if not already
if [ ! -d ".git" ]; then
    git init
fi

# Check if we have files to commit
if [ -z "$(git status --porcelain)" ]; then
    echo "⚠️ No changes to commit. Adding all files..."
    git add .
fi

# Create initial commit
git commit -m "Initial commit: Whisper+me - Live anonymous audio chat platform" || {
    echo "⚠️ No changes to commit or commit failed."
}

# Ask for GitHub repository URL
echo ""
echo "📝 Please enter your GitHub repository URL:"
echo "Example: https://github.com/yourusername/whisper-plus-me.git"
echo ""
read -p "GitHub URL: " github_url

if [ -z "$github_url" ]; then
    echo "❌ No URL provided. Exiting."
    exit 1
fi

# Add remote and push
echo "🔗 Adding remote repository..."
git remote add origin "$github_url" 2>/dev/null || git remote set-url origin "$github_url"

echo "🌿 Setting up main branch..."
git branch -M main

echo "📤 Pushing to GitHub..."
git push -u origin main

echo ""
echo "✅ Successfully pushed to GitHub!"
echo "🌐 Repository: $github_url"
echo ""
echo "📋 Next steps:"
echo "1. Enable GitHub Pages in repository settings (if desired)"
echo "2. Set up Firebase environment variables"
echo "3. Deploy with: ./deploy.sh"
echo ""
echo "For Firebase deployment, make sure you have:"
echo "- Firebase CLI installed: npm install -g firebase-tools"
echo "- Logged in: firebase login"
echo "- Project set up: firebase init"
