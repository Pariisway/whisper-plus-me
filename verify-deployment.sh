#!/bin/bash

echo "🔍 Verifying deployment..."

# Check essential files
ESSENTIAL_FILES=("index.html" "app.js" "auth.js" "ui.js" "styles.css")
for file in "${ESSENTIAL_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file - MISSING"
    fi
done

echo ""
echo "🌐 Live URL: https://pariisway.github.io/whisper-plus-me/"
echo ""
echo "📝 If you see 404:"
echo "   Wait 2 minutes and refresh"
echo "   Or check: https://github.com/Pariisway/whisper-plus-me/actions"
echo ""
echo "🎯 If you see blank page:"
echo "   Check browser console (F12)"
echo "   Common issues:"
echo "   - Firebase API key issues"
echo "   - Mixed content (HTTP/HTTPS)"
echo "   - CORS errors"
