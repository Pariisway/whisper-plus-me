#!/bin/bash

# Create a temporary file with the new styles
cat > auth-styles.css << 'STYLESEOF'
    /* Auth Modal Styles */
    .auth-modal {
      background: #111;
      border-radius: 16px;
      width: 100%;
      max-width: 400px;
      overflow: hidden;
    }
    
    .auth-tabs {
      display: flex;
      background: #1a1a1a;
      border-bottom: 1px solid #222;
      position: relative;
    }
    
    .auth-tab {
      flex: 1;
      padding: 1rem;
      background: none;
      border: none;
      color: #888;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    
    .auth-tab.active {
      color: #7c3aed;
      border-bottom: 2px solid #7c3aed;
    }
    
    .close-auth {
      position: absolute;
      top: 0;
      right: 0;
      background: none;
      border: none;
      color: #888;
      font-size: 1.5rem;
      padding: 0.5rem 1rem;
      cursor: pointer;
    }
    
    .auth-form {
      padding: 2rem;
      display: none;
    }
    
    .auth-form.active {
      display: block;
    }
    
    .auth-btn {
      width: 100%;
      padding: 1rem;
      background: linear-gradient(135deg, #7c3aed, #6d28d9);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 1rem;
    }
    
    .auth-footer {
      text-align: center;
      margin-top: 1rem;
      color: #888;
    }
    
    .auth-footer a {
      color: #7c3aed;
      text-decoration: none;
    }
    
    /* User Menu */
    .user-menu {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    .user-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid #7c3aed;
    }
    
    .user-email {
      color: #888;
      font-size: 0.9rem;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .logout-btn {
      background: #333;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      cursor: pointer;
    }
STYLESEOF

# Find the line number of the closing </style> tag
line=$(grep -n '</style>' index.html | head -1 | cut -d: -f1)

# Insert the styles before the closing </style> tag
sed -i "${line}i\\
$(cat auth-styles.css)" index.html

echo "✅ Auth styles added to index.html"
