const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(response = {code: 0, message: ''}) {
  let receive, clicks = 0, timerId = 0;
  const timers = new Map(), listeners = new Set();
  class Textarea {
    constructor() {this._value = ''; this.isConnected = true; this.maxLength = 20;}
    get value() {return this._value;} set value(value) {this._value = value;}
    getClientRects() {return [1];} dispatchEvent() {}
  }
  const input = new Textarea();
  class XHR {
    open() {} addEventListener(_type, listener) {this.done = listener;}
    send() {this.status = 200; this.responseText = JSON.stringify(response); queueMicrotask(() => this.done?.());}
  }
  const window = {addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    postMessage: data => queueMicrotask(() => {for (const listener of [...listeners]) listener({source: window, origin: 'https://live.bilibili.com', data});}),
    fetch: () => Promise.resolve({})};
  const button = {innerText: '发送', isConnected: true, getClientRects: () => [1], getAttribute: () => null, classList: {contains: () => false},
    click: () => {clicks++; const xhr = new XHR(); xhr.open('POST', 'https://api.live.bilibili.com/msg/send'); xhr.send(new URLSearchParams({msg: input.value})); input.value = '';}};
  const context = vm.createContext({window, XMLHttpRequest: XHR, LiveMoyuResponse: undefined,
    location: {origin: 'https://live.bilibili.com', pathname: '/123', href: 'https://live.bilibili.com/123'},
    document: {querySelectorAll: selector => selector === 'textarea' ? [input] : [button]},
    HTMLTextAreaElement: Textarea, Event: class {}, getComputedStyle: () => ({visibility: 'visible'}),
    URL, URLSearchParams, FormData, Date, crypto: {randomUUID: () => 'doc'},
    setTimeout: (fn, ms) => {const id = ++timerId; if (ms === 100) queueMicrotask(fn); else timers.set(id, fn); return id;}, clearTimeout: id => timers.delete(id),
    chrome: {runtime: {id: 'ours', onMessage: {addListener: fn => {receive = fn;}}}}});
  for (const file of ['response.js', 'observer.js', 'page.js']) vm.runInContext(fs.readFileSync('full-extension/' + file, 'utf8'), context);
  return {input, clicks: () => clicks, context,
    send: extra => new Promise(resolve => receive({type: 'send', id: 'one', text: '你好', token: 'doc', url: 'https://live.bilibili.com/123', expiresAt: Date.now()+8000, ...extra}, {id: 'ours'}, resolve)),
    timeout: () => [...timers.values()].forEach(fn => fn())};
}
test('full content path accepts only matching server response and rejects duplicate dispatch', async () => {
  const f = fixture(); assert.equal((await f.send()).status, 'accepted'); assert.equal(f.clicks(), 1);
  assert.equal((await f.send()).status, 'failed'); assert.equal(f.clicks(), 1);
});
test('full content path passes through server rejection', async () => {
  const f = fixture({code: -101, message: '请先登录'});
  const result = await f.send(); assert.equal(result.status, 'failed'); assert.equal(result.message, '请先登录');
});
test('full content path cannot treat cleared input as successful delivery', async () => {
  const f = fixture({unexpected: true}); assert.equal((await f.send()).status, 'unknown'); assert.equal(f.input.value, '');
});
test('full content path blocks stale document and preserves a preexisting draft', async () => {
  const f = fixture(); assert.equal((await f.send({token: 'old'})).status, 'failed');
  f.input.value = '原有草稿'; assert.equal((await f.send()).status, 'failed');
  assert.equal(f.input.value, '原有草稿'); assert.equal(f.clicks(), 0);
});
