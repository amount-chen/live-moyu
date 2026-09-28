const {spawn} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {encode, decoder} = require('../desktop/framing.cjs');
const binary = path.resolve('native/bin/LiveMoyuBridge.exe');
const id = fs.readFileSync('native/extension-id.txt', 'utf8').trim();
const children = [];
let stage = 'server start';
function child(args) {
  const process = spawn(binary, args, {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']}); children.push(process);
  process.stderr.on('data', data => console.error(data.toString()));
  const backlog = [], waiters = [];
  process.stdout.on('data', decoder(value => {if (waiters.length) waiters.shift()(value); else backlog.push(value);}));
  return {process, next: () => backlog.length ? Promise.resolve(backlog.shift()) : new Promise(resolve => waiters.push(resolve)), send: value => process.stdin.write(encode(value))};
}
const timer = setTimeout(() => {console.error('Native smoke timeout: ' + stage); children.forEach(p => p.kill()); process.exit(1);}, 6000);
(async () => {
  const server = child(['--server']); assert.equal((await server.next()).type, 'ready');
  stage = 'native connection';
  const host = child([`chrome-extension://${id}/`]); assert.equal((await server.next()).type, 'connected');
  stage = 'browser to desktop';
  host.send({type: 'state', ready: true});
  assert.deepEqual(await server.next(), {scope: 'browser', payload: {type: 'state', ready: true}});
  stage = 'desktop to browser';
  server.send({scope: 'browser', payload: {type: 'ping'}}); assert.deepEqual(await host.next(), {type: 'ping'});
  stage = 'focus capture';
  server.send({scope: 'local', type: 'capture', id: 'capture-test'});
  const focus = await server.next(); assert.equal(focus.id, 'capture-test'); assert.equal(typeof focus.hwnd, 'string');
  console.log('Native framing, current-user pipe roundtrip and foreground capture passed.');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {clearTimeout(timer); children.forEach(p => p.kill());});
