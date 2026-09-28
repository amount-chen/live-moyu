const fs = require('node:fs');
const path = require('node:path');
const {Resvg} = require('@resvg/resvg-js');
const root = path.join(__dirname, '..');
const desktop = path.join(root, 'desktop');
const source = fs.readFileSync(path.join(desktop, 'assets/fish.svg'), 'utf8');
const fish = source.match(/<g[\s\S]*<\/g>/)[0];
const svg = (body, viewBox) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="256" height="256">${body}</svg>`;
const appSvg = svg(`<rect x="154" y="154" width="944" height="944" rx="205" fill="#292c31"/>${fish.replace('currentColor', '#d8dce2')}`, '146 146 960 960');
const traySvg = svg(fish.replace('currentColor', '#000000'), '250 250 754 754');
function png(vector, size) {return new Resvg(vector, {fitTo: {mode: 'width', value: size}}).render().asPng();}
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({size, data}, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(image => image.data)]);
}
const sizes = [16,20,24,32,40,48,64,128,256];
for (const [name, vector] of [['app', appSvg], ['tray', traySvg]]) {
  fs.writeFileSync(path.join(desktop, 'assets', `${name}.svg`), vector);
  const images = sizes.map(size => ({size, data: png(vector, size)}));
  fs.writeFileSync(path.join(desktop, `${name}.ico`), ico(images));
  fs.writeFileSync(path.join(desktop, `${name}.png`), png(vector, 256));
}
// Keep the existing asset name as the app icon, never as the tray icon.
fs.copyFileSync(path.join(desktop, 'app.png'), path.join(desktop, 'icon.png'));
console.log('App and transparent black tray icons built from one shared fish outline.');
