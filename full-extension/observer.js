(() => {
  if (window.__liveMoyuObserver) return;
  window.__liveMoyuObserver = true;
  const classify = LiveMoyuResponse.classify;
  let pending = null;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'live-moyu-page') return;
    const value = event.data;
    if (value.type === 'arm' && typeof value.id === 'string' && typeof value.text === 'string' && value.text.length <= 500) {
      pending = {id: value.id, text: value.text, expires: Date.now() + 11000, claimed: false};
      window.postMessage({source: 'live-moyu-observer', type: 'armed', id: value.id}, location.origin);
    } else if (value.type === 'disarm' && pending?.id === value.id) pending = null;
  });
  function claim(url, body) {
    if (!pending || pending.claimed || Date.now() >= pending.expires) return null;
    let target;
    try { target = new URL(url, location.href); } catch { return null; }
    if (target.origin !== 'https://api.live.bilibili.com' || !/^\/msg\/send\/?$/.test(target.pathname)) return null;
    let text;
    try {
      if (body instanceof FormData || body instanceof URLSearchParams) text = body.get('msg');
      else if (typeof body === 'string') {
        text = new URLSearchParams(body).get('msg');
        if (text === null && body.startsWith('{')) text = JSON.parse(body).msg;
      }
    } catch { return null; }
    if (text !== pending.text) return null;
    pending.claimed = true;
    return pending.id;
  }
  function report(id, status, data) {
    if (!id || pending?.id !== id) return;
    window.postMessage({source: 'live-moyu-observer', type: 'result', id, ...classify(status, data)}, location.origin);
    pending = null;
  }
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const id = claim(url, init?.body);
    // Preserve the original promise and leave the request entirely unchanged.
    const promise = originalFetch.apply(this, arguments);
    if (id) promise.then(response => response.clone().json().then(data => report(id, response.status, data), () => report(id, response.status, null)), () => report(id, 0, null)).catch(() => {});
    return promise;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const urls = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url) {
    urls.set(this, String(url));
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const id = claim(urls.get(this), body);
    if (id) this.addEventListener('loadend', () => {
      let data = null;
      try { data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText); } catch {}
      report(id, this.status, data);
    }, {once: true});
    return originalSend.apply(this, arguments);
  };
})();
