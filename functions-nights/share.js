/* ═══════════════════════════════════════════════════════════════
   SHARING 🔗  pictures and pages that look like the Whisper+Me app
   - /s/u/{uid}/card.png    profile picture for link previews (1200×630)
   - /s/u/{uid}/story.png   profile picture for Instagram/TikTok/Snap stories (1080×1920, with a QR code)
   - /s/m/{id}/card.png     M&G picture for link previews
   - /s/m/{id}/story.png    M&G story picture
   - /u/{uid}               the page people land on: the profile with real buttons
   Link previews (texts, Facebook, X…) can only show one picture and a
   title, so the picture itself is drawn like the app: the profile
   screen, with the buttons on it. Tapping it opens the page with the
   real buttons.
   Rendering: satori (layout → SVG) + resvg (SVG → PNG), Inter font,
   Twemoji for emoji.
═══════════════════════════════════════════════════════════════ */
const fs = require("fs");

module.exports = function makeShare({ db, rtdb, APP_URL, logger, ms, fmtMoney }) {
  let _satori = null, _Resvg = null, _fonts = null;
  const lib = () => {
    if (!_satori) { _satori = require("satori").default; _Resvg = require("@resvg/resvg-js").Resvg; }
    if (!_fonts) {
      const f = w => fs.readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`));
      _fonts = [400, 600, 800, 900].map(w => ({ name: "Inter", data: f(w), weight: w, style: "normal" }));
    }
    return { satori: _satori, Resvg: _Resvg, fonts: _fonts };
  };

  const C = { bg: "#0b0a14", panel: "#14121f", panel2: "#1b1829", line: "rgba(255,255,255,0.14)", text: "#f3f0fb", muted: "#b3abcf", purple: "#7b2ff7", teal: "#00e3ae", gold: "#f7b955", star: "#ffc94d" };
  const GRAD = "linear-gradient(90deg, #7b2ff7, #00e3ae)";
  const BG = "linear-gradient(150deg, #24104f 0%, #0b0a14 48%, #04302a 100%)";

  /* tiny element helper: every div is a flex box (satori needs that for several children) */
  function h(type, style, ...kids) {
    const children = kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false && k !== "");
    const s = type === "div" ? Object.assign({ display: "flex" }, style || {}) : (style || {});
    return { type, props: { style: s, children: children.length === 1 ? children[0] : children } };
  }
  const img = (src, style) => ({ type: "img", props: { src, style: style || {} } });
  const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };

  /* ---------- fetched pictures (member photos, posters), as data: URLs ---------- */
  const cache = new Map();
  async function dataUrl(url, maxBytes = 4.5 * 1024 * 1024) {
    if (!url || !/^https:\/\//.test(url)) return "";
    if (cache.has(url)) return cache.get(url);
    let out = "";
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const type = (r.headers.get("content-type") || "").split(";")[0];
      if (r.ok && /^image\/(jpeg|jpg|png|gif)$/.test(type)) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length <= maxBytes) out = `data:${type};base64,${buf.toString("base64")}`;
      }
    } catch (e) { logger.warn("share image fetch", url.slice(0, 80), e.message); }
    if (cache.size > 200) cache.clear();
    cache.set(url, out);
    return out;
  }
  /* emoji in names, bios and our own labels: Twemoji pictures */
  const emojiCache = new Map();
  async function loadAdditionalAsset(code, segment) {
    if (code !== "emoji") return [];
    const pts = [...segment].map(c => c.codePointAt(0).toString(16));
    const key = (segment.includes("‍") ? pts : pts.filter(p => p !== "fe0f")).join("-");
    if (emojiCache.has(key)) return emojiCache.get(key);
    let out = "";
    try {
      const r = await fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${key}.svg`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) out = "data:image/svg+xml;base64," + Buffer.from(await r.text()).toString("base64");
    } catch (e) { /* draw without it */ }
    emojiCache.set(key, out);
    return out;
  }
  async function toPng(tree, width, height) {
    const { satori, Resvg, fonts } = lib();
    let t = Date.now();
    const svg = await satori(tree, { width, height, fonts, loadAdditionalAsset });
    if (process.env.SHARE_TIMING) console.log("satori", Date.now() - t, "svg", svg.length); t = Date.now();
    const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
    if (process.env.SHARE_TIMING) console.log("resvg", Date.now() - t);
    return png;
  }
  async function qr(url) {
    const svg = await require("qrcode").toString(url, { type: "svg", margin: 1, color: { dark: "#0b0a14", light: "#ffffff" } });
    return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  }
  let iconUrl = null;
  async function appIcon() { if (iconUrl === null) iconUrl = await dataUrl(`${APP_URL}/icon-192.png`); return iconUrl; }

  /* ---------- shared pieces, drawn like the app ---------- */
  const brand = (icon, size = 30) => h("div", { alignItems: "center", gap: size * 0.45 },
    icon ? img(icon, { width: size * 1.5, height: size * 1.5, borderRadius: size * 0.4 }) : h("div", { width: size * 1.5, height: size * 1.5, borderRadius: size * 0.4, backgroundImage: GRAD }),
    h("div", { fontSize: size, fontWeight: 900, letterSpacing: size * 0.12, color: "#d9c8ff" }, "WHISPER+ME"));
  const chip = (text, size = 22, color = "#fff") => h("div", { background: "rgba(255,255,255,0.14)", borderRadius: 999, padding: `${size * 0.35}px ${size * 0.75}px`, fontSize: size, fontWeight: 600, color }, text);
  const button = (text, size, primary) => h("div", {
    height: size * 2.6, borderRadius: 999, alignItems: "center", justifyContent: "center", fontSize: size, fontWeight: 800, color: "#fff",
    ...(primary ? { backgroundImage: GRAD } : { background: "rgba(255,255,255,0.06)", border: `3px solid ${C.line}` })
  }, text);
  const initialCircle = (name, size) => h("div", { width: size, height: size, borderRadius: size, backgroundImage: "linear-gradient(135deg,#7b2ff7,#00e3ae)", alignItems: "center", justifyContent: "center", fontSize: size * 0.45, fontWeight: 900, color: "#fff" }, (String(name || "?").trim()[0] || "?").toUpperCase());

  /** The app's profile screen: photo, shade, name and chips. */
  function phoneScreen(p, w, hgt, scale) {
    const s = scale;
    return h("div", { width: w, height: hgt, borderRadius: 44 * s, border: `${10 * s}px solid #1b1829`, overflow: "hidden", position: "relative", backgroundImage: "linear-gradient(160deg,#2a1260,#0b0b16 60%,#003b2e)" },
      p.photo ? img(p.photo, { position: "absolute", top: 0, left: 0, width: w - 20 * s, height: hgt - 20 * s, objectFit: "cover" })
        : h("div", { position: "absolute", top: 0, left: 0, width: w - 20 * s, height: hgt - 20 * s, alignItems: "center", justifyContent: "center", fontSize: 220 * s, fontWeight: 900, color: "rgba(255,255,255,0.14)" }, (String(p.name || "?").trim()[0] || "?").toUpperCase()),
      h("div", { position: "absolute", top: 0, left: 0, width: w - 20 * s, height: hgt - 20 * s, backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.88) 100%)" }),
      h("div", { position: "absolute", top: 22 * s, left: 0, width: w - 20 * s, justifyContent: "center" },
        h("div", { background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 999, padding: `${7 * s}px ${16 * s}px`, fontSize: 18 * s, fontWeight: 700, color: "#fff" }, p.online ? "🟢 Online now" : "📞 Call me on Whisper+Me")),
      h("div", { position: "absolute", left: 24 * s, right: 24 * s, bottom: 26 * s, flexDirection: "column", gap: 10 * s },
        h("div", { fontSize: 38 * s, fontWeight: 900, color: "#fff", lineHeight: 1.1 }, clip(p.name, 22)),
        p.bio ? h("div", { fontSize: 19 * s, color: "rgba(255,255,255,0.88)", lineHeight: 1.35 }, clip(p.bio, 90)) : null,
        h("div", { gap: 8 * s, flexWrap: "wrap" }, chip(`📞 ${p.calls || 0} call${p.calls === 1 ? "" : "s"}`, 17 * s), chip(`🪙 ${p.price} · $${p.price * 3}`, 17 * s), p.rating && p.rating.n ? chip(`⭐ ${Number(p.rating.avg).toFixed(1)}`, 17 * s, C.star) : null)));
  }

  /* ---------- profile ---------- */
  async function profileData(uid) {
    const u = (await rtdb.ref(`users/${uid}`).once("value")).val();
    if (!u) return null;
    let online = false;
    try { online = (await rtdb.ref(`presence/${uid}`).once("value")).exists(); } catch (e) { /* offline */ }
    return { uid, name: clip(u.name || "Whisper+Me member", 40), bio: clip(u.bio || "", 300), photoUrl: u.photo || "", price: Number(u.price) || 1, calls: Number(u.calls) || 0,
      rating: u.rating || null, online, callsOn: u.callsEnabled !== false, instagram: u.instagram || "", twitter: u.twitter || "", website: u.website || "" };
  }
  async function profileCard(p, story) {
    const icon = await appIcon();
    const pp = { ...p, photo: await dataUrl(p.photoUrl) };
    const callText = p.callsOn ? `📞  Call me · $${p.price * 3}` : "👋  Say hi on Whisper+Me";
    if (!story) {
      return toPng(h("div", { width: 1200, height: 630, backgroundImage: BG, padding: "44px 56px", gap: 56, alignItems: "center", fontFamily: "Inter", color: C.text },
        phoneScreen(pp, 340, 542, 1),
        h("div", { flex: 1, flexDirection: "column", gap: 20 },
          brand(icon, 24),
          h("div", { fontSize: 62, fontWeight: 900, lineHeight: 1.05, color: "#fff" }, clip(p.name, 24)),
          h("div", { fontSize: 26, color: C.muted, lineHeight: 1.4 }, p.bio ? clip(p.bio, 110) : "Real voices. Real moments. Call me on Whisper+Me."),
          h("div", { gap: 10, flexWrap: "wrap" }, p.online ? chip("🟢 Online now", 22, C.teal) : null, chip(`🪙 ${p.price} coin${p.price === 1 ? "" : "s"} a call`, 22), p.rating && p.rating.n ? chip(`⭐ ${Number(p.rating.avg).toFixed(1)} host`, 22, C.star) : null),
          h("div", { flexDirection: "column", gap: 14, marginTop: 8 }, button(callText, 30, true), button("👤  See my profile", 26, false)))), 1200, 630);
    }
    const link = `${APP_URL}/u/${p.uid}`;
    return toPng(h("div", { width: 1080, height: 1920, backgroundImage: BG, padding: "90px 80px 80px", flexDirection: "column", alignItems: "center", gap: 44, fontFamily: "Inter", color: C.text },
      brand(icon, 44),
      phoneScreen(pp, 900, 1080, 2.2),
      h("div", { width: 900, flexDirection: "column", gap: 24 }, button(callText, 50, true), button("👤  See my profile", 42, false)),
      h("div", { alignItems: "center", gap: 30, marginTop: 10 },
        img(await qr(link), { width: 190, height: 190, borderRadius: 24, border: "8px solid #fff" }),
        h("div", { flexDirection: "column", gap: 8 },
          h("div", { fontSize: 38, fontWeight: 800, color: "#fff" }, "Tap the link or scan"),
          h("div", { fontSize: 30, color: C.muted }, "whisperplusme.com")))), 1080, 1920);
  }

  /* ---------- M&G ---------- */
  async function meetupData(id) {
    const x = (await db.doc(`meetups/${id}`).get()).data();
    if (!x || ["draft", "rejected", "expired"].includes(x.status)) return null;
    let rating = null;
    if (!x.official && x.hostUid) { try { rating = (await rtdb.ref(`users/${x.hostUid}/rating`).once("value")).val(); } catch (e) { /* none */ } }
    const live = x.status === "live" && !x.hidden && ms(x.startsAt) > Date.now();
    return { id, title: clip(x.title, 80), hostName: x.official ? "Whisper+Me" : clip(x.hostName, 40), hostUid: x.official ? "" : x.hostUid, hostPhotoUrl: x.hostPhoto || "", imageUrl: x.imageURL || "",
      hue: x.hue || 280, official: !!x.official, category: x.category || "M&G", items: x.items || [], about: x.about || "",
      startsAt: ms(x.startsAt), venueName: x.venueName || "", city: x.city || "", price: x.price, left: Math.max(0, (x.spots || 0) - (x.sold || 0) - (x.held || 0)), sold: x.sold || 0,
      idCheck: !!x.idCheck, rating, live };
  }
  const whenText = t => new Date(t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  const poster = (m, w, hgt, s, pic) => h("div", { width: w, height: hgt, borderRadius: 36 * s, overflow: "hidden", position: "relative", backgroundImage: `linear-gradient(135deg, hsl(${m.hue},60%,32%), hsl(${(m.hue + 40) % 360},65%,16%) 70%, #0b0b16)`, border: `${4 * s}px solid rgba(255,255,255,0.08)` },
    pic ? img(pic, { position: "absolute", top: 0, left: 0, width: w - 8 * s, height: hgt - 8 * s, objectFit: "cover" }) : null,
    h("div", { position: "absolute", top: 0, left: 0, width: w - 8 * s, height: hgt - 8 * s, backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.85) 100%)" }),
    h("div", { position: "absolute", top: 22 * s, left: 22 * s, right: 22 * s, justifyContent: "space-between" },
      h("div", { background: "rgba(0,0,0,0.5)", borderRadius: 999, padding: `${7 * s}px ${14 * s}px`, fontSize: 17 * s, fontWeight: 800, color: "#fff", letterSpacing: 1 }, m.official ? "⭐ WHISPER+ME PICK" : "⭐ M&G"),
      m.live && m.left <= 10 ? h("div", { background: "#e53950", borderRadius: 999, padding: `${7 * s}px ${14 * s}px`, fontSize: 17 * s, fontWeight: 800, color: "#fff" }, m.left ? `${m.left} LEFT` : "SOLD OUT") : null),
    h("div", { position: "absolute", left: 24 * s, right: 24 * s, bottom: 26 * s, fontSize: 36 * s, fontWeight: 900, color: "#fff", lineHeight: 1.1 }, clip(m.title, 60)));
  async function meetupCard(m, story) {
    const icon = await appIcon();
    const pic = await dataUrl(m.imageUrl || m.hostPhotoUrl), hostPic = m.official ? icon : await dataUrl(m.hostPhotoUrl);
    const buy = m.live ? (m.left ? `🎟️  Get my spot · ${fmtMoney(m.price)}` : "Sold out · see what's next") : "See what's coming up";
    const host = (size) => h("div", { alignItems: "center", gap: size * 0.5 },
      hostPic ? img(hostPic, { width: size * 2.2, height: size * 2.2, borderRadius: size * 2.2, objectFit: "cover" }) : initialCircle(m.hostName, size * 2.2),
      h("div", { flexDirection: "column" }, h("div", { fontSize: size, fontWeight: 800, color: "#fff" }, m.official ? "Hosted by Whisper+Me" : `with ${m.hostName}`),
        m.rating && m.rating.n ? h("div", { fontSize: size * 0.8, color: C.star, fontWeight: 700 }, `⭐ ${Number(m.rating.avg).toFixed(1)} · ${m.rating.n} rating${m.rating.n === 1 ? "" : "s"}`) : h("div", { fontSize: size * 0.8, color: C.muted }, "Meet & Greet")));
    const facts = (size) => h("div", { flexDirection: "column", gap: size * 0.4, fontSize: size, color: C.text },
      h("div", {}, `📅  ${whenText(m.startsAt)}`), h("div", {}, `📍  ${clip(m.venueName, 34)}${m.city ? ", " + clip(m.city.split(",")[0], 20) : ""}`),
      h("div", { gap: 12 * (size / 24), alignItems: "center" }, h("div", { fontWeight: 900, fontSize: size * 1.4, color: "#fff" }, fmtMoney(m.price)), h("div", { color: C.muted }, "per person"),
        m.live && m.left ? chip(`${m.left} spot${m.left === 1 ? "" : "s"} left`, size * 0.8, C.gold) : null, m.idCheck ? chip("🪪 21+ ID", size * 0.8, C.gold) : null));
    if (!story) {
      return toPng(h("div", { width: 1200, height: 630, backgroundImage: BG, padding: "44px 56px", gap: 52, alignItems: "center", fontFamily: "Inter", color: C.text },
        poster(m, 400, 542, 1, pic),
        h("div", { flex: 1, flexDirection: "column", gap: 20 },
          brand(icon, 22),
          h("div", { fontSize: 50, fontWeight: 900, lineHeight: 1.08, color: "#fff" }, clip(m.title, 52)),
          host(24), facts(24),
          h("div", { flexDirection: "column", gap: 12, marginTop: 6 }, button(buy, 28, true), button("↗  Bring a friend", 24, false)))), 1200, 630);
    }
    const link = `${APP_URL}/m/${m.id}`;
    return toPng(h("div", { width: 1080, height: 1920, backgroundImage: BG, padding: "90px 80px 80px", flexDirection: "column", alignItems: "center", gap: 40, fontFamily: "Inter", color: C.text },
      brand(icon, 44),
      poster(m, 920, 860, 2, pic),
      h("div", { width: 920, flexDirection: "column", gap: 26 }, host(36), facts(36)),
      h("div", { width: 920, flexDirection: "column", gap: 22 }, button(buy, 46, true)),
      h("div", { alignItems: "center", gap: 30, marginTop: 6 },
        img(await qr(link), { width: 180, height: 180, borderRadius: 24, border: "8px solid #fff" }),
        h("div", { flexDirection: "column", gap: 8 }, h("div", { fontSize: 36, fontWeight: 800, color: "#fff" }, "Tap the link or scan"), h("div", { fontSize: 28, color: C.muted }, "whisperplusme.com")))), 1080, 1920);
  }

  /* ---------- fallback picture (unknown profile / M&G) ---------- */
  async function plainCard(story) {
    const icon = await appIcon();
    const W = story ? 1080 : 1200, H = story ? 1920 : 630, s = story ? 1.8 : 1;
    return toPng(h("div", { width: W, height: H, backgroundImage: BG, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30 * s, fontFamily: "Inter", color: C.text, padding: 60 },
      brand(icon, 40 * s), h("div", { fontSize: 44 * s, fontWeight: 900, color: "#fff", textAlign: "center" }, "Real voices. Real moments."),
      h("div", { width: 620 * s, flexDirection: "column", gap: 16 * s }, button("🎙️  Join free", 30 * s, true))), W, H);
  }

  /** GET /s/{u|m}/{id}/{card|story}.png */
  async function shareImage(req, res) {
    const [kind, rawId, file] = req.path.split("/").filter(Boolean).slice(1);
    const id = String(rawId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
    const story = /^story/.test(file || "");
    let png;
    try {
      if (kind === "u") { const p = id && await profileData(id); png = p ? await profileCard(p, story) : await plainCard(story); }
      else if (kind === "m") { const m = id && await meetupData(id); png = m ? await meetupCard(m, story) : await plainCard(story); }
      else png = await plainCard(story);
    } catch (e) {
      logger.error("shareImage", req.path, e.stack || e.message);
      res.redirect(302, `${APP_URL}/og-image.png?v=4`); return;
    }
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=600, s-maxage=1800");
    if (story) res.set("Content-Disposition", `inline; filename="whisperplusme-${kind === "m" ? "mg" : "profile"}.png"`);
    res.status(200).send(png);
  }

  /* ---------- the page people land on: real buttons, styled like the app ---------- */
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ver = (...parts) => { let n = 0; parts.join("|").split("").forEach(c => { n = (n * 31 + c.charCodeAt(0)) >>> 0; }); return n.toString(36); };
  const PAGE_CSS = `*{box-sizing:border-box}html,body{margin:0;background:#0b0a14;color:#f3f0fb;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body{background:radial-gradient(900px 500px at 10% -10%,rgba(123,47,247,.35),transparent),radial-gradient(800px 500px at 110% 110%,rgba(0,227,174,.18),transparent),#0b0a14;min-height:100vh}
.w{max-width:460px;margin:0 auto;padding:18px 16px 40px}
.top{display:flex;align-items:center;gap:10px;justify-content:center;margin:4px 0 16px;font-weight:900;letter-spacing:.14em;color:#d9c8ff;text-decoration:none}
.top img{width:34px;height:34px;border-radius:10px}
.ph{position:relative;border-radius:34px;border:8px solid #1b1829;overflow:hidden;aspect-ratio:3/4;background:linear-gradient(160deg,#2a1260,#0b0b16 60%,#003b2e);box-shadow:0 24px 70px rgba(0,0,0,.55)}
.ph>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ph .ini{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:140px;font-weight:900;color:rgba(255,255,255,.13)}
.ph .sh{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35) 0%,rgba(0,0,0,0) 32%,rgba(0,0,0,.88) 100%)}
.ph .pill{position:absolute;top:16px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:6px 14px;font-size:13px;font-weight:700;white-space:nowrap}
.ph .tag{position:absolute;top:16px;right:16px;background:#e53950;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:800}
.ph .info{position:absolute;left:18px;right:18px;bottom:18px}
.nm{font-size:30px;font-weight:900;line-height:1.1;margin:0 0 6px;word-break:break-word}
.bio{font-size:15px;color:rgba(255,255,255,.88);margin:0 0 10px}
.chips{display:flex;gap:6px;flex-wrap:wrap}.chips span{background:rgba(255,255,255,.14);border-radius:999px;padding:6px 11px;font-size:13px;font-weight:600}
.chips .st{color:#ffc94d}.chips .on{color:#00e3ae}.chips .id{color:#f7b955}
.btns{display:flex;flex-direction:column;gap:10px;margin-top:18px}
.b{display:flex;align-items:center;justify-content:center;gap:8px;min-height:56px;border-radius:999px;font-weight:800;font-size:17px;color:#fff;text-decoration:none;border:0;cursor:pointer;width:100%;font-family:inherit}
.b.p{background:linear-gradient(90deg,#7b2ff7,#00e3ae);box-shadow:0 10px 28px rgba(123,47,247,.4);text-shadow:0 1px 3px rgba(0,0,0,.45)}
.b.s{background:rgba(255,255,255,.06);border:2px solid rgba(255,255,255,.14)}
.b.g{background:#d6b16b;color:#1a1308}
.soc{display:flex;justify-content:center;gap:10px;margin-top:14px}.soc a{width:46px;height:46px;border-radius:50%;background:#1b1829;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:20px;color:#fff}
.facts{background:#14121f;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:14px 16px;margin-top:14px;font-size:15px;display:flex;flex-direction:column;gap:6px}
.host{display:flex;align-items:center;gap:10px;margin-top:14px}.host img,.host .av{width:46px;height:46px;border-radius:50%;object-fit:cover;background:linear-gradient(135deg,#7b2ff7,#00e3ae);display:flex;align-items:center;justify-content:center;font-weight:900}
.host small{display:block;color:#b3abcf}
.foot{text-align:center;color:#8f89a8;font-size:12.5px;margin-top:22px}.foot a{color:#b9a4ff}`;
  function pageShell({ title, desc, url, image, body }) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(url)}"><meta name="theme-color" content="#0b0a14">
<link rel="icon" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website"><meta property="og:site_name" content="Whisper+Me"><meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(image)}">
<style>${PAGE_CSS}</style></head><body><div class="w"><a class="top" href="/"><img src="/icon-192.png" alt="">WHISPER+ME</a>${body}
<div class="foot">Real voices. Real moments. <a href="/">whisperplusme.com</a></div></div>
<script>document.querySelectorAll("[data-share]").forEach(function(b){b.onclick=function(){var d={title:document.title,url:location.href};if(navigator.share)navigator.share(d).catch(function(){});else if(navigator.clipboard)navigator.clipboard.writeText(location.href).then(function(){b.textContent="✅ Link copied";});};});</script>
</body></html>`;
  }
  const safeLink = (v, base) => {
    v = String(v || "").trim(); if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    if (base) return base + v.replace(/^@/, "");
    return /\./.test(v) ? "https://" + v : "";
  };

  async function profilePage(uid) {
    uid = String(uid || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
    const p = uid ? await profileData(uid) : null;
    if (!p) {
      return pageShell({ title: "Whisper+Me", desc: "Real voices. Real moments. Free to join.", url: APP_URL, image: `${APP_URL}/s/x/none/card.png`,
        body: `<div class="facts" style="text-align:center">This profile isn't available anymore.</div><div class="btns"><a class="b p" href="/">🎙️ Open Whisper+Me</a></div>` });
    }
    let mgs = 0;
    try { mgs = (await db.collection("meetups").where("hostUid", "==", uid).where("status", "==", "live").limit(10).get()).docs.filter(d => !d.data().hidden).length; } catch (e) { /* skip */ }
    const url = `${APP_URL}/u/${uid}`, open = `/?openProfile=${encodeURIComponent(uid)}`;
    const v = ver(p.name, p.photoUrl, p.price, p.bio, p.callsOn, p.rating && p.rating.n, Math.floor(Date.now() / 36e5)); // refresh the picture at most hourly
    const priceLine = `${p.price} coin${p.price === 1 ? "" : "s"} ($${p.price * 3}) a call`;
    const desc = `${p.online ? "🟢 Online now · " : ""}${priceLine}${p.rating && p.rating.n ? ` · ★ ${Number(p.rating.avg).toFixed(1)} host` : ""}${p.bio ? " · " + clip(p.bio, 120) : ""}`;
    const ig = safeLink(p.instagram, "https://instagram.com/"), tw = safeLink(p.twitter, /\./.test(p.twitter) ? "" : "https://x.com/"), web = safeLink(p.website);
    const body = `<div class="ph">${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="">` : `<div class="ini">${esc((p.name.trim()[0] || "?").toUpperCase())}</div>`}<div class="sh"></div>
