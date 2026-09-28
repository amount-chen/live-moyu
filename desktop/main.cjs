const {app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeTheme, screen, shell} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {randomUUID} = require('node:crypto');
const {encode, decoder} = require('./framing.cjs');
const {Controller} = require('./controller.cjs');
const run = promisify(execFile);
const HOST = 'com.livemoyu.bridge';
const smoke = process.argv.includes('--smoke-test');
const smokeRoot = app.isPackaged ? path.join(path.dirname(app.getPath('exe')), '..', '.cache') : path.join(__dirname, '..', '.cache');
if (smoke) app.setPath('userData', path.join(smokeRoot, 'smoke-data'));
let win, tray, helper, controller, config = {}, configFile, previousWindow = null, showing = false;
let appMessage = '', bridgeConnected = false, lastPong = 0;
let shortcutError = '';
let helperReady = false;
const localRequests = new Map();
const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const nativeRoot = app.isPackaged ? path.join(root, 'native') : path.join(root, 'native', 'bin');
const extensionRoot = path.join(root, app.isPackaged ? 'extension' : 'full-extension');
const bridgePath = path.join(nativeRoot, 'LiveMoyuBridge.exe');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => reveal());
  app.whenReady().then(start).catch(error => {appMessage = error.message; console.error(error.message); app.quit();});
}
function state() {return {...controller?.state, busy: !!controller?.pending, uncertain: !!controller?.uncertain,
  shortcut: config.shortcut || 'Control+Alt+B', theme: config.theme === 'dark' ? 'dark' : 'light', compact: config.compact === true, appMessage, shortcutError, extensionRoot};}
