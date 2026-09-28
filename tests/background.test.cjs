const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('extension/background.js', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(initial = {}) {
  let receiver, clicked, count = 0, sequence = 0;
  const timers = new Map(); const state = structuredClone(initial);
  const tab = {id: 42, url: 'https://live.bilibili.com/123', title: '测试直播间'};
  const chrome = {
    runtime: {id: 'ours', getURL: file => 'chrome-extension://ours/' + file,
      onMessage: {addListener: fn => {receiver = fn;}}},
    storage: {session: {get: async () => structuredClone(state), set: async data => {Object.assign(state, structuredClone(data));}}},
    tabs: {get: async () => tab, sendMessage: async (_id, msg) => {
      if (msg.type === 'send') {count++; return {ok: true, evidence: {clickDispatched: true}};}
      return {ok: true, documentToken: 'doc'};
    }},
    scripting: {executeScript: async () => {}}, windows: {create: async () => {}},
    action: {onClicked: {addListener: fn => {clicked = fn;}}}
  };
  const context = vm.createContext({chrome, URL, crypto: {randomUUID: () => 'request-' + ++sequence}, Date,
    setTimeout: (fn, ms) => {const id = ++sequence; timers.set(id, {fn, ms}); return id;}, clearTimeout: id => timers.delete(id)});
  vm.runInContext(source, context); await tick();
  const call = (type, extra = {}) => new Promise(resolve => receiver({type, ...extra},
    {id: 'ours', url: 'chrome-extension://ours/test.html'}, resolve));
  return {state, tab, timers, call, count: () => count, bind: async () => {clicked(tab); await tick();},
    fire: async () => {const timer = [...timers.values()].find(t => t.ms === 10000); timer.fn(); await tick();}};
}
test('schedule is single-flight and cancel prevents dispatch', async () => {
  const f = await fixture(); await f.bind();
  const input = {text: 'hello', scenario: 'background', selectors: {}};
  assert.equal((await f.call('schedule', input)).ok, true);
  assert.equal((await f.call('schedule', input)).ok, false);
  await f.call('cancel'); assert.equal(f.state.job.status, 'cancelled');
  assert.equal(f.count(), 0); assert.equal(f.timers.size, 0);
});
test('navigation during countdown prevents sending and never retries', async () => {
  const f = await fixture(); await f.bind();
  await f.call('schedule', {text: 'hello', scenario: 'minimized'});
  f.tab.url = 'https://live.bilibili.com/456'; await f.fire();
  assert.equal(f.count(), 0); assert.equal(f.state.job.status, 'unknown');
});
test('click requires human verdict and report omits message body', async () => {
  const f = await fixture(); await f.bind();
  await f.call('schedule', {text: 'private-test-message', scenario: 'covered'}); await f.fire();
  assert.equal(f.state.job.status, 'triggered'); assert.equal(f.count(), 1);
  assert.equal((await f.call('schedule', {text: 'again', scenario: 'covered'})).ok, false);
  assert.equal((await f.call('verdict', {verdict: 'confirmed'})).ok, true);
  assert.equal(f.state.reports[0].verdict, 'confirmed');
  assert.equal(JSON.stringify(f.state).includes('private-test-message'), false);
});
test('worker restart marks pending result unknown without replay', async () => {
  const f = await fixture({job: {id: 'old', status: 'scheduled'}});
  assert.equal(f.state.job.status, 'unknown'); assert.equal(f.count(), 0); assert.equal(f.timers.size, 0);
});
