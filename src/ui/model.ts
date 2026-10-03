import type { DirectoryEntry, SearchMatch, SearchOptions, SelectionRange, TextChange } from '../shared/contracts';
import {markdownLanguage} from '@codemirror/lang-markdown';
import {sourceLines} from '../core/formatting';

export interface OutlineItem { id: string; title: string; level: number; from: number; to: number; parent: string | null }
export interface SearchResult { matches: SearchMatch[]; error: string | null; truncated: boolean }
const MAX_MATCHES = 20000;
export function displayName(path: string | null) { return path?.split(/[\\/]/).filter(Boolean).at(-1) || '未命名'; }
export function parentDirectory(path: string) { return path.replace(/[\\/][^\\/]*$/, ''); }
export function isWithinRoot(path:string,root:string){const base=root.replace(/[\\/]+$/,'').toLowerCase(),value=path.toLowerCase();return value===base||value.startsWith(base+'\\')||value.startsWith(base+'/');}
export function relativePath(path: string, root: string | null) { return root && isWithinRoot(path,root) ? path.slice(root.replace(/[\\/]+$/,'').length).replace(/^[\\/]/, '') : path; }
export function isMarkdown(path: string) { return /\.(md|markdown|mdown|mkd|mkdn|mdwn|mmd|txt|text|mdtext|mdtxt|rmd|rmarkdown|qmd|apib|mdx)$/i.test(path); }
export function flattenEntries(entries: DirectoryEntry[]): DirectoryEntry[] { return entries.flatMap(entry => entry.directory ? flattenEntries(entry.children ?? []) : [entry]); }
export function sortEntries(entries: DirectoryEntry[]) { return [...entries].sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,'zh-CN',{numeric:true})); }

export interface RecentEntry {path:string;directory:boolean;openedAt?:number}
/** Accept the current service shape and historical installations without guessing folder paths. */
export function recentEntries(value:unknown):RecentEntry[]{
  const groups:Array<{value:unknown;folder:boolean}>=[];
  if(Array.isArray(value))groups.push(...value.map(item=>({value:item,folder:false})));
  else if(value&&typeof value==='object'){
    const history=value as {files?:unknown;folders?:unknown};
    if(Array.isArray(history.files))groups.push(...history.files.map(item=>({value:item,folder:false})));
    if(Array.isArray(history.folders))groups.push(...history.folders.map(item=>({value:item,folder:true})));
  }
  return groups.flatMap(({value:item,folder}):RecentEntry[]=>{
    if(typeof item==='string')return item.trim()?[{path:item,directory:folder}]:[];
    if(!item||typeof item!=='object')return [];
    const entry=item as {path?:unknown;kind?:unknown;directory?:unknown;openedAt?:unknown;modifiedAt?:unknown};
    if(typeof entry.path!=='string'||!entry.path.trim()||entry.kind!==undefined&&!['file','folder'].includes(String(entry.kind)))return [];
    const openedAt=typeof entry.openedAt==='number'?entry.openedAt:typeof entry.modifiedAt==='number'?entry.modifiedAt:undefined;
    return [{path:entry.path,directory:entry.kind==='folder'||(entry.kind===undefined&&(folder||entry.directory===true)),openedAt:openedAt!==undefined&&Number.isFinite(openedAt)?openedAt:undefined}];
  });
}

