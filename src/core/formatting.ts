import { markdownLanguage } from '@codemirror/lang-markdown';
import type { SelectionRange, TextChange } from '../shared/contracts';
import type { SettingsSnapshot } from '../shared/settings';

/** Plans use the canonical source, never a rendered serialization. */
export interface EditPlan { changes: TextChange[]; selection: SelectionRange }
export interface SourceLine { from: number; to: number; end: number; text: string; newline: string }
export interface MarkdownBlock { from: number; to: number; kind: 'paragraph' | 'heading' | 'list' | 'quote' | 'table' | 'code' | 'math' | 'yaml' | 'html' | 'hr' | 'toc'; text: string }
export const orderedSelection = (selection: SelectionRange) => ({ from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head) });
export function sourceLines(text: string): SourceLine[] {
  const result: SourceLine[] = []; const expression = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (const match of text.matchAll(expression)) {
    if (match[0] === '' && (match.index !== text.length || text.length > 0 && !/[\r\n]$/.test(text))) continue;
    result.push({ from: match.index!, to: match.index! + match[1].length, end: match.index! + match[0].length, text: match[1], newline: match[2] });
  }
  return result.length ? result : [{ from: 0, to: 0, end: 0, text: '', newline: '' }];
}
export function lineAt(text: string, position: number): SourceLine {
  return sourceLines(text).find(line => position >= line.from && (position < line.end || line.end === text.length)) ?? sourceLines(text).at(-1)!;
}
export function preferredNewline(text: string, defaultEnding = 'LF'): string { return text.match(/\r\n|\n|\r/)?.[0] ?? (defaultEnding === 'CRLF' ? '\r\n' : '\n'); }
function replacement(from: number, to: number, insert: string, selection?: SelectionRange): EditPlan { return { changes: [{ from, to, insert }], selection: selection ?? { anchor: from + insert.length, head: from + insert.length } }; }
export function applyPlan(text: string, plan: EditPlan): string { let result = text; for (const change of [...plan.changes].sort((a,b) => b.from-a.from)) result = result.slice(0, change.from) + change.insert + result.slice(change.to); return result; }
function mapPosition(position: number, changes: TextChange[]): number {
  let difference = 0;
  for (const change of [...changes].sort((a,b) => a.from-b.from)) {
    if (position < change.from) break;
    if (position <= change.to) return change.from + difference + Math.min(position-change.from,change.insert.length);
    difference += change.insert.length - (change.to-change.from);
  }
  return position + difference;
}
function selectedLines(text: string, selection: SelectionRange): SourceLine[] {
  const { from,to } = orderedSelection(selection);
  return sourceLines(text).filter(line => line.from <= to && (line.end > from || from === to && line.to === from) && (line.from < to || from === to));
}
function transformLines(text: string, selection: SelectionRange, transform: (line: string, index: number) => string): EditPlan {
  const lines = selectedLines(text,selection), changes = lines.map((line,index) => ({ from:line.from,to:line.to,insert:transform(line.text,index) })).filter(change => text.slice(change.from,change.to)!==change.insert);
  return { changes, selection:{ anchor:mapPosition(selection.anchor,changes),head:mapPosition(selection.head,changes) } };
}

