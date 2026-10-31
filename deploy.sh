#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Whisper+Me: test, deploy and save to GitHub in one step.
#   ./deploy.sh "what changed"            the usual deploy
#   ./deploy.sh "what changed" --agora    also update the call voice-pass function
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"
MSG="${1:-Update}"

echo "▶ Installing and testing the server code…"
(cd functions-nights && npm install --no-audit --no-fund --loglevel=error && npm test)

echo "▶ Deploying the site, rules and server…"
firebase deploy --only database,firestore,storage,hosting,functions:nights

if [[ " $* " == *" --agora "* ]]; then
  echo "▶ Updating generateAgoraToken (main functions)…"
  (cd functions && npm install --no-audit --no-fund --loglevel=error)
  firebase deploy --only functions:default:generateAgoraToken
fi

echo "▶ Saving to GitHub…"
git add -A
git commit -q -m "$MSG" && echo "  saved: $MSG" || echo "  (nothing new to save)"
git push
echo "✔ Done"
