#!/bin/bash

echo "🚀 Deploying Whisper+me to GitHub Pages..."

# Check if we're in a git repository
if [ ! -d ".git" ]; then
  echo "❌ Not a git repository. Initializing..."
  git init
fi

# Add all files
git add .

# Commit changes
git commit -m "Deploy Whisper+me MVP $(date)"

# Create or update gh-pages branch
git checkout -b gh-pages 2>/dev/null || git checkout gh-pages

# Merge changes
git merge main --no-edit --strategy-option theirs 2>/dev/null || git merge master --no-edit --strategy-option theirs

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin gh-pages --force

echo "✅ Deployment complete!"
echo "🌐 Your site should be live at: https://[your-username].github.io/[repository-name]/"
echo "📱 Remember to enable GitHub Pages in repository settings!"
