const $ = id => document.getElementById(id);
let state = {}, busy = false, composing = false, compositionEnded = -Infinity, lastOutcome = '';
function render(value) {
  state = value;
  document.documentElement.dataset.compact = String(value.compact === true);
  const issue = value.uncertain || !value.connected || !value.ready || ['failed', 'unknown'].includes(lastOutcome);
  document.documentElement.dataset.attention = String(!!issue);
  const hint = value.uncertain ? '发送结果未确认，展开核对后再发送' :
    (!value.connected || !value.ready) ? '直播间未连接，展开查看' :
    (['failed', 'unknown'].includes(lastOutcome) ? $('result').textContent : '');
  $('draft').title = hint || (value.compact ? '回车发送 · Esc 收起 · 拖动外边缘移动小窗' : '');
  $('draft').placeholder = value.compact ? (hint || '输入…') : '想说点什么？';
  $('expand').title = hint ? `${hint}；点击恢复完整窗口` : '恢复完整窗口';
  const dark = value.theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('theme').textContent = dark ? '白色' : '深色';
  $('theme').title = dark ? '切换到白色模式' : '切换到深色模式';
  $('theme').setAttribute('aria-label', $('theme').title);
  $('theme').setAttribute('aria-pressed', String(dark));
  $('room').textContent = value.title || '尚未绑定直播间';
  $('room').title = value.room || '';
  $('connection').textContent = value.shortcutError || value.message || '请先连接直播间';
  $('dot').classList.toggle('online', !!(value.connected && value.ready));
  $('send').disabled = busy || value.busy || value.uncertain || !value.connected || !value.ready;
  $('draft').disabled = busy || !!value.busy;
  $('acknowledge').hidden = !value.uncertain;
  $('shortcutHint').textContent = `${value.shortcut || 'Control+Alt+B'} 唤起 · Esc 收起`;
  if (document.activeElement !== $('shortcut')) $('shortcut').value = value.shortcut || 'Control+Alt+B';
}
async function send() {
  if (busy || state.busy || state.uncertain || !state.connected || !state.ready || !$('draft').value.trim()) return;
  lastOutcome = ''; busy = true; render(state); $('result').textContent = '正在发送…';
  try {
    const result = await window.moyu.send($('draft').value);
    lastOutcome = result.status;
    $('result').textContent = result.message;
    if (result.status === 'accepted') {$('draft').value = ''; await window.moyu.hide();}
  } catch {lastOutcome = 'unknown'; $('result').textContent = '本地通信发生异常，草稿已保留，请核对直播间。';}
  finally {busy = false; render(await window.moyu.state()); $('draft').focus();}
}
$('draft').addEventListener('compositionstart', () => {composing = true;});
$('draft').addEventListener('compositionend', () => {composing = false; compositionEnded = performance.now();});
$('draft').addEventListener('keydown', event => {
  if (LiveMoyuInput.shouldSend(event, composing, compositionEnded, performance.now())) {event.preventDefault(); send();}
});
document.addEventListener('keydown', event => {if (event.key === 'Escape' && !event.isComposing && !composing) {event.preventDefault(); window.moyu.hide();}});
$('send').onclick = send;
$('hide').onclick = () => window.moyu.hide();
async function toggleCompact() {
  try {render(await window.moyu.toggleCompact()); $('draft').focus();}
  catch (error) {$('result').textContent = '窗口切换失败，请稍后重试。'; $('expand').title = $('result').textContent;}
}
$('compact').onclick = toggleCompact;
$('expand').onclick = toggleCompact;
$('theme').onclick = async () => {
  try {render(await window.moyu.toggleTheme());}
  catch {$('result').textContent = '主题保存失败，请稍后重试。';}
};
$('acknowledge').onclick = async () => {lastOutcome = ''; render(await window.moyu.acknowledge()); $('result').textContent = '已解除发送锁定，请检查文字后自行发送。'; $('draft').focus();};
$('settings').onclick = () => {
  const open = $('preferences').hidden;
  $('preferences').hidden = !open; $('composer').hidden = open;
  $('settings').textContent = open ? '返回' : '设置';
  if (open) $('settingResult').textContent = state.appMessage || '';
  else $('draft').focus();
};
$('saveShortcut').onclick = async () => {const result = await window.moyu.shortcut($('shortcut').value.trim()); $('settingResult').textContent = result.ok ? '快捷键已保存' : result.message;};
$('openExtension').onclick = async () => {const error = await window.moyu.openExtension(); if (error) $('settingResult').textContent = error;};
$('repair').onclick = async () => {$('settingResult').textContent = (await window.moyu.installBridge()).message;};
window.moyu.onState(render);
window.moyu.onFocus(() => {$('preferences').hidden = true; $('composer').hidden = false; $('settings').textContent = '设置'; $('draft').focus();});
window.moyu.state().then(render);
