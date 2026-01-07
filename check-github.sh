#!/bin/bash
echo "🔍 Checking GitHub Push Status..."
echo ""

# Check if in git repo
if [ ! -d .git ]; then
  echo "❌ Not in a git repository"
  exit 1
fi

echo "✅ In a git repository"

# Check remote
REMOTE=$(git remote -v)
if [ -z "$REMOTE" ]; then
  echo "❌ No remote repository configured"
  echo ""
  echo "To add GitHub as remote:"
  echo "git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
else
  echo "✅ Remote configured:"
  echo "$REMOTE"
fi

# Check current branch
BRANCH=$(git branch --show-current)
echo ""
echo "📋 Current branch: $BRANCH"

# Check for changes
echo ""
echo "📊 Changes to be committed:"
git status --porcelain

# Check if ahead of remote
echo ""
echo "🔄 Comparison with remote:"
git fetch origin 2>/dev/null
AHEAD=$(git rev-list --count HEAD..origin/$BRANCH 2>/dev/null || echo "0")
BEHIND=$(git rev-list --count origin/$BRANCH..HEAD 2>/dev/null || echo "0")

if [ "$AHEAD" = "0" ] && [ "$BEHIND" = "0" ]; then
  echo "✅ Up to date with remote"
elif [ "$BEHIND" -gt "0" ]; then
  echo "📤 You have $BEHIND commit(s) to push"
  echo ""
  echo "Commits to push:"
  git log --oneline origin/$BRANCH..HEAD
elif [ "$AHEAD" -gt "0" ]; then
  echo "📥 Remote has $AHEAD commit(s) you don't have (pull first)"
fi

echo ""
echo "🔑 To push to GitHub:"
echo "git add ."
echo "git commit -m 'Your commit message'"
echo "git push origin $BRANCH"
