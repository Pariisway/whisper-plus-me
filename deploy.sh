#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Whisper+Me: test, deploy and save to GitHub in one step.
#   ./deploy.sh "what changed"              the usual deploy (+ GitHub)
#   ./deploy.sh "what changed" --agora      also update the call voice-pass function
#   ./deploy.sh "what changed" --money      also update the main app's money functions (calls, rooms, coin purchases)
#   ./deploy.sh "what changed" --main       also copy this version to GitHub's main branch (master)
#   ./deploy.sh "what changed" --github-only   just save to GitHub, don't deploy
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"
MSG="${1:-Update}"
AGORA=0; MAIN=0; GHONLY=0; MONEY=0
for a in "$@"; do
  case "$a" in --agora) AGORA=1 ;; --money) MONEY=1 ;; --main) MAIN=1 ;; --github-only) GHONLY=1 ;; esac
done

if [ "$GHONLY" = 0 ]; then
  command -v firebase >/dev/null || { echo "✖ The Firebase CLI isn't installed. Run: npm install -g firebase-tools"; exit 1; }

  echo "▶ Installing and testing the server code…"
  (cd functions-nights && npm install --no-audit --no-fund --loglevel=error && npm test)
  (cd functions && npm install --no-audit --no-fund --loglevel=error && npm test)

  echo "▶ Fingerprinting the site's scripts (so browsers can cache them safely)…"
  node tools/apply-share.js   # link previews you set in Admin → 🔗 Share
  node tools/stamp-assets.js

  echo "▶ Deploying the site, rules, indexes and server…"
  firebase deploy --only database,firestore,storage,hosting,functions:nights

  if [ "$MONEY" = 1 ]; then
    echo "▶ Updating the main app's money functions (calls, member rooms, coin purchases, account deletion)…"
    firebase deploy --only functions:default:startCall,functions:default:completeCallPayout,functions:default:stripeWebhook,functions:default:joinMemberRoom,functions:default:processMemberRoomEarnings,functions:default:deleteAccount,functions:default:createCoinCheckout,functions:default:createStripeConnectLink
  fi

  if [ "$AGORA" = 1 ]; then
    echo "▶ Updating generateAgoraToken (main functions)…"
    (cd functions && npm install --no-audit --no-fund --loglevel=error)
    firebase deploy --only functions:default:generateAgoraToken
  fi
fi

echo "▶ Saving to GitHub…"
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "✖ This folder isn't linked to GitHub. Run once:"
  echo "    git remote add origin https://github.com/Pariisway/whisper-plus-me.git"
  exit 1
fi
# A name for the commits, if this computer doesn't have one yet.
git config user.name  >/dev/null || git config user.name  "Whisper+Me deploy"
git config user.email >/dev/null || git config user.email "whisper.me.support@gmail.com"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git add -A
if git diff --cached --quiet; then
  echo "  (nothing new to save)"
else
  git commit -q -m "$MSG"
  echo "  saved: $MSG"
fi

push_branch() {
  if git push -u origin "$BRANCH"; then return 0; fi
  echo "  GitHub has changes this computer doesn't have yet. Bringing them in…"
  if git pull --rebase origin "$BRANCH" && git push -u origin "$BRANCH"; then return 0; fi
  git rebase --abort 2>/dev/null || true
  echo "✖ Couldn't save to GitHub. The site IS deployed; only the GitHub copy is behind."
  echo "  If it asked for a password: GitHub needs a token, not your password. Run 'gh auth login' once,"
  echo "  then run:  ./deploy.sh \"$MSG\" --github-only"
  return 1
}
push_branch

if [ "$MAIN" = 1 ]; then
  DEF="$(git ls-remote --symref origin HEAD 2>/dev/null | awk '/^ref:/{sub("refs/heads/","",$2); print $2}')"
  DEF="${DEF:-master}"
  if [ "$DEF" = "$BRANCH" ]; then echo "  ($BRANCH is already GitHub's main branch)"
  else
    echo "▶ Copying this version to GitHub's main branch ($DEF)…"
    if git push origin "HEAD:$DEF"; then echo "  $DEF is up to date"
    else echo "⚠ $DEF has changes that aren't in $BRANCH, so it wasn't overwritten. On GitHub, open a pull request from $BRANCH into $DEF and merge it."; fi
  fi
fi

echo "✔ Done: https://github.com/$(git remote get-url origin | sed -E 's#(https://github.com/|git@github.com:)##; s#\.git$##')/tree/$BRANCH"
