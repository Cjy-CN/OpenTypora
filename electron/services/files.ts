import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import type { DiskFingerprint, OpenedFile, SaveRequest, SavedFile } from '../../src/shared/contracts';
export async function fingerprint(path: string): Promise<DiskFingerprint> {
  const [data,stat] = await Promise.all([fs.readFile(path),fs.stat(path)]);
  return { modifiedAt:stat.mtimeMs,size:stat.size,hash:createHash('sha256').update(data).digest('hex') };
}
export async function readFile(path: string): Promise<OpenedFile> {
  const absolute = resolve(path), data = await fs.readFile(absolute), bom = data.subarray(0,3).equals(Buffer.from([239,187,191]));
  let readonly = false; try { await fs.access(absolute,fs.constants.W_OK); } catch { readonly = true; }
  return { path:absolute, text: new TextDecoder('utf-8',{fatal:true}).decode(bom ? data.subarray(3) : data), encoding:'utf-8',bom,readonly,fingerprint:await fingerprint(absolute) };
}
export async function saveFile(request: SaveRequest & { path: string }): Promise<SavedFile> {
  const path=resolve(request.path);
  if (request.expectedFingerprint && !request.force) {
    const current=await fingerprint(path).catch(()=>null);
    if (!current || current.hash !== request.expectedFingerprint.hash) throw Object.assign(new Error('文件已在外部修改，请解决冲突或另存副本'),{code:'EXTERNAL_CONFLICT'});
  }
  const data=Buffer.from((request.bom ? '\uFEFF' : '') + request.text,'utf-8');
  const temporary=join(dirname(path),`.${randomUUID()}.opentypora.tmp`);
  try {
    const handle=await fs.open(temporary,'wx');
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary,path);
  } finally { await fs.unlink(temporary).catch(()=>undefined); }
  return {path,version:request.version,fingerprint:await fingerprint(path)};
}
