const TEST_URL = chrome.runtime.getURL('test.html');
let serial = Promise.resolve();
let timer;
const busy = job => job && ['scheduled', 'sending'].includes(job.status);
const roomUrl = raw => {
  const url = new URL(raw);
  if (url.origin !== 'https://live.bilibili.com' || !/^\/\d+\/?$/.test(url.pathname)) {
    throw new Error('请在 B 站具体直播间页面点击扩展图标。');
  }
  return url.origin + url.pathname.replace(/\/$/, '');
};
const read = () => chrome.storage.session.get(['binding', 'job', 'reports', 'notice']);
const update = value => chrome.storage.session.set(value);
const enqueue = task => {
  const next = serial.then(task, task);
  serial = next.catch(() => {});
  return next;
};
async function page(binding, command) {
  const tab = await chrome.tabs.get(binding.tabId);
  if (roomUrl(tab.url) !== binding.url) throw new Error('目标标签页已跳转，请重新绑定。');
  const result = await chrome.tabs.sendMessage(binding.tabId, command);
  if (!result?.ok) throw new Error(result?.error || '直播页未响应，请重新绑定。');
  return result;
}
async function bind(tab) {
  const state = await read();
  if (busy(state.job)) throw new Error('请先取消当前测试或等待本次测试结束，再绑定直播间。');
  const url = roomUrl(tab.url);
  await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content.js']});
  const binding = {tabId: tab.id, url, title: tab.title || url};
  const info = await page(binding, {type: 'hello'});
  binding.documentToken = info.documentToken;
  await update({binding, notice: ''});
}
chrome.action.onClicked.addListener(tab => {
  enqueue(async () => {
    try { await bind(tab); }
    catch (error) { await update({notice: error.message}); }
    await chrome.windows.create({url: TEST_URL, type: 'popup', width: 540, height: 810});
  });
});
async function fire(id, text, selectors) {
  const {job, binding} = await read();
  if (job?.id !== id || job.status !== 'scheduled') return;
  if (Date.now() > job.dueAt + 15000) {
    await update({job: {...job, status: 'unknown', error: '倒计时执行延迟过长，已停止本次发送。'}});
    return;
  }
  const dispatchedAt = Date.now();
  await update({job: {...job, status: 'sending', dispatchedAt}});
  let deadline;
  try {
    const result = await Promise.race([
      page(binding, {type: 'send', id, text, selectors,
        expiresAt: dispatchedAt + 10000, url: binding.url, documentToken: binding.documentToken}),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('直播页响应超时，可能已经发送，请人工核对。')), 12000); })
    ]);
    await update({job: {...job, dispatchedAt, status: 'triggered', finishedAt: Date.now(), evidence: result.evidence}});
  } catch (error) {
    // Transport errors may happen after a click. Never infer failure or retry.
    await update({job: {...job, dispatchedAt, status: 'unknown', finishedAt: Date.now(), error: error.message}});
  } finally { clearTimeout(deadline); }
}
async function command(message) {
  const state = await read();
  if (message.type === 'state') return state;
  if (message.type === 'probe') {
    if (!state.binding) throw new Error('请先在直播间点击扩展图标绑定。');
    return page(state.binding, {type: 'probe', selectors: message.selectors,
      documentToken: state.binding.documentToken});
  }
  if (message.type === 'schedule') {
    if (busy(state.job)) throw new Error('已有测试正在进行，请勿重复提交。');
    if (state.job && ['triggered', 'unknown'].includes(state.job.status)) throw new Error('请先记录上一条测试结果。');
    if (!state.binding) throw new Error('请先绑定直播间。');
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 500) {
      throw new Error('请输入 1–500 个字符；实际长度还受直播间限制。');
    }
    if (!['background', 'covered', 'minimized'].includes(message.scenario)) throw new Error('请选择测试场景。');
    await page(state.binding, {type: 'probe', selectors: message.selectors,
      documentToken: state.binding.documentToken});
    const job = {id: crypto.randomUUID(), status: 'scheduled', dueAt: Date.now() + 10000,
      createdAt: Date.now(), scenario: message.scenario, room: state.binding.url};
    await update({job});
    timer = setTimeout(() => enqueue(() => fire(job.id, message.text, message.selectors)), 10000);
    return {job};
  }
  if (message.type === 'cancel') {
    if (state.job?.status !== 'scheduled') throw new Error('已进入发送阶段，无法保证取消。请检查直播间结果。');
    clearTimeout(timer);
    await update({job: {...state.job, status: 'cancelled'}});
    return {};
  }
  if (message.type === 'verdict') {
    if (!state.job || !['triggered', 'unknown'].includes(state.job.status)) throw new Error('当前没有待确认测试。');
    if (!['confirmed', 'not-seen', 'uncertain'].includes(message.verdict)) throw new Error('无效结果。');
    const report = {...state.job, verdict: message.verdict, confirmedAt: Date.now()};
    await update({reports: [...(state.reports || []), report].slice(-30), job: null});
    return {};
  }
  throw new Error('不支持的操作。');
}
// A suspended/restarted worker must never replay a pending message.
serial = read().then(async state => {
  if (busy(state.job)) await update({job: {...state.job, status: 'unknown',
    error: '扩展后台已重启，本次结果未确认。不会自动重发。'}});
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== TEST_URL) return;
  enqueue(() => command(message)).then(data => respond({ok: true, data}),
    error => respond({ok: false, error: error.message}));
  return true;
});
