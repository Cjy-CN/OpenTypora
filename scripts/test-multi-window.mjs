// Exercise actual secondary processes, shared Chromium storage and independent document windows.
// Run after npm run build. All windows, files, profiles and controls are isolated.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const require = createRequire(import.meta.url), root = process.cwd();
const directory = await fs.mkdtemp(join(tmpdir(), 'opentypora-multi-window-'));
const application = join(directory, 'app'), profile = join(directory, 'profile'), gate = join(directory, 'startup-ready');
const children = [], timings = [], errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const value = await check(); if (value) return value;
    await delay(25);
  }
  throw new Error(message);
}
function launch(label, args, cwd = root, gated = false, userData = profile) {
  const launched = Date.now(), control = join(directory, `${label}.json`);
  const env = { ...process.env, OPENTYPORA_TEST_PROFILE: userData, OPENTYPORA_TEST_CONTROL: control,
    OPENTYPORA_TEST_MAIN: join(root, 'dist-electron/main.cjs') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.OPENTYPORA_DEV_URL;
  if (gated) env.OPENTYPORA_TEST_GATE = gate;
  else delete env.OPENTYPORA_TEST_GATE;
  const child = spawn(require('electron'), [application, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { label, child, launched, control, events: [], stderr: '', exitCode: undefined };
  children.push(state);
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      if (!line.startsWith('MULTI_WINDOW ')) continue;
      const event = JSON.parse(line.slice(13)); state.events.push(event);
      if (event.event === 'error') errors.push({ label, ...event });
    }
  });
  child.stderr.on('data', chunk => { state.stderr += chunk; });
  child.on('error', error => errors.push({ label, error: String(error) }));
  child.on('close', code => { state.exitCode = code; });
  return state;
}
let requestId = 0;
async function request(target, action) {
  const id = String(++requestId);
  await fs.writeFile(target.control, JSON.stringify({ id, ...action }));
  const response = await until(() => target.events.find(event => event.event === 'response' && event.id === id), `No response: ${action.action}`);
  assert.equal(response.error, undefined, response.error); return response.value;
}
const loaded = (target, path) => target.events.find(event => event.event === 'document-loaded' && event.documentPath === path);
async function handedOff(target) {
  await until(() => target.exitCode !== undefined, `${target.label} did not exit after forwarding`);
  assert.equal(target.exitCode, 0, target.stderr);
  assert.equal(target.events.some(event => event.event === 'window-created'), false, 'Secondary process created its own window');
}
const text = (target, windowId) => request(target, { action: 'evaluate', windowId, script: "document.querySelector('.cm-content').textContent" });
const command = (target, windowId, command) => request(target, { action: 'command', windowId, command });
async function paste(target, windowId, addition) {
  await command(target, windowId, 'selection.documentEnd');
  await request(target, { action: 'evaluate', windowId, script: `(()=>{const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(addition)});document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()` });
  await until(async () => (await text(target, windowId)).includes(addition.trim()), 'Paste did not update the document');
}
try {
  await fs.mkdir(application); await fs.mkdir(profile);
  await fs.writeFile(join(application, 'package.json'), JSON.stringify({ name: 'opentypora-multi-window-test', version: '0.0.0', main: 'main.cjs' }));
  await fs.copyFile('tests/multi-window/main.cjs', join(application, 'main.cjs'));
  const files = [];
  for (const [index, marker] of ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'].entries()) {
    const folder = join(directory, `目录 ${index}`); await fs.mkdir(folder);
    const path = join(folder, `中文笔记 ${index}.md`), source = `# DOCUMENT_${marker}\n\nIndependent document.\n`;
    await fs.writeFile(path, source); files.push({ path, folder, source });
  }
  const primary = launch('primary', [files[0].path], root, true);
  await until(() => primary.events.some(event => event.event === 'main-loaded' && event.primary), 'Primary did not acquire the instance lock');
  const earlyOne = launch('early-relative', ['中文笔记 1.md'], files[1].folder);
  await handedOff(earlyOne);
  const earlyTwo = launch('early-explicit', ['--document', files[2].path]);
  await handedOff(earlyTwo);
  assert.equal(primary.events.filter(event => event.event === 'window-created').length, 0, 'Request bypassed startup initialization');
  await fs.writeFile(gate, 'ready');
  for (const file of files.slice(0, 3)) await until(() => loaded(primary, file.path), 'Queued file was lost: ' + file.path);
  assert.deepEqual(primary.events.filter(event => event.event === 'window-created').map(event => event.windowId), [1, 2, 3]);

  for (const [index, file] of files.slice(3).entries()) {
    const secondary = launch(`subsequent-${index}`, [file.path]);
    const document = await until(() => loaded(primary, file.path), 'Forwarded file did not load');
    await handedOff(secondary);
    const elapsed = document.at - secondary.launched; timings.push(elapsed);
    assert.ok(elapsed < 4000, `Secondary launch stalled for ${elapsed} ms`);
  }
  const blank = launch('blank', []);
  await handedOff(blank);
  await until(() => loaded(primary, null), 'Blank launch did not create a separate window');
  assert.equal(primary.events.filter(event => event.event === 'window-created').length, 7);

  // Separate profiles remain independent (development/tests must not route into a real app).
  const isolatedProfile = join(directory, 'other-profile'); await fs.mkdir(isolatedProfile);
  const isolated = launch('isolated-profile', [files[2].path], root, false, isolatedProfile);
  await until(() => loaded(isolated, files[2].path), 'Independent profile could not launch');
  assert.ok(isolated.events.some(event => event.event === 'main-loaded' && event.primary));
  await request(isolated, { action: 'close-all' });
  await until(() => isolated.exitCode !== undefined, 'Independent profile did not close');
  assert.equal(isolated.exitCode, 0);

  const first = loaded(primary, files[0].path).windowId, second = loaded(primary, files[1].path).windowId;
  await paste(primary, first, '\nAPPEND_ONE');
  assert.ok(!(await text(primary, second)).includes('APPEND_ONE'));
  await command(primary, first, 'file.save');
  await until(async () => (await fs.readFile(files[0].path, 'utf8')).includes('APPEND_ONE'), 'First window did not save');
  assert.equal(await fs.readFile(files[1].path, 'utf8'), files[1].source);
  const firstSaved = await fs.readFile(files[0].path, 'utf8');
  await paste(primary, second, '\nAPPEND_TWO');
  await command(primary, second, 'edit.undo');
  await until(async () => !(await text(primary, second)).includes('APPEND_TWO'), 'Second window undo failed');
  assert.ok((await text(primary, first)).includes('APPEND_ONE'));
  await command(primary, second, 'edit.redo');
  await until(async () => (await text(primary, second)).includes('APPEND_TWO'), 'Second window redo failed');
  await command(primary, second, 'file.save');
  await until(async () => (await fs.readFile(files[1].path, 'utf8')).includes('APPEND_TWO'), 'Second window did not save');
  assert.equal(await fs.readFile(files[0].path, 'utf8'), firstSaved);
  await request(primary, { action: 'close-all' });
  await until(() => primary.exitCode !== undefined, 'Closing all windows did not stop the primary process');
  assert.equal(primary.exitCode, 0, primary.stderr);
  const restart = launch('restart', [files[2].path]);
  await until(() => loaded(restart, files[2].path), 'Could not restart after last window closed');
  assert.ok(restart.events.some(event => event.event === 'main-loaded' && event.primary));
  await request(restart, { action: 'close-all' });
  await until(() => restart.exitCode !== undefined, 'Restarted app did not close');
  assert.equal(restart.exitCode, 0);
  for (const child of children) assert.doesNotMatch(child.stderr, /Unable to create cache|Gpu Cache Creation failed|UnhandledPromiseRejection/);
  console.log(JSON.stringify({ multiWindow: true, earlyLaunchQueue: true, pathsWithSpacesAndChinese: true, relativePaths: true, blankLaunch: true,
    separateProfiles: true, independentEditsAndSaves: true, independentUndoRedo: true, restartAfterClose: true, secondaryLoadMs: timings }));
} catch (error) {
  for (const child of children) console.error(JSON.stringify({ label: child.label, exitCode: child.exitCode, events: child.events, stderr: child.stderr }));
  throw error;
} finally {
  for (const target of children) {
    if (target.exitCode !== undefined) continue;
    await fs.writeFile(target.control, JSON.stringify({ id: 'shutdown', action: 'quit' }));
    for (let attempt = 0; attempt < 80 && target.exitCode === undefined; attempt++) await delay(25);
    if (target.exitCode === undefined) { target.child.kill(); await new Promise(done => target.child.once('close', done)); }
  }
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !target.split(/[\\/]/).at(-1).startsWith('opentypora-multi-window-')) throw new Error('Invalid test cleanup path');
  await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
