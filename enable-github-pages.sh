#!/bin/bash

echo "🎯 Setting up GitHub Pages..."

# Create CNAME file for custom domain (optional)
echo "pariisway.github.io" > CNAME

# Create a simple README
cat > README.md << 'README'
# Whisper+me - Live Anonymous Audio Chat

A real-time anonymous audio chat application built with Firebase and Agora.

## Features
- 🔒 Secure anonymous audio calls
- 💰 Coin-based payment system
- 👥 User profiles and ratings
- 🔔 Real-time notifications
- 💳 Stripe payment integration

## Live Demo
Visit: https://pariisway.github.io/whisper-plus-me/

## Setup
1. Clone repository
2. Configure Firebase project
3. Add API keys to .env file
4. Deploy to GitHub Pages

## Technologies
- Firebase (Auth, Database, Storage)
- Agora RTC (Voice calls)
- Stripe (Payments)
- JavaScript/HTML/CSS

## License
MIT
README

echo "✅ GitHub Pages setup complete!"
echo ""
echo "📝 Manual steps:"
echo "1. Go to: https://github.com/Pariisway/whisper-plus-me/settings/pages"
echo "2. Set Source to 'Deploy from a branch'"
echo "3. Select branch: 'main'"
echo "4. Select folder: '/ (root)'"
echo "5. Click Save"
echo ""
echo "🌐 Your site will be live at:"
echo "   https://pariisway.github.io/whisper-plus-me/"
