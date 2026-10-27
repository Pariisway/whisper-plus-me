# Whisper+me Nights

Date-night tickets from local restaurants, theaters and lounges, built into whisperplusme.com. Members use the **same account** for live chat and nights out.

| Page | Address |
|---|---|
| Members: browse, book, split or pay full, Social, chat, My Tickets | `whisperplusme.com/nights` |
| Venues: apply, create tickets, check guests in, get paid | `whisperplusme.com/nights/venue` |
| Admin: venues, ID checks, reports, refunds, payouts, settings | `whisperplusme.com/nights/admin` |

Sign in to the Nights admin with your normal Whisper+me admin account. There's also a **Nights admin →** button in the main admin header.

## What was added (nothing existing was removed)

| Path | What it is |
|---|---|
| `public/nights/` | The three Nights pages, their styles and scripts |
| `functions-nights/` | Nights server code, deployed as its own codebase called `nights` |
| `firestore.rules`, `firestore.indexes.json` | Nights data lives in Firestore (Whisper+me keeps using the Realtime Database) |
| `storage.rules` | Added `nights/…` folders above the existing "deny everything else" rule |
| `firebase.json` | Added Firestore, the `nights` functions codebase, and `/nights` page routes |
| `public/index.html` | Nights promo card above the footer, plus "Nights Out" and "List your venue" footer links |
| `public/admin.html` | "Nights admin →" button in the header |

Your existing functions in `functions/` were not changed.

## One-time setup

1. **Turn on Firestore.** Firebase console → project `whisperplusme-46d9c` → **Firestore Database** → Create database → **Production mode** → location **nam5 (us-central)**.
2. **Install the Nights function packages:**
   ```bash
   cd functions-nights && npm install && cd ..
   ```
3. **Deploy only the Nights pieces.** This doesn't redeploy your existing Whisper+me functions:
   ```bash
   firebase deploy --only firestore,storage,hosting,functions:nights
   ```
   The first deploy asks for `NIGHTS_STRIPE_WEBHOOK_SECRET`. Type `temp` for now; step 4 replaces it.
   Nights reuses your existing `STRIPE_SECRET_KEY`, so there's no new Stripe key to add.
4. **Add the Nights Stripe webhook.** Stripe Dashboard → Developers → Webhooks → **Add endpoint**:
   - URL: the `nightsStripeWebhook` address the deploy printed (usually `https://us-central1-whisperplusme-46d9c.cloudfunctions.net/nightsStripeWebhook`)
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `account.updated`
   - Check **Listen to events on Connected accounts**
   - Copy the signing secret (`whsec_…`), then:
     ```bash
     firebase functions:secrets:set NIGHTS_STRIPE_WEBHOOK_SECRET
     firebase deploy --only functions:nights
     ```
5. Open `/nights/admin` → **Settings** → **Save settings** once to create the defaults (10% fee, 24-hour split window, 21+, ID check on).

Your existing coin webhook ignores Nights payments: it only credits coins when a checkout carries a `qty`, which Nights checkouts never do.

## Try it

Your Stripe key is live, so a test booking charges a real card. Use a cheap test ticket ($5), then refund it from **Nights admin → Bookings → Refund**.

1. In a private window, apply as a venue at `/nights/venue`, then approve it in `/nights/admin` → Venues.
2. Create a $5 ticket for 2 people.
3. With two member accounts, upload any ID photo, approve both in Admin → Members → Review ID.
4. Member A books, invites Member B, picks **Split**. Member B accepts in Chats and pays.
5. The ticket shows **Confirmed** with a `WN-` code. Enter it at `/nights/venue` → Door check-in.

## Renaming

Change `BRAND` in `public/nights/js/config.js`, `BRAND_NAME` near the top of `functions-nights/index.js`, and the `<title>` in the three files in `public/nights/`.
