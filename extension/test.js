const $ = id => document.getElementById(id);
let state = {};
let sending = false;
const labels = {scheduled: '已安排发送', sending: '正在操作直播页，请勿重复发送',
  triggered: '已触发点击，发送结果待人工确认', unknown: '发送结果未确认，不会自动重试', cancelled: '已取消，未触发发送'};
const selectors = () => ({input: $('inputSelector').value.trim(), button: $('buttonSelector').value.trim()});
async function request(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({type, ...extra});
  if (!result?.ok) throw new Error(result?.error || '扩展连接中断');
  return result.data;
}
function render() {
  $('room').textContent = state.binding ? `${state.binding.title}\n${state.binding.url}` : '尚未绑定直播间';
  $('notice').textContent = state.notice || '';
  const job = state.job;
  const active = job && ['scheduled', 'sending'].includes(job.status);
  const pending = job && ['triggered', 'unknown'].includes(job.status);
  $('send').disabled = sending || active || pending || !state.binding;
  $('probe').disabled = active || !state.binding;
  $('cancel').disabled = !job || job.status !== 'scheduled';
  $('text').disabled = active || sending;
  $('scenario').disabled = active;
  $('inputSelector').disabled = active;
  $('buttonSelector').disabled = active;
  $('status').textContent = job ? labels[job.status] || job.status : '尚未发送 / 上次结果已记录';
  if (job?.status === 'scheduled') $('status').textContent += ` · 约 ${Math.max(0, Math.ceil((job.dueAt-Date.now())/1000))} 秒后尝试发送，请现在切换窗口`;
  if (job?.status === 'scheduled' && Date.now() > job.dueAt + 15000) $('status').textContent = '计时已超过预期，请取消后检查；不要重复安排发送。';
  $('evidence').textContent = job?.error || (job?.evidence ? JSON.stringify(job.evidence, null, 2) : '');
  $('verdict').hidden = !pending;
  $('count').textContent = `${(state.reports || []).length} 条记录`;
}
async function run(action) {
  $('error').textContent = '';
  try { await action(); state = await request('state'); render(); }
  catch (error) { $('error').textContent = error.message; }
}
$('probe').onclick = () => run(async () => {
  const info = await request('probe', {selectors: selectors()});
  $('error').textContent = `检查通过：已找到输入框和“${info.buttonText}”按钮。${info.maxLength >= 0 ? `页面字数上限 ${info.maxLength}。` : ''}尚未发送。`;
});
$('send').onclick = () => {
  if (sending) return;
  sending = true; render();
  run(async () => request('schedule', {text: $('text').value, scenario: $('scenario').value, selectors: selectors()}))
    .finally(() => {sending = false; render();});
};
$('cancel').onclick = () => run(() => request('cancel'));
document.querySelectorAll('[data-verdict]').forEach(button => {
  button.onclick = () => run(async () => {
    await request('verdict', {verdict: button.dataset.verdict});
    if (button.dataset.verdict === 'confirmed') $('text').value = '';
  });
});
$('export').onclick = () => run(async () => {
  const latest = await request('state');
  const blob = new Blob([JSON.stringify({version: '0.1.0', exportedAt: new Date().toISOString(),
    reports: latest.reports || [], pending: latest.job || null}, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'live-moyu-validation.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'session') run(async () => {});
});
setInterval(render, 1000);
run(async () => {});
