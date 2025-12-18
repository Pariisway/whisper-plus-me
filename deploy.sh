#!/bin/bash
echo "🚀 Deploying Whisper+me to GitHub..."

# Run cleanup
chmod +x cleanup.sh
./cleanup.sh

# Add all files to git
git add app.js admin.html styles.css cleanup.sh deploy.sh

# Remove deleted files
git add -u

# Commit
git commit -m "Launch ready: Simplified 1-coin system, Whisper IDs, admin dashboard"

# Push to GitHub
git push origin main

echo "✅ Deployment complete!"
echo "📁 Files updated:"
echo "  - app.js (simplified 1-coin system)"
echo "  - admin.html (payout dashboard)"
echo "  - styles.css (updated styles)"
echo "  - cleanup.sh (cleanup script)"
echo "  - deploy.sh (deploy script)"
