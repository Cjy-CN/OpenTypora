import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolutePath, serviceError, string, within } from './validation';
const roots=new Set<string>(), files=new Set<string>();
const canonical=(path:string)=>process.platform==='win32'?path.toLowerCase():path;
export async function authorizeDirectory(path:string):Promise<void>{roots.add(canonical(await fs.realpath(absolutePath(path))));}
export async function authorizeFile(path:string):Promise<void>{files.add(canonical(await fs.realpath(absolutePath(path))));}
export async function resolveAuthorizedAsset(value:string):Promise<string|undefined>{
  let candidate:string;try{
    const text=string(value,'图片地址');candidate=text.startsWith('opentypora-asset://local/')?decodeURIComponent(text.slice('opentypora-asset://local/'.length)):text.startsWith('file:')?fileURLToPath(text):absolutePath(text);
    const actual=await fs.realpath(candidate),check=canonical(actual);
    if(!files.has(check)&&![...roots].some(root=>within(root,check)))return undefined;
    if(!(await fs.stat(actual)).isFile())return undefined;return actual;
  }catch{return undefined;}
}
export async function resolveAsset(value:unknown,documentPath:unknown):Promise<{path?:string;url:string}>{
  const text=string(value,'图片地址');if(/^https?:/i.test(text)){const parsed=new URL(text);if(parsed.username||parsed.password)throw serviceError('UNSAFE_URL','图片链接不能包含凭据');return{url:parsed.href};}
  const candidate=/^file:|^opentypora-asset:/i.test(text)?text:resolve(documentPath?dirname(absolutePath(documentPath)):process.cwd(),decodeURIComponent(text));
  const path=await resolveAuthorizedAsset(candidate);if(!path)throw serviceError('ASSET_ACCESS_DENIED','图片不存在或不在已打开/选择的授权目录中');return{path,url:`opentypora-asset://local/${encodeURIComponent(path)}`};
}
