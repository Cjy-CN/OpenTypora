import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { SessionCoordinator, type SessionPrompts } from '../src/platform/session';
import { DocumentStore, createDocument } from '../src/core/document';
import type { DesktopBridge, OpenedFile, Result, SavedFile, SaveRequest } from '../src/shared/contracts';
import { readFile as readDocument, saveFile } from '../electron/services/files';

const oldPath = 'E:/old/a.md', newPath = 'E:/new/a.md';
const fingerprint = { modifiedAt: 1, size: 1, hash: 'original' };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const error = (code = 'IO_FAILED'): Result<never> => ({ ok: false, error: { code, message: code, retryable: true } });
const opened = (path = oldPath, text = 'first'): OpenedFile => ({ path, text, encoding: 'utf-8', bom: false, readonly: false, fingerprint });
const saved = (request: SaveRequest, path = request.path ?? newPath): SavedFile => ({ path, version: request.version, fingerprint });
const stored = (text = 'first') => new DocumentStore(createDocument(text, opened(oldPath, text)));
const prompts = (overrides: Partial<SessionPrompts> = {}): SessionPrompts => ({ leave: vi.fn(async () => 'save' as const), conflict: vi.fn(async () => 'cancel' as const), notify: vi.fn(), ...overrides });
const bridgeFor = (overrides: Partial<DesktopBridge> = {}): DesktopBridge => ({
  save: vi.fn(async (request: SaveRequest) => ok(saved(request))),
  open: vi.fn(async () => ok(opened('E:/next.md', 'next'))),
  import: vi.fn(async () => ok({ text: 'imported', sourcePath: 'E:/input.docx', warnings: [] })),
  readFile: vi.fn(async (path: string) => ok(opened(path))),
  moveFile: vi.fn(async (_from: string, to: string) => ok(to)),
  windowAction: vi.fn(async () => ok(undefined)),
  deleteRecovery: vi.fn(async () => ok(undefined)),
  ...overrides,
} as unknown as DesktopBridge);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const started = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
const relocate = (store: DocumentStore) => vi.fn(async (previous, destination) => {
  expect(store.getSnapshot().path).toBe(previous.path);
  expect(store.getSnapshot().version).toBe(previous.version);
  expect(destination.path).toBe(newPath);
  store.replaceText('![image](assets/new.png)', 'asset');
  return true;
}) as NonNullable<SessionPrompts['relocateAssets']>;

