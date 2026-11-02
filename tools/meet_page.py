#!/usr/bin/env python3
"""Builds public/meet/index.html: whisperplusme.com/meet, the page to share for the
meet-up side of Whisper+Me (M&G, Connect Me, Plan a Date).
Pictures: public/meet/card.jpg|png (link previews), public/meet/story.png (Stories),
public/media/meet-up.mp4 (47-second promo). Screenshots come from public/help/img/.
Run: python3 tools/meet_page.py"""
import html, json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
IMG = os.path.join(ROOT, "help", "img")
URL = "https://whisperplusme.com/meet/"
TITLE = "Meet Up in Real Life: Meet & Greets, Date Nights & Plan Your Own Date | Whisper+Me"
DESC = "Meet people at real places: M&G meet & greets, Connect Me date nights at one price for 2 or 4, or plan your own date anywhere and pick who goes. Free to join, 21+ to meet up."
E = html.escape


def shot(name, cap):
    w, h = Image.open(os.path.join(IMG, name + ".webp")).size
    return f'<figure class="hp-shot"><img src="/help/img/{name}.webp" width="{w}" height="{h}" loading="lazy" decoding="async" alt="{E(cap)}"><figcaption>{cap}</figcaption></figure>'


def shots(*items):
    return '<div class="hp-shots">' + "".join(shot(*i) for i in items) + "</div>"


def steps(*items):
    return '<ol class="hp-steps">' + "".join(f"<li><b>{t}</b>{d}</li>" for t, d in items) + "</ol>"


CAPTIONS = [
    "No more “what do you want to do?” 😅 Whisper+Me has meet & greets, date nights at one price, and you can even plan your own date and pick who goes. Free to join 👉 whisperplusme.com/meet",
    "Plan a date anywhere, at a real public place. People tap “I'm interested” and YOU pick who goes. 📍 whisperplusme.com/meet",
    "Date night for 2, one price: dinner, bowling, shows. Invite who you want, or send a “take me out” link 💞 whisperplusme.com/meet",
]

FAQ = [
    ("Is it free?", "Joining Whisper+Me is free. M&G spots and Connect Me packages have a price shown up front. Posting a Plan a Date costs $4.99, and asking to go on one is free."),
    ("Do I need an app?", "No. It works in any browser on your phone or computer. You can add it to your home screen."),
    ("Who can meet up?", "Anyone 21 or older. You need a free account, and for Plan a Date, a profile photo."),
    ("Where do people meet?", "Only at real public places: restaurants, cafés, bowling, classes, shows. Never homes or hotels."),
    ("Does anyone pay anyone?", "No. For M&G and Connect Me you pay through Whisper+Me. For Plan a Date, the two of you pay the place directly. Asking for or offering money gets you removed."),
    ("What if my date doesn't show?", "Everyone checks in with “I'm here” at the place. No-shows get a strike; if you showed up and they didn't, you get a coin, and on Plan a Date your fee comes back too."),
    ("Is it only in St. Louis?", "M&G and Connect Me start in the St. Louis area. Plan a Date works in any city."),
]

