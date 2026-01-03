#!/bin/bash

echo "🔧 Fixing Firebase Functions installation..."

cd functions

echo "1. Cleaning npm cache..."
npm cache clean --force

echo "2. Installing with specific version..."
# Remove existing node_modules if any
rm -rf node_modules package-lock.json

# Install with exact version
npm install agora-access-token@2.0.4 --save

echo "3. Installing all dependencies..."
npm install

echo "✅ Firebase Functions dependencies installed successfully!"

echo ""
echo "📋 To deploy Firebase Functions, run:"
echo "   firebase deploy --only functions"
