"use strict";
/* ═══════════════════════════════════════════
   SPIRITS.JS — WhisperPlusMe Spirit Platform
   Auth → Profile → Feed → AI Path
═══════════════════════════════════════════ */

const GEMINI_API_KEY = ""; /* Set this from your .env via a Cloud Function — never hardcode here */
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const SP_DB   = firebase.database();
const SP_AUTH = firebase.auth();
const SP_STORAGE = firebase.storage();

let spUser     = null;   /* Firebase auth user */
let spProfile  = null;   /* Spirit profile from DB */
let spTab      = 0;      /* 0=Profile, 1=Feed, 2=My Path */

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
SP_AUTH.onAuthStateChanged(async function(user){
  if(!user){
    renderAuthPage();
    return;
  }
  spUser = user;
  /* Load spirit profile */
  const snap = await SP_DB.ref("spirits/" + user.uid).once("value");
  spProfile = snap.val();
  if(!spProfile){
    /* No spirit profile yet — show access code gate */
    renderCodeGate();
  } else {
    renderApp();
  }
});

/* ═══════════════════════════════════════════
   RENDER HELPERS
═══════════════════════════════════════════ */
function app(){ return document.getElementById("sp-app"); }

function spToast(msg, type="", duration=3000){
  var t = document.getElementById("sp-toast");
  if(!t){
    t = document.createElement("div");
    t.id = "sp-toast";
    t.className = "sp-toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = "sp-toast show " + type;
  clearTimeout(t.__timer);
  t.__timer = setTimeout(function(){ t.className = "sp-toast"; }, duration);
}

/* ═══════════════════════════════════════════
   AUTH PAGE — Email/Password Login + Signup
═══════════════════════════════════════════ */
function renderAuthPage(){
  app().innerHTML = `
    <div class="sp-auth-wrap">
      <div class="sp-auth-logo">
        <h1>Whisper<span>+</span>Me <span style="color:#f0c040;font-size:20px;">Spirits</span></h1>
        <p>A safe space to heal, grow, and move forward.</p>
      </div>
      <div class="sp-auth-card">
        <h2>Welcome back</h2>
        <p>Sign in with your organization credentials.</p>
        <div class="sp-auth-error" id="sp-auth-error"></div>
        <input class="sp-input" id="sp-email" type="email" placeholder="Email address" autocomplete="email" inputmode="email">
        <input class="sp-input" id="sp-pass" type="password" placeholder="Password" autocomplete="current-password">
        <button class="sp-btn" id="sp-login-btn" onclick="spLogin()">Sign In</button>
        <button class="sp-btn-outline" onclick="spShowSignup()">New here? Create account</button>
        <div class="sp-back-link" style="margin-top:24px;">
          <a href="/">← Back to Whisper+Me</a>
        </div>
      </div>
    </div>`;
}

window.spLogin = async function(){
  var email = document.getElementById("sp-email").value.trim();
  var pass  = document.getElementById("sp-pass").value;
  var err   = document.getElementById("sp-auth-error");
  var btn   = document.getElementById("sp-login-btn");
  if(!email || !pass){ showErr(err,"Please fill in all fields."); return; }
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    await SP_AUTH.signInWithEmailAndPassword(email, pass);
  } catch(e){
    showErr(err, friendlyAuthError(e.code));
    btn.disabled = false; btn.textContent = "Sign In";
  }
};

window.spShowSignup = function(){
  app().innerHTML = `
    <div class="sp-auth-wrap">
      <div class="sp-auth-logo">
        <h1>Whisper<span>+</span>Me <span style="color:#f0c040;font-size:20px;">Spirits</span></h1>
        <p>Create your account to get started.</p>
      </div>
      <div class="sp-auth-card">
        <h2>Create your account</h2>
        <p>You will need your organization access code after signing up.</p>
        <div class="sp-auth-error" id="sp-auth-error"></div>
        <input class="sp-input" id="sp-email" type="email" placeholder="Email address" autocomplete="email">
        <input class="sp-input" id="sp-pass" type="password" placeholder="Create a password">
        <input class="sp-input" id="sp-fname" type="text" placeholder="First name">
        <input class="sp-input" id="sp-lname" type="text" placeholder="Last name">
        <button class="sp-btn" id="sp-signup-btn" onclick="spSignup()">Create Account</button>
        <button class="sp-btn-outline" onclick="renderAuthPage()">Already have an account? Sign in</button>
      </div>
    </div>`;
};

window.spSignup = async function(){
  var email = document.getElementById("sp-email").value.trim();
  var pass  = document.getElementById("sp-pass").value;
  var fname = (document.getElementById("sp-fname").value||"").trim();
  var lname = (document.getElementById("sp-lname").value||"").trim();
  var err   = document.getElementById("sp-auth-error");
  var btn   = document.getElementById("sp-signup-btn");
  if(!email||!pass||!fname||!lname){ showErr(err,"Please fill in all fields."); return; }
  if(pass.length < 6){ showErr(err,"Password must be at least 6 characters."); return; }
  btn.disabled = true; btn.textContent = "Creating account…";
  try {
    await SP_AUTH.createUserWithEmailAndPassword(email, pass);
    /* Store name for code gate prefill */
    await SP_DB.ref("spiritPending/" + SP_AUTH.currentUser.uid).set({
      firstName: fname, lastName: lname, email: email, createdAt: firebase.database.ServerValue.TIMESTAMP
    });
  } catch(e){
    showErr(err, friendlyAuthError(e.code));
    btn.disabled = false; btn.textContent = "Create Account";
  }
};

/* ═══════════════════════════════════════════
   ACCESS CODE GATE
═══════════════════════════════════════════ */
function renderCodeGate(){
  app().innerHTML = `
    <div class="sp-auth-wrap">
      <div class="sp-auth-logo">
        <h1>Whisper<span>+</span>Me <span style="color:#f0c040;font-size:20px;">Spirits</span></h1>
        <p>One last step — enter your access code.</p>
      </div>
      <div class="sp-auth-card">
        <h2>Enter your access code</h2>
        <p>Your organization gave you a unique code. Enter it below to unlock your profile.</p>
        <div class="sp-auth-error" id="sp-code-error"></div>
        <input class="sp-input" id="sp-access-code" type="text" placeholder="e.g. Organization-2027-042" autocomplete="off" style="text-transform:uppercase;letter-spacing:2px;text-align:center;font-size:18px;">
        <button class="sp-btn" id="sp-code-btn" onclick="spRedeemCode()">Unlock My Profile</button>
        <button class="sp-btn-outline" onclick="SP_AUTH.signOut()">Sign out</button>
      </div>
    </div>`;
  var inp = document.getElementById("sp-access-code");
  if(inp) inp.addEventListener("input", function(){ this.value = this.value.toUpperCase(); });
}

window.spRedeemCode = async function(){
  var code = (document.getElementById("sp-access-code").value||"").trim().toUpperCase();
  var err  = document.getElementById("sp-code-error");
  var btn  = document.getElementById("sp-code-btn");
  if(!code){ showErr(err,"Please enter your access code."); return; }
  btn.disabled = true; btn.textContent = "Verifying…";

  try {
    /* Check code exists, unused, not expired, matches this user's name */
    var uid = spUser.uid;
    var codeSnap = await SP_DB.ref("orgCodes/" + code).once("value");
    var codeData = codeSnap.val();

    if(!codeData){
      showErr(err,"Code not found. Please check with your organization."); btn.disabled=false; btn.textContent="Unlock My Profile"; return;
    }
    if(codeData.used){
      showErr(err,"This code has already been used."); btn.disabled=false; btn.textContent="Unlock My Profile"; return;
    }
    if(codeData.expiresAt && Date.now() > codeData.expiresAt){
      showErr(err,"This code has expired. Please contact your organization."); btn.disabled=false; btn.textContent="Unlock My Profile"; return;
    }
    if(codeData.claimedFor && codeData.claimedFor !== uid){
      showErr(err,"This code was issued to a different account."); btn.disabled=false; btn.textContent="Unlock My Profile"; return;
    }

    /* Mark code as used */
    await SP_DB.ref("orgCodes/" + code).update({ used: true, usedBy: uid, usedAt: firebase.database.ServerValue.TIMESTAMP });

    /* Get pending info (name from signup) */
    var pendSnap = await SP_DB.ref("spiritPending/" + uid).once("value");
    var pend = pendSnap.val() || {};

    /* Create spirit profile */
    var isWorker = codeData.isWorker || false;
    var profile = {
      firstName:   codeData.firstName || pend.firstName || (spUser.email||"").split("@")[0] || "",
      lastName:    codeData.lastName  || pend.lastName  || "",
      email:       spUser.email || "",
      orgId:       codeData.orgId || "",
      orgCode:     code,
      location:    "",
      bio:         "",
      struggles:   ["","",""],
      goals:       ["","",""],
      feeling:     { physical: 5, spiritual: 5, mental: 5, updatedAt: firebase.database.ServerValue.TIMESTAMP },
      inspiration: { name:"", note:"" },
      aiPath:      null,
      photoURL:    "",
      sessionCount: 0,
      sessionsThisMonth: 0,
      isWorker:    isWorker,
      createdAt:   firebase.database.ServerValue.TIMESTAMP,
      accountType: isWorker ? "worker" : "spirit"
    };
    /* If worker recruit — also create spiritWorkers entry */
    if(isWorker){
      await SP_DB.ref("spiritWorkers/" + spUser.uid).set({
        firstName: profile.firstName,
        lastName:  profile.lastName,
        email:     profile.email,
        isWorker:  true,
        online:    false,
        sessionCount: 0,
        sessionsThisMonth: 0,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      });
    }
    await SP_DB.ref("spirits/" + uid).set(profile);

    /* Remove pending record */
    await SP_DB.ref("spiritPending/" + uid).remove();

    spProfile = profile;
    renderApp();

  } catch(e){
    console.error(e);
    showErr(err,"Something went wrong. Please try again.");
    btn.disabled=false; btn.textContent="Unlock My Profile";
  }
};

/* ═══════════════════════════════════════════
   MAIN APP SHELL
═══════════════════════════════════════════ */
function renderApp(){
  var initials = ((spProfile.firstName||"?")[0] + (spProfile.lastName||"")[0]).toUpperCase();
  app().innerHTML = `
    <nav class="sp-nav">
      <div class="sp-nav-brand">Whisper<span>+</span>Me <span style="color:#f0c040;font-size:13px;font-weight:700;">SPIRITS</span></div>
      <div class="sp-nav-right">
        ${!spProfile.isWorker
          ? `<button class="sp-call-now-btn" onclick="spRequestCall()" aria-label="Talk to a Spirit listener now">📞 Talk to Someone</button>`
          : ``}
        <div class="sp-nav-avatar" onclick="spSetTab(0)">
          ${spProfile.photoURL ? `<img src="${spProfile.photoURL}" alt="avatar">` : initials}
        </div>
        <button class="sp-signout-btn" onclick="SP_AUTH.signOut()">Sign out</button>
      </div>
    </nav>
    <div class="sp-tabs">
      <button class="sp-tab ${spTab===0?'active':''}" onclick="spSetTab(0)">🏠 Home</button>
      <button class="sp-tab ${spTab===1?'active':''}" onclick="spSetTab(1)">💬 Community</button>
      <button class="sp-tab ${spTab===2?'active':''}" onclick="spSetTab(2)">✨ My Path</button>
      <button class="sp-tab ${spTab===4?'active':''}" onclick="spSetTab(4)">📦 My Resources</button>
      ${spProfile.isWorker ? `<button class="sp-tab ${spTab===3?'active':''}" onclick="spSetTab(3)">🎧 Worker Dashboard</button>` : ''}
    </div>
    <div class="sp-layout-wrap">
      <div class="sp-sidebar" id="sp-sidebar">${renderSidebar()}</div>
      <div class="sp-main" id="sp-content">
        ${spTab===0 ? renderProfile() : spTab===1 ? renderFeed() : spTab===2 ? renderMyPath() : spTab===4 ? renderMyResources() : renderWorkerDash()}
      </div>
    </div>`;
}

window.spSetTab = function(i){
  spTab = i;
  renderApp();
  if(i===0){ loadDynamicHomeColumns(); }
  if(i===1) loadFeed();
  if(i===4) loadMyResources();
};

/* ═══════════════════════════════════════════
   PROFILE TAB
═══════════════════════════════════════════ */
function renderProfile(){
  var p = spProfile;
  var initials = ((p.firstName||"?")[0] + (p.lastName||"")[0]).toUpperCase();
  var f = p.feeling || { physical:5, spiritual:5, mental:5 };
  var s = p.struggles || ["","",""];
  var g = p.goals || ["","",""];
  var insp = p.inspiration || {};

  return `
    <!-- TOP TWO COLUMN GRID -->
    <div class="sp-home-grid">
    <!-- LEFT: PROFILE -->
    <div class="sp-home-left">
    <div class="sp-profile-header" style="margin-bottom:0;">
      <div class="sp-avatar-wrap">
        <div class="sp-avatar" onclick="spChangePhoto()">
          ${p.photoURL ? `<img src="${p.photoURL}" alt="photo">` : initials}
        </div>
        <div class="sp-avatar-edit" onclick="spChangePhoto()">✏️</div>
      </div>
      <div class="sp-profile-info">
        <div class="sp-profile-name">${p.firstName} ${p.lastName}</div>
        <div class="sp-profile-location">${p.location || "📍 Location not set"}</div>
        <div class="sp-profile-bio">${p.bio || "No bio yet. Tell your story."}</div>
        <button class="sp-edit-profile-btn" onclick="spOpenEditModal()">Edit Profile</button>
      </div>
    </div>

    <!-- THREE & THREE -->
    <div class="sp-card">
      <div class="sp-card-title">My Three &amp; Three</div>
      <div class="sp-three-grid">
        <div class="sp-three-col struggles">
          <h4>🔴 Three Things I'm Struggling With</h4>
          ${[0,1,2].map(i=>`<div class="sp-three-item ${!s[i]?'empty':''}">${s[i]||"Not set yet"}</div>`).join("")}
        </div>
        <div class="sp-three-col goals">
          <h4>🟢 Three Things I Need to Accomplish</h4>
          ${[0,1,2].map(i=>`<div class="sp-three-item ${!g[i]?'empty':''}">${g[i]||"Not set yet"}</div>`).join("")}
        </div>
      </div>
      <button class="sp-btn-outline" style="margin-top:14px;" onclick="spOpenThreeThreeModal()">Update My Three &amp; Three</button>
    </div>

    <!-- HOW AM I FEELING -->
    <div class="sp-card">
      <div class="sp-card-title">How Am I Feeling Today</div>
      <div class="sp-feeling-grid">
        ${feelingItem("🧠","Mental",f.mental)}
        ${feelingItem("✨","Spiritual",f.spiritual)}
        ${feelingItem("💪","Physical",f.physical)}
      </div>
      <button class="sp-btn-outline" style="margin-top:14px;" onclick="spOpenFeelingModal()">Update My Feelings</button>
    </div>

    <!-- WHO I STRIVE TO BE -->
    <div class="sp-card">
      <div class="sp-card-title">🚀 Who I Strive To Be</div>
      <div class="sp-strive-grid">
        ${(function(){
          var st = p.striveTo || {};
          var items = [
            { label:"My Future Role", val: st.role, icon:"💼" },
            { label:"My Financial Goal", val: st.financial, icon:"💰" },
            { label:"My Lifestyle", val: st.lifestyle, icon:"🌟" },
            { label:"My Community Impact", val: st.impact, icon:"🤝" }
          ];
          return items.map(function(item){
            return `<div class="sp-strive-item">
              <div class="sp-strive-icon">${item.icon}</div>
              <div class="sp-strive-label">${item.label}</div>
              <div class="sp-strive-val">${item.val||"<span style='color:#8a9bb0;font-style:italic;font-size:13px;'>Not set yet</span>"}</div>
            </div>`;
          }).join("");
        })()}
      </div>
      <button class="sp-btn-outline" style="margin-top:16px;" onclick="spOpenStriveModal()">✏️ Define Who I'm Becoming</button>
    </div>
    <!-- DYNAMIC COLUMNS — added by admin -->
    <div id="sp-dynamic-columns"></div>

    </div><!-- end home-left -->
    <!-- RIGHT COLUMN -->
    <div class="sp-home-right">
      ${renderCallHistory()}
      <div class="sp-ad-slot"><div class="sp-ad-label">Advertisement</div><div style="display:flex;align-items:center;justify-content:center;flex:1;color:#2a4060;font-size:13px;">Ad space — Google AdSense</div></div>
    </div>
      ${renderCommunityBoard()}
    </div><!-- end home-grid -->
    </div><!-- end sp-home-left -->

    <!-- RIGHT: CALL HISTORY + AD SLOT -->
    <div class="sp-home-right">
      ${renderCallHistory()}
      <div class="sp-ad-slot" id="sp-ad-home">
        <div class="sp-ad-label">Sponsored</div>
        <ins class="adsbygoogle"
          style="display:block;width:100%;min-height:250px;"
          data-ad-client="ca-pub-1184595877548269"
          data-ad-slot="auto"
          data-ad-format="auto"
          data-full-width-responsive="true"></ins>
      </div>
    </div><!-- end sp-home-right -->
    </div><!-- end sp-home-grid -->

    <!-- BELOW GRID: THREE THREE, FEELING, INSPIRATION -->
    <div class="sp-home-below">`;
}

function feelingItem(icon, label, value){
  var v = value || 5;
  var pct = (v/10)*100;
  return `
    <div class="sp-feeling-item">
      <div class="sp-feeling-icon">${icon}</div>
      <div class="sp-feeling-label">${label}</div>
      <div class="sp-feeling-value">${v}/10</div>
      <div class="sp-feeling-bar"><div class="sp-feeling-fill" style="width:${pct}%"></div></div>
    </div>`;
}

