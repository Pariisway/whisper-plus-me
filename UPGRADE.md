# Whisper+Me social upgrade

Branch `social-upgrade`. This rebuild turns the front door, the profile, and the admin into a social app, and closes several security holes found along the way.

## What changed

| Area | Before | Now |
|---|---|---|
| **Landing / sign-in** | "Your Voice. Your Sanctuary." safe-space page, Organization button, date-ticket banner | Full-screen live background: a **video playlist**, a **picture**, or a **solid color**. Headline "Talk. Go live. Meet up.", a live "N people online" counter, Google first, email sign-in tucked under one button, "Peek inside first" for guests, and an optional **🔇 Tap for sound** button. The Organization button and the Dates banner are gone from the home page. |
| **Profile screen** (was "Dash") | One long form | 👤 **Profile** tab with 4 simple tabs: **Profile** (photo, name, bio, links), **Wallet** (coins, earnings, payouts), **Calls** (on/off switch, price buttons, call alerts), **More** (help, support, log out). A progress bar shows the next step to finish your profile. The phone frame shows "how others see you". Photos upload the moment you pick them and are shrunk first, so they load fast for everyone. |
| **Member card** | Small popup | Cover photo, bio, call count, safe social links, **📞 Call**, **⭐ Invite to an M&G**, **Share**. |
| **Admin** (`/admin.html`) | One long page of tables, browser pop-ups | MergeChat-style layout: top emoji tabs (🏁 Start here · 📡 Live now · 👥 People · 💰 Money · 🎬 Landing page · 📢 Announce · 💬 Rooms · 🛡️ Safety · ⭐ M&G · 🧾 Activity), "What do you want to do?" tiles, a "Needs your attention" list, "At a glance" numbers, and a "How the site fits together" map. Simple/Full layout switch. Every confirmation is an in-page dialog. The activity log is saved, so it survives a refresh. |
| **Landing page manager** (new, Admin → 🎬) | none | Upload videos or pictures (or paste links), reorder, remove, shuffle, seconds per picture, darkness slider, sound-button switch, headline and subline, phone/computer preview, then **🚀 Publish**. |

## ⭐ M&G (meet & greets), reviewed by you

"Dates" is now **M&G** everywhere: the bottom menu, the M&G screen, the admin tab, buttons, messages, share pages, and a new **M&G section in the Terms** (`/terms.html`, section 6).

**How a member hosts one**

1. M&G screen → **⭐ Host one**. They name it, describe it, pick a category and what's included.
2. **Where:** they type a place name and pick it from the search (free OpenStreetMap data, no key or bill). Picking fills in the address, city and, when OpenStreetMap has it, the phone. If it isn't listed they tap **Other: type it in**. Name, address, city and phone are all required.
3. When (at least 24 hours out), price per spot ($5+), spots (1–500), optional picture, and **how we reach you**: the host's email and phone (only you see these).
4. They pay a **host deposit equal to one spot's price**. It's returned after the M&G happens, or if you reject it, or if they cancel early. It's kept if they cancel within 48 hours after spots are sold, or don't show (it helps cover Stripe refund fees), and they get a strike.
5. It goes to **you for review**. Nothing is public until you approve it.

**Your review** (Admin → ⭐ M&G → Hosted M&Gs; the tab and the Start page show how many are waiting):

- **Details** shows the place name, full address, place phone (tap to call and verify the booking), the host's email and phone, the price, the spots and the deposit.
- **✅ Approve** puts it on sale. **✏️ Ask for changes** sends the host your note; they fix it under ⭐ Your M&Gs → **Edit**, and it comes back to you. **Reject** returns their deposit and refunds anyone who bought.
- **On sale:** Pause / Resume, Ask for changes, copy the share link, Cancel & refund.
- If a host edits the time, place or price of a live M&G, it goes back to you for review. Once spots are sold, the time, price and place are locked.

**For buyers:** before paying they see the place name and city only. After paying they get the **full address, the place's phone, a Maps link and their code (`MG-…`)** under ⭐ Your M&Gs.

