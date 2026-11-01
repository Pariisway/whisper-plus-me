# Builds the crawlable topic-room pages: public/rooms/index.html and public/rooms/<slug>/index.html
import json, os, html, datetime
import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
SITE = "https://whisperplusme.com"
TODAY = datetime.date.today().isoformat()
e = lambda s: html.escape(s, quote=True)

CRISIS = ("Whisper+Me is peer support from real people, not therapy and not a crisis line. "
          "If you might hurt yourself or someone else, call or text <b>988</b> (Suicide &amp; Crisis Lifeline, US) or <b>911</b>. "
          "Outside the US, find a free, confidential helpline at <a href=\"https://findahelpline.com\" rel=\"nofollow noopener\" target=\"_blank\">findahelpline.com</a>.")

GROUPS = [
  ("Start here", ["general", "voices", "connection", "nightowls"]),
  ("Support & healing", ["vent", "anxiety", "grief", "mentalhealth"]),
  ("Community", ["lgbt_safe", "lgbt_chat", "creators"]),
  ("Spiritual", ["psychics", "astrology", "tarot", "apothecary"]),
]

ROOMS = {
  "general": dict(slug="general-voice-chat", emoji="💬", name="General",
    h1="General voice chat: talk to new people, free",
    title="Free Voice Chat Room: Talk to Strangers Online | Whisper+Me",
    desc="Drop into Whisper+Me's General voice chat room and talk to real people right now. Free, no download, open 24/7. Listen in or grab the mic.",
    intro="General is the front door of Whisper+Me: an open voice and text chat room where anyone can drop in, say hi and see who's around. No topic, no pressure. People come here to kill time, make a friend, ask a question or just hear another human voice.",
    expect=["Live text chat that anyone can read the moment they arrive", "An open mic: tap Live to speak to the whole room, or just listen", "Friendly regulars who will point you to the right room", "Members you can call 1-on-1 when you click with someone"],
    good="Bored, curious, new to Whisper+Me, or just want company while you do something else.",
    kw="voice chat, talk to strangers, free chat room, talk to new people"),
  "voices": dict(slug="open-mic", emoji="🎙️", name="Live Voices",
    h1="Live Voices: an online open mic, any time",
    title="Online Open Mic: Go Live and Be Heard, Free | Whisper+Me",
    desc="Take the mic in Whisper+Me's Live Voices room. Sing, tell a story, share a poem or start a debate in front of a live audience. Free, open 24/7.",
    intro="Live Voices is an always-open online open mic. Tap Live and everyone in the room hears you in real time: singers warming up, comedians testing bits, poets, storytellers and people who just want to talk. The audience listens and reacts in the chat.",
    expect=["One tap to go live, no stage fright about video", "A live audience that reacts in chat", "Regular performers you can follow and call", "A great way to grow an audience before you charge for calls"],
    good="Singers, rappers, comedians, poets, podcasters and anyone who wants to practice speaking out loud.",
    kw="online open mic, live audio, go live, sing online"),
  "connection": dict(slug="meet-new-people", emoji="🤝", name="Real Connection",
    h1="Real Connection: meet genuine people online",
    title="Meet New People Online by Voice, Free | Whisper+Me",
    desc="Tired of swiping? Meet genuine people by voice in Whisper+Me's Real Connection room. Talk first, then call 1-on-1 or meet up at a real place.",
    intro="Real Connection is for people who want more than likes and swipes. Talk by voice first, so you get a feel for someone before anything else. When you click with someone you can call them 1-on-1, or meet in person at a public M&amp;G or a Connect Me night out.",
    expect=["Voice-first conversations that skip the small talk", "People looking for friends, not followers", "1-on-1 calls when you want to keep talking", "A path from talking online to meeting at real, public places"],
    good="New in town, working odd hours, or done with apps that never lead to a real conversation.",
    kw="meet new people, make friends online, talk to people, voice chat friends"),
  "nightowls": dict(slug="night-owls-chat", emoji="🌙", name="Night Owls",
    h1="Night Owls: someone's awake at 3am too",
    title="Can't Sleep? Late-Night Voice Chat at 3am | Whisper+Me",
    desc="Awake at 3am? Night Owls is Whisper+Me's late-night voice chat room for insomniacs, night-shift workers and overthinkers. Free, always open.",
    intro="When the house is quiet and your mind isn't, Night Owls is where people gather. Insomniacs, night-shift workers, new parents on feeding duty and overthinkers keep each other company until the sun comes up. Talk, listen, or just leave the room playing in the background.",
    expect=["People awake at the same odd hours as you", "Calm, low-key conversation", "A live room to listen to while you wind down", "Members around the world, so someone's always on"],
    good="Insomnia, night shifts, jet lag, or the 3am thoughts that won't stop.",
    kw="can't sleep, 3am chat, late night chat, insomnia chat room"),
  "vent": dict(slug="vent-room", emoji="🫂", name="Vent & Release", crisis=True,
    h1="Vent & Release: say it out loud, anonymously",
    title="Need to Vent? Anonymous Vent Chat Room, Free | Whisper+Me",
    desc="Get it off your chest in Whisper+Me's Vent & Release room. Talk anonymously to real people who listen without judging. Free, open 24/7.",
    intro="Sometimes you don't need advice, you need to say it out loud. Vent & Release is a judgment-free room where you can let it all out by voice or text, using any name you like. Others listen, and if you want it, offer a kind word back.",
    expect=["Listeners, not fixers: people won't lecture you", "Use any display name; no real name needed", "Text or voice, whichever feels easier", "Block and report in one tap if anyone's unkind"],
    good="A bad day, a fight, a frustration you can't say to the people involved, or feelings that need somewhere to go.",
    kw="vent online, anonymous vent, someone to talk to, vent chat room"),
  "anxiety": dict(slug="anxiety-support-chat", emoji="🌿", name="Anxiety & Stress", crisis=True,
    h1="Anxiety & Stress: you're not the only one",
    title="Anxiety Chat Room: Talk to Someone Who Gets It | Whisper+Me",
    desc="Feeling anxious or stressed? Talk to real people who understand in Whisper+Me's Anxiety & Stress voice chat room. Anonymous, free, open 24/7.",
    intro="Anxiety feels lonelier than it is. In Anxiety &amp; Stress, members talk through racing thoughts, work stress, panic and worry with people who have been there. Sharing what helps them, or just keeping each other company until it passes.",
    expect=["People who understand anxiety from the inside", "Coping ideas that worked for real members", "Quiet listening when you just need company", "No pressure to speak; reading the chat is fine"],
    good="Worry, stress, racing thoughts, or a hard day you want to talk through.",
    kw="anxiety chat, talk to someone about anxiety, stress support, anxiety support group online"),
  "grief": dict(slug="grief-support-chat", emoji="🕊️", name="Grief & Loss", crisis=True,
    h1="Grief & Loss: talk about the person you miss",
    title="Grief Support Chat: Talk About Your Loss | Whisper+Me",
    desc="Lost someone? Talk with people who understand grief in Whisper+Me's Grief & Loss voice chat room. Free, anonymous peer support, open 24/7.",
    intro="Grief doesn't keep office hours. Grief &amp; Loss is a gentle room for anyone who has lost a parent, partner, child, friend or pet. Share memories, say their name out loud, or talk about the days that are harder than people realize.",
    expect=["People who have lost someone too", "Room to tell stories and share memories", "No timelines: grief takes as long as it takes", "Support on anniversaries, holidays and 3am"],
    good="Recent loss, old grief that's resurfaced, or anyone missing someone today.",
    kw="grief support chat, talk about loss, grief chat room, bereavement support online"),
  "mentalhealth": dict(slug="mental-health-chat", emoji="💙", name="Mental Health", crisis=True,
    h1="Mental Health: honest talk, no judgment",
    title="Mental Health Chat Room: Peer Support Online | Whisper+Me",
    desc="Talk openly about mental health with real people in Whisper+Me's free, anonymous peer-support voice chat. No diagnosis needed. Open 24/7.",
    intro="Mental Health is a peer-support room for honest conversations about depression, burnout, loneliness, therapy, medication and everything in between. No diagnosis needed, no judgment. Just people being real with each other.",
    expect=["Open, stigma-free conversation", "Members who share what's helped them", "Encouragement to keep going and get help when you need it", "A kind community with block and report tools"],
    good="Anyone living with or curious about mental health, and anyone supporting someone who is.",
    kw="mental health chat, peer support online, talk to someone, depression chat"),
  "lgbt_safe": dict(slug="lgbtq-safe-space", emoji="🏳️‍🌈", name="LGBTQ+ Safe Space",
    h1="LGBTQ+ Safe Space: you belong here",
    title="LGBTQ+ Voice Chat: A Safe Space to Talk | Whisper+Me",
    desc="A welcoming LGBTQ+ voice chat room on Whisper+Me. Talk about coming out, relationships and identity with people who get it. Free, 18+.",
    intro="LGBTQ+ Safe Space is a welcoming room to be yourself out loud. Talk about coming out, identity, relationships, family or just your week, with people who won't make you explain yourself. Allies welcome; hate isn't.",
    expect=["A room where you don't have to code-switch", "Support around coming out and family", "Friends from all over the world", "Zero tolerance for harassment, with one-tap block and report"],
    good="LGBTQ+ adults and allies looking for community and real conversation.",
    kw="lgbtq chat, gay chat room, lgbt support online, queer community"),
  "lgbt_chat": dict(slug="queer-connect", emoji="💜", name="Queer Connect",
    h1="Queer Connect: LGBTQ+ friends and fun",
    title="Queer Connect: LGBTQ+ Social Voice Chat | Whisper+Me",
    desc="Make LGBTQ+ friends in Whisper+Me's Queer Connect voice chat room. Music, memes, nights out and good conversation. Free, 18+.",
    intro="Queer Connect is the social side: music, pop culture, nights out and making LGBTQ+ friends. It's lighter than the Safe Space room, and a good place to find people to call or meet at a public M&amp;G.",
    expect=["Laid-back LGBTQ+ social chat", "People to call 1-on-1 when you click", "Plans for real-world meetups", "A friendly, moderated room"],
    good="LGBTQ+ adults who want friends, banter and plans.",
    kw="queer chat, lgbtq friends, gay voice chat, make lgbtq friends"),
  "creators": dict(slug="creators-lounge", emoji="✨", name="Creators Lounge",
    h1="Creators Lounge: build, share and get paid",
    title="Creators Lounge: Grow an Audience and Earn from Calls | Whisper+Me",
    desc="Creators, streamers and artists share tips, collaborate and grow in Whisper+Me's Creators Lounge. Set your call price and earn $2 per coin.",
    intro="Creators Lounge is where streamers, artists, podcasters and coaches hang out: swapping growth tips, planning collabs and testing ideas live. On Whisper+Me you can set your own call price and earn $2 for every coin fans spend, or host paid rooms and in-person M&amp;Gs.",
    expect=["Feedback on your content and ideas", "Collab partners and cross-promotion", "Tips on pricing your calls and rooms", "How to host an M&amp;G and meet fans in person"],
    good="Anyone building an audience who wants to turn fans into real conversations and income.",
    kw="creator community, earn money talking, paid calls, fan meet and greet"),
  "psychics": dict(slug="psychic-chat", emoji="🔮", name="Psychic Circle",
    h1="Psychic Circle: readings, intuition and insight",
    title="Psychic Chat Room: Live Readings and Intuition | Whisper+Me",
    desc="Talk intuition, energy and readings in Whisper+Me's Psychic Circle voice chat room. Meet readers you can call 1-on-1. Free to join, 18+.",
    intro="Psychic Circle brings together readers, empaths and the curious. Share experiences, ask questions and find a reader whose style you like. Many readers offer 1-on-1 calls at the price they set. For entertainment and reflection.",
    expect=["Readers and curious members talking openly", "Live discussions about intuition and energy", "Readers you can call 1-on-1", "A respectful, skeptic-friendly room"],
    good="Anyone curious about psychic readings, or readers looking for new clients.",
    kw="psychic chat, live psychic reading, talk to a psychic, psychic community"),
  "astrology": dict(slug="astrology-chat", emoji="⭐", name="Astrology Lounge",
    h1="Astrology Lounge: charts, signs and cosmic talk",
    title="Astrology Chat Room: Talk Signs, Charts and Transits | Whisper+Me",
    desc="Compare birth charts, talk transits and find your people in Whisper+Me's Astrology Lounge voice chat room. Free, open 24/7.",
    intro="Astrology Lounge is for chart nerds and the newly curious. Compare big threes, talk about Mercury retrograde, read compatibility and ask what your placements mean. Astrologers in the room often offer 1-on-1 chart reading calls.",
    expect=["Birth chart and compatibility talk", "Live chats on transits and retrogrades", "Astrologers you can call for a reading", "Beginners welcome"],
    good="Anyone into zodiac signs, birth charts or horoscopes.",
    kw="astrology chat, birth chart reading, zodiac chat room, astrology community"),
  "tarot": dict(slug="tarot-reading-chat", emoji="🃏", name="Tarot & Palm Reading",
    h1="Tarot & Palm Reading: pull a card, ask a question",
    title="Tarot Chat Room: Live Tarot and Palm Readings | Whisper+Me",
    desc="Get live tarot and palm readings, learn the cards and meet readers in Whisper+Me's Tarot & Palm Reading voice chat room. Free to join.",
    intro="Tarot &amp; Palm Reading is a room for readers and seekers. Learn what the cards mean, practice reading for others, or book a 1-on-1 call with a reader you trust. For guidance, reflection and fun.",
    expect=["Live readings and card-of-the-day pulls", "Help learning tarot and palmistry", "Readers you can call 1-on-1", "A welcoming room for beginners"],
    good="Tarot readers, palm readers and anyone curious about a reading.",
    kw="tarot chat, live tarot reading, palm reading online, tarot community"),
  "apothecary": dict(slug="herbal-remedies-chat", emoji="🌿", name="The Apothecary",
    h1="The Apothecary: herbs, teas and natural living",
    title="Herbalism Chat Room: Herbs, Teas and Natural Living | Whisper+Me",
    desc="Talk herbs, teas, gardening and natural living in Whisper+Me's Apothecary voice chat room. Share what you grow and what you've learned.",
    intro="The Apothecary is for herbalists, gardeners, tea lovers and natural-living fans. Share what you grow, swap tea blends and talk about traditions. Not medical advice: always check with a doctor or pharmacist before using herbs for health.",
    expect=["Herb gardening and foraging talk", "Tea blends and kitchen herbalism", "Traditions from around the world", "A calm, friendly room"],
    good="Gardeners, herbal tea lovers and anyone into natural living.",
    kw="herbalism chat, herbal remedies community, natural living, herb garden"),
}