describe('file session transitions', () => {
  it.each([
    ['E:/notes/中文.md', 'E:/notes'],
    ['C:\\notes\\a.md', 'C:\\notes'],
    ['C:\\root.md', 'C:\\'],
    ['E:/root.md', 'E:/'],
    ['\\\\server\\share\\a.md', '\\\\server\\share'],
    ['/root.md', '/'],
  ])('associates an opened file %s with its own directory %s', async (path, directory) => {
    const store = stored(); store.patchMetadata({rootDirectory:'E:/previous'});
    const bridge = bridgeFor({open:vi.fn(async () => ok(opened(path, '# next')))});
    expect(await new SessionCoordinator(store, bridge, prompts()).open(path)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({path,rootDirectory:directory,text:'# next',version:0,dirty:false});
    expect(bridge.open).toHaveBeenCalledWith(path);
  });

  it('keeps directory association local to each window and updates it when switching folders', async () => {
    const first = stored(), second = stored();
    const bridge = bridgeFor({open:vi.fn(async path => ok(opened(path)))});
    const one = new SessionCoordinator(first,bridge,prompts()),two = new SessionCoordinator(second,bridge,prompts());
    await one.open('E:/one/a.md'); await two.open('E:/two/b.md');
    await one.open('E:/three/c.md');
    expect(first.getSnapshot().rootDirectory).toBe('E:/three');
    expect(second.getSnapshot().rootDirectory).toBe('E:/two');
  });

  it.each([ok(null),error('OPEN_FAILED')])('preserves the current directory after a cancelled or failed open', async result => {
    const store = stored();store.patchMetadata({rootDirectory:'E:/manual'});const previous=store.getSnapshot();
    const bridge = bridgeFor({open:vi.fn(async () => result)});
    expect(await new SessionCoordinator(store,bridge,prompts()).open()).toBe(false);
    expect(store.getSnapshot()).toEqual(previous);
  });
  it('retains later edits and blocks switching after a same-path save', async () => {
    const store = stored(); store.replaceText('changed');
    const pending = deferred<Result<SavedFile | null>>();
    const save = vi.fn<DesktopBridge['save']>(() => pending.promise), bridge = bridgeFor({ save });
    const operation = new SessionCoordinator(store, bridge, prompts()).newDocument();
    await started(); const request = save.mock.calls[0][0]; store.replaceText('later'); pending.resolve(ok(saved(request)));
    expect(await operation).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ path: oldPath, text: 'later', dirty: true, savedVersion: request.version });
    expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('retains the original path when a save-as response is outdated', async () => {
    const store = stored(); store.replaceText('changed');
    const pending = deferred<Result<SavedFile | null>>(), save = vi.fn<DesktopBridge['save']>(() => pending.promise);
    const hook = vi.fn(async () => false), dialogs = prompts({ relocateAssets: hook }), bridge = bridgeFor({ save });
    const operation = new SessionCoordinator(store, bridge, dialogs).save(true);
    await started(); const request = save.mock.calls[0][0]; store.replaceText('later'); pending.resolve(ok(saved(request)));
    expect(await operation).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ path: oldPath, text: 'later', dirty: true, saveState: 'failed', diskFingerprint: fingerprint });
    expect(hook).not.toHaveBeenCalled(); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
    expect(dialogs.notify).toHaveBeenCalledWith(expect.stringContaining('DOCUMENT_CHANGED'));
  });

  it('never attaches a late save-as result to a different document', async () => {
    const store = stored(), pending = deferred<Result<SavedFile | null>>();
    const save = vi.fn<DesktopBridge['save']>(() => pending.promise), hook = vi.fn(async () => false), bridge = bridgeFor({ save });
    const operation = new SessionCoordinator(store, bridge, prompts({ relocateAssets: hook })).save(true);
    await started(); const request = save.mock.calls[0][0], next = createDocument('new document'); store.replaceSession(next); pending.resolve(ok(saved(request)));
    expect(await operation).toBe(false); expect(store.getSnapshot()).toEqual(next);
    expect(hook).not.toHaveBeenCalled(); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('never closes a dirty document after cancelling save', async () => {
    const store = new DocumentStore(createDocument('unsaved')), bridge = bridgeFor({ save: vi.fn(async () => ok(null)) });
    expect(await new SessionCoordinator(store, bridge, prompts()).close()).toBe(false);
    expect(bridge.windowAction).not.toHaveBeenCalled(); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ path: null, dirty: true, saveState: 'idle' });
  });

  it.each(['open', 'import', 'close'] as const)('keeps recovery when discard is followed by %s failure/cancellation', async operation => {
    const store = new DocumentStore(createDocument('unsaved')), previous = store.getSnapshot();
    const bridge = bridgeFor({ open: vi.fn(async () => ok(null)), import: vi.fn(async () => error('IMPORT_FAILED')), windowAction: vi.fn(async () => error('CLOSE_FAILED')) });
    const coordinator = new SessionCoordinator(store, bridge, prompts({ leave: vi.fn(async () => 'discard' as const) }));
    expect(await (operation === 'import' ? coordinator.importFile() : coordinator[operation]())).toBe(false);
    expect(store.getSnapshot()).toEqual(previous); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it.each(['open', 'newDocument', 'importFile', 'close'] as const)('cleans the discarded recovery only after %s succeeds', async operation => {
    const store = new DocumentStore(createDocument('unsaved')), previous = store.getSnapshot(), order: string[] = [];
    const bridge = bridgeFor({
      open: vi.fn(async () => { order.push('transition'); return ok(opened('E:/next.md', 'next')); }),
      import: vi.fn(async () => { order.push('transition'); return ok({ text: 'imported', sourcePath: 'input.docx', warnings: [] }); }),
      windowAction: vi.fn(async () => { order.push('transition'); return ok(undefined); }),
      deleteRecovery: vi.fn(async id => { expect(id).toBe(previous.recoveryId); if (operation !== 'close') expect(store.getSnapshot().documentId).not.toBe(previous.documentId); order.push('cleanup'); return ok(undefined); }),
    });
    expect(await new SessionCoordinator(store, bridge, prompts({ leave: vi.fn(async () => 'discard' as const) }))[operation]()).toBe(true);
    expect(order.at(-1)).toBe('cleanup'); expect(bridge.deleteRecovery).toHaveBeenCalledOnce();
  });

  it('protects edits made while the open dialog is pending after discard', async () => {
    const store = new DocumentStore(createDocument('unsaved')), pending = deferred<Result<OpenedFile | null>>();
    const bridge = bridgeFor({ open: vi.fn(() => pending.promise) });
    const operation = new SessionCoordinator(store, bridge, prompts({ leave: vi.fn(async () => 'discard' as const) })).open();
    await started(); store.replaceText('later'); pending.resolve(ok(opened('E:/next.md')));
    expect(await operation).toBe(false); expect(store.getSnapshot().text).toBe('later'); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('does not discard a version changed while the leave prompt is pending', async () => {
    const store = new DocumentStore(createDocument('unsaved')), pending = deferred<'discard'>(), bridge = bridgeFor();
    const operation = new SessionCoordinator(store, bridge, prompts({ leave: vi.fn(() => pending.promise) })).open();
    await started(); store.replaceText('later'); pending.resolve('discard');
    expect(await operation).toBe(false); expect(bridge.open).not.toHaveBeenCalled(); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('never silently overwrites a disk conflict', async () => {
    const store = new DocumentStore(createDocument('unsaved')), bridge = bridgeFor({ save: vi.fn(async () => error('EXTERNAL_CONFLICT')) }), dialogs = prompts();
    expect(await new SessionCoordinator(store, bridge, dialogs).save()).toBe(false);
    expect(dialogs.conflict).toHaveBeenCalledOnce(); expect(bridge.save).toHaveBeenCalledOnce();
    expect(store.getSnapshot().saveState).toBe('conflict'); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('overwrites only after the explicit conflict decision and freezes the retry', async () => {
    const store = stored(); store.replaceText('changed');
    const save = vi.fn<DesktopBridge['save']>().mockResolvedValueOnce(error('EXTERNAL_CONFLICT')).mockImplementation(async request => ok(saved(request)));
    const bridge = bridgeFor({ save });
    expect(await new SessionCoordinator(store, bridge, prompts({ conflict: vi.fn(async () => 'overwrite' as const) })).save()).toBe(true);
    expect(save.mock.calls[0][0].force).toBe(false); expect(save.mock.calls[1][0]).toMatchObject({ path: oldPath, text: 'changed', force: true });
  });

  it('keeps the conflict state if conflict save-as is cancelled', async () => {
    const store = stored(); store.replaceText('changed');
    const save = vi.fn<DesktopBridge['save']>().mockResolvedValueOnce(error('EXTERNAL_CONFLICT')).mockResolvedValueOnce(ok(null));
    const bridge = bridgeFor({ save });
    expect(await new SessionCoordinator(store, bridge, prompts({ conflict: vi.fn(async () => 'saveAs' as const) })).save()).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ path: oldPath, dirty: true, saveState: 'conflict' }); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('does not retry a stale version after a conflict prompt', async () => {
    const store = stored(); store.replaceText('changed');
    const pending = deferred<'overwrite'>(), bridge = bridgeFor({ save: vi.fn(async () => error('EXTERNAL_CONFLICT')) });
    const operation = new SessionCoordinator(store, bridge, prompts({ conflict: vi.fn(() => pending.promise) })).save();
    await started(); store.replaceText('later'); pending.resolve('overwrite');
    expect(await operation).toBe(false); expect(bridge.save).toHaveBeenCalledOnce(); expect(store.getSnapshot().dirty).toBe(true);
  });

  it.each(['open', 'close'] as const)('includes first-save asset relocation in internal save-on-%s', async operation => {
    const store = new DocumentStore(createDocument('![image](temporary.png)')), hook = relocate(store);
    const bridge = bridgeFor(), dialogs = prompts({ saveOnSwitch: () => true, relocateAssets: hook });
    expect(await new SessionCoordinator(store, bridge, dialogs)[operation]()).toBe(true);
    expect(dialogs.leave).not.toHaveBeenCalled(); expect(hook).toHaveBeenCalledOnce(); expect(bridge.save).toHaveBeenCalledTimes(2);
    expect(bridge.save).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: null, text: '![image](temporary.png)', version: 0, expectedFingerprint: null }));
    expect(bridge.save).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: newPath, text: '![image](assets/new.png)', version: 1, expectedFingerprint: fingerprint }));
    if (operation === 'open') expect(bridge.save).toHaveBeenCalledBefore(vi.mocked(bridge.open));
    else expect(bridge.save).toHaveBeenCalledBefore(vi.mocked(bridge.windowAction));
  });

  it('preserves path and recovery when asset relocation fails', async () => {
    const store = stored('![image](old.png)'); store.replaceText('![image](old.png) updated');
    const previous = store.getSnapshot(), bridge = bridgeFor(), hook = vi.fn(async () => { throw new Error('ASSET_MISSING'); });
    expect(await new SessionCoordinator(store, bridge, prompts({ relocateAssets: hook })).save(true)).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ path: oldPath, text: previous.text, dirty: true, diskFingerprint: fingerprint, saveState: 'failed' });
    expect(bridge.save).toHaveBeenCalledOnce(); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('rejects edits made while asset relocation is awaiting its resources', async () => {
    const store = stored('![image](old.png)'), pending = deferred<boolean>(), bridge = bridgeFor();
    const operation = new SessionCoordinator(store, bridge, prompts({ relocateAssets: vi.fn(() => pending.promise) })).save(true);
    await started(); store.replaceText('later'); pending.resolve(false);
    expect(await operation).toBe(false); expect(store.getSnapshot()).toMatchObject({ path: oldPath, text: 'later', dirty: true, saveState: 'failed' });
    expect(bridge.save).toHaveBeenCalledOnce(); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('preserves path and dirty relocated source when its second save fails', async () => {
    const store = stored('![image](old.png)'); store.replaceText('![image](old.png) updated');
    const save = vi.fn<DesktopBridge['save']>().mockImplementationOnce(async request => ok(saved(request, newPath))).mockResolvedValueOnce(error());
    const bridge = bridgeFor({ save });
    expect(await new SessionCoordinator(store, bridge, prompts({ relocateAssets: relocate(store) })).save(true)).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ path: oldPath, text: '![image](assets/new.png)', dirty: true, saveState: 'failed', diskFingerprint: fingerprint });
    expect(bridge.deleteRecovery).not.toHaveBeenCalled();
    store.undo(); expect(store.getSnapshot()).toMatchObject({ text: '![image](old.png) updated', dirty: true });
    store.undo(); expect(store.getSnapshot()).toMatchObject({ text: '![image](old.png)', dirty: false });
  });

  it('blocks switching and retains edits made during the relocated-source save', async () => {
    const store = new DocumentStore(createDocument('![image](temporary.png)')), pending = deferred<Result<SavedFile | null>>();
    const save = vi.fn<DesktopBridge['save']>().mockImplementationOnce(async request => ok(saved(request))).mockImplementationOnce(() => pending.promise), bridge = bridgeFor({ save });
    const operation = new SessionCoordinator(store, bridge, prompts({ relocateAssets: relocate(store) })).newDocument();
    await started(); expect(save).toHaveBeenCalledTimes(2); const request = save.mock.calls[1][0]; store.replaceText('later'); pending.resolve(ok(saved(request)));
    expect(await operation).toBe(false); expect(store.getSnapshot()).toMatchObject({ path: null, text: 'later', dirty: true, saveState: 'failed' }); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('keeps readonly on a cancelled save-as, and unlocks only the successfully saved copy', async () => {
    const store = new DocumentStore(createDocument('![image](old.png)', { ...opened(oldPath, '![image](old.png)'), readonly: true }));
    const save = vi.fn<DesktopBridge['save']>().mockResolvedValueOnce(ok(null)).mockImplementation(async request => ok(saved(request, request.path ?? newPath))), bridge = bridgeFor({ save });
    const hook = relocate(store), coordinator = new SessionCoordinator(store, bridge, prompts({ relocateAssets: hook }));
    expect(await coordinator.save(true)).toBe(false); expect(store.getSnapshot()).toMatchObject({ readonly: true, path: oldPath }); expect(hook).not.toHaveBeenCalled();
    expect(await coordinator.save(true)).toBe(true); expect(store.getSnapshot()).toMatchObject({ readonly: false, path: newPath, dirty: false });
  });

  it('restores readonly after failed save-as asset migration', async () => {
    const store = new DocumentStore(createDocument('first', { ...opened(), readonly: true })), bridge = bridgeFor();
    expect(await new SessionCoordinator(store, bridge, prompts({ relocateAssets: async () => { expect(store.getSnapshot().readonly).toBe(false); throw new Error('ASSET_MISSING'); } })).save(true)).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ readonly: true, path: oldPath, saveState: 'failed' }); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });
});

describe('serialized moves', () => {
  it('restores real file bytes and leaves later edits dirty when a move save races with editing', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'opentypora-session-'));
    try {
      const from = join(directory, 'before.md'), to = join(directory, 'after.md'), text = '![image](old.png)';
      await fs.writeFile(from, text);
      const original = await readDocument(from), store = new DocumentStore(createDocument(original.text, original));
      const bridge = bridgeFor({
        moveFile: vi.fn(async (source, destination) => { await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL); await fs.unlink(source); return ok(destination); }),
        readFile: vi.fn(async path => ok(await readDocument(path))),
        save: vi.fn(async request => {
          const result = await saveFile({ ...request, path: request.path! });
          if (request.text === '![image](new.png)') store.replaceText('later edit');
          return ok(result);
        }),
      });
      const coordinator = new SessionCoordinator(store, bridge, prompts({ relocateAssets: async previous => { expect(previous.path).toBe(from); store.replaceText('![image](new.png)', 'asset'); return true; } }));
      expect(await coordinator.move(to)).toBe(false);
      expect(await fs.readFile(from, 'utf8')).toBe(text); await expect(fs.access(to)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(store.getSnapshot()).toMatchObject({ path: from, text: 'later edit', dirty: true, saveState: 'failed' });
      expect(bridge.deleteRecovery).not.toHaveBeenCalled();
      store.undo(); expect(store.getSnapshot().dirty).toBe(true); store.undo(); expect(store.getSnapshot()).toMatchObject({ text, dirty: false });
    } finally {
      if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('opentypora-session-')) throw new Error('Unsafe test cleanup path');
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('saves dirty source, freezes paths, relocates references and saves with the moved fingerprint', async () => {
    const store = stored('![image](old.png)'); store.replaceText('![image](old.png) changed');
    const bridge = bridgeFor(), hook = relocate(store);
    expect(await new SessionCoordinator(store, bridge, prompts({ relocateAssets: hook })).move(newPath)).toBe(true);
    expect(bridge.moveFile).toHaveBeenCalledWith(oldPath, newPath); expect(bridge.save).toHaveBeenCalledTimes(2);
    expect(bridge.save).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: oldPath, text: '![image](old.png) changed' }));
    expect(bridge.save).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: newPath, text: '![image](assets/new.png)', expectedFingerprint: fingerprint }));
    expect(store.getSnapshot()).toMatchObject({ path: newPath, text: '![image](assets/new.png)', dirty: false });
  });

  it('never moves after a dirty save is cancelled', async () => {
    const store = stored(); store.replaceText('changed'); const bridge = bridgeFor({ save: vi.fn(async () => ok(null)) });
    expect(await new SessionCoordinator(store, bridge, prompts()).move(newPath)).toBe(false); expect(bridge.moveFile).not.toHaveBeenCalled(); expect(store.getSnapshot().path).toBe(oldPath);
  });

  it('preserves the original session on a target conflict', async () => {
    const store = stored(), bridge = bridgeFor({ moveFile: vi.fn(async () => error('TARGET_EXISTS')) });
    expect(await new SessionCoordinator(store, bridge, prompts()).move(newPath)).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ path: oldPath, text: 'first', saveState: 'failed' }); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('rolls back a moved file if newer edits arrive before its response', async () => {
    const store = stored(), pending = deferred<Result<string>>();
    const moveFile = vi.fn<DesktopBridge['moveFile']>().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(ok(oldPath)), bridge = bridgeFor({ moveFile });
    const operation = new SessionCoordinator(store, bridge, prompts()).move(newPath);
    await started(); store.replaceText('later'); pending.resolve(ok(newPath));
    expect(await operation).toBe(false); expect(moveFile.mock.calls).toEqual([[oldPath, newPath], [newPath, oldPath]]);
    expect(store.getSnapshot()).toMatchObject({ path: oldPath, text: 'later', dirty: true, saveState: 'failed' }); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('ignores stale move metadata after the document identity changes', async () => {
    const store = stored(), pending = deferred<Result<string>>();
    const bridge = bridgeFor({ moveFile: vi.fn<DesktopBridge['moveFile']>().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(ok(oldPath)) });
    const operation = new SessionCoordinator(store, bridge, prompts()).move(newPath);
    await started(); const next = createDocument('another document'); store.replaceSession(next); pending.resolve(ok(newPath));
    expect(await operation).toBe(false); expect(store.getSnapshot()).toEqual(next); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('rolls back when the actual moved file no longer matches the frozen fingerprint', async () => {
    const store = stored(), bridge = bridgeFor({ readFile: vi.fn(async path => ok({ ...opened(path), fingerprint: { ...fingerprint, hash: 'external' } })) }), hook = vi.fn(async () => false);
    expect(await new SessionCoordinator(store, bridge, prompts({ relocateAssets: hook })).move(newPath)).toBe(false);
    expect(bridge.moveFile).toHaveBeenNthCalledWith(2, newPath, oldPath); expect(hook).not.toHaveBeenCalled(); expect(store.getSnapshot().path).toBe(oldPath); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('rolls back and keeps recovery when move asset relocation fails', async () => {
    const store = stored(), bridge = bridgeFor();
    expect(await new SessionCoordinator(store, bridge, prompts({ relocateAssets: async () => { throw new Error('ASSET_MISSING'); } })).move(newPath)).toBe(false);
    expect(bridge.moveFile).toHaveBeenNthCalledWith(2, newPath, oldPath); expect(store.getSnapshot()).toMatchObject({ path: oldPath, saveState: 'failed' }); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
  });

  it('retains dirty-draft recovery until the whole move, including asset migration, succeeds', async () => {
    const store = stored(); store.replaceText('changed'); const bridge = bridgeFor();
    expect(await new SessionCoordinator(store, bridge, prompts({ relocateAssets: async () => { throw new Error('ASSET_MISSING'); } })).move(newPath)).toBe(false);
    expect(bridge.save).toHaveBeenCalledOnce(); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ path: oldPath, text: 'changed', dirty: false, saveState: 'failed' });
  });

  it('restores the old disk source and clean baseline when later edits interrupt the move save', async () => {
    const store = stored('![image](old.png)'), pending = deferred<Result<SavedFile | null>>();
    const save = vi.fn<DesktopBridge['save']>().mockImplementationOnce(() => pending.promise).mockImplementation(async request => ok(saved(request))), bridge = bridgeFor({ save });
    const operation = new SessionCoordinator(store, bridge, prompts({ relocateAssets: relocate(store) })).move(newPath);
    await started(); const request = save.mock.calls[0][0]; store.replaceText('later');
    const latestFingerprint = { ...fingerprint, hash: 'relocated' }; pending.resolve(ok({ ...saved(request), fingerprint: latestFingerprint }));
    expect(await operation).toBe(false);
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: newPath, text: '![image](old.png)', expectedFingerprint: latestFingerprint, force: false }));
    expect(bridge.moveFile).toHaveBeenNthCalledWith(2, newPath, oldPath); expect(bridge.deleteRecovery).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ path: oldPath, text: 'later', dirty: true, saveState: 'failed' });
    store.undo(); expect(store.getSnapshot()).toMatchObject({ text: '![image](assets/new.png)', dirty: true });
    store.undo(); expect(store.getSnapshot()).toMatchObject({ text: '![image](old.png)', dirty: false });
  });

  it('serializes open behind the entire move and relocation save', async () => {
    const store = stored('![image](old.png)'), pending = deferred<Result<SavedFile | null>>(), save = vi.fn<DesktopBridge['save']>(() => pending.promise), bridge = bridgeFor({ save });
    const coordinator = new SessionCoordinator(store, bridge, prompts({ relocateAssets: relocate(store) })), moving = coordinator.move(newPath), opening = coordinator.open();
    await started(); expect(bridge.open).not.toHaveBeenCalled(); const request = save.mock.calls[0][0]; pending.resolve(ok(saved(request)));
    expect(await moving).toBe(true); expect(await opening).toBe(true); expect(store.getSnapshot().path).toBe('E:/next.md');
  });
});
