#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Apply the newest whisperplusme-social.zip (from Claude), then run deploy.sh.
#   ~/whisperplusme/update.sh "what changed" [--agora]
# Looks for the zip in your Linux home folder and in Downloads.
# Files removed in the new version are removed here too, so old
# leftovers don't pile up. The zip is deleted when it's applied.
# ─────────────────────────────────────────────────────────────
set -e
REPO="$(cd "$(dirname "$0")" && pwd)"
ZIP=$(ls -t ~/whisperplusme-social*.zip /mnt/chromeos/MyFiles/Downloads/whisperplusme-social*.zip 2>/dev/null | head -1 || true)
if [ -z "$ZIP" ]; then echo "No whisperplusme-social.zip found in your Home or Downloads folder."; exit 1; fi
echo "▶ Applying $ZIP"
TMP=$(mktemp -d)
unzip -q -o "$ZIP" -d "$TMP"
NEW="$TMP/whisperplusme"
cd "$REPO"
(cd "$NEW" && find . -type f | sed 's|^\./||' | sort) > "$TMP/new.txt"
git ls-files | sort > "$TMP/old.txt"
comm -23 "$TMP/old.txt" "$TMP/new.txt" | while IFS= read -r f; do
  echo "  removing old file: $f"
  git rm -q --cached -- "$f" 2>/dev/null || true
  rm -f -- "$f"
  d=$(dirname -- "$f"); [ "$d" != "." ] && rmdir -p --ignore-fail-on-non-empty -- "$d" 2>/dev/null || true
done
cp -a "$NEW/." "$REPO/"
chmod +x "$REPO/deploy.sh" "$REPO/update.sh"
rm -rf "$TMP" "$ZIP"
exec "$REPO/deploy.sh" "$@"