SHORT = {'general': 'Everyone welcome. Start here and say hi.', 'voices': 'Hop on the mic and be heard.', 'connection': 'Meet genuine people by voice.', 'nightowls': 'For anyone awake at 3am.', 'vent': 'A safe space to let it all out.', 'anxiety': "You're not alone with it here.", 'grief': 'Talk about the person you miss.', 'mentalhealth': 'Honest talk, no judgment.', 'lgbt_safe': 'You belong here, always.', 'lgbt_chat': 'LGBTQ+ friends, fun and plans.', 'creators': 'Grow an audience, get paid.', 'psychics': 'Readings, insight and intuition.', 'astrology': 'Charts, signs and transits.', 'tarot': 'Pull a card, ask a question.', 'apothecary': 'Herbs, teas and natural living.'}

def jsonld(obj): return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False).replace("</", "<\\/") + "</script>"

CSS = open(os.path.join(os.path.dirname(__file__), "pages.css")).read()
GA = """<script async src="https://www.googletagmanager.com/gtag/js?id=G-3FZCXS1T84"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-3FZCXS1T84');gtag('config','G-HJLVLCXVR9');</script>"""

def shell(title, desc, path, body, ld, extra_head=""):
    url = SITE + path
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0b0a14">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Whisper+Me">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="{SITE}/og-image.jpg?v=6">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
<meta name="twitter:image" content="{SITE}/og-image.jpg?v=6">
<link rel="stylesheet" href="/pages.css">
{extra_head}{GA}
{jsonld(ld)}
</head>
<body>
<header class="pg-top"><a class="pg-brand" href="/"><img src="/icon-192.png" alt="" width="34" height="34"><span>Whisper<b>+</b>Me</span></a><a class="pg-join" href="/">Join free</a></header>
<main class="pg">
{body}
</main>
<footer class="pg-foot">
<nav aria-label="More from Whisper+Me"><a href="/help/">How to use</a><a href="/rooms/">Voice chat rooms</a><a href="/connect">Date ideas</a><a href="/about.html">About</a><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a></nav>
<p>© {datetime.date.today().year} Whisper+Me · Real voices. Real moments. · 18+</p>
</footer>
</body>
</html>
"""

def crumbs(items):
    return {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + p} for i, (n, p) in enumerate(items)]}

def room_page(rid):
    r = ROOMS[rid]; path = f"/rooms/{r['slug']}/"
    join = f"/?room={rid}"
    others = [x for g in GROUPS for x in g[1] if x != rid]
    # closest neighbours first: same group, then the rest
    grp = next(g[1] for g in GROUPS if rid in g[1])
    order = [x for x in grp if x != rid] + [x for x in others if x not in grp]
    rel = "".join(f'<a class="pg-chip" href="/rooms/{ROOMS[x]["slug"]}/">{ROOMS[x]["emoji"]} {e(ROOMS[x]["name"])}</a>' for x in order[:8])
    faq = [
      (f"Is the {r['name']} room free?", "Yes. Joining Whisper+Me, reading and writing in the chat, and listening to the live mic are free. Members can go live on the mic for free too. Coins are only needed for 1-on-1 calls and paid member rooms."),
      ("Do I have to use my real name?", "No. Pick any display name you like. You can add a photo if you want, but you don't have to."),
      ("Do I need to download an app?", "No. Whisper+Me runs in your browser on any phone or computer. You can add it to your home screen in one tap so it opens like an app and rings for calls."),
      ("Who can join?", "Adults 18 and over. Rooms are moderated, and you can block or report anyone with one tap."),
    ]
    body = f"""<nav class="pg-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/rooms/">Voice chat rooms</a> › <span>{e(r['name'])}</span></nav>
