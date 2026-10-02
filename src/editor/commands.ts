import type { DocumentStore } from '../core/document';
import type { EditPlan } from '../core/formatting';
import { alertPlan,applyPlan,blockAt,clearInline,codeAt,codePlan,deletionPlan,formattedRange,lineAt,lineEndingPlan,linkPlan,moveLinePlan,orderedSelection,paragraphPlan,semanticRange,tableAt,tablePlan,toggleInline } from '../core/formatting';
import type { SettingsSnapshot } from '../shared/settings';

export const EDITOR_COMMAND_IDS = [
  'edit.undo','edit.redo', 'edit.cut','edit.copy','edit.copyPlain','edit.copyMarkdown','edit.copyHTML','edit.copySimplified','edit.paste','edit.pastePlain',
  ...['all','block','lineOrSentence','formatted','word','documentStart','documentEnd','lineStart','lineEnd','selection'].map(id=>`selection.${id}`),
  ...['moveLineUp','moveLineDown','delete','deleteBlock','deleteLineOrSentence','deleteFormatted','deleteWord'].map(id=>`range.${id}`),
  'text.LF','text.CRLF',
  ...Array.from({length:6},(_,index)=>`paragraph.heading${index+1}`),
  ...['plain','promote','demote','quote','ordered','unordered','task','taskState','indent','outdent','insertBefore','insertAfter','reference','footnote','hr','toc','yaml'].map(id=>`paragraph.${id}`),
  ...['create','rowBefore','rowAfter','columnBefore','columnAfter','moveRowUp','moveRowDown','moveColumnLeft','moveColumnRight','deleteRow','deleteColumn','copy','formatSource','delete','alignment'].map(id=>`table.${id}`),
  ...['create','language','copy','indentSelection','indentBlock'].map(id=>`code.${id}`),
  'math.create',...['note','tip','important','warning','caution'].map(id=>`alert.${id}`),
  ...['bold','italic','underline','code','strike','comment','link','linkActions','clear','highlight','sub','sup'].map(id=>`format.${id}`),
  'image.insert','image.scale','image.convertSyntax',
] as const;
export function commitPlan(store:DocumentStore,plan:EditPlan,origin:'command'|'input'|'asset'='command',historyGroup?:string):boolean {
  const snapshot=store.getSnapshot();if(snapshot.readonly)return false;
  if(!plan.changes.length){store.setSelection(plan.selection);return true;}
  store.apply({transactionId:crypto.randomUUID(),documentId:snapshot.documentId,baseVersion:snapshot.version,origin,historyGroup,...plan});return true;
}
export function canExecuteEditorCommand(store:DocumentStore,id:string):boolean {
  if(!EDITOR_COMMAND_IDS.includes(id))return false;
  const snapshot=store.getSnapshot();if(id==='edit.undo')return store.canUndo();if(id==='edit.redo')return store.canRedo();
  if(snapshot.composing)return false;
  if(snapshot.readonly&&!id.startsWith('selection.')&&!['edit.copy','edit.copyPlain','edit.copyMarkdown','edit.copyHTML','edit.copySimplified','table.copy','code.copy'].includes(id))return false;
  if(id.startsWith('table.')&&id!=='table.create')return !!tableAt(snapshot.text,snapshot.selection.head);
  if(id.startsWith('code.')&&id!=='code.create')return !!codeAt(snapshot.text,snapshot.selection.head);
  if(id==='paragraph.taskState')return /^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]/.test(lineAt(snapshot.text,snapshot.selection.head).text);
  return true;
}
/** Returns false for an unsupported or inapplicable command. Clipboard/dialog actions are handled by the view. */
export function executeTextCommand(store:DocumentStore,id:string,settings:SettingsSnapshot,argument?:unknown):boolean {
  if(!canExecuteEditorCommand(store,id))return false;
  const snapshot=store.getSnapshot(),{text,selection}=snapshot;
  if(id==='edit.undo'){store.undo();return true;}if(id==='edit.redo'){store.redo();return true;}
  if(id.startsWith('selection.')){
    const kind=id.slice(10);let range=selection;
    if(kind==='all')range={anchor:0,head:text.length};
    else if(['block','lineOrSentence','formatted','word'].includes(kind))range=semanticRange(text,selection,kind as 'block'|'lineOrSentence'|'formatted'|'word');
    else if(kind==='documentStart')range={anchor:0,head:0};else if(kind==='documentEnd')range={anchor:text.length,head:text.length};
    else if(kind==='lineStart'||kind==='lineEnd'){const line=lineAt(text,selection.head),at=kind==='lineStart'?line.from:line.to;range={anchor:at,head:at};}
    store.setSelection(range);return true;
  }
  let plan:EditPlan|null=null;
  if(id.startsWith('format.')) {const kind=id.slice(7);if(kind==='clear')plan=clearInline(text,selection);else if(kind==='link'||kind==='linkActions'){if(!argument)return false;plan=linkPlan(text,selection,argument as Parameters<typeof linkPlan>[2]);}else plan=toggleInline(text,selection,kind);}
  else if(id.startsWith('paragraph.'))plan=paragraphPlan(text,selection,id.slice(10),settings);
  else if(id.startsWith('table.'))plan=tablePlan(text,selection,id.slice(6),argument);
  else if(id.startsWith('code.'))plan=codePlan(text,selection,id.slice(5),settings,argument);
  else if(id==='math.create')plan=codePlan(text,selection,'math',settings);
  else if(id.startsWith('alert.'))plan=alertPlan(text,selection,id.slice(6));
  else if(id==='text.LF'||id==='text.CRLF')plan=lineEndingPlan(text,selection,id==='text.LF'?'LF':'CRLF');
  else if(id==='range.moveLineUp'||id==='range.moveLineDown')plan=moveLinePlan(text,selection,id==='range.moveLineUp'?-1:1);
  else if(id.startsWith('range.delete')){const kind=id.slice(12),map:Record<string,'block'|'lineOrSentence'|'formatted'|'word'>={Block:'block',LineOrSentence:'lineOrSentence',Formatted:'formatted',Word:'word'};plan=deletionPlan(text,selection,map[kind]);}
  else if(id.startsWith('image.'))plan=imagePlan(text,selection,id.slice(6),argument);
  if(!plan)return false;return commitPlan(store,plan);
}
export function clipboardRange(store:DocumentStore,settings:SettingsSnapshot):{from:number;to:number;text:string}|null {
  const {text,selection}=store.getSnapshot();let {from,to}=orderedSelection(selection);if(from===to){if(!settings['editor.copyWholeLine'])return null;const line=lineAt(text,selection.head);from=line.from;to=line.end;}return {from,to,text:text.slice(from,to)};
}
const escapeHtml=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function imagePlan(text:string,selection:{anchor:number;head:number},kind:string,argument?:unknown):EditPlan|null {
  if(kind==='insert'){const options=typeof argument==='string'?{url:argument}:argument as {url?:string;alt?:string}|undefined;if(!options?.url)return null;const {from,to}=orderedSelection(selection),insert=`![${(options.alt??'').replace(/\]/g,'\\]')}](${options.url.replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]/g,'')})`;return {changes:[{from,to,insert}],selection:{anchor:from+insert.length,head:from+insert.length}};}
  const range=formattedRange(text,selection.head);let from=range?.name==='Image'?range.from:-1,to=range?.name==='Image'?range.to:-1;let url='',alt='';
  if(from>=0){const match=/^!\[([\s\S]*?)\]\(<?(.*?)(?:>)?(?:\s+".*?")?\)$/.exec(text.slice(from,to));if(!match)return null;alt=match[1];url=match[2].replace(/\\([()])/g,'$1');}
  else for(const match of text.matchAll(/<img\b[^>]*>/gi))if(selection.head>=match.index!&&selection.head<=match.index!+match[0].length){from=match.index!;to=from+match[0].length;url=/\bsrc\s*=\s*["']([^"']*)["']/i.exec(match[0])?.[1]??'';alt=/\balt\s*=\s*["']([^"']*)["']/i.exec(match[0])?.[1]??'';break;}
  if(from<0)return null;
  let insert='';
  if(kind==='convertSyntax'&&(argument==='markdown'||text.slice(from,to).startsWith('<img')))insert=`![${alt}](${url.replace(/\(/g,'\\(').replace(/\)/g,'\\)')})`;
  else if(kind==='convertSyntax')insert=`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`;
  else if(kind==='scale'){const options=typeof argument==='number'?{width:argument}:argument as {width?:number;height?:number}|undefined;if(!options)return null;const size=(name:'width'|'height')=>options[name]&&Number.isFinite(options[name])&&options[name]!>0?` ${name}="${Math.round(options[name]!)}"`:'';insert=`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${size('width')}${size('height')} />`;}
  else return null;
  return {changes:[{from,to,insert}],selection:{anchor:from,head:from+insert.length}};
}
export function simpleMarkdownText(source:string):string {
  return source.replace(/```[^\r\n]*\r?\n([\s\S]*?)\r?\n```/g,'$1').replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^ {0,3}#{1,6}\s+/gm,'').replace(/^\s*>\s?/gm,'').replace(/\*\*([^*]+)\*\*|__([^_]+)__/g,(_,first,second)=>first??second).replace(/\*([^*]+)\*|_([^_]+)_/g,(_,first,second)=>first??second).replace(/~~([^~]+)~~|==([^=]+)==|`([^`]+)`/g,(_,first,second,third)=>first??second??third).replace(/<\/?u>/g,'');
}
export function selectedCodeOrTable(store:DocumentStore,kind:'code'|'table'):string|null {const {text,selection}=store.getSnapshot();if(kind==='code'){const code=codeAt(text,selection.head);return code?text.slice(code.contentFrom,code.contentTo).replace(/(?:\r\n|\n|\r)$/,''):null;}const table=tableAt(text,selection.head);return table?text.slice(table.from,table.to):null;}
export function previewTextAfterCommand(store:DocumentStore,plan:EditPlan){return applyPlan(store.getSnapshot().text,plan);}
