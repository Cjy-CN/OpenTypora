import { createElement,createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { EditorView } from '@codemirror/view';
import { MarkdownEditor } from '../../src/editor/MarkdownEditor';
import { DocumentStore,createDocument } from '../../src/core/document';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { EditorHandle } from '../../src/shared/components';
import { previewSelectionFrozen } from '../../src/editor/preview-pointer';
import '../../src/ui/workspace.css';
import '../../src/render/document.css';
const host=document.getElementById('root')!,root=createRoot(host),ref=createRef<EditorHandle>();
host.className='workspace-document';document.body.style.display='block';document.body.style.setProperty('--workspace-font-size','18px');document.body.style.setProperty('--workspace-zoom','1');
let store:DocumentStore;
const events:unknown[]=[];for(const type of ['mousedown','mousemove','mouseup','blur'])document.addEventListener(type,event=>{const mouse=event as MouseEvent;events.push({type,x:mouse.clientX,y:mouse.clientY,buttons:mouse.buttons});},true);
const view=()=>EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
const api={
  load(text:string,sourceMode=false,width=640,theme='github'){store=new DocumentStore(createDocument(text));document.body.className=`workspace-shell theme-${theme}`;host.style.width=`${width}px`;flushSync(()=>root.render(createElement(MarkdownEditor,{ref,store,settings:{...DEFAULT_SETTINGS,'appearance.fontSize':18},sourceMode,focusMode:false,typewriterMode:false})));},
  state(){const editor=view(),selection=editor.state.selection.main,coords=editor.coordsAtPos(selection.head,selection.assoc||1);return {...store.getSnapshot(),viewSelection:{anchor:selection.anchor,head:selection.head},caret:coords&&{x:coords.left,top:coords.top,bottom:coords.bottom},previews:host.querySelectorAll('.ot-preview-block').length,selecting:!!host.querySelector('.ot-selecting-preview'),frozen:editor.state.field(previewSelectionFrozen),events:events.slice(-12),errors:[...host.querySelectorAll('[role=alert]')].map(e=>e.textContent)};},
  point(needle:string,offset=0){
    const content=view().contentDOM,walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT),nodes:Node[]=[];while(walker.nextNode())nodes.push(walker.currentNode);
    let index=nodes.map(node=>node.textContent).join('').indexOf(needle);if(index<0)throw new Error(`Visible text not found: ${needle}`);index+=offset;
    for(const node of nodes){if(index>node.textContent!.length){index-=node.textContent!.length;continue;}const range=document.createRange();range.setStart(node,index);range.setEnd(node,index);const rect=range.getBoundingClientRect();return {x:Math.round(rect.left),y:Math.round((rect.top+rect.bottom)/2)};}
    throw new Error(`Visible offset not found: ${needle}`);
  },
  select(position:number){store.setSelection({anchor:position,head:position});view().focus();},
  expectedPoint(position:number){const coords=view().coordsAtPos(position);return coords&&{x:coords.left,y:(coords.top+coords.bottom)/2};},
  undo(){store.undo();},
  source(){return view().state.doc.toString();},
  geometry(){const editor=view();return [...editor.contentDOM.querySelectorAll('.cm-line')].filter(element=>element.textContent).map(element=>{const position=editor.state.doc.toString().indexOf(element.textContent!)+1;editor.coordsAtPos(position);const line=editor.lineBlockAt(position),part=Array.isArray(line.type)?line.type.find(block=>block.from<=position&&block.to>=position&&block.type===0)??line:line;return {position,expected:part.top+editor.documentTop,actual:element.getBoundingClientRect().top};});},
  layout(){return [...view().contentDOM.children].map(element=>{const rect=element.getBoundingClientRect();return {text:element.textContent?.slice(0,60),top:rect.top,bottom:rect.bottom,from:(element as HTMLElement).dataset.sourceFrom,to:(element as HTMLElement).dataset.sourceTo};});}
};
Object.assign(window,{testEditor:api});
