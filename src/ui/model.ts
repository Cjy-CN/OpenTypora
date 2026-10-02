import type { DirectoryEntry, SearchMatch, SearchOptions, SelectionRange, TextChange } from '../shared/contracts';

export interface OutlineItem { id: string; title: string; level: number; from: number; to: number; parent: string | null }
export interface SearchResult { matches: SearchMatch[]; error: string | null; truncated: boolean }
const MAX_MATCHES = 20000;
export function displayName(path: string | null) { return path?.split(/[\\/]/).filter(Boolean).at(-1) || '未命名'; }
export function parentDirectory(path: string) { return path.replace(/[\\/][^\\/]*$/, ''); }
export function relativePath(path: string, root: string | null) { return root && path.toLowerCase().startsWith(root.toLowerCase()) ? path.slice(root.length).replace(/^[\\/]/, '') : path; }
export function isMarkdown(path: string) { return /\.(md|markdown|mdown|mkd|mkdn|mdwn|mmd|txt|text|mdtext|mdtxt|rmd|rmarkdown|qmd|apib|mdx)$/i.test(path); }
export function flattenEntries(entries: DirectoryEntry[]): DirectoryEntry[] { return entries.flatMap(entry => entry.directory ? flattenEntries(entry.children ?? []) : [entry]); }
export function sortEntries(entries: DirectoryEntry[]) { return [...entries].sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,'zh-CN',{numeric:true})); }

export function parseOutline(text: string): OutlineItem[] {
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(match => match[0].length);
  const items: OutlineItem[] = []; let fence: {marker:string;length:number}|null=null, yaml=false;
  lines.forEach((match,index)=>{
    const line=match[0].replace(/[\r\n]+$/,''); const from=match.index!;
    if(index===0&&/^---\s*$/.test(line)){yaml=true;return;}
    if(yaml){if(/^(---|\.\.\.)\s*$/.test(line))yaml=false;return;}
    const fenced=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if(fenced){if(!fence)fence={marker:fenced[1][0],length:fenced[1].length};else if(fenced[1][0]===fence.marker&&fenced[1].length>=fence.length)fence=null;return;}
    if(fence)return;
    const atx=/^ {0,3}(#{1,6})(?:[ \t]+(.*?)|\s*)$/.exec(line);
    const next=lines[index+1]?.[0].replace(/[\r\n]+$/,'');
    const setext=!atx&&line.trim()&&next?/^ {0,3}(=+|-+)\s*$/.exec(next):null;
    if(!atx&&!setext)return;
    const level=atx?atx[1].length:(setext![1][0]==='='?1:2);
    const title=(atx?(atx[2]??'').replace(/\s+#+\s*$/,''):line.trim()).replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]+>/g,'').replace(/[*_`~]/g,'').trim();
    const parent=[...items].reverse().find(item=>item.level<level)?.id??null;
    items.push({id:`heading-${from}`,title:title||'无标题',level,from,to:from+line.length,parent});
  });
  return items;
}

function isWord(value: string|undefined){return !!value&&/[\p{L}\p{N}\p{M}_]/u.test(value);}
export function searchDocument(text: string,query: string,options: SearchOptions): SearchResult {
  if(!query)return {matches:[],error:null,truncated:false};
  // Reject obvious exponential-backtracking patterns before running a user expression on the UI thread.
  if(options.regex&&/\([^)]*[+*][^)]*\)[+*{]/.test(query))return {matches:[],error:'此正则包含嵌套重复，可能阻塞编辑。请改写为明确的字符范围。',truncated:false};
  try {
    const regex=new RegExp(options.regex?query:query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),`gu${options.caseSensitive?'':'i'}`);
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
  const regex=options.regex?new RegExp(query,`u${options.caseSensitive?'':'i'}`):null;
  return matches.map(match=>{
    let insert=replacement;
    if(regex){const expression=new RegExp(regex.source,`${regex.flags}g`);expression.lastIndex=match.from;const parts=expression.exec(text);if(parts&&parts.index===match.from)insert=replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g,(token,key:string)=>{if(key==='$')return '$';if(key==='&')return parts[0];if(key==='`')return text.slice(0,match.from);if(key==="'")return text.slice(match.to);if(key.startsWith('<'))return parts.groups?.[key.slice(1,-1)]??'';const group=Number(key);return group>0&&group<parts.length?(parts[group]??''):token;});}
    return {from:match.from,to:match.to,insert};
  });
}

export interface TextStatistics { words:number;characters:number;charactersWithoutSpaces:number;lines:number;minutes:number;selectedWords:number;selectedCharacters:number }
export function countWords(text:string){ const chinese=(text.match(/\p{Script=Han}/gu)??[]).length; const other=text.replace(/\p{Script=Han}/gu,' ');return chinese+(other.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)??[]).length; }
export function graphemeCount(text:string){return [...new Intl.Segmenter('zh-CN',{granularity:'grapheme'}).segment(text)].length;}
export function statistics(text:string,selection:SelectionRange,readingSpeed:number):TextStatistics {
  const words=countWords(text),selected=text.slice(Math.min(selection.anchor,selection.head),Math.max(selection.anchor,selection.head));
  return {words,characters:graphemeCount(text),charactersWithoutSpaces:graphemeCount(text.replace(/\s/g,'')),lines:text.length?text.split(/\r\n|\r|\n/).length:0,minutes:words?Math.max(1,Math.ceil(words/Math.max(1,readingSpeed))):0,selectedWords:countWords(selected),selectedCharacters:graphemeCount(selected)};
}
export function fuzzyFiles(entries:DirectoryEntry[],query:string){ const lower=query.trim().toLocaleLowerCase();return entries.filter(entry=>!entry.directory&&isMarkdown(entry.path)&&(!lower||entry.name.toLocaleLowerCase().includes(lower)||entry.path.toLocaleLowerCase().includes(lower))).sort((a,b)=>Number(b.name.toLocaleLowerCase().startsWith(lower))-Number(a.name.toLocaleLowerCase().startsWith(lower))||a.name.localeCompare(b.name,'zh-CN')).slice(0,100); }
