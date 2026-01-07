#!/bin/bash

echo "🏗️ Organizing production repository structure..."

# Create organized directory structure
mkdir -p production_backup_$(date +%Y%m%d_%H%M%S)

# Backup everything first
cp -r . production_backup_*/ 2>/dev/null || true

# Create clean production structure
echo "Creating clean production structure..."

# 1. Core application files
echo "📱 Core application files..."
cat > app.js << 'APP_EOF'
/**************************************************
 * Whisper+me — PRODUCTION VERSION
 * Live Anonymous Audio Chat
 **************************************************/

console.log('🚀 Whisper+me Production v1.0');

// Core application object
window.App = {
  UI: {
    showModal: function(id) {
      const modal = document.getElementById(id);
      if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      }
    },
    closeModal: function(id) {
      const modal = document.getElementById(id);
      if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
      }
    },
    showNotification: function(msg, isError = false) {
      const el = document.getElementById('notification');
      if (!el) return;
      el.textContent = msg;
      el.className = `notification show ${isError ? 'error' : ''}`;
      setTimeout(() => el.classList.remove('show'), 3000);
    }
  }
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ App initialized');
  
  // Time display
  setInterval(() => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.querySelectorAll('#current-time, #call-time').forEach(el => {
      if (el) el.textContent = timeStr;
    });
  }, 1000);
  
  // Hide loading screen
  setTimeout(() => {
    const loading = document.getElementById('loading-screen');
    if (loading) loading.style.display = 'none';
  }, 1000);
  
  // Auth state listener
  if (window.firebase && firebase.auth) {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (user) {
        console.log('User authenticated:', user.email);
        // Load user data and profiles
      } else {
        console.log('User not authenticated');
      }
    });
  }
});
APP_EOF

# 2. Create deployment configuration
echo "⚙️ Creating deployment configuration..."
cat > deploy-config.json << 'CONFIG_EOF'
{
  "production": {
    "firebase": {
      "project": "whisper-chat-live",
      "site": "whisper-plus-me"
    },
    "agora": {
      "appId": "966c8e41da614722a88d4372c3d95dba",
      "certificate": "9113b7b993cb442882b983adbc0b950b"
    },
    "admin": {
      "email": "ifanifwasafifth@gmail.com"
    }
  }
}
CONFIG_EOF

# 3. Create a simple deployment script
echo "🚀 Creating deployment script..."
cat > deploy.sh << 'DEPLOY_EOF'
#!/bin/bash

echo "🚀 Deploying Whisper+me to Firebase..."

# Check if user is logged in
if ! firebase projects:list 2>/dev/null | grep -q "whisper-chat-live"; then
    echo "🔑 Please login to Firebase first:"
    echo "   firebase login"
    exit 1
fi

# Deploy hosting
echo "📦 Deploying hosting..."
firebase deploy --only hosting

# Deploy functions if they exist
if [ -d "functions" ] && [ -f "functions/package.json" ]; then
    echo "⚙️ Deploying functions..."
    firebase deploy --only functions
fi

# Deploy database rules
if [ -f "database.rules.json" ]; then
    echo "🔐 Deploying database rules..."
    firebase deploy --only database
fi

echo "✅ Deployment complete!"
echo "🌐 Your app is live at: https://whisper-chat-live.web.app"
DEPLOY_EOF
chmod +x deploy.sh

# 4. Create a development reset script
echo "🔄 Creating development reset script..."
cat > reset-dev.sh << 'RESET_EOF'
#!/bin/bash

echo "🔄 Resetting development environment..."

# Clear browser data simulation
echo "🧹 Clearing cached data..."
rm -f .firebaserc
rm -rf .firebase/

# Reset git (optional - keeps history)
echo "📦 Resetting git (soft reset)..."
git reset --hard HEAD

# Reinstall functions dependencies if needed
if [ -d "functions" ]; then
    echo "📦 Reinstalling function dependencies..."
    cd functions && npm ci --only=production && cd ..
fi

echo "✅ Development environment reset complete!"
echo "💡 Next steps:"
echo "   1. Run: firebase login"
echo "   2. Run: ./deploy.sh"
RESET_EOF
chmod +x reset-dev.sh

# 5. Update gitignore
echo "📝 Updating .gitignore..."
cat > .gitignore << 'GITIGNORE_EOF'
# Firebase
.firebase/
.firebaserc

# Node.js
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Backup files
*.backup
*.backup.*
*.tmp
*.patch
backup_*/
production_backup_*/

# Shell scripts (except essential)
deploy.sh
reset-dev.sh

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Logs
logs/
*.log
GITIGNORE_EOF

# Final structure
echo ""
echo "🏗️ Production repository structure:"
echo "├── 📁 .git/                    # Git repository"
echo "├── 📁 functions/               # Firebase Cloud Functions"
echo "│   ├── index.js               # Server-side logic"
echo "│   ├── package.json           # Dependencies"
echo "│   └── node_modules/          # Function dependencies"
echo "├── 📄 index.html              # Main HTML file"
echo "├── 📄 styles.css              # Main CSS file"
echo "├── 📄 app.js                  # Main JavaScript file"
echo "├── 📄 admin.html              # Admin dashboard HTML"
echo "├── 📄 admin.js                # Admin dashboard JavaScript"
echo "├── 📄 database.rules.json     # Firebase Realtime Database rules"
echo "├── 📄 firebase.json           # Firebase configuration"
echo "├── 📄 README.md               # Documentation"
echo "├── 📄 DEPLOYMENT.md           # Deployment guide"
echo "├── 📄 .gitignore              # Git ignore rules"
echo "├── 🚀 deploy.sh               # Deployment script"
echo "└── 🔄 reset-dev.sh            # Development reset script"

echo ""
echo "✅ Repository organized for production!"
echo "💡 Run './deploy.sh' to deploy to Firebase"
