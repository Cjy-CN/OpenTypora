import {createRoot} from 'react-dom/client';
import {EditorView} from '@codemirror/view';
import {createDocument} from '../../src/core/document';
import type {DesktopBridge} from '../../src/shared/contracts';
import '../../src/styles.css';

const query=new URLSearchParams(location.search),theme=query.get('theme')??'github';
const text='# Dialog appearance\n\nOriginal content stays intact when a dialog is cancelled.\n';
let command:((id:string)=>void)|undefined;
const ok=(value:unknown)=>({ok:true as const,value});
const bridge={
  info:async()=>ok({version:'0.1.2',platform:'win32',systemLanguages:['zh-CN']}),
  loadSettings:async()=>ok({'appearance.theme':theme,'appearance.independentDark':query.has('dark'),'appearance.darkTheme':'night','appearance.customCss':'.workspace-document { background: transparent; }','general.language':'zh-CN','file.recovery':false}),
  saveSettings:async()=>ok(undefined),
  listRecovery:async()=>ok(Array.from({length:8},(_,index)=>({id:`draft-${index}`,savedAt:1791079200000,session:{...createDocument(text),path:`C:/isolated/这是用于验证按钮换行的非常长的恢复草稿文件名-${index}.md`,dirty:true}}))),
  listDirectory:async()=>ok([]),
  onFileChanged:()=>()=>{},
  onCommand:(listener:(id:string)=>void)=>{command=listener;return()=>{command=undefined;};},
  save:async()=>({ok:false as const,error:{code:'EXTERNAL_CONFLICT',message:'Isolated conflict fixture',retryable:true}}),
  systemAction:async(action:string)=>ok(action==='updates.check'?{current:'0.1.2',available:false,channel:'stable',notes:'Isolated appearance fixture',assets:[]}:action==='history.list'?[]:{})
} as unknown as DesktopBridge;
window.opentypora=bridge;
if(query.has('dark')){
  const match=window.matchMedia.bind(window);
  window.matchMedia=((value:string)=>value==='(prefers-color-scheme: dark)'?{...match(value),matches:true,addEventListener(){},removeEventListener(){}}:match(value)) as typeof window.matchMedia;
}

async function start(){
  const {App}=await import('../../src/App');
  createRoot(document.getElementById('root')!).render(<App/>);
  Object.assign(window,{dialogAppearance:{
    text,
    command(id:string){if(!command)throw new Error('Command listener not ready');command(id);},
    close(){document.querySelector<HTMLButtonElement>('.workspace-dialog .dialog-heading button')?.click();},
    restore(){document.querySelector<HTMLButtonElement>('.app-prompt-actions button')?.click();},
    source(){const host=document.querySelector('.cm-editor');if(!host)throw new Error('Editor unavailable');return EditorView.findFromDOM(host as HTMLElement)?.state.doc.toString();},
    inspect(selector='.workspace-dialog'){
      const dialog=document.querySelector<HTMLElement>(selector);if(!dialog)return null;
      const shell=dialog.closest<HTMLElement>('.workspace-shell'),style=getComputedStyle(dialog),rect=dialog.getBoundingClientRect();
      const controls=[...dialog.querySelectorAll<HTMLElement>('button,input,select,textarea')];
      return {title:dialog.getAttribute('aria-label')??dialog.querySelector('h2')?.textContent,scoped:!!shell,theme:shell?.className,background:style.backgroundColor,color:style.color,border:style.borderTopWidth,font:style.fontSize,opacity:style.opacity,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},viewport:{width:innerWidth,height:innerHeight},controlsInside:controls.every(control=>{const r=control.getBoundingClientRect();return r.left>=rect.left&&r.right<=rect.right;}),buttons:controls.filter(control=>control.tagName==='BUTTON').map(control=>({font:getComputedStyle(control).fontSize,width:control.getBoundingClientRect().width}))};
    }
  }});
}
void start();