/* ═══════════════════════════════════════════
   EDIT MODALS
═══════════════════════════════════════════ */
window.spOpenEditModal = function(){
  var p = spProfile;
  var overlay = document.createElement("div");
  overlay.className = "sp-modal-overlay";
  overlay.id = "sp-modal-overlay";
  overlay.innerHTML = `
    <div class="sp-modal">
      <h3>Edit Profile</h3>
      <div class="sp-field-label">First Name</div>
      <input class="sp-input" id="m-fname" value="${p.firstName||""}" placeholder="First name">
      <div class="sp-field-label" style="margin-top:12px;">Last Name</div>
      <input class="sp-input" id="m-lname" value="${p.lastName||""}" placeholder="Last name">
      <div class="sp-field-label" style="margin-top:12px;">Location</div>
      <input class="sp-input" id="m-location" value="${p.location||""}" placeholder="City, State">
      <div class="sp-field-label" style="margin-top:12px;">Bio</div>
      <textarea class="sp-input" id="m-bio" rows="3" placeholder="Tell your story…" style="resize:vertical;">${p.bio||""}</textarea>
      <div class="sp-modal-actions">
        <button class="sp-cancel-btn" onclick="spCloseModal()">Cancel</button>
        <button class="sp-btn" onclick="spSaveProfile()">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

window.spSaveProfile = async function(){
  var updates = {
    firstName: document.getElementById("m-fname").value.trim(),
    lastName:  document.getElementById("m-lname").value.trim(),
    location:  document.getElementById("m-location").value.trim(),
    bio:       document.getElementById("m-bio").value.trim()
  };
  await SP_DB.ref("spirits/" + spUser.uid).update(updates);
  Object.assign(spProfile, updates);
  spCloseModal();
  spToast("Profile updated ✓","success");
  document.getElementById("sp-content").innerHTML = renderProfile();
};

window.spOpenThreeThreeModal = function(){
  var s = spProfile.struggles || ["","",""];
  var g = spProfile.goals     || ["","",""];
  var overlay = document.createElement("div");
  overlay.className = "sp-modal-overlay";
  overlay.id = "sp-modal-overlay";
  overlay.innerHTML = `
    <div class="sp-modal">
      <h3>Update My Three &amp; Three</h3>
      <div class="sp-field-label" style="color:#e07070;">Three Things I'm Struggling With</div>
      <select class="sp-input" id="s-0"><option value="">Select struggle #1</option><option value="Anxiety & Stress" ${s[0]==="Anxiety & Stress"?"selected":""}>Anxiety & Stress</option>
<option value="Depression & Low Mood" ${s[0]==="Depression & Low Mood"?"selected":""}>Depression & Low Mood</option>
<option value="Housing Instability" ${s[0]==="Housing Instability"?"selected":""}>Housing Instability</option>
<option value="Unemployment & Income" ${s[0]==="Unemployment & Income"?"selected":""}>Unemployment & Income</option>
<option value="Relationship Issues" ${s[0]==="Relationship Issues"?"selected":""}>Relationship Issues</option>
<option value="Grief & Loss" ${s[0]==="Grief & Loss"?"selected":""}>Grief & Loss</option>
<option value="Substance Use" ${s[0]==="Substance Use"?"selected":""}>Substance Use</option>
<option value="Family Conflict" ${s[0]==="Family Conflict"?"selected":""}>Family Conflict</option>
<option value="Legal Problems" ${s[0]==="Legal Problems"?"selected":""}>Legal Problems</option>
<option value="Financial Debt" ${s[0]==="Financial Debt"?"selected":""}>Financial Debt</option>
<option value="Isolation & Loneliness" ${s[0]==="Isolation & Loneliness"?"selected":""}>Isolation & Loneliness</option>
<option value="Parenting Challenges" ${s[0]==="Parenting Challenges"?"selected":""}>Parenting Challenges</option>
<option value="Physical Health" ${s[0]==="Physical Health"?"selected":""}>Physical Health</option>
<option value="Mental Health Diagnosis" ${s[0]==="Mental Health Diagnosis"?"selected":""}>Mental Health Diagnosis</option>
<option value="Domestic Violence" ${s[0]==="Domestic Violence"?"selected":""}>Domestic Violence</option>
<option value="Trauma & PTSD" ${s[0]==="Trauma & PTSD"?"selected":""}>Trauma & PTSD</option>
<option value="Food Insecurity" ${s[0]==="Food Insecurity"?"selected":""}>Food Insecurity</option>
<option value="Transportation Issues" ${s[0]==="Transportation Issues"?"selected":""}>Transportation Issues</option>
<option value="Education & Skills Gap" ${s[0]==="Education & Skills Gap"?"selected":""}>Education & Skills Gap</option>
<option value="Self-Esteem & Confidence" ${s[0]==="Self-Esteem & Confidence"?"selected":""}>Self-Esteem & Confidence</option></select>
      <select class="sp-input" id="s-1"><option value="">Select struggle #2</option><option value="Anxiety & Stress" ${s[1]==="Anxiety & Stress"?"selected":""}>Anxiety & Stress</option>
<option value="Depression & Low Mood" ${s[1]==="Depression & Low Mood"?"selected":""}>Depression & Low Mood</option>
<option value="Housing Instability" ${s[1]==="Housing Instability"?"selected":""}>Housing Instability</option>
<option value="Unemployment & Income" ${s[1]==="Unemployment & Income"?"selected":""}>Unemployment & Income</option>
<option value="Relationship Issues" ${s[1]==="Relationship Issues"?"selected":""}>Relationship Issues</option>
<option value="Grief & Loss" ${s[1]==="Grief & Loss"?"selected":""}>Grief & Loss</option>
<option value="Substance Use" ${s[1]==="Substance Use"?"selected":""}>Substance Use</option>
<option value="Family Conflict" ${s[1]==="Family Conflict"?"selected":""}>Family Conflict</option>
<option value="Legal Problems" ${s[1]==="Legal Problems"?"selected":""}>Legal Problems</option>
<option value="Financial Debt" ${s[1]==="Financial Debt"?"selected":""}>Financial Debt</option>
<option value="Isolation & Loneliness" ${s[1]==="Isolation & Loneliness"?"selected":""}>Isolation & Loneliness</option>
<option value="Parenting Challenges" ${s[1]==="Parenting Challenges"?"selected":""}>Parenting Challenges</option>
<option value="Physical Health" ${s[1]==="Physical Health"?"selected":""}>Physical Health</option>
<option value="Mental Health Diagnosis" ${s[1]==="Mental Health Diagnosis"?"selected":""}>Mental Health Diagnosis</option>
<option value="Domestic Violence" ${s[1]==="Domestic Violence"?"selected":""}>Domestic Violence</option>
<option value="Trauma & PTSD" ${s[1]==="Trauma & PTSD"?"selected":""}>Trauma & PTSD</option>
<option value="Food Insecurity" ${s[1]==="Food Insecurity"?"selected":""}>Food Insecurity</option>
<option value="Transportation Issues" ${s[1]==="Transportation Issues"?"selected":""}>Transportation Issues</option>
<option value="Education & Skills Gap" ${s[1]==="Education & Skills Gap"?"selected":""}>Education & Skills Gap</option>
<option value="Self-Esteem & Confidence" ${s[1]==="Self-Esteem & Confidence"?"selected":""}>Self-Esteem & Confidence</option></select>
      <select class="sp-input" id="s-2"><option value="">Select struggle #3</option><option value="Anxiety & Stress" ${s[2]==="Anxiety & Stress"?"selected":""}>Anxiety & Stress</option>
<option value="Depression & Low Mood" ${s[2]==="Depression & Low Mood"?"selected":""}>Depression & Low Mood</option>
<option value="Housing Instability" ${s[2]==="Housing Instability"?"selected":""}>Housing Instability</option>
<option value="Unemployment & Income" ${s[2]==="Unemployment & Income"?"selected":""}>Unemployment & Income</option>
<option value="Relationship Issues" ${s[2]==="Relationship Issues"?"selected":""}>Relationship Issues</option>
<option value="Grief & Loss" ${s[2]==="Grief & Loss"?"selected":""}>Grief & Loss</option>
<option value="Substance Use" ${s[2]==="Substance Use"?"selected":""}>Substance Use</option>
<option value="Family Conflict" ${s[2]==="Family Conflict"?"selected":""}>Family Conflict</option>
<option value="Legal Problems" ${s[2]==="Legal Problems"?"selected":""}>Legal Problems</option>
<option value="Financial Debt" ${s[2]==="Financial Debt"?"selected":""}>Financial Debt</option>
<option value="Isolation & Loneliness" ${s[2]==="Isolation & Loneliness"?"selected":""}>Isolation & Loneliness</option>
<option value="Parenting Challenges" ${s[2]==="Parenting Challenges"?"selected":""}>Parenting Challenges</option>
<option value="Physical Health" ${s[2]==="Physical Health"?"selected":""}>Physical Health</option>
<option value="Mental Health Diagnosis" ${s[2]==="Mental Health Diagnosis"?"selected":""}>Mental Health Diagnosis</option>
<option value="Domestic Violence" ${s[2]==="Domestic Violence"?"selected":""}>Domestic Violence</option>
<option value="Trauma & PTSD" ${s[2]==="Trauma & PTSD"?"selected":""}>Trauma & PTSD</option>
<option value="Food Insecurity" ${s[2]==="Food Insecurity"?"selected":""}>Food Insecurity</option>
<option value="Transportation Issues" ${s[2]==="Transportation Issues"?"selected":""}>Transportation Issues</option>
<option value="Education & Skills Gap" ${s[2]==="Education & Skills Gap"?"selected":""}>Education & Skills Gap</option>
<option value="Self-Esteem & Confidence" ${s[2]==="Self-Esteem & Confidence"?"selected":""}>Self-Esteem & Confidence</option></select>
      <div class="sp-field-label" style="margin-top:12px;color:#00c9a7;">Three Things I Need to Accomplish</div>
      <select class="sp-input" id="g-0"><option value="">Select goal #1</option><option value="Find stable housing" ${g[0]==="Find stable housing"?"selected":""}>Find stable housing</option>
<option value="Get a job or better job" ${g[0]==="Get a job or better job"?"selected":""}>Get a job or better job</option>
<option value="Start a small business" ${g[0]==="Start a small business"?"selected":""}>Start a small business</option>
<option value="Improve my mental health" ${g[0]==="Improve my mental health"?"selected":""}>Improve my mental health</option>
<option value="Reconnect with family" ${g[0]==="Reconnect with family"?"selected":""}>Reconnect with family</option>
<option value="Get legal help" ${g[0]==="Get legal help"?"selected":""}>Get legal help</option>
<option value="Clear my debt" ${g[0]==="Clear my debt"?"selected":""}>Clear my debt</option>
<option value="Learn a new skill" ${g[0]==="Learn a new skill"?"selected":""}>Learn a new skill</option>
<option value="Get my GED or degree" ${g[0]==="Get my GED or degree"?"selected":""}>Get my GED or degree</option>
<option value="Improve my physical health" ${g[0]==="Improve my physical health"?"selected":""}>Improve my physical health</option>
<option value="Find childcare" ${g[0]==="Find childcare"?"selected":""}>Find childcare</option>
<option value="Get a vehicle" ${g[0]==="Get a vehicle"?"selected":""}>Get a vehicle</option>
<option value="Reduce stress & anxiety" ${g[0]==="Reduce stress & anxiety"?"selected":""}>Reduce stress & anxiety</option>
<option value="Build better relationships" ${g[0]==="Build better relationships"?"selected":""}>Build better relationships</option>
<option value="Get off substances" ${g[0]==="Get off substances"?"selected":""}>Get off substances</option>
<option value="Improve my credit" ${g[0]==="Improve my credit"?"selected":""}>Improve my credit</option>
<option value="Find community support" ${g[0]==="Find community support"?"selected":""}>Find community support</option>
<option value="Get counseling or therapy" ${g[0]==="Get counseling or therapy"?"selected":""}>Get counseling or therapy</option>
<option value="Become financially stable" ${g[0]==="Become financially stable"?"selected":""}>Become financially stable</option>
<option value="Find my purpose" ${g[0]==="Find my purpose"?"selected":""}>Find my purpose</option></select>
      <select class="sp-input" id="g-1"><option value="">Select goal #2</option><option value="Find stable housing" ${g[1]==="Find stable housing"?"selected":""}>Find stable housing</option>
<option value="Get a job or better job" ${g[1]==="Get a job or better job"?"selected":""}>Get a job or better job</option>
<option value="Start a small business" ${g[1]==="Start a small business"?"selected":""}>Start a small business</option>
<option value="Improve my mental health" ${g[1]==="Improve my mental health"?"selected":""}>Improve my mental health</option>
<option value="Reconnect with family" ${g[1]==="Reconnect with family"?"selected":""}>Reconnect with family</option>
<option value="Get legal help" ${g[1]==="Get legal help"?"selected":""}>Get legal help</option>
<option value="Clear my debt" ${g[1]==="Clear my debt"?"selected":""}>Clear my debt</option>
<option value="Learn a new skill" ${g[1]==="Learn a new skill"?"selected":""}>Learn a new skill</option>
<option value="Get my GED or degree" ${g[1]==="Get my GED or degree"?"selected":""}>Get my GED or degree</option>
<option value="Improve my physical health" ${g[1]==="Improve my physical health"?"selected":""}>Improve my physical health</option>
<option value="Find childcare" ${g[1]==="Find childcare"?"selected":""}>Find childcare</option>
<option value="Get a vehicle" ${g[1]==="Get a vehicle"?"selected":""}>Get a vehicle</option>
<option value="Reduce stress & anxiety" ${g[1]==="Reduce stress & anxiety"?"selected":""}>Reduce stress & anxiety</option>
<option value="Build better relationships" ${g[1]==="Build better relationships"?"selected":""}>Build better relationships</option>
<option value="Get off substances" ${g[1]==="Get off substances"?"selected":""}>Get off substances</option>
<option value="Improve my credit" ${g[1]==="Improve my credit"?"selected":""}>Improve my credit</option>
<option value="Find community support" ${g[1]==="Find community support"?"selected":""}>Find community support</option>
<option value="Get counseling or therapy" ${g[1]==="Get counseling or therapy"?"selected":""}>Get counseling or therapy</option>
<option value="Become financially stable" ${g[1]==="Become financially stable"?"selected":""}>Become financially stable</option>
<option value="Find my purpose" ${g[1]==="Find my purpose"?"selected":""}>Find my purpose</option></select>
      <select class="sp-input" id="g-2"><option value="">Select goal #3</option><option value="Find stable housing" ${g[2]==="Find stable housing"?"selected":""}>Find stable housing</option>
<option value="Get a job or better job" ${g[2]==="Get a job or better job"?"selected":""}>Get a job or better job</option>
<option value="Start a small business" ${g[2]==="Start a small business"?"selected":""}>Start a small business</option>
<option value="Improve my mental health" ${g[2]==="Improve my mental health"?"selected":""}>Improve my mental health</option>
<option value="Reconnect with family" ${g[2]==="Reconnect with family"?"selected":""}>Reconnect with family</option>
<option value="Get legal help" ${g[2]==="Get legal help"?"selected":""}>Get legal help</option>
<option value="Clear my debt" ${g[2]==="Clear my debt"?"selected":""}>Clear my debt</option>
<option value="Learn a new skill" ${g[2]==="Learn a new skill"?"selected":""}>Learn a new skill</option>
<option value="Get my GED or degree" ${g[2]==="Get my GED or degree"?"selected":""}>Get my GED or degree</option>
<option value="Improve my physical health" ${g[2]==="Improve my physical health"?"selected":""}>Improve my physical health</option>
<option value="Find childcare" ${g[2]==="Find childcare"?"selected":""}>Find childcare</option>
<option value="Get a vehicle" ${g[2]==="Get a vehicle"?"selected":""}>Get a vehicle</option>
<option value="Reduce stress & anxiety" ${g[2]==="Reduce stress & anxiety"?"selected":""}>Reduce stress & anxiety</option>
<option value="Build better relationships" ${g[2]==="Build better relationships"?"selected":""}>Build better relationships</option>
<option value="Get off substances" ${g[2]==="Get off substances"?"selected":""}>Get off substances</option>
<option value="Improve my credit" ${g[2]==="Improve my credit"?"selected":""}>Improve my credit</option>
<option value="Find community support" ${g[2]==="Find community support"?"selected":""}>Find community support</option>
<option value="Get counseling or therapy" ${g[2]==="Get counseling or therapy"?"selected":""}>Get counseling or therapy</option>
<option value="Become financially stable" ${g[2]==="Become financially stable"?"selected":""}>Become financially stable</option>
<option value="Find my purpose" ${g[2]==="Find my purpose"?"selected":""}>Find my purpose</option></select>
      <div class="sp-modal-actions">
        <button class="sp-cancel-btn" onclick="spCloseModal()">Cancel</button>
        <button class="sp-btn" onclick="spSaveThreeThree()">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

window.spSaveThreeThree = async function(){
  var struggles = [0,1,2].map(i=>(document.getElementById("s-"+i).value||"").trim());
  var goals     = [0,1,2].map(i=>(document.getElementById("g-"+i).value||"").trim());
  await SP_DB.ref("spirits/" + spUser.uid).update({ struggles, goals, aiPath: null });
  spProfile.struggles = struggles;
  spProfile.goals     = goals;
  spProfile.aiPath    = null;
  spCloseModal();
  spToast("Three & Three saved ✓","success");
  document.getElementById("sp-content").innerHTML = renderProfile();
};

window.spOpenFeelingModal = function(){
  var f = spProfile.feeling || { physical:5, spiritual:5, mental:5 };
  var overlay = document.createElement("div");
  overlay.className = "sp-modal-overlay";
  overlay.id = "sp-modal-overlay";
  overlay.innerHTML = `
    <div class="sp-modal">
      <h3>How Am I Feeling Today</h3>
      ${feelingSlider("Mental","🧠","f-mental", f.mental)}
      ${feelingSlider("Spiritual","✨","f-spiritual", f.spiritual)}
      ${feelingSlider("Physical","💪","f-physical", f.physical)}
      <div class="sp-modal-actions">
        <button class="sp-cancel-btn" onclick="spCloseModal()">Cancel</button>
        <button class="sp-btn" onclick="spSaveFeeling()">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

function feelingSlider(label, icon, id, value){
  return `
    <div class="sp-field-label" style="margin-top:14px;">${icon} ${label} — <span id="${id}-val">${value||5}</span>/10</div>
    <input class="sp-slider" type="range" id="${id}" min="1" max="10" value="${value||5}"
      oninput="document.getElementById('${id}-val').textContent=this.value">
    <div class="sp-slider-label"><span>1 — Struggling</span><span>10 — Thriving</span></div>`;
}

window.spSaveFeeling = async function(){
  var feeling = {
    mental:    parseInt(document.getElementById("f-mental").value),
    spiritual: parseInt(document.getElementById("f-spiritual").value),
    physical:  parseInt(document.getElementById("f-physical").value),
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  };
  await SP_DB.ref("spirits/" + spUser.uid + "/feeling").set(feeling);
  spProfile.feeling = feeling;
  spCloseModal();
  spToast("Feelings updated ✓","success");
  document.getElementById("sp-content").innerHTML = renderProfile();
};

window.spOpenInspirationModal = function(){
  var insp = spProfile.inspiration || {};
  var overlay = document.createElement("div");
  overlay.className = "sp-modal-overlay";
  overlay.id = "sp-modal-overlay";
  overlay.innerHTML = `
    <div class="sp-modal">
      <h3>Someone I Look Up To</h3>
      <div class="sp-field-label">Who or what inspires you most</div>
      <select class="sp-input" id="i-name">
        <option value="">Select or type below</option>
        ${["A family member","God / Higher Power","A mentor or teacher","A community leader","A historical figure","A celebrity or artist","My future self","Nature & the Universe","My children","A spiritual guide","An author or thinker","A friend","My culture & heritage","Other"].map(function(o){ return `<option value="${o}" ${insp.name===o?'selected':''}>${o}</option>`; }).join("")}
      </select>
      <div class="sp-field-label" style="margin-top:12px;">Why they inspire you</div>
      <textarea class="sp-input" id="i-note" rows="3" placeholder="What do they mean to you?">${insp.note||""}</textarea>
      <div class="sp-modal-actions">
        <button class="sp-cancel-btn" onclick="spCloseModal()">Cancel</button>
        <button class="sp-btn" onclick="spSaveInspiration()">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

window.spSaveInspiration = async function(){
  var inspiration = {
    name: document.getElementById("i-name").value.trim(),
    note: document.getElementById("i-note").value.trim()
  };
  await SP_DB.ref("spirits/" + spUser.uid + "/inspiration").set(inspiration);
  spProfile.inspiration = inspiration;
  spCloseModal();
  spToast("Inspiration saved ✓","success");
  document.getElementById("sp-content").innerHTML = renderProfile();
};

window.spCloseModal = function(){
  var o = document.getElementById("sp-modal-overlay");
  if(o) o.remove();
};

/* ═══════════════════════════════════════════
   PHOTO UPLOAD
═══════════════════════════════════════════ */
window.spChangePhoto = function(){
  var input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async function(){
    var file = input.files[0];
    if(!file) return;
    if(file.size > 3*1024*1024){ spToast("Image must be under 3MB","error"); return; }
    spToast("Uploading photo…");
    try {
      var ref = SP_STORAGE.ref("spiritPhotos/" + spUser.uid + "/avatar.jpg");
      await ref.put(file);
      var url = await ref.getDownloadURL();
      await SP_DB.ref("spirits/" + spUser.uid).update({ photoURL: url });
      spProfile.photoURL = url;
      spToast("Photo updated ✓","success");
      renderApp();
    } catch(e){ spToast("Upload failed","error"); }
  };
  input.click();
};

/* ═══════════════════════════════════════════
   COMMUNITY FEED TAB
═══════════════════════════════════════════ */
function renderFeed(){
  return `
    <div class="sp-live-badge"><div class="sp-live-dot"></div> Live Community Feed</div>
    <div class="sp-feed-grid">
    <div class="sp-feed-left">
    <!-- COMPOSER -->
    <div class="sp-feed-composer">
      <div class="sp-feed-composer-top">
        <div class="sp-post-avatar" style="width:38px;height:38px;flex-shrink:0;">
          ${spProfile.photoURL ? `<img src="${spProfile.photoURL}" alt="me">` : ((spProfile.firstName||"?")[0]).toUpperCase()}
        </div>
        <textarea class="sp-feed-textarea" id="sp-post-text" placeholder="Share what's on your mind, ask for help, or celebrate a win. Every post is reviewed and we find resources to help you."></textarea>
      </div>
      <div class="sp-feed-actions">
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="sp-photo-post-btn" onclick="spPickPostPhoto()" title="Add photo">📷</button>
          <span class="sp-feed-hint">🔒 Reviewed before publishing</span>
        </div>
        <button class="sp-post-btn" onclick="spSubmitPost()">Post</button>
      </div>
      <div id="sp-post-photo-preview" style="display:none;margin-top:10px;">
        <img id="sp-post-photo-img" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid #253545;">
        <button onclick="spClearPostPhoto()" style="background:none;border:none;color:#e07070;cursor:pointer;font-size:12px;margin-top:6px;display:block;">✕ Remove photo</button>
      </div>
    </div>
    <!-- FEED ITEMS -->
    <div id="sp-feed-list">
      <div class="sp-loading" style="height:200px;">
        <div class="sp-loading-ring"></div>
      </div>
    </div>
    </div><!-- end feed-left -->
    <div class="sp-feed-right">
      <div class="sp-card" style="padding:20px;">
        <div class="sp-card-title">📌 Community Standards</div>
        <div style="font-size:13px;line-height:1.8;color:#c8d8e8;">
          <div style="color:#00d4aa;font-weight:700;margin-bottom:8px;">✅ What belongs here</div>
          <div style="margin-bottom:6px;">🚀 Sharing your goals and progress</div>
          <div style="margin-bottom:6px;">💡 Ideas, resources, and opportunities</div>
          <div style="margin-bottom:6px;">🤝 Encouragement and real talk</div>
          <div style="margin-bottom:6px;">📋 Asking for help finding resources</div>
          <div style="margin-bottom:16px;">🏆 Celebrating wins — big or small</div>

          <div style="color:#e05555;font-weight:700;margin-bottom:8px;">❌ What is never allowed</div>
          <div style="margin-bottom:6px;">🚫 No real names, addresses, phone numbers, or identifying information — yours or anyone else's</div>
          <div style="margin-bottom:6px;">🚫 No medical diagnoses, treatment details, or clinical information (HIPAA)</div>
          <div style="margin-bottom:6px;">🚫 No drug references, solicitation, or illegal activity</div>
          <div style="margin-bottom:6px;">🚫 No harassment, threats, or targeting of any person</div>
          <div style="margin-bottom:6px;">🚫 No sexual content of any kind</div>
          <div style="margin-bottom:6px;">🚫 No sharing of other members' personal information</div>
          <div style="margin-bottom:6px;">🚫 No advertising or spam</div>
          <div style="margin-bottom:16px;">🚫 No content that discourages someone from seeking professional help</div>

          <div style="color:#f5c842;font-weight:700;margin-bottom:8px;">⚖️ Legal notice</div>
          <div style="font-size:12px;color:#8a9bb0;line-height:1.7;">
            All posts are reviewed before publishing. Sharing personally identifiable health information may violate HIPAA. Threats of harm are reported to authorities. Violation of these standards results in immediate removal. This is a success space — protect it.
          </div>
        </div>
      </div>
      <div class="sp-card" style="padding:20px;margin-bottom:0;">
        <div class="sp-card-title">🆘 Need Help Now?</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div class="sp-emergency-item" onclick="spShowEmergencyPopup('988')" style="margin:0;">🧠 988 Crisis Line</div>
          <div class="sp-emergency-item" onclick="spShowEmergencyPopup('211')" style="margin:0;">📋 211 All Services</div>
          <div class="sp-emergency-item" onclick="spShowEmergencyPopup('911')" style="margin:0;">🚨 911 Emergency</div>
        </div>
      </div>
      <div class="sp-ad-slot"><div class="sp-ad-label">Advertisement</div><div style="display:flex;align-items:center;justify-content:center;flex:1;color:#2a4060;font-size:13px;">Ad space — Google AdSense</div></div>
    </div>
    </div><!-- end feed-grid -->`;
}

window.spSubmitPost = async function(){
  var text = (document.getElementById("sp-post-text").value||"").trim();
  if(!text){ spToast("Write something first","error"); return; }
  var btn = document.querySelector(".sp-post-btn");
  btn.disabled = true; btn.textContent = "Posting…";
  try {
    var postPhotoURL = "";
    if(window.__spPostPhotoFile){
      var ref = SP_STORAGE.ref("spiritFeedPhotos/" + spUser.uid + "/" + Date.now() + ".jpg");
      await ref.put(window.__spPostPhotoFile);
      postPhotoURL = await ref.getDownloadURL();
      window.__spPostPhotoFile = null;
    }
    await SP_DB.ref("spiritFeed").push({
      uid:       spUser.uid,
      firstName: spProfile.firstName || "Spirit",
      lastName:  spProfile.lastName  || "Member",
      photoURL:  spProfile.photoURL || "",
      orgId:     spProfile.orgId || "",
      text:      text,
      postPhoto: postPhotoURL,
      status:    "pending",
      resource:  null,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    document.getElementById("sp-post-text").value = "";
    spClearPostPhoto();
    spToast("Posted! We'll review it shortly ✓","success");
    loadFeed();
  } catch(e){ spToast("Failed to post","error"); }
  btn.disabled = false; btn.textContent = "Post";
};

function loadFeed(){
  var list = document.getElementById("sp-feed-list");
  if(!list) return;
  SP_DB.ref("spiritFeed").orderByChild("createdAt").limitToLast(30).once("value", function(snap){
    var posts = [];
    snap.forEach(function(c){ posts.unshift({ id: c.key, ...c.val() }); });
    if(!posts.length){
      list.innerHTML = `<div class="sp-empty"><div class="sp-empty-icon">🌱</div><p>No posts yet.<br>Be the first to share something.</p></div>`;
      return;
    }
    /* Only show own posts or approved posts */
    var visible = posts.filter(function(p){ return p.uid === spUser.uid || p.status === "approved"; });
    list.innerHTML = visible.map(renderPost).join("") || `<div class="sp-empty"><div class="sp-empty-icon">🌱</div><p>Your post is being reviewed.<br>Check back soon.</p></div>`;
  });
}

function renderPost(post){
  var initials = ((post.firstName||"?")[0] + (post.lastName||"")[0]).toUpperCase();
  var ts = post.createdAt ? timeAgo(post.createdAt) : "";
  var isPending = post.status === "pending";
  var isOwn = post.uid === spUser.uid;

  return `
    <div class="sp-post">
      <div class="sp-post-header">
        <div class="sp-post-avatar">
          ${post.photoURL ? `<img src="${post.photoURL}" alt="avatar">` : initials}
        </div>
        <div class="sp-post-meta">
          <div class="sp-post-name">${(post.firstName||"Spirit")} ${((post.lastName||"M")[0])}.</div>
          <div class="sp-post-time">${ts}</div>
        </div>
      </div>
      <div class="sp-post-body">${escHtml(post.text)}</div>
      ${post.postPhoto ? `<img src="${post.postPhoto}" style="max-width:100%;border-radius:8px;margin-bottom:10px;border:1px solid #253545;">` : ''}
      ${isPending && isOwn ? `<div class="sp-post-pending">⏳ Under review — we'll find resources to help</div>` : ""}
      ${post.resource ? `
        <div class="sp-post-resource">
          <div class="sp-post-resource-label">✨ Resources for you</div>
          <div class="sp-post-resource-text">${escHtml(post.resource)}</div>
        </div>` : ""}
    </div>`;
}

/* ═══════════════════════════════════════════
   MY PATH TAB — AI GENERATION
═══════════════════════════════════════════ */
function renderMyPath(){
  var b = spProfile.birthChart || {};
  var savedPath = spProfile.aiPath;
  var st = spProfile.striveTo || {};
  var s = spProfile.struggles || [];
  var g = spProfile.goals || [];

  return `
    <div class="sp-path-grid">

    <!-- LEFT: SUCCESS PATH -->
    <div>
      <div class="sp-ai-section">
        <div class="sp-ai-title">🚀 My Success Path</div>
        <div class="sp-ai-subtitle">Your personalized roadmap — real jobs, businesses, resources, and next steps built around your goals and vision.</div>
        <button class="sp-generate-btn" id="sp-gen-btn" onclick="spGeneratePath()" aria-label="Generate my success path">
          ✨ Generate My Path
        </button>
        <div class="sp-ai-result ${savedPath?"show":""}" id="sp-ai-result">
          ${savedPath ? renderAiIdeas(savedPath) + renderAiChatBox() : ""}
        </div>
      </div>

      <!-- WHO I STRIVE TO BE SUMMARY -->
      <div class="sp-card">
        <div class="sp-card-title">🚀 My Vision</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          ${st.role?`<span style="background:rgba(0,212,170,0.1);border:1px solid rgba(0,212,170,0.2);color:#00d4aa;padding:6px 14px;border-radius:20px;font-size:13px;">💼 ${st.role}</span>`:""}
          ${st.financial?`<span style="background:rgba(245,200,66,0.1);border:1px solid rgba(245,200,66,0.2);color:#f5c842;padding:6px 14px;border-radius:20px;font-size:13px;">💰 ${st.financial}</span>`:""}
          ${st.lifestyle?`<span style="background:rgba(123,47,247,0.1);border:1px solid rgba(123,47,247,0.2);color:#b08fff;padding:6px 14px;border-radius:20px;font-size:13px;">🌟 ${st.lifestyle}</span>`:""}
          ${st.impact?`<span style="background:rgba(0,150,255,0.1);border:1px solid rgba(0,150,255,0.2);color:#60aaff;padding:6px 14px;border-radius:20px;font-size:13px;">🤝 ${st.impact}</span>`:""}
          ${!st.role&&!st.financial?`<span style="color:#8a9bb0;font-size:13px;font-style:italic;">Set your vision on the Home tab to unlock your full path.</span>`:""}
        </div>
      </div>
    </div>

    <!-- RIGHT: SPIRITUAL READING -->
    <div>
      <div class="sp-card" style="background:linear-gradient(135deg,#080f1e,#0d1f35);border-color:#1a3050;">
        <div class="sp-card-title">🌙 My Spiritual Reading</div>
        <p style="font-size:13px;color:#8a9bb0;line-height:1.8;margin-bottom:18px;">
          Enter your birthday and we look up your chart — what you may be going through right now, what to prepare for, and what strength to lean into.
        </p>

        <div class="sp-field-label">Date of Birth <span style="color:#e05555;">*</span></div>
        <input class="sp-input" id="birth-date-input" type="date" value="${b.birthDate||""}" aria-label="Date of birth" aria-required="true">

        <div class="sp-field-label" style="margin-top:12px;">Time of Birth <span style="color:#8a9bb0;font-weight:400;font-size:11px;">(optional — for rising sign)</span></div>
        <input class="sp-input" id="birth-time-input" type="time" value="${b.birthTime&&b.birthTime!=="Unknown"?b.birthTime:""}" aria-label="Time of birth optional">

        <div class="sp-field-label" style="margin-top:12px;">City of Birth <span style="color:#8a9bb0;font-weight:400;font-size:11px;">(optional)</span></div>
        <input class="sp-input" id="birth-city-input" placeholder="e.g. St. Louis, Missouri" value="${b.birthCity&&b.birthCity!=="Unknown"?b.birthCity:""}" aria-label="City of birth optional">

        <button class="sp-generate-btn" id="birth-read-btn" onclick="spGenerateBirthReading()" style="margin-top:18px;width:100%;justify-content:center;" aria-label="Generate spiritual reading">
          🌙 ${b.aiReading?"Regenerate My Reading":"Generate My Reading"}
        </button>

        <div id="birth-reading-result" class="sp-ai-result ${b.aiReading?"show":""}">
          ${b.aiReading ? renderBirthReading(b) : ""}
        </div>
      </div>
    </div>

    </div>`;
}
window.spGeneratePath = async function(){
  var btn    = document.getElementById("sp-gen-btn");
  var result = document.getElementById("sp-ai-result");
  var s = spProfile.struggles || [];
  var g = spProfile.goals     || [];

  btn.disabled = true;
  btn.innerHTML = `<span class="sp-ai-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span> Thinking…`;
  result.className = "sp-ai-result show";
  result.innerHTML = `<div class="sp-ai-thinking"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>Building your path…</span></div>`;

  var prompt = `You are a compassionate life coach and resource advisor. A person is seeking support through a mental health organization.

Their Three Struggles:
1. ${s[0]||"Not specified"}
2. ${s[1]||"Not specified"}
3. ${s[2]||"Not specified"}

Their Three Goals (things they need to accomplish to relieve their nervous system):
1. ${g[0]||"Not specified"}
2. ${g[1]||"Not specified"}
3. ${g[2]||"Not specified"}

Based on these, generate 4-5 specific, actionable, realistic ideas to help this person move forward. Include a mix of:
- Potential income ideas or small business concepts they could start
- Job paths that match what they've shared
- Practical resources or programs they could access
- One emotional/mindset insight

Keep each idea concise (2-3 sentences). Be warm, specific, and encouraging. Do not be generic. Format as a numbered list.`;

  try {
    var apiKey = await SP_DB.ref("config/geminiKey").once("value").then(function(s){ return s.val(); });
    if(!apiKey){ result.innerHTML = '<div style="color:#e07070;font-size:13px;">AI service not configured yet. Contact your administrator.</div>'; btn.disabled=false; btn.innerHTML="✨ Generate My Path"; return; }
    var res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    var data = await res.json();
    if(res.status === 429){ throw new Error("rate_limit"); }
    if(res.status === 400){ throw new Error("bad_request"); }
    var text = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0].text) || "No ideas generated. Please try again.";

    await SP_DB.ref("spirits/" + spUser.uid + "/aiPath").set({ text: text, generatedAt: firebase.database.ServerValue.TIMESTAMP });
    spProfile.aiPath = { text: text };
    result.innerHTML = renderAiIdeas({ text }) + renderAiChatBox();
    spToast("Your path is ready ✓","success");

  } catch(e){
    console.error(e);
    if(e.message === "rate_limit"){
      var secs = 60;
      result.innerHTML = `<div id="sp-rate-countdown" style="color:#f0c040;font-size:14px;padding:16px;background:rgba(240,192,64,0.08);border-radius:10px;text-align:center;">⏳ AI rate limit reached. Retrying in <strong id="sp-countdown-num">60</strong>s…</div>`;
      var timer = setInterval(function(){
        secs--;
        var el = document.getElementById("sp-countdown-num");
        if(el) el.textContent = secs;
        if(secs <= 0){
          clearInterval(timer);
          var cd = document.getElementById("sp-rate-countdown");
          if(cd) cd.innerHTML = "✅ Ready! Click Generate My Path again.";
          cd.style.color = "#00d4aa";
        }
      }, 1000);
    } else {
      var msg = e.message === "bad_request"
        ? "Fill in your Three & Three on the Home tab first."
        : "Something went wrong. Please try again.";
      result.innerHTML = `<div style="color:#e07070;font-size:14px;padding:16px;background:rgba(224,85,85,0.08);border-radius:10px;">${msg}</div>`;
    }
  }

  if(btn){ btn.disabled = false;
  btn.innerHTML = "✨ Regenerate My Path"; }
};

function renderAiIdeas(aiPath){
  if(!aiPath || !aiPath.text) return "";
  var lines = aiPath.text.split("\n").filter(function(l){ return l.trim(); });
  return lines.map(function(line){
    return `<div class="sp-ai-idea">${escHtml(line.trim())}</div>`;
  }).join("");
}

/* ═══════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════ */
function showErr(el, msg){
  el.textContent = msg;
  el.classList.add("show");
}

function escHtml(str){
  return (str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function timeAgo(ts){
  var diff = Date.now() - ts;
  var m = Math.floor(diff/60000);
  if(m < 1)  return "just now";
  if(m < 60) return m + "m ago";
  var h = Math.floor(m/60);
  if(h < 24) return h + "h ago";
  return Math.floor(h/24) + "d ago";
}

function friendlyAuthError(code){
  var map = {
    "auth/user-not-found":      "No account found with that email.",
    "auth/wrong-password":      "Incorrect password. Please try again.",
    "auth/invalid-email":       "Please enter a valid email address.",
    "auth/email-already-in-use":"An account already exists with that email.",
    "auth/weak-password":       "Password must be at least 6 characters.",
    "auth/too-many-requests":   "Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed": "Network error. Check your connection."
  };
  return map[code] || "Something went wrong. Please try again.";
}

/* Sign out listener */
SP_AUTH.onAuthStateChanged(function(user){
  if(!user && document.getElementById("sp-app")){
    spUser = null; spProfile = null;
    renderAuthPage();
  }
});

/* ═══════════════════════════════════════════
   SIDEBAR — AUTO-CYCLING RESOURCES
═══════════════════════════════════════════ */
var SP_RESOURCES = [
  { icon:"🏠", label:"Housing Help", text:"HUD Housing Assistance", url:"https://www.hud.gov/topics/rental_assistance" },
  { icon:"💼", label:"Find a Job", text:"Illinois Job Board", url:"https://illinoisjoblink.illinois.gov" },
  { icon:"⚖️", label:"Legal Aid", text:"Land of Lincoln Legal Aid", url:"https://www.lollaf.org" },
  { icon:"🚗", label:"Transportation", text:"211 Rides & Transit Help", url:"https://www.211.org" },
  { icon:"👶", label:"Child Support", text:"Illinois Child Support", url:"https://www.ilchildsupport.com" },
  { icon:"💳", label:"Debt Help", text:"NFCC Credit Counseling", url:"https://www.nfcc.org" },
  { icon:"🍎", label:"Food Assistance", text:"SNAP Benefits Illinois", url:"https://abe.illinois.gov" },
  { icon:"🏥", label:"Health Care", text:"Free Clinics — 211.org", url:"https://www.211.org" },
  { icon:"📞", label:"Crisis Line", text:"988 Suicide & Crisis Lifeline", url:"tel:988" },
  { icon:"💡", label:"Utility Help", text:"LIHEAP Energy Assistance", url:"https://www.liheapillinois.com" },
  { icon:"🎓", label:"Education", text:"Illinois Adult Education", url:"https://www.iccb.org/adulted" },
  { icon:"👔", label:"Temp Work", text:"WhisperPlusMe Temp Service", url:"#" }
];
var __sidebarIdx = 0;
function renderSidebar(){
  var r = SP_RESOURCES[__sidebarIdx % SP_RESOURCES.length];
  return `
    <div class="sp-sidebar-inner">
      <div class="sp-sidebar-label">Community Resources</div>
      <div class="sp-resource-card" id="sp-resource-card" onclick="spShowResourcePopup(${__sidebarIdx % SP_RESOURCES.length})" style="cursor:pointer;">
        <div class="sp-resource-icon">${r.icon}</div>
        <div class="sp-resource-info">
          <div class="sp-resource-cat">${r.label}</div>
          <div class="sp-resource-name">${r.text}</div>
        </div>
        <div class="sp-resource-arrow">→</div>
      </div>
      <div class="sp-resource-dots" id="sp-resource-dots">
        ${SP_RESOURCES.map((_,i)=>`<div class="sp-resource-dot ${i===__sidebarIdx%SP_RESOURCES.length?'active':''}"></div>`).join('')}
      </div>
      <div class="sp-sidebar-label" style="margin-top:20px;">📌 From Your Team</div>
      <div id="sp-admin-resources-sidebar"></div>
      <div class="sp-sidebar-label" style="margin-top:20px;">Emergency Numbers</div>
      <div class="sp-emergency-list">
        <div class="sp-emergency-item" onclick="spShowEmergencyPopup('911')">🚨 911 — Emergency</div>
        <div class="sp-emergency-item" onclick="spShowEmergencyPopup('988')">🧠 988 — Crisis Line</div>
        <div class="sp-emergency-item" onclick="spShowEmergencyPopup('18002738255')">💛 NAMI Helpline</div>
        <div class="sp-emergency-item" onclick="spShowEmergencyPopup('211')">📋 211 — All Services</div>
        <div class="sp-emergency-item" onclick="spShowEmergencyPopup('18007996366')">🔥 SAMHSA Hotline</div>
      </div>
    </div>`;
}
function startSidebarCycle(){
  setInterval(function(){
    __sidebarIdx++;
    var sb = document.getElementById("sp-sidebar");
    if(sb) sb.innerHTML = renderSidebar();
  }, 12000);
}

/* ═══════════════════════════════════════════
   POST PHOTO HELPERS
═══════════════════════════════════════════ */
window.__spPostPhotoFile = null;
window.spPickPostPhoto = function(){
  var input = document.createElement("input");
  input.type = "file"; input.accept = "image/*";
  input.onchange = function(){
    var file = input.files[0];
    if(!file) return;
    if(file.size > 5*1024*1024){ spToast("Image must be under 5MB","error"); return; }
    window.__spPostPhotoFile = file;
    var reader = new FileReader();
    reader.onload = function(e){
      document.getElementById("sp-post-photo-img").src = e.target.result;
      document.getElementById("sp-post-photo-preview").style.display = "block";
    };
    reader.readAsDataURL(file);
  };
  input.click();
};
window.spClearPostPhoto = function(){
  window.__spPostPhotoFile = null;
  var prev = document.getElementById("sp-post-photo-preview");
  if(prev) prev.style.display = "none";
};

/* ═══════════════════════════════════════════
   WORKER DASHBOARD (Phase 2 stub)
═══════════════════════════════════════════ */
function renderWorkerDash(){
  var w = spProfile;
  return `
    <div class="sp-stats-bar">
      <div class="sp-stat-item"><div class="sp-stat-num" id="wd-sessions">${w.sessionCount||0}</div><div class="sp-stat-label">Total Sessions</div></div>
      <div class="sp-stat-item"><div class="sp-stat-num" id="wd-month">${w.sessionsThisMonth||0}</div><div class="sp-stat-label">This Month</div></div>
      <div class="sp-stat-item"><div class="sp-stat-num">$${((w.sessionCount||0)*15).toFixed(0)}</div><div class="sp-stat-label">Total Earned</div></div>
    </div>

    <!-- ONLINE TOGGLE -->
    <div class="sp-card" style="margin-bottom:20px;">
      <div class="sp-card-title">📡 My Status</div>
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <div id="wd-status-display" style="font-size:15px;color:#8a9bb0;">⚫ Offline — patients cannot reach you</div>
        <button class="sp-generate-btn" id="wd-online-btn" onclick="wdToggleOnline()" style="padding:12px 28px;">
          🎧 Go Online
        </button>
      </div>
      <div style="font-size:12px;color:#8a9bb0;margin-top:12px;line-height:1.6;">
        When online you will receive incoming calls from patients. Stay on this page to receive calls.
      </div>
    </div>

    <!-- INCOMING CALL AREA -->
    <div id="wd-incoming-area"></div>

    <!-- ACTIVE CALL AREA -->
    <div id="wd-active-call-area"></div>

    <!-- RECENT SESSIONS -->
    <div class="sp-card">
      <div class="sp-card-title">📋 Recent Sessions</div>
      <div id="wd-sessions-list"><div style="color:#8a9bb0;font-size:14px;">Loading…</div></div>
    </div>`;
}

/* ═══════════════════════════════════════════
   WORKER READY TOGGLE
═══════════════════════════════════════════ */
window.spToggleReady = function(){
  var btn = document.getElementById("sp-call-ready-btn");
  if(!btn) return;
  var isReady = btn.dataset.ready === "1";
  isReady = !isReady;
  btn.dataset.ready = isReady ? "1" : "0";
  btn.textContent = isReady ? "🟢 Online" : "🎧 Go Online";
  btn.style.background = isReady ? "#00c9a7" : "";
  btn.style.color = isReady ? "#000" : "";
  SP_DB.ref("spiritWorkers/" + spUser.uid).update({ online: isReady, lastSeen: firebase.database.ServerValue.TIMESTAMP });
};

/* Start sidebar cycle after app renders */
var __sidebarStarted = false;
var _origRenderApp = window.spSetTab;
window.spSetTab = function(i){
  spTab = i;
  var wasStarted = __sidebarStarted;
  renderApp();
  if(i===1) loadFeed();
  if(!wasStarted){ __sidebarStarted = true; startSidebarCycle(); }
};
startSidebarCycle();

/* ═══════════════════════════════════════════
   AI CHAT BOX — Follow-up questions
═══════════════════════════════════════════ */
function renderAiChatBox(){
  return `
    <div class="sp-ai-chat" id="sp-ai-chat">
      <div class="sp-ai-chat-title">💬 Ask a follow-up question</div>
      <div class="sp-ai-chat-history" id="sp-ai-chat-history"></div>
      <div class="sp-ai-chat-input-row">
        <input class="sp-input" id="sp-ai-chat-input" placeholder="Ask anything about your path…" style="margin-bottom:0;">
        <button class="sp-btn" onclick="spAskFollowUp()" style="width:auto;padding:13px 20px;white-space:nowrap;">Ask</button>
      </div>
    </div>`;
}

window.spAskFollowUp = async function(){
  var input = document.getElementById("sp-ai-chat-input");
  var history = document.getElementById("sp-ai-chat-history");
  if(!input || !history) return;
  var question = input.value.trim();
  if(!question) return;
  input.value = "";

  /* Show user message */
  history.innerHTML += `<div class="sp-chat-bubble sp-chat-user">${escHtml(question)}</div>`;
  history.innerHTML += `<div class="sp-chat-bubble sp-chat-ai" id="sp-chat-thinking"><span class="sp-ai-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>`;
  history.scrollTop = history.scrollHeight;

  /* Save question to Firebase for future tracking */
  await SP_DB.ref("spirits/" + spUser.uid + "/aiConversation").push({
    role: "user", text: question, ts: firebase.database.ServerValue.TIMESTAMP
  });

  try {
    var apiKey = await SP_DB.ref("config/geminiKey").once("value").then(function(s){ return s.val(); });
    var s = spProfile.struggles || [];
    var g = spProfile.goals || [];
    var context = "You are a compassionate life coach. This person struggles with: " + s.join(", ") + ". Their goals are: " + g.join(", ") + ". Their saved AI path: " + (spProfile.aiPath ? spProfile.aiPath.text : "not yet generated") + ". Answer their follow-up question warmly and specifically.";

    var res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: context + "\n\nUser question: " + question }] }] })
    });
    var data = await res.json();
    var answer = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0].text) || "I couldn't generate a response. Please try again.";

    /* Save answer */
    await SP_DB.ref("spirits/" + spUser.uid + "/aiConversation").push({
      role: "ai", text: answer, ts: firebase.database.ServerValue.TIMESTAMP
    });

    var thinking = document.getElementById("sp-chat-thinking");
    if(thinking) thinking.outerHTML = `<div class="sp-chat-bubble sp-chat-ai">${escHtml(answer)}</div>`;
    history.scrollTop = history.scrollHeight;

  } catch(e){
    var thinking = document.getElementById("sp-chat-thinking");
    if(thinking) thinking.outerHTML = `<div class="sp-chat-bubble sp-chat-ai" style="color:#e07070;">Something went wrong. Please try again.</div>`;
  }
};

