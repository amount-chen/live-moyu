(() => {
  const token = crypto.randomUUID();
  const seen = new Set();
  let busy = false;
  const room = () => location.origin + location.pathname.replace(/\/$/, '');
  const visible = node => !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  function controls() {
    const inputs = [...document.querySelectorAll('textarea')].filter(visible);
    const buttons = [...document.querySelectorAll('button, [role="button"], input[type="submit"], .bl-button, .send-btn')]
      .filter(node => visible(node) && (node.innerText || node.value || '').trim() === '发送');
    if (inputs.length !== 1 || buttons.length !== 1) throw new Error('不能唯一识别弹幕输入框或发送按钮，请检查直播页布局。');
    if (inputs[0].disabled || inputs[0].readOnly) throw new Error('弹幕输入不可用，请检查登录或禁言状态。');
    return {input: inputs[0], button: buttons[0]};
  }
  async function send(message) {
    if (busy || seen.has(message.id)) throw new Error('重复请求或已有发送正在进行。');
    if (message.token !== token || message.url !== room()) throw new Error('页面已刷新或直播间变化，请稍后重新绑定。');
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 500) throw new Error('弹幕内容为空或过长。');
    if (!Number.isFinite(message.expiresAt) || Date.now() >= message.expiresAt) throw new Error('请求已过期。');
    const {input, button} = controls();
    if (input.value) throw new Error('直播页有未发送草稿，请先处理，避免覆盖。');
    if (input.maxLength >= 0 && message.text.length > input.maxLength) throw new Error(`超过页面字数上限 ${input.maxLength}。`);
    seen.add(message.id); busy = true;
    return new Promise(resolve => {
      let clicked = false;
      let clickTimer;
      let finished = false;
      const finish = result => {
        if (finished) return; finished = true;
        clearTimeout(deadline); clearTimeout(clickTimer);
        window.removeEventListener('message', receive);
        window.postMessage({source: 'live-moyu-page', type: 'disarm', id: message.id}, location.origin);
        busy = false; resolve(result);
      };
      const deadline = setTimeout(() => finish({status: clicked ? 'unknown' : 'failed',
        message: clicked ? '发送结果未确认，请到直播间核对。不会自动重发。' : '无法启动发送结果监听，未发送。'}), 11000);
      const receive = event => {
        if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'live-moyu-observer' || event.data.id !== message.id) return;
        if (event.data.type === 'result' && clicked) {
          const result = event.data;
          if (!['accepted', 'failed', 'unknown'].includes(result.status)) return;
          finish({status: result.status, message: String(result.message || '').slice(0, 250)});
        }
        if (event.data.type !== 'armed' || clicked || clickTimer) return;
        if (Date.now() >= message.expiresAt || room() !== message.url) {finish({status: 'failed', message: '请求过期或直播间已变化，未发送。'}); return;}
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, message.text);
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
        clickTimer = setTimeout(() => {
          if (Date.now() >= message.expiresAt || room() !== message.url || !input.isConnected || !button.isConnected || input.value !== message.text) {
            finish({status: 'failed', message: '页面状态变化，未点击发送；请检查网页草稿。'}); return;
          }
          if (button.disabled || button.getAttribute('aria-disabled') === 'true' || button.classList.contains('disabled')) {
            finish({status: 'failed', message: '发送按钮不可用；文字保留在网页，请检查登录或发送限制。'}); return;
          }
          clicked = true;
          try { button.click(); } catch { finish({status: 'unknown', message: '页面发送发生异常，请核对直播间。'}); }
        }, 100);
      };
      window.addEventListener('message', receive);
      window.postMessage({source: 'live-moyu-page', type: 'arm', id: message.id, text: message.text}, location.origin);
    });
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'hello') { reply({ok: true, token, url: room()}); return; }
    if (message.type === 'send') {
      send(message).then(result => reply({ok: true, ...result}), error => reply({ok: true, status: 'failed', message: error.message}));
      return true;
    }
  });
})();
