import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { AssetResult, UploadItem, UploadResult } from '../../src/shared/contracts';
import { authorizeDirectory, authorizeFile } from './access';
import { runCommand, variables } from './process';
import { absolutePath, object, serviceError, string, strings, url } from './validation';
import { atomicWrite } from './files';
export type AssetRequest = (address:string,init?:RequestInit)=>Promise<Response>;
/** Only explicit insertion callers use this policy; opening a document never invokes it. */
export function imageInsertionOptions(documentPath:string|null,strategy:string,settings:Record<string,unknown>,documentText?:string,remote=false):{strategy:string;settings:Record<string,unknown>}{
  if(!['none','copy','upload','clipboard'].includes(strategy))throw serviceError('INVALID_ARGUMENT','图片插入策略无效');
  if(documentPath)absolutePath(documentPath);const options={...object(settings,'图片配置')};
  if((remote?options['image.applyRemote']!==true:options['image.applyLocal']===false))return{strategy:'none',settings:options};
  if(documentText!==undefined){const text=string(documentText,'冻结Markdown',64_000_000),match=text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
    if(match&&(strategy==='copy'||options['image.yamlUpload']===true)){let metadata:unknown;try{metadata=parseYaml(match[1],{maxAliasCount:10});}catch{throw serviceError('YAML_INVALID','图片规则的YAML元数据无法解析，请检查文档开头的配置');}
      const rule=metadata&&typeof metadata==='object'&&!Array.isArray(metadata)?(metadata as Record<string,unknown>)['typora-copy-images-to']:undefined;
      if(rule!==undefined){const value=string(rule,'YAML图片规则',16_000).trim();if(value==='upload'){if(options['image.yamlUpload']===true)strategy='upload';}
        else if(value&&strategy==='copy'){if(!documentPath)throw serviceError('IMAGE_DOCUMENT_PATH_REQUIRED','YAML图片目录相对当前文档，请先保存文档再复制图片');options['image.folder']=value;}
      }
    }
  }return{strategy,settings:options};
}
export async function uniqueAsset(source:string,directory:string,move=false):Promise<string>{
  source=absolutePath(source);directory=absolutePath(directory);await fs.mkdir(directory,{recursive:true});const data=await fs.readFile(source),hash=createHash('sha256').update(data).digest('hex');let name=basename(source),path=join(directory,name);
  for(let attempt=0;attempt<1000;attempt++){
    try{const current=await fs.readFile(path);if(createHash('sha256').update(current).digest('hex')===hash){if(move&&source!==path)await fs.unlink(source);return path;}name=`${basename(source,extname(source))}-${hash.slice(0,8)}${attempt?`-${attempt}`:''}${extname(source)}`;path=join(directory,name);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;try{await fs.copyFile(source,path,fs.constants.COPYFILE_EXCL);if(move)await fs.unlink(source);return path;}catch(copyError){if((copyError as NodeJS.ErrnoException).code==='EEXIST')continue;throw copyError;}}
  }throw serviceError('ASSET_COLLISION','资源命名冲突过多');
}
export function assetUrl(path:string,documentPath:string|null,settings:Record<string,unknown>):string{
  let value=settings['image.relative']&&documentPath?relative(dirname(documentPath),path).split(sep).join('/'):pathToFileURL(path).href;
  if(settings['image.prefixDot']&&!/^(\.\.?\/|[a-z]+:)/i.test(value))value=`./${value}`;
  if(settings['image.escapeUrl']&&!/^file:/i.test(value))value=value.split('/').map(part=>encodeURIComponent(part)).join('/');return value;
}
export function assetDirectory(documentPath:string|null,settings:Record<string,unknown>,userData:string):string{
  if(!documentPath)return join(userData,'assets','unsaved');const document=absolutePath(documentPath);const folder=String(settings['image.folder']||'${filename}.assets').replace(/\$\{filename\}/g,basename(document,extname(document)));
  if(folder.includes('\0'))throw serviceError('INVALID_PATH','图片目录无效');return resolve(dirname(document),folder);
}
export async function insertAsset(source:string,documentPath:string|null,strategy:string,settings:Record<string,unknown>,userData:string,signal?:AbortSignal,documentText?:string,request:AssetRequest=fetch):Promise<AssetResult>{
  source=absolutePath(source);if(documentPath)absolutePath(documentPath);await authorizeFile(source);
  const policy=imageInsertionOptions(documentPath,strategy,settings,documentText);strategy=policy.strategy;settings=policy.settings;if(signal?.aborted)throw serviceError('CANCELLED','图片插入已取消');
  let path=source;if(strategy==='copy'||!documentPath){path=await uniqueAsset(source,assetDirectory(documentPath,settings,userData));await authorizeDirectory(dirname(path));}
  if(strategy==='upload'){const uploaded=await uploadItems([{id:'insert',path}],settings,signal,request);if(uploaded[0].error)throw serviceError('UPLOAD_FAILED',uploaded[0].error);return{path,url:uploaded[0].url!};}
  if(!['none','copy','clipboard'].includes(strategy))throw serviceError('INVALID_ARGUMENT','图片插入策略无效');return{path,url:assetUrl(path,documentPath,settings)};
}
const REMOTE_MIME_EXTENSIONS:Record<string,string>={'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/svg+xml':'.svg','image/webp':'.webp','image/avif':'.avif','image/bmp':'.bmp'};
const REMOTE_IMAGE_LIMIT=32_000_000;
export async function insertRemoteAsset(value:string,documentPath:string|null,strategy:string,settings:Record<string,unknown>,userData:string,signal?:AbortSignal,documentText?:string,request:AssetRequest=fetch):Promise<AssetResult>{
  const original=string(value,'远程图片地址'),address=url(original,['https:','http:']),policy=imageInsertionOptions(documentPath,strategy,settings,documentText,true);
  if(!['copy','upload'].includes(policy.strategy))return{path:'',url:original};if(signal?.aborted)throw serviceError('CANCELLED','图片插入已取消');
  const staging=join(absolutePath(userData),'assets','remote-stage',randomUUID()),timeout=AbortSignal.timeout(20_000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,downloaded=false;
  try{
    const response=await request(address,{signal:requestSignal});if(response.body)reader=response.body.getReader();if(!response.ok||!reader)throw serviceError('REMOTE_IMAGE_HTTP',`远程图片下载失败 HTTP ${response.status}`);
    const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()||'',extension=REMOTE_MIME_EXTENSIONS[mime];if(!extension)throw serviceError('REMOTE_IMAGE_TYPE','远程地址未返回支持的图片MIME类型（PNG/JPEG/GIF/SVG/WebP/AVIF/BMP）');
    if(Number(response.headers.get('content-length'))>REMOTE_IMAGE_LIMIT)throw serviceError('REMOTE_IMAGE_SIZE','远程图片超过32MB上限');
    const chunks:Buffer[]=[];let length=0;while(true){const {done,value:chunk}=await reader.read();if(done)break;length+=chunk.byteLength;if(length>REMOTE_IMAGE_LIMIT)throw serviceError('REMOTE_IMAGE_SIZE','远程图片超过32MB上限');chunks.push(Buffer.from(chunk));}if(!length)throw serviceError('REMOTE_IMAGE_EMPTY','远程图片内容为空');if(requestSignal.aborted)throw requestSignal.reason;downloaded=true;
    let filename:string;try{filename=decodeURIComponent(new URL(address).pathname);}catch{filename='image';}const name=basename(filename,extname(filename)).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/[. ]+$/,'').slice(0,120)||'image';
    await fs.mkdir(staging,{recursive:true});const temporary=join(staging,`${name}${extension}`);await atomicWrite(temporary,Buffer.concat(chunks));if(signal?.aborted)throw serviceError('CANCELLED','图片插入已取消');
    const path=await uniqueAsset(temporary,assetDirectory(documentPath,policy.settings,userData));await authorizeFile(path);if(signal?.aborted)throw serviceError('CANCELLED','图片插入已取消');
    // applyRemote authorizes this explicit remote action; do not gate its downloaded file again as applyLocal.
    const localOptions={...policy.settings,'image.applyLocal':true};return await insertAsset(path,documentPath,policy.strategy,localOptions,userData,signal,undefined,request);
  }catch(error){if(signal?.aborted)throw serviceError('CANCELLED','图片插入已取消');if(timeout.aborted&&!downloaded)throw serviceError('REMOTE_IMAGE_TIMEOUT','远程图片下载超过20秒，请检查网络或代理后重试');throw error;}
  finally{if(reader)await reader.cancel().catch(()=>undefined);await fs.rm(staging,{recursive:true,force:true}).catch(()=>undefined);}
}
export async function insertRemoteAssets(values:string[],documentPath:string|null,documentText:string|undefined,settings:Record<string,unknown>,userData:string,signal?:AbortSignal,request:AssetRequest=fetch):Promise<AssetResult[]>{
  const addresses=strings(values,'远程图片列表');if(addresses.length>1000)throw serviceError('INVALID_ARGUMENT','单次最多插入1000张远程图片');const results:AssetResult[]=[];
  for(const address of addresses){try{results.push(await insertRemoteAsset(address,documentPath,String(settings['image.strategy']||'none'),settings,userData,signal,documentText,request));}catch(error){results.push({path:'',url:address,error:(error as Error).message});}}return results;
}
export async function manageAssets(operation:string,paths:string[],destination:string|undefined,trash:(path:string)=>Promise<void>):Promise<AssetResult[]>{
  string(operation,'操作');if(operation==='moveOrRename')operation='rename';paths=[...new Set(strings(paths).map(path=>absolutePath(path)))];if(!['copy','move','rename','delete','resolve'].includes(operation))throw serviceError('INVALID_OPERATION','不支持此图片操作');
  if(['copy','move','rename'].includes(operation)&&!destination)throw serviceError('INVALID_ARGUMENT','请指定目标目录或文件名');if(destination)destination=absolutePath(destination);
  if(operation==='rename'&&paths.length!==1)throw serviceError('INVALID_ARGUMENT','重命名只支持单个资源');const results:AssetResult[]=[];
  for(const source of paths){try{let path=source;if(operation==='copy'||operation==='move')path=await uniqueAsset(source,destination!,operation==='move');else if(operation==='rename'){await fs.copyFile(source,destination!,fs.constants.COPYFILE_EXCL);try{await fs.unlink(source);}catch(error){await fs.unlink(destination!).catch(()=>undefined);throw error;}path=destination!;}else if(operation==='delete'){await trash(source);results.push({path:source,url:''});continue;}else await fs.access(source);await authorizeFile(path);results.push({path,url:pathToFileURL(path).href});}catch(error){results.push({path:source,url:'',...{error:(error as Error).message}});}}
  return results;
}
export function parseUploadOutput(text:string,expected:number):string[]{
  let values:unknown[]=[];try{const json=JSON.parse(text);const candidate=Array.isArray(json)?json:json.result??json.urls??json.data??json.url;values=Array.isArray(candidate)?candidate:[candidate];}catch{values=text.match(/https?:\/\/[^\s"'<>]+/g)||[];}
  const urls=values.map(value=>{if(typeof value==='object'&&value)value=(value as {url?:string}).url;return url(value,['https:','http:']);});
  if(urls.length!==expected)throw serviceError('UPLOAD_OUTPUT',`上传返回 ${urls.length} 个地址，期望 ${expected} 个；请检查返回 JSON/URL 输出`);return urls;
}
export async function uploadItems(items:UploadItem[],settings:Record<string,unknown>,signal?:AbortSignal,request:AssetRequest=fetch):Promise<UploadResult[]>{
  if(!Array.isArray(items)||items.length>1000)throw serviceError('INVALID_ARGUMENT','图片列表无效');object(settings,'上传配置');const uploader=String(settings['image.uploader']??settings.uploader??'none');
  for(const item of items){string(item.id,'图片标识');absolutePath(item.path);}
  if(uploader==='none')return items.map(item=>({id:item.id,error:'未配置上传服务，请在图像设置中选择服务'}));
  if(!['picgo-core','picgo','piclist','custom'].includes(uploader))throw serviceError('INVALID_ARGUMENT','上传服务无效');
  const results:UploadResult[]=[];
  for(const item of items){if(signal?.aborted){results.push({id:item.id,error:'任务已取消'});continue;}try{
    await fs.access(item.path);let returned:string[];
    if(uploader==='picgo'||uploader==='piclist'){
      const endpoint=url(settings['image.uploadEndpoint']||'http://127.0.0.1:36677/upload',['http:','https:']);const response=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({list:[item.path]}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60_000)]):AbortSignal.timeout(60_000)});
      if(!response.ok)throw serviceError('UPLOAD_HTTP',`上传服务 HTTP ${response.status}`);returned=parseUploadOutput(await response.text(),1);
    }else{
      const executable=String(settings['image.uploadExecutable']||(uploader==='picgo-core'?'picgo':''));if(!executable)throw serviceError('DEPENDENCY_MISSING','请指定自定义上传程序');let args:string[];try{args=strings(JSON.parse(String(settings['image.uploadArgs']||'[]')));}catch{throw serviceError('INVALID_ARGUMENT','上传参数需要 JSON 字符串列表');}
      if(uploader==='picgo-core')args=[...args,'upload',item.path];else{const hasFile=args.some(arg=>/\$\{(file|input)\}/.test(arg));args=variables(args,{file:item.path,input:item.path,filename:basename(item.path),directory:dirname(item.path)});if(!hasFile)args.push(item.path);}
      const output=await runCommand(executable,args,{signal,timeout:60_000});returned=parseUploadOutput(output.stdout,1);
    }results.push({id:item.id,url:returned[0]});
  }catch(error){results.push({id:item.id,error:(error as Error).message});}}
  return results;
}
