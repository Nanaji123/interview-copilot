const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', 'dmg-builder', 'out', 'dmgUtil.js');
if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes('"detach", "-force", "-quiet"')) {
    content = content.replace(/"detach", "-quiet"/g, '"detach", "-force", "-quiet"');
    fs.writeFileSync(file, content);
    console.log('Patched dmg-builder to use -force with hdiutil detach');
  }
}
