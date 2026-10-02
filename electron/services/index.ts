import { app, dialog, shell, nativeImage, session, type BrowserWindow } from 'electron';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BridgeMethod, ExportSnapshot, RecoveryDraft, SaveRequest, SearchOptions, UploadItem } from '../../src/shared/contracts';
import { readFile, saveFile, atomicWrite } from './files';
import { absolutePath, object, serviceError, string, strings, url } from './validation';
import { authorizeDirectory, authorizeFile, resolveAsset, resolveAuthorizedAsset } from './access';
import { listDirectory, searchFiles } from './search';
import { Storage } from './storage';
import { assetDirectory, assetUrl, insertAsset, manageAssets, uniqueAsset, uploadItems } from './assets';
import { ExportService, INPUT_FORMATS, validateProfile } from './export';
import { createRenderService } from './render';
import { dependency, variables, runCommand } from './process';
import { SystemService } from './system';
import { readClipboard, writeClipboard } from './clipboard';
export { resolveAuthorizedAsset } from './access';
export type PlatformMethods = Record<BridgeMethod, (...args: any[]) => any>;
const platforms=new WeakMap<BrowserWindow,PlatformMethods>();
const sharedStorage=new Map<string,Storage>();
async function network(address:string,init:RequestInit={}):Promise<Response>{
  try{return await fetch(address,{...init,signal:init.signal||AbortSignal.timeout(20_000)});}catch(error){if(init.signal?.aborted)throw error;const partition=session.fromPartition('opentypora-proxy');await partition.setProxy({proxyRules:'http://127.0.0.1:7897'});return partition.fetch(address,{...init,signal:init.signal||AbortSignal.timeout(20_000)});}
}
export function createPlatform(window:BrowserWindow):PlatformMethods{
  const cached=platforms.get(window);if(cached)return cached;
  const userData=app.getPath('userData');let storage=sharedStorage.get(userData);if(!storage){storage=new Storage(userData);sharedStorage.set(userData,storage);}const savedStorage=storage;
  const exporter=new ExportService(userData,createRenderService(userData),network);const system=new SystemService(storage,{version:app.getVersion(),platform:process.platform,userData,executable:process.execPath,packaged:app.isPackaged,applicationPath:app.getAppPath(),openPath:path=>shell.openPath(path),openExternal:address=>shell.openExternal(address),request:network});
  const watchers=new Map<string,FSWatcher>(),timers=new Map<string,ReturnType<typeof setTimeout>>(),tasks=new Map<string,AbortController>();
  const watchPath=async(path:string)=>{path=absolutePath(path);const directory=(await fs.stat(path)).isDirectory()?path:dirname(path);if(watchers.has(directory))return;
    const watcher=watch(directory,{persistent:false},(_,filename)=>{const changed=filename?join(directory,filename.toString()):directory;if(timers.has(changed))clearTimeout(timers.get(changed));timers.set(changed,setTimeout(()=>{timers.delete(changed);if(!window.isDestroyed())window.webContents.send('opentypora:fileChanged',changed);},100));});watcher.on('error',()=>{watcher.close();watchers.delete(directory);});watchers.set(directory,watcher);
  };
  const task=async<T>(id:string,operation:(signal:AbortSignal)=>Promise<T>):Promise<T>=>{tasks.get(id)?.abort();const controller=new AbortController();tasks.set(id,controller);try{return await operation(controller.signal);}finally{if(tasks.get(id)===controller)tasks.delete(id);}};
  const opened=async(path:string,encoding?:string)=>{const file=await readFile(absolutePath(path),encoding);await authorizeDirectory(dirname(file.path));await savedStorage.remember(file.path);await watchPath(file.path);return file;};
  window.once('closed',()=>{watchers.forEach(watcher=>watcher.close());timers.forEach(timer=>clearTimeout(timer));tasks.forEach(controller=>controller.abort());platforms.delete(window);});
  const platform:PlatformMethods={
    info:()=>({version:app.getVersion(),platform:process.platform,userData}),
    open:async(path?:string)=>{if(!path){const result=await dialog.showOpenDialog(window,{filters:[{name:'Markdown与文本',extensions:['md','markdown','txt','text','mdx','rmd','qmd','mdtxt','mdtext','apib','rmarkdown','mmd','mkd','mdwn','mdown']},{name:'所有文件',extensions:['*']}],properties:['openFile']});if(result.canceled||!result.filePaths[0])return null;path=result.filePaths[0];}return opened(path);},
    readFile:(path:string)=>opened(path),
    save:async(request:SaveRequest)=>{object(request,'保存请求');let path=request.path;if(!path){const settings=await savedStorage.loadSettings(),extension=String(settings['file.extension']||'.md').replace(/^\./,'');const selected=await dialog.showSaveDialog(window,{filters:[{name:'Markdown',extensions:[extension]}],defaultPath:`未命名.${extension}`});if(selected.canceled||!selected.filePath)return null;path=selected.filePath;}const result=await saveFile({...request,path:absolutePath(path)});await authorizeDirectory(dirname(result.path));await savedStorage.remember(result.path);await watchPath(result.path);return result;},
    chooseFolder:async()=>{const selected=await dialog.showOpenDialog(window,{properties:['openDirectory']});if(selected.canceled||!selected.filePaths[0])return null;const path=selected.filePaths[0];await authorizeDirectory(path);await savedStorage.remember(path,'folder');await watchPath(path);return path;},
    listDirectory:async(path:string)=>{const result=await listDirectory(path);await watchPath(path);return result;},
    moveFile:async(from:string,to:string)=>{from=absolutePath(from);to=absolutePath(to);if(from===to)return to;await fs.copyFile(from,to,fs.constants.COPYFILE_EXCL);try{await fs.unlink(from);}catch(error){await fs.unlink(to).catch(()=>undefined);throw error;}await authorizeDirectory(dirname(to));await savedStorage.remember(to);await watchPath(to);return to;},
    trashFile:async(path:string)=>{path=absolutePath(path);await shell.trashItem(path);},
    reveal:async(path:string)=>{path=absolutePath(path);await fs.access(path);shell.showItemInFolder(path);},
    openExternal:async(address:string)=>{string(address,'链接');if(/^file:/i.test(address)){const path=await resolveAuthorizedAsset(address);if(!path)throw serviceError('ASSET_ACCESS_DENIED','本地链接不在已打开/选择的授权目录中或文件不存在');const error=await shell.openPath(path);if(error)throw serviceError('OPEN_FAILED',error);return;}await shell.openExternal(url(address));},
    loadSettings:()=>savedStorage.loadSettings(),saveSettings:(settings:Record<string,unknown>)=>savedStorage.saveSettings(settings),
    listRecovery:()=>savedStorage.listRecovery(),writeRecovery:(draft:RecoveryDraft)=>savedStorage.writeRecovery(draft),deleteRecovery:(id:string)=>savedStorage.deleteRecovery(id),
    insertImage:async(documentPath:string|null,strategy:string)=>{if(documentPath)documentPath=absolutePath(documentPath);string(strategy,'图片策略');const settings=await savedStorage.loadSettings();let path:string;
      if(strategy==='clipboard'){const data=await readClipboard();const image=data.image?nativeImage.createFromDataURL(data.image):nativeImage.createEmpty();if(image.isEmpty())throw serviceError('CLIPBOARD_NO_IMAGE','剪贴板中没有图片');const directory=assetDirectory(documentPath,settings,userData);await fs.mkdir(directory,{recursive:true});path=join(directory,`image-${randomUUID()}.png`);await atomicWrite(path,image.toPNG());await authorizeFile(path);if(settings['image.strategy']==='upload'&&settings['image.applyLocal']!==false)return task('upload',signal=>insertAsset(path,documentPath,'upload',settings,userData,signal));return{path,url:assetUrl(path,documentPath,settings)};}
      const selected=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'图像',extensions:['png','jpg','jpeg','gif','svg','webp','bmp','avif']}]});if(selected.canceled||!selected.filePaths[0])return null;path=selected.filePaths[0];return task('upload',signal=>insertAsset(path,documentPath,strategy,settings,userData,signal));},
    manageAssets:(operation:string,paths:string[],destination?:string)=>manageAssets(operation,paths,destination,path=>shell.trashItem(path)),
    upload:(items:UploadItem[],settings:Record<string,unknown>)=>task('upload',signal=>uploadItems(items,settings,signal)),
    export:async(input:ExportSnapshot)=>{const snapshot=structuredClone(input);object(snapshot);validateProfile(snapshot.profile);const settings=await savedStorage.loadSettings(),options=snapshot.profile.options;let target=options.path?absolutePath(options.path):null;
      if(!target){const directory=String(settings['export.directory']||'');const ext=snapshot.profile.extension.replace(/^\./,'');const name=`${(snapshot.title||'未命名').replace(/[<>:"/\\|?*]/g,'-')}.${ext}`;const selected=await dialog.showSaveDialog(window,{defaultPath:directory?join(directory,name):snapshot.path?join(dirname(snapshot.path),name):name,filters:[{name:snapshot.profile.name,extensions:[ext]}]});if(selected.canceled||!selected.filePath)return null;target=selected.filePath;}
      const result=await task('export',signal=>exporter.export(snapshot,target!,settings,signal));const postErrors:string[]=[];
      if(snapshot.profile.openFile){const error=await shell.openPath(result.path);if(error)postErrors.push(error);}if(snapshot.profile.openFolder||settings['export.openFolder'])shell.showItemInFolder(result.path);
      if(snapshot.profile.afterCommand){try{await runCommand(snapshot.profile.afterCommand.executable,variables(snapshot.profile.afterCommand.args,{input:snapshot.path||'',output:result.path,title:snapshot.title,resourceDir:dirname(result.path)}),{cwd:dirname(result.path)});}catch(error){postErrors.push((error as Error).message);}}if(postErrors.length)result.postActionError=postErrors.join('\n');return result;},
    import:async(path?:string)=>{if(!path){const selected=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'可导入文档',extensions:Object.keys(INPUT_FORMATS).map(extension=>extension.slice(1))}]});if(selected.canceled||!selected.filePaths[0])return null;path=selected.filePaths[0];}const settings=await savedStorage.loadSettings();return task('import',signal=>exporter.import(path!,settings,signal));},
    dependencies:async()=>{const settings=await savedStorage.loadSettings();return Object.fromEntries(await Promise.all([['pandoc',String(settings['export.pandocPath']||'pandoc')],['xelatex','xelatex'],['pdflatex','pdflatex'],['picgo-core',String(settings['image.uploadExecutable']||'picgo')],['node','node'],['custom-uploader',String(settings['image.uploadExecutable']||'')]].map(async([name,path])=>[name,path?await dependency(name,path):{available:false}])));},
    searchFiles:(root:string,query:string,options:SearchOptions)=>task('search',signal=>searchFiles(root,query,options,signal)),
    windowAction:async(action:string)=>{if(action==='close')window.close();else if(action==='fullscreen')window.setFullScreen(!window.isFullScreen());else if(action==='alwaysOnTop')window.setAlwaysOnTop(!window.isAlwaysOnTop());else if(action==='devtools')window.webContents.toggleDevTools();else if(action==='print')window.webContents.send('opentypora:command','file.print');else throw serviceError('INVALID_WINDOW_ACTION','窗口操作未注册');},
    systemAction:async(action:string,input:Record<string,unknown>={})=>{action=string(action,'系统操作');const options=object(input);if(action==='clipboardRead')action='clipboard.read';if(action==='clipboardWrite')action='clipboard.write';
      if(action==='clipboard.read')return readClipboard();
      if(action==='clipboard.write')return writeClipboard(options);
      if(action==='clipboard.image'){if(options.path){const path=await resolveAuthorizedAsset(absolutePath(options.path));if(!path)throw serviceError('ASSET_ACCESS_DENIED','图片不在已授权目录或不存在');const image=nativeImage.createFromPath(path);if(image.isEmpty())throw serviceError('INVALID_IMAGE','无法解码此图片，请先转换为PNG/JPEG/WebP');await writeClipboard({image:image.toDataURL()});return{path,copied:true};}return platform.insertImage(options.documentPath??null,'clipboard');}
      if(action==='assets.resolve')return resolveAsset(options.url,options.documentPath);
      if(action==='assets.stage'){const path=absolutePath(options.path);const settings=await savedStorage.loadSettings();return insertAsset(path,options.documentPath?absolutePath(options.documentPath):null,String(options.strategy||'copy'),settings,userData);}
      if(action==='assets.materialize'){const documentPath=absolutePath(options.documentPath),paths=strings(options.paths).map(path=>absolutePath(path));const settings=await savedStorage.loadSettings(),directory=assetDirectory(documentPath,settings,userData);const results=[];for(const path of [...new Set(paths)]){try{const materialized=await uniqueAsset(path,directory,false);await authorizeFile(materialized);results.push({path:materialized,url:assetUrl(materialized,documentPath,settings),sourcePath:path});}catch(error){results.push({path,url:'',error:(error as Error).message});}}return results;}
      if(action==='tasks.cancel'){const id=string(options.id||'all');if(id==='all')tasks.forEach(controller=>controller.abort());else tasks.get(id)?.abort();return undefined;}
      if(action==='watcher.start'){await watchPath(absolutePath(options.path));return undefined;}
      if(action==='print.snapshot'){const snapshot=object(options.snapshot) as unknown as ExportSnapshot;const {exportHtml}=await import('./export');const html=await exportHtml(snapshot,snapshot.profile.options,[]);const directory=join(userData,'print',randomUUID());await fs.mkdir(directory,{recursive:true});const path=join(directory,'print.html');await fs.writeFile(path,html);const {BrowserWindow}=await import('electron');const printWindow=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,javascript:false}});try{await printWindow.loadFile(path);await new Promise<void>((resolve,reject)=>printWindow.webContents.print({printBackground:true},(success,reason)=>success?resolve():reject(serviceError('PRINT_FAILED',reason))));}finally{if(!printWindow.isDestroyed())printWindow.destroy();await fs.rm(directory,{recursive:true,force:true});}return undefined;}
      return system.action(action,options);
    }
  };platforms.set(window,platform);return platform;
}