body = f"""
<nav class="pg-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <span>Meet up in real life</span></nav>
<section class="pg-hero">
<div class="mt-kick">WHISPER+ME</div>
<h1>Meet up in real life</h1>
<p class="pg-lead">Real dates at real places. Join a meet &amp; greet, grab a date night for two at one price, or plan your own date anywhere and pick who goes.</p>
<div class="pg-ctas"><a class="pg-btn" href="/?dates=1">⭐ See what's on</a><a class="pg-btn ghost" href="/?dates=pd">📍 Plan a date</a></div>
<p class="pg-note">Free to join · 21+ to meet up · Public places only</p>
<video class="hp-video" src="/media/meet-up.mp4" poster="/media/meet-up.jpg" controls playsinline preload="none" aria-label="47-second video: meet up in real life on Whisper+Me"></video>
</section>

<nav class="mt-three" aria-label="Three ways to meet up">
<a href="#mg" style="--c:#ffc94d"><span>⭐</span><b>M&amp;G</b><small>Meet &amp; greets with hosts and new people</small></a>
<a href="#connect" style="--c:#e0457b"><span>💞</span><b>Connect Me</b><small>Date nights for 2 or 4, one price</small></a>
<a href="#plan" style="--c:#00e3ae"><span>📍</span><b>Plan a Date</b><small>Your plan, your place, you pick who goes</small></a>
</nav>

<section class="pg-card mt-sec" id="mg" style="--c:#ffc94d"><h2>⭐ M&amp;G: meet &amp; greets</h2>
<p>Dinners, brunches, game nights and shows hosted by members, creators or Whisper+Me. Buy a spot (or a few for your friends), show up, and meet people you'd never run into otherwise.</p>
{steps(("Pick one", "Browse by category. Every card shows the host, the day, the place and the price per spot."),
       ("Get your spot", "Pay once. The address and your entry code show up right away under 🎟️ My tickets."),
       ("Show your code", "Tap “I'm here” at the place. If the host cancels or doesn't show, you get your money back as credit."))}
{shots(("10-mg-list", "M&amp;Gs on now"), ("11-mg-sheet", "Who's hosting, the price and what's included"), ("12-tickets", "Your ticket, the address and your code"))}
<p class="mt-host"><b>Have a following?</b> Host your own M&amp;G: set the price, keep 90%, and get paid a few days after.</p>
<div class="pg-ctas"><a class="pg-btn" href="/?dates=1">⭐ Find an M&amp;G</a></div>
</section>

<section class="pg-card mt-sec" id="connect" style="--c:#e0457b"><h2>💞 Connect Me: date night, one price</h2>
<p>Ready-made nights out at real places near you: dinner for two, bowling for four, a show. One price covers it. You buy it, then invite who you're bringing.</p>
{steps(("Pick a night out", "Each package shows the place, the day, what's included and the price for the group."),
       ("Invite who you're bringing", "Pick a member, or send them a link. They join free to accept."),
       ("Or get taken out", "Tap “Ask someone to take me out” and share your link. Whoever opens it can treat you."))}
{shots(("20-cm-list", "Connect Me date nights"), ("21-cm-sheet", "One price for 2 or 4"), ("22-takemeout", "Share a “take me out” link"))}
<div class="pg-ctas"><a class="pg-btn" href="/connect">💞 See date ideas</a><a class="pg-btn ghost" href="/?dates=cm">🙋 Take me out</a></div>
</section>

<section class="pg-card mt-sec" id="plan" style="--c:#00e3ae"><h2>📍 Plan a Date: you pick who goes</h2>
<p>Anywhere, any city. Post a date at a real public place, say who pays the bill, and people tap “I'm interested.” You see their photo, rating, past dates and how far away they are, then pick one.</p>
{steps(("Post it", "The plan, the place, the time and who pays (split, you treat, or each pays their own). $4.99 to list."),
       ("Pick someone", "People ask for free. Tap Pick on the one you want; they confirm."),
       ("Show up", "Message each other in the app, get the address, and both tap “I'm here.” You pay the place directly."))}
{shots(("pd1-list", "Open dates near you"), ("pd4-create", "Post a date in a minute"), ("pd2a-requests", "You pick who goes"), ("pd5-chat", "Talk before you meet"))}
<p class="mt-host">No match by the time it starts? Your $4.99 comes back as credit.</p>
<div class="pg-ctas"><a class="pg-btn" href="/?dates=pd">📍 Plan a date</a></div>
</section>

<section class="pg-card" id="which"><h2>Which one is for you?</h2>
<div class="mt-tablewrap"><table class="hp-table"><thead><tr><th></th><th>⭐ M&amp;G</th><th>💞 Connect Me</th><th>📍 Plan a Date</th></tr></thead><tbody>
<tr><td>Who you meet</td><td>A host and a group</td><td>Who you invite</td><td>Who you pick</td></tr>
<tr><td>Where</td><td>Chosen by the host</td><td>Our partner places</td><td>Any public place you choose</td></tr>
<tr><td>Price</td><td>Per spot, set by the host</td><td>One price for 2 or 4</td><td>$4.99 to post, free to ask; you pay the place</td></tr>
<tr><td>Best for</td><td>Meeting new people</td><td>A ready-made date night</td><td>Your own plan, any city</td></tr>
</tbody></table></div>
</section>

<section class="pg-card" id="safety"><h2>🛟 Safe by design</h2>
<ul class="hp-list">
<li><b>Public places only.</b> Never homes or hotels.</li>
<li><b>Nobody pays anybody.</b> No money between members, ever. Anyone who asks gets removed.</li>
<li><b>Everyone checks in</b> with “I'm here” at the place, and no-shows get strikes.</li>
<li><b>21+</b>, with ratings after every meet-up, and block and report one tap away.</li>
<li><b>Share with a friend:</b> one button sends who, where and when to someone you trust.</li>
</ul>
</section>

<section class="pg-card" id="share"><h2>↗ Share this</h2>
<p>Know someone who's always asking “what do you want to do?” Send them this page.</p>
<div class="mt-share">
<button type="button" data-act="native">↗ Share</button>
<button type="button" data-act="copy">🔗 Copy link</button>
<a data-net="fb" target="_blank" rel="noopener">Facebook</a>
<a data-net="x" target="_blank" rel="noopener">X</a>
<a data-net="wa" target="_blank" rel="noopener">WhatsApp</a>
<a data-net="sms">Text</a>
<a data-net="mail">Email</a>
</div>
<h3>Pictures and video to post</h3>
<div class="mt-dl">
<a href="/meet/story.png" download="whisperplusme-meet-story.png"><img src="/meet/story.png" alt="Story picture: Meet up in real life, with a QR code" loading="lazy" width="1080" height="1920"><span>Story / Reel picture</span></a>
<a href="/meet/card.png" download="whisperplusme-meet.png"><img src="/meet/card.jpg" alt="Post picture: Meet up in real life" loading="lazy" width="1200" height="630"><span>Post picture</span></a>
<a href="/media/meet-up.mp4" download="whisperplusme-meet-up.mp4"><img src="/media/meet-up.jpg" alt="The 47-second video" loading="lazy" width="540" height="960"><span>47-second video</span></a>
</div>
<h3>Captions you can copy</h3>
{"".join(f'<div class="mt-cap"><p>{E(c)}</p><button type="button" data-cap="{E(c)}">Copy</button></div>' for c in CAPTIONS)}
</section>

<section class="pg-card" id="faq"><h2>❓ Questions</h2>
{"".join(f'<details class="hp-q"><summary>{q}</summary><p>{a}</p></details>' for q, a in FAQ)}
<p style="margin-top:14px">More detail in the <a href="/help/#mg">full guide</a>.</p>
</section>

<section class="pg-hero"><div class="pg-ctas"><a class="pg-btn" href="/?dates=1">⭐ See what's on</a><a class="pg-btn ghost" href="/?dates=pd">📍 Plan a date</a></div><p class="pg-note">Free to join · 21+ to meet up</p></section>
"""