<section class="pg-hero">
<div class="pg-emoji" aria-hidden="true">{r['emoji']}</div>
<h1>{e(r['h1'])}</h1>
<p class="pg-lead">{r['intro']}</p>
<div class="pg-ctas"><a class="pg-btn" href="{join}">{r['emoji']} Join {e(r['name'])} free</a><a class="pg-btn ghost" href="{join}">👀 Just listen first</a></div>
<p class="pg-note">Free · No download · 18+ · Open 24/7</p>
</section>
{f'<aside class="pg-crisis" role="note"><b>Need help right now?</b> {CRISIS}</aside>' if r.get('crisis') else ''}
<section class="pg-card"><h2>What happens in {e(r['name'])}</h2><ul class="pg-list">{''.join(f'<li>{x}</li>' for x in r['expect'])}</ul>
<p><b>Good for:</b> {r['good']}</p></section>
<section class="pg-card"><h2>How to join</h2><ol class="pg-steps"><li>Tap <a href="{join}">Join {e(r['name'])}</a>. You can peek in as a guest first.</li><li>Sign up free with email or Google, and pick any display name.</li><li>Type in the chat, or tap <b>Live</b> to talk out loud. Click someone's name to call them 1-on-1.</li></ol></section>
<section class="pg-card"><h2>More on Whisper+Me</h2>
<p>Besides live rooms, you can <b>call members 1-on-1</b> (creators set their own price), <b>host your own paid room</b>, and meet people in real life at <b>M&amp;G meet &amp; greets</b> and <a href="/connect">Connect Me date-night packages</a> at real, public places.</p></section>
<section class="pg-card"><h2>Questions</h2>{''.join(f'<details class="pg-faq"><summary>{e(q)}</summary><p>{a}</p></details>' for q, a in faq)}</section>
<section class="pg-card"><h2>Other rooms you might like</h2><div class="pg-chips">{rel}</div><p><a href="/rooms/">See all voice chat rooms →</a></p></section>
<div class="pg-ctas pg-end"><a class="pg-btn" href="{join}">Join {e(r['name'])} now</a></div>"""
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": SITE + path, "url": SITE + path, "name": r["title"], "description": r["desc"], "inLanguage": "en", "isPartOf": {"@id": SITE + "/#website"}, "dateModified": TODAY,
         "keywords": r["kw"], "potentialAction": {"@type": "JoinAction", "target": SITE + join}},
        crumbs([("Home", "/"), ("Voice chat rooms", "/rooms/"), (r["name"], path)]),
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": html.unescape(a)}} for q, a in faq]},
    ]}
    return path, shell(r["title"], r["desc"], path, body, ld)

def index_page():
    path = "/rooms/"
    title = "Free Voice Chat Rooms: Talk to Real People 24/7 | Whisper+Me"
    desc = "Free voice chat rooms for venting, anxiety, grief, late nights, LGBTQ+ friends, open mic, astrology, tarot and more. Talk or just listen. No download."
    secs = ""
    for gname, ids in GROUPS:
        cards = "".join(f'<a class="pg-room" href="/rooms/{ROOMS[i]["slug"]}/"><span class="pg-room-e" aria-hidden="true">{ROOMS[i]["emoji"]}</span><span><b>{e(ROOMS[i]["name"])}</b><small>{e(SHORT[i])}</small></span></a>' for i in ids)
        secs += f'<section class="pg-card"><h2>{e(gname)}</h2><div class="pg-rooms">{cards}</div></section>'
    body = f"""<nav class="pg-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <span>Voice chat rooms</span></nav>
