const express = require('express');
const app = express();

// Serve static files
app.use(express.static(__dirname));

// All routes to index.html
app.get('*', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
🚀 Whisper+me Production MVP Running!
👉 Open: http://localhost:${PORT}
📱 Mobile-ready PWA
🎯 Features Implemented:
   • Phone section at top
   • Member profile cards
   • Whisper coin purchase ($15 each)
   • 1-3 coin charging per call
   • Profile pop-ups with social links
   • Full-screen call interface
   • 2-minute wait with refund option
   • 5-minute timer with no refund after start
   • Member dashboard with stats
   • Profile editing with photo upload
   • Banking info for payouts
   • Admin dashboard
   • Rating system with email forwarding
   • Mobile-optimized design
   • Social media shareable
   
Press Ctrl+C to stop
`);
});
