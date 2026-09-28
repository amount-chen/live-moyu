async function act(type) {
  try {
    const result = await chrome.runtime.sendMessage({type});
    if (!result.ok) throw new Error(result.error);
    render(result.data);
  } catch (error) {document.getElementById('status').textContent = error.message;}
}
function render(data) {
  document.getElementById('room').textContent = data.title || '尚未绑定直播间';
  document.getElementById('status').textContent = data.nativeConnected ? data.message : '桌面程序未连接，请先启动它，再点击绑定。';
}
document.getElementById('bind').onclick = () => act('bind');
document.getElementById('unbind').onclick = () => act('unbind');
chrome.storage.onChanged.addListener(changes => {if (changes.view?.newValue) render(changes.view.newValue);});
act('state');
