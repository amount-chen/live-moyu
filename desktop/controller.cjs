const {randomUUID} = require('node:crypto');
class Controller {
  constructor(transport, changed, timers = globalThis) {
    this.transport = transport; this.changed = changed; this.timers = timers;
    this.state = {connected: false, ready: false, title: '', room: '', message: '请启动 Edge 并绑定直播间'};
    this.pending = null; this.uncertain = false;
  }
  update(state) {this.state = {...this.state, ...state}; this.changed();}
  receive(message) {
    if (message.type === 'state') {
      this.update({connected: true, ready: message.ready === true, title: String(message.title || '').slice(0, 200),
        room: String(message.room || ''), revision: String(message.revision || ''), message: String(message.message || '').slice(0, 250)});
    } else if (message.type === 'result' && message.id === this.pending?.id) {
      const status = ['accepted', 'failed', 'unknown'].includes(message.status) ? message.status : 'unknown';
      this.finish({status, message: String(message.message || '发送结果未确认').slice(0, 250)});
    }
  }
  finish(result) {
    if (!this.pending) return;
    const pending = this.pending; this.pending = null;
    this.timers.clearTimeout(pending.timer);
    this.uncertain = result.status === 'unknown';
    this.changed(); pending.resolve(result);
  }
  disconnect() {
    this.update({connected: false, ready: false, message: '连接已断开，请打开 Edge 并重新连接'});
    this.finish({status: 'unknown', message: '连接中断，发送结果未确认。请核对直播间后再发送。'});
  }
  send(text) {
    if (this.pending) return Promise.resolve({status: 'failed', message: '正在发送，请稍候'});
    if (this.uncertain) return Promise.resolve({status: 'unknown', message: '请先核对上次发送结果'});
    if (!this.state.connected || !this.state.ready) return Promise.resolve({status: 'failed', message: '直播间未连接'});
    if (typeof text !== 'string' || !text.trim() || text.length > 500) return Promise.resolve({status: 'failed', message: '请输入 1–500 个字符'});
    return new Promise(resolve => {
      const id = randomUUID();
      this.pending = {id, resolve, timer: this.timers.setTimeout(() => this.finish({status: 'unknown', message: '等待结果超时，请核对直播间。不会自动重发。'}), 16000)};
      this.changed();
      try {this.transport({type: 'send', id, text, revision: this.state.revision});}
      catch {this.disconnect();}
    });
  }
}
module.exports = {Controller};
