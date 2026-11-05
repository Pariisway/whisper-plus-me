#!/usr/bin/env python3
"""Builds public/help/index.html, the "How to use Whisper+Me" guide.
Screenshots live in public/help/img/ (made from the app with example data).
Run: python3 tools/help_page.py"""
import html, json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
IMG = os.path.join(ROOT, "help", "img")
URL = "https://whisperplusme.com/help/"
TITLE = "How to Use Whisper+Me: Voice Rooms, Calls, M&G, Connect Me & Plan a Date"
DESC = "A step-by-step guide with pictures: join free, talk in voice rooms, call people 1-on-1, earn as a creator, buy M&G spots and Connect Me nights out, and plan your own date anywhere."


def shot(name, cap, alt=None):
    w, h = Image.open(os.path.join(IMG, name + ".webp")).size
    return (f'<figure class="hp-shot"><img src="/help/img/{name}.webp" width="{w}" height="{h}" loading="lazy" decoding="async" '
            f'alt="{html.escape(alt or cap)}"><figcaption>{cap}</figcaption></figure>')


def shots(*items):
    return '<div class="hp-shots">' + "".join(shot(*i) for i in items) + "</div>"


def steps(*items):
    return '<ol class="hp-steps">' + "".join(f"<li><b>{t}</b>{d}</li>" for t, d in items) + "</ol>"


TOC = [("start", "👋", "Getting started"), ("rooms", "🎙️", "Voice chat rooms"), ("calls", "📞", "1-on-1 calls"),
       ("profile", "👤", "Your profile, coins & earnings"), ("mg", "⭐", "M&G meet & greets"), ("connect", "💞", "Connect Me nights out"),
       ("plan-a-date", "📍", "Plan a Date"), ("credit", "💳", "Credit & refunds"), ("safety", "🛟", "Staying safe"), ("faq", "❓", "Questions")]

FAQ = [
    ("Is Whisper+Me free?", "Yes. Joining, the voice chat rooms, text chat, the open mic and the map are free. You only pay for 1-on-1 calls and paid member rooms (with coins), M&G spots, Connect Me packages, and 1 coin to post a Plan a Date."),
    ("Do I need to download an app?", "No. It runs in any browser on your phone or computer. You can add it to your home screen so it opens like an app."),
    ("How old do I have to be?", "18 to use Whisper+Me. 21 to buy an M&G spot, a Connect Me package, or to post or ask for a Plan a Date. We ask your birth year once."),
    ("How much is a coin?", "$3. Members set their call price from 1 to 10 coins. Creators earn $2 for every coin people spend calling them or joining their room."),
    ("How do I get paid as a creator?", "Open 👤 Profile → Wallet and tap Set up payouts. Stripe sends your earnings to your bank once you reach $50."),
    ("Is Plan a Date a dating or escort service?", "It's a way to plan a real outing at a public place and pick who goes. Members never pay each other: the two of you pay the place directly. Anyone who asks for or offers money is removed."),
    ("What if nobody picks my date?", "If nobody is confirmed by the time it starts, the coin you paid to post it comes back automatically."),
    ("Can I use my Whisper+Me credit on my card instead?", "Yes. Under 🎟️ My tickets, tap Send it to my card instead and it's refunded to the card you paid with (usually 5 to 10 days)."),
    ("Who sees my messages in Plan a Date?", "Only you and the person you're going with. Messages are deleted when a date is called off, or 30 days after it happens."),
    ("How do I report someone?", "Open their profile and tap 🚩 Report, or use Report on a date or ticket. Only Whisper+Me sees reports. If you're in danger, call 911."),
]