/* ═══════════════════════════════════════════
   EMERGENCY NUMBER POPUP
═══════════════════════════════════════════ */
var EMERGENCY_INFO = {
  "911":          { icon:"🚨", name:"Emergency Services", num:"911",          desc:"For immediate life-threatening emergencies. Police, fire, and ambulance." },
  "988":          { icon:"🧠", name:"988 Suicide & Crisis Lifeline", num:"988", desc:"Free, confidential crisis support 24/7. Call or text 988." },
  "18002738255":  { icon:"💛", name:"NAMI HelpLine", num:"1-800-273-8255",    desc:"National Alliance on Mental Illness. M–F 10am–10pm ET." },
  "211":          { icon:"📋", name:"211 — All Local Services", num:"211",     desc:"Housing, food, health, and social services in your area." },
  "18007996366":  { icon:"🔥", name:"SAMHSA National Helpline", num:"1-800-799-6366", desc:"Free treatment referral and information. 24/7, 365 days a year." }
};

window.spShowEmergencyPopup = function(num){
  var info = EMERGENCY_INFO[num] || { icon:"📞", name:"Helpline", num:num, desc:"Please call for assistance." };
  var overlay = document.createElement("div");
  overlay.className = "sp-emergency-overlay";
  overlay.id = "sp-emergency-overlay";
  overlay.innerHTML = `
    <div class="sp-emergency-popup" onclick="event.stopPropagation()">
      <div class="sp-emergency-popup-icon">${info.icon}</div>
      <h3>${info.name}</h3>
      <div class="sp-emergency-popup-num">${info.num}</div>
      <p>${info.desc}</p>
      <a href="tel:${num}" class="sp-emergency-popup-call">📞 Call Now</a>
      <button class="sp-emergency-popup-close" onclick="spCloseEmergencyPopup()">Close</button>
    </div>`;
  overlay.addEventListener("click", spCloseEmergencyPopup);
  document.body.appendChild(overlay);
};

