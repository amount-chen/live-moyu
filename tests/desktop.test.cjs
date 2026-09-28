const {test} = require('node:test');
const assert = require('node:assert/strict');
const {encode, decoder} = require('../desktop/framing.cjs');
const {Controller} = require('../desktop/controller.cjs');
const {classify} = require('../full-extension/response.js');
const {shouldSend} = require('../desktop/input-policy.js');
test('native framing handles split headers, UTF-8, coalesced frames and oversized input', () => {
  const values = []; const parse = decoder(x => values.push(x));
  const bytes = Buffer.concat([encode({text: '中文测试'}), encode({type: 'pong'})]);
  for (const byte of bytes) parse(Buffer.from([byte]));
  assert.deepEqual(values, [{text: '中文测试'}, {type: 'pong'}]);
  assert.throws(() => decoder(() => {})(Buffer.from([0xff, 0xff, 0xff, 0xff])));
  assert.throws(() => encode({text: 'x'.repeat(65536)}));
});
function fixture() {
  const messages = []; let timeout;
  const control = new Controller(message => messages.push(message), () => {}, {setTimeout: fn => {timeout = fn; return 1;}, clearTimeout: () => {}});
  return {control, messages, timeout: () => timeout()};
}
test('offline send is not queued; pending send is single-flight and only matching ID completes', async () => {
  const {control, messages} = fixture();
  assert.equal((await control.send('hello')).status, 'failed'); assert.equal(messages.length, 0);
  control.receive({type: 'state', ready: true, revision: 'r'});
  const pending = control.send('hello');
  assert.equal((await control.send('again')).status, 'failed'); assert.equal(messages.length, 1);
  control.receive({type: 'result', id: 'wrong', status: 'accepted'}); assert.ok(control.pending);
  control.receive({type: 'result', id: messages[0].id, status: 'accepted'});
  assert.equal((await pending).status, 'accepted'); assert.equal(control.uncertain, false);
});
test('disconnect and timeout preserve uncertainty and block another send until acknowledged', async () => {
  for (const mode of ['disconnect', 'timeout']) {
    const {control, messages, timeout} = fixture(); control.receive({type: 'state', ready: true});
    const pending = control.send('hello'); if (mode === 'disconnect') control.disconnect(); else timeout();
    assert.equal((await pending).status, 'unknown');
    control.receive({type: 'state', ready: true});
    assert.equal((await control.send('again')).status, 'unknown'); assert.equal(messages.length, 1);
  }
});
test('only clear server acceptance allows auto-hide; ambiguous and lost responses remain unknown', () => {
  assert.equal(classify(200, {code: 0, message: ''}).status, 'accepted');
  assert.equal(classify(200, {code: 0, msg: 'f'}).status, 'unknown');
  assert.equal(classify(200, {code: -101, message: '请先登录'}).status, 'failed');
  assert.equal(classify(200, {}).status, 'unknown');
  assert.equal(classify(0, null).status, 'unknown');
});
test('IME selection, composition-end enter, repeat and Shift+Enter do not submit', () => {
  const enter = {key: 'Enter'};
  assert.equal(shouldSend(enter, false, 0, 1000), true);
  for (const event of [{...enter, isComposing: true}, {...enter, keyCode: 229}, {...enter, repeat: true}, {...enter, shiftKey: true}]) {
    assert.equal(shouldSend(event, false, 0, 1000), false);
  }
  assert.equal(shouldSend(enter, true, 0, 1000), false);
  assert.equal(shouldSend(enter, false, 990, 1000), false);
});
