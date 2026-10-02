import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BRIDGE_METHODS, IPC_CHANNEL, type BridgeMethod } from '../src/shared/contracts';
import { success, failure, toAppError } from '../src/shared/errors';
import { createPlatform } from './services';
import { COMMANDS } from '../src/shared/command-catalog';
const windows = new Set<BrowserWindow>();
const smokeTest = process.argv.includes('--smoke-test');
if(smokeTest)app.setPath('userData',join(tmpdir(),`opentypora-smoke-${process.pid}`));
function createWindow() {
  const window=new BrowserWindow({width:1280,height:900,minWidth:720,minHeight:480,show:!smokeTest,title:'OpenTypora',backgroundColor:'#ffffff',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  windows.add(window);window.on('closed',()=>windows.delete(window));
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL())event.preventDefault();});
  if(process.env.OPENTYPORA_DEV_URL)void window.loadURL(process.env.OPENTYPORA_DEV_URL);else void window.loadFile(join(__dirname,'../dist/index.html'));
  return window;
}
app.whenReady().then(()=>{
  ipcMain.handle(IPC_CHANNEL,async(event,method:BridgeMethod,args:unknown[])=>{
    const window=BrowserWindow.fromWebContents(event.sender);
    if(!window||!windows.has(window)||!BRIDGE_METHODS.includes(method)||!Array.isArray(args))return failure('INVALID_IPC','无效的应用调用');
    try{if(method==='windowAction'&&args[0]==='new'){createWindow();return success(undefined);}const handler=createPlatform(window)[method];if(!handler)return failure('NOT_IMPLEMENTED',`服务尚未接入：${method}`);return success(await handler(...args));}
    catch(error){return {ok:false,error:toAppError(error)};}
  });
  const menu=Menu.buildFromTemplate(['文件','编辑','段落','格式','视图','主题','帮助'].map(label=>({label,submenu:COMMANDS.filter(item=>item.menu.split('/')[0]===label).map(item=>({label:item.label,click:()=>BrowserWindow.getFocusedWindow()?.webContents.send('opentypora:command',item.id)}))})));
  Menu.setApplicationMenu(menu);const initial=createWindow();
  if(smokeTest){
    const timeout=setTimeout(()=>{console.error('DESKTOP_SMOKE_TIMEOUT');app.exit(1);},15000);
    initial.webContents.once('did-finish-load',async()=>{
      try{
        await new Promise(resolve=>setTimeout(resolve,500));
        const report=await initial.webContents.executeJavaScript(`(async()=>({title:document.title,editor:!!document.querySelector('textarea, .cm-editor'),bridge:typeof window.opentypora?.save==='function',info:await window.opentypora.info(),nodeIsolated:typeof window.require==='undefined'}))()`);
        const passed=report.editor&&report.bridge&&report.info.ok&&report.nodeIsolated;
        console.log(JSON.stringify({desktopSmoke:passed,...report}));clearTimeout(timeout);app.exit(passed?0:1);
      }catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}
    });
  }
  app.on('activate',()=>{if(windows.size===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
