import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import iconv from 'iconv-lite';
import { absolutePath, serviceError, string } from './validation';
import type { DiskFingerprint, OpenedFile, SaveRequest, SavedFile } from '../../src/shared/contracts';
export async function fingerprint(path: string): Promise<DiskFingerprint> {
  const [data,stat] = await Promise.all([fs.readFile(absolutePath(path)),fs.stat(absolutePath(path))]);
  return { modifiedAt:stat.mtimeMs,size:stat.size,hash:createHash('sha256').update(data).digest('hex') };
}
export function decodeFile(data: Buffer, requestedEncoding?: string): { text: string; encoding: string; bom: boolean } {
  let encoding = requestedEncoding || 'utf-8', bom = false, start = 0;
  if (data.subarray(0,3).equals(Buffer.from([239,187,191]))) { encoding = 'utf-8'; bom = true; start = 3; }
  else if (data.subarray(0,2).equals(Buffer.from([255,254]))) { encoding = 'utf16-le'; bom = true; start = 2; }
  else if (data.subarray(0,2).equals(Buffer.from([254,255]))) { encoding = 'utf16-be'; bom = true; start = 2; }
  if (!iconv.encodingExists(encoding)) throw serviceError('UNSUPPORTED_ENCODING', `不支持编码：${encoding}`);
  if (!requestedEncoding && encoding === 'utf-8') {
    try { return { text: new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(start)), encoding, bom }; }
    catch { throw serviceError('ENCODING_REQUIRED', '文件不是有效 UTF-8，请在打开选项中选择原文件编码；原文件未修改'); }
  }
  return { text: iconv.decode(data.subarray(start), encoding), encoding, bom };
}
export async function readFile(path: string, encoding?: string): Promise<OpenedFile> {
  const absolute = absolutePath(path), data = await fs.readFile(absolute), stat = await fs.stat(absolute);
  let readonly = false; try { await fs.access(absolute,fs.constants.W_OK); } catch { readonly = true; }
  return { path:absolute, ...decodeFile(data,encoding), readonly, fingerprint:{modifiedAt:stat.mtimeMs,size:data.byteLength,hash:createHash('sha256').update(data).digest('hex')} };
}
export async function atomicWrite(path: string, data: Buffer | string): Promise<void> {
  path = absolutePath(path); const temporary=join(dirname(path),`.${randomUUID()}.opentypora.tmp`);
  try { const handle=await fs.open(temporary,'wx'); try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); } await fs.rename(temporary,path); }
  finally { await fs.unlink(temporary).catch(()=>undefined); }
}
const saveQueues = new Map<string, Promise<unknown>>();
export async function saveFile(request: SaveRequest & { path: string }): Promise<SavedFile> {
  const path=absolutePath(request.path); string(request.text,'正文',64_000_000);
  if (!Number.isInteger(request.version) || request.version < 0 || typeof request.bom !== 'boolean') throw serviceError('INVALID_ARGUMENT','保存版本或 BOM 参数错误');
  const previous = saveQueues.get(path) ?? Promise.resolve();
  const task = previous.catch(()=>undefined).then(()=>saveFileLocked({...request,path})); saveQueues.set(path,task);
  try { return await task; } finally { if (saveQueues.get(path) === task) saveQueues.delete(path); }
}
async function saveFileLocked(request: SaveRequest & { path: string }): Promise<SavedFile> {
  const path=request.path;
  if (request.expectedFingerprint && !request.force) {
    const current=await fingerprint(path).catch(()=>null);
    if (!current || current.hash !== request.expectedFingerprint.hash) throw Object.assign(new Error('文件已在外部修改，请解决冲突或另存副本'),{code:'EXTERNAL_CONFLICT'});
  }
  const encoding=string(request.encoding,'编码'); if(!iconv.encodingExists(encoding))throw serviceError('UNSUPPORTED_ENCODING',`不支持编码：${encoding}`);
  const data=iconv.encode(request.text,encoding,{addBOM:request.bom});
  if(iconv.decode(data,encoding) !== request.text)throw serviceError('ENCODING_LOSS','此编码不能无损保存正文，请选择 UTF-8');
  await atomicWrite(path,data);
  return {path,version:request.version,fingerprint:await fingerprint(path)};
}