/** Paragraph blocks retain all raw offsets and exclude intervening blank lines. */
export function markdownBlocks(text: string): MarkdownBlock[] {
  const lines = sourceLines(text), blocks: MarkdownBlock[] = [];
  const push = (start:number,end:number,kind:MarkdownBlock['kind']) => { const from=lines[start].from,to=lines[end].to; blocks.push({from,to,kind,text:text.slice(from,to)}); };
  for(let i=0;i<lines.length;i++) {
    const value=lines[i].text; if(!value.trim()) continue;
    const fence=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value);
    if(fence) { let end=i; const close=new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`); while(end+1<lines.length){end++;if(close.test(lines[end].text))break;} push(i,end,'code');i=end;continue; }
    if(i===0 && /^---\s*$/.test(value)){let end=i+1;while(end<lines.length&&!/^(---|\.\.\.)\s*$/.test(lines[end].text))end++;if(end<lines.length){push(i,end,'yaml');i=end;continue;}}
    if(/^\s*(\$\$|\\\[)\s*$/.test(value)){let end=i+1;const close=value.trim()==='$$'?/^\s*\$\$\s*$/:/^\s*\\\]\s*$/;while(end<lines.length&&!close.test(lines[end].text))end++;if(end<lines.length){push(i,end,'math');i=end;continue;}}
    if(/^\s*\$\$.+\$\$\s*$/.test(value)){push(i,i,'math');continue;}
    if(i+1<lines.length && isTableSeparator(lines[i+1].text) && splitTableCells(value).length>0){let end=i+1;while(end+1<lines.length&&lines[end+1].text.trim()&&lines[end+1].text.includes('|'))end++;push(i,end,'table');i=end;continue;}
    if(/^ {0,3}#{1,6}(?:\s|$)/.test(value)){push(i,i,'heading');continue;}
    if(i+1<lines.length&&/^ {0,3}(?:=+|-+)\s*$/.test(lines[i+1].text)){push(i,i+1,'heading');i++;continue;}
    if(/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(value)){push(i,i,'hr');continue;}
    if(/^\s*\[toc\]\s*$/i.test(value)){push(i,i,'toc');continue;}
    const kind:MarkdownBlock['kind']=/^\s*>/.test(value)?'quote':/^\s*(?:[-+*]|\d+[.)])\s/.test(value)?'list':/^\s*</.test(value)?'html':'paragraph';
    let end=i;
    while(end+1<lines.length&&lines[end+1].text.trim()) {
      const next=lines[end+1].text;
      if(/^ {0,3}(?:#{1,6}\s|`{3,}|~{3,}|\$\$\s*$)/.test(next))break;
      if(kind==='quote'&&!/^\s*>/.test(next))break;
      if(kind==='paragraph'&&/^\s*(?:>|[-+*]\s|\d+[.)]\s)/.test(next))break;
      if(kind==='list'&&!/^\s*(?:[-+*]\s|\d+[.)]\s| {2,}|\t)/.test(next))break;
      end++;
    }
    push(i,end,kind);i=end;
  }
  return blocks;
}
export function blockAt(text:string,position:number):MarkdownBlock {
  return markdownBlocks(text).find(block=>position>=block.from&&position<=block.to)??{from:lineAt(text,position).from,to:lineAt(text,position).to,kind:'paragraph',text:lineAt(text,position).text};
}
export function semanticRange(text:string,selection:SelectionRange,kind:'block'|'lineOrSentence'|'formatted'|'word'):SelectionRange {
  const position=selection.head;
  if(kind==='block'){const block=blockAt(text,position);return {anchor:block.from,head:block.to};}
  if(kind==='lineOrSentence'){const line=lineAt(text,position);return {anchor:line.from,head:line.to};}
  if(kind==='formatted'){const range=formattedRange(text,position);return range?{anchor:range.from,head:range.to}:semanticRange(text,selection,'word');}
  const segmenter=new Intl.Segmenter(undefined,{granularity:'word'});
  for(const segment of segmenter.segment(text))if(position>=segment.index&&position<segment.index+segment.segment.length&&segment.isWordLike)return {anchor:segment.index,head:segment.index+segment.segment.length};
  // A caret immediately after a word selects that word, including surrogate pairs.
  for(const segment of segmenter.segment(text))if(position===segment.index+segment.segment.length&&segment.isWordLike)return {anchor:segment.index,head:position};
  const characters=[...text.slice(position)];return {anchor:position,head:Math.min(text.length,position+(characters[0]?.length??0))};
}
const FORMATTED_NODES=new Set(['StrongEmphasis','Emphasis','InlineCode','Strikethrough','Link','Image','Subscript','Superscript']);
export function formattedRange(text:string,position:number):{from:number;to:number;name:string}|null {
  const tree=markdownLanguage.parser.parse(text); let node=tree.resolveInner(position,-1);
  while(node){if(FORMATTED_NODES.has(node.name))return {from:node.from,to:node.to,name:node.name};if(!node.parent)break;node=node.parent;}
  const patterns=[/<u>([\s\S]*?)<\/u>/gi,/==([^\n]*?)==/g,/<!--([\s\S]*?)-->/g];
  for(const pattern of patterns)for(const match of text.matchAll(pattern))if(position>=match.index!&&position<=match.index!+match[0].length)return {from:match.index!,to:match.index!+match[0].length,name:'Extension'};
  return null;
}
const INLINE_MARKERS:Record<string,[string,string]>={bold:['**','**'],italic:['*','*'],underline:['<u>','</u>'],strike:['~~','~~'],comment:['<!-- ',' -->'],highlight:['==','=='],sub:['~','~'],sup:['^','^']};
export function toggleInline(text:string,selection:SelectionRange,style:string):EditPlan|null {
  let {from,to}=orderedSelection(selection);let content=text.slice(from,to);
  let markers=INLINE_MARKERS[style];
  if(style==='code'){
    const existing=formattedRange(text,from);
    if(existing?.name==='InlineCode'&&existing.from<=from&&existing.to>=to){const source=text.slice(existing.from,existing.to),tick=source.match(/^`+/)![0];const inside=source.slice(tick.length,-tick.length);return replacement(existing.from,existing.to,inside,{anchor:existing.from,head:existing.from+inside.length});}
    const longest=Math.max(0,...(content.match(/`+/g)??[]).map(value=>value.length));const ticks='`'.repeat(longest+1);const padding=content.startsWith('`')||content.endsWith('`')?' ':'';markers=[ticks+padding,padding+ticks];
  }
  if(!markers)return null;
  const [open,close]=markers;
  if(content.startsWith(open)&&content.endsWith(close)&&content.length>=open.length+close.length){const inside=content.slice(open.length,-close.length);return replacement(from,to,inside,{anchor:from,head:from+inside.length});}
  if(text.slice(Math.max(0,from-open.length),from)===open&&text.slice(to,to+close.length)===close){return replacement(from-open.length,to+close.length,content,{anchor:from-open.length,head:from-open.length+content.length});}
  if(from===to){const range=formattedRange(text,from);const expected:Record<string,string>={bold:'StrongEmphasis',italic:'Emphasis',strike:'Strikethrough',sub:'Subscript',sup:'Superscript'};if(range&&(range.name===expected[style]||text.slice(range.from,range.from+open.length)===open)){const source=text.slice(range.from,range.to);return replacement(range.from,range.to,source.slice(open.length,-close.length),{anchor:Math.max(range.from,from-open.length),head:Math.max(range.from,from-open.length)});}}
  return replacement(from,to,open+content+close,{anchor:from+open.length,head:from+open.length+content.length});
}
export function clearInline(text:string,selection:SelectionRange):EditPlan {
  let {from,to}=orderedSelection(selection);if(from===to){const range=formattedRange(text,from);if(range){from=range.from;to=range.to;}else {const block=blockAt(text,from);from=block.from;to=block.to;}}
  const content=text.slice(from,to),tree=markdownLanguage.parser.parse(content),removals:TextChange[]=[];
  tree.iterate({enter(node){if(['EmphasisMark','StrikethroughMark','SubscriptMark','SuperscriptMark'].includes(node.name))removals.push({from:node.from,to:node.to,insert:''});if(node.name==='InlineCode'||node.name==='FencedCode'||node.name==='CodeBlock')return false;}});
  for(const match of content.matchAll(/<\/?u>|==(?=[\s\S])/gi))if(!removals.some(change=>match.index!>=change.from&&match.index!<change.to))removals.push({from:match.index!,to:match.index!+match[0].length,insert:''});
  const cleaned=applyPlan(content,{changes:removals,selection:{anchor:0,head:0}});return replacement(from,to,cleaned,{anchor:from,head:from+cleaned.length});
}
export function paragraphPlan(text:string,selection:SelectionRange,command:string,settings:SettingsSnapshot):EditPlan|null {
  const newline=preferredNewline(text,settings['editor.lineEnding']);
  if(command==='insertBefore'||command==='insertAfter'){const block=blockAt(text,selection.head),at=command==='insertBefore'?block.from:block.to;const value=command==='insertBefore'?newline+newline:newline+newline;return replacement(at,at,value,{anchor:at+(command==='insertBefore'?0:value.length),head:at+(command==='insertBefore'?0:value.length)});}
  if(['hr','toc'].includes(command)){const value=command==='hr'?'---':'[TOC]';const {from,to}=orderedSelection(selection);const before=from===0?'':newline+newline;const after=to===text.length?'':newline+newline;return replacement(from,to,before+value+after);}
  if(command==='yaml'){if(text.startsWith('---'+newline))return {changes:[],selection:{anchor:newline.length+3,head:newline.length+3}};const value=`---${newline}title: ${newline}---${newline}${newline}`;return replacement(0,0,value,{anchor:3+newline.length+7,head:3+newline.length+7});}
  if(command==='reference'||command==='footnote'){
    const {from,to}=orderedSelection(selection);let number=1;const prefix=command==='footnote'?'^':'';while(text.includes(`[${prefix}${number}]`))number++;
    const label=text.slice(from,to)||'文本',inline=command==='footnote'?`${label}[^${number}]`:`[${label}][${number}]`,definition=`${newline}${newline}[${prefix}${number}]: ${command==='footnote'?'脚注内容':'https://'}`;
    if(to===text.length)return replacement(from,to,inline+definition,{anchor:from+inline.length,head:from+inline.length});
    return {changes:[{from,to,insert:inline},{from:text.length,to:text.length,insert:definition}],selection:{anchor:from+inline.length,head:from+inline.length}};
  }
  if(command==='indent'||command==='outdent'){const indent=' '.repeat(settings['editor.indent']);return transformLines(text,selection,line=>command==='indent'?indent+line:line.startsWith('\t')?line.slice(1):line.replace(new RegExp(`^ {1,${indent.length}}`),'') );}
  if(command==='taskState')return transformLines(text,selection,line=>line.replace(/^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]/,(_,prefix,state)=>`${prefix}[${state===' '?'x':' '}]`));
  if(command==='promote'||command==='demote')return transformLines(text,selection,line=>{const match=/^( {0,3})(#{1,6})\s+(.*)$/.exec(line);if(!match)return command==='demote'?`# ${line}`:line;const level=match[2].length+(command==='promote'?-1:1);return level<1?match[1]+match[3]:match[1]+'#'.repeat(Math.min(level,6))+' '+match[3];});
  const heading=/^heading([1-6])$/.exec(command);
  if(heading||command==='plain') {
    const lines=selectedLines(text,selection),changes:TextChange[]=[];
    lines.forEach((line,index)=>{if(/^ {0,3}(?:=+|-+)\s*$/.test(line.text)&&index>0)return;const value=line.text.replace(/^ {0,3}#{1,6}\s+/,'').replace(/^\s*>\s?/,'').replace(/^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/,'$1');let insert=heading?'#'.repeat(Number(heading[1]))+' '+value:value;const next=sourceLines(text).find(candidate=>candidate.from===line.end);let to=line.to;if(next&&/^ {0,3}(?:=+|-+)\s*$/.test(next.text)){to=next.to;}
      if(heading&&settings['markdown.headingStyle']==='setext'&&Number(heading[1])<3)insert=value+newline+(heading[1]==='1'?'=':'-').repeat(Math.max(3,value.length));changes.push({from:line.from,to,insert});});
    const unique=changes.filter((change,index)=>!changes.slice(0,index).some(previous=>change.from<previous.to));return {changes:unique,selection:{anchor:mapPosition(selection.anchor,unique),head:mapPosition(selection.head,unique)}};
  }
  const selected=selectedLines(text,selection),active=command==='quote'?selected.every(line=>/^\s*>/.test(line.text)):command==='unordered'?selected.every(line=>/^\s*[-+*]\s+(?!\[[ xX]\])/.test(line.text)):command==='ordered'?selected.every(line=>/^\s*\d+[.)]\s/.test(line.text)):command==='task'?selected.every(line=>/^\s*[-+*]\s+\[[ xX]\]/.test(line.text)):false;
  if(command==='quote')return transformLines(text,selection,line=>active?line.replace(/^(\s*)>\s?/,'$1'):`> ${line}`);
  if(['ordered','unordered','task'].includes(command))return transformLines(text,selection,(line,index)=>{const body=line.replace(/^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/,'$1');if(active)return body;const indentation=body.match(/^\s*/)![0],content=body.slice(indentation.length),marker=command==='ordered'?`${settings['markdown.orderedMarker']==='one'?1:index+1}.`:settings['markdown.unorderedMarker'];return `${indentation}${marker} ${command==='task'?'[ ] ':''}${content}`;});
  return null;
}

export interface TableModel { from:number;to:number;lines:SourceLine[];rows:string[][];alignments:string[];row:number;column:number;newline:string }
export function splitTableCells(value:string):string[] {
  let content=value.trim();if(content.startsWith('|'))content=content.slice(1);if(content.endsWith('|')&&!content.endsWith('\\|'))content=content.slice(0,-1);
  const cells:string[]=[];let current='',ticks=0;
  for(let index=0;index<content.length;index++) {
    const char=content[index];if(char==='\\'&&index+1<content.length){current+=char+content[++index];continue;}
    if(char==='`'){let end=index+1;while(content[end]==='`')end++;const count=end-index;if(!ticks)ticks=count;else if(ticks===count)ticks=0;current+=content.slice(index,end);index=end-1;continue;}
    if(char==='|'&&!ticks){cells.push(current.trim());current='';}else current+=char;
  }
  cells.push(current.trim());return cells;
}
export function isTableSeparator(value:string):boolean { const cells=splitTableCells(value);return cells.length>0&&cells.every(cell=>/^:?-{3,}:?$/.test(cell)); }
export function tableAt(text:string,position:number):TableModel|null {
  const block=markdownBlocks(text).find(item=>item.kind==='table'&&position>=item.from&&position<=item.to);if(!block)return null;
  const lines=sourceLines(text).filter(line=>line.from>=block.from&&line.to<=block.to),rows=lines.filter((_,index)=>index!==1).map(line=>splitTableCells(line.text));
  const columns=Math.max(...rows.map(row=>row.length),splitTableCells(lines[1].text).length);rows.forEach(row=>{while(row.length<columns)row.push('');});const alignments=splitTableCells(lines[1].text);while(alignments.length<columns)alignments.push('---');
  let row=Math.max(0,lines.findIndex(line=>position>=line.from&&position<=line.to));if(row>1)row--;else if(row===1)row=0;
  const raw=lines[row===0?0:row+1],prefix=raw.text.slice(0,Math.max(0,position-raw.from));let column=0,ticks=0;const start=prefix.trimStart().startsWith('|')?prefix.indexOf('|')+1:0;
  for(let index=start;index<prefix.length;index++){const char=prefix[index];if(char==='\\'){index++;continue;}if(char==='`'){let end=index+1;while(prefix[end]==='`')end++;const count=end-index;if(!ticks)ticks=count;else if(ticks===count)ticks=0;index=end-1;continue;}if(char==='|'&&!ticks)column++;}column=Math.min(columns-1,column);
  return {from:block.from,to:block.to,lines,rows,alignments,row,column,newline:preferredNewline(block.text)};
}
function serializeTable(rows:string[][],alignments:string[],newline:string):string {
  const widths=alignments.map((_,column)=>Math.max(3,...rows.map(row=>row[column]?.length??0)));
  const row=(cells:string[])=>'| '+cells.map((cell,column)=>(cell??'').padEnd(widths[column],' ')).join(' | ')+' |';
  const separator=alignments.map((alignment,column)=>`${alignment.startsWith(':')?':':''}${'-'.repeat(Math.max(3,widths[column]-(alignment.startsWith(':')?1:0)-(alignment.endsWith(':')?1:0)))}${alignment.endsWith(':')?':':''}`);
  return [row(rows[0]),row(separator),...rows.slice(1).map(row)].join(newline);
}
export function tableCellPosition(source:string,from:number,row:number,column:number):number {
  const lines=sourceLines(source),line=lines[row===0?0:row+1];if(!line)return from+source.length;let current=0,ticks=0,start=line.text.indexOf('|')===0?1:0;
  for(let index=start;index<line.text.length;index++){const char=line.text[index];if(char==='\\'){index++;continue;}if(char==='`'){let end=index+1;while(line.text[end]==='`')end++;const size=end-index;if(!ticks)ticks=size;else if(ticks===size)ticks=0;index=end-1;continue;}if(char==='|'&&!ticks){if(current===column)break;current++;start=index+1;}}
  while(line.text[start]===' ')start++;return from+line.from+start;
}
export function tablePlan(text:string,selection:SelectionRange,command:string,argument?:unknown):EditPlan|null {
  if(command==='create') {const options=(argument??{}) as {rows?:number;columns?:number},rowCount=Math.max(1,Math.min(200,Math.trunc(options.rows??3))),columns=Math.max(1,Math.min(100,Math.trunc(options.columns??3))),rows=Array.from({length:rowCount},(_,row)=>Array.from({length:columns},(_,column)=>row===0?`列 ${column+1}`:'')),value=serializeTable(rows,Array(columns).fill('---'),preferredNewline(text)),{from,to}=orderedSelection(selection);return replacement(from,to,value,{anchor:tableCellPosition(value,from,0,0),head:tableCellPosition(value,from,0,0)});}
  const table=tableAt(text,selection.head);if(!table)return null;const {rows,alignments}=table;let {row,column}=table;
  if(command==='delete')return replacement(table.from,table.to,'',{anchor:table.from,head:table.from});
  if(command==='rowBefore'){rows.splice(row,0,Array(alignments.length).fill(''));}
  else if(command==='rowAfter'){row++;rows.splice(row,0,Array(alignments.length).fill(''));}
  else if(command==='columnBefore'||command==='columnAfter'){if(command==='columnAfter')column++;rows.forEach(cells=>cells.splice(column,0,''));alignments.splice(column,0,'---');}
  else if(command==='moveRowUp'||command==='moveRowDown'){const next=row+(command==='moveRowUp'?-1:1);if(next<0||next>=rows.length)return null;[rows[row],rows[next]]=[rows[next],rows[row]];row=next;}
  else if(command==='moveColumnLeft'||command==='moveColumnRight'){const next=column+(command==='moveColumnLeft'?-1:1);if(next<0||next>=alignments.length)return null;rows.forEach(cells=>{[cells[column],cells[next]]=[cells[next],cells[column]];});[alignments[column],alignments[next]]=[alignments[next],alignments[column]];column=next;}
  else if(command==='deleteRow'){rows.splice(row,1);if(!rows.length)return replacement(table.from,table.to,'');row=Math.min(row,rows.length-1);}
  else if(command==='deleteColumn'){rows.forEach(cells=>cells.splice(column,1));alignments.splice(column,1);if(!alignments.length)return replacement(table.from,table.to,'');column=Math.min(column,alignments.length-1);}
  else if(command==='alignment'){const alignment=typeof argument==='string'?argument:(argument as {alignment?:string})?.alignment??'left';alignments[column]=alignment==='center'?':---:':alignment==='right'?'---:':alignment==='left'?':---':'---';}
  else if(command==='nextCell'||command==='previousCell'){column+=command==='nextCell'?1:-1;if(column<0){if(!row)return null;row--;column=alignments.length-1;}if(column>=alignments.length){column=0;row++;if(row===rows.length)rows.push(Array(alignments.length).fill(''));}}
  else if(command!=='formatSource')return null;
  const value=serializeTable(rows,alignments,table.newline),at=tableCellPosition(value,table.from,row,column);return replacement(table.from,table.to,value,{anchor:at,head:at});
}
export interface CodeBlock { block:MarkdownBlock;language:string;contentFrom:number;contentTo:number;fence:string }
export function codeAt(text:string,position:number):CodeBlock|null {
  const block=blockAt(text,position);if(block.kind!=='code')return null;const lines=sourceLines(block.text),match=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[0].text);if(!match)return null;const last=lines.at(-1)!,closed=new RegExp(`^ {0,3}${match[1][0]}{${match[1].length},}\\s*$`).test(last.text);return {block,language:match[2].trim(),contentFrom:block.from+lines[0].end,contentTo:closed?block.from+last.from:block.to,fence:match[1]};
}
export function codePlan(text:string,selection:SelectionRange,command:string,settings:SettingsSnapshot,argument?:unknown):EditPlan|null {
  const code=codeAt(text,selection.head),newline=preferredNewline(text,settings['editor.lineEnding']);
  if(command==='create'||command==='math') {const {from,to}=orderedSelection(selection),content=text.slice(from,to),fence=command==='math'?'$$':'`'.repeat(Math.max(3,...(content.match(/`+/g)??[]).map(value=>value.length+1))),language=command==='math'?'':settings['code.defaultLanguage'],open=fence+language+newline,close=(content.endsWith(newline)?'':newline)+fence;return replacement(from,to,open+content+close,{anchor:from+open.length,head:from+open.length+content.length});}
  if(!code)return null;
  if(command==='language'){const language=typeof argument==='string'?argument:(argument as {language?:string})?.language;if(language===undefined||/[\r\n`]/.test(language))return null;const line=lineAt(text,code.block.from),insert=code.fence+language;return replacement(line.from,line.to,insert,{anchor:mapPosition(selection.anchor,[{from:line.from,to:line.to,insert}]),head:mapPosition(selection.head,[{from:line.from,to:line.to,insert}])});}
  if(command==='indentBlock'||command==='indentSelection'){const range=command==='indentBlock'?{anchor:code.contentFrom,head:code.contentTo}:selection;const indent=' '.repeat(settings['code.indent']),outdent=(argument as {outdent?:boolean})?.outdent;return transformLines(text,range,line=>outdent?line.replace(new RegExp(`^ {1,${indent.length}}`),''):indent+line);}
  return null;
}
export function moveLinePlan(text:string,selection:SelectionRange,direction:-1|1):EditPlan|null {
  const lines=sourceLines(text),selected=selectedLines(text,selection);if(!selected.length)return null;const first=lines.findIndex(line=>line.from===selected[0].from),last=lines.findIndex(line=>line.from===selected.at(-1)!.from);if(direction<0&&first===0||direction>0&&last===lines.length-1)return null;
  const start=direction<0?first-1:first,end=direction<0?last:last+1,chunk=lines.slice(start,end+1),strings=chunk.map(line=>line.text),newlines=chunk.map(line=>line.newline),moved=direction<0?[...strings.slice(1),strings[0]]:[strings.at(-1)!,...strings.slice(0,-1)],insert=moved.map((value,index)=>value+newlines[index]).join('');
  const delta=direction<0?-(chunk[0].text.length+newlines[0].length):chunk.at(-1)!.text.length+newlines[0].length;
  return replacement(chunk[0].from,chunk.at(-1)!.end,insert,{anchor:selection.anchor+delta,head:selection.head+delta});
}
export function deletionPlan(text:string,selection:SelectionRange,kind?:'block'|'lineOrSentence'|'formatted'|'word'):EditPlan {
  let {from,to}=orderedSelection(kind?semanticRange(text,selection,kind):selection);
  if(!kind&&from===to){const point=[...text.slice(to)][0];to=Math.min(text.length,to+(point?.length??0));}
  if(kind==='lineOrSentence'&&to<text.length){to=lineAt(text,to).end;}if(kind==='block'){const after=text.slice(to).match(/^(?:\r\n|\n|\r){1,2}/);if(after)to+=after[0].length;}
  return replacement(from,to,'',{anchor:from,head:from});
}
export function lineEndingPlan(text:string,selection:SelectionRange,ending:'LF'|'CRLF'):EditPlan {
  const changes:TextChange[]=[];for(const match of text.matchAll(/\r\n|\n|\r/g)){const insert=ending==='LF'?'\n':'\r\n';if(match[0]!==insert)changes.push({from:match.index!,to:match.index!+match[0].length,insert});}return {changes,selection:{anchor:mapPosition(selection.anchor,changes),head:mapPosition(selection.head,changes)}};
}
export function linkPlan(text:string,selection:SelectionRange,argument:{url?:string;label?:string;title?:string;remove?:boolean}):EditPlan {
  let {from,to}=orderedSelection(selection);const range=formattedRange(text,selection.head);let label=argument.label??text.slice(from,to),url=argument.url??'https://';
  if(range?.name==='Link'){from=range.from;to=range.to;const source=text.slice(from,to),match=/^\[([\s\S]*?)\]\(([\s\S]*?)\)$/.exec(source);if(match){label=argument.label??match[1];url=argument.url??match[2];}}
  if(argument.remove)return replacement(from,to,label,{anchor:from,head:from+label.length});const safeUrl=url.replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]/g,''),title=argument.title?` "${argument.title.replace(/"/g,'\\"')}"`:'';return replacement(from,to,`[${label||'链接文字'}](${safeUrl}${title})`,{anchor:from+1,head:from+1+(label||'链接文字').length});
}
export function alertPlan(text:string,selection:SelectionRange,type:string):EditPlan {
  const block=blockAt(text,selection.head),newline=preferredNewline(text);if(block.kind==='quote'&&/^\s*>\s*\[![A-Z]+\]/.test(block.text)){const insert=block.text.replace(/\[![A-Z]+\]/,`[!${type.toUpperCase()}]`);return replacement(block.from,block.to,insert,selection);}
  const {from,to}=orderedSelection(selection),content=text.slice(from,to)||'内容',prefix=`> [!${type.toUpperCase()}]${newline}`,insert=prefix+sourceLines(content).map(line=>'> '+line.text+line.newline).join('');return replacement(from,to,insert,{anchor:from+prefix.length+2,head:from+insert.length});
}
export interface ImageReference { from:number;to:number;urlFrom:number;urlTo:number;url:string;alt:string;syntax:'markdown'|'html'|'reference' }
const decodeAttribute=(value:string)=>value.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
/** Asset operations can update only URL spans in a single Store transaction. */
export function imageReferences(text:string):ImageReference[] {
  const images:ImageReference[]=[],tree=markdownLanguage.parser.parse(text),codeRanges:{from:number;to:number}[]=[];
  tree.iterate({enter(node){if(['FencedCode','CodeBlock','InlineCode'].includes(node.name)){codeRanges.push({from:node.from,to:node.to});return false;}if(node.name!=='Image')return;const syntax=node.node,source=text.slice(node.from,node.to),urlNode=syntax.getChild('URL'),alt=source.match(/^!\[((?:\\.|[^\]])*)\]/)?.[1]??'';
    if(urlNode){let urlFrom=urlNode.from,urlTo=urlNode.to;if(text[urlFrom]==='<'){urlFrom++;urlTo--;}images.push({from:node.from,to:node.to,urlFrom,urlTo,url:text.slice(urlFrom,urlTo).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,'$1'),alt,syntax:'markdown'});}
    else {const reference=source.match(/\]\[([^\]]*)\]$/)?.[1]||alt;for(const definition of text.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]+)>|(\S+))/gm)){if(definition[1].toLowerCase()!==reference.toLowerCase())continue;const url=definition[2]??definition[3],relative=definition[0].indexOf(url),urlFrom=definition.index!+relative;images.push({from:node.from,to:node.to,urlFrom,urlTo:urlFrom+url.length,url,alt,syntax:'reference'});break;}}
  }});
  for(const match of text.matchAll(/<img\b[^>]*>/gi)){const from=match.index!,to=from+match[0].length;if(codeRanges.some(range=>from>=range.from&&from<range.to))continue;const url=/\bsrc\s*=\s*(["'])(.*?)\1/i.exec(match[0]),alt=/\balt\s*=\s*(["'])(.*?)\1/i.exec(match[0]);if(!url)continue;const relative=url.index+url[0].indexOf(url[1])+1,urlFrom=from+relative;images.push({from,to,urlFrom,urlTo:urlFrom+url[2].length,url:decodeAttribute(url[2]),alt:decodeAttribute(alt?.[2]??''),syntax:'html'});}
  return images.sort((a,b)=>a.from-b.from);
}
export function imageAt(text:string,position:number):ImageReference|null {return imageReferences(text).find(image=>position>=image.from&&position<=image.to)??null;}
