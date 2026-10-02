import type { SelectionRange, TextChange } from '../shared/contracts';
import { preferredNewline } from '../core/formatting';

function lowerBound(values:number[],position:number):number {let from=0,to=values.length;while(from<to){const middle=(from+to)>>>1;if(values[middle]<position)from=middle+1;else to=middle;}return from;}
/** CodeMirror projects CRLF to LF. The canonical store keeps every original code unit. */
export class SourceProjection {
  readonly text:string;
  private removedRaw:number[]=[];
  private removedView:number[]=[];
  constructor(readonly source:string){let offset=0;this.text=source.replace(/\r\n|\r/g,(newline,index:number)=>{if(newline==='\r\n'){this.removedRaw.push(index);this.removedView.push(index-offset++);}return '\n';});}
  toView(position:number):number{const clamped=Math.max(0,Math.min(this.source.length,position));return clamped-lowerBound(this.removedRaw,clamped);}
  toSource(position:number):number{const clamped=Math.max(0,Math.min(this.text.length,position));return clamped+lowerBound(this.removedView,clamped);}
  selectionToView(selection:SelectionRange):SelectionRange{return {anchor:this.toView(selection.anchor),head:this.toView(selection.head)};}
  selectionToSource(selection:SelectionRange):SelectionRange{return {anchor:this.toSource(selection.anchor),head:this.toSource(selection.head)};}
  changesToSource(changes:TextChange[],ending?:string):TextChange[]{const newline=preferredNewline(this.source,ending);return changes.map(change=>({from:this.toSource(change.from),to:this.toSource(change.to),insert:change.insert.replace(/\r\n/g,'\n').replace(/\n/g,newline)}));}
}
