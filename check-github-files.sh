#!/bin/bash

echo "📁 CHECKING FILES ON GITHUB..."
echo "==============================="

echo "1. Checking via GitHub API..."
curl -s "https://api.github.com/repos/Pariisway/whisper-plus-me/contents/" | \
  grep -E '"name":|"type":' | head -30

echo ""
echo "2. Checking raw GitHub URLs:"
echo "   index.html: $(curl -s -o /dev/null -w "%{http_code}" 'https://raw.githubusercontent.com/Pariisway/whisper-plus-me/main/index.html')"
echo "   app.js: $(curl -s -o /dev/null -w "%{http_code}" 'https://raw.githubusercontent.com/Pariisway/whisper-plus-me/main/app.js')"
echo "   styles.css: $(curl -s -o /dev/null -w "%{http_code}" 'https://raw.githubusercontent.com/Pariisway/whisper-plus-me/main/styles.css')"

echo ""
echo "3. If raw URLs return 200 but Pages URLs return 404:"
echo "   ⚠️  GitHub Pages is NOT enabled or misconfigured"
echo ""
echo "4. SOLUTION: Enable GitHub Pages in Settings → Pages"
