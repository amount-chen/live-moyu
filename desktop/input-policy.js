(function(root) {
  function shouldSend(event, composing, endedAt, now) {
    return event.key === 'Enter' && !event.shiftKey && !event.repeat && !event.isComposing && event.keyCode !== 229 && !composing && now - endedAt > 80;
  }
  root.LiveMoyuInput = {shouldSend};
  if (typeof module !== 'undefined') module.exports = {shouldSend};
})(globalThis);
