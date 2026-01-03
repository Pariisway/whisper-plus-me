#!/bin/bash

echo "⚡ QUICK TEST..."
echo "==============="

echo "1. Testing site accessibility..."
curl -s "https://pariisway.github.io/whisper-plus-me/" | grep -o '<title>[^<]*</title>'

echo ""
echo "2. Testing critical files:"
for file in index.html app.js styles.css; do
    if curl -s -I "https://pariisway.github.io/whisper-plus-me/$file" | grep -q "200 OK"; then
        echo "✅ $file"
    else
        echo "❌ $file"
    fi
done

echo ""
echo "3. Testing Firebase connection..."
echo "   (This requires browser testing)"
echo ""
echo "🌐 OPEN IN BROWSER:"
echo "   https://pariisway.github.io/whisper-plus-me/"
echo ""
echo "📱 BROWSER TEST CHECKLIST:"
echo "   ✅ Page loads without errors"
echo "   ✅ No red errors in console (F12)"
echo "   ✅ Firebase initializes (check console)"
echo "   ✅ Login buttons work"
echo "   ✅ Profile cards display"
