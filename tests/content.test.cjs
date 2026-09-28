const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('extension/content.js', 'utf8');
function fixture(options = {}) {
  let listener, clicks = 0;
  class Textarea {
    constructor() { this._value = options.draft || ''; this.maxLength = options.maxLength ?? 20; this.isConnected = true; this.placeholder = '发个弹幕呗'; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    dispatchEvent() {}
    getClientRects() { return [1]; }
  }
  class Input {}
  const input = new Textarea();
  const button = {innerText: '发送', isConnected: true, disabled: !!options.disabled,
    getClientRects: () => [1], getAttribute: () => null, classList: {contains: () => false},
    click: () => { clicks++; input.value = ''; }};
  const context = vm.createContext({crypto: {randomUUID: () => 'document-1'},
    HTMLTextAreaElement: Textarea, HTMLInputElement: Input, Event: class {},
    location: {origin: 'https://live.bilibili.com', pathname: '/123'},
    document: {visibilityState: 'hidden', hasFocus: () => false,
      querySelectorAll: selector => selector === 'textarea' ? (options.ambiguous ? [input, input] : [input]) : [button]},
    getComputedStyle: () => ({visibility: 'visible'}), setTimeout: callback => {queueMicrotask(callback); return 1;},
    chrome: {runtime: {id: 'ours', onMessage: {addListener: fn => {listener = fn;}}}}});
  vm.runInContext(source, context);
  return {input, context, clicks: () => clicks,
    send: extra => new Promise(resolve => listener({type: 'send', id: 'one', text: '测试',
      expiresAt: Date.now() + 10000, documentToken: 'document-1', url: 'https://live.bilibili.com/123', ...extra}, {id: 'ours'}, resolve))};
}
test('hidden document dispatches one click but never claims server success', async () => {
  const f = fixture(); const result = await f.send();
  assert.equal(result.ok, true); assert.equal(f.clicks(), 1);
  assert.equal(result.evidence.visibilityAtClick, 'hidden');
  assert.equal(result.evidence.documentFocusedAtClick, false);
  assert.equal(result.success, undefined);
  const duplicate = await f.send(); assert.equal(duplicate.ok, false); assert.equal(f.clicks(), 1);
});
test('existing user draft is never overwritten', async () => {
  const f = fixture({draft: '原草稿'}); assert.equal((await f.send()).ok, false);
  assert.equal(f.input.value, '原草稿'); assert.equal(f.clicks(), 0);
});
test('refresh, navigation, ambiguity, empty text and length overflow stop before click', async () => {
  for (const [options, message] of [[{}, {documentToken: 'old'}], [{}, {url: 'https://live.bilibili.com/456'}],
    [{ambiguous: true}, {}], [{}, {text: '  '}], [{maxLength: 1}, {}]]) {
    const f = fixture(options); assert.equal((await f.send(message)).ok, false); assert.equal(f.clicks(), 0);
  }
});
test('disabled send button preserves typed text without a click', async () => {
  const f = fixture({disabled: true}); assert.equal((await f.send()).ok, false);
  assert.equal(f.input.value, '测试'); assert.equal(f.clicks(), 0);
});
test('expired request never edits input or clicks send', async () => {
  const f = fixture(); assert.equal((await f.send({expiresAt: 0})).ok, false);
  assert.equal(f.input.value, ''); assert.equal(f.clicks(), 0);
});
