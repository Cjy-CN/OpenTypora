import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AssetResult, UploadItem, UploadResult } from '../../src/shared/contracts';
import { authorizeDirectory, authorizeFile } from './access';
import { runCommand, variables } from './process';
import { absolutePath, object, serviceError, string, strings, url } from './validation';
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
export async function insertAsset(source:string,documentPath:string|null,strategy:string,settings:Record<string,unknown>,userData:string,signal?:AbortSignal):Promise<AssetResult>{
  source=absolutePath(source);if(documentPath)absolutePath(documentPath);await authorizeFile(source);
  let path=source;if(strategy==='copy'||!documentPath){path=await uniqueAsset(source,assetDirectory(documentPath,settings,userData));await authorizeDirectory(dirname(path));}
  if(strategy==='upload'){const uploaded=await uploadItems([{id:'insert',path}],settings,signal);if(uploaded[0].error)throw serviceError('UPLOAD_FAILED',uploaded[0].error);return{path,url:uploaded[0].url!};}
  if(!['none','copy','clipboard'].includes(strategy))throw serviceError('INVALID_ARGUMENT','图片插入策略无效');return{path,url:assetUrl(path,documentPath,settings)};
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
export async function uploadItems(items:UploadItem[],settings:Record<string,unknown>,signal?:AbortSignal):Promise<UploadResult[]>{
  if(!Array.isArray(items)||items.length>1000)throw serviceError('INVALID_ARGUMENT','图片列表无效');object(settings,'上传配置');const uploader=String(settings['image.uploader']??settings.uploader??'none');
  for(const item of items){string(item.id,'图片标识');absolutePath(item.path);}
  if(uploader==='none')return items.map(item=>({id:item.id,error:'未配置上传服务，请在图像设置中选择服务'}));
  if(!['picgo-core','picgo','piclist','custom'].includes(uploader))throw serviceError('INVALID_ARGUMENT','上传服务无效');
  const results:UploadResult[]=[];
  for(const item of items){if(signal?.aborted){results.push({id:item.id,error:'任务已取消'});continue;}try{
    await fs.access(item.path);let returned:string[];
    if(uploader==='picgo'||uploader==='piclist'){
      const endpoint=url(settings['image.uploadEndpoint']||'http://127.0.0.1:36677/upload',['http:','https:']);const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({list:[item.path]}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60_000)]):AbortSignal.timeout(60_000)});
      if(!response.ok)throw serviceError('UPLOAD_HTTP',`上传服务 HTTP ${response.status}`);returned=parseUploadOutput(await response.text(),1);
    }else{
      const executable=String(settings['image.uploadExecutable']||(uploader==='picgo-core'?'picgo':''));if(!executable)throw serviceError('DEPENDENCY_MISSING','请指定自定义上传程序');let args:string[];try{args=strings(JSON.parse(String(settings['image.uploadArgs']||'[]')));}catch{throw serviceError('INVALID_ARGUMENT','上传参数需要 JSON 字符串列表');}
      if(uploader==='picgo-core')args=[...args,'upload',item.path];else{const hasFile=args.some(arg=>/\$\{(file|input)\}/.test(arg));args=variables(args,{file:item.path,input:item.path,filename:basename(item.path),directory:dirname(item.path)});if(!hasFile)args.push(item.path);}
      const output=await runCommand(executable,args,{signal,timeout:60_000});returned=parseUploadOutput(output.stdout,1);
    }results.push({id:item.id,url:returned[0]});
  }catch(error){results.push({id:item.id,error:(error as Error).message});}}
  return results;
}