**On the day:** the host opens ⭐ Your M&Gs → **Check in a guest** and types each guest's code. About 3 hours after the start:
- if anyone was checked in, the host gets the price minus your fee (10%, set in Rules) for every spot, added to their Whisper+Me earnings, plus their deposit back;
- if nobody was checked in, it shows up in your review list: **It happened: pay host**, or **Host no-show: refund buyers** (keeps their deposit and adds a strike).

Example: $100 a spot, 8 sold → buyers pay $800, you keep $80, the host gets $720 and their $100 deposit back.

**About the venue search:** it uses Photon (photon.komoot.io), a free public search over OpenStreetMap, and the form shows the required "© OpenStreetMap contributors" credit. It's meant for fair use; if M&G gets very busy, it can be pointed at your own Photon server or a paid places search later. Venue phone numbers come from OpenStreetMap when listed, so hosts sometimes type them in.

Share links: `whisperplusme.com/m/<id>` show the title, host, place name, city, time, price and spots left, never the address.

**What "venue night" was:** the old version made hosts attach their M&G to a venue ticket you'd posted. That's gone. Hosts now pick any public place themselves, and you approve it. The venue tickets you post in the admin still work as their own thing.

## M&G: editing, deposits at checkout, share links

- **Edit after posting:** Admin → ⭐ M&G → ✏️ Edit on any ticket or venue. Once someone has booked a ticket, its price, group size and date are locked (stop selling it and post a new one instead).
- **Pause / Resume** tickets, **Sell again** after stopping, **Delete** venues (gone from the dashboard and the site; the record stays in Firebase).
- **Deposit at checkout:** nobody has to add the $5 deposit first. It's shown in the price breakdown and added to their first checkout as its own line, one time.
- **Share links:** `whisperplusme.com/d/<ticket>` shows the ticket's picture, name, venue, time and price when shared on social media, then opens the ticket in the app. 🔗 Link in the admin copies it; members get a Share button on every ticket.
- Swiping the category buttons no longer flips to the next screen.

## Main site background

Admin → 🎬 Landing page → **Main site background**: what members see behind the app after they sign in. Pick Original, a picture or GIF, a video, or a color, set how dark it is, then **🚀 Publish**.

## M&G updates

