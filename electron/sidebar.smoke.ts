import {app,type BrowserWindow} from 'electron';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {createPlatform} from './services';

/** Exercises real file opening and directory watching in hidden, isolated smoke windows. */
export async function checkSidebarWorkflow(createWindow:(path?:string)=>Promise<BrowserWindow>){
 const directory=await fs.mkdtemp(join(app.getPath('userData'),'sidebar-'));
 const one=join(directory,'one'),two=join(directory,'two'),nested=join(one,'sub');
 const windows:BrowserWindow[]=[];
 const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
 async function until(window:BrowserWindow,condition:string){
  for(let attempt=0;attempt<80;attempt++){
   if(await window.webContents.executeJavaScript(`Boolean(${condition})`))return;
   await wait();
  }
  throw new Error(`侧栏检查超时：${condition}`);
 }
 async function open(path?:string){const window=await createWindow(path);windows.push(window);await until(window,"document.querySelector('.root-directory')?.title && document.querySelectorAll('.tree-entry').length");return window;}
 async function filter(window:BrowserWindow,value:string){
  await window.webContents.executeJavaScript(`(()=>{const input=document.querySelector('input[aria-label="过滤文件名"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 }
 const root=(window:BrowserWindow)=>window.webContents.executeJavaScript("document.querySelector('.root-directory').title");
 try{
  await fs.mkdir(nested,{recursive:true});await fs.mkdir(two);
  await Promise.all([
   fs.writeFile(join(one,'启动.md'),'# 启动\n\n原始文档\n'),
   fs.writeFile(join(one,'README.MD'),'# Readme\n'),
   fs.writeFile(join(one,'other.md'),'# Other\n'),
   fs.writeFile(join(nested,'nested.md'),'# Nested\n'),
   fs.writeFile(join(two,'second.md'),'# Second window\n'),
   fs.writeFile(join(one,'ignored.png'),'not Markdown'),
  ]);
  const first=await open(join(one,'启动.md')),second=await open(join(two,'second.md'));
  if(await root(first)!==one||await root(second)!==two)throw new Error('文件打开后未关联各自的父目录');
  const initial=await first.webContents.executeJavaScript("({tabs:[...document.querySelectorAll('.sidebar-tabs button')].map(x=>x.textContent),files:[...document.querySelectorAll('.tree-entry')].map(x=>x.title),filter:!!document.querySelector('input[aria-label=\"过滤文件名\"]')})");
  if(initial.tabs.join(',')!=='文件,大纲'||!initial.filter||!initial.files.includes(join(one,'other.md'))||initial.files.includes(join(one,'ignored.png')))throw new Error('文件标签顺序、过滤框或同目录列表不正确');
  await filter(first,'readme');await until(first,"document.querySelectorAll('.tree-entry').length===1 && document.querySelector('.tree-entry')?.title.endsWith('README.MD')");
  await first.webContents.executeJavaScript("document.querySelector('.tree-entry').click()");await until(first,"document.title==='README.MD — OpenTypora'");
  await first.webContents.executeJavaScript("document.querySelector('[aria-label=\"清除文件名过滤\"]').click()");await until(first,"document.querySelectorAll('.tree-entry').length===4");
  await fs.writeFile(join(one,'新增.md'),'# Watched sibling\n');await until(first,`[...document.querySelectorAll('.tree-entry')].some(x=>x.title===${JSON.stringify(join(one,'新增.md'))})`);
  await filter(first,'nested');await until(first,"document.querySelectorAll('.tree-entry').length===1 && document.querySelector('.tree-entry')?.title.endsWith('nested.md')");
  await first.webContents.executeJavaScript("document.querySelector('.tree-entry').click()");await until(first,`document.querySelector('.root-directory')?.title===${JSON.stringify(nested)}`);
  await until(first,"document.querySelector('input[aria-label=\"过滤文件名\"]').value===''");
  if(await root(second)!==two)throw new Error('第一个窗口切换目录改变了第二个窗口的目录关联');
  const platform=createPlatform(first),settings=await platform.loadSettings();
  await platform.saveSettings({...settings,'file.startup':'last'});
  await platform.systemAction('folder.open',{path:one});
  const restored=await open();
  if(await root(restored)!==nested)throw new Error('恢复上次文件时历史文件夹覆盖了文件所在目录');
  return {tabs:initial.tabs,automaticDirectory:true,filenameFilter:true,siblingOpen:true,clearFilter:true,directoryWatcher:true,crossDirectory:true,independentWindows:true,restoreSessionDirectory:true};
 }finally{
  windows.forEach(window=>{if(!window.isDestroyed())window.destroy();});
  await fs.rm(directory,{recursive:true,force:true});
 }
}