schema = {"@context": "https://schema.org", "@graph": [
    {"@type": "WebPage", "@id": URL, "url": URL, "name": TITLE, "description": DESC, "image": "https://whisperplusme.com/meet/card.jpg",
     "isPartOf": {"@type": "WebSite", "name": "Whisper+Me", "url": "https://whisperplusme.com/"}},
    {"@type": "VideoObject", "name": "Meet up in real life on Whisper+Me", "description": "M&G meet & greets, Connect Me date nights and Plan a Date in 47 seconds.",
     "thumbnailUrl": "https://whisperplusme.com/media/meet-up.jpg", "contentUrl": "https://whisperplusme.com/media/meet-up.mp4", "uploadDate": "2026-11-01", "duration": "PT47S"},
    {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]},
    {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Home", "item": "https://whisperplusme.com/"}, {"@type": "ListItem", "position": 2, "name": "Meet up in real life", "item": URL}]}]}

CSS = """
.mt-kick{font-weight:900;letter-spacing:.14em;color:#7ff0d0;font-size:14px;margin-bottom:6px}
.hp-video{display:block;width:min(320px,100%);aspect-ratio:9/16;margin:18px auto 0;border-radius:22px;border:3px solid #24213a;background:#000;box-shadow:0 10px 30px rgba(0,0,0,.45)}
.mt-three{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:18px 0}
.mt-three a{display:block;text-decoration:none;color:#fff;background:#14121f;border:1px solid rgba(255,255,255,.08);border-top:4px solid var(--c);border-radius:18px;padding:14px 16px}
.mt-three span{font-size:28px;display:block}.mt-three b{display:block;font-size:18px;margin:4px 0 2px}.mt-three small{color:#b9b2d4;font-size:13.5px;line-height:1.4}
.mt-sec{border-top:4px solid var(--c)!important}
.mt-sec h2{color:#fff}
.mt-host{background:rgba(255,255,255,.05);border-radius:12px;padding:10px 12px;font-size:14.5px}
.hp-shots{display:flex;gap:14px;overflow-x:auto;padding:6px 2px 10px;margin:14px 0;scroll-snap-type:x mandatory}
.hp-shot{margin:0;flex:0 0 min(210px,62%);scroll-snap-align:start}
.hp-shot:first-child{margin-left:auto}.hp-shot:last-child{margin-right:auto}
.hp-shot img{display:block;width:100%;height:auto;border-radius:20px;border:3px solid #24213a;box-shadow:0 10px 30px rgba(0,0,0,.45);background:#0b0a14}
.hp-shot figcaption{font-size:13px;color:#b9b2d4;line-height:1.4;margin-top:8px;text-align:center}
.hp-steps{counter-reset:s;list-style:none;padding:0;margin:12px 0;display:flex;flex-direction:column;gap:10px}
.hp-steps li{counter-increment:s;position:relative;padding:10px 12px 10px 48px;background:rgba(255,255,255,.04);border-radius:12px;line-height:1.5}
.hp-steps li::before{content:counter(s);position:absolute;left:12px;top:10px;width:26px;height:26px;border-radius:50%;background:var(--c,#7b2ff7);color:#0b0a14;font-weight:900;font-size:14px;display:grid;place-items:center}
.hp-steps li b{display:block;color:#fff}
.hp-list{padding-left:20px;line-height:1.6}.hp-list li{margin:6px 0}
.mt-tablewrap{overflow-x:auto}
.hp-table{width:100%;border-collapse:collapse;font-size:14px;margin:6px 0 12px;min-width:520px}
.hp-table th,.hp-table td{text-align:left;padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.1);vertical-align:top}
.hp-table th{font-size:13px}.hp-table td:first-child{color:#9a8fb5;font-weight:700}
.mt-share{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 6px}
.mt-share button,.mt-share a{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;border-radius:999px;padding:10px 16px;font-weight:700;font-size:14px;cursor:pointer;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.mt-share button[data-act=native]{background:linear-gradient(90deg,#7b2ff7,#00e3ae);border:0}
.mt-dl{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;align-items:start}
.mt-dl a{text-decoration:none;color:#c9bfff;font-size:13px;text-align:center}
.mt-dl img{display:block;width:100%;height:auto;border-radius:12px;border:1px solid rgba(255,255,255,.12);margin-bottom:6px;background:#000}
.mt-dl a:nth-child(2) img{aspect-ratio:1200/630;object-fit:cover}
.mt-cap{display:flex;gap:10px;align-items:center;background:rgba(255,255,255,.04);border-radius:12px;padding:10px 12px;margin:8px 0}
.mt-cap p{margin:0;flex:1;font-size:14px}.mt-cap button{border:0;border-radius:999px;background:#00e3ae;color:#06281f;font-weight:800;padding:8px 14px;cursor:pointer;min-height:38px}
.hp-q{background:rgba(255,255,255,.04);border-radius:12px;padding:10px 14px;margin:8px 0}
.hp-q summary{cursor:pointer;font-weight:800}.hp-q p{margin:8px 0 2px;color:rgba(255,255,255,.86)}
.pg h3{font-size:17px;margin:20px 0 8px;color:#7ff0d0}
.pg-card{scroll-margin-top:12px}
"""

JS = """
(function(){
  var url = "https://whisperplusme.com/meet/", text = "Meet up in real life: meet & greets, date nights for 2, or plan your own date and pick who goes. Free to join.";
  var src = new URLSearchParams(location.search).get("ref"); if (src) url += "?ref=" + encodeURIComponent(src.slice(0, 40));
  /* Ad and referral tags on this link (ref, utm_*) carry on into the app, so sign-ups and sales are credited. */
  var keep = new URLSearchParams(), q = new URLSearchParams(location.search);
  ["ref", "utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach(function(k){ if (q.get(k)) keep.set(k, q.get(k).slice(0, 60)); });
  if (keep.toString()) document.querySelectorAll("a[href^='/?'], a[href='/connect']").forEach(function(a){ a.href = a.getAttribute("href") + (a.getAttribute("href").indexOf("?") > -1 ? "&" : "?") + keep.toString(); });
  var nets = { fb: "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(url), x: "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url),
    wa: "https://wa.me/?text=" + encodeURIComponent(text + " " + url), sms: "sms:?&body=" + encodeURIComponent(text + " " + url), mail: "mailto:?subject=" + encodeURIComponent("Want to go out?") + "&body=" + encodeURIComponent(text + "\\n\\n" + url) };
  document.querySelectorAll("[data-net]").forEach(function(a){ a.href = nets[a.getAttribute("data-net")]; });
  function copy(t, b){ var done = function(){ var o = b.textContent; b.textContent = "✅ Copied"; setTimeout(function(){ b.textContent = o; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, function(){ prompt("Copy this:", t); }); else prompt("Copy this:", t); }
  document.querySelector("[data-act=copy]").onclick = function(){ copy(url, this); };
  var nb = document.querySelector("[data-act=native]");
  nb.onclick = function(){ if (navigator.share) navigator.share({ title: "Meet up in real life · Whisper+Me", text: text, url: url }).catch(function(){}); else copy(url, this); };
  document.querySelectorAll("[data-cap]").forEach(function(b){ b.onclick = function(){ copy(b.getAttribute("data-cap"), b); }; });
})();
"""

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{E(TITLE)}</title>
<meta name="description" content="{E(DESC)}">
<link rel="canonical" href="{URL}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0b0a14">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Whisper+Me">
<meta property="og:url" content="{URL}">
<meta property="og:title" content="Meet up in real life · Whisper+Me">
<meta property="og:description" content="Meet & greets, date nights for 2 at one price, or plan your own date anywhere and pick who goes. Free to join.">
<meta property="og:image" content="https://whisperplusme.com/meet/card.jpg?v=1">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Meet up in real life: M&G meet & greets, Connect Me nights out, Plan your own date. whisperplusme.com/meet">
<meta property="og:video" content="https://whisperplusme.com/media/meet-up.mp4">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="1080">
<meta property="og:video:height" content="1920">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Meet up in real life · Whisper+Me">
<meta name="twitter:description" content="Meet & greets, date nights for 2, or plan your own date and pick who goes.">
<meta name="twitter:image" content="https://whisperplusme.com/meet/card.jpg?v=1">
<link rel="stylesheet" href="/pages.css">
<style>{CSS}</style>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-3FZCXS1T84"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-3FZCXS1T84');gtag('config','G-HJLVLCXVR9');</script>
<script type="application/ld+json">{json.dumps(schema, ensure_ascii=False)}</script>
</head>
<body>
<header class="pg-top"><a class="pg-brand" href="/"><img src="/icon-192.png" alt="" width="34" height="34"><span>Whisper<b>+</b>Me</span></a><a class="pg-join" href="/?dates=1">Join free</a></header>
<main class="pg">
{body}
</main>
<footer class="pg-foot">
<nav aria-label="More from Whisper+Me"><a href="/meet">Meet up</a><a href="/connect">Date ideas</a><a href="/help/">How to use</a><a href="/rooms/">Voice chat rooms</a><a href="/about.html">About</a><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a></nav>
<p>© 2026 Whisper+Me · Real voices. Real moments. · 21+ to meet up</p>
</footer>
<script>{JS}</script>
</body>
</html>
"""
os.makedirs(os.path.join(ROOT, "meet"), exist_ok=True)
open(os.path.join(ROOT, "meet", "index.html"), "w").write(page)
print("wrote public/meet/index.html", len(page), "bytes")
