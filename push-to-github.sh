#!/bin/bash

echo "🔄 Setting up repository..."

# Remove any existing .git folder (just in case)
rm -rf .git

# Initialize fresh git repo
git init

# Add all files
git add .

# Initial commit
git commit -m "Initial commit: Whisper+me production ready"

# Add remote origin
git remote add origin https://github.com/Pariisway/whisper-plus-me.git

# Rename branch to main
git branch -M main

# Force push to GitHub (overwrites everything)
git push -u origin main --force

echo "✅ Pushed to GitHub successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Enable GitHub Pages:"
echo "   - Go to https://github.com/Pariisway/whisper-plus-me/settings/pages"
echo "   - Set Source to 'main' branch"
echo "   - Click Save"
echo ""
echo "2. Configure Firebase OAuth:"
echo "   - Go to https://console.firebase.google.com/project/whisper-chat-live/authentication/providers"
echo "   - Enable Facebook, Google providers"
echo "   - Add credentials from developer consoles"
echo ""
echo "3. Your site will be live at:"
echo "   https://pariisway.github.io/whisper-plus-me/"
