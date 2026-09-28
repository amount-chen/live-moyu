const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {classify} = require('../full-extension/response.js');
test('observer correlates only the armed message and leaves original XHR untouched', () => {
  const events = []; let receive;
  class XHR {
    open(method, url) {this.url = url;}
    addEventListener(_name, fn) {this.done = fn;}
    send(body) {this.body = body;}
  }
  const window = {addEventListener: (_name, fn) => {receive = fn;}, postMessage: value => events.push(value), fetch: () => Promise.resolve({})};
  const context = vm.createContext({window, XMLHttpRequest: XHR, location: {origin: 'https://live.bilibili.com', href: 'https://live.bilibili.com/123'},
    URL, URLSearchParams, FormData, LiveMoyuResponse: {classify}, Date});
  vm.runInContext(fs.readFileSync('full-extension/observer.js', 'utf8'), context);
  receive({source: window, origin: 'https://live.bilibili.com', data: {source: 'live-moyu-page', type: 'arm', id: 'one', text: 'hello'}});
  const wrong = new XHR(); wrong.open('POST', 'https://api.live.bilibili.com/msg/send'); wrong.send('msg=other'); assert.equal(wrong.done, undefined);
  const unrelated = new XHR(); unrelated.open('POST', 'https://example.com/msg/send'); unrelated.send('msg=hello'); assert.equal(unrelated.done, undefined);
  const correct = new XHR(); correct.open('POST', 'https://api.live.bilibili.com/msg/send'); correct.send('msg=hello&roomid=123');
  assert.equal(correct.body, 'msg=hello&roomid=123');
  correct.status = 200; correct.responseText = '{"code":0,"message":""}'; correct.done();
  assert.equal(events.at(-1).status, 'accepted'); assert.equal(events.at(-1).id, 'one');
  const duplicate = new XHR(); duplicate.open('POST', 'https://api.live.bilibili.com/msg/send'); duplicate.send('msg=hello'); assert.equal(duplicate.done, undefined);
});
