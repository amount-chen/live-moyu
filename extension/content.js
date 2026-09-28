(() => {
  if (globalThis.__liveMoyuProbeInstalled) return;
  globalThis.__liveMoyuProbeInstalled = true;
  const documentToken = crypto.randomUUID();
  const seen = new Set();
  const visible = node => !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  function pick(selector, fallback, label) {
    let nodes;
    try { nodes = [...document.querySelectorAll(selector || fallback)].filter(visible); }
    catch { throw new Error(`${label} CSS 选择器格式不正确。`); }
    if (label === '发送按钮' && !selector) nodes = nodes.filter(node => (node.innerText || node.value || '').trim() === '发送');
    if (nodes.length !== 1) throw new Error(`${label}识别到 ${nodes.length} 个候选，需在高级选项中指定唯一 CSS 选择器。`);
    return nodes[0];
  }
  function controls(selectors = {}) {
    const input = pick(selectors.input, 'textarea', '弹幕输入框');
    const button = pick(selectors.button, 'button, [role="button"], input[type="submit"], .bl-button, .send-btn', '发送按钮');
    if (!(input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement)) throw new Error('暂只支持标准文本输入框。');
    if (input.disabled || input.readOnly) throw new Error('输入框不可编辑，请检查登录、禁言或页面状态。');
    if (input.value) throw new Error('直播页输入框已有草稿，请先自行处理；扩展不会覆盖它。');
    return {input, button};
  }
  function handle(message) {
    if (message.type === 'hello') return {documentToken};
    if (message.documentToken !== documentToken) throw new Error('页面已经刷新，请在直播页重新点击扩展绑定。');
    const {input, button} = controls(message.selectors);
    if (message.type === 'probe') return {documentToken, placeholder: input.placeholder,
      maxLength: input.maxLength, buttonText: (button.innerText || button.value || '').trim()};
    if (message.type !== 'send') throw new Error('未知操作。');
    if (!Number.isFinite(message.expiresAt) || Date.now() >= message.expiresAt) throw new Error('请求已过期，未触发发送。');
    if (seen.has(message.id)) throw new Error('重复请求已拦截，不会再次发送。');
    if (location.origin + location.pathname.replace(/\/$/, '') !== message.url) throw new Error('直播间已变化，发送已中止。');
    if (typeof message.text !== 'string' || !message.text.trim()) throw new Error('空消息已拦截。');
    if (input.maxLength >= 0 && message.text.length > input.maxLength) throw new Error(`超出页面输入上限 ${input.maxLength}。`);
    seen.add(message.id);
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, message.text);
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    return new Promise(resolve => setTimeout(() => {
      if (Date.now() >= message.expiresAt) { resolve({aborted: '页面响应太慢，请求已过期，未点击发送。'}); return; }
      const sameRoom = location.origin + location.pathname.replace(/\/$/, '') === message.url;
      if (!sameRoom || !input.isConnected || !button.isConnected || input.value !== message.text) {
        resolve({aborted: '页面或输入内容发生变化，未点击发送。'}); return;
      }
      if (button.disabled || button.getAttribute('aria-disabled') === 'true' || button.classList.contains('disabled')) {
        resolve({aborted: '发送按钮不可用，未点击；文字已留在直播页输入框。'}); return;
      }
      const visibilityAtClick = document.visibilityState;
      const documentFocusedAtClick = document.hasFocus();
      button.click();
      setTimeout(() => resolve({evidence: {
        clickDispatched: true, inputCleared: input.value === '', visibilityAtClick, documentFocusedAtClick,
        visibilityAtObservation: document.visibilityState,
        note: '按钮点击和输入框清空均不能证明发送成功，请人工查看直播间。'
      }}), 1500);
    }, 100));
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    Promise.resolve().then(() => handle(message)).then(result => {
      if (result.aborted) respond({ok: false, error: result.aborted});
      else respond({ok: true, ...result});
    }, error => respond({ok: false, error: error.message}));
    return true;
  });
})();
