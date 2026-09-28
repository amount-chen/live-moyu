const HOST = 'com.livemoyu.bridge';
let port = null;
let binding = null;
let ready = false;
let sending = false;
let status = '请在直播间点击扩展并绑定';
let revision = crypto.randomUUID();
let seen = [];
let bindingOperation = 0;
const initialized = chrome.storage.session.get(['binding', 'seen']).then(value => {binding = value.binding || null; seen = value.seen || [];});
const room = raw => {
  try { const u = new URL(raw); return u.origin === 'https://live.bilibili.com' && /^\/\d+\/?$/.test(u.pathname) ? u.origin + u.pathname.replace(/\/$/, '') : null; }
  catch {return null;}
};
function snapshot() {return {type: 'state', connected: true, ready, room: binding?.url || '', title: binding?.title || '', revision, message: status};}
function post(value) {try {port?.postMessage(value);} catch {port = null;}}
function publish() {post(snapshot()); chrome.storage.session.set({view: {...snapshot(), nativeConnected: !!port}});}
async function clearBinding(message) {
  bindingOperation++; binding = null; ready = false; revision = crypto.randomUUID(); status = message;
  await chrome.storage.session.remove('binding'); publish();
}
async function refresh() {
  await initialized;
  if (!binding || sending) return;
  const current = binding;
  try {
    const tab = await chrome.tabs.get(current.tabId);
    if (binding !== current) return;
    if (room(tab.url) !== current.url) {await clearBinding('直播页已跳转，请重新绑定'); return;}
    const hello = await chrome.tabs.sendMessage(current.tabId, {type: 'hello'});
    if (binding !== current) return;
    if (!hello?.ok || hello.url !== current.url) throw new Error('直播页连接不可用');
    if (current.token !== hello.token) {current.token = hello.token; revision = crypto.randomUUID();}
    ready = true; status = '已连接'; publish();
  } catch {
    if (binding !== current) return;
    ready = false; status = '等待直播页刷新完成；首次安装后请刷新直播页'; publish();
  }
}
function connect() {
  if (port) {refresh(); return;}
  try {
    const current = chrome.runtime.connectNative(HOST); port = current;
    current.onMessage.addListener(message => {
      if (message.type === 'send') send(message);
      else if (message.type === 'ping') {post({type: 'pong'}); refresh();}
    });
    current.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port === current) {port = null; publish();}
    });
    refresh(); publish();
  } catch {port = null; publish();}
}
async function send(message) {
  const respond = (state, text) => post({type: 'result', id: message.id, status: state, message: text});
  await initialized;
  if (typeof message.id !== 'string' || message.id.length > 80) return;
  if (seen.includes(message.id)) {respond('unknown', '重复请求已拦截，请核对之前的结果。'); return;}
  if (sending || !ready || !binding || message.revision !== revision) {respond('failed', '连接或直播间状态已变化，请重新唤起输入框。'); return;}
  if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 500) {respond('failed', '弹幕为空或过长。'); return;}
  sending = true;
  seen = [...seen, message.id].slice(-1000);
  let deadline;
  try {
    await chrome.storage.session.set({seen});
    const current = binding;
    const tab = await chrome.tabs.get(current.tabId);
    if (binding !== current || room(tab.url) !== current.url) throw new Error('目标直播间已变化。');
    const result = await Promise.race([
      chrome.tabs.sendMessage(current.tabId, {type: 'send', id: message.id, text: message.text,
        token: current.token, url: current.url, expiresAt: Date.now() + 8000}),
      new Promise((_, reject) => {deadline = setTimeout(() => reject(new Error('直播页响应超时，请人工核对结果。')), 13000);})
    ]);
    respond(['accepted', 'failed', 'unknown'].includes(result?.status) ? result.status : 'unknown', result?.message || '未收到可识别的发送结果。');
  } catch (error) {respond('unknown', error.message);}
  finally {clearTimeout(deadline); sending = false; refresh();}
}
chrome.tabs.onRemoved.addListener(id => {if (binding?.tabId === id) clearBinding('直播标签页已关闭，请重新绑定');});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (binding?.tabId !== id) return;
  if (change.url && room(change.url) !== binding.url) {clearBinding('直播间已变化，请重新绑定'); return;}
  if (change.status === 'loading') {ready = false; revision = crypto.randomUUID(); status = '直播页正在加载'; publish();}
  if (change.status === 'complete') refresh();
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  (async () => {
    await initialized;
    if (message.type === 'bind') {
      if (sending) throw new Error('正在发送，请稍后再绑定');
      const operation = ++bindingOperation;
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      const url = room(tab?.url);
      if (!url) throw new Error('请在具体 B 站直播间页面点击此扩展');
      const hello = await chrome.tabs.sendMessage(tab.id, {type: 'hello'});
      if (!hello?.ok || hello.url !== url) throw new Error('请刷新直播页后再绑定');
      if (operation !== bindingOperation) throw new Error('绑定请求已被更新');
      binding = {tabId: tab.id, url, title: tab.title, token: hello.token}; revision = crypto.randomUUID();
      await chrome.storage.session.set({binding}); ready = true; status = '已连接';
    } else if (message.type === 'unbind') {
      if (sending) throw new Error('正在发送，请稍后解除绑定');
      await clearBinding('已解除绑定');
    }
    connect(); publish();
    return {...snapshot(), nativeConnected: !!port};
  })().then(data => reply({ok: true, data}), error => reply({ok: false, error: error.message}));
  return true;
});
chrome.alarms.create('reconnect', {periodInMinutes: 0.5});
chrome.alarms.onAlarm.addListener(() => connect());
initialized.then(connect);