- **Post tickets from the main admin:** Admin → ⭐ M&G. Pick a venue (or add one; it's approved right away), name it, pick a category, 2 or 4 people, price, date, how many, what's included, an optional picture, then **Post it**. It shows on everyone's M&G screen immediately. Venues waiting for approval can be approved there too.
- **Stood-up reward is 1 coin** (was 5). If you ever saved the M&G settings, the old 5 is still stored: Admin → ⭐ M&G → Stood-up reward → **Save**.
- **M&G moved** between Chat and Map in the bottom menu.
- **M&G categories** have a scroll bar under them (tap it or swipe), and a mouse wheel scrolls them sideways on computers.
- **Landing page GIFs:** upload GIFs alongside videos and pictures, or as the single picture.

## Organization side removed

- Gone: `/spirits`, `/spirits-admin`, `/briefing` and their files (`spirits.html`, `spirits.js`, `spirits.css`, `spirits-admin.html`, `briefing.html`). Old links to them now land on the home page.
- Its data (`spirits`, `spiritFeed`, `spiritCalls`, `orgCodes`, `organizations`, `orgUsers` and the rest, plus `config`) is locked so only you can read it, and **Admin → 🛡️ Safety** has a button to download a backup and then delete all of it, including the uploaded Organization photos.
- `config/geminiKey` (the AI key the Organization side used) was readable by every signed-in member, guests included. Treat that key as exposed: delete it in Google AI Studio.

## Security fixes (important)

- **Stored XSS:** a member could put code in their name or room name and it ran for everyone who saw it, including you in the admin. Names, bios, room names and links are now escaped everywhere, and `javascript:` links are dropped.
- **Chat:** anyone could delete or rewrite any room's whole history, or post as someone else. Now members can only post as themselves and delete their own messages; moderators and you can delete any message. Old messages are trimmed by the server (`chatPrune`) instead of by members' browsers.
- **Room IDs:** a member could create a room with a booby-trapped ID. Room IDs must now look like the ones the app makes.
- **Emails:** every member's email was readable by every other member. Emails now live in a private `userPrivate` area (only that member and you). Members' old emails move there automatically the next time they log in; Admin → People → "Keep emails private" moves everyone else at once.
- Guests can no longer upload profile photos.
- (From the first pass) member rooms can't be taken over, room entry can't be faked, and the admin's End call / Turn off mic buttons actually work.

## Faster

- The voice SDK (about 1 MB) and Firestore (for M&G) load only when needed.
- The app keeps the 1,500 most recently active members live instead of downloading every member ever, and fetches anyone else on demand.
- Profile photos are shrunk to 720 px before upload.
- Visitors with Data Saver or reduced motion get a still picture instead of streaming video.
- HTML/JS/CSS are served `no-cache`, so a deploy shows up right away on whisperplusme.com instead of waiting on old cached copies; images and videos are cached for a week.

## New server functions (in the `nights` codebase)

| Function | Runs | Does |
|---|---|---|
| `landingStats` | every 5 min | Writes the "N people online · N live rooms" counter for the landing page |
| `chatPrune` | every 30 min | Keeps each room to its newest 100 messages (never removes the welcome message) |

## Deploy

The zip has one folder inside, `whisperplusme/`, which is your whole project root (the folder with `firebase.json`, `public/`, `functions/`). Extract it **fresh** rather than on top of your old copy: this upgrade deletes files (the Organization pages), and extracting on top would leave those old files in place and deploy them again.

On the computer you deploy from, with the zip in Downloads and your project at `~/whisperplusme`:

```bash
cd ~
mv whisperplusme whisperplusme-before-upgrade      # your old copy, kept as a backup
unzip ~/Downloads/whisperplusme-social.zip -d ~/   # creates a fresh ~/whisperplusme
cp -r ~/whisperplusme-before-upgrade/.git ~/whisperplusme/   # keep your GitHub link
cd ~/whisperplusme
cd functions-nights && npm install && npm test && cd ..
firebase deploy --only database,firestore,storage,hosting,functions:nights
```

If your project folder has a different name, use that name in the first three commands.

Back it up to GitHub on its own branch (don't push to `master`):

```bash
git checkout -b social-upgrade
git add -A
git commit -m "Social upgrade: live landing, profile, admin, security, org removed"
git push -u origin social-upgrade
```

Then:

1. Open `whisperplusme.com/admin.html` → **🎬 Landing page** → upload 2–3 short videos → **🚀 Publish**.
2. Admin → **👥 People** → switch to **Full** → **Move emails to private storage**.
3. Admin → **🛡️ Safety** → **Old Organization (Spirits) data** → **Download a backup**, then **Delete it all**.
4. Delete the Gemini AI key that the Organization side used, in Google AI Studio (aistudio.google.com → API keys). It was stored where any signed-in member could read it.
5. Open whisperplusme.com in a private window to see the new landing page.

### Video tips

Short loops look best: 10–30 seconds, MP4 (H.264), 720p, under 15 MB each. Every visitor downloads the videos, so file size is what you pay for. Your storage bucket (`whisperplusme-46d9c.firebasestorage.app`) includes 100 GB of downloads a month at no cost; past that it's billed at Cloud Storage rates. Example: 3 videos of 8 MB, 1,000 visitors a day who watch all three ≈ 720 GB a month, so keep files small or use 1–2 videos. Uploaded videos are cached on each visitor's device for 30 days, so returning visitors don't download them again, and only the video that's playing is downloaded.

## If something looks wrong after deploy

- **Old page still showing on whisperplusme.com:** hard refresh once (Ctrl+Shift+R, or close and reopen the tab on a phone). From now on the no-cache headers prevent this.
- **Landing page is plain purple:** nothing has been published yet in Admin → 🎬 Landing page. That's the default.
- **"N people online" missing:** `landingStats` runs every 5 minutes after the first deploy; it shows "Live now · open 24/7" until then.
