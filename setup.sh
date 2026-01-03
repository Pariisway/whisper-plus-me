#!/bin/bash

echo "🚀 Setting up Whisper+me project..."

# Create necessary directories
mkdir -p functions

# Create .nojekyll file
touch .nojekyll

# Create basic files if they don't exist
if [ ! -f "index.html" ]; then
  echo "<!DOCTYPE html>
<html>
<head>
    <title>Whisper+me</title>
</head>
<body>
    <h1>Whisper+me - Coming Soon</h1>
    <p>Live anonymous audio chat platform</p>
</body>
</html>" > index.html
fi

if [ ! -f "styles.css" ]; then
  echo "/* Styles will be added */" > styles.css
fi

if [ ! -f "app.js" ]; then
  echo "// App JavaScript will be added" > app.js
fi

# Set up functions directory
cd functions
npm init -y

echo "✅ Project setup complete!"
echo "📁 Files created:"
echo "  - .github/workflows/deploy.yml"
echo "  - .nojekyll"
echo "  - setup.sh"
echo ""
echo "📦 Next steps:"
echo "1. Commit and push to GitHub"
echo "2. Enable GitHub Pages in repository settings"
echo "3. Deploy Firebase Functions with: ./deploy-firebase.sh"
