#!/bin/bash

# Install required packages
echo "Setting up HTTPS test server..."
echo "Make sure you have Node.js installed"

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "Node.js not found. Please install Node.js first:"
    echo "https://nodejs.org/"
    exit 1
fi

# Create package.json if not exists
if [ ! -f "package.json" ]; then
    cat > package.json << 'PKGEOF'
{
  "name": "whisper-plus-me-test",
  "version": "1.0.0",
  "scripts": {
    "start": "node https-server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "https": "^1.0.0",
    "selfsigned": "^2.1.1"
  }
}
PKGEOF
fi

# Create HTTPS server
cat > https-server.js << 'SERVEREOF'
const express = require('express');
const https = require('https');
const fs = require('fs');
const selfsigned = require('selfsigned');
const path = require('path');

const app = express();

// Generate self-signed certificate for testing
const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, { days: 365 });

// Serve static files
app.use(express.static(__dirname));

// Handle SPA routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Create HTTPS server
const server = https.createServer({
    key: pems.private,
    cert: pems.cert,
    passphrase: 'whisper'
}, app);

const PORT = 8443;
server.listen(PORT, () => {
    console.log('\n========================================');
    console.log('HTTPS Server running!');
    console.log('========================================');
    console.log(`Open in browser: https://localhost:${PORT}`);
    console.log('Note: Browser will warn about self-signed certificate.');
    console.log('Click "Advanced" -> "Proceed to localhost (unsafe)"');
    console.log('========================================\n');
});
SERVEREOF

# Install dependencies
echo "Installing dependencies..."
npm install

echo "Starting HTTPS server..."
npm start
