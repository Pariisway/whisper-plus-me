#!/bin/bash

# Create the new header section
cat > new-header.html << 'HEADEREOF'
  <!-- Header -->
  <header>
    <div class="header-content">
      <div class="logo">
        <i class="fas fa-comment-alt"></i>
        <span>Whisper+me</span>
      </div>
      
      <div class="user-menu" id="user-menu">
        <!-- When not logged in -->
        <div id="guest-menu" style="display: flex; align-items: center; gap: 1rem;">
          <button class="btn btn-secondary" onclick="showAuthModal('login')">
            <i class="fas fa-sign-in-alt"></i> Login
          </button>
          <button class="btn btn-primary" onclick="showAuthModal('signup')">
            <i class="fas fa-user-plus"></i> Sign Up
          </button>
        </div>
        
        <!-- When logged in -->
        <div id="logged-in-menu" style="display: none; align-items: center; gap: 1rem;">
          <div class="coins-badge" onclick="showDashboard()" style="cursor: pointer;">
            <i class="fas fa-coins"></i>
            <span id="coins-count">0</span> Coins
          </div>
          <div style="text-align: right;">
            <div class="user-email" id="user-email">user@email.com</div>
            <button class="logout-btn" onclick="logout()" style="font-size: 0.8rem; padding: 0.25rem 0.5rem;">
              Logout
            </button>
          </div>
          <img src="" alt="" class="user-avatar" id="user-avatar" onclick="showDashboard()" style="cursor: pointer;">
        </div>
      </div>
    </div>
  </header>
HEADEREOF

# Find the line number of the header section (between <!-- Header --> and </header>)
start_line=$(grep -n '<!-- Header -->' index.html | head -1 | cut -d: -f1)
end_line=$(grep -n '</header>' index.html | head -1 | cut -d: -f1)

if [ ! -z "$start_line" ] && [ ! -z "$end_line" ]; then
  # Remove the old header and insert the new one
  sed -i "${start_line},${end_line}d" index.html
  sed -i "${start_line}i\\
$(cat new-header.html)" index.html
  echo "✅ Header updated"
else
  echo "❌ Could not find header section"
fi
