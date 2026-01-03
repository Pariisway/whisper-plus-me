#!/bin/bash

echo "🔍 VERIFYING DEPLOYMENT..."
echo "=========================="

URL="https://pariisway.github.io/whisper-plus-me/"

echo "1. Testing GitHub Pages..."
if curl -s -I "$URL" | grep -q "200 OK"; then
    echo "✅ GitHub Pages is responding"
else
    echo "❌ GitHub Pages not responding"
    exit 1
fi

echo ""
echo "2. Testing main files..."
FILES=("index.html" "app.js" "styles.css" "health-check.html")
for file in "${FILES[@]}"; do
    if curl -s -I "$URL$file" | grep -q "200 OK"; then
        echo "✅ $file is accessible"
    else
        echo "❌ $file is NOT accessible"
    fi
done

echo ""
echo "3. Checking GitHub Actions status..."
if curl -s "https://api.github.com/repos/Pariisway/whisper-plus-me/actions/runs" | grep -q '"conclusion":"success"'; then
    echo "✅ Recent workflow succeeded"
else
    echo "⚠️ Check GitHub Actions manually"
fi

echo ""
echo "4. Checking deployment timestamp..."
curl -s "$URL" | grep -o "Deployed.*\|deployed.*\|Last.*[0-9]" | head -1 || echo "No timestamp found"

echo ""
echo "🌐 OPEN IN BROWSER:"
echo "   $URL"
echo "   $URL/health-check.html"
echo ""
echo "✅ Verification complete!"