<div class="pill">${p.online ? "🟢 Online now" : "📞 Call me on Whisper+Me"}</div>
<div class="info"><h1 class="nm">${esc(p.name)}</h1>${p.bio ? `<p class="bio">${esc(clip(p.bio, 160))}</p>` : ""}
<div class="chips"><span>📞 ${p.calls} call${p.calls === 1 ? "" : "s"}</span><span>🪙 ${esc(priceLine)}</span>${p.rating && p.rating.n ? `<span class="st">★ ${Number(p.rating.avg).toFixed(1)} host</span>` : ""}</div></div></div>
<div class="btns">${p.callsOn ? `<a class="b p" href="${esc(open)}">📞 Call ${esc(clip(p.name, 18))} · $${p.price * 3}</a>` : `<a class="b p" href="${esc(open)}">👋 Say hi on Whisper+Me</a>`}
<a class="b s" href="${esc(open)}">👤 See full profile</a>
${mgs ? `<a class="b g" href="/?dates=1">⭐ ${mgs} M&amp;G${mgs === 1 ? "" : "s"} you can join</a>` : `<a class="b s" href="/?room=general">🎙️ Hop into a live room</a>`}
<button class="b s" data-share>↗ Share this profile</button></div>
${ig || tw || web ? `<div class="soc">${ig ? `<a href="${esc(ig)}" target="_blank" rel="noopener nofollow" aria-label="Instagram">📸</a>` : ""}${tw ? `<a href="${esc(tw)}" target="_blank" rel="noopener nofollow" aria-label="X">𝕏</a>` : ""}${web ? `<a href="${esc(web)}" target="_blank" rel="noopener nofollow" aria-label="Website">🌐</a>` : ""}</div>` : ""}
<div class="btns" style="margin-top:14px"><a class="b s" href="/" style="min-height:48px;font-size:15px">✨ New here? Join Whisper+Me free</a></div>`;
    return pageShell({ title: `${p.name} on Whisper+Me`, desc, url, image: `${APP_URL}/s/u/${uid}/card.png?v=${v}`, body });
  }

  async function meetupPage(id, legacyTitle) {
    id = String(id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    const m = id ? await meetupData(id) : null;
    const url = `${APP_URL}/m/${id}`;
    if (!m) {
      return pageShell({ title: "Meet & greets on Whisper+Me", desc: "Meet the people you follow, in person, at real venues.", url, image: `${APP_URL}/s/x/none/card.png`,
        body: `<div class="facts" style="text-align:center">This M&amp;G isn't available anymore.</div><div class="btns"><a class="b p" href="/?dates=1">⭐ See what's coming up</a></div>` });
    }
    const appUrl = `/?dates=1${m.live ? "&meetup=" + encodeURIComponent(id) : ""}`;
    const title = legacyTitle || `${m.title} · with ${m.hostName}`;
    const desc = m.live ? `${whenText(m.startsAt)} at ${m.venueName}${m.city ? ", " + m.city : ""}. ${fmtMoney(m.price)} a spot${m.left <= 10 ? `, ${m.left} left` : ""}. ${(m.items || []).slice(0, 2).join(", ")}.`
      : "This meet & greet has ended. See what's coming up on Whisper+Me.";
    const v = ver(m.title, m.imageUrl, m.price, m.left, m.live, Math.floor(Date.now() / 36e5));
    const body = `<div class="ph" style="aspect-ratio:4/5;background:linear-gradient(135deg,hsl(${m.hue} 60% 32%),hsl(${(m.hue + 40) % 360} 65% 16%) 70%,#0b0b16)">${m.imageUrl || m.hostPhotoUrl ? `<img src="${esc(m.imageUrl || m.hostPhotoUrl)}" alt="">` : ""}<div class="sh"></div>
