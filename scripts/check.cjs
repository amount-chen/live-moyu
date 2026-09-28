const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
for (const dir of ['extension', 'full-extension', 'desktop', 'scripts']) {
  for (const file of fs.readdirSync(dir)) if (/\.(c?js)$/.test(file)) {
    execFileSync(process.execPath, ['--check', path.join(dir, file)], {stdio: 'inherit'});
  }
}
console.log('JavaScript syntax OK');
