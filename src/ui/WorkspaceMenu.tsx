import {useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type KeyboardEvent} from 'react';
import type {CommandDefinition} from '../core/commands';
import type {ExportProfile} from '../shared/contracts';
import {localizeUi,useUiLanguage} from './i18n';

export const MENU_NAMES=['文件','编辑','段落','格式','视图','主题','帮助'];
export interface MenuEntry {
 key:string;label:string;command?:CommandDefinition;argument?:ExportProfile;extension?:string;children?:MenuEntry[];
}
/** Preserve catalog order and every path segment, including future third-level menus. */
export function buildMenuEntries(definitions:readonly CommandDefinition[],root:string,profiles:readonly ExportProfile[]):MenuEntry[]{
 const entries:MenuEntry[]=[];
 for(const command of definitions){
  const [name,...groups]=command.menu.split('/');if(name!==root)continue;
  let level=entries,path=root;
  for(const group of groups){path+='/'+group;let entry=level.find(item=>item.key===path);if(!entry){entry={key:path,label:group,children:[]};level.push(entry);}level=entry.children!;}
  level.push(command.id==='file.export'?{key:command.id,label:command.label,children:profiles.map(profile=>({key:`export:${profile.id}`,label:profile.name,command,argument:profile,extension:profile.extension}))}:{key:command.id,label:command.label,command});
 }
 return entries;
}

type Rect=Pick<DOMRect,'left'|'right'|'top'|'bottom'>;
export function menuPosition(anchor:Rect,size:{width:number;height:number},viewport:{width:number;height:number},nested:boolean){
 const margin=8,width=Math.min(size.width,Math.max(0,viewport.width-2*margin)),height=Math.min(size.height,Math.max(0,viewport.height-2*margin));
 let left=nested?anchor.right-1:anchor.left;
 if(nested&&left+width>viewport.width-margin)left=anchor.left-width+1;
 left=Math.max(margin,Math.min(left,viewport.width-margin-width));
 const top=Math.max(margin,Math.min(nested?anchor.top-5:anchor.bottom+3,viewport.height-margin-height));
 return {left,top};
}

