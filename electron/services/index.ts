import { app, dialog, shell, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { BridgeMethod, SaveRequest } from '../../src/shared/contracts';
import { readFile, saveFile } from './files';
export type PlatformMethods = Partial<Record<BridgeMethod, (...args: any[]) => any>>;
export function createPlatform(window: BrowserWindow): PlatformMethods {
  const settingsPath=join(app.getPath('userData'),'settings.json');
  return {
    info:()=>({version:app.getVersion(),platform:process.platform,userData:app.getPath('userData')}),
    open:async(path?:string)=>{ if (!path) { const selected=await dialog.showOpenDialog(window,{filters:[{name:'Markdown',extensions:['md','markdown','txt','mdx','rmd','qmd']},{name:'所有文件',extensions:['*']}],properties:['openFile']}); if(selected.canceled)return null; path=selected.filePaths[0]; } return readFile(path); },
    readFile,
    save:async(request:SaveRequest)=>{ let path=request.path; if(!path){const selected=await dialog.showSaveDialog(window,{filters:[{name:'Markdown',extensions:['md']}],defaultPath:'未命名.md'});if(selected.canceled||!selected.filePath)return null;path=selected.filePath;} return saveFile({...request,path}); },
    chooseFolder:async()=>{const selected=await dialog.showOpenDialog(window,{properties:['openDirectory']});return selected.canceled?null:selected.filePaths[0];},
    listDirectory:async(path:string)=>Promise.all((await fs.readdir(path,{withFileTypes:true})).map(async entry=>{const full=join(path,entry.name),stat=await fs.stat(full);return{name:entry.name,path:full,directory:entry.isDirectory(),modifiedAt:stat.mtimeMs,size:stat.size};})),
    reveal:(path:string)=>shell.showItemInFolder(path),
    openExternal:async(url:string)=>{if(!/^https?:|^mailto:/i.test(url))throw new Error('链接协议不支持');await shell.openExternal(url);},
    loadSettings:async()=>{try{return JSON.parse(await fs.readFile(settingsPath,'utf-8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return{};throw error;}},
    saveSettings:async(settings:Record<string,unknown>)=>{await fs.mkdir(app.getPath('userData'),{recursive:true});const temp=settingsPath+'.tmp';await fs.writeFile(temp,JSON.stringify(settings,null,2));await fs.rename(temp,settingsPath);},
    windowAction:async(action:string)=>{if(action==='close')window.close();else if(action==='fullscreen')window.setFullScreen(!window.isFullScreen());else if(action==='alwaysOnTop')window.setAlwaysOnTop(!window.isAlwaysOnTop());else if(action==='devtools')window.webContents.toggleDevTools();else if(action==='print')window.webContents.print({});else throw new Error('窗口操作未注册');}
  };
}