<section class="pg-hero"><h1>Free voice chat rooms, open 24/7</h1>
<p class="pg-lead">Pick a room, then talk or just listen. Every room has live text chat and an open mic, and it's full of real people (no bots) from around the world. Join free with any display name, right in your browser.</p>
<div class="pg-ctas"><a class="pg-btn" href="/?room=general">💬 Jump into General</a><a class="pg-btn ghost" href="/connect">💞 Date ideas</a></div>
<p class="pg-note">Free · No download · 18+</p></section>
{secs}
<aside class="pg-crisis" role="note"><b>Going through something heavy?</b> {CRISIS}</aside>"""
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "@id": SITE + path, "url": SITE + path, "name": title, "description": desc, "isPartOf": {"@id": SITE + "/#website"}, "dateModified": TODAY},
        crumbs([("Home", "/"), ("Voice chat rooms", path)]),
        {"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "position": n + 1, "url": SITE + f"/rooms/{ROOMS[i]['slug']}/", "name": ROOMS[i]["name"]} for n, i in enumerate([x for g in GROUPS for x in g[1]])]},
    ]}
    return path, shell(title, desc, path, body, ld)

def write(path, html_):
    full = ROOT + path + "index.html"
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, "w", encoding="utf-8").write(html_)

assert set(ROOMS) == {x for g in GROUPS for x in g[1]}
write(*index_page())
for rid in ROOMS: write(*room_page(rid))
open(ROOT + "/pages.css", "w").write(CSS)
# the list the sitemap function and landing page use
print(json.dumps({rid: ROOMS[rid]["slug"] for g in GROUPS for rid in g[1]}))
