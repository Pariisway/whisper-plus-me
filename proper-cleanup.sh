#!/bin/bash

echo "🧹 Proper cleanup - keeping only essential files..."

# Create a list of essential files to keep
ESSENTIAL_FILES=(
    # Core files
    "index.html"
    "app.js"
    "auth.js"
    "ui.js"
    "calls.js"
    "payments.js"
    "agora.js"
    "styles.css"
    "database.rules.json"
    "package.json"
    "README.md"
    ".gitignore"
    ".env.example"
    
    # New OAuth files
    "auth-enhanced.js"
    "firebase-oauth-setup.js"
    
    # Scripts
    "cleanup-both.sh"
    "deploy.sh"
    "push-to-github.sh"
    "proper-cleanup.sh"
)

# Remove unnecessary files and directories
echo "Removing unnecessary files..."
rm -rf backup_* 2>/dev/null || true
rm -f test-*.html 2>/dev/null || true
rm -f *.backup* 2>/dev/null || true
rm -rf __pycache__ 2>/dev/null || true
rm -f localhost.* 2>/dev/null || true

echo "✅ Cleanup complete!"
echo ""
echo "📁 Current files:"
ls -la
