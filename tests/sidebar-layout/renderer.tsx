import {createRoot} from 'react-dom/client';
import {DocumentStore,createDocument} from '../../src/core/document';
import {CommandRegistry} from '../../src/core/commands';
import {COMMANDS} from '../../src/shared/command-catalog';
import {SettingsStore} from '../../src/shared/settings';
import type {DesktopBridge,DirectoryEntry} from '../../src/shared/contracts';
import {WorkspaceShell} from '../../src/ui/WorkspaceShell';
import '../../src/styles.css';

const query=new URLSearchParams(location.search),rootPath='C:/isolated/specs';
localStorage.clear();localStorage.setItem('opentypora.ui.width',query.get('width')??'264');
const store=new DocumentStore(createDocument('# Unchanged document\n')),registry=new CommandRegistry(COMMANDS),settingsStore=new SettingsStore();
settingsStore.set('appearance.theme',query.get('theme')??'github');settingsStore.set('general.language',query.get('language')??'zh-CN');
const names=['2026-07-30-browser-automation-tools-design.md','超长中文文件名😀没有空格也需要完整显示行高'.repeat(6)+'.md','longUnbrokenName'.repeat(12)+'.md','Short.md'];
const files:DirectoryEntry[]=Array.from({length:120},(_,index)=>({name:`${index.toString().padStart(3,'0')}-${names[index%names.length]}`,path:`${rootPath}/${index<40?'':'子目录/'}${index.toString().padStart(3,'0')}-${names[index%names.length]}`,directory:false,size:300,modifiedAt:1791079200000}));
const ok=<T,>(value:T)=>({ok:true as const,value});let opened:string|undefined;
const bridge={
 listDirectory:async(path:string)=>ok(path===rootPath?[...files.slice(0,40),{name:'子目录',path:rootPath+'/子目录',directory:true,size:0,modifiedAt:0}]:files.slice(40)),
 readFile:async()=>ok({text:'树包助手：浏览器自动化操作与本地数据导出。这里是一段很长的摘要，'.repeat(8)}),
 onFileChanged:()=>()=>{}
} as unknown as DesktopBridge;
store.patchMetadata({rootDirectory:rootPath,path:files[0].path});
registry.register('file.open',(_context,path)=>{opened=path as string;});
const context={document:store,notify:()=>{}};
createRoot(document.getElementById('root')!).render(<WorkspaceShell store={store} settingsStore={settingsStore} registry={registry} context={context} bridge={bridge} editor={<textarea aria-label="test editor"/>} message="" onCommand={(id,arg)=>{void registry.execute(id,context,arg);}} onNavigate={()=>{}}/>);
Object.assign(window,{sidebarTest:{
 command(id:string){return registry.execute(id,context);},
 source(){return store.getSnapshot().text;},opened(){return opened;},
 scroll(top:number){const list=document.querySelector('.virtual-file-list')!;list.scrollTop=top;list.dispatchEvent(new Event('scroll',{bubbles:true}));},
 inspect(){return [...document.querySelectorAll<HTMLButtonElement>('.file-summary')].map(card=>{
  const rect=(element:HTMLElement)=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
  return {name:card.querySelector('strong')!.textContent,card:rect(card),children:[...card.children].map(element=>{const style=getComputedStyle(element);return {tag:element.tagName,text:element.textContent,...rect(element as HTMLElement),lineHeight:parseFloat(style.lineHeight),paddingTop:parseFloat(style.paddingTop),paddingBottom:parseFloat(style.paddingBottom),borderBottom:parseFloat(style.borderBottomWidth)};})};
 });}
}});
