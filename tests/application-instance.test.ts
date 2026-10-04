import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import type { App } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { claimApplicationInstance, launchDocumentPath } from '../electron/application-instance';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
function application(primary = true) {
  const events = new EventEmitter();
  const requestSingleInstanceLock = vi.fn(() => primary), exit = vi.fn();
  const app = Object.assign(events, { requestSingleInstanceLock, exit }) as unknown as App;
  return { app, events, requestSingleInstanceLock, exit };
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('application instance routing', () => {
  it('resolves paths at the launching process, preserving spaces and Chinese characters', () => {
    const directory = resolve('notes with spaces');
    expect(launchDocumentPath(['OpenTypora.exe', '中文笔记.MD'], true, directory)).toBe(resolve(directory, '中文笔记.MD'));
    expect(launchDocumentPath(['electron', 'app.md', '--document', '../other/second.md'], false, directory)).toBe(resolve(directory, '../other/second.md'));
    expect(launchDocumentPath(['OpenTypora.exe'], true, directory)).toBeUndefined();
  });

  it('forwards the parsed path and quits a secondary process without opening a window', async () => {
    const { app, events, requestSingleInstanceLock, exit } = application(false);
    const openWindow = vi.fn(), documentPath = resolve('中文文件.md');
    expect(claimApplicationInstance({ app, documentPath, packaged: true, ready: Promise.resolve(), openWindow, onError: vi.fn() })).toBe(false);
    expect(requestSingleInstanceLock).toHaveBeenCalledWith({ documentPath });
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(events.listenerCount('second-instance')).toBe(0);
    await settle();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('queues every early request until startup is ready, then creates windows in order', async () => {
    const { app, events } = application(), ready = deferred(), first = deferred();
    const one = resolve('one.md'), two = resolve('two.md');
    const openWindow = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    claimApplicationInstance({ app, packaged: true, ready: ready.promise, openWindow, onError: vi.fn() });
    events.emit('second-instance', {}, ['incorrect.md', 'argv.md'], process.cwd(), { documentPath: one });
    events.emit('second-instance', {}, [], process.cwd(), { documentPath: two });
    await settle();
    expect(openWindow).not.toHaveBeenCalled();
    ready.resolve(); await settle();
    expect(openWindow.mock.calls).toEqual([[one]]);
    first.resolve(); await settle();
    expect(openWindow.mock.calls).toEqual([[one], [two]]);
  });

  it('handles blank launches and resolves legacy argv against the sender directory', async () => {
    const { app, events } = application(), openWindow = vi.fn().mockResolvedValue(undefined);
    const cwd = resolve('different working directory');
    claimApplicationInstance({ app, packaged: true, ready: Promise.resolve(), openWindow, onError: vi.fn() });
    events.emit('second-instance', {}, ['OpenTypora.exe', 'ignore.md'], cwd, { documentPath: null });
    events.emit('second-instance', {}, ['OpenTypora.exe', '中文 file.md'], cwd, {});
    await settle();
    expect(openWindow.mock.calls).toEqual([[undefined], [resolve(cwd, '中文 file.md')]]);
  });

  it('reports window creation failures and still opens later requests', async () => {
    const { app, events } = application(), failure = new Error('window failed'), onError = vi.fn();
    const openWindow = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    claimApplicationInstance({ app, packaged: true, ready: Promise.resolve(), openWindow, onError });
    events.emit('second-instance', {}, [], process.cwd(), { documentPath: resolve('one.md') });
    events.emit('second-instance', {}, [], process.cwd(), { documentPath: resolve('two.md') });
    await settle();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(openWindow).toHaveBeenCalledTimes(2);
    expect(openWindow).toHaveBeenLastCalledWith(resolve('two.md'));
  });
});
