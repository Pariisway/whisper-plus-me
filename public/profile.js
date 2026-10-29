/* ═══════════════════════════════════════════════════════════════
   WHISPER+ME PROFILE — the 👤 Profile screen and the member card
   Tabs: Profile · Wallet · Calls · More
   Uses app.js globals: currentUser, active, sanitize, jsAttr, safeUrl,
   showToast, isGuest, setActive, shareProfile, buyCoins, connectStripe…
═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var ADMIN_UID = "v6aIXY12MDY9ci1wWJmCiLOAKoG2";
  var tab = "profile";
  var dirty = false;
  var uploading = false;

  function me() { return window.me || {}; }
  function myUid() { return (typeof currentUser !== "undefined" && currentUser) ? currentUser.uid : ""; }
  function esc(s) { return sanitize(s); }
  function money(n) { return "$" + Number(n || 0).toFixed(2).replace(/\.00$/, ""); }
  function initial(name) { return esc(String(name || "?").trim().charAt(0).toUpperCase() || "?"); }
  function pushState() {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission; // granted | denied | default
  }

  /* ---------- styles ---------- */
  var css = "\
.pf{max-width:680px;margin:0 auto;padding:4px 0 28px;color:#f2eefc;text-align:left}\
.pf *{box-sizing:border-box}\
.pf-hero{display:flex;align-items:center;gap:14px;padding:6px 2px 14px}\
.pf-avatar{position:relative;flex:none;width:76px;height:76px;border-radius:50%;cursor:pointer;display:block;background:linear-gradient(135deg,#7b2ff7,#00e3ae);padding:3px}\
.pf-avatar img,.pf-avatar .pf-init{width:100%;height:100%;border-radius:50%;object-fit:cover;display:flex;align-items:center;justify-content:center;background:#151325;font-size:30px;font-weight:800;color:#fff}\
.pf-avatar .pf-cam{position:absolute;right:-2px;bottom:-2px;width:28px;height:28px;border-radius:50%;background:#fff;color:#111;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,.4)}\
.pf-avatar.busy::after{content:'';position:absolute;inset:3px;border-radius:50%;background:rgba(0,0,0,.55) url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 50 50'%3E%3Ccircle cx='25' cy='25' r='18' fill='none' stroke='%23fff' stroke-width='4' stroke-dasharray='80 40'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 25 25' to='360 25 25' dur='.9s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/svg%3E\") center/34px no-repeat}\
.pf-hero-txt{flex:1;min-width:0}\
.pf-hero-name{font-size:22px;font-weight:800;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.pf-hero-sub{font-size:13px;color:#a9a3c2;margin-top:4px}\
.pf-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#00e3ae;margin-right:6px;vertical-align:1px}\
.pf-dot.off{background:#6b6585}\
.pf-ghost{flex:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:999px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;min-height:40px}\
.pf-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}\
.pf-stat{background:#13111f;border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:12px 10px;text-align:center;cursor:pointer;color:inherit;font:inherit}\
.pf-stat b{display:block;font-size:20px;font-weight:800;color:#fff}\
.pf-stat span{font-size:12px;color:#8f89a8}\
.pf-setup{background:linear-gradient(135deg,rgba(123,47,247,.22),rgba(0,227,174,.10));border:1px solid rgba(123,47,247,.35);border-radius:18px;padding:14px 16px;margin-bottom:14px}\
.pf-setup-top{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:800;margin-bottom:8px}\
.pf-bar{height:8px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}\
.pf-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#7b2ff7,#00e3ae)}\
.pf-next{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;font-size:13.5px;color:#dcd6f2}\
.pf-next button{flex:none;background:#fff;color:#111;border:0;border-radius:999px;padding:8px 14px;font-weight:800;font-size:13px;cursor:pointer}\
.pf-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;background:#13111f;border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:4px;margin-bottom:16px;position:sticky;top:0;z-index:2}\
.pf-tab{background:none;margin:0;border:0;color:#9d97b8;font-weight:700;font-size:13px;padding:10px 4px;border-radius:12px;cursor:pointer;min-height:42px}\
.pf-tab.on{background:linear-gradient(90deg,#7b2ff7,#5a39d6);color:#fff}\
.pf-field{display:block;margin-bottom:14px}\
.pf-field>span{display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:#c9c3e0;margin-bottom:6px}\
.pf-field em{font-style:normal;font-weight:500;color:#6f6a88}\
.pf input,.pf textarea{width:100%;background:#0f0d1a;border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:14px;padding:13px 14px;font-size:16px;font-family:inherit;outline:0;margin:0}\
.pf textarea{resize:vertical;min-height:84px;line-height:1.45}\
.pf input:focus,.pf textarea:focus{border-color:#00e3ae}\
.pf details{background:#13111f;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:4px 14px;margin-bottom:14px}\
.pf summary{cursor:pointer;font-weight:700;font-size:14px;padding:10px 0;color:#d8d2ee}\
.pf details .pf-field{margin-bottom:10px}\
.pf-primary{width:100%;border:0;border-radius:999px;min-height:52px;font-size:16px;font-weight:800;color:#fff;background:linear-gradient(90deg,#7b2ff7,#00e3ae);cursor:pointer;margin:0}\
.pf-primary[disabled]{opacity:.5}\
.pf-row{display:flex;gap:10px;margin-top:12px}\
.pf-row>*{flex:1}\
.pf-btn{background:#1a1729;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:999px;min-height:46px;padding:0 14px;font-weight:700;font-size:14px;cursor:pointer;margin:0;width:auto}\
.pf-card{background:#13111f;border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:16px;margin-bottom:14px}\
.pf-big{font-size:34px;font-weight:900;letter-spacing:-.02em}\
.pf-muted{font-size:13px;color:#8f89a8;line-height:1.5}\
.pf-label{font-size:13px;font-weight:800;color:#c9c3e0;margin:4px 0 8px;text-transform:uppercase;letter-spacing:.06em}\
.pf-chips{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}\
.pf-chip{background:#1a1729;border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:14px;padding:12px 6px;cursor:pointer;font:inherit;text-align:center;margin:0;width:auto}\
.pf-chip b{display:block;font-size:17px}\
.pf-chip span{font-size:12px;color:#8f89a8}\
.pf-chip.on{border-color:#00e3ae;background:rgba(0,227,174,.12)}\
.pf-custom{display:flex;gap:8px}\
.pf-custom input{flex:1}\
.pf-custom button{flex:none}\
.pf-progress{height:10px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;margin:10px 0 6px}\
.pf-progress i{display:block;height:100%;background:#00e3ae}\
.pf-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px}\
.pf-toggle b{font-size:15px}\
.pf-switch{flex:none;width:56px;height:32px;min-height:0;border-radius:99px;border:0;background:#3a3550;position:relative;cursor:pointer;padding:0;margin:0}\
.pf-switch::after{content:'';position:absolute;top:4px;left:4px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .2s}\
.pf-switch.on{background:#00c896}\
.pf-switch.on::after{left:28px}\
.pf-prices{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:8px}\
.pf-list{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}\
.pf-list button{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:#13111f;border:1px solid rgba(255,255,255,.07);color:#fff;border-radius:14px;padding:14px 16px;font-size:15px;font-weight:700;cursor:pointer;margin:0}\
.pf-list button::after{content:'›';margin-left:auto;color:#6f6a88;font-size:20px}\
.pf-danger{background:none;border:0;color:#b26a6a;font-size:13px;text-decoration:underline;cursor:pointer;display:block;margin:16px auto 0;width:auto}\
.pf-phone{position:relative;width:100%;height:100%;border-radius:inherit;overflow:hidden;cursor:pointer;background:linear-gradient(160deg,#2a1260,#0b0b16 60%,#003b2e)}\
.pf-phone-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}\
.pf-phone-init{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:120px;font-weight:900;color:rgba(255,255,255,.12)}\
.pf-phone-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35) 0%,rgba(0,0,0,0) 30%,rgba(0,0,0,.85) 100%)}\
.pf-phone-top{position:absolute;top:14px;left:0;right:0;text-align:center}\
.pf-phone-top span{display:inline-block;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;color:#fff;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}\
.pf-phone-info{position:absolute;left:16px;right:16px;bottom:18px;color:#fff}\
.pf-phone-name{font-size:24px;font-weight:900}\
.pf-phone-bio{font-size:13px;color:rgba(255,255,255,.85);margin:4px 0 8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\
.pf-phone-stats{display:flex;gap:6px;flex-wrap:wrap}\
.pf-phone-stats span{background:rgba(255,255,255,.14);border-radius:999px;padding:5px 10px;font-size:12px}\
.pm{position:relative;text-align:center;padding:0 0 20px;overflow:hidden;border-radius:inherit}\
.pm-cover{height:110px;background:linear-gradient(135deg,#7b2ff7,#00e3ae) center/cover}\
.pm-cover.ph{filter:blur(18px) brightness(.7);transform:scale(1.3)}\
.pm-close{position:absolute;top:10px;right:10px;z-index:2;width:36px;height:36px;border-radius:50%;border:0;background:rgba(0,0,0,.5);color:#fff;font-size:18px;cursor:pointer;padding:0;min-height:0}\
.pm-ava{width:104px;height:104px;border-radius:50%;object-fit:cover;border:4px solid #12101d;margin:-56px auto 8px;display:flex;align-items:center;justify-content:center;background:#221d38;font-size:40px;font-weight:900;color:#fff;position:relative}\
.pm-name{font-size:22px;font-weight:900;color:#fff;padding:0 16px}\
.pm-on{display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;font-weight:700;color:#00e3ae}\
.pm-bio{font-size:14px;color:#cfc9e6;line-height:1.5;margin:10px 20px 0}\
.pm-meta{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin:12px 16px 0}\
.pm-meta span{background:#1a1729;border-radius:999px;padding:6px 12px;font-size:12.5px;color:#d8d2ee}\
.pm-links{display:flex;justify-content:center;gap:8px;margin:12px 0 0}\
.pm-links a{width:40px;height:40px;border-radius:50%;background:#1a1729;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:18px}\
.pm-actions{display:flex;flex-direction:column;gap:8px;padding:16px 18px 0}\
.pm-actions button{width:100%;min-height:50px;border-radius:999px;font-size:15px;font-weight:800;cursor:pointer;border:0;margin:0}\
.pm-call{background:linear-gradient(90deg,#7b2ff7,#00e3ae);color:#fff}\
.pm-date{background:#d6b16b;color:#1a1308}\
.pm-sec{background:#1a1729!important;color:#fff;border:1px solid rgba(255,255,255,.1)!important}\
.pm-warn{background:rgba(229,57,53,.15)!important;color:#ff8a8a}\
.pm-off{font-size:13px;color:#8f89a8;padding:8px 0}\
@media (max-width:420px){.pf-chips{grid-template-columns:repeat(2,1fr)}.pf-tab{font-size:12px}}\
";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---------- setup checklist ---------- */
  function steps() {
    var m = me();
    return [
      { done: !!m.photo, label: "Add a profile photo", why: "Profiles with a photo get far more calls.", go: function () { var i = document.getElementById("photoInput"); if (i) i.click(); } },
      { done: !!(m.name && String(m.name).trim()), label: "Pick your display name", why: "This is how people find you.", go: function () { P.tab("profile", "fi-name"); } },
      { done: !!(m.bio && String(m.bio).trim()), label: "Say something about you", why: "A line or two gets people talking.", go: function () { P.tab("profile", "fi-bio"); } },
      { done: !!m.price, label: "Set your call price", why: "Pick what a call with you costs.", go: function () { P.tab("calls"); } },
      { done: pushState() === "granted" || pushState() === "unsupported", label: "Turn on call alerts", why: "So you never miss a call.", go: function () { P.tab("calls"); } }
    ];
  }

  /* ---------- the phone frame: how others see you ---------- */
  function phoneHTML() {
    var m = me(), uid = myUid();
    var price = m.price || 1;
    return "<div class='pf-phone' onclick=\"showProfileModal(" + jsAttr(uid) + ")\" role='button' aria-label='See how others see your profile'>"
      + (m.photo ? "<img class='pf-phone-bg' src='" + esc(m.photo) + "' alt=''>" : "<div class='pf-phone-init'>" + initial(m.name) + "</div>")
      + "<div class='pf-phone-shade'></div>"
      + "<div class='pf-phone-top'><span>👁 How others see you</span></div>"
      + "<div class='pf-phone-info'>"
      + "<div class='pf-phone-name'>" + esc(m.name || "Your name") + "</div>"
      + "<div class='pf-phone-bio'>" + esc(m.bio || "Add a short bio so people know what you're about.") + "</div>"
      + "<div class='pf-phone-stats'><span>📞 " + price + " coin" + (price > 1 ? "s" : "") + " · $" + price * 3 + "/call</span>"
      + "<span>🪙 <b class='dash-coin-count'>" + (m.coins || 0) + "</b></span><span>💵 " + money(m.earnings) + "</span></div>"
      + "</div></div>";
  }

  /* ---------- panes ---------- */
  function paneProfile() {
    var m = me();
    var hasLinks = !!(m.instagram || m.twitter || m.website);
    var bio = m.bio || "";
    return "<label class='pf-field'><span>Display name</span>"
      + "<input id='fi-name' maxlength='40' autocomplete='nickname' value='" + esc(m.name || "") + "' oninput='Profile.dirty()'></label>"
      + "<label class='pf-field'><span>About you <em id='pf-bio-count'>" + bio.length + "/300</em></span>"
      + "<textarea id='fi-bio' maxlength='300' rows='3' placeholder='What do you love talking about?' oninput=\"Profile.dirty();document.getElementById('pf-bio-count').textContent=this.value.length+'/300'\">" + esc(bio) + "</textarea></label>"
      + "<details" + (hasLinks ? " open" : "") + "><summary>🔗 Links: Instagram, X, website</summary>"
      + "<label class='pf-field'><span>Instagram</span><input id='fi-ig' maxlength='200' placeholder='@username' value='" + esc(m.instagram || "") + "' oninput='Profile.dirty()' autocomplete='off'></label>"
      + "<label class='pf-field'><span>X / Twitter</span><input id='fi-tw' maxlength='200' placeholder='@username or link' value='" + esc(m.twitter || "") + "' oninput='Profile.dirty()' autocomplete='off'></label>"
      + "<label class='pf-field'><span>Website</span><input id='fi-web' maxlength='200' inputmode='url' placeholder='yoursite.com' value='" + esc(m.website || "") + "' oninput='Profile.dirty()' autocomplete='off'></label>"
      + "</details>"
      + "<button class='pf-primary' id='pf-save' onclick='Profile.save()'>Save changes</button>"
      + "<div class='pf-row'><button class='pf-btn' onclick=\"shareProfile(" + jsAttr(myUid()) + ")\">🔗 Share profile</button>"
      + "<button class='pf-btn' onclick=\"showProfileModal(" + jsAttr(myUid()) + ")\">👁 Preview</button></div>";
  }

  function paneWallet() {
    var m = me();
    var earned = Number(m.earnings || 0);
    var pct = Math.min(100, Math.round(earned / 50 * 100));
    var packs = [5, 10, 25, 50];
    return "<div class='pf-card'><div class='pf-big'>🪙 <span class='dash-coin-count'>" + (m.coins || 0) + "</span></div>"
      + "<div class='pf-muted'>Coins pay for calls and paid rooms. Live mic and public rooms are free.</div></div>"
      + "<div class='pf-label'>Add coins · $3 each</div>"
      + "<div class='pf-chips'>" + packs.map(function (n) {
          return "<button class='pf-chip' onclick='buyCoins(" + n + ")'><b>" + n + "</b><span>$" + n * 3 + "</span></button>";
        }).join("") + "</div>"
      + "<div class='pf-custom'><input id='coinQtyInput' type='number' min='1' max='500' value='15' inputmode='numeric' aria-label='Number of coins' oninput='updateCoinTotal(this.value)'>"
      + "<button class='pf-btn' onclick='buyCoinsCustom()'>Buy</button></div>"
      + "<div id='coinTotalLabel' class='pf-muted' style='margin:6px 0 16px'>15 coins = $45.00</div>"
      + "<div class='pf-card'><div class='pf-label' style='margin-top:0'>Your earnings</div>"
      + "<div class='pf-big'>" + money(earned) + "</div>"
      + "<div class='pf-progress'><i style='width:" + pct + "%'></i></div>"
      + "<div class='pf-muted'>" + (earned >= 50 ? (m.stripeAccountId ? "You've reached $50. It's sent to your bank on the next payout." : "You've reached $50. Set up payouts below to get it.") : money(50 - earned) + " to go until your first $50 payout.")
      + " You get <b style='color:#fff'>$2 for every coin</b> people spend calling you or joining your rooms, and <b style='color:#fff'>90% of every M&amp;G spot</b> you sell. Card fees are on us.</div>"
      + (Number(m.paidOut || 0) > 0 ? "<div class='pf-muted' style='margin-top:6px'>Paid to your bank so far: <b style='color:#fff'>" + money(m.paidOut) + "</b></div>" : "")
      + (m.stripeAccountId
          ? "<div class='pf-row'><button class='pf-btn' onclick='openStripeDashboard()'>✅ Payouts on · View Stripe</button></div>"
          : "<div class='pf-row'><button class='pf-primary' onclick='connectStripe()'>Set up payouts</button></div>"
            + "<div class='pf-muted' style='margin-top:8px;text-align:center'>Stripe sends your earnings straight to your bank.</div>")
      + "</div>";
  }

  function paneCalls() {
    var m = me();
    var on = m.callsEnabled !== false;
    var price = m.price || 0;
    var ps = pushState();
    var push;
    if (ps === "granted") push = "<b>🔔 Call alerts are on</b><div class='pf-muted'>Your phone rings even when the app is closed.</div>";
    else if (ps === "denied") push = "<b>🔕 Call alerts are blocked</b><div class='pf-muted'>Allow notifications for whisperplusme.com in your browser or phone settings.</div>";
    else if (ps === "unsupported") push = "<b>🔕 Call alerts</b><div class='pf-muted'>This browser can't do alerts. Add the site to your home screen, or use Chrome.</div>";
    else push = "<b>🔕 Call alerts are off</b><div class='pf-muted'>Turn on so your phone rings when someone calls.</div>";
    return "<div class='pf-card pf-toggle'><div><b>📞 Let people call me</b><div class='pf-muted'>" + (on ? "You're open to calls right now." : "Nobody can call you right now.") + "</div></div>"
      + "<button class='pf-switch" + (on ? " on" : "") + "' role='switch' aria-checked='" + on + "' aria-label='Let people call me' onclick='toggleCallsEnabled()'></button></div>"
      + "<div class='pf-label'>Your price per call</div>"
      + "<div class='pf-prices'>" + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) {
          return "<button class='pf-chip" + (n === price ? " on" : "") + "' onclick='Profile.setPrice(" + n + ")' aria-pressed='" + (n === price) + "'><b>" + n + "🪙</b><span>$" + n * 3 + "</span></button>";
        }).join("") + "</div>"
      + "<div class='pf-muted' style='margin-bottom:16px'>" + (price ? "You earn <b style='color:#fff'>$" + price * 2 + "</b> from every call." : "Tap a price. Starting at 1–2 coins helps new people find you.") + "</div>"
      + "<div class='pf-card pf-toggle'><div>" + push + "</div>"
      + (ps === "default" ? "<button class='pf-btn' style='flex:none' onclick='enableCallNotifications()'>Turn on</button>" : "") + "</div>";
  }

  function paneMore() {
    var uid = myUid();
    return "<div class='pf-list'>"
      + "<button onclick='showHowItWorks()'>❓ How Whisper+Me works</button>"
      + "<button onclick='showInfoModal(\"earn\")'>💰 Earn money &amp; grow your audience</button>"
      + "<button onclick='showInfoModal(\"setup\")'>🪄 Profile tips</button>"
      + "<button onclick='setActive(4)'>⭐ My M&G</button>"
      + "<button onclick=\"showEmbedCode(" + jsAttr(uid) + ",'profile')\">🧩 Put my profile on my website</button>"
      + "</div>"
      + "<div class='pf-card'><div class='pf-label' style='margin-top:0'>Message support</div>"
      + "<label class='pf-field'><input id='contact-subject' maxlength='100' placeholder='Subject' autocomplete='off'></label>"
      + "<label class='pf-field'><textarea id='contact-msg' maxlength='1200' rows='3' placeholder='How can we help?'></textarea></label>"
      + "<button class='pf-btn' style='width:100%' onclick='sendContactEmail()'>📨 Send</button></div>"
      + (uid === ADMIN_UID ? "<a href='/admin.html' class='pf-primary' style='display:flex;align-items:center;justify-content:center;text-decoration:none;margin-bottom:12px'>⚡ Admin dashboard</a>" : "")
      + "<button class='pf-btn' style='width:100%' onclick='firebase.auth().signOut()'>Log out</button>"
      + "<button class='pf-danger' onclick='confirmDeleteOwnAccount()'>Delete my account</button>";
  }

  function panelHTML() {
    var m = me(), uid = myUid();
    var s = steps(), done = s.filter(function (x) { return x.done; }).length, next = s.filter(function (x) { return !x.done; })[0];
    var on = m.callsEnabled !== false;
    var tabs = [["profile", "✏️ Profile"], ["wallet", "🪙 Wallet"], ["calls", "📞 Calls"], ["more", "⋯ More"]];
    var pane = tab === "wallet" ? paneWallet() : tab === "calls" ? paneCalls() : tab === "more" ? paneMore() : paneProfile();
    return "<div class='pf' id='pf'>"
      + "<input type='file' id='photoInput' accept='image/*' hidden onchange='Profile.pickPhoto(this)'>"
      + "<div class='pf-hero'>"
      + "<label class='pf-avatar' id='pf-avatar' for='photoInput' title='Change photo'>"
      + (m.photo ? "<img src='" + esc(m.photo) + "' alt='Your photo'>" : "<span class='pf-init'>" + initial(m.name) + "</span>")
      + "<span class='pf-cam' aria-hidden='true'>📷</span></label>"
      + "<div class='pf-hero-txt'><div class='pf-hero-name'>" + esc(m.name || "Your profile") + "</div>"
      + "<div class='pf-hero-sub'><span class='pf-dot" + (on ? "" : " off") + "'></span>" + (on ? "Open to calls" : "Calls off") + " · " + (m.price || 1) + "🪙 per call</div></div>"
      + "<button class='pf-ghost' onclick=\"showProfileModal(" + jsAttr(uid) + ")\">👁 Preview</button></div>"
      + "<div class='pf-stats'>"
      + "<button class='pf-stat' onclick=\"Profile.tab('wallet')\"><b class='dash-coin-count'>" + (m.coins || 0) + "</b><span>Coins</span></button>"
      + "<button class='pf-stat' onclick=\"Profile.tab('wallet')\"><b>" + money(m.earnings) + "</b><span>Earned</span></button>"
      + "<button class='pf-stat' onclick=\"Profile.tab('calls')\"><b>" + (m.calls || 0) + "</b><span>Calls</span></button></div>"
      + (next ? "<div class='pf-setup'><div class='pf-setup-top'><span>🚀 Finish your profile</span><span>" + done + " of " + s.length + "</span></div>"
          + "<div class='pf-bar'><i style='width:" + Math.round(done / s.length * 100) + "%'></i></div>"
          + "<div class='pf-next'><span><b>Next:</b> " + next.label + ". " + next.why + "</span><button onclick='Profile.next()'>Do it</button></div></div>" : "")
      + "<div class='pf-tabs' role='tablist'>" + tabs.map(function (t) {
          return "<button class='pf-tab" + (tab === t[0] ? " on" : "") + "' role='tab' aria-selected='" + (tab === t[0]) + "' onclick=\"Profile.tab('" + t[0] + "')\">" + t[1] + "</button>";
        }).join("") + "</div>"
      + "<div class='pf-pane' role='tabpanel'>" + pane + "</div>"
      + "</div>";
  }

  /* ---------- actions ---------- */
  function rerenderPanel(focusId) {
    if (typeof active === "undefined" || active !== 3) return;
    var c = document.querySelector("#app .content");
    if (c) c.innerHTML = panelHTML(); else if (window.render) render();
    var ph = document.getElementById("phone-screen-3");
    if (ph) ph.innerHTML = phoneHTML();
    if (focusId) { var el = document.getElementById(focusId); if (el) { el.focus(); if (el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" }); } }
  }

  function shrinkImage(file, max, quality) {
    max = max || 720; quality = quality || 0.85;
    return new Promise(function (resolve) {
      if (!file || !/^image\//.test(file.type) || /gif$/.test(file.type) || !window.URL || !URL.createObjectURL) return resolve(file);
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
          if (k === 1 && file.size < 400 * 1024) { URL.revokeObjectURL(url); return resolve(file); }
          var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob(function (b) { resolve(b && b.size < file.size ? b : file); }, "image/jpeg", quality);
        } catch (e) { resolve(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  window.shrinkImage = shrinkImage;

  var P = {
    phoneHTML: phoneHTML,
    panelHTML: panelHTML,
    tab: function (t, focusId) { tab = t; dirty = false; rerenderPanel(focusId); },
    dirty: function () { dirty = true; },
    next: function () { var n = steps().filter(function (x) { return !x.done; })[0]; if (n) n.go(); },
    refresh: function () {
      if (typeof active === "undefined" || active !== 3) return;
      var ph = document.getElementById("phone-screen-3");
      if (ph && !window.__liveCallHTML) ph.innerHTML = phoneHTML();
      var ae = document.activeElement;
      var typing = ae && ae.closest && ae.closest("#pf") && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
      if (dirty || typing || uploading) {
        document.querySelectorAll(".dash-coin-count").forEach(function (el) { el.textContent = me().coins || 0; });
        return;
      }
      var y = window.scrollY;
      var c = document.querySelector("#app .content");
      if (c) { c.innerHTML = panelHTML(); window.scrollTo(0, y); }
    },
    save: function () {
      var user = firebase.auth().currentUser;
      if (!user) return;
      var g = function (id) { return ((document.getElementById(id) || {}).value || "").trim(); };
      var name = g("fi-name");
      if (!name) { showToast("Add a display name", "warn"); P.tab("profile", "fi-name"); return; }
      var updates = { name: name.slice(0, 40), bio: g("fi-bio").slice(0, 300) };
      ["instagram:fi-ig", "twitter:fi-tw", "website:fi-web"].forEach(function (pair) {
        var k = pair.split(":")[0], v = g(pair.split(":")[1]).slice(0, 200);
        updates[k] = v || null;
      });
      var btn = document.getElementById("pf-save"); if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
      firebase.database().ref("users/" + user.uid).update(updates)
        .then(function () { dirty = false; showToast("Saved ✓", "success"); rerenderPanel(); })
        .catch(function (e) { showToast("Couldn't save: " + e.message, "error"); if (btn) { btn.disabled = false; btn.textContent = "Save changes"; } });
    },
    pickPhoto: function (input) {
      var f = input && input.files && input.files[0];
      var user = firebase.auth().currentUser;
      if (!f || !user) return;
      if (!/^image\//.test(f.type)) { showToast("Pick a photo file", "warn"); return; }
      var av = document.getElementById("pf-avatar"); if (av) av.classList.add("busy");
      uploading = true;
      shrinkImage(f, 720).then(function (blob) {
        if (blob.size > 3 * 1024 * 1024) throw new Error("Photo must be under 3 MB");
        return firebase.storage().ref("profilePhotos/" + user.uid).put(blob, { contentType: blob.type || "image/jpeg", cacheControl: "public,max-age=604800" });
      }).then(function (s) { return s.ref.getDownloadURL(); })
        .then(function (url) { return firebase.database().ref("users/" + user.uid).update({ photo: url }); })
        .then(function () { uploading = false; showToast("Photo updated ✓", "success"); rerenderPanel(); })
        .catch(function (e) { uploading = false; if (av) av.classList.remove("busy"); showToast("Photo upload failed: " + e.message, "error"); });
      input.value = "";
    },
    setPrice: function (n) {
      var user = firebase.auth().currentUser; if (!user) return;
      firebase.database().ref("users/" + user.uid).update({ price: n })
        .then(function () { showToast("Price set to " + n + " coin" + (n > 1 ? "s" : "") + " ($" + n * 3 + ") ✓", "success"); rerenderPanel(); })
        .catch(function (e) { showToast("Couldn't update: " + e.message, "error"); });
    },

    /* ---------- the member card (tap anyone's name or photo) ---------- */
    showMember: function (uid) {
      var u = (window.allUsers || {})[uid];
      if (uid === myUid()) u = Object.assign({}, u || {}, me());
      if (!u) {
        firebase.database().ref("users/" + uid).once("value").then(function (s) {
          if (!s.exists()) { showToast("That profile isn't available", "warn"); return; }
          window.allUsers = window.allUsers || {};
          window.allUsers[uid] = s.val();
          P.showMember(uid);
        }).catch(function () { showToast("Couldn't open that profile", "error"); });
        return;
      }
      var modal = document.getElementById("profileModal"), body = document.getElementById("profileModalBody");
      if (!modal || !body) return;
      var isMe = uid === myUid();
      var price = u.price || 1;
      var callsOn = u.callsEnabled !== false;
      var links = "";
      var ig = u.instagram ? (/^https?:/i.test(u.instagram) ? safeUrl(u.instagram) : safeUrl("instagram.com/" + String(u.instagram).replace(/^@/, ""))) : "";
      var tw = u.twitter ? (/^https?:/i.test(u.twitter) || /\./.test(u.twitter) ? safeUrl(u.twitter) : safeUrl("x.com/" + String(u.twitter).replace(/^@/, ""))) : "";
      var web = u.website ? safeUrl(u.website) : "";
      if (ig) links += "<a href='" + esc(ig) + "' target='_blank' rel='noopener noreferrer nofollow' aria-label='Instagram'>📸</a>";
      if (tw) links += "<a href='" + esc(tw) + "' target='_blank' rel='noopener noreferrer nofollow' aria-label='X'>𝕏</a>";
      if (web) links += "<a href='" + esc(web) + "' target='_blank' rel='noopener noreferrer nofollow' aria-label='Website'>🌐</a>";
      var guest = typeof isGuest === "function" && isGuest();
      var mod = typeof isModeratorOfActiveRoom !== "undefined" && isModeratorOfActiveRoom;
      var actions = "";
      if (isMe) {
        actions = "<button class='pm-call' onclick='closeProfileModal();setActive(3)'>✏️ Edit my profile</button>"
          + "<button class='pm-sec' onclick=\"shareProfile(" + jsAttr(uid) + ")\">🔗 Share my profile</button>";
      } else {
        actions = (callsOn
            ? "<button class='pm-call call-card-btn' data-uid='" + esc(uid) + "' onclick='closeProfileModal();startCallFromBtn(this)'>📞 Call · " + price + "🪙 ($" + price * 3 + ")</button>"
            : "<div class='pm-off'>📵 Not taking calls right now</div>")
          + (window.Dates && window.Dates.askOut ? "<button class='pm-date' onclick=\"Profile.askOut(" + jsAttr(uid) + ")\">⭐ Invite to an M&G</button>" : "")
          + "<button class='pm-sec' onclick=\"shareProfile(" + jsAttr(uid) + ")\">🔗 Share</button>"
          + (mod ? "<button class='pm-warn' onclick=\"removeUserFromRoom(" + jsAttr(uid) + "," + jsAttr(u.name || "this user") + ")\">🚫 Remove from this room</button>" : "");
        if (guest) actions = "<button class='pm-call' onclick=\"promptGuestUpgrade('Calling members')\">📞 Sign up free to call</button>" + "<button class='pm-sec' onclick=\"shareProfile(" + jsAttr(uid) + ")\">🔗 Share</button>";
      }
      body.innerHTML = "<div class='pm'>"
        + "<button class='pm-close' onclick='closeProfileModal()' aria-label='Close'>✕</button>"
        + "<div class='pm-cover" + (u.photo ? " ph" : "") + "'" + (u.photo ? " style=\"background-image:url('" + esc(u.photo) + "')\"" : "") + "></div>"
        + (u.photo ? "<img class='pm-ava' src='" + esc(u.photo) + "' alt=''>" : "<div class='pm-ava'>" + initial(u.name) + "</div>")
        + "<div class='pm-name'>" + esc(u.name || "Member") + "</div>"
        + (u.online ? "<div class='pm-on'><span class='pf-dot'></span>Online now</div>" : "")
        + (u.bio ? "<div class='pm-bio'>" + esc(u.bio) + "</div>" : "")
        + "<div class='pm-meta'><span>📞 " + (u.calls || 0) + " call" + ((u.calls || 0) === 1 ? "" : "s") + "</span><span>🪙 " + price + " per call</span></div>"
        + (links ? "<div class='pm-links'>" + links + "</div>" : "")
        + "<div class='pm-actions'>" + actions + "</div>"
        + "</div>";
      modal.style.display = "flex";
    },
    askOut: function (uid) {
      closeProfileModal();
      if (typeof isGuest === "function" && isGuest()) { promptGuestUpgrade("Inviting someone to an M&G"); return; }
      if (window.Dates && window.Dates.askOut) window.Dates.askOut(uid);
    }
  };

  window.Profile = P;
  window.showProfileModal = function (uid) { if (uid) P.showMember(uid); };
})();
/* If the app already drew the Profile screen before this file loaded, draw it again. */
if (typeof active !== "undefined" && active === 3 && typeof currentUser !== "undefined" && currentUser && window.render) render();
