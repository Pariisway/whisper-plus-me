#!/bin/bash
echo "Enter your Agora App ID: "
read agoraId
sed -i "s/agoraAppId: '.*'/agoraAppId: '${agoraId}'/" app.js
echo "✅ Agora App ID updated!"
echo "Now commit and push:"
echo "git commit -am 'Add Agora App ID' && git push"
