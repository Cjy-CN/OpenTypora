import { isAbsolute, normalize, resolve, relative, sep } from 'node:path';
export function serviceError(code: string, message: string, detail?: unknown): Error {
  return Object.assign(new Error(message), { code, ...(detail === undefined ? {} : { detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }) });
}
export function object(value: unknown, label = '参数'): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw serviceError('INVALID_ARGUMENT', `${label}必须是对象`);
  return value as Record<string, unknown>;
}
export function string(value: unknown, label = '参数', max = 16_000): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw serviceError('INVALID_ARGUMENT', `${label}必须是有效字符串`);
  return value;
}
export function absolutePath(value: unknown, label = '路径'): string {
  const path = string(value, label); if (!path || !isAbsolute(path)) throw serviceError('INVALID_PATH', `${label}必须是绝对路径`);
  return normalize(resolve(path));
}
export function safeId(value: unknown): string {
  const id = string(value, '标识', 200); if (!/^[a-zA-Z0-9._-]+$/.test(id) || id === '.' || id === '..') throw serviceError('INVALID_ID', '标识不能包含路径或特殊字符'); return id;
}
export function within(root: string, path: string): boolean { const rel = relative(root, path); return !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel); }
export function strings(value: unknown, label = '参数列表'): string[] {
  if (!Array.isArray(value) || value.length > 10_000) throw serviceError('INVALID_ARGUMENT', `${label}必须是列表`);
  return value.map(item => string(item, label));
}
export function url(value: unknown, protocols = ['https:', 'http:', 'mailto:']): string {
  const text = string(value, '链接'); let parsed: URL; try { parsed = new URL(text); } catch { throw serviceError('INVALID_URL', '链接格式无效'); }
  if (!protocols.includes(parsed.protocol) || parsed.username || parsed.password) throw serviceError('UNSAFE_URL', '不支持此链接协议或嵌入凭据'); return parsed.href;
}
export function number(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw serviceError('INVALID_ARGUMENT', `数值应在 ${min}–${max} 之间`); return value;
}
