import { StateEffect,StateField } from '@codemirror/state';
import { EditorView,ViewPlugin } from '@codemirror/view';
import { SourceProjection } from './source-projection';
import { hitRenderedText,renderedTextPosition } from './preview-position';

export const freezePreviewSelection=StateEffect.define<boolean>();
export const previewSelectionFrozen=StateField.define<boolean>({create:()=>false,update:(value,transaction)=>transaction.docChanged?false:transaction.effects.find(effect=>effect.is(freezePreviewSelection))?.value??value,provide:field=>EditorView.editorAttributes.from(field,value=>({class:value?'ot-selecting-preview':''}))});
const sessions=new WeakMap<EditorView,(rebuild?:boolean)=>void>();
export const previewPointerLifecycle=ViewPlugin.fromClass(class {
  private document;
  constructor(readonly view:EditorView){this.document=view.state.doc;}
  update(){if(this.view.state.doc!==this.document||!this.view.state.field(previewSelectionFrozen)){sessions.get(this.view)?.(false);this.document=this.view.state.doc;}}
  destroy(){sessions.get(this.view)?.(false);}
});

/** Widgets aren't editable DOM, so CodeMirror cannot hit-test their interior. */
export function previewPositionAtCoords(view:EditorView,source:string,x:number,y:number):number|null {
  const projection=new SourceProjection(source),blocks=[...view.contentDOM.querySelectorAll<HTMLElement>('.ot-preview-block')];
  const block=blocks.find(element=>{const rect=element.getBoundingClientRect();return y>=rect.top&&y<=rect.bottom;});
  if(block){
    const from=Number(block.dataset.sourceFrom),to=Number(block.dataset.sourceTo),text=source.slice(from,to),position=hitRenderedText(block,x,y,text);
    if(position!==null){let raw=from+position;if(raw>0&&/[\uDC00-\uDFFF]/.test(source[raw]??''))raw--;return projection.toView(raw);}
    const rect=block.getBoundingClientRect();return projection.toView(y<(rect.top+rect.bottom)/2?from:to);
  }
  return view.posAtCoords({x,y},false);
}
type TextPoint={node:Node;offset:number};
function textPoint(x:number,y:number):TextPoint|null {
  const api=document as Document&{caretPositionFromPoint?:(x:number,y:number)=>{offsetNode:Node;offset:number}|null;caretRangeFromPoint?:(x:number,y:number)=>Range|null};
  const point=api.caretPositionFromPoint?.(x,y),range=point?null:api.caretRangeFromPoint?.(x,y);
  return point?{node:point.offsetNode,offset:point.offset}:range?{node:range.startContainer,offset:range.startOffset}:null;
}
function sourcePoint(view:EditorView,source:string,position:number):TextPoint {
  const raw=new SourceProjection(source).toSource(position),block=[...view.contentDOM.querySelectorAll<HTMLElement>('.ot-preview-block')].find(element=>raw>=Number(element.dataset.sourceFrom)&&raw<=Number(element.dataset.sourceTo));
  if(!block)return view.domAtPos(position);
  const from=Number(block.dataset.sourceFrom),text=source.slice(from,Number(block.dataset.sourceTo)),visible=block.textContent??'';
  let low=0,high=visible.length;while(low<high){const middle=(low+high)>>1,mapped=renderedTextPosition(text,visible,middle);if(mapped!==null&&mapped<raw-from)low=middle+1;else high=middle;}
  const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let node:Node|null,offset=low;while(node=walker.nextNode()){if(offset<=node.textContent!.length)return {node,offset};offset-=node.textContent!.length;}
  return view.domAtPos(position);
}

/** Keep the measured text DOM intact until mouseup; selection must not reflow its own hit targets. */
export function startPreviewPointerSelection(view:EditorView,event:MouseEvent,position:number,source:()=>string,activate:StateEffect<unknown>):void {
  sessions.get(view)?.();event.preventDefault();
  const anchor=event.shiftKey?view.state.selection.main.anchor:position,owner=view.dom.ownerDocument,overlay=owner.createElement('div');
  overlay.className='ot-pointer-selection';view.dom.append(overlay);
  const anchorPoint=event.shiftKey?sourcePoint(view,source(),anchor):textPoint(event.clientX,event.clientY);
  const startText=source();let ended=false,x=event.clientX,y=event.clientY,frame=0;
  view.dispatch({selection:{anchor,head:position},effects:[activate,freezePreviewSelection.of(true)],userEvent:'select.pointer'});view.focus();
  function paint(){
    overlay.replaceChildren();const point=textPoint(x,y);if(!anchorPoint||!point||!view.contentDOM.contains(anchorPoint.node)||!view.contentDOM.contains(point.node))return;
    const range=owner.createRange(),start=owner.createRange(),end=owner.createRange();start.setStart(anchorPoint.node,anchorPoint.offset);end.setStart(point.node,point.offset);
    if(start.compareBoundaryPoints(Range.START_TO_START,end)<=0){range.setStart(anchorPoint.node,anchorPoint.offset);range.setEnd(point.node,point.offset);}else {range.setStart(point.node,point.offset);range.setEnd(anchorPoint.node,anchorPoint.offset);}
    const base=view.dom.getBoundingClientRect();const rects=range.collapsed?[range.getBoundingClientRect()]:[...range.getClientRects()];
    for(const rect of rects){if(!rect.height)continue;const mark=owner.createElement('div');mark.className=range.collapsed?'ot-pointer-caret':'ot-pointer-highlight';Object.assign(mark.style,{left:`${rect.left-base.left}px`,top:`${rect.top-base.top}px`,width:`${Math.max(1,rect.width)}px`,height:`${rect.height}px`});overlay.append(mark);}
  }
  function update(){if(ended)return;if(source()!==startText){finish();return;}const rect=view.scrollDOM.getBoundingClientRect(),hitY=Math.max(rect.top+1,Math.min(rect.bottom-1,y)),head=previewPositionAtCoords(view,startText,x,hitY);if(head!==null)view.dispatch({selection:{anchor,head},userEvent:'select.pointer'});paint();}
  function scroll(){if(ended)return;const rect=view.scrollDOM.getBoundingClientRect(),distance=y<rect.top+20?y-rect.top-20:y>rect.bottom-20?y-rect.bottom+20:0;if(distance){view.scrollDOM.scrollTop+=Math.max(-24,Math.min(24,distance));update();}frame=requestAnimationFrame(scroll);}
  function move(next:MouseEvent){x=next.clientX;y=next.clientY;if(next.buttons===0){finish();return;}next.preventDefault();update();}
  const end=()=>finish();
  function finish(rebuild=true){if(ended)return;ended=true;cancelAnimationFrame(frame);owner.removeEventListener('mousemove',move);owner.removeEventListener('mouseup',end);owner.defaultView?.removeEventListener('blur',end);overlay.remove();sessions.delete(view);if(rebuild)view.dispatch({effects:freezePreviewSelection.of(false),scrollIntoView:true});}
  sessions.set(view,finish);owner.addEventListener('mousemove',move);owner.addEventListener('mouseup',end);owner.defaultView?.addEventListener('blur',end);paint();frame=requestAnimationFrame(scroll);
}
