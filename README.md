# Whisper+Me

whisperplusme.com: voice rooms, 1-on-1 paid calls, M&G (Meet & Greet) and Connect Me night-out packages.
Firebase (Hosting, Realtime Database, Firestore, Cloud Functions, Storage, Messaging) + Stripe + Agora.

## Folders

| Path | What it is |
| --- | --- |
| `public/` | The website. Everything the site serves lives here. |
| `public/app.js` | Main app: rooms, calls, map, share sheet, call alerts in the page |
| `public/dates.js` | M&G and Connect Me screens |
| `public/profile.js` | Profile screen, call log, member card, block/report |
| `public/landing.js` | Signed-out landing page |
| `public/install.js` | "Add to Home Screen" prompt |
| `public/firebase-messaging-sw.js` | Push alerts when the site is closed (calls ring here) |
| `public/admin.html` | Admin dashboard (`/admin.html`) |
| `public/nights/` | Older full M&G admin (`/nights/admin`) |
| `functions-nights/` | Server code you deploy every time: M&G, Connect Me, payouts, call ringing, emails, chargebacks, share pictures (`share.js`). Tests in `test/`. |
| `functions/` | Older main server code (coins, starting calls, rooms). Rarely deployed. |
| `database.rules.json`, `firestore.rules`, `storage.rules` | Security rules |
| `firebase.json` | Hosting, rewrites (`/u/`, `/m/`, `/c/`, `/connect`, `/s/`) and function codebases |
| `docs/CHANGES.md` | What changed in each update, newest first |
| `docs/DATES.md` | Notes on the older Dates / M&G design |

## Deploying

New update zip from Claude in your Home or Downloads folder:

```bash
~/whisperplusme/update.sh "what changed"
```

It applies the zip (and removes files that were deleted), installs, runs the tests, deploys, and pushes to GitHub.
Already have the changes in the folder? Just run `./deploy.sh "what changed"`.
Add `--agora` to either one to also update the `generateAgoraToken` function in `functions/`.
