import type {BrowserWindow} from 'electron';

/** Real Chromium geometry checks; only used by the isolated, hidden desktop smoke run. */
export async function checkMenuLayout(window:BrowserWindow){
 async function probe(){
  const wait=()=>new Promise(resolve=>setTimeout(resolve,20));
  async function waitFor(check:()=>boolean,label:string){
   const deadline=performance.now()+2000;
   while(!check()){if(performance.now()>deadline)throw new Error(`菜单状态未完成：${label}`);await wait();}
  }
  async function settledPanel(depth:number,label:string){
   let previous='';
   await waitFor(()=>{
    const panel=document.querySelector<HTMLDivElement>(`[data-menu-depth="${depth}"]`);
    if(!panel||getComputedStyle(panel).visibility!=='visible'){previous='';return false;}
    const rect=panel.getBoundingClientRect(),current=JSON.stringify([rect.x,rect.y,rect.width,rect.height]);
    const stable=current===previous;previous=current;return stable;
   },label);
   return document.querySelector<HTMLDivElement>(`[data-menu-depth="${depth}"]`)!;
  }
  await document.fonts.ready;
  const checked:string[]=[];
  const roots=[...document.querySelectorAll<HTMLButtonElement>('.workspace-menu-root>button')];
  const inside=(rect:DOMRect)=>rect.width>0&&rect.height>0&&rect.left>=7&&rect.top>=7&&rect.right<=innerWidth-7&&rect.bottom<=innerHeight-7;
  for(const root of roots){
   if(root.getAttribute('aria-expanded')!=='true')root.click();
   const parent=await settledPanel(0,root.textContent!);
   if(!parent||!inside(parent.getBoundingClientRect()))throw new Error(`一级菜单越界：${root.textContent}`);
   const triggers=[...parent.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')];
   const height=parent.getBoundingClientRect().height;
   for(const trigger of triggers){
    trigger.scrollIntoView({block:'nearest'});await wait();trigger.click();
    await waitFor(()=>trigger.getAttribute('aria-expanded')==='true','子菜单展开');
    const child=await settledPanel(1,trigger.querySelector('span')!.textContent!);
    const a=parent.getBoundingClientRect(),b=child?.getBoundingClientRect();
    if(!b||!inside(b))throw new Error(`二级菜单越界：${trigger.textContent} ${JSON.stringify({viewport:{width:innerWidth,height:innerHeight},parent:a.toJSON(),child:b?.toJSON(),style:child?.style.cssText,trigger:trigger.getBoundingClientRect().toJSON()})}`);
    if(Math.abs(parent.getBoundingClientRect().height-height)>1)throw new Error('子菜单撑开了一级菜单');
    if(!(b.left>=a.right-2||b.right<=a.left+2))throw new Error(`子菜单未在侧面展开：${trigger.textContent}`);
    if(trigger.dataset.menuKey==='file.export'){
     if(parent.querySelector('.export-menu-item')||child.querySelectorAll('.export-menu-item').length!==18)throw new Error('导出格式仍在一级菜单或缺少配置');
    }
    checked.push(trigger.dataset.menuKey!);
    trigger.focus();trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    await waitFor(()=>!child.querySelector('button:not(:disabled)')||child.contains(document.activeElement),'子菜单键盘焦点');
    const focus=document.activeElement as HTMLElement;
    if(child.querySelector('button:not(:disabled)')&&!child.contains(focus))throw new Error(`方向键未进入子菜单：${trigger.dataset.menuKey}`);
    focus.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await waitFor(()=>!document.querySelector('[data-menu-depth="1"]'),'子菜单关闭');
   }
   root.click();await waitFor(()=>root.getAttribute('aria-expanded')!=='true','一级菜单关闭');
  }
  return {viewport:{width:innerWidth,height:innerHeight},checked};
 }
 const original=window.getContentSize();
 try{
  const reports=[];
  for(const [width,height] of [[1264,861],[720,480]]){
   window.setContentSize(width,height);await new Promise(resolve=>setTimeout(resolve,100));
   reports.push(await window.webContents.executeJavaScript(`(${probe.toString()})()`));
  }
  if(reports.some(report=>report.checked.length!==10))throw new Error('二级菜单检查数量不完整');
  return reports;
 }finally{window.setContentSize(original[0],original[1]);}
}
