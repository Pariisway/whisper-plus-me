#!/bin/bash

echo "🔍 CHECKING GITHUB PAGES STATUS..."
echo "=================================="

echo "1. Checking if .nojekyll exists..."
if [ -f ".nojekyll" ]; then
    echo "✅ .nojekyll file exists"
else
    echo "❌ .nojekyll missing - creating..."
    touch .nojekyll
fi

echo ""
echo "2. Checking repository visibility..."
echo "   Repository: https://github.com/Pariisway/whisper-plus-me"
echo "   Public repositories automatically get GitHub Pages"
echo "   Private repositories require GitHub Pro"

echo ""
echo "3. MANUAL CHECK REQUIRED:"
echo ""
echo "   📱 Go to: https://github.com/Pariisway/whisper-plus-me/settings/pages"
echo ""
echo "   What do you see?"
echo "   - Is there a green 'Your site is live at...' message?"
echo "   - Or is there a setup section?"
echo ""
echo "   If not enabled:"
echo "   1. Under 'Source', select 'Deploy from a branch'"
echo "   2. Under 'Branch', select 'main' and '/ (root)'"
echo "   3. Click Save"
echo "   4. Wait 2 minutes"