body = f"""
<nav class="pg-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <span>How to use Whisper+Me</span></nav>
<section class="pg-hero"><div class="pg-emoji" aria-hidden="true">📖</div><h1>How to use Whisper+Me</h1>
<p class="pg-lead">Everything on the site, step by step, with pictures. Talk in live voice rooms, call people 1-on-1, earn from your calls, and meet up in real life with M&amp;G, Connect Me and Plan a Date.</p>
<div class="pg-ctas"><a class="pg-btn" href="/">🎙️ Open Whisper+Me</a><a class="pg-btn ghost" href="#plan-a-date">📍 Plan a Date guide</a></div>
<p class="pg-note">The pictures use example people and places.</p>
<video class="hp-video" src="/media/how-it-works.mp4" poster="/media/how-it-works.jpg" controls playsinline preload="none" aria-label="3-minute video tour of Whisper+Me"></video></section>

<nav class="hp-toc" aria-label="On this page">{"".join(f'<a href="#{i}"><span aria-hidden="true">{e}</span>{t}</a>' for i, e, t in TOC)}</nav>

<section class="pg-card" id="start"><h2>👋 Getting started</h2>
<p>Go to <a href="/">whisperplusme.com</a> on your phone or computer. There's nothing to download.</p>
{steps(("Sign up free", "Use your email and a password, or tap <em>Continue with Google</em>. You can also look around as a guest first."),
       ("Pick a display name and photo", "Any name works. Add a profile photo in 👤 Profile: it's needed to post or ask for a Plan a Date, and people are more likely to call you."),
       ("Add it to your home screen", "On Android or a computer, tap <em>Install</em> when it's offered. On iPhone, tap the Share button in Safari, then <em>Add to Home Screen</em>."),
       ("Turn on notifications", "Allow notifications so you hear when someone calls you, picks you for a date, or a meet-up is tomorrow."))}
{shots(("01-landing", "The front page: log in, sign up or continue with Google."))}
<p><b>Getting around:</b> the bar at the bottom has five screens: <b>📱 Phone</b> (people you can call), <b>💬 Chat</b> (voice rooms), <b>⭐ M&amp;G</b> (meet-ups, Connect Me and Plan a Date), <b>🗺️ Map</b> (what's on near you) and <b>👤 Profile</b>. On a phone you can also swipe left and right between them.</p>
</section>

<section class="pg-card" id="rooms"><h2>🎙️ Voice chat rooms</h2>
<p>Rooms are open 24/7 and free. Each has live text chat and voice. You can talk or just listen.</p>
{steps(("Open 💬 Chat", "Scroll the room cards and tap one, like <em>General</em>, <em>Night Owls</em> or <em>Vent &amp; Release</em>."),
       ("Say hi", "Type in the message bar at the bottom, or add a picture with 📷."),
       ("Go live on the mic", "Tap 📢 (or <em>Live</em> at the top of the room) to speak to everyone for up to 3 minutes. A timer shows how long you have left."),
       ("Share a room", "Every room card has a 🔗 Share button that sends a link straight into that room."))}
{shots(("03-room-list", "Room cards: tap one to join, or share it."))}
<p><b>Member rooms:</b> under the main rooms, members can open their own room for up to 10 people. The owner sets an entry price of 1 to 10 coins and earns those coins. Sessions last 3 minutes. You can have one room open at a time.</p>
<p><b>The map (🗺️):</b> shows what's happening around you. ⭐ gold pins are M&amp;Gs, 💞 pink pins are Connect Me nights, 📍 green pins are open Plan a Dates, and photos are members who turned their location on. Tap a pin to see it, then tap the button to get a spot or say you're interested. The buttons under the map turn each kind on or off, and <em>Coming up</em> lists the next few things on the map. Tap <em>Location ON</em> to show your own pin to members nearby. It turns itself off after 25 minutes.</p>
<p>See every room and what it's for on the <a href="/rooms/">voice chat rooms page</a>.</p>
</section>

<section class="pg-card" id="calls"><h2>📞 1-on-1 calls</h2>
<p>Call any member who has calls turned on. Each person sets their own price in coins, shown on their card.</p>
{steps(("Open 📱 Phone", "Swipe through the people cards. A green dot means they're online now."),
       ("Tap a card to see their profile", "You'll see their bio, how many calls they've had, their price and links."),
       ("Tap 📞 Call", "You need enough coins for their price (buy them in 👤 Profile → Wallet). Calls last up to 3 minutes and end on their own."),
       ("Block or report", "Every profile has 🚫 Block and 🚩 Report at the bottom. Blocked people can't call you or ask to go on your dates."))}
{shots(("04-people", "The Phone screen: swipe through people and tap Call."), ("05-member", "A member's profile with their price, Call, Invite to an M&amp;G and Share."))}
</section>

<section class="pg-card" id="profile"><h2>👤 Your profile, coins &amp; earnings</h2>
<p>The 👤 Profile screen has four tabs: <b>Profile</b>, <b>Wallet</b>, <b>Calls</b> and <b>More</b>. Tap <em>Preview</em> to see your card the way others see it.</p>
{shots(("06-profile", "Your card as others see it, with Preview."), ("07-wallet", "Wallet: buy coins ($3 each) and see what you've earned."), ("08-calls", "Calls: your call log, “Let people call me” and your price."))}
<ul class="hp-list">
<li><b>Buy coins:</b> in <em>Wallet</em>, pick 5, 10, 25 or 50 coins, or type an amount, and tap <em>Buy</em>. Coins cost $3 each.</li>
<li><b>Set your price:</b> in <em>Calls</em>, pick 1 to 10 coins per call. You earn $2 for every coin.</li>
<li><b>Take calls:</b> turn on <em>Let people call me</em>. Allow notifications so your phone rings even when the site is closed.</li>
<li><b>Get paid:</b> in <em>Wallet</em>, tap <em>Set up payouts</em>. Stripe sends your earnings to your bank once you reach $50. Card fees are paid by Whisper+Me.</li>
<li><b>Share your profile:</b> your profile has a link (whisperplusme.com/u/…) and a picture for Stories, so people can find and call you.</li>
</ul>
</section>

<section class="pg-card" id="mg"><h2>⭐ M&amp;G (meet &amp; greet)</h2>
<p class="pg-note" style="text-align:left">Want the short version to share? <a href="/meet/">whisperplusme.com/meet</a> explains M&amp;G, Connect Me and Plan a Date in one page.</p>
<p>M&amp;Gs are meet-ups at real public places: dinner, bowling, brunch and more. Each one is hosted by a member or by Whisper+Me, and you buy one spot per person. You must be 21+.</p>
<h3>Going to an M&amp;G</h3>
{steps(("Open ⭐ M&amp;G", "Browse by category (Dinner, Activities, Concerts…). Each card shows the host, the day, the place and the price."),
       ("Tap a card, then Get my spot", "You can buy for yourself and up to 5 friends in one order. You pay with a card through Stripe (or your credit)."),
       ("Find your code", "Tap <em>🎟️ My tickets</em>. After you pay you'll see the exact address, the place's phone number and your entry code."),
       ("Check in", "At the place, tap <em>I'm here</em> or show your code to the host."),
       ("Rate it", "Afterwards you can rate the host from 1 to 5 stars. Only Whisper+Me sees written comments."))}
{shots(("10-mg-list", "The ⭐ M&amp;G screen with its three tabs: M&amp;G, Connect Me and Plan."), ("11-mg-sheet", "An M&amp;G: who's hosting, the price, spots left and what's included."), ("12-tickets", "My tickets: your code, the address and your credit."))}
<h3>Hosting an M&amp;G</h3>
{steps(("Tap ⭐ Host one", "Name it, say what you'll do, pick a category and add a picture."),
       ("Pick the place", "Search for the restaurant, lounge or venue. It must be a real public business with an address and phone number."),
       ("Set the day, price and spots", "Whisper+Me reviews every M&amp;G, usually within a day, before it goes on sale."),
       ("Keep a host deposit", "You pay it once (the price of one spot, or $5). It stays on your account for future M&amp;Gs and is only kept if you cancel late or don't show up."),
       ("Get paid", "Whisper+Me keeps 10%. The rest goes to your earnings about 3 days after the M&amp;G, once you've checked in your guests."))}
{shots(("13-host", "The Host an M&amp;G form."))}
</section>

<section class="pg-card" id="connect"><h2>💞 Connect Me nights out</h2>
<p>Connect Me packages are ready-made nights out at one price for 2 or 4 people, like dinner for two or bowling for four. You buy it, then invite who you're bringing. You must be 21+.</p>
{steps(("Open ⭐ M&amp;G → 💞 Connect Me", "Each card shows the place, the day, what's included and the price for the group."),
       ("Tap Get it", "Pay once for the whole group. Your Whisper+Me credit is used first."),
       ("Invite who you're bringing", "Pick a member, or send them a link. They join free and accept."),
       ("Everyone checks in", "Each person gets their own code and taps <em>I'm here</em> at the place. If someone on your package doesn't show and you did, we may add a reward to your account."))}
{shots(("20-cm-list", "Connect Me packages, with “Ask someone to take me out”."), ("21-cm-sheet", "A package: price for the group, price each, and what's included."), ("22-takemeout", "Share your “take me out” link anywhere."))}
<p><b>🙋 Ask someone to take me out:</b> tap it to get a link to share on your Stories, posts or in a text. Whoever opens it can pick a night out and pay, and you get the invite. <b>💡 Share date ideas</b> sends a picture of what's on now.</p>
<p>See every package on sale on the <a href="/connect">date ideas page</a>.</p>
</section>

<section class="pg-card hp-feature" id="plan-a-date"><h2>📍 Plan a Date</h2>
<p class="hp-lead">Plan your own date anywhere, at a real public place, and pick who you go with. It works in any city, not just where Whisper+Me runs events.</p>
<div class="hp-facts"><div><b>1 coin</b>to post a date</div><div><b>Free</b>to ask to go</div><div><b>21+</b>public places only</div></div>

<h3>Step 1: Post your date</h3>
{steps(("Open ⭐ M&amp;G → 📍 Plan", "Tap the green <em>📍 Plan a date</em> button. You need a profile photo first, so people know who they're meeting."),
       ("Say what the plan is", "For example <em>Tacos and mini golf</em>. Add a line or two more if you like."),
       ("Pick the place", "Search for it (restaurant, café, bowling, pottery class…), or tap <em>Type it in</em>. Homes, hotels and Airbnbs aren't allowed."),
       ("Pick the day and time", "Anywhere from 24 hours to 30 days ahead. The time is shown in your own time zone."),
       ("Say who pays the bill", "<em>We split it</em>, <em>I'll treat</em>, or <em>Each pays our own</em>. Either way, you pay the place directly. Nobody pays the other person."),
       ("Tick the rules box and post it", "Posting costs 1 coin ($3), taken from your coins. No coins? Tap <em>Buy coins</em>. Your date goes up right away."))}
{shots(("pd4-create", "The Plan a date form: the plan, the place and the time."), ("pd4b-post", "Who pays the bill, then post it for 1 coin."))}

<h3>Step 2: People ask to go</h3>
<p>Your date shows on the 📍 Plan list. People nearby see it under <b>Near me</b> (about 25 miles), and anyone can find it under <b>Everywhere</b>. Tap <b>↗ Share</b> to post it on your Stories or send it to someone: the link opens straight to your date.</p>
{shots(("pd1-list", "Open dates near you, with who pays and how many people are interested."), ("pd3-detail", "What people see when they open your date: they tap “I'm interested” for free."))}
<p><b>If you're the one asking:</b> open a date, add a short hello if you like, and tap <b>🙋 I'm interested</b>. It's free. You'll get a notification if you're picked. You can have up to 5 requests waiting at once, and you can take one back any time. If two people pick you for around the same time, the first one you confirm is your date: the other goes back to them, and your other requests for that time are taken back for you (dates need to be at least 4 hours apart). If a date is more than about 80 miles from where you are, you tick a box saying you'll be in town that day, and the person who posted it sees roughly how far away you are.</p>

<h3>Step 3: Pick who goes</h3>
{steps(("Look under 📍 Your dates", "Below the list, your date shows <em>Who's interested</em>: each person's photo, about how far away they are, their star rating from past dates, how many dates they've been on, and any no-shows. Tap a photo to see their profile."),
       ("Tap Pick (or No)", "Pick one person. They have 12 hours to confirm (less if the date is soon)."),
       ("They confirm", "Once they tap <em>✅ Confirm</em>, it's a date. Everyone else who asked is told it's filled. If they pass or don't answer in time, you can pick someone else."))}
{shots(("pd2a-requests", "Who's interested: pick the person you want to go with."))}

<h3>Step 4: Talk, then meet up</h3>
<p>Once you're confirmed, both of you see the street address, the place's phone number and a Directions link, and you can message each other in the app.</p>
{shots(("pd5-chat", "Messages with your date. Money talk is blocked."), ("pd2b-confirmed", "On the day: the address, Message, I'm here and Share with a friend."))}
{steps(("💬 Message each other", "Sort out the details. Anything about money, “allowances” or meeting somewhere private is blocked."),
       ("🛟 Share with a friend", "Sends who you're meeting, where and when to a friend from your own phone."),
       ("📍 Tap I'm here when you arrive", "Check-in opens an hour before. It uses your phone's location to confirm you're at the place. You'll see when your date has checked in too."),
       ("Pay the place", "Pay the restaurant or venue directly, the way the date said."),
       ("⭐ Rate each other", "After the date you can both leave 1 to 5 stars. Stars show on your future dates."))}

<h3>Your coin, cancelling and no-shows</h3>
<table class="hp-table"><thead><tr><th>What happens</th><th>The coin you paid to post</th></tr></thead><tbody>
<tr><td>Nobody is picked or confirmed by the time it starts</td><td>✅ Back in your coins</td></tr>
<tr><td>You call it off more than 24 hours ahead</td><td>✅ Back in your coins</td></tr>
<tr><td>Your date doesn't show up and you checked in</td><td>✅ Back, plus an extra coin</td></tr>
<tr><td>You call it off less than 24 hours ahead</td><td>❌ Not returned (and a strike if it was confirmed)</td></tr>
<tr><td>Your date is removed for breaking the rules</td><td>❌ Not returned</td></tr>
</tbody></table>
<p><b>Strikes:</b> not showing up, or backing out of a confirmed date less than 24 hours before, is a strike. Too many strikes pause your access to M&amp;G, Connect Me and Plan a Date. If the person you were meeting didn't come but you checked in, you get a coin for your trouble. If neither of you checks in, nobody gets a strike (in case location didn't work).</p>

<h3>The rules</h3>
<ul class="hp-list">
<li>21 or older, with a real profile photo.</li>
<li>Real public places only: no homes, hotels, motels or Airbnbs.</li>
<li><b>Nobody pays anybody.</b> You each pay the place, as the plan says. Asking for or offering money, gifts or an “allowance” gets you removed.</li>
<li>Up to 3 of your dates can be up at a time.</li>
<li>Show up, or call it off at least a day ahead.</li>
</ul>
<p>Full details are in the <a href="/terms.html#plan">Terms (Plan a Date)</a>.</p>
</section>

<section class="pg-card" id="credit"><h2>💳 Credit &amp; refunds</h2>
<p>When something is canceled by a host, a venue or Whisper+Me, you get the money back as <b>Whisper+Me credit</b> right away. It's used first on your next M&amp;G or Connect Me, with no card needed. (A Plan a Date coin comes straight back to your coins.)</p>
<p>Rather have it on your card? Open <em>🎟️ My tickets</em> and tap <em>Send it to my card instead</em>. It's refunded to the card you paid with, usually in 5 to 10 days. M&amp;G spots and Connect Me packages aren't refundable otherwise.</p>
</section>

<section class="pg-card" id="safety"><h2>🛟 Staying safe</h2>
<ul class="hp-list">
<li>Meet only at the public place you picked. Never go to someone's home or hotel.</li>
<li>Tell a friend where you'll be. Plan a Date has a <em>Share with a friend</em> button for this.</li>
<li><b>Never send money</b> to someone you're meeting or talking to. Anyone who asks is breaking the rules: report them.</li>
<li>Use 🚫 Block and 🚩 Report on any profile. Only Whisper+Me sees reports.</li>
<li>Whisper+Me doesn't run background checks. Trust your gut and leave if something feels wrong.</li>
<li>If you're in danger, call 911. If you're struggling, call or text 988 (Suicide &amp; Crisis Lifeline, US).</li>
</ul>
</section>

<section class="pg-card" id="faq"><h2>❓ Questions</h2>
{"".join(f'<details class="hp-q"><summary>{q}</summary><p>{a}</p></details>' for q, a in FAQ)}
<p style="margin-top:16px">Still stuck? Email <a href="mailto:whisper.me.support@gmail.com">whisper.me.support@gmail.com</a>.</p>
</section>

<section class="pg-hero"><div class="pg-ctas"><a class="pg-btn" href="/">🎙️ Open Whisper+Me</a><a class="pg-btn ghost" href="/?dates=1">⭐ See what's on</a></div><p class="pg-note">Free · No download · 18+</p></section>
"""

