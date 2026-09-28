(function (root) {
  function classify(status, data) {
    if (!status) return {status: 'unknown', message: '网络响应中断，请核对直播间。'};
    if (status < 200 || status >= 300) return {status: 'failed', message: `服务器返回 HTTP ${status}`};
    if (!data || typeof data.code !== 'number') return {status: 'unknown', message: '无法识别服务器返回值，请检查直播间。'};
    const message = typeof data.message === 'string' ? data.message : typeof data.msg === 'string' ? data.msg : '';
    if (data.code !== 0) return {status: 'failed', message: message || `发送被拒绝（${data.code}）`};
    if (message.trim()) return {status: 'unknown', message: `服务器提示：${message}；请核对直播间。`};
    return {status: 'accepted', message: '服务器已接受'};
  }
  root.LiveMoyuResponse = {classify};
  if (typeof module !== 'undefined') module.exports = {classify};
})(globalThis);
