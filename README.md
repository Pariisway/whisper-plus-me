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
| `public/rooms/` | Search-engine pages for each topic room (`/rooms/vent-room/` …), styled by `public/pages.css` |
| `public/install.js` | "Add to Home Screen" prompt |
| `public/firebase-messaging-sw.js` | Push alerts when the site is closed (calls ring here) |
| `public/admin.html` | Admin dashboard (`/admin.html`) |
| `public/nights/` | Older full M&G admin (`/nights/admin`) |
| `functions-nights/` | Server code you deploy every time: M&G, Connect Me, payouts, call ringing, emails, chargebacks, share pictures (`share.js`). Tests in `test/`. |
| `functions/` | Older main server code (coins, starting calls, rooms). Rarely deployed. |
| `database.rules.json`, `firestore.rules`, `storage.rules` | Security rules |
| `firebase.json` | Hosting, rewrites (`/u/`, `/m/`, `/c/`, `/connect`, `/s/`, `/sitemap.xml`) and function codebases |
| `docs/CHANGES.md` | What changed in each update, newest first |
| `docs/DATES.md` | Notes on the older Dates / M&G design |

## Deploying

New update zip from Claude in your Home or Downloads folder:

```bash
~/whisperplusme/update.sh "what changed"
```

It applies the zip (and removes files that were deleted), installs, runs the tests, deploys, and pushes to GitHub.
Already have the changes in the folder? Just run `./deploy.sh "what changed"`.
Extra switches (work with either one):

| Add | What it does |
|---|---|
| `--agora` | also updates the `generateAgoraToken` function in `functions/` |
| `--main` | also copies this version to GitHub's main branch (`master`), so the repo's front page shows it |
| `--github-only` | skips testing and deploying; only saves to GitHub (use it if the push failed) |

If GitHub asks for a password, it wants a token: run `gh auth login` once (or make a token at github.com → Settings → Developer settings → Personal access tokens and paste it as the password).

## The help page and room pages

- `public/help/` is the "How to use Whisper+Me" guide (whisperplusme.com/help/). Edit `tools/help_page.py`, then run `python3 tools/help_page.py`. Its pictures are in `public/help/img/`.
- `public/rooms/` are the voice chat room pages. Edit `tools/seo_pages.py` (and `tools/pages.css`), then run `python3 tools/seo_pages.py`.