export function parseOutline(text: string,strict=true): OutlineItem[] {
  const lines=sourceLines(text),protectedRanges:{from:number;to:number}[]=[],containerRanges:{from:number;to:number}[]=[],headings:{from:number;to:number;level:number;title:string}[]=[];
  // Parse the canonical source. A compatibility projection must never supply source offsets.
  markdownLanguage.parser.parse(text).iterate({enter(node){
    if(node.name==='ListItem'||node.name==='Blockquote')containerRanges.push({from:node.from,to:node.to});
    if(['FencedCode','CodeBlock','HTMLBlock'].includes(node.name)){
      let to=node.to;
      if(node.name==='HTMLBlock'&&!/^<(?:script|pre|style|textarea)(?:\s|>|$)|^<!--|^<\?|^<![A-Z]|^<!\[CDATA\[/i.test(text.slice(node.from,node.to))){
        let low=0,high=lines.length;while(low<high){const middle=(low+high)>>>1;if(lines[middle].end<=node.from)low=middle+1;else high=middle;}
        for(let index=low+1;index<lines.length&&lines[index].from<to;index++)if(!lines[index].text.replace(/^ {0,3}(?:> ?)+/,'').trim()){to=lines[index].from;break;}
      }
      protectedRanges.push({from:node.from,to});return false;
    }
    const heading=/^(ATX|Setext)Heading([1-6])$/.exec(node.name);if(!heading)return;
    const raw=text.slice(node.from,node.to).replace(/[\r\n]+$/,''),title=heading[1]==='ATX'?raw.replace(/^#{1,6}[ \t]*/,'').replace(/\s+#+\s*$/,''):raw.replace(/(?:\r\n|\r|\n)[^\r\n]*$/,'');
    headings.push({from:node.from,to:node.from+raw.length,level:Number(heading[2]),title});
  }});
  const overlaps=(from:number,to:number,ranges:{from:number;to:number}[])=>{let low=0,high=ranges.length;while(low<high){const middle=(low+high)>>>1;if(ranges[middle].to<=from)low=middle+1;else high=middle;}return !!ranges[low]&&ranges[low].from<to;};
  const literalRanges=[...protectedRanges];
  for(let index=0;index<lines.length;index++){
    const line=lines[index];if(overlaps(line.from,line.end,literalRanges))continue;
    if(index===0&&/^\uFEFF?---\s*$/.test(line.text)){
      let end=index+1;while(end<lines.length&&!/^(---|\.\.\.)\s*$/.test(lines[end].text))end++;
      protectedRanges.push({from:line.from,to:lines[Math.min(end,lines.length-1)].end});index=end;continue;
    }
    const math=/^ {0,3}(\$\$|\\\[)/.exec(line.text);if(!math)continue;
    const closer=math[1]==='$$'?'$$':'\\]',rest=line.text.slice(math[0].length);let end=index;
    if(!rest.includes(closer)){end++;while(end<lines.length&&!lines[end].text.includes(closer))end++;}
    protectedRanges.push({from:line.from,to:lines[Math.min(end,lines.length-1)].end});index=end;
  }
  const merge=(values:{from:number;to:number}[])=>{const merged:{from:number;to:number}[]=[];for(const range of values.sort((a,b)=>a.from-b.from)){const previous=merged.at(-1);if(previous&&previous.to>=range.from)previous.to=Math.max(previous.to,range.to);else merged.push({...range});}return merged;};
  const ranges=merge(protectedRanges),containers=merge(containerRanges);
  const lineHeadings:typeof headings=[];
  for(const line of lines){
    const regular=/^ {0,3}(#{1,6})(?:[ \t]+(.*?)|\s*)$/.exec(line.text),atx=regular||(!strict?/^ {0,3}(#{1,6})(?=[^#\s])(.*)$/.exec(line.text):null);if(!atx||overlaps(line.from,line.end,ranges))continue;
    const indent=line.text.indexOf('#'),from=line.from+indent;if(!regular&&indent>0&&overlaps(line.from,line.end,containers))continue;
    lineHeadings.push({from,to:line.to,level:atx[1].length,title:(atx[2]??'').replace(/\s+#+\s*$/,'')});
  }
  // A newly recognized ATX heading interrupts a paragraph that was formerly a Setext heading.
  const effectiveHeadings=headings.filter(heading=>!overlaps(heading.from,heading.to,lineHeadings)).concat(lineHeadings);
  const items:OutlineItem[]=[],stack:OutlineItem[]=[];
  for(const heading of effectiveHeadings.sort((a,b)=>a.from-b.from)){
    if(overlaps(heading.from,heading.to,ranges))continue;
    const title=heading.title.replace(/^ {0,3}(?:> ?)+/gm,'').replace(/\r\n|\r|\n/g,' ').replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]+>/g,'').replace(/[*_`~]/g,'').trim();
    while(stack.length&&stack.at(-1)!.level>=heading.level)stack.pop();
    const item:OutlineItem={id:`heading-${heading.from}`,title:title||'无标题',level:heading.level,from:heading.from,to:heading.to,parent:stack.at(-1)?.id??null};items.push(item);stack.push(item);
  }
  return items;
}

function isWord(value: string|undefined){return !!value&&/[\p{L}\p{N}\p{M}_]/u.test(value);}
export function searchDocument(text: string,query: string,options: SearchOptions): SearchResult {
  if(!query)return {matches:[],error:null,truncated:false};
  // Reject obvious exponential-backtracking patterns before running a user expression on the UI thread.
  if(options.regex&&/\([^)]*[+*][^)]*\)[+*{]/.test(query))return {matches:[],error:'此正则包含嵌套重复，可能阻塞编辑。请改写为明确的字符范围。',truncated:false};
  try {
    const regex=new RegExp(options.regex?query:query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),`gmu${options.caseSensitive?'':'i'}`);
    const matches:SearchMatch[]=[]; let match:RegExpExecArray|null;
    while((match=regex.exec(text))){
      const from=match.index,to=from+match[0].length;
      if(!options.wholeWord||(!isWord(text.slice(Math.max(0,from-2),from).match(/.$/u)?.[0])&&!isWord(text.slice(to,to+2).match(/^./u)?.[0])))matches.push({from,to,text:match[0]});
      if(matches.length===MAX_MATCHES)return {matches,error:null,truncated:true};
      if(!match[0].length){const code=text.codePointAt(regex.lastIndex);regex.lastIndex+=code!==undefined&&code>0xffff?2:1;}
    }
    return {matches,error:null,truncated:false};
  } catch(error){return {matches:[],error:`正则无效：${error instanceof Error?error.message:'无法解析表达式'}`,truncated:false};}
}
export function replacementChanges(text:string,query:string,replacement:string,options:SearchOptions,only?:SearchMatch):TextChange[]{
  const result=searchDocument(text,query,options);if(result.error||result.truncated)throw new Error(result.error??'命中数量超过安全上限，请缩小范围后替换。');
  const matches=only?result.matches.filter(match=>match.from===only.from&&match.to===only.to):result.matches;
  const regex=options.regex?new RegExp(query,`mu${options.caseSensitive?'':'i'}`):null;
  return matches.map(match=>{
    let insert=replacement;
    if(regex){const expression=new RegExp(regex.source,`${regex.flags}g`);expression.lastIndex=match.from;const parts=expression.exec(text);if(parts&&parts.index===match.from)insert=replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g,(token,key:string)=>{if(key==='$')return '$';if(key==='&')return parts[0];if(key==='`')return text.slice(0,match.from);if(key==="'")return text.slice(match.to);if(key.startsWith('<'))return parts.groups?(parts.groups[key.slice(1,-1)]??''):token;const group=Number(key);if(group>0&&group<parts.length)return parts[group]??'';if(key.length===2&&Number(key[0])>0&&Number(key[0])<parts.length)return (parts[Number(key[0])]??'')+key[1];return token;});}
    return {from:match.from,to:match.to,insert};
  });
}

export interface TextStatistics { words:number;characters:number;charactersWithoutSpaces:number;lines:number;minutes:number;selectedWords:number;selectedCharacters:number }
export function countWords(text:string){ const chinese=(text.match(/\p{Script=Han}/gu)??[]).length; const other=text.replace(/\p{Script=Han}/gu,' ');return chinese+(other.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)??[]).length; }
export function graphemeCount(text:string){let count=0;for(const _ of new Intl.Segmenter('zh-CN',{granularity:'grapheme'}).segment(text))count++;return count;}
export function statistics(text:string,selection:SelectionRange,readingSpeed:number):TextStatistics {
  const words=countWords(text),selected=text.slice(Math.min(selection.anchor,selection.head),Math.max(selection.anchor,selection.head));
  return {words,characters:graphemeCount(text),charactersWithoutSpaces:graphemeCount(text.replace(/\s/g,'')),lines:text.length?text.split(/\r\n|\r|\n/).length:0,minutes:words?Math.max(1,Math.ceil(words/Math.max(1,readingSpeed))):0,selectedWords:countWords(selected),selectedCharacters:graphemeCount(selected)};
}
export function fuzzyFiles(entries:DirectoryEntry[],query:string){ const lower=query.trim().toLocaleLowerCase();return entries.filter(entry=>!entry.directory&&isMarkdown(entry.path)&&(!lower||entry.name.toLocaleLowerCase().includes(lower)||entry.path.toLocaleLowerCase().includes(lower))).sort((a,b)=>Number(b.name.toLocaleLowerCase().startsWith(lower))-Number(a.name.toLocaleLowerCase().startsWith(lower))||a.name.localeCompare(b.name,'zh-CN')).slice(0,100); }
