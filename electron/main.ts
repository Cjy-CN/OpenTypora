import { app, BrowserWindow, ipcMain, Menu, protocol, net, type MenuItemConstructorOptions } from 'electron';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { BRIDGE_METHODS, IPC_CHANNEL, type BridgeMethod } from '../src/shared/contracts';
import { success, failure, toAppError } from '../src/shared/errors';
import { createPlatform, resolveAuthorizedAsset } from './services';
import { COMMANDS } from '../src/shared/command-catalog';
const windows = new Set<BrowserWindow>();
const allowedClose = new WeakSet<BrowserWindow>();
protocol.registerSchemesAsPrivileged([{scheme:'opentypora-asset',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const smokeTest = process.argv.includes('--smoke-test');
if(smokeTest)app.setPath('userData',join(tmpdir(),`opentypora-smoke-${process.pid}`));
function createWindow() {
  const window=new BrowserWindow({width:1280,height:900,minWidth:720,minHeight:480,show:!smokeTest,title:'OpenTypora',backgroundColor:'#ffffff',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  windows.add(window);window.on('closed',()=>windows.delete(window));
  window.on('close',event=>{if(!smokeTest&&!allowedClose.has(window)){event.preventDefault();window.webContents.send('opentypora:command','file.close');}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL())event.preventDefault();});
  if(process.env.OPENTYPORA_DEV_URL)void window.loadURL(process.env.OPENTYPORA_DEV_URL);else void window.loadFile(join(__dirname,'../dist/index.html'));
  return window;
}
app.whenReady().then(()=>{
  protocol.handle('opentypora-asset',async request=>{
    const parsed=new URL(request.url);if(parsed.hostname!=='local'||parsed.search||parsed.hash)return new Response('Invalid asset',{status:400});
    const path=await resolveAuthorizedAsset(request.url);if(!path)return new Response('Asset not authorized',{status:403});
    if(!['.png','.jpg','.jpeg','.gif','.webp','.svg','.bmp','.avif','.ico'].includes(extname(path).toLowerCase()))return new Response('Unsupported asset type',{status:415});
    return net.fetch(pathToFileURL(path).href);
  });
  ipcMain.handle(IPC_CHANNEL,async(event,method:BridgeMethod,args:unknown[])=>{
    const window=BrowserWindow.fromWebContents(event.sender);
    if(!window||!windows.has(window)||!BRIDGE_METHODS.includes(method)||!Array.isArray(args))return failure('INVALID_IPC','无效的应用调用');
    try{if(method==='windowAction'&&args[0]==='new'){createWindow();return success(undefined);}if(method==='windowAction'&&args[0]==='close'){allowedClose.add(window);window.close();return success(undefined);}
      if(method==='systemAction'&&args[0]==='windows.saveAll'){windows.forEach(other=>{if(other!==window)other.webContents.send('opentypora:command','file.save');});return success(undefined);}
      if(method==='systemAction'&&args[0]==='windows.next'){const values=[...windows],next=values[(values.indexOf(window)+1)%values.length];next?.focus();return success(undefined);}
      const handler=createPlatform(window)[method];if(!handler)return failure('NOT_IMPLEMENTED',`服务尚未接入：${method}`);return success(await handler(...args));}
    catch(error){return {ok:false,error:toAppError(error)};}
  });
  const menuEntries=(prefix:string):MenuItemConstructorOptions[]=>{const result:MenuItemConstructorOptions[]=[],seen=new Set<string>();for(const command of COMMANDS.filter(item=>item.menu===prefix||item.menu.startsWith(prefix+'/'))){const tail=command.menu.slice(prefix.length+1).split('/')[0];if(command.menu===prefix)result.push({label:command.label,click:()=>BrowserWindow.getFocusedWindow()?.webContents.send('opentypora:command',command.id)});else if(!seen.has(tail)){seen.add(tail);result.push({label:tail,submenu:menuEntries(prefix+'/'+tail)});}}return result;};
  const menu=Menu.buildFromTemplate(['文件','编辑','段落','格式','视图','主题','帮助'].map(label=>({label,submenu:menuEntries(label)})));
  Menu.setApplicationMenu(menu);const initial=createWindow();
  if(smokeTest){
    const timeout=setTimeout(()=>{console.error('DESKTOP_SMOKE_TIMEOUT');app.exit(1);},30000);
    initial.webContents.once('did-finish-load',async()=>{
      try{
        await new Promise(resolve=>setTimeout(resolve,500));
        const sample='# Desktop smoke\r\n\r\n**原文 🙂**\r\n\r\n```mermaid\r\nflowchart TD\r\nA-->B\r\n```\r\n\r\n$$\r\nx^2\r\n$$\r\n';
        await initial.webContents.executeJavaScript(`(()=>{const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(sample)});document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`);
        await new Promise(resolve=>setTimeout(resolve,200));
        initial.webContents.send('opentypora:command','selection.all');await new Promise(resolve=>setTimeout(resolve,150));
        const roundtrip=await initial.webContents.executeJavaScript(`(()=>{const data=new DataTransfer();document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('text/plain');})()`);
        initial.webContents.send('opentypora:command','selection.documentStart');await new Promise(resolve=>setTimeout(resolve,3000));
        const report=await initial.webContents.executeJavaScript(`(async()=>({title:document.title,editor:!!document.querySelector('.cm-editor'),bridge:typeof window.opentypora?.save==='function',info:await window.opentypora.info(),nodeIsolated:typeof window.require==='undefined',mathSvg:!!document.querySelector('[data-math] svg'),diagramSvg:!!document.querySelector('[data-diagram] svg'),renderErrors:document.querySelectorAll('.render-error').length}))()`);
        const passed=report.editor&&report.bridge&&report.info.ok&&report.nodeIsolated&&roundtrip===sample&&report.mathSvg&&report.diagramSvg&&!report.renderErrors;
        report.sourceRoundtrip=roundtrip===sample;
        console.log(JSON.stringify({desktopSmoke:passed,...report}));clearTimeout(timeout);app.exit(passed?0:1);
      }catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}
    });
  }
  app.on('activate',()=>{if(windows.size===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
