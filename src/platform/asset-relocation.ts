import { parse as parseYaml } from 'yaml';
import { imageReferences, type ImageReference } from '../core/formatting';
import type { DesktopBridge, DocumentSession, TextChange } from '../shared/contracts';
import type { SettingsSnapshot } from '../shared/settings';

type ImageSettings = Pick<SettingsSnapshot, 'image.relative' | 'image.prefixDot' | 'image.escapeUrl'>;
type RelocationSettings = ImageSettings & Pick<SettingsSnapshot, 'image.strategy' | 'image.folder' | 'image.applyLocal'>;
export interface AssetRelocationPlan {
  /** URL spans in the original source, suitable for one DocumentStore transaction. */
  changes: TextChange[];
  assets: { source: string; target: string }[];
}

// Browser-side paths deliberately do not import Node APIs. Privileged copying stays in DesktopBridge.
function normalizePath(value: string): string {
  if (value.includes('\0')) throw new Error('INVALID_ASSET_PATH：图片路径包含空字符');
  const path = value.replace(/\\/g, '/');
  const uncRoot = path.startsWith('//') ? path.match(/^\/\/[^/]+\/[^/]+(?:\/|$)/)?.[0] : null;
  const root = /^[a-z]:\//i.test(path) ? path.slice(0, 3) : path.startsWith('//')
    ? uncRoot ? uncRoot.replace(/\/$/, '') + '/' : '' : path.startsWith('/') ? '/' : '';
  if (!root) throw new Error('INVALID_ASSET_PATH：图片操作需要完整路径');
  const segments: string[] = [];
  for (const segment of path.slice(root.length).split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop(); else segments.push(segment);
  }
  return root + segments.join('/');
}
function isAbsolute(path: string) { return /^[a-z]:[\\/]/i.test(path) || path.startsWith('/') || path.startsWith('\\\\'); }
function directory(path: string) { const normalized = normalizePath(path); return normalized.slice(0, normalized.lastIndexOf('/') + 1); }
function join(base: string, path: string) { return normalizePath(isAbsolute(path) ? path : `${base.replace(/\/$/, '')}/${path}`); }
function windowsPath(path: string) { return /^[a-z]:\//i.test(path) || path.startsWith('//'); }
function pathKey(path: string) { return windowsPath(path) ? path.toLowerCase() : path; }
function filePath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return null;
    let path = decodeURIComponent(parsed.pathname);
    if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    if (parsed.hostname && parsed.hostname !== 'localhost') path = `//${parsed.hostname}${path}`;
    return normalizePath(path);
  } catch { throw new Error(`INVALID_ASSET_URL：无法解析本地图片地址 ${url}`); }
}
function decodeUrl(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
function rootDirectory(documentPath: string | null, text = ''): string | null {
  let base = documentPath ? directory(documentPath) : null;
  const yaml = text.match(/^---(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)(?:---|\.\.\.)(?:(?:\r\n|\n|\r)|$)/);
  if (!yaml) return base;
  try {
    const metadata = parseYaml(yaml[1]);
    const root = metadata && typeof metadata === 'object' && metadata['typora-root-url'];
    if (typeof root !== 'string' || !root) return base;
    if (/^file:/i.test(root)) return filePath(root);
    // Other protocols are not filesystem roots; renderer similarly ignores them.
    if (/^[a-z][\w+.-]*:/i.test(root) && !/^[a-z]:[\\/]/i.test(root)) return base;
    const path = decodeUrl(root);
    return isAbsolute(path) ? normalizePath(path) : base ? join(base, path) : null;
  } catch { return base; }
}

/** Remote/data URLs remain untouched. A relative URL needs a saved document or absolute YAML root. */
export function resolveLocalImagePath(url: string, documentPath: string | null, text = ''): string | null {
  if (!url || /^(?:data:|https?:|\/\/)/i.test(url)) return null;
  if (/^file:/i.test(url)) return filePath(url);
  if (/^opentypora-asset:\/\/local\//i.test(url)) return normalizePath(decodeUrl(url.replace(/^opentypora-asset:\/\/local\//i, '')));
  if (/^[a-z][\w+.-]*:/i.test(url) && !/^[a-z]:[\\/]/i.test(url)) return null;
  const path = decodeUrl(url), base = rootDirectory(documentPath, text);
  if (isAbsolute(path)) return normalizePath(path);
  return base ? join(base, path) : null;
}

function fileUrl(path: string): string {
  const parts = normalizePath(path).split('/');
  if (path.startsWith('//') || path.startsWith('\\\\')) {
    const host = parts[2];
    return `file://${host}/${parts.slice(3).map(encodeURIComponent).join('/')}`;
  }
  if (/^[a-z]:$/i.test(parts[0])) return `file:///${parts[0]}/${parts.slice(1).map(encodeURIComponent).join('/')}`;
  return `file://${parts.map(encodeURIComponent).join('/')}`;
}
function relativePath(base: string, target: string): string | null {
  const from = normalizePath(base).replace(/\/$/, '').split('/'), to = normalizePath(target).split('/');
  const windows = windowsPath(target);
  // A drive or UNC share change cannot be represented by a relative URL.
  const rootLength = target.startsWith('//') ? 4 : 1;
  if (windows !== windowsPath(base) || from.slice(0, rootLength).join('/').toLowerCase() !== to.slice(0, rootLength).join('/').toLowerCase()) return null;
  let common = 0;
  while (common < from.length && common < to.length && (windows ? from[common].toLowerCase() === to[common].toLowerCase() : from[common] === to[common])) common++;
  return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/') || '.';
}
function encodeRelativePath(value: string, escape: boolean): string {
  return value.split('/').map(segment => escape ? encodeURIComponent(segment) : segment.replace(/[%#?<>\u0000-\u001f\u007f]/g, char => encodeURIComponent(char))).join('/');
}
function destinationForRoot(path: string, base: string | null, settings: ImageSettings): string {
  const absolute = normalizePath(path), relative = settings['image.relative'] && base ? relativePath(base, absolute) : null;
  if (relative === null) return fileUrl(absolute);
  let value = encodeRelativePath(relative, settings['image.escapeUrl']);
  if (settings['image.prefixDot'] && !/^(\.\.?\/)/.test(value)) value = `./${value}`;
  return value;
}

/** Takes an actual, unencoded path. Absolute destinations are always valid file:/// URLs. */
export function imageDestination(path: string, documentPath: string | null, settings: ImageSettings, text = ''): string {
  return destinationForRoot(path, rootDirectory(documentPath, text), settings);
}

/** Preserve the surrounding Markdown/title/HTML syntax, including existing angle brackets. */
export function replaceImageDestination(text: string, ref: ImageReference, nextUrl: string): TextChange {
  let insert = nextUrl;
  if (ref.syntax === 'html') insert = nextUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  else if (!(text[ref.urlFrom - 1] === '<' && text[ref.urlTo] === '>') && /[\s()<>]/.test(nextUrl)) insert = `<${nextUrl}>`;
  return { from: ref.urlFrom, to: ref.urlTo, insert };
}

/** Compute first; callers must verify document ID/version before applying these edits once. */
export async function planAssetRelocation(
  previous: Pick<DocumentSession, 'text' | 'path'>,
  destinationPath: string,
  settings: RelocationSettings,
  bridge: Pick<DesktopBridge, 'manageAssets'>,
): Promise<AssetRelocationPlan> {
  normalizePath(destinationPath);
  const references = imageReferences(previous.text).flatMap(ref => {
    const source = resolveLocalImagePath(ref.url, previous.path, previous.text);
    return source ? [{ ref, source }] : [];
  });
  const unique = [...new Map(references.map(({ source }) => [pathKey(source), source])).values()];
  const targets = new Map(unique.map(source => [pathKey(source), source]));
  if (unique.length && settings['image.strategy'] === 'copy' && settings['image.applyLocal']) {
    const filename = destinationPath.replace(/\\/g, '/').split('/').at(-1)!.replace(/\.[^.]*$/, '');
    const folder = (settings['image.folder'] || '${filename}.assets').replace(/\$\{filename\}/g, filename);
    const destination = join(directory(destinationPath), folder);
    const result = await bridge.manageAssets('copy', unique, destination);
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    if (result.value.length !== unique.length) throw new Error('ASSET_RELOCATION_FAILED：资源复制返回数量不完整，请检查图片目录后重试');
    const errors = result.value.filter(asset => asset.error);
    if (errors.length) throw new Error(`ASSET_RELOCATION_FAILED：图片未完成复制，请检查原路径及目录权限后重试：${errors.map(asset => `${asset.path}：${asset.error}`).join('；')}`);
    result.value.forEach((asset, index) => targets.set(pathKey(unique[index]), normalizePath(asset.path)));
  }
  const base = rootDirectory(destinationPath, previous.text);
  const changes = new Map<string, TextChange>();
  for (const { ref, source } of references) {
    const url = destinationForRoot(targets.get(pathKey(source))!, base, settings);
    const change = replaceImageDestination(previous.text, ref, url);
    if (previous.text.slice(change.from, change.to) !== change.insert) changes.set(`${change.from}:${change.to}`, change);
  }
  return { changes: [...changes.values()].sort((a, b) => a.from - b.from), assets: unique.map(source => ({ source, target: targets.get(pathKey(source))! })) };
}
