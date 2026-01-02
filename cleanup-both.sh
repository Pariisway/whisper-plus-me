#!/bin/bash

echo "🧹 Cleaning up local and GitHub repository..."

# Local cleanup
echo "📁 Cleaning local files..."
find . -name "*.backup*" -type f -delete
find . -name "*.tmp" -type f -delete
find . -name "*.log" -type f -delete
find . -name "test-*" -type f -delete
rm -rf __pycache__ node_modules .cache .vscode .idea
rm -f start-*.sh update-*.sh localhost.*

# Keep only essential files
echo "📋 Keeping only essential files..."
KEEP_FILES=(
    "index.html" "app.js" "auth.js" "ui.js" "calls.js" 
    "payments.js" "agora.js" "styles.css" "database.rules.json"
    "package.json" "README.md" ".gitignore" ".env.example"
)

# Create clean structure
mkdir -p temp_clean
for file in "${KEEP_FILES[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "temp_clean/"
    fi
done

# Clean current directory
rm -rf *
cp -r temp_clean/* .
rm -rf temp_clean

# GitHub cleanup (prepare for push)
echo "🐙 Preparing GitHub cleanup..."
cat > .gitignore << 'GITIGNORE'
# Dependencies
node_modules/
.npm

# Environment variables
.env
.env.local

# Build outputs
dist/
build/

# Logs
*.log
npm-debug.log*

# Runtime data
.DS_Store
Thumbs.db

# Backup files
*.backup
*.old

# Temporary files
*.tmp
*.temp

# Local server files
localhost.*
.cert/
GITIGNORE

echo "✅ Local cleanup complete"
echo ""
echo "📝 To clean GitHub repo:"
echo "1. git add ."
echo "2. git commit -m 'Cleanup: Remove unnecessary files'"
echo "3. git push -f origin main"
echo ""
echo "⚠️  WARNING: 'git push -f' will overwrite remote history"
