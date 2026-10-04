// Test-only wrapper around the production main bundle. No test IPC is shipped.
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { app } = electron;
const NativeBrowserWindow = electron.BrowserWindow;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = (event, data = {}) => console.log('MULTI_WINDOW ' + JSON.stringify({ event, at: Date.now(), pid: process.pid, ...data }));
process.on('uncaughtException', error => { report('error', { message: String(error) }); app.exit(1); });
process.on('unhandledRejection', error => { report('error', { message: String(error) }); app.exit(1); });
app.setPath('userData', process.env.OPENTYPORA_TEST_PROFILE);
if (process.env.OPENTYPORA_TEST_GATE) {
  const whenReady = app.whenReady.bind(app);
  app.whenReady = async () => {
    await whenReady();
    while (!fs.existsSync(process.env.OPENTYPORA_TEST_GATE)) await delay(25);
  };
}
app.on('browser-window-created', (_event, window) => {
    report('window-created', { windowId: window.id });
    window.webContents.once('dom-ready', async () => {
      try {
        const documentPath = new URL(window.webContents.getURL()).searchParams.get('document');
        const expected = documentPath ? fs.readFileSync(documentPath, 'utf8').match(/DOCUMENT_[A-Z_]+/)[0] : null;
        for (let attempt = 0; attempt < 200 && !window.isDestroyed(); attempt++) {
          const state = await window.webContents.executeJavaScript(`({editor:!!document.querySelector('.cm-content'),text:document.querySelector('.cm-content')?.textContent,title:document.title,root:document.querySelector('.root-directory')?.title})`);
          if (state.editor && (!expected || state.text.includes(expected) && state.root === path.dirname(documentPath))) {
            report('document-loaded', { windowId: window.id, documentPath, ...state });
            return;
          }
          await delay(25);
        }
        throw new Error('Document did not load: ' + documentPath);
      } catch (error) { report('error', { message: String(error) }); }
    });
});

let lastRequest = '';
setInterval(async () => {
  let request;
  try { request = JSON.parse(fs.readFileSync(process.env.OPENTYPORA_TEST_CONTROL, 'utf8')); } catch { return; }
  if (request.id === lastRequest) return;
  lastRequest = request.id;
  try {
    let value;
    const window = request.windowId ? NativeBrowserWindow.fromId(request.windowId) : null;
    if (request.action === 'evaluate') value = await window.webContents.executeJavaScript(request.script);
    else if (request.action === 'command') window.webContents.send('opentypora:command', request.command);
    else if (request.action === 'close-all') NativeBrowserWindow.getAllWindows().forEach(window => window.close());
    else if (request.action === 'quit') { app.exit(0); return; }
    else throw new Error('Unknown test action');
    report('response', { id: request.id, value });
  } catch (error) { report('response', { id: request.id, error: String(error) }); }
}, 25).unref();
setTimeout(() => { report('error', { message: 'Test lifetime exceeded' }); app.exit(1); }, 90000).unref();
// Change only window visibility/throttling in memory, keeping the bundle's original paths.
// The real instance lock, startup, IPC, file operations and renderer all run unchanged.
const mainPath = process.env.OPENTYPORA_TEST_MAIN;
const source = fs.readFileSync(mainPath, 'utf8');
if (!source.includes('show: !smokeTest') || !source.includes('webPreferences: { preload:')) throw new Error('Production window options changed; update the test wrapper');
const Module = require('node:module');
const main = new Module(mainPath, module);
main.filename = mainPath;
main.paths = Module._nodeModulePaths(path.dirname(mainPath));
main._compile(source.replace('show: !smokeTest', 'show: false').replace('webPreferences: { preload:', 'webPreferences: { backgroundThrottling: false, preload:'), mainPath);
report('main-loaded', { primary: app.hasSingleInstanceLock() });