<div class="pill" style="left:16px;transform:none">${m.official ? "⭐ Whisper+Me pick" : "⭐ M&amp;G · Meet &amp; Greet"}</div>${m.live && m.left <= 10 ? `<div class="tag">${m.left ? m.left + " LEFT" : "SOLD OUT"}</div>` : ""}
<div class="info"><h1 class="nm">${esc(m.title)}</h1></div></div>
<div class="host">${m.official ? `<img src="/icon-192.png" alt="">` : m.hostPhotoUrl ? `<img src="${esc(m.hostPhotoUrl)}" alt="">` : `<div class="av">${esc((m.hostName[0] || "?").toUpperCase())}</div>`}<div><b>${m.official ? "Hosted by Whisper+Me" : "with " + esc(m.hostName)}</b><small>${m.rating && m.rating.n ? `⭐ ${Number(m.rating.avg).toFixed(1)} from ${m.rating.n} guest${m.rating.n === 1 ? "" : "s"}` : "Meet &amp; Greet"}</small></div></div>
<div class="facts"><div>📅 ${esc(whenText(m.startsAt))}</div><div>📍 ${esc(m.venueName)}${m.city ? ", " + esc(m.city) : ""} <span style="color:#8f89a8">(exact address after you get a spot)</span></div>
<div><b style="font-size:20px">${fmtMoney(m.price)}</b> per person${m.live ? ` · ${m.left} spot${m.left === 1 ? "" : "s"} left` : ""}</div>${(m.items || []).length ? `<div>✓ ${m.items.slice(0, 4).map(esc).join(" · ✓ ")}</div>` : ""}${m.idCheck ? `<div style="color:#f7b955">🪪 21+, bring a photo ID</div>` : ""}</div>
<div class="btns">${m.live && m.left ? `<a class="b p" href="${esc(appUrl)}">🎟️ Get my spot · ${fmtMoney(m.price)}</a>` : `<a class="b p" href="/?dates=1">⭐ See what's coming up</a>`}
${m.hostUid ? `<a class="b s" href="/u/${esc(m.hostUid)}">👤 About ${esc(clip(m.hostName, 20))}</a>` : ""}
<button class="b s" data-share>↗ Bring a friend</button></div>`;
    return pageShell({ title, desc, url, image: `${APP_URL}/s/m/${id}/card.png?v=${v}`, body });
  }

  return { shareImage, profilePage, meetupPage, profileCard, meetupCard, profileData, meetupData, plainCard };
};
