# Whisper+me Dates

A 🎟️ **Dates** screen inside Whisper+me. Members pick a date ticket (dinner, activities, concerts, movies, other), bring someone or let members ask to join, and split it or pay in full. Venues sell the tickets; you run it all from the admin.

| Who | Where |
|---|---|
| Members | The new **Dates** tab in the app (5th screen), or `whisperplusme.com/?dates=1` |
| Venues | `whisperplusme.com/nights/venue` |
| You (admin) | Main admin → **🎟️ Dates**: post tickets, add and approve venues, set the stood-up reward. The full Dates admin (`/nights/admin`) has members, reports and venue payouts. |

## The rules (all changeable in Admin → Settings)

| Rule | Default |
|---|---|
| Date deposit kept on each member's account, covers every date | $5 |
| Cancel (after someone else committed) or no-show → deposit kept, new one needed to keep dating | always |
| Split tickets: cards **held, not charged**, until every seat is paid; if it doesn't fill, nobody is charged | 24 hours to fill |
| Pay in full: host charged now, guests join free (still need a deposit) | — |
| Door codes released only when fully paid, one per person | — |
| Ticket money isn't refunded to whoever cancels; their paid seat can go to a replacement for free | — |
| Reschedule once, everyone agrees | up to 48 h before |
| Cancelling inside 48 h or not showing up = a missed date (strike) | — |
| Missed dates before a break / length of the break | 2 / 3 days |
| Stood up and checked in at the venue → Whisper coins | 1 coin |
| Venues are paid **after** the date happens | — |

Before anyone cancels, the app shows exactly what they'll lose (deposit, ticket share, strike, the other person's coins), worked out by the server, and they have to tick "I understand."

No-show penalties only apply when **someone on the date checked in** at the venue. If nobody was scanned (the venue forgot), nobody is penalized.

**Reward cost:** each reward coin can become a $2 creator payout when spent on calls, so the 1-coin reward costs at most $2 against the $5 deposit kept. Admin → Deposits & coins shows this running total. Coins only go to people who actually checked in at the venue, which makes the reward hard to game.

## What changed in the code

| Path | What |
|---|---|
| `public/dates.js` | The Dates screen (phone frame + My Dates panel) |
| `public/app.js` | 5 small hooks: adds "dates" as the 5th screen, menu icon, and panel |
| `public/index.html` | Loads `dates.js`; Firestore loads on demand the first time someone opens Dates |
| `public/admin.html` | "Dates admin →" button |
| `public/nights/` | Venue and admin pages (`/nights` itself now redirects into the app) |
| `functions-nights/` | All Dates server logic, deployed as its own `nights` codebase. Your existing `functions/` is untouched. |
| `functions-nights/test/` | 19 automated tests of the money rules (`npm test`) |
| `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `firebase.json` | Dates data rules, `nights/…` upload folders, routes |

## Deploy

1. **Turn on Firestore** (once): Firebase console → `whisperplusme-46d9c` → Firestore Database → Create database → Production mode → **nam5 (us-central)**.
2. Install and test:
   ```bash
   cd functions-nights && npm install && npm test && cd ..
   ```
3. Deploy just the Dates pieces (your existing functions aren't redeployed):
   ```bash
   firebase deploy --only firestore,storage,hosting,functions:nights
   ```
   If it asks for `NIGHTS_STRIPE_WEBHOOK_SECRET`, type `temp`; step 4 replaces it. Dates reuses your existing `STRIPE_SECRET_KEY`.
4. **Stripe webhook:** Stripe → Developers → Webhooks → Add endpoint
   - URL: the `nightsStripeWebhook` address from the deploy output (usually `https://us-central1-whisperplusme-46d9c.cloudfunctions.net/nightsStripeWebhook`)
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `account.updated`
   - Check **Listen to events on Connected accounts**
   - Then: `firebase functions:secrets:set NIGHTS_STRIPE_WEBHOOK_SECRET` (paste `whsec_…`) and `firebase deploy --only functions:nights`
5. Open `/nights/admin` → Settings → **Save settings** once.

Your coin webhook ignores Dates payments (it only credits coins when a checkout has a `qty`).

## Try it (your Stripe key is live, so use a $5 test ticket)

1. Apply as a venue at `/nights/venue` in a private window; approve it in `/nights/admin` → Venues; create a $5 ticket for 2.
2. With two accounts: open Dates → set up → add the $5 deposit.
3. Account A books the ticket, invites B, picks **Split**. B accepts in My Dates and pays. Both cards are charged only now, and each gets a `WN-` code.
4. Venue → Door check-in → enter A's code only. About 3 hours after the start time, B is marked a no-show: deposit kept, 1 strike; A gets 1 coin.
5. Refund the test money from Stripe, or use Admin → Dates → Cancel & refund before the date.

## Before launch

- Add the Dates rules to your Terms of Service in plain words (deposit, no refunds on cancel, strikes, break). Run the wording past a lawyer.
- Ask venues serving alcohol to check ID at the door; Dates collects birth year only unless you turn on photo ID.
