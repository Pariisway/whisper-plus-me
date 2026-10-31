#!/usr/bin/env node
/* Adds a fingerprint (?v=…) to the site's own scripts and stylesheet in public/index.html,
   based on each file's contents. Browsers can then keep those files for a year (see
   firebase.json) and still get a fresh copy the moment a file changes.
   deploy.sh runs this before every deploy, so you never have to. */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const PUB = path.join(__dirname, "..", "public");
const FILES = ["app.js", "dates.js", "profile.js", "landing.js", "install.js", "style.css"];
const page = path.join(PUB, "index.html");
let html = fs.readFileSync(page, "utf8"), changed = 0;
for (const f of FILES) {
  const v = crypto.createHash("sha1").update(fs.readFileSync(path.join(PUB, f))).digest("hex").slice(0, 10);
  const re = new RegExp(`((?:src|href)=")${f.replace(".", "\\.")}(?:\\?v=[0-9a-f]+)?(")`, "g");
  const next = html.replace(re, `$1${f}?v=${v}$2`);
  if (!re.test(html)) { console.error(`stamp-assets: ${f} isn't referenced in index.html`); process.exit(1); }
  if (next !== html) { changed++; html = next; }
}
fs.writeFileSync(page, html);
console.log(`  fingerprints: ${changed ? changed + " updated" : "up to date"}`);
