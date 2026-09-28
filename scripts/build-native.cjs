const path = require('node:path');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname, '..');
const output = path.join(root, 'native', 'bin');
fs.mkdirSync(output, {recursive: true});
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/reference:System.Web.Extensions.dll',
  `/out:${path.join(output, 'LiveMoyuBridge.exe')}`, path.join(root, 'native', 'Bridge.cs')], {stdio: 'inherit', windowsHide: true});
fs.copyFileSync(path.join(root, 'native', 'extension-id.txt'), path.join(output, 'extension-id.txt'));
