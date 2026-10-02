import { describe, expect, it, vi } from 'vitest';
import { imageReferences } from '../src/core/formatting';
import { DocumentStore, createDocument } from '../src/core/document';
import { DEFAULT_SETTINGS, type SettingsSnapshot } from '../src/shared/settings';
import type { AssetResult, DesktopBridge, Result, TextChange } from '../src/shared/contracts';
import { imageDestination, planAssetRelocation, replaceImageDestination, resolveLocalImagePath } from '../src/platform/asset-relocation';

const settings = (overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot => ({ ...DEFAULT_SETTINGS, ...overrides });
const apply = (text: string, changes: TextChange[]) => [...changes].sort((a, b) => b.from - a.from).reduce((source, change) => source.slice(0, change.from) + change.insert + source.slice(change.to), text);
const copyBridge = (run: DesktopBridge['manageAssets'] = async (_operation, paths, destination) => ({ ok: true, value: paths.map(path => ({ path: `${destination}/${path.split('/').at(-1)}`, url: 'unused' })) })) => ({ manageAssets: vi.fn(run) });

describe('asset relocation plans', () => {
  it('copies deduplicated resources and rewrites every duplicate image in one undoable UTF-16 transaction', async () => {
    const text = '😀 ![a](images/a.png)\r\n![again](images/a.png)\r\n![b](images/b.png)', previous = { path: 'E:/old/report.md', text };
    const bridge = copyBridge(), plan = await planAssetRelocation(previous, 'E:/new/final.md', settings({ 'image.strategy': 'copy', 'image.relative': true }), bridge);
    expect(bridge.manageAssets).toHaveBeenCalledExactlyOnceWith('copy', ['E:/old/images/a.png', 'E:/old/images/b.png'], 'E:/new/final.assets');
    const result = '😀 ![a](final.assets/a.png)\r\n![again](final.assets/a.png)\r\n![b](final.assets/b.png)';
    expect(plan.changes).toHaveLength(3); expect(apply(text, plan.changes)).toBe(result);
    const store = new DocumentStore(createDocument(text));
    expect(store.apply({ transactionId: 'relocate', documentId: store.getSnapshot().documentId, baseVersion: 0, changes: plan.changes, origin: 'asset' })).toBe(true);
    expect(store.getSnapshot().text).toBe(result); store.undo(); expect(store.getSnapshot().text).toBe(text);
  });

  it('keeps old local resources when strategy is none or upload without requiring any copy operation', async () => {
    for (const strategy of ['none', 'upload']) {
      const bridge = copyBridge(), text = '![x](images/a.png)';
      const plan = await planAssetRelocation({ path: 'E:/old/report.md', text }, 'E:/new/report.md', settings({ 'image.strategy': strategy, 'image.relative': true }), bridge);
      expect(apply(text, plan.changes)).toBe('![x](../old/images/a.png)'); expect(bridge.manageAssets).not.toHaveBeenCalled();
      expect(plan.assets).toEqual([{ source: 'E:/old/images/a.png', target: 'E:/old/images/a.png' }]);
    }
  });

  it('honors applyLocal=false even when the configured insertion strategy is copy', async () => {
    const bridge = copyBridge(), plan = await planAssetRelocation({ path: 'E:/old/a.md', text: '![x](a.png)' }, 'E:/new/a.md', settings({ 'image.strategy': 'copy', 'image.applyLocal': false }), bridge);
    expect(bridge.manageAssets).not.toHaveBeenCalled(); expect(plan.changes[0].insert).toBe('file:///E:/old/a.png');
  });

  it('preserves angle syntax, titles, shared reference definitions and HTML attributes', async () => {
    const text = '![x](<images/中文 #.png> "title")\n![ref][photo]\n![same][photo]\n[photo]: <images/中文 #.png> "reference"\n<img alt="x" src="images/中文 #.png" width="12">';
    const bridge = copyBridge(), plan = await planAssetRelocation({ path: 'E:/old/a.md', text }, 'E:/new/b.md', settings({ 'image.strategy': 'copy', 'image.relative': true, 'image.folder': 'shared images' }), bridge);
    const result = apply(text, plan.changes);
    expect(bridge.manageAssets).toHaveBeenCalledExactlyOnceWith('copy', ['E:/old/images/中文 #.png'], 'E:/new/shared images');
    expect(plan.changes).toHaveLength(3);
    expect(result).toBe('![x](<shared images/中文 %23.png> "title")\n![ref][photo]\n![same][photo]\n[photo]: <shared images/中文 %23.png> "reference"\n<img alt="x" src="shared images/中文 %23.png" width="12">');
    expect(result).not.toContain('<<'); expect(imageReferences(result)).toHaveLength(4);
  });

  it('resolves typora-root-url against each document and preserves its exact metadata', async () => {
    const text = '---\r\ntypora-root-url: ./resources\r\ntitle: "demo"\r\n---\r\n![x](a.png)';
    const bridge = copyBridge(), plan = await planAssetRelocation({ path: 'E:/old/a.md', text }, 'E:/new/b.md', settings({ 'image.relative': true }), bridge);
    const result = apply(text, plan.changes);
    expect(result).toBe(text.replace('(a.png)', '(../../old/resources/a.png)'));
    expect(resolveLocalImagePath(imageReferences(result)[0].url, 'E:/new/b.md', result)).toBe('E:/old/resources/a.png');
    expect(bridge.manageAssets).not.toHaveBeenCalled();
    const copied = await planAssetRelocation({ path: 'E:/old/a.md', text }, 'E:/new/b.md', settings({ 'image.strategy': 'copy', 'image.relative': true }), bridge);
    expect(bridge.manageAssets).toHaveBeenCalledWith('copy', ['E:/old/resources/a.png'], 'E:/new/b.assets');
    expect(apply(text, copied.changes)).toBe(text.replace('(a.png)', '(../b.assets/a.png)'));
  });

  it('handles absolute YAML roots, file URLs, escaped percentages and cross-drive destinations', async () => {
    const text = '---\ntypora-root-url: file:///D:/%E4%B8%AD%E6%96%87%20root\n---\n![x](a%23%2520.png)\n![other](file:///D:/%E4%B8%AD%E6%96%87%20root/a%23%2520.png)';
    const plan = await planAssetRelocation({ path: 'E:/old/a.md', text }, 'F:/new/b.md', settings({ 'image.relative': true }), copyBridge());
    expect(plan.assets).toEqual([{ source: 'D:/中文 root/a#%20.png', target: 'D:/中文 root/a#%20.png' }]);
    expect(apply(text, plan.changes)).toBe(text.replace('(file:///D:/%E4%B8%AD%E6%96%87%20root/a%23%2520.png)', '(a%23%2520.png)'));
    expect(imageDestination('D:/中文 root/a#%20.png', 'E:/new/b.md', settings({ 'image.relative': true }))).toBe('file:///D:/%E4%B8%AD%E6%96%87%20root/a%23%2520.png');
  });

  it('does not copy remote/data URLs or image-like literals inside code', async () => {
    const text = '![remote](https://example.test/a.png)\n![data](data:image/png;base64,abc)\n![cdn](//example.test/a.png)\n`![code](local.png)`\n```md\n![fence](local.png)\n<img src="local.png">\n```';
    const bridge = copyBridge(), plan = await planAssetRelocation({ path: 'E:/old/a.md', text }, 'E:/new/b.md', settings({ 'image.strategy': 'copy' }), bridge);
    expect(plan).toEqual({ changes: [], assets: [] }); expect(bridge.manageAssets).not.toHaveBeenCalled();
  });

  it('uses returned collision-safe filenames and deduplicates equivalent encoded/native references', async () => {
    const text = '![x](<images/A #.png>)\n![encoded](images/A%20%23.png)\n![native](<file:///e:/OLD/images/A%20%23.png>)';
    const bridge = copyBridge(async () => ({ ok: true, value: [{ path: 'E:/new/b.assets/A #-abc123.png', url: 'file:///E:/new/b.assets/A%20%23-abc123.png' }] }));
    const plan = await planAssetRelocation({ path: 'E:/old/a.md', text }, 'E:/new/b.md', settings({ 'image.strategy': 'copy', 'image.relative': true, 'image.escapeUrl': true }), bridge);
    expect(bridge.manageAssets).toHaveBeenCalledExactlyOnceWith('copy', ['e:/OLD/images/A #.png'], 'E:/new/b.assets');
    expect(plan.changes).toHaveLength(3);
    expect(imageReferences(apply(text, plan.changes)).map(ref => ref.url)).toEqual(Array(3).fill('b.assets/A%20%23-abc123.png'));
  });

  it('rejects failed/partial bridge responses before producing any edits', async () => {
    const previous = { path: 'E:/old/a.md', text: '![a](a.png)\n![b](b.png)' }, opts = settings({ 'image.strategy': 'copy' });
    for (const response of [
      { ok: false, error: { code: 'PERMISSION', message: 'directory is readonly', retryable: true } },
      { ok: true, value: [{ path: 'E:/new/a.png', url: '' }] },
      { ok: true, value: [{ path: 'E:/new/a.png', url: '' }, { path: 'E:/old/b.png', url: '', error: 'missing' }] },
    ] as Result<AssetResult[]>[]) {
      const bridge = copyBridge(async () => response);
      await expect(planAssetRelocation(previous, 'E:/new/b.md', opts, bridge)).rejects.toThrow();
      expect(previous.text).toBe('![a](a.png)\n![b](b.png)');
    }
  });

  it('leaves unresolved unsaved relative images alone but relocates staged absolute images', async () => {
    const text = '![relative](a.png)\n![staged](file:///E:/temp/staged.png)';
    const bridge = copyBridge(), plan = await planAssetRelocation({ path: null, text }, 'E:/new/a.md', settings({ 'image.strategy': 'copy', 'image.relative': true }), bridge);
    expect(bridge.manageAssets).toHaveBeenCalledExactlyOnceWith('copy', ['E:/temp/staged.png'], 'E:/new/a.assets');
    expect(apply(text, plan.changes)).toBe('![relative](a.png)\n![staged](a.assets/staged.png)');
  });
});

describe('image destination syntax', () => {
  it('encodes Windows/file/UNC destinations and optional relative URL escaping without double encoding', () => {
    expect(imageDestination('C:\\images\\中文 # 100%.png', 'C:/docs/a.md', settings())).toBe('file:///C:/images/%E4%B8%AD%E6%96%87%20%23%20100%25.png');
    expect(imageDestination('C:/docs/中文 # 100%.png', 'C:/docs/a.md', settings({ 'image.relative': true, 'image.prefixDot': true, 'image.escapeUrl': true }))).toBe('./%E4%B8%AD%E6%96%87%20%23%20100%25.png');
    expect(imageDestination('\\\\server\\share\\中文 #.png', null, settings())).toBe('file://server/share/%E4%B8%AD%E6%96%87%20%23.png');
    expect(resolveLocalImagePath('file://server/share/%E4%B8%AD%E6%96%87%20%23.png', null)).toBe('//server/share/中文 #.png');
    expect(imageDestination('E:/docs/shared/x.png', 'E:/docs/a.md', settings({ 'image.relative': true }), '---\ntypora-root-url: ./shared\n---\n')).toBe('x.png');
    expect(() => imageDestination('//server', null, settings())).toThrow('INVALID_ASSET_PATH');
  });
  it('adds angle brackets only when needed and safely escapes either HTML attribute quote', () => {
    for (const text of ['![x](a.png "title")', '![x](<a.png> "title")', '[x]: <a.png>\n![x][x]']) {
      const ref = imageReferences(text)[0], change = replaceImageDestination(text, ref, 'folder space/a(1).png');
      const result = apply(text, [change]); expect(result).toContain('<folder space/a(1).png>'); expect(result).not.toContain('<<');
      expect(imageReferences(result)[0].url).toBe('folder space/a(1).png');
    }
    const text = "<img src='a.png' alt='text'>", ref = imageReferences(text)[0];
    expect(apply(text, [replaceImageDestination(text, ref, "https://example.test/a?x='y'&z=1")])).toBe("<img src='https://example.test/a?x=&#39;y&#39;&amp;z=1' alt='text'>");
  });
});
