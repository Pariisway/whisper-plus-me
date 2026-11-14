#!/usr/bin/env node
/* Link previews for the site's fixed pages (home, rooms, meet, help, partner, link-in-bio).
   Facebook, iMessage, WhatsApp… read the preview straight out of each page's HTML, so it has
   to be written into the file. You edit the words in Admin → 🔗 Share; deploy.sh runs this
   before every upload and copies what you saved into the pages.
   - Nothing saved for a page (or you cleared it) → the page keeps / gets back its built-in preview.
   - No internet or any problem → pages are left exactly as they are. It never stops a deploy.
   Test without the network:  node tools/apply-share.js --from file.json [--root dir]            */
const fs = require("fs"), path = require("path"), https = require("https");
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : ""; };
const ROOT = arg("--root") || path.join(__dirname, "..", "public");
const URL_ = "https://whisperplusme-46d9c-default-rtdb.firebaseio.com/landing/share/pages.json";
const PAGES = { home: "index.html", rooms: "rooms/index.html", meet: "meet/index.html", help: "help/index.html", partner: "partner/index.html", bio: "linkinbio.html" };
const TAGS = { title: ["og:title", "twitter:title"], desc: ["og:description", "twitter:description"], image: ["og:image", "twitter:image"] };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

/* One <meta … content="…">. `value` set → write it and remember the built-in text in data-d.
   `value` empty → put the built-in text back. */
function setTag(html, key, value) {
  const re = new RegExp(`(<meta\\s+(?:property|name)="${key}"\\s+content=")([^"]*)(")(\\s+data-d="([^"]*)")?`);
  return html.replace(re, (m, a, cur, z, _d, orig) => {
    const base = orig !== undefined ? orig : cur;
    return value ? `${a}${esc(value)}${z} data-d="${base}"` : `${a}${base}${z}`;
  });
}
/* A custom picture has its own size and type, so the size hints are parked while it's in use. */
function sizeHints(html, custom) {
  if (custom) return html.replace(/^([ \t]*)(<meta property="og:image:(?:type|width|height)"[^>]*>)[ \t]*$/gm, "$1<!--ogsize $2-->");
  return html.replace(/<!--ogsize (<meta[^>]*>)-->/g, "$1");
}
function apply(cfg) {
  let changed = 0;
  for (const key of Object.keys(PAGES)) {
    const file = path.join(ROOT, PAGES[key]);
    if (!fs.existsSync(file)) continue;
    const c = (cfg && cfg[key]) || {}, before = fs.readFileSync(file, "utf8");
    const v = { title: clean(c.title, 90), desc: clean(c.desc, 200), image: /^https:\/\/[^\s"<>]+$/.test(c.image || "") ? c.image : "" };
    let html = before;
    for (const f of Object.keys(TAGS)) for (const t of TAGS[f]) html = setTag(html, t, v[f]);
    html = setTag(html, "og:image:alt", v.image ? (v.title || "Whisper+Me") : "");
    html = setTag(html, "twitter:image:alt", v.image ? (v.title || "Whisper+Me") : "");
    html = sizeHints(html, !!v.image);
    if (html !== before) { fs.writeFileSync(file, html); changed++; }
  }
  console.log(`  link previews: ${changed ? changed + " page" + (changed === 1 ? "" : "s") + " updated" : "up to date"}`);
}
function fetchJson(url) {
  return new Promise((ok, no) => {
    const r = https.get(url, { timeout: 8000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return no(new Error("HTTP " + res.statusCode)); }
      let d = ""; res.setEncoding("utf8"); res.on("data", x => { d += x; if (d.length > 200000) r.destroy(new Error("too big")); });
      res.on("end", () => { try { ok(JSON.parse(d)); } catch (e) { no(e); } });
    });
    r.on("timeout", () => r.destroy(new Error("timed out"))); r.on("error", no);
  });
}
(async () => {
  try {
    const from = arg("--from");
    apply(from ? JSON.parse(fs.readFileSync(from, "utf8")) : await fetchJson(URL_));
  } catch (e) {
    console.log("  link previews: skipped (" + e.message + "). Pages keep the previews they have.");
  }
})();
