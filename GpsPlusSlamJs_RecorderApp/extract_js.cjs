const fs = require('fs');
const html = fs.readFileSync('live-measurement-coaching-replay-demo.html', 'utf-8');
const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error("No script tag found!"); process.exit(1); }
fs.writeFileSync('temp.js', scriptMatch[1]);