function publish() {if (win && !win.isDestroyed()) win.webContents.send('state', state());}
function save() {fs.writeFileSync(configFile, JSON.stringify(config, null, 2));}
function toggleCompact() {
  const compact = config.compact !== true;
  const width = compact ? 320 : 460, height = compact ? 64 : 380;
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const position = {
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))
  };
  const previous = {...config};
  config.compact = compact; config.position = position;
  try {save();} catch (error) {config = previous; throw error;}
  win.setBounds({...position, width, height});
  publish();
  win.webContents.send('input-focus');
  return state();
}
function toggleTheme() {
  const previous = config.theme;
  config.theme = config.theme === 'dark' ? 'light' : 'dark';
  try {save();} catch (error) {config.theme = previous; throw error;}
  nativeTheme.themeSource = config.theme;
  win.setBackgroundColor(config.theme === 'dark' ? '#202124' : '#f4f6fb');
  publish();
  return state();
}
function toHelper(value) {
  if (!helper || helper.killed || !helper.stdin.writable) throw new Error('本地连接组件未运行，请重启程序');
  helper.stdin.write(encode(value));
}
function local(type, extra = {}) {
  return new Promise(resolve => {
    const id = randomUUID(); const timeout = setTimeout(() => {localRequests.delete(id); resolve({});}, 600);
    localRequests.set(id, value => {clearTimeout(timeout); resolve(value);});
    try {toHelper({scope: 'local', type, id, ...extra});} catch {clearTimeout(timeout); localRequests.delete(id); resolve({});}
  });
}
async function reveal() {
  if (!win || showing) return;
  if (win.isVisible() && win.isFocused()) {win.webContents.send('input-focus'); return;}
  showing = true;
  try {
    previousWindow = await local('capture');
    win.show(); win.focus(); win.webContents.send('input-focus');
  } finally {showing = false;}
}
async function hide() {
  if (!win) return;
  if (win.isFocused() && previousWindow?.hwnd) {
    const handle = win.getNativeWindowHandle();
    const expected = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
    await local('restore', {hwnd: previousWindow.hwnd, pid: previousWindow.pid, expected});
  }
  win.hide(); previousWindow = null;
}
async function installBridge() {
  const extensionId = fs.readFileSync(path.join(nativeRoot, 'extension-id.txt'), 'utf8').trim();
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('扩展 ID 无效');
  const manifest = path.join(app.getPath('userData'), 'native-host.json');
  fs.writeFileSync(manifest, JSON.stringify({name: HOST, description: 'LiveMoyu local bridge', path: bridgePath,
    type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`]}, null, 2));
  const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  await run(reg, ['ADD', `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST}`, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'], {windowsHide: true});
  appMessage = '本地连接已就绪。请加载连接器扩展并绑定直播间。'; publish();
  return {ok: true, message: appMessage};
}
function registerShortcut(value) {
  if (typeof value !== 'string' || value.length > 70 || !/^(?:(?:Control|Ctrl|Alt|Shift)\+){1,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(value)) throw new Error('快捷键格式示例：Control+Alt+B');
  if (globalShortcut.isRegistered(value)) return;
  if (!globalShortcut.register(value, reveal)) throw new Error('快捷键已被其他程序占用，请换一个组合');
  if (config.shortcut && config.shortcut !== value) globalShortcut.unregister(config.shortcut);
  config.shortcut = value; save(); publish();
  shortcutError = ''; publish();
}
async function start() {
  configFile = path.join(app.getPath('userData'), 'settings.json');
  fs.mkdirSync(path.dirname(configFile), {recursive: true});
  try {config = JSON.parse(fs.readFileSync(configFile, 'utf8'));} catch {}
  nativeTheme.themeSource = config.theme === 'dark' ? 'dark' : 'light';
  controller = new Controller(payload => {
    if (!bridgeConnected) throw new Error('离线');
    toHelper({scope: 'browser', payload});
  }, publish);
  const area = screen.getPrimaryDisplay().workArea;
  const width = config.compact === true ? 320 : 460;
  const height = config.compact === true ? 64 : 380;
  let position = config.position;
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !screen.getAllDisplays().some(d =>
    position.x >= d.workArea.x && position.y >= d.workArea.y && position.x + width <= d.workArea.x + d.workArea.width && position.y + height <= d.workArea.y + d.workArea.height)) {
    position = {x: area.x + Math.max(0, area.width - width - 30), y: area.y + Math.max(0, area.height - height - 60)};
  }
  win = new BrowserWindow({width, height, ...position, show: false, frame: false, alwaysOnTop: true, icon: path.join(__dirname, 'app.ico'),
    resizable: false, skipTaskbar: true, backgroundColor: config.theme === 'dark' ? '#202124' : '#f4f6fb', title: '直播摸鱼',
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      additionalArguments: [`--moyu-theme=${config.theme === 'dark' ? 'dark' : 'light'}`, `--moyu-compact=${config.compact === true}`]}});
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.on('close', event => {if (!app.isQuitting) {event.preventDefault(); hide();}});
  let moved;
  win.on('moved', () => {clearTimeout(moved); moved = setTimeout(() => {const [x,y] = win.getPosition(); config.position = {x,y}; save();}, 300);});
  helper = spawn(bridgePath, ['--server'], {windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']});
  const parse = decoder(message => {
    if (message.scope === 'browser') {
      if (message.payload?.type === 'pong') lastPong = Date.now();
      else if (message.payload) controller.receive(message.payload);
    } else if (message.type === 'reply') {const resolve = localRequests.get(message.id); localRequests.delete(message.id); resolve?.(message);}
    else if (message.type === 'ready') helperReady = true;
    else if (message.type === 'connected') {bridgeConnected = true; lastPong = Date.now(); toHelper({scope: 'browser', payload: {type: 'ping'}});}
    else if (message.type === 'disconnected') {bridgeConnected = false; controller.disconnect();}
  });
  helper.stdout.on('data', chunk => {try {parse(chunk);} catch {helper.kill();}});
  helper.stdin.on('error', () => controller.disconnect());
  helper.on('error', error => {appMessage = `本地组件启动失败：${error.message}`; controller.disconnect();});
  helper.on('exit', () => {helperReady = false; bridgeConnected = false; appMessage = '本地组件已停止，请重启直播摸鱼'; controller.disconnect();});
  const heartbeat = setInterval(() => {
    if (!bridgeConnected) return;
    if (Date.now() - lastPong > 16000) controller.disconnect();
    try {toHelper({scope: 'browser', payload: {type: 'ping'}});} catch {controller.disconnect();}
  }, 5000); heartbeat.unref();
  tray = new Tray(path.join(__dirname, 'tray.ico'));
  tray.setToolTip('直播摸鱼 · Ctrl+Alt+B');
  tray.setContextMenu(Menu.buildFromTemplate([{label: '显示输入框', click: reveal}, {label: '退出', click: () => {app.isQuitting = true; app.quit();}}]));
  tray.on('double-click', reveal);
  try {registerShortcut(config.shortcut || 'Control+Alt+B');} catch (error) {shortcutError = error.message;}
  const handlers = {
    'toggle-compact': () => toggleCompact(),
    'toggle-theme': () => toggleTheme(),
    state: () => state(), send: (_event, text) => controller.send(text), hide: () => hide(),
    acknowledge: () => {controller.uncertain = false; publish(); return state();},
    shortcut: (_event, value) => {try {registerShortcut(value); return {ok: true};} catch (error) {return {ok: false, message: error.message};}},
    'install-bridge': () => installBridge().catch(error => ({ok: false, message: error.message})),
    'open-extension': () => shell.openPath(extensionRoot)
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid sender');
    return handler(event, ...args);
  });
  await win.loadFile(path.join(__dirname, 'index.html'));
  if (smoke) {
    publish(); await reveal();
    setTimeout(async () => {
      try {
        const shot = await win.webContents.capturePage();
        fs.writeFileSync(path.join(smokeRoot, 'desktop-preview.png'), shot.toPNG());
        fs.writeFileSync(path.join(smokeRoot, 'smoke-result.json'), JSON.stringify({loaded: !win.webContents.isCrashed?.(), helperRunning: helperReady && helper.exitCode === null, shortcutRegistered: globalShortcut.isRegistered(config.shortcut), state: state()}));
      } finally {app.isQuitting = true; app.quit();}
    }, 800);
    return;
  }
  // Registration is local, per-user and only names this project's extension.
  try {await installBridge();} catch (error) {appMessage = `本地连接注册失败：${error.message}`;}
  publish(); reveal();
}
app.on('window-all-closed', event => {});
app.on('before-quit', () => {app.isQuitting = true;});
app.on('will-quit', () => {globalShortcut.unregisterAll(); helper?.kill();});