window.spCloseEmergencyPopup = function(){
  var o = document.getElementById("sp-emergency-overlay");
  if(o) o.remove();
};

/* ═══════════════════════════════════════════
   CALL HISTORY TAB (added to profile)
═══════════════════════════════════════════ */
window.renderCallHistory = function(){
  var uid = spUser.uid;
  SP_DB.ref("spiritCallHistory/" + uid).orderByChild("createdAt").limitToLast(20).once("value", function(snap){
    var calls = [];
    snap.forEach(function(c){ calls.unshift({ id: c.key, ...c.val() }); });
    var el = document.getElementById("sp-call-history-list");
    if(!el) return;
    if(!calls.length){
      el.innerHTML = `<div class="sp-empty"><div class="sp-empty-icon">📞</div><p>No calls yet.<br>Your call history will appear here.</p></div>`;
      return;
    }
    var totalCalls = calls.length;
    var totalMins  = calls.reduce(function(a,c){ return a + (c.duration||0); }, 0);
    el.innerHTML = `
      <div class="sp-call-progress">
        <div class="sp-progress-item"><div class="sp-progress-label">Total Calls</div><div class="sp-progress-value">${totalCalls}</div></div>
        <div class="sp-progress-item"><div class="sp-progress-label">Minutes</div><div class="sp-progress-value">${totalMins}</div></div>
        <div class="sp-progress-item"><div class="sp-progress-label">This Month</div><div class="sp-progress-value">${calls.filter(function(c){ return c.createdAt > Date.now()-30*86400000; }).length}</div></div>
      </div>
      <div style="margin-top:20px;">
        ${calls.map(function(call){ return `
          <div class="sp-call-history-item">
            <div class="sp-call-history-header">
              <span class="sp-call-history-date">📅 ${new Date(call.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>
              <span class="sp-call-history-duration">⏱ ${call.duration||30} min</span>
            </div>
            ${call.note ? `<div class="sp-call-history-note">💬 ${escHtml(call.note)}</div>` : ''}
            ${call.surveyRating ? `<div style="margin-top:8px;font-size:13px;color:#8a9bb0;">Rating: ${'⭐'.repeat(call.surveyRating)}</div>` : ''}
          </div>`; }).join('')}
      </div>`;
  });
  return `
    <div class="sp-card">
      <div class="sp-card-title">📞 Call History & Progress</div>
      <div id="sp-call-history-list"><div class="sp-loading" style="height:120px;"><div class="sp-loading-ring"></div></div></div>
    </div>`;
};

/* ═══════════════════════════════════════════
   RESOURCE POPUP
═══════════════════════════════════════════ */
window.spShowResourcePopup = function(idx){
  var r = SP_RESOURCES[idx % SP_RESOURCES.length];
  var overlay = document.createElement("div");
  overlay.className = "sp-emergency-overlay";
  overlay.id = "sp-resource-overlay";
  overlay.innerHTML = `
    <div class="sp-emergency-popup" onclick="event.stopPropagation()">
      <div class="sp-emergency-popup-icon">${r.icon}</div>
      <h3>${r.label}</h3>
      <div style="font-size:15px;color:#00d4aa;text-align:center;margin:12px 0;font-weight:700;">${r.text}</div>
      <p>Click below to visit this resource and get connected with the help you need.</p>
      <a href="${r.url}" target="_blank" class="sp-emergency-popup-call" style="background:linear-gradient(135deg,#00d4aa,#00b090);color:#000;">
        🔗 Visit Resource
      </a>
      <button class="sp-emergency-popup-close" onclick="spCloseResourcePopup()">Close</button>
    </div>`;
  overlay.addEventListener("click", spCloseResourcePopup);
  document.body.appendChild(overlay);
};

window.spCloseResourcePopup = function(){
  var o = document.getElementById("sp-resource-overlay");
  if(o) o.remove();
};

/* ═══════════════════════════════════════════
   ORG SIDE CALL BUTTON
═══════════════════════════════════════════ */
window.spRequestCall = async function(){
  if(!spUser || !spProfile){ spToast("Please log in first","error"); return; }

  /* Request microphone permission first */
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(function(t){ t.stop(); }); /* Just testing permission */
  } catch(e){
    spToast("Microphone access required to make calls. Please allow mic access and try again.","error",6000);
    return;
  }

  /* Check for available worker */
  var snap = await SP_DB.ref("spiritWorkers").orderByChild("online").equalTo(true).once("value");
  var workers = [];
  snap.forEach(function(c){ workers.push({ uid: c.key, ...c.val() }); });

  if(!workers.length){
    spShowNoWorkerPopup();
    return;
  }

  /* Pick first available worker */
  var worker = workers[0];
  var callId = SP_DB.ref("spiritCalls").push().key;

  var hour = new Date().getHours();
  var isMorning = hour >= 6 && hour < 18;
  var sessionRate    = isMorning ? 14 : 27;
  var workerRate     = isMorning ? 10 : 20;
  var platformRate   = isMorning ? 4  : 7;
  var shiftLabel     = isMorning ? "Morning" : "Night";

  /* NOTE: Full voice via Agora RTC — to be wired in next session
     For now Firebase signals the connection, mic permission is granted */
  await SP_DB.ref("spiritCalls/" + callId).set({
    callerId:      spUser.uid,
    callerName:    spProfile.firstName + " " + spProfile.lastName,
    workerId:      worker.uid,
    workerName:    worker.firstName || "Spirit Worker",
    status:        "ringing",
    orgId:         spProfile.orgId || "",
    sessionRate:   sessionRate,
    workerRate:    workerRate,
    platformRate:  platformRate,
    shift:         shiftLabel,
    createdAt:     firebase.database.ServerValue.TIMESTAMP
  });

  spShowCallingPopup(callId, worker);
};

function spShowNoWorkerPopup(){
  var overlay = document.createElement("div");
  overlay.className = "sp-emergency-overlay";
  overlay.id = "sp-call-overlay";
  overlay.innerHTML = `
    <div class="sp-emergency-popup" onclick="event.stopPropagation()">
      <div class="sp-emergency-popup-icon">🎧</div>
      <h3>No Listeners Available</h3>
      <div style="font-size:14px;color:#8a9bb0;text-align:center;margin:16px 0;line-height:1.7;">
        All Spirit listeners are currently busy or offline.<br>
        Please try again in a few minutes, or reach out to a crisis line right now.
      </div>
      <div class="sp-emergency-item" onclick="spShowEmergencyPopup('988');spCloseCallPopup();" style="text-align:center;margin-bottom:8px;">🧠 988 — Crisis Line (Free, 24/7)</div>
      <div class="sp-emergency-item" onclick="spShowEmergencyPopup('211');spCloseCallPopup();" style="text-align:center;margin-bottom:16px;">📋 211 — All Local Services</div>
      <button class="sp-emergency-popup-close" onclick="spCloseCallPopup()">Close</button>
    </div>`;
  overlay.addEventListener("click", spCloseCallPopup);
  document.body.appendChild(overlay);
}

function spShowCallingPopup(callId, worker){
  var overlay = document.createElement("div");
  overlay.className = "sp-emergency-overlay";
  overlay.id = "sp-call-overlay";
  overlay.innerHTML = `
    <div class="sp-emergency-popup" onclick="event.stopPropagation()">
      <div class="sp-emergency-popup-icon" style="animation:pulse 1s infinite;">📞</div>
      <h3>Connecting you…</h3>
      <div style="font-size:14px;color:#8a9bb0;text-align:center;margin:16px 0;line-height:1.7;">
        A Spirit listener is being connected.<br>
        Please stay on this screen.
      </div>
      <div style="background:rgba(0,212,170,0.08);border:1px solid rgba(0,212,170,0.2);border-radius:10px;padding:14px;text-align:center;margin-bottom:16px;">
        <div style="font-size:12px;color:#8a9bb0;margin-bottom:4px;">Your listener</div>
        <div style="font-size:16px;font-weight:700;color:#fff;">${worker.firstName || "Spirit Listener"}</div>
      </div>
      <div style="background:rgba(0,0,0,0.2);border:1px solid #1e3050;border-radius:10px;padding:14px;text-align:center;margin-bottom:16px;" id="caller-timer-box" style="display:none;">
        <div style="font-size:11px;color:#8a9bb0;margin-bottom:4px;">Session Time Remaining</div>
        <div id="caller-countdown" style="font-size:32px;font-weight:800;color:#00d4aa;letter-spacing:2px;">30:00</div>
        <div style="font-size:11px;color:#8a9bb0;margin-top:4px;">Sessions are 30 minutes</div>
      </div>
      <div id="caller-warning-banner"></div>
      <button class="sp-emergency-popup-close" style="background:rgba(224,85,85,0.1);border-color:#e05555;color:#e05555;" onclick="spCancelCall('${callId}')">Cancel Call</button>
    </div>`;
  overlay.addEventListener("click", function(){});
  document.body.appendChild(overlay);

  /* Listen for call status changes */
  SP_DB.ref("spiritCalls/" + callId + "/status").on("value", function(snap){
    var status = snap.val();
    if(status === "active"){
      spToast("Connected! Your session has started.","success",5000);
      spStartCallerCountdown();
      spListenForEscalation(callId);
    } else if(status === "declined" || status === "ended"){
      spCloseCallPopup();
      spToast("Call ended.","",3000);
    }
  });
};

window.spCancelCall = async function(callId){
  await SP_DB.ref("spiritCalls/" + callId).update({ status: "cancelled" });
  spCloseCallPopup();
};

window.spCloseCallPopup = function(){
  var o = document.getElementById("sp-call-overlay");
  if(o) o.remove();
};

/* ═══════════════════════════════════════════
   WORKER DASHBOARD FUNCTIONS
═══════════════════════════════════════════ */
var __wdOnline = false;
var __wdCallListener = null;

window.wdToggleOnline = function(){
  __wdOnline = !__wdOnline;
  var btn = document.getElementById("wd-online-btn");
  var status = document.getElementById("wd-status-display");
  if(!btn) return;

  if(__wdOnline){
    btn.textContent = "🟢 Go Offline";
    btn.style.background = "linear-gradient(135deg,#e05555,#c03030)";
    if(status) status.innerHTML = '<span style="color:#00d4aa;">🟢 Online — patients can reach you now</span>';
    SP_DB.ref("spiritWorkers/" + spUser.uid).update({ online: true, lastSeen: firebase.database.ServerValue.TIMESTAMP });
    wdListenForCalls();
  } else {
    btn.textContent = "🎧 Go Online";
    btn.style.background = "";
    if(status) status.innerHTML = "⚫ Offline — patients cannot reach you";
    SP_DB.ref("spiritWorkers/" + spUser.uid).update({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP });
    if(__wdCallListener) __wdCallListener.off();
  }
};

function wdListenForCalls(){
  /* Listen for calls assigned to this worker */
  __wdCallListener = SP_DB.ref("spiritCalls").orderByChild("workerId").equalTo(spUser.uid);
  __wdCallListener.on("child_added", function(snap){
    var call = snap.val();
    var callId = snap.key;
    if(call.status === "ringing") wdShowIncomingCall(callId, call);
  });
  __wdCallListener.on("child_changed", function(snap){
    var call = snap.val();
    if(call.status === "ended" || call.status === "cancelled"){
      var area = document.getElementById("wd-active-call-area");
      if(area) area.innerHTML = "";
      wdShowEndSurvey(snap.key, call);
    }
  });
  wdLoadRecentSessions();
}

function wdShowIncomingCall(callId, call){
  var area = document.getElementById("wd-incoming-area");
  if(!area) return;

  /* Play alert sound */
  try { new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAA").play(); } catch(e){}

  area.innerHTML = `
    <div class="wd-incoming-card" id="wd-incoming-${callId}">
      <div class="wd-incoming-pulse"></div>
      <div class="wd-incoming-info">
        <div class="wd-incoming-title">📞 Incoming Call</div>
        <div class="wd-incoming-name">${call.callerName||"Anonymous Patient"}</div>
        <div class="wd-incoming-org">Organization: ${call.orgId||"Unknown"}</div>
      </div>
      <div class="wd-incoming-actions">
        <button class="wd-accept-btn" onclick="wdAcceptCall('${callId}')">✅ Accept</button>
        <button class="wd-decline-btn" onclick="wdDeclineCall('${callId}')">❌ Decline</button>
      </div>
    </div>`;
}

window.wdAcceptCall = async function(callId){
  /* Request mic permission */
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    window.__workerStream = stream;
  } catch(e){
    spToast("Microphone access required. Please allow mic access.","error",6000);
    return;
  }

  /* Mark call active */
  await SP_DB.ref("spiritCalls/" + callId).update({ status: "active", acceptedAt: firebase.database.ServerValue.TIMESTAMP });

  /* Clear incoming */
  var inc = document.getElementById("wd-incoming-" + callId);
  if(inc) inc.remove();

  /* Load caller spirit profile */
  var callSnap = await SP_DB.ref("spiritCalls/" + callId).once("value");
  var call = callSnap.val();

  var callerProfile = null;
  if(call.callerId){
    var profSnap = await SP_DB.ref("spirits/" + call.callerId).once("value");
    callerProfile = profSnap.val();
  }

  wdShowActiveCall(callId, call, callerProfile);
};

window.wdDeclineCall = async function(callId){
  await SP_DB.ref("spiritCalls/" + callId).update({ status: "declined" });
  var inc = document.getElementById("wd-incoming-" + callId);
  if(inc) inc.remove();
  spToast("Call declined","");
};

function wdShowActiveCall(callId, call, caller){
  var area = document.getElementById("wd-active-call-area");
  if(!area) return;

  var s = caller ? (caller.struggles||[]).filter(Boolean) : [];
  var g = caller ? (caller.goals||[]).filter(Boolean) : [];
  var startTime = Date.now();

  area.innerHTML = `
    <!-- ACTIVE CALL HEADER -->
    <div class="wd-active-card">
      <div class="wd-active-header">
        <div>
          <div class="wd-active-title">🟢 Active Session</div>
          <div class="wd-active-name">${call.callerName||"Anonymous Patient"}</div>
        </div>
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="font-size:11px;color:#8a9bb0;text-align:right;">Elapsed<br><span class="wd-timer" id="wd-timer">00:00</span></div>
              <div style="width:1px;height:36px;background:#1e3050;"></div>
              <div style="font-size:11px;text-align:center;" id="wd-countdown-wrap">Remaining<br><span id="wd-countdown" style="font-size:22px;font-weight:800;color:#00d4aa;">30:00</span></div>
            </div>
          </div>
          <button class="wd-end-btn" onclick="wdEndCall('${callId}')" aria-label="End this session now">End Session</button>
        </div>
      </div>

      <!-- TWO COLUMN: CALLER INFO + AI TOOLS -->
      <div class="wd-call-grid">

        <!-- LEFT: CALLER PROFILE -->
        <div class="wd-caller-profile">
          <div class="wd-section-title">👤 Patient Profile</div>
          ${caller ? `
            <div class="wd-profile-item"><span class="wd-profile-label">Name</span><span>${caller.firstName||"?"} ${caller.lastName||""}</span></div>
            <div class="wd-profile-item"><span class="wd-profile-label">Location</span><span>${caller.location||"Not set"}</span></div>
            <div class="wd-profile-item"><span class="wd-profile-label">Mental</span><span>${(caller.feeling&&caller.feeling.mental)||"–"}/10</span></div>
            <div class="wd-profile-item"><span class="wd-profile-label">Spiritual</span><span>${(caller.feeling&&caller.feeling.spiritual)||"–"}/10</span></div>
            <div class="wd-profile-item"><span class="wd-profile-label">Physical</span><span>${(caller.feeling&&caller.feeling.physical)||"–"}/10</span></div>
            ${s.length ? `
              <div class="wd-section-title" style="margin-top:14px;">⚠️ Struggles</div>
              ${s.map(function(x){ return `<div class="wd-struggle-item">${x}</div>`; }).join("")}` : ""}
            ${g.length ? `
              <div class="wd-section-title" style="margin-top:14px;">🎯 Goals</div>
              ${g.map(function(x){ return `<div class="wd-goal-item">${x}</div>`; }).join("")}` : ""}
          ` : '<div style="color:#8a9bb0;font-size:13px;">Profile not available</div>'}

          <!-- ESCALATE BUTTON -->
          <button class="wd-escalate-btn" onclick="wdEscalateToClinical('${callId}')" aria-label="Escalate this call to clinical hotline immediately">
            🚨 Escalate to Clinical Hotline
          </button>

          <!-- EMERGENCY NUMBERS -->
          <div class="wd-section-title" style="margin-top:16px;">🚨 Emergency Numbers</div>
          <div class="wd-emergency-list">
            <div class="wd-emergency-item" onclick="spShowEmergencyPopup('911')">🚨 911</div>
            <div class="wd-emergency-item" onclick="spShowEmergencyPopup('988')">🧠 988 Crisis</div>
            <div class="wd-emergency-item" onclick="spShowEmergencyPopup('211')">📋 211 Services</div>
            <div class="wd-emergency-item" onclick="spShowEmergencyPopup('18007996366')">🔥 SAMHSA</div>
          </div>
        </div>

        <!-- RIGHT: AI TOOLS -->
        <div class="wd-ai-tools">
          <!-- AI QUESTION SUGGESTIONS -->
          <div class="wd-section-title">💡 Suggested Questions</div>
          <div id="wd-questions-list" class="wd-questions-list">
            <button class="wd-gen-questions-btn" onclick="wdGenerateQuestions('${callId}')">✨ Generate Questions</button>
          </div>

          <!-- MID-CALL AI ADVICE -->
          <div class="wd-section-title" style="margin-top:16px;">🤖 Get AI Advice</div>
          <div class="wd-advice-box">
            <textarea class="wd-advice-input" id="wd-advice-input" placeholder="Describe what's happening on the call and ask for guidance…"></textarea>
            <button class="wd-advice-btn" onclick="wdGetAdvice('${callId}')">Ask AI</button>
            <div id="wd-advice-result" class="wd-advice-result"></div>
          </div>

          <!-- WORKER NOTES -->
          <div class="wd-section-title" style="margin-top:16px;">📝 Session Notes</div>
          <textarea class="wd-advice-input" id="wd-session-notes" placeholder="Notes about this session (saved automatically)…" style="min-height:80px;"></textarea>
        </div>

      </div>
    </div>`;

  /* Start call timer — elapsed up + countdown down */
  var SESSION_SECS = 30 * 60; /* 30 minutes */
  var warned5 = false;
  var warned2 = false;
  var timerInterval = setInterval(function(){
    var elapsed  = Math.floor((Date.now() - startTime) / 1000);
    var remain   = Math.max(0, SESSION_SECS - elapsed);
    var eMins    = Math.floor(elapsed/60).toString().padStart(2,"0");
    var eSecs    = (elapsed%60).toString().padStart(2,"0");
    var rMins    = Math.floor(remain/60).toString().padStart(2,"0");
    var rSecs    = (remain%60).toString().padStart(2,"0");

    var elEl = document.getElementById("wd-timer");
    var cdEl = document.getElementById("wd-countdown");
    if(!elEl){ clearInterval(timerInterval); return; }

    elEl.textContent = eMins + ":" + eSecs;
    if(cdEl){
      cdEl.textContent = rMins + ":" + rSecs;
      /* Color coding */
      if(remain <= 120)       cdEl.style.color = "#e05555";
      else if(remain <= 300)  cdEl.style.color = "#f5c842";
      else                    cdEl.style.color = "#00d4aa";
    }

    /* 5-minute warning */
    if(remain <= 300 && remain > 299 && !warned5){
      warned5 = true;
      spToast("⏰ 5 minutes remaining — please begin summarizing","",6000);
      wdShowWarningBanner("5 minutes remaining. Please begin summarizing progress with your patient.", "gold");
    }

    /* 2-minute warning */
    if(remain <= 120 && remain > 119 && !warned2){
      warned2 = true;
      spToast("⚠️ 2 minutes remaining","",5000);
      wdShowWarningBanner("2 minutes remaining. Wrap up and schedule next steps.", "red");
    }

    /* Session ended */
    if(remain <= 0){
      clearInterval(timerInterval);
      spToast("⏱ Session time reached. Please end the call.","",8000);
      wdShowWarningBanner("Session time has ended. Please end the call now.", "red");
      var endBtn = document.querySelector(".wd-end-btn");
      if(endBtn){ endBtn.style.animation = "glow-pulse 0.5s infinite"; endBtn.textContent = "⏱ End Session Now"; }
    }
  }, 1000);

  window.__wdCallTimer = timerInterval;
  window.__wdCallStart = startTime;
  window.__wdCurrentCallId = callId;
}

window.wdGenerateQuestions = async function(callId){
  var list = document.getElementById("wd-questions-list");
  if(!list) return;
  list.innerHTML = '<div class="sp-ai-thinking"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span style="margin-left:8px;">Generating…</span></div>';

  var callSnap = await SP_DB.ref("spiritCalls/" + callId).once("value");
  var call = callSnap.val();
  var profSnap = call.callerId ? await SP_DB.ref("spirits/" + call.callerId).once("value") : null;
  var caller = profSnap ? profSnap.val() : null;

  var s = caller ? (caller.struggles||[]).filter(Boolean).join(", ") : "unspecified";
  var g = caller ? (caller.goals||[]).filter(Boolean).join(", ") : "unspecified";

  try {
    var apiKey = await SP_DB.ref("config/geminiKey").once("value").then(function(s){ return s.val(); });
    var prompt = `You are coaching a peer support worker on a live call. The patient struggles with: ${s}. Their goals: ${g}. Generate 5 short, open-ended questions the worker can ask to help the patient open up. Number them. Keep each under 15 words. Warm and non-clinical.`;
    var res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + apiKey, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    var data = await res.json();
    var text = (data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts[0].text)||"";
    var questions = text.split("\n").filter(function(l){ return l.trim(); });
    list.innerHTML = questions.map(function(q){
      return `<div class="wd-question-item">${escHtml(q.trim())}</div>`;
    }).join("");
  } catch(e){
    list.innerHTML = '<div style="color:#e07070;font-size:13px;">Could not generate questions. Try again.</div>';
  }
};

window.wdGetAdvice = async function(callId){
  var question = (document.getElementById("wd-advice-input").value||"").trim();
  var result   = document.getElementById("wd-advice-result");
  if(!question||!result) return;
  result.innerHTML = '<div class="sp-ai-thinking"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';

  try {
    var apiKey = await SP_DB.ref("config/geminiKey").once("value").then(function(s){ return s.val(); });
    var prompt = `You are advising a peer support worker mid-call. They ask: "${question}". Give a brief, practical, compassionate response in 3-4 sentences. Focus on what the worker should say or do right now.`;
    var res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + apiKey, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    var data = await res.json();
    var text = (data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts[0].text)||"Could not get advice.";
    result.innerHTML = `<div class="wd-advice-response">${escHtml(text)}</div>`;
    document.getElementById("wd-advice-input").value = "";
  } catch(e){
    result.innerHTML = '<div style="color:#e07070;font-size:13px;">AI unavailable. Trust your instincts.</div>';
  }
};

window.wdEndCall = async function(callId){
  if(!confirm("End this session?")) return;
  clearInterval(window.__wdCallTimer);
  var duration = Math.ceil((Date.now() - (window.__wdCallStart||Date.now())) / 60000) || 30;
  var notes    = (document.getElementById("wd-session-notes")||{}).value||"";

  await SP_DB.ref("spiritCalls/" + callId).update({
    status:   "ended",
    duration: duration,
    workerNotes: notes,
    endedAt:  firebase.database.ServerValue.TIMESTAMP
  });

  /* Update worker session count */
  await SP_DB.ref("spiritWorkers/" + spUser.uid).update({
    sessionCount:      firebase.database.ServerValue.increment(1),
    sessionsThisMonth: firebase.database.ServerValue.increment(1)
  });

  var area = document.getElementById("wd-active-call-area");
  if(area) area.innerHTML = "";
  wdShowEndSurvey(callId, { duration, notes });
};

function wdShowEndSurvey(callId, call){
  var overlay = document.createElement("div");
  overlay.className = "sp-modal-overlay";
  overlay.id = "sp-survey-overlay";
  overlay.innerHTML = `
    <div class="sp-modal" style="max-width:500px;">
      <h3>📋 End of Session Survey</h3>
      <p style="font-size:13px;color:#8a9bb0;margin-bottom:20px;">Help us track impact and improve our service.</p>

      <div class="sp-field-label">How did this session go overall?</div>
      <div class="wd-rating-row" id="wd-rating-row">
        ${[1,2,3,4,5].map(function(n){ return `<button class="wd-rating-btn" onclick="wdSelectRating(${n})" data-rating="${n}">${"⭐".repeat(n)}</button>`; }).join("")}
      </div>

      <div class="sp-field-label" style="margin-top:16px;">Did the patient seem to benefit from this call?</div>
      <div style="display:flex;gap:10px;margin-bottom:14px;">
        <button class="wd-yn-btn active" id="wd-benefit-yes" onclick="wdSelectBenefit('yes')">👍 Yes</button>
        <button class="wd-yn-btn" id="wd-benefit-no" onclick="wdSelectBenefit('no')">👎 Not sure</button>
      </div>

      <div class="sp-field-label">Topics discussed (check all that apply)</div>
      <div class="wd-topics-grid" style="margin-bottom:14px;">
        ${["Anxiety","Depression","Housing","Employment","Relationships","Grief","Substance use","Family","Legal","Financial","Spiritual","Other"].map(function(t){
          return `<label class="wd-topic-item"><input type="checkbox" value="${t}"> ${t}</label>`;
        }).join("")}
      </div>

      <div class="sp-field-label">Your notes about this session</div>
      <textarea class="sp-input" id="survey-notes" rows="3" placeholder="What happened? What did you help with? Any follow-up needed?"></textarea>

      <div class="sp-field-label" style="margin-top:12px;">Any resources you shared or recommended</div>
      <input class="sp-input" id="survey-resources" placeholder="e.g. 211, SNAP benefits, local shelter…">

      <div class="sp-modal-actions">
        <button class="sp-cancel-btn" onclick="wdSubmitSurvey('${callId}', true)">Skip</button>
        <button class="sp-btn" onclick="wdSubmitSurvey('${callId}', false)">Submit Survey</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

var __wdRating  = 5;
var __wdBenefit = "yes";

window.wdSelectRating = function(n){
  __wdRating = n;
  document.querySelectorAll(".wd-rating-btn").forEach(function(b){
    b.style.opacity = parseInt(b.dataset.rating) <= n ? "1" : "0.3";
  });
};

window.wdSelectBenefit = function(val){
  __wdBenefit = val;
  document.getElementById("wd-benefit-yes").classList.toggle("active", val==="yes");
  document.getElementById("wd-benefit-no").classList.toggle("active",  val==="no");
};

window.wdSubmitSurvey = async function(callId, skip){
  /* Disable submit button if it exists */
  var submitBtn = document.querySelector("#sp-survey-overlay .sp-btn");
  if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }

  var notes     = skip ? "" : ((document.getElementById("survey-notes")||{}).value||"");
  var resources = "";
  if(!skip){
    var checks = document.querySelectorAll(".survey-res-check:checked");
    resources = Array.from(checks).map(function(c){ return c.value; }).join(", ");
  }
  var topics    = [];
  if(!skip){
    document.querySelectorAll(".wd-topic-item input:checked").forEach(function(c){ topics.push(c.value); });
  }

  var survey = {
    callId:    callId,
    workerId:  spUser.uid,
    rating:    __wdRating,
    benefit:   __wdBenefit,
    topics:    topics,
    notes:     notes,
    resources: resources,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };

  /* Save survey */
  await SP_DB.ref("spiritSurveys/" + callId).set(survey);

  /* Save to call history for caller too */
  var callSnap = await SP_DB.ref("spiritCalls/" + callId).once("value");
  var call = callSnap.val()||{};
  if(call.callerId){
    await SP_DB.ref("spiritCallHistory/" + call.callerId + "/" + callId).set({
      duration:     call.duration||30,
      rate:         call.sessionRate||20,
      workerRate:   call.workerRate||15,
      platformRate: call.platformRate||5,
      shift:        call.shift||"Day",
      workerNotes:  notes,
      topics:       topics,
      resources:    resources,
      surveyRating: __wdRating,
      createdAt:    firebase.database.ServerValue.TIMESTAMP
    });
    await SP_DB.ref("spirits/" + call.callerId).update({
      sessionCount:      firebase.database.ServerValue.increment(1),
      sessionsThisMonth: firebase.database.ServerValue.increment(1)
    });
    /* Show caller survey popup if they're still on the page */
    wdShowCallerSurvey(call.callerId, callId);
  }

  var o = document.getElementById("sp-survey-overlay");
  if(o) o.remove();
  spToast("Session saved ✓","success");
  wdLoadRecentSessions();
};

function wdShowCallerSurvey(callerUid, callId){
  /* This fires on the caller's screen via Firebase listener */
  SP_DB.ref("spiritCalls/" + callId + "/callerSurveyReady").set(true);
}

/* Caller-side survey listener — fires when worker ends call */
function wdListenForCallerSurvey(){
  if(!spUser || spProfile.isWorker) return;
  SP_DB.ref("spiritCalls").orderByChild("callerId").equalTo(spUser.uid).limitToLast(1).on("child_changed", function(snap){
    var call = snap.val();
    if(call.callerSurveyReady && call.status === "ended"){
      wdShowCallerSurveyPopup(snap.key, call);
    }
  });
}

function wdShowCallerSurveyPopup(callId, call){
  var existing = document.getElementById("sp-caller-survey-overlay");
  if(existing) return;
  var overlay = document.createElement("div");
  overlay.className = "sp-modal-overlay";
  overlay.id = "sp-caller-survey-overlay";
  overlay.innerHTML = `
    <div class="sp-modal" style="max-width:480px;">
      <h3>💙 How was your session?</h3>
      <p style="font-size:14px;color:#8a9bb0;margin-bottom:20px;">Your feedback helps us improve and show the impact of our work.</p>

      <div class="sp-field-label">How helpful was your listener today?</div>
      <div class="wd-rating-row" id="caller-rating-row">
        ${[1,2,3,4,5].map(function(n){ return `<button class="wd-rating-btn" onclick="callerSelectRating(${n})" data-rating="${n}">${"⭐".repeat(n)}</button>`; }).join("")}
      </div>

      <div class="sp-field-label" style="margin-top:16px;">How are you feeling after this call?</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
        ${["Better 😊","Same 😐","Heard 🤝","Hopeful 🌱","Calm 🕊️"].map(function(f){
          return `<button class="wd-topic-btn" onclick="this.classList.toggle('active')">${f}</button>`;
        }).join("")}
      </div>

      <div class="sp-field-label">Anything you'd like to share? (optional)</div>
      <textarea class="sp-input" id="caller-survey-notes" rows="2" placeholder="Your thoughts are private and help us improve…"></textarea>

      <div class="sp-modal-actions">
        <button class="sp-cancel-btn" onclick="callerSubmitSurvey('${callId}', true)">Skip</button>
        <button class="sp-btn" onclick="callerSubmitSurvey('${callId}', false)">Submit</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

var __callerRating = 5;
window.callerSelectRating = function(n){
  __callerRating = n;
  document.querySelectorAll("#caller-rating-row .wd-rating-btn").forEach(function(b){
    b.style.opacity = parseInt(b.dataset.rating) <= n ? "1" : "0.3";
  });
};

window.callerSubmitSurvey = async function(callId, skip){
  var notes    = skip ? "" : (document.getElementById("caller-survey-notes")||{}).value||"";
  var feelings = [];
  if(!skip){
    document.querySelectorAll(".wd-topic-btn.active").forEach(function(b){ feelings.push(b.textContent); });
  }
  await SP_DB.ref("spiritSurveys/" + callId + "/callerResponse").set({
    rating:   __callerRating,
    feelings: feelings,
    notes:    notes,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });
  var o = document.getElementById("sp-caller-survey-overlay");
  if(o) o.remove();
  spToast("Thank you for your feedback 💙","success");
};

async function wdLoadRecentSessions(){
  var list = document.getElementById("wd-sessions-list");
  if(!list) return;
  var snap = await SP_DB.ref("spiritCalls")
    .orderByChild("workerId").equalTo(spUser.uid)
    .limitToLast(10).once("value");
  var sessions = [];
  snap.forEach(function(c){ sessions.unshift({ id: c.key, ...c.val() }); });
  sessions = sessions.filter(function(s){ return s.status === "ended"; });
  if(!sessions.length){ list.innerHTML = '<div style="color:#8a9bb0;font-size:14px;">No completed sessions yet.</div>'; return; }
  list.innerHTML = sessions.map(function(s){
    var date = s.endedAt ? new Date(s.endedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "–";
    return `
      <div class="sp-call-history-item">
        <div class="sp-call-history-header">
          <span class="sp-call-history-date">📅 ${date} · ${s.shift||"Day"} shift</span>
          <span class="sp-call-history-duration">⏱ ${s.duration||30} min · $${s.workerRate||(s.shift==="Morning"?10:20)} earned</span>
        </div>
        ${s.workerNotes ? `<div class="sp-call-history-note">📝 ${escHtml(s.workerNotes)}</div>` : ""}
      </div>`;
  }).join("");
}

/* Start caller survey listener when app loads */
wdListenForCallerSurvey();

/* ═══════════════════════════════════════════
   BIRTH CHART MODAL
═══════════════════════════════════════════ */
window.spOpenBirthModal = function(){
  var b = spProfile.birthChart || {};
  var overlay = document.createElement("div");
  overlay.className = "sp-modal-overlay";
  overlay.id = "sp-modal-overlay";
  overlay.innerHTML = `
    <div class="sp-modal">
      <h3>🌙 Birth Chart & Spiritual Profile</h3>
      <p style="font-size:13px;color:#8a9bb0;margin-bottom:20px;line-height:1.6;">
        Your birth details help our AI generate spiritual insights personalized to your chart. All information is private and only used to support your path.
      </p>

      <div class="sp-field-label">Date of Birth</div>
      <input class="sp-input" id="b-date" type="date" value="${b.birthDate||""}">

      <div class="sp-field-label" style="margin-top:12px;">Time of Birth <span style="color:#7a8fa6;font-weight:400;">(optional — for rising sign)</span></div>
      <input class="sp-input" id="b-time" type="time" value="${b.birthTime||""}">

      <div class="sp-field-label" style="margin-top:12px;">City of Birth</div>
      <input class="sp-input" id="b-city" placeholder="e.g. St. Louis, Missouri" value="${b.birthCity||""}">

      <div class="sp-field-label" style="margin-top:12px;">Sun Sign <span style="color:#7a8fa6;font-weight:400;">(if you know it)</span></div>
      <select class="sp-input" id="b-sun">
        <option value="">Select or leave blank to auto-calculate</option>
        ${["Aries ♈","Taurus ♉","Gemini ♊","Cancer ♋","Leo ♌","Virgo ♍","Libra ♎","Scorpio ♏","Sagittarius ♐","Capricorn ♑","Aquarius ♒","Pisces ♓"].map(function(s){
          return `<option value="${s}" ${b.sunSign===s?"selected":""}>${s}</option>`;
        }).join("")}
      </select>

      <div class="sp-field-label" style="margin-top:12px;">Moon Sign <span style="color:#7a8fa6;font-weight:400;">(optional)</span></div>
      <select class="sp-input" id="b-moon">
        <option value="">Unknown</option>
        ${["Aries ♈","Taurus ♉","Gemini ♊","Cancer ♋","Leo ♌","Virgo ♍","Libra ♎","Scorpio ♏","Sagittarius ♐","Capricorn ♑","Aquarius ♒","Pisces ♓"].map(function(s){
          return `<option value="${s}" ${b.moonSign===s?"selected":""}>${s}</option>`;
        }).join("")}
      </select>

      <div class="sp-field-label" style="margin-top:12px;">Rising Sign <span style="color:#7a8fa6;font-weight:400;">(optional)</span></div>
      <select class="sp-input" id="b-rising">
        <option value="">Unknown</option>
        ${["Aries ♈","Taurus ♉","Gemini ♊","Cancer ♋","Leo ♌","Virgo ♍","Libra ♎","Scorpio ♏","Sagittarius ♐","Capricorn ♑","Aquarius ♒","Pisces ♓"].map(function(s){
          return `<option value="${s}" ${b.risingSign===s?"selected":""}>${s}</option>`;
        }).join("")}
      </select>

      <div class="sp-field-label" style="margin-top:12px;">Spiritual note about yourself <span style="color:#7a8fa6;font-weight:400;">(optional)</span></div>
      <textarea class="sp-input" id="b-note" rows="3" placeholder="e.g. I'm very intuitive, I feel deeply connected to nature, I've been on a spiritual awakening…">${b.spiritualNote||""}</textarea>

      <div class="sp-modal-actions">
        <button class="sp-cancel-btn" onclick="spCloseModal()">Cancel</button>
        <button class="sp-btn" id="birth-save-btn" onclick="spSaveBirthChart()">✨ Generate My Reading</button>
      </div>
    </div>`;
  overlay.addEventListener("click", function(e){ if(e.target===overlay) spCloseModal(); });
  document.body.appendChild(overlay);

  /* Auto-calculate sun sign from birth date */
  document.getElementById("b-date").addEventListener("change", function(){
    var date = new Date(this.value);
    var sign = spCalculateSunSign(date);
    if(sign){
      var sel = document.getElementById("b-sun");
      for(var i=0; i<sel.options.length; i++){
        if(sel.options[i].value.startsWith(sign)){ sel.selectedIndex = i; break; }
      }
    }
  });
};

window.spCalculateSunSign = function(date){
  var m = date.getMonth()+1, d = date.getDate();
  if((m===3&&d>=21)||(m===4&&d<=19)) return "Aries";
  if((m===4&&d>=20)||(m===5&&d<=20)) return "Taurus";
  if((m===5&&d>=21)||(m===6&&d<=20)) return "Gemini";
  if((m===6&&d>=21)||(m===7&&d<=22)) return "Cancer";
  if((m===7&&d>=23)||(m===8&&d<=22)) return "Leo";
  if((m===8&&d>=23)||(m===9&&d<=22)) return "Virgo";
  if((m===9&&d>=23)||(m===10&&d<=22)) return "Libra";
  if((m===10&&d>=23)||(m===11&&d<=21)) return "Scorpio";
  if((m===11&&d>=22)||(m===12&&d<=21)) return "Sagittarius";
  if((m===12&&d>=22)||(m===1&&d<=19)) return "Capricorn";
  if((m===1&&d>=20)||(m===2&&d<=18)) return "Aquarius";
  return "Pisces";
};

window.spSaveBirthChart = async function(){
  var btn = document.getElementById("birth-save-btn");
  if(btn){ btn.disabled = true; btn.textContent = "✨ Generating your reading…"; }

  var birthDate  = document.getElementById("b-date").value;
  var birthTime  = document.getElementById("b-time").value;
  var birthCity  = document.getElementById("b-city").value.trim();
  var sunSign    = document.getElementById("b-sun").value;
  var moonSign   = document.getElementById("b-moon").value;
  var risingSign = document.getElementById("b-rising").value;
  var spirNote   = document.getElementById("b-note").value.trim();

  /* Auto-calc sun sign if not set */
  if(!sunSign && birthDate){
    var d = new Date(birthDate);
    var calcSign = spCalculateSunSign(d);
    if(calcSign){
      var sel = document.getElementById("b-sun");
      for(var i=0;i<sel.options.length;i++){
        if(sel.options[i].value.startsWith(calcSign)){ sunSign = sel.options[i].value; sel.selectedIndex=i; break; }
      }
    }
  }

  var birthChart = {
    birthDate:    birthDate,
    birthTime:    birthTime||"Unknown",
    birthCity:    birthCity,
    sunSign:      sunSign,
    moonSign:     moonSign,
    risingSign:   risingSign,
    spiritualNote: spirNote,
    updatedAt:    firebase.database.ServerValue.TIMESTAMP
  };

  /* Generate AI reading */
  try {
    var apiKey = await SP_DB.ref("config/geminiKey").once("value").then(function(s){ return s.val(); });
    if(apiKey){
      var s = spProfile.struggles||[];
      var g = spProfile.goals||[];
      var prompt = `You are an expert astrologer and spiritual life coach. Generate a warm, personal, meaningful birth chart reading for someone born on ${birthDate||"unknown date"}${birthTime?" at "+birthTime:""}${birthCity?" in "+birthCity:""}.
Known signs: Sun: ${sunSign||"unknown"}, Moon: ${moonSign||"unknown"}, Rising: ${risingSign||"unknown"}.
${spirNote?"They describe themselves spiritually as: "+spirNote+".":""}
${s.filter(Boolean).length?"They are currently struggling with: "+s.filter(Boolean).join(", ")+".":""}
${g.filter(Boolean).length?"Their goals are: "+g.filter(Boolean).join(", ")+".":""}

Provide:
1. A 2-sentence overview of their core personality from their chart
2. What their chart reveals about their current challenges
3. What their chart says about their path forward
4. One powerful spiritual practice or focus area for right now
5. An encouraging closing message

Keep it personal, warm, and actionable. No jargon. 3-4 sentences per section.`;

      var res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + apiKey, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      var data = await res.json();
      if(res.status !== 429 && data.candidates && data.candidates[0]){
        birthChart.aiReading = data.candidates[0].content.parts[0].text;
        birthChart.readingGeneratedAt = firebase.database.ServerValue.TIMESTAMP;
      }
    }
  } catch(e){ console.log("AI reading error:", e); }

  await SP_DB.ref("spirits/" + spUser.uid + "/birthChart").set(birthChart);
  spProfile.birthChart = birthChart;
  spCloseModal();
  spToast("Birth chart saved ✓","success");
  document.getElementById("sp-content").innerHTML = renderProfile();
};

/* ═══════════════════════════════════════════
   ADMIN RESOURCES — sidebar loader
═══════════════════════════════════════════ */
function loadAdminResources(){
  SP_DB.ref("spiritAdminResources").orderByChild("active").equalTo(true).once("value", function(snap){
    var resources = [];
    snap.forEach(function(c){ resources.push({ id: c.key, ...c.val() }); });
    var el = document.getElementById("sp-admin-resources-sidebar");
    if(!el) return;
    if(!resources.length){ el.innerHTML = ""; return; }
    el.innerHTML = resources.map(function(r){
      return `
        <div class="sp-resource-card" onclick="spShowAdminResourcePopup('${r.id}')" style="cursor:pointer;margin-bottom:10px;">
          <div class="sp-resource-icon">${r.icon||"📌"}</div>
          <div class="sp-resource-info">
            <div class="sp-resource-cat">${r.category||"Resource"}</div>
            <div class="sp-resource-name">${r.title||""}</div>
          </div>
          <div class="sp-resource-arrow">→</div>
        </div>`;
    }).join("");
  });
}

window.spShowAdminResourcePopup = function(id){
  SP_DB.ref("spiritAdminResources/" + id).once("value", function(snap){
    var r = snap.val();
    if(!r) return;
    var overlay = document.createElement("div");
    overlay.className = "sp-emergency-overlay";
    overlay.id = "sp-resource-overlay";
    overlay.innerHTML = `
      <div class="sp-emergency-popup" onclick="event.stopPropagation()">
        <div class="sp-emergency-popup-icon">${r.icon||"📌"}</div>
        <h3>${r.title||"Resource"}</h3>
        <div style="font-size:13px;color:#8a9bb0;text-align:center;margin:10px 0 16px;line-height:1.7;">${r.description||""}</div>
        ${r.phone ? `<div class="sp-emergency-item" onclick="spShowEmergencyPopup" style="text-align:center;margin-bottom:8px;cursor:default;">📞 ${r.phone}</div>` : ""}
        ${r.url ? `<a href="${r.url}" target="_blank" class="sp-emergency-popup-call" style="background:linear-gradient(135deg,#00d4aa,#00b090);color:#000;">🔗 Visit Resource</a>` : ""}
        <button class="sp-emergency-popup-close" onclick="spCloseResourcePopup()">Close</button>
      </div>`;
    overlay.addEventListener("click", spCloseResourcePopup);
    document.body.appendChild(overlay);
  });
};

/* Load admin resources when app starts */
SP_AUTH.onAuthStateChanged(function(user){
  if(user) setTimeout(loadAdminResources, 2000);
});

/* ═══════════════════════════════════════════
   WARNING BANNER — shows during call
═══════════════════════════════════════════ */
function wdShowWarningBanner(msg, type){
  var existing = document.getElementById("wd-warning-banner");
  if(existing) existing.remove();
  var banner = document.createElement("div");
  banner.id = "wd-warning-banner";
  banner.style.cssText = "position:fixed;top:62px;left:0;right:0;z-index:150;padding:14px 24px;text-align:center;font-size:14px;font-weight:700;animation:slideDown 0.3s ease;";
  if(type === "gold"){
    banner.style.background = "linear-gradient(135deg,#2a1f00,#3a2a00)";
    banner.style.borderBottom = "2px solid #f5c842";
    banner.style.color = "#f5c842";
  } else {
    banner.style.background = "linear-gradient(135deg,#2a0000,#3a0a0a)";
    banner.style.borderBottom = "2px solid #e05555";
    banner.style.color = "#e05555";
  }
  banner.innerHTML = msg + ' <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;cursor:pointer;margin-left:12px;font-size:16px;">×</button>';
  document.body.appendChild(banner);
  setTimeout(function(){ if(banner.parentElement) banner.remove(); }, 15000);
}

/* ═══════════════════════════════════════════
   ESCALATE TO CLINICAL HOTLINE
═══════════════════════════════════════════ */
window.wdEscalateToClinical = async function(callId){
  /* Push emergency numbers to caller's screen via Firebase */
  await SP_DB.ref("spiritCalls/" + callId).update({
    escalated:   true,
    escalatedAt: firebase.database.ServerValue.TIMESTAMP
  });

  /* Show confirmation to worker */
  var overlay = document.createElement("div");
  overlay.className = "sp-emergency-overlay";
  overlay.id = "sp-escalate-overlay";
  overlay.innerHTML = `
    <div class="sp-emergency-popup" onclick="event.stopPropagation()">
      <div class="sp-emergency-popup-icon">🚨</div>
      <h3>Clinical Escalation</h3>
      <p style="margin-bottom:16px;">Emergency resources have been pushed to the patient's screen. Please stay on the line while they call for help.</p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
        <a href="tel:988" class="sp-emergency-popup-call" style="background:linear-gradient(135deg,#7b2ff7,#5a1fd4);">📞 Call 988 — Crisis Lifeline</a>
        <a href="tel:911" class="sp-emergency-popup-call" style="background:linear-gradient(135deg,#e05555,#c03030);margin-top:0;">🚨 Call 911 — Emergency</a>
        <a href="tel:18007996366" class="sp-emergency-popup-call" style="background:linear-gradient(135deg,#2a5040,#1a3028);margin-top:0;">🔥 SAMHSA Helpline</a>
      </div>
      <button class="sp-emergency-popup-close" onclick="document.getElementById('sp-escalate-overlay').remove()">Close</button>
    </div>`;
  overlay.addEventListener("click", function(e){ if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  spToast("🚨 Emergency resources sent to patient screen","error",8000);
};

/* Listen for escalation on caller side */
function spListenForEscalation(callId){
  SP_DB.ref("spiritCalls/" + callId + "/escalated").on("value", function(snap){
    if(snap.val() === true){
      spShowEscalationAlert();
    }
  });
}

function spShowEscalationAlert(){
  var existing = document.getElementById("sp-escalation-alert");
  if(existing) return;
  var overlay = document.createElement("div");
  overlay.className = "sp-emergency-overlay";
  overlay.id = "sp-escalation-alert";
  overlay.innerHTML = `
    <div class="sp-emergency-popup" onclick="event.stopPropagation()" style="border-color:#e05555;">
      <div class="sp-emergency-popup-icon">🚨</div>
      <h3 style="color:#e05555;">Your listener needs you to call for help</h3>
      <p style="margin-bottom:20px;line-height:1.7;">Your Spirit listener has recommended you reach out to a crisis service right now. You are not alone. Please call one of the numbers below.</p>
      <a href="tel:988" class="sp-emergency-popup-call" style="background:linear-gradient(135deg,#7b2ff7,#5a1fd4);margin-bottom:8px;display:block;text-align:center;text-decoration:none;padding:16px;border-radius:8px;font-weight:700;color:#fff;">📞 988 — Free Crisis Lifeline (24/7)</a>
      <a href="tel:911" class="sp-emergency-popup-call" style="background:linear-gradient(135deg,#e05555,#c03030);margin-bottom:8px;display:block;text-align:center;text-decoration:none;padding:16px;border-radius:8px;font-weight:700;color:#fff;">🚨 911 — Emergency Services</a>
      <a href="tel:18007996366" class="sp-emergency-popup-call" style="background:linear-gradient(135deg,#1a3028,#0a1820);display:block;text-align:center;text-decoration:none;padding:16px;border-radius:8px;font-weight:700;color:#00d4aa;">🔥 SAMHSA Helpline — 1-800-799-6366</a>
      <button class="sp-emergency-popup-close" style="margin-top:10px;" onclick="document.getElementById('sp-escalation-alert').remove()">I understand — close</button>
    </div>`;
  document.body.appendChild(overlay);
}

/* ═══════════════════════════════════════════
   CALLER COUNTDOWN CLOCK
═══════════════════════════════════════════ */
var __callerCountdownTimer = null;

window.spStartCallerCountdown = function(){
  var startTime = Date.now();
  var SESSION_SECS = 30 * 60;
  var warned5 = false;
  var overlay = document.getElementById("sp-call-overlay");

  /* Show the timer box */
  var timerBox = document.getElementById("caller-timer-box");
  if(timerBox) timerBox.style.display = "block";

  __callerCountdownTimer = setInterval(function(){
    var elapsed = Math.floor((Date.now() - startTime) / 1000);
    var remain  = Math.max(0, SESSION_SECS - elapsed);
    var rMins   = Math.floor(remain/60).toString().padStart(2,"0");
    var rSecs   = (remain%60).toString().padStart(2,"0");

    var cdEl = document.getElementById("caller-countdown");
    if(!cdEl){ clearInterval(__callerCountdownTimer); return; }
    cdEl.textContent = rMins + ":" + rSecs;

    if(remain <= 120)      cdEl.style.color = "#e05555";
    else if(remain <= 300) cdEl.style.color = "#f5c842";
    else                   cdEl.style.color = "#00d4aa";

    /* 5-minute warning to caller */
    if(remain <= 300 && remain > 299 && !warned5){
      warned5 = true;
      var banner = document.getElementById("caller-warning-banner");
      if(banner) banner.innerHTML = `<div style="background:rgba(245,200,66,0.1);border:1px solid rgba(245,200,66,0.3);color:#f5c842;padding:10px 14px;border-radius:8px;font-size:13px;margin-top:8px;">⏰ 5 minutes remaining — please begin wrapping up with your listener.</div>`;
    }

    if(remain <= 0){
      clearInterval(__callerCountdownTimer);
      var cdEl2 = document.getElementById("caller-countdown");
      if(cdEl2) cdEl2.textContent = "00:00";
    }
  }, 1000);
};

/* ═══════════════════════════════════════════
   ACCESSIBILITY LAYER (WCAG 2.1 AA)
═══════════════════════════════════════════ */

/* Add skip-to-content link once on load */
function a11yInit(){
  if(document.getElementById("sp-skip-link")) return;

  var skip = document.createElement("a");
  skip.id = "sp-skip-link";
  skip.className = "skip-link";
  skip.href = "#sp-content";
  skip.textContent = "Skip to main content";
  document.body.insertBefore(skip, document.body.firstChild);

  /* Add live region for toast announcements */
  var live = document.createElement("div");
  live.id = "sp-live-region";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.className = "sr-only";
  document.body.appendChild(live);

  /* Font size controls */
  var fontControls = document.createElement("div");
  fontControls.className = "sp-font-controls";
  fontControls.setAttribute("role", "group");
  fontControls.setAttribute("aria-label", "Text size controls");
  fontControls.innerHTML = `
    <button class="sp-font-btn" id="font-normal" onclick="a11ySetFontSize('normal')" aria-label="Normal text size" title="Normal text">A</button>
    <button class="sp-font-btn" id="font-large" onclick="a11ySetFontSize('large')" aria-label="Large text size" title="Large text">A+</button>
    <button class="sp-font-btn" id="font-xl" onclick="a11ySetFontSize('xl')" aria-label="Extra large text size" title="Extra large text">A++</button>
  `;
  document.body.appendChild(fontControls);

  /* Restore saved font size preference */
  var saved = localStorage.getItem("sp-font-size");
  if(saved) a11ySetFontSize(saved);
  else document.getElementById("font-normal").classList.add("active");
}

window.a11ySetFontSize = function(size){
  document.body.classList.remove("sp-large-text", "sp-xl-text");
  document.querySelectorAll(".sp-font-btn").forEach(function(b){ b.classList.remove("active"); });

  if(size === "large"){
    document.body.classList.add("sp-large-text");
    document.getElementById("font-large").classList.add("active");
  } else if(size === "xl"){
    document.body.classList.add("sp-xl-text");
    document.getElementById("font-xl").classList.add("active");
  } else {
    document.getElementById("font-normal").classList.add("active");
  }

  try { localStorage.setItem("sp-font-size", size); } catch(e){}
};

/* Announce messages to screen readers (called alongside toasts) */
function a11yAnnounce(msg){
  var live = document.getElementById("sp-live-region");
  if(live){ live.textContent = ""; setTimeout(function(){ live.textContent = msg; }, 50); }
}

/* Auto-inject ARIA attributes after every render */
function a11yEnhance(){
  /* Label all icon-only buttons */
  document.querySelectorAll("button:not([aria-label])").forEach(function(btn){
    var text = btn.textContent.trim();
    if(text && text.length < 3 && !btn.getAttribute("aria-label")){
      /* Likely icon-only, try to infer from title or leave text as label */
      btn.setAttribute("aria-label", text);
    }
  });

  /* Add role to nav tabs */
  var tabBar = document.querySelector(".sp-tabs");
  if(tabBar && !tabBar.getAttribute("role")){
    tabBar.setAttribute("role", "tablist");
    tabBar.setAttribute("aria-label", "Main navigation");
    tabBar.querySelectorAll(".sp-tab").forEach(function(tab, i){
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", tab.classList.contains("active") ? "true" : "false");
      tab.setAttribute("tabindex", tab.classList.contains("active") ? "0" : "-1");
    });
  }

  /* Main content landmark */
  var content = document.getElementById("sp-content");
  if(content && !content.getAttribute("role")){
    content.setAttribute("role", "main");
    content.setAttribute("aria-label", "Main content");
  }

  /* Sidebar landmark */
  var sidebar = document.getElementById("sp-sidebar");
  if(sidebar && !sidebar.getAttribute("role")){
    sidebar.setAttribute("role", "complementary");
    sidebar.setAttribute("aria-label", "Resources and emergency numbers");
  }

  /* Avatar images need alt text */
  document.querySelectorAll(".sp-avatar img, .sp-post-avatar img, .sp-nav-avatar img").forEach(function(img){
    if(!img.getAttribute("alt") || img.getAttribute("alt")==="photo" || img.getAttribute("alt")==="avatar"){
      img.setAttribute("alt", "Profile photo");
    }
  });

  /* Form inputs need labels — add aria-label from placeholder if missing */
  document.querySelectorAll("input:not([aria-label]):not([aria-labelledby]), textarea:not([aria-label]):not([aria-labelledby]), select:not([aria-label]):not([aria-labelledby])").forEach(function(el){
    var placeholder = el.getAttribute("placeholder");
    if(placeholder){ el.setAttribute("aria-label", placeholder); }
    else if(el.tagName === "SELECT" && el.options[0]){
      el.setAttribute("aria-label", el.options[0].textContent);
    }
  });

  /* Loading spinners need aria-live */
  document.querySelectorAll(".sp-loading").forEach(function(el){
    if(!el.getAttribute("role")){
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.setAttribute("aria-label", "Loading content");
    }
  });

  /* Modal overlays need proper dialog semantics */
  document.querySelectorAll(".sp-modal-overlay").forEach(function(overlay){
    if(!overlay.getAttribute("role")){
      overlay.setAttribute("role", "presentation");
      var modal = overlay.querySelector(".sp-modal");
      if(modal){
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        var heading = modal.querySelector("h3");
        if(heading){
          if(!heading.id) heading.id = "modal-heading-" + Date.now();
          modal.setAttribute("aria-labelledby", heading.id);
        }
        /* Trap focus and focus first input */
        var firstInput = modal.querySelector("input, textarea, select, button");
        if(firstInput) setTimeout(function(){ firstInput.focus(); }, 50);
      }
    }
  });

  /* Emergency popups need alert role */
  document.querySelectorAll(".sp-emergency-overlay").forEach(function(overlay){
    if(!overlay.getAttribute("role")){
      overlay.setAttribute("role", "alertdialog");
      overlay.setAttribute("aria-modal", "true");
      var popup = overlay.querySelector(".sp-emergency-popup");
      if(popup){
        var heading = popup.querySelector("h3");
        if(heading){
          if(!heading.id) heading.id = "alert-heading-" + Date.now();
          overlay.setAttribute("aria-labelledby", heading.id);
        }
      }
    }
  });
}

/* Keyboard navigation for tabs (arrow keys) */
function a11yTabKeyboardNav(){
  document.addEventListener("keydown", function(e){
    var tabBar = document.querySelector(".sp-tabs");
    if(!tabBar || !tabBar.contains(document.activeElement)) return;
    var tabs = Array.from(tabBar.querySelectorAll(".sp-tab"));
    var idx = tabs.indexOf(document.activeElement);
    if(idx === -1) return;

    if(e.key === "ArrowRight"){
      e.preventDefault();
      var next = tabs[(idx+1) % tabs.length];
      next.focus(); next.click();
    } else if(e.key === "ArrowLeft"){
      e.preventDefault();
      var prev = tabs[(idx-1+tabs.length) % tabs.length];
      prev.focus(); prev.click();
    }
  });
}

/* Escape key closes modals */
document.addEventListener("keydown", function(e){
  if(e.key === "Escape"){
    var modalOverlay = document.getElementById("sp-modal-overlay");
    var emergencyOverlay = document.getElementById("sp-emergency-overlay") || document.getElementById("sp-resource-overlay") || document.getElementById("sp-call-overlay");
    if(modalOverlay) spCloseModal();
    if(emergencyOverlay) emergencyOverlay.remove();
  }
});

/* Run enhancement after every DOM change via MutationObserver */
var a11yObserver = new MutationObserver(function(){
  clearTimeout(window.__a11yDebounce);
  window.__a11yDebounce = setTimeout(a11yEnhance, 100);
});

/* Initialize accessibility layer once DOM is ready */
function a11yStart(){
  a11yInit();
  a11yEnhance();
  a11yTabKeyboardNav();
  var app = document.getElementById("sp-app");
  if(app) a11yObserver.observe(app, { childList: true, subtree: true });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", a11yStart);
} else {
  a11yStart();
}

/* Hook into existing spToast to also announce to screen readers */
var __originalSpToast = window.spToast;
window.spToast = function(msg, type, duration){
  if(__originalSpToast) __originalSpToast(msg, type, duration);
  a11yAnnounce(msg);
};

/* ═══════════════════════════════════════════
   WHO I STRIVE TO BE — Modal
═══════════════════════════════════════════ */
var STRIVE_ROLES = ["Business Owner","Entrepreneur","Skilled Tradesperson","Healthcare Worker","Teacher & Educator","Community Leader","Real Estate Investor","Tech Professional","Creative Artist","Financial Advisor","Social Worker","Nonprofit Leader","Law Enforcement","Legal Professional","Military Veteran","Stay-at-Home Parent","Athlete & Coach","Restaurant Owner","Transportation Professional","Other"];
var STRIVE_FINANCIAL = ["Debt-free","Financially independent","Homeowner","Car owner","Able to support my family","Building generational wealth","Earning $50K+/year","Earning $75K+/year","Earning $100K+/year","Business earning $500K+/year","Out of poverty","Building an emergency fund","Investing in my future","Other"];
var STRIVE_LIFESTYLE = ["Stable housing","Safe neighborhood","Healthy & active","Spiritually grounded","Strong family bonds","Sober & clean","Peaceful & low-stress","Giving back to community","Traveling freely","Working for myself","Balanced work & life","Free from legal issues","Other"];
var STRIVE_IMPACT = ["Mentor others like me","Hire people from my community","Build a community organization","Advocate for policy change","Support local youth","Create jobs","Donate to causes I believe in","Be a role model for my children","Help end poverty in my area","Build affordable housing","Other"];

window.spOpenStriveModal = function(){
  var st = spProfile.striveTo || {};
  var overlay = document.createElement("div");
  overlay.className = "sp-modal-overlay";
  overlay.id = "sp-modal-overlay";
  overlay.innerHTML = `
    <div class="sp-modal">
      <h3>🚀 Who I Strive To Be</h3>
      <p style="font-size:13px;color:#8a9bb0;margin-bottom:20px;line-height:1.7;">
        This is your vision. Not where you are — where you're going. Be bold. Be specific. This is what drives your path.
      </p>

      <div class="sp-field-label">My Future Role / Career</div>
      <select class="sp-input" id="st-role" aria-label="My future role">
        <option value="">Select your future role…</option>
        ${STRIVE_ROLES.map(function(o){ return `<option value="${o}" ${st.role===o?"selected":""}>${o}</option>`; }).join("")}
      </select>

      <div class="sp-field-label" style="margin-top:12px;">My Financial Goal</div>
      <select class="sp-input" id="st-financial" aria-label="My financial goal">
        <option value="">Select your financial goal…</option>
        ${STRIVE_FINANCIAL.map(function(o){ return `<option value="${o}" ${st.financial===o?"selected":""}>${o}</option>`; }).join("")}
      </select>

      <div class="sp-field-label" style="margin-top:12px;">My Ideal Lifestyle</div>
      <select class="sp-input" id="st-lifestyle" aria-label="My ideal lifestyle">
        <option value="">Select your lifestyle goal…</option>
        ${STRIVE_LIFESTYLE.map(function(o){ return `<option value="${o}" ${st.lifestyle===o?"selected":""}>${o}</option>`; }).join("")}
      </select>

      <div class="sp-field-label" style="margin-top:12px;">How I Want to Impact My Community</div>
      <select class="sp-input" id="st-impact" aria-label="Community impact goal">
        <option value="">Select your impact goal…</option>
        ${STRIVE_IMPACT.map(function(o){ return `<option value="${o}" ${st.impact===o?"selected":""}>${o}</option>`; }).join("")}
      </select>

      <div class="sp-modal-actions">
        <button class="sp-cancel-btn" onclick="spCloseModal()">Cancel</button>
        <button class="sp-btn" onclick="spSaveStriveTo()">Save My Vision</button>
      </div>
    </div>`;
  overlay.addEventListener("click", function(e){ if(e.target===overlay) spCloseModal(); });
  document.body.appendChild(overlay);
};

window.spSaveStriveTo = async function(){
  var striveTo = {
    role:      document.getElementById("st-role").value,
    financial: document.getElementById("st-financial").value,
    lifestyle: document.getElementById("st-lifestyle").value,
    impact:    document.getElementById("st-impact").value,
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  };
  await SP_DB.ref("spirits/" + spUser.uid + "/striveTo").set(striveTo);
  spProfile.striveTo = striveTo;
  spCloseModal();
  spToast("Your vision saved ✓","success");
  document.getElementById("sp-content").innerHTML = renderProfile();
};

/* ═══════════════════════════════════════════
   BIRTH CHART READING — My Path page
═══════════════════════════════════════════ */
window.spGenerateBirthReading = async function(){
  var birthDate = document.getElementById("birth-date-input").value;
  var birthTime = document.getElementById("birth-time-input").value;
  var birthCity = document.getElementById("birth-city-input").value.trim();
  var result    = document.getElementById("birth-reading-result");
  var btn       = document.getElementById("birth-read-btn");

  if(!birthDate){ spToast("Please enter your date of birth","error"); return; }

  btn.disabled = true;
  btn.textContent = "🌙 Reading your chart…";
  result.className = "sp-ai-result show";
  result.innerHTML = '<div class="sp-ai-thinking"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span style="margin-left:10px;color:#8a9bb0;">Looking up your chart…</span></div>';

  /* Calculate sun sign */
  var d = new Date(birthDate);
  var sunSign = spCalculateSunSign(d) || "unknown";

  /* Save birth info first */
  var birthChart = {
    birthDate: birthDate,
    birthTime: birthTime || "Unknown",
    birthCity: birthCity || "Unknown",
    sunSign:   sunSign,
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  };

  try {
    var apiKey = await SP_DB.ref("config/geminiKey").once("value").then(function(s){ return s.val(); });
    if(!apiKey){ throw new Error("no_key"); }

    var s = (spProfile.struggles||[]).filter(Boolean);
    var g = (spProfile.goals||[]).filter(Boolean);
    var st = spProfile.striveTo || {};

    var prompt = `You are an astrologer giving a simple, warm, personal reading. The person was born on ${birthDate}${birthTime?" at "+birthTime:""}${birthCity?" in "+birthCity:""}. Their sun sign is ${sunSign}.

${s.length?"They are currently struggling with: "+s.join(", ")+".":""}
${g.length?"Their goals include: "+g.join(", ")+".":""}
${st.role?"They strive to become: "+st.role+".":""}

Give them:
1. A simple 2-sentence explanation of what their ${sunSign} sun sign means about who they are at their core.
2. What their chart suggests they may be experiencing or feeling right now (2-3 sentences).
3. What they should focus on or prepare for in the coming weeks (2-3 sentences).
4. One specific strength from their sign they should lean into right now (1-2 sentences).

Keep it simple, warm, grounded, and hopeful. No jargon. Write directly to them as "you".`;

    var res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + apiKey, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    if(res.status === 429){ throw new Error("rate_limit"); }
    var data = await res.json();
    var text = (data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts[0].text) || "";

    birthChart.aiReading = text;
    birthChart.readingGeneratedAt = firebase.database.ServerValue.TIMESTAMP;

    await SP_DB.ref("spirits/" + spUser.uid + "/birthChart").set(birthChart);
    spProfile.birthChart = birthChart;

    result.innerHTML = renderBirthReading(birthChart);
    spToast("Your reading is ready 🌙","success");

  } catch(e){
    if(e.message === "rate_limit"){
      result.innerHTML = '<div style="color:#f5c842;font-size:14px;padding:16px;background:rgba(245,200,66,0.08);border-radius:10px;">⏳ AI is busy. Please wait 60 seconds and try again.</div>';
    } else if(e.message === "no_key"){
      result.innerHTML = '<div style="color:#e05555;font-size:14px;padding:16px;">AI service not configured. Contact your administrator.</div>';
    } else {
      result.innerHTML = '<div style="color:#e05555;font-size:14px;padding:16px;">Something went wrong. Please try again.</div>';
    }
  }

  btn.disabled = false;
  btn.textContent = "🌙 Regenerate My Reading";
};

function renderBirthReading(b){
  if(!b || !b.aiReading) return "";
  var lines = b.aiReading.split("\n").filter(function(l){ return l.trim(); });
  return `
    <div style="margin-top:16px;">
      <div style="font-size:11px;color:#8a9bb0;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:14px;">
        ${b.sunSign||""} · Born ${b.birthDate||""} ${b.birthCity&&b.birthCity!=="Unknown"?" · "+b.birthCity:""}
      </div>
      ${lines.map(function(line){
        return `<div class="sp-ai-idea" style="margin-bottom:12px;">${escHtml(line.trim())}</div>`;
      }).join("")}
      ${renderBirthChatBox()}
    </div>`;
}

function renderBirthChatBox(){
  return `
    <div class="sp-ai-chat" id="birth-chat-box" style="margin-top:20px;">
      <div class="sp-ai-chat-title">💬 Ask a question about your reading</div>
      <div class="sp-ai-chat-history" id="birth-chat-history"></div>
      <div class="sp-ai-chat-input-row">
        <input class="sp-input" id="birth-chat-input" placeholder="What does this mean for my relationships? What should I avoid? …" aria-label="Ask a follow up question about your reading" style="margin-bottom:0;">
        <button class="sp-btn" onclick="spAskBirthQuestion()" style="width:auto;padding:13px 20px;white-space:nowrap;" aria-label="Submit question">Ask</button>
      </div>
    </div>`;
}

window.spAskBirthQuestion = async function(){
  var input   = document.getElementById("birth-chat-input");
  var history = document.getElementById("birth-chat-history");
  if(!input||!history) return;
  var question = input.value.trim();
  if(!question) return;
  input.value = "";

  history.innerHTML += `<div class="sp-chat-bubble sp-chat-user" role="log">${escHtml(question)}</div>`;
  history.innerHTML += `<div class="sp-chat-bubble sp-chat-ai" id="birth-thinking" aria-live="polite"><span class="sp-ai-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>`;
  history.scrollTop = history.scrollHeight;

  try {
    var apiKey = await SP_DB.ref("config/geminiKey").once("value").then(function(s){ return s.val(); });
    var b = spProfile.birthChart || {};
    var context = "You are a warm astrologer. The person is a "+( b.sunSign||"unknown sign")+" born on "+(b.birthDate||"unknown date")+(b.birthCity&&b.birthCity!=="Unknown"?" in "+b.birthCity:"")+". Their reading: "+(b.aiReading||"not generated")+". Answer their follow-up question simply and warmly in 3-4 sentences.";

    var res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + apiKey, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ contents: [{ parts: [{ text: context + "\n\nQuestion: " + question }] }] })
    });
    var data = await res.json();
    var answer = (data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts[0].text)||"I couldn't generate a response. Please try again.";

    var thinking = document.getElementById("birth-thinking");
    if(thinking) thinking.outerHTML = `<div class="sp-chat-bubble sp-chat-ai">${escHtml(answer)}</div>`;
    history.scrollTop = history.scrollHeight;

    /* Save to Firebase for future tracking */
    await SP_DB.ref("spirits/" + spUser.uid + "/birthChartQuestions").push({
      question, answer, ts: firebase.database.ServerValue.TIMESTAMP
    });
  } catch(e){
    var thinking = document.getElementById("birth-thinking");
    if(thinking) thinking.outerHTML = `<div class="sp-chat-bubble sp-chat-ai" style="color:#e07070;">Something went wrong. Please try again.</div>`;
  }
};

/* ═══════════════════════════════════════════
   MY RESOURCES TAB
═══════════════════════════════════════════ */
function renderMyResources(){
  return `
    <div class="sp-card">
      <div class="sp-card-title">📦 My Resources</div>
      <p style="font-size:14px;color:#8a9bb0;margin-bottom:20px;line-height:1.7;">
        Resources your Spirit team has found specifically for you. Check back regularly — we update this as we find new opportunities that match your goals.
      </p>
      <div id="sp-my-resources-list">
        <div class="sp-loading" style="height:120px;"><div class="sp-loading-ring"></div></div>
      </div>
    </div>
    <div class="sp-card">
      <div class="sp-card-title">🌐 Community Resources</div>
      <p style="font-size:13px;color:#8a9bb0;margin-bottom:16px;">Resources available to everyone in the community.</p>
      <div id="sp-community-resources-list">
        <div class="sp-loading" style="height:80px;"><div class="sp-loading-ring"></div></div>
      </div>
    </div>`;
}

function loadMyResources(){
  /* Load personal resources added by admin */
  SP_DB.ref("spirits/" + spUser.uid + "/adminResource").once("value", function(snap){
    var list = document.getElementById("sp-my-resources-list");
    if(!list) return;
    var items = [];
    snap.forEach(function(c){ items.push({ id: c.key, ...c.val() }); });
    items.sort(function(a,b){ return (b.addedAt||0)-(a.addedAt||0); });

    if(!items.length){
      list.innerHTML = `
        <div class="sp-empty">
          <div class="sp-empty-icon">📭</div>
          <p>No personal resources yet.<br>Your Spirit team is working on finding resources matched to your specific goals. Check back soon.</p>
        </div>`;
      return;
    }

    list.innerHTML = items.map(function(r){
      var date = r.addedAt ? new Date(r.addedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "";
      return `
        <div class="sp-resource-item" role="article">
          <div class="sp-resource-item-header">
            <div class="sp-resource-item-icon">📌</div>
            <div class="sp-resource-item-meta">
              <div style="font-size:11px;color:#8a9bb0;">Added by your Spirit team · ${date}</div>
            </div>
          </div>
          <div class="sp-resource-item-text">${escHtml(r.text||"")}</div>
          ${r.url ? `<a href="${escHtml(r.url)}" target="_blank" rel="noopener noreferrer" class="sp-resource-item-link" aria-label="Visit resource link">🔗 Visit Resource →</a>` : ""}
        </div>`;
    }).join("");
  });

  /* Load community-wide resources */
  SP_DB.ref("spiritAdminResources").orderByChild("active").equalTo(true).once("value", function(snap){
    var list = document.getElementById("sp-community-resources-list");
    if(!list) return;
    var resources = [];
    snap.forEach(function(c){ resources.push({ id: c.key, ...c.val() }); });
    if(!resources.length){ list.innerHTML = '<div style="color:#8a9bb0;font-size:14px;">No community resources yet.</div>'; return; }
    list.innerHTML = resources.map(function(r){
      return `
        <div class="sp-resource-card" onclick="spShowAdminResourcePopup('${r.id}')" style="cursor:pointer;margin-bottom:10px;" role="button" tabindex="0" aria-label="View ${r.title} resource">
          <div class="sp-resource-icon">${r.icon||"📌"}</div>
          <div class="sp-resource-info">
            <div class="sp-resource-cat">${r.category||"Resource"}</div>
            <div class="sp-resource-name">${r.title||""}</div>
          </div>
          <div class="sp-resource-arrow">→</div>
        </div>`;
    }).join("");
  });
}

/* ═══════════════════════════════════════════
   DYNAMIC HOME COLUMNS (admin-managed)
═══════════════════════════════════════════ */
function loadDynamicHomeColumns(){
  SP_DB.ref("spiritHomeColumns/" + spUser.uid).once("value", function(snap){
    var cols = [];
    snap.forEach(function(c){ cols.push({ id: c.key, ...c.val() }); });
    cols.sort(function(a,b){ return (a.order||0)-(b.order||0); });

    var container = document.getElementById("sp-dynamic-columns");
    if(!container) return;
    if(!cols.length){ container.innerHTML = ""; return; }

    container.innerHTML = cols.map(function(col){
      return `
        <div class="sp-card sp-dynamic-col" id="col-${col.id}" role="region" aria-label="${col.title||"Custom section"}">
          <div class="sp-card-title">${col.icon||"📋"} ${col.title||"Section"}</div>
          <div class="sp-dynamic-col-body">${col.content||""}</div>
          ${col.link ? `<a href="${escHtml(col.link)}" target="_blank" rel="noopener noreferrer" class="sp-resource-item-link" style="display:inline-block;margin-top:12px;">🔗 ${col.linkText||"Learn More"} →</a>` : ""}
        </div>`;
    }).join("");
  });
}

/* ═══════════════════════════════════════════
   UPDATE ADMIN - add dynamic columns panel
═══════════════════════════════════════════ */
window.saAddHomeColumn = async function(uid, title, content, icon, link, linkText){
  var order = Date.now();
  await SA_DB.ref("spiritHomeColumns/" + uid).push({
    title, content, icon: icon||"📋",
    link: link||"", linkText: linkText||"Learn More",
    order, createdAt: firebase.database.ServerValue.TIMESTAMP
  });
};

window.saRemoveHomeColumn = async function(uid, colId){
  await SA_DB.ref("spiritHomeColumns/" + uid + "/" + colId).remove();
};

/* ═══════════════════════════════════════════
   COMMUNITY BOARD — members view + heart
═══════════════════════════════════════════ */
function renderCommunityBoard(){
  return `
    <div class="sp-card" id="sp-board-card">
      <div class="sp-card-title">📢 Community Board</div>
      <p style="font-size:13px;color:#8a9bb0;margin-bottom:16px;line-height:1.6;">
        Updates, opportunities, and announcements from your Spirit team. Heart the ones that speak to you.
      </p>
      <div id="sp-board-list">
        <div class="sp-loading" style="height:80px;"><div class="sp-loading-ring"></div></div>
      </div>
    </div>`;
}

function loadCommunityBoard(){
  SP_DB.ref("spiritCommunityBoard").orderByChild("createdAt").limitToLast(10).once("value", function(snap){
    var posts = [];
    snap.forEach(function(c){ posts.unshift({ id: c.key, ...c.val() }); });
    var list = document.getElementById("sp-board-list");
    if(!list) return;
    if(!posts.length){
      list.innerHTML = '<div style="color:#8a9bb0;font-size:13px;text-align:center;padding:20px;">No announcements yet. Check back soon.</div>';
      return;
    }
    list.innerHTML = posts.map(function(p){
      var date = p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "";
      var hasLiked = (p.hearts && p.hearts[spUser.uid]) ? true : false;
      return `
        <div class="sp-board-post" id="board-${p.id}" role="article">
          <div class="sp-board-post-header">
            <span class="sp-board-icon">${p.icon||"📢"}</span>
            <div>
              <div class="sp-board-category">${p.category||"Announcement"}</div>
              <div class="sp-board-date">${date}</div>
            </div>
          </div>
          <div class="sp-board-title">${escHtml(p.title||"")}</div>
          <div class="sp-board-body">${escHtml(p.body||"")}</div>
          ${p.link ? `<a href="${escHtml(p.link)}" target="_blank" rel="noopener noreferrer" class="sp-resource-item-link" style="display:inline-block;margin-top:10px;">${escHtml(p.linkText||"Learn More")} →</a>` : ""}
          <div class="sp-board-actions">
            <button class="sp-heart-btn ${hasLiked?"hearted":""}" onclick="spHeartPost('${p.id}')" aria-label="${hasLiked?"Unlike":"Like"} this post">
              ${hasLiked?"❤️":"🤍"} <span id="hearts-${p.id}">${Object.keys(p.hearts||{}).length}</span>
            </button>
          </div>
        </div>`;
    }).join("");
  });
}

window.spHeartPost = async function(postId){
  var uid   = spUser.uid;
  var ref   = SP_DB.ref("spiritCommunityBoard/" + postId + "/hearts/" + uid);
  var snap  = await ref.once("value");
  var btn   = document.querySelector(`#board-${postId} .sp-heart-btn`);
  var count = document.getElementById("hearts-" + postId);

  if(snap.val()){
    await ref.remove();
    if(btn){ btn.className = "sp-heart-btn"; btn.innerHTML = "🤍 <span id='hearts-" + postId + "'>" + (parseInt(count.textContent)-1) + "</span>"; }
  } else {
    await ref.set(true);
    if(btn){ btn.className = "sp-heart-btn hearted"; btn.innerHTML = "❤️ <span id='hearts-" + postId + "'>" + (parseInt(count.textContent)+1) + "</span>"; }
  }
};