schema = {"@context": "https://schema.org", "@graph": [
    {"@type": "HowTo", "@id": URL + "#plan-a-date", "name": "How to plan a date on Whisper+Me", "description": "Post a date at a public place, let people ask to go, pick who goes, and meet up.",
     "image": "https://whisperplusme.com/help/img/pd1-list.webp", "estimatedCost": {"@type": "MonetaryAmount", "currency": "USD", "value": "3"},
     "step": [{"@type": "HowToStep", "name": n, "text": t, "url": URL + "#plan-a-date"} for n, t in [
         ("Post your date", "Open M&G, then Plan, and fill in the plan, a public place, the day and time, and who pays the bill. Posting costs 1 coin."),
         ("People ask to go", "Members near you or anywhere tap I'm interested for free."),
         ("Pick who goes", "Under Your dates, pick one person. They confirm within 12 hours."),
         ("Meet up", "Message each other, tap I'm here at the place, and pay the place directly."),
         ("Rate each other", "After the date, leave 1 to 5 stars.")]]},
    {"@type": "FAQPage", "@id": URL + "#faq", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]},
    {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Home", "item": "https://whisperplusme.com/"}, {"@type": "ListItem", "position": 2, "name": "How to use Whisper+Me", "item": URL}]}]}

CSS = """
.hp-toc{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin:0 0 18px}
.hp-toc a{display:flex;gap:8px;align-items:center;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 12px;color:#fff;text-decoration:none;font-weight:700;font-size:14px}
.hp-toc a:hover{border-color:#00e3ae}
.hp-shots{display:flex;gap:14px;overflow-x:auto;padding:6px 2px 10px;margin:14px 0;scroll-snap-type:x mandatory}
.hp-shot{margin:0;flex:0 0 min(228px,70%);scroll-snap-align:start}
.hp-shot:first-child{margin-left:auto}.hp-shot:last-child{margin-right:auto}
.hp-shot img{display:block;width:100%;height:auto;border-radius:22px;border:3px solid #24213a;box-shadow:0 10px 30px rgba(0,0,0,.45);background:#0b0a14}
.hp-shot figcaption{font-size:13px;color:#b9b2d4;line-height:1.4;margin-top:8px;text-align:center}
.hp-steps{counter-reset:s;list-style:none;padding:0;margin:12px 0;display:flex;flex-direction:column;gap:10px}
.hp-steps li{counter-increment:s;position:relative;padding:10px 12px 10px 48px;background:rgba(255,255,255,.04);border-radius:12px;line-height:1.5}
.hp-steps li::before{content:counter(s);position:absolute;left:12px;top:10px;width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#7b2ff7,#00e3ae);color:#fff;font-weight:900;font-size:14px;display:grid;place-items:center}
.hp-steps li b{display:block;color:#fff}
.hp-list{padding-left:20px;line-height:1.6}.hp-list li{margin:6px 0}
.hp-feature{border-color:rgba(0,227,174,.45)!important}
.hp-lead{font-size:17px}
.hp-facts{display:flex;gap:8px;margin:12px 0}
.hp-facts div{flex:1;background:rgba(0,227,174,.08);border:1px solid rgba(0,227,174,.3);border-radius:12px;padding:10px 6px;text-align:center;font-size:13px;color:#b9b2d4}
.hp-facts b{display:block;color:#fff;font-size:20px}
.hp-table{width:100%;border-collapse:collapse;font-size:14px;margin:10px 0}
.hp-table th,.hp-table td{text-align:left;padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.1);vertical-align:top}
.hp-table th{color:#9a8fb5;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.hp-q{background:rgba(255,255,255,.04);border-radius:12px;padding:10px 14px;margin:8px 0}
.hp-q summary{cursor:pointer;font-weight:800}
.hp-q p{margin:8px 0 2px;color:rgba(255,255,255,.86)}
.pg h3{font-size:18px;margin:22px 0 6px;color:#7ff0d0}
.pg-card{scroll-margin-top:12px}
.hp-video{display:block;width:min(340px,100%);aspect-ratio:9/16;margin:18px auto 0;border-radius:22px;border:3px solid #24213a;background:#000;box-shadow:0 10px 30px rgba(0,0,0,.45)}
"""

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{html.escape(TITLE)}</title>
<meta name="description" content="{html.escape(DESC)}">
<link rel="canonical" href="{URL}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0b0a14">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Whisper+Me">
<meta property="og:url" content="{URL}">
<meta property="og:title" content="{html.escape(TITLE)}">
<meta property="og:description" content="{html.escape(DESC)}">
<meta property="og:image" content="https://whisperplusme.com/og-image.jpg?v=6">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{html.escape(TITLE)}">
<meta name="twitter:description" content="{html.escape(DESC)}">
<meta name="twitter:image" content="https://whisperplusme.com/og-image.jpg?v=6">
<link rel="stylesheet" href="/pages.css">
<style>{CSS}</style>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-3FZCXS1T84"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-3FZCXS1T84');gtag('config','G-HJLVLCXVR9');</script>
<script type="application/ld+json">{json.dumps(schema, ensure_ascii=False)}</script>
</head>
<body>
<header class="pg-top"><a class="pg-brand" href="/"><img src="/icon-192.png" alt="" width="34" height="34"><span>Whisper<b>+</b>Me</span></a><a class="pg-join" href="/">Join free</a></header>
<main class="pg">
{body}
</main>
<footer class="pg-foot">
<nav aria-label="More from Whisper+Me"><a href="/meet/">Meet up</a><a href="/help/">How to use</a><a href="/rooms/">Voice chat rooms</a><a href="/connect">Date ideas</a><a href="/about.html">About</a><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a></nav>
<p>© 2026 Whisper+Me · Real voices. Real moments. · 18+</p>
</footer>
</body>
</html>
"""
os.makedirs(os.path.join(ROOT, "help"), exist_ok=True)
open(os.path.join(ROOT, "help", "index.html"), "w").write(page)
print("wrote public/help/index.html", len(page), "bytes")
