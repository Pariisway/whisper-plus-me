const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

// Route all requests to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📱 Mobile testing: http://localhost:${PORT}`);
  console.log(`🔧 Admin: http://localhost:${PORT}/admin.html`);
  console.log(`\nIMPORTANT: Make sure you have proper Firebase setup`);
  console.log(`Firebase Database URL should be: https://whisper-chat-live-default-rtdb.firebaseio.com`);
});
