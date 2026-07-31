const fs = require('fs');

function unescapeFile(filename) {
  let content = fs.readFileSync(filename, 'utf-8');
  content = content.replace(/\\`/g, '`');
  content = content.replace(/\\\${/g, '${');
  fs.writeFileSync(filename, content);
  console.log('Fixed', filename);
}

unescapeFile('live-measurement-ux-demo.html');
unescapeFile('live-measurement-coaching-replay-demo.html');