interface Props {
 definitions:readonly CommandDefinition[];profiles:readonly ExportProfile[];openRoot:string|null;onOpenRoot:(root:string|null)=>void;
 available:(id:string)=>boolean;checked:(id:string)=>boolean|undefined;shortcuts:Record<string,string>;onExecute:(id:string,argument?:unknown)=>void;
 sidebar:boolean;zoom:number;
}
export function WorkspaceMenu({definitions,profiles,openRoot,onOpenRoot,available,checked,shortcuts,onExecute,sidebar,zoom}:Props){
 const language=useUiLanguage(),nav=useRef<HTMLElement>(null),rootButtons=useRef(new Map<string,HTMLButtonElement>()),panels=useRef(new Map<number,HTMLDivElement>()),items=useRef(new Map<string,HTMLButtonElement>());
 const [path,setPath]=useState<string[]>([]),[positions,setPositions]=useState<Record<number,CSSProperties>>({}),[resize,setResize]=useState(0);
 const focusRequest=useRef<{depth:number;last?:boolean}|null>(null),hoverOpenedRoot=useRef<string|null>(null);
 const entries=useMemo(()=>buildMenuEntries(definitions,openRoot??'',profiles),[definitions,openRoot,profiles]);
 const levels:{entries:MenuEntry[];label:string}[]=[];
 if(openRoot){levels.push({entries,label:openRoot});for(const key of path){const parent=levels.at(-1)!.entries.find(item=>item.key===key);if(!parent?.children)break;levels.push({entries:parent.children,label:parent.label});}}
 const focusItem=(depth:number,last=false)=>{const buttons=panels.current.get(depth)?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');if(buttons?.length)buttons[last?buttons.length-1:0].focus();};
 const closeRoot=()=>{hoverOpenedRoot.current=null;if(openRoot)rootButtons.current.get(openRoot)?.focus();setPath([]);onOpenRoot(null);};
 const open=(root:string,focus?:'first'|'last')=>{setPath([]);if(focus)focusRequest.current={depth:0,last:focus==='last'};onOpenRoot(root);};
 const openChild=(entry:MenuEntry,depth:number,focus=false)=>{if(!entry.children)return;if(focus)focusRequest.current={depth:depth+1};setPath(current=>!focus&&current.length===depth+1&&current[depth]===entry.key?current:[...current.slice(0,depth),entry.key]);};
 useEffect(()=>{setPath([]);},[openRoot]);
 useEffect(()=>{
  if(!openRoot)return;
  const dismiss=(event:PointerEvent)=>{if(!nav.current?.contains(event.target as Node)){setPath([]);onOpenRoot(null);}};
  const update=()=>setResize(value=>value+1);
  window.addEventListener('pointerdown',dismiss);window.addEventListener('resize',update);
  return()=>{window.removeEventListener('pointerdown',dismiss);window.removeEventListener('resize',update);};
 },[openRoot,onOpenRoot]);
 useLayoutEffect(()=>{
  if(!openRoot)return;
  const next:Record<number,CSSProperties>={};
  for(let depth=0;depth<levels.length;depth++){
   const panel=panels.current.get(depth),anchor=depth===0?rootButtons.current.get(openRoot):items.current.get(path[depth-1]);
   if(!panel||!anchor)continue;
   const parent=depth>0?panels.current.get(depth-1):undefined;
   const rect=anchor.getBoundingClientRect(),parentRect=parent?.getBoundingClientRect();
   const bounds=parentRect?{...rect,left:parentRect.left,right:parentRect.right,top:rect.top,bottom:rect.bottom}:rect;
   const position=menuPosition(bounds,panel.getBoundingClientRect(),{width:window.innerWidth,height:window.innerHeight},depth>0);
   Object.assign(panel.style,{left:`${position.left}px`,top:`${position.top}px`});next[depth]={...position,visibility:'visible'};
  }
  setPositions(next);
  if(focusRequest.current){focusItem(focusRequest.current.depth,focusRequest.current.last);focusRequest.current=null;}
 },[openRoot,path,entries,resize]);
 const onPanelKey=(event:KeyboardEvent<HTMLDivElement>,depth:number)=>{
  const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],current=buttons.indexOf(document.activeElement as HTMLButtonElement),entry=levels[depth].entries.find(item=>items.current.get(item.key)===document.activeElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();event.stopPropagation();const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:current<0?(event.key==='ArrowDown'?0:buttons.length-1):(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index]?.focus();
  }else if(event.key==='ArrowRight'&&entry?.children){event.preventDefault();event.stopPropagation();openChild(entry,depth,true);
  }else if((event.key==='ArrowLeft'||event.key==='Escape')&&depth>0){event.preventDefault();event.stopPropagation();items.current.get(path[depth-1])?.focus();setPath(current=>current.slice(0,depth-1));
  }else if(event.key==='Escape'&&path.length>depth){event.preventDefault();event.stopPropagation();items.current.get(path.at(-1)!)?.focus();setPath(current=>current.slice(0,-1));
  }else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeRoot();
  }else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();const index=MENU_NAMES.indexOf(openRoot!);open(MENU_NAMES[(index+(event.key==='ArrowRight'?1:-1)+MENU_NAMES.length)%MENU_NAMES.length],'first');
  }else if(event.key==='Tab'){setPath([]);onOpenRoot(null);}
 };
 return localizeUi(<nav ref={nav} className="workspace-menu-bar" aria-label="主菜单"><button aria-label={sidebar?'隐藏侧边栏':'显示侧边栏'} title="侧边栏 Ctrl+Shift+L" onClick={()=>onExecute('view.sidebar')}>☰</button>{MENU_NAMES.map(name=><div className="workspace-menu-root" key={name}><button ref={button=>{if(button)rootButtons.current.set(name,button);else rootButtons.current.delete(name);}} aria-haspopup="menu" aria-expanded={openRoot===name} className={openRoot===name?'active':''} onPointerEnter={()=>{if(openRoot&&openRoot!==name){hoverOpenedRoot.current=name;open(name);}}} onClick={()=>{if(openRoot===name&&hoverOpenedRoot.current!==name)closeRoot();else open(name);hoverOpenedRoot.current=null;}} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open(name,event.key==='ArrowDown'?'first':'last');}}}>{name}</button>{openRoot===name&&levels.map((level,depth)=><div key={`${name}:${depth}:${level.label}`} ref={panel=>{if(panel)panels.current.set(depth,panel);else panels.current.delete(depth);}} className={`workspace-dropdown ${depth?'workspace-submenu-panel':''}`} role="menu" aria-label={depth===0?name:level.label==='导出'?'导出格式':level.label} data-menu-depth={depth} style={positions[depth]??{visibility:'hidden'}} onPointerEnter={()=>{hoverOpenedRoot.current=null;}} onKeyDown={event=>onPanelKey(event,depth)} onScroll={()=>setPath(current=>current.length>depth?current.slice(0,depth):current)}>{level.entries.map(entry=>{
   const disabled=!!entry.command&&!available(entry.command.id),state=entry.command?checked(entry.command.id):undefined,expanded=path[depth]===entry.key;
   return <button key={entry.key} ref={button=>{if(button)items.current.set(entry.key,button);else items.current.delete(entry.key);}} data-menu-key={entry.key} className={entry.children?`workspace-submenu-trigger ${expanded?'active':''}`:entry.argument?'export-menu-item':undefined} role={state===undefined?'menuitem':'menuitemcheckbox'} aria-checked={state} aria-haspopup={entry.children?'menu':undefined} aria-expanded={entry.children?expanded:undefined} disabled={disabled} onPointerEnter={()=>{if(disabled)return;if(entry.children)openChild(entry,depth);else setPath(current=>current.length>depth?current.slice(0,depth):current);}} onClick={()=>{if(entry.children)openChild(entry,depth,true);else if(entry.command)onExecute(entry.command.id,entry.argument);}}><span data-user-content={!!entry.argument}>{state?'✓ ':''}{entry.label}</span>{entry.children?<span className="workspace-submenu-arrow" aria-hidden="true">›</span>:<small>{entry.extension??(entry.command?(shortcuts[entry.command.id]??entry.command.shortcut):'')}</small>}</button>;
  })}{!level.entries.length&&<p className="workspace-menu-empty" role="status">没有导出配置，请在偏好设置中添加。</p>}</div>)}</div>)}<span className="workspace-menu-right">{zoom}%</span></nav>,language);
}
