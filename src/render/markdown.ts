import MarkdownIt from 'markdown-it';
import {numberedHighlightedCode} from './code-lines';
import {prepareMarkdownSource} from './syntax-compat';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import katex from 'katex';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import { full as emoji } from 'markdown-it-emoji';
import { parse as parseYaml } from 'yaml';
import type { SettingsSnapshot } from '../shared/settings';
import {sourceLines,splitTableCells} from '../core/formatting';
import {renderLegacyDiagram} from './legacy-diagrams';

export interface RenderContext { path?: string | null; equationOffset?:number }
const equationPositionsCache=new Map<string,number[]>();
/** Original UTF-16 block starts; projection changes preserve line count. */
export function displayEquationPositions(text:string,settings:SettingsSnapshot):number[]{
  const key=JSON.stringify([text,settings['math.latexDelimiters'],settings['math.fenced'],settings['markdown.strict'],settings['markdown.unicodePunctuation']]);const cached=equationPositionsCache.get(key);if(cached)return cached;
  const lines=sourceLines(text),md=new MarkdownIt({html:true});mathPlugin(md,settings);
  let source=prepareMarkdownSource(text,settings).replace(/\r\n|\r/g,'\n');source=source.replace(/^---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/,value=>value.replace(/[^\n]/g,' '));
  const positions=md.parse(source,{}).filter(token=>token.type==='opentypora_math_block'||token.type==='fence'&&settings['math.fenced']&&/^(math|latex)(?:\s|$)/i.test(token.info)).map(token=>lines[token.map?.[0]??0]?.from??0);
  if(equationPositionsCache.size>=2)equationPositionsCache.delete(equationPositionsCache.keys().next().value!);equationPositionsCache.set(key,positions);return positions;
}
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function assetUrl(url: string, path?: string | null) {
  if (/^(?:https?:|data:image\/(?:png|jpeg|gif|webp|svg\+xml);|opentypora-asset:)/i.test(url)) return url;
  if(/^file:/i.test(url)){try{const parsed=new URL(url);url=decodeURIComponent(parsed.pathname);if(/^\/[a-z]:/i.test(url))url=url.slice(1);if(parsed.hostname&&parsed.hostname!=='localhost')url=`//${parsed.hostname}${url}`;}catch{return '';}}
  else {try{url=decodeURIComponent(url);}catch{}}
  if (!path && !/^[a-z]:[\\/]/i.test(url) && !url.startsWith('/')) return url;
  const absolute = /^[a-z]:[\\/]/i.test(url) || url.startsWith('/') ? url : `${path!.replace(/[\\/][^\\/]*$/, '')}/${url}`;
  const parts: string[] = []; for(const part of absolute.replace(/\\/g,'/').split('/')) { if(part==='..') parts.pop(); else if(part!=='.') parts.push(part); }
  return `opentypora-asset://local/${encodeURIComponent(parts.join('/'))}`;
}
function equation(source: string, display: boolean, settings: SettingsSnapshot,index=0) {
  if(display&&settings['math.newline']&&/(?:\\\\|\\newline\b)/.test(source)&&!/(?:\\begin\{|\\displaylines\{)/.test(source))source=`\\displaylines{${source}}`;
  if(settings['math.htmlRepresentation']==='source') return `<code class="math-source">${escapeHtml(source)}</code>`;
  try { const html=katex.renderToString(source, {displayMode:display,throwOnError:false,strict:'ignore',trust:false,output:settings['math.htmlRepresentation']==='mathml'?'mathml':'htmlAndMathml',macros:settings['math.physics']?{'\\ket':'\\left|#1\\right\\rangle','\\bra':'\\left\\langle#1\\right|','\\abs':'\\left|#1\\right|','\\norm':'\\left\\|#1\\right\\|','\\qty':'\\left(#1\\right)'}:undefined});return settings['math.htmlRepresentation']==='svg'?`<span class="math-svg" data-math="${escapeHtml(encodeURIComponent(source))}" data-display="${display}" data-equation-index="${index}">${html}</span>`:html; }
  catch(error) { return `<code class="render-error">${escapeHtml(String(error))}</code>`; }
}
function mathPlugin(md: InstanceType<typeof MarkdownIt>, settings: SettingsSnapshot,equationOffset=0) {
  md.inline.ruler.before('escape','opentypora_math',(state,silent)=>{
    const rest=state.src.slice(state.pos); let opener='',closer='';
    if(settings['markdown.inlineMath'] && rest.startsWith('$') && !rest.startsWith('$$')) { opener='$';closer='$'; }
    else if(settings['math.latexDelimiters'] && (rest.startsWith('\\(')||rest.startsWith('\\['))) {opener=rest.slice(0,2);closer=opener==='\\('?'\\)':'\\]';}
    if(!opener)return false;
    let end=state.src.indexOf(closer,state.pos+opener.length); while(end>0&&state.src[end-1]==='\\')end=state.src.indexOf(closer,end+closer.length);
    if(end<0)return false; const content=state.src.slice(state.pos+opener.length,end);if(!content.trim()||content.includes('\n')||(opener==='$'&&(content.trim()!==content||/\d/.test(state.src[end+1]??''))))return false;
    if(!silent){const token=state.push('opentypora_math','math',0);token.content=content;}
    state.pos=end+closer.length;return true;
  });
  md.renderer.rules.opentypora_math=(tokens,index)=>equation(tokens[index].content,false,settings);
  md.block.ruler.before('fence','opentypora_math_block',(state,start,end,silent)=>{
    const line=state.src.slice(state.bMarks[start]+state.tShift[start],state.eMarks[start]);
    const opener=line.startsWith('$$')?'$$':settings['math.latexDelimiters']&&line.startsWith('\\[')?'\\[':'';
    if(!opener)return false;const closer=opener==='$$'?'$$':'\\]';let content=line.slice(opener.length),last=start;
    if(content.trimEnd().endsWith(closer))content=content.trimEnd().slice(0,-closer.length);
    else {let found=false;for(let next=start+1;next<end;next++){const row=state.src.slice(state.bMarks[next]+state.tShift[next],state.eMarks[next]);const index=row.indexOf(closer);if(index>=0){content+=`\n${row.slice(0,index)}`;last=next;found=true;break;}content+=`\n${row}`;}if(!found)return false;}
    if(silent)return true;const token=state.push('opentypora_math_block','math',0);token.content=content;token.map=[start,last+1];token.block=true;state.line=last+1;return true;
  });
  md.renderer.rules.opentypora_math_block=(tokens,index)=>`<div class="math-block">${equation(tokens[index].content,true,settings,Number(tokens[index].meta?.equationIndex)||++equationOffset)}</div>\n`;
}
export function renderMarkdown(text: string, settings: SettingsSnapshot, context: RenderContext = {}): string {
  let imagePath=context.path;
  const rawYaml=text.replace(/\r\n/g,'\n').match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)\n?/);if(rawYaml){try{const metadata=parseYaml(rawYaml[1]);if(metadata&&typeof metadata==='object'&&typeof metadata['typora-root-url']==='string'){const resolved=assetUrl(`${metadata['typora-root-url'].replace(/[\\/]$/,'')}/.opentypora.md`,context.path);if(resolved.startsWith('opentypora-asset://local/'))imagePath=decodeURIComponent(resolved.slice('opentypora-asset://local/'.length));}}catch{}}
  const md=new MarkdownIt({html:true,linkify:settings['markdown.autoLink'],breaks:settings['text.preserveBreaks'],typographer:settings['markdown.smartMode']==='render' && (settings['markdown.smartQuotes']||settings['markdown.smartDashes'])});
  md.renderer.rules.softbreak=()=>settings['text.preserveBreaks']?'<br>':' ';md.renderer.rules.hardbreak=()=>'<br>';
  md.disable('replacements');if(!settings['markdown.smartQuotes'])md.disable('smartquotes');
  if(settings['markdown.smartMode']==='render'&&settings['markdown.smartDashes'])md.core.ruler.after('inline','opentypora_smart_dashes',state=>{for(const token of state.tokens)for(const child of token.children??[])if(child.type==='text')child.content=child.content.replace(/---/g,'—').replace(/--/g,'–').replace(/\.\.\./g,'…');});
  const validateLink=md.validateLink.bind(md);md.validateLink=value=>/^file:/i.test(value)||validateLink(value);
  md.use(footnote).use(taskLists,{enabled:true,label:true}).use(emoji);
  md.core.ruler.after('block','opentypora_table_literals',state=>{const lines=sourceLines(state.src);let rows:string[][]|null=null,row=-1,column=0;for(const token of state.tokens){if(token.type==='table_open'&&token.map){rows=lines.slice(token.map[0],token.map[1]).filter((_,index)=>index!==1).map(line=>splitTableCells(line.text));row=-1;}else if(token.type==='table_close')rows=null;else if(rows&&token.type==='tr_open'){row++;column=0;}else if(rows&&token.type==='inline'){const raw=rows[row]?.[column++];if(raw&&/`[^`]*\\\|[^`]*`/.test(raw))token.content=raw;}}});
  if(settings['markdown.highlight'])md.use(mark);if(settings['markdown.sub'])md.use(sub);if(settings['markdown.sup'])md.use(sup);
  mathPlugin(md,settings,context.equationOffset??0);let fencedEquation=context.equationOffset??0;
  md.core.ruler.after('block','opentypora_equation_indices',state=>{let index=context.equationOffset??0;for(const token of state.tokens){if(token.type==='opentypora_math_block'||token.type==='fence'&&settings['math.fenced']&&/^(math|latex)(?:\s|$)/i.test(token.info)){token.meta={...(token.meta??{}),equationIndex:++index};}}});
  const headings: {id:string;text:string;level:number}[]=[];const slugs=new Map<string,number>();
  md.renderer.rules.heading_open=(tokens,index)=>{const title=tokens[index+1]?.content??'';const slug=title.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-|-$/g,'')||'heading';const count=slugs.get(slug)??0;slugs.set(slug,count+1);const id=count?`${slug}-${count}`:slug;headings.push({id,text:title,level:Number(tokens[index].tag.slice(1))});return `<${tokens[index].tag} id="${escapeHtml(id)}">`;};
  md.renderer.rules.image=(tokens,index,options,env,self)=>{const token=tokens[index];token.attrSet('src',assetUrl(String(token.attrGet('src')??''),imagePath));token.attrSet('loading','lazy');token.attrSet('alt',token.content);return self.renderToken(tokens,index,options);};
  md.renderer.rules.fence=(tokens,index)=>{const token=tokens[index],language=token.info.trim().split(/\s+/)[0].toLowerCase();
    if(settings['markdown.diagrams']&&['mermaid','sequence','flow'].includes(language))return `<div class="diagram" data-diagram="${language}" data-source="${escapeHtml(encodeURIComponent(token.content))}"><pre>${escapeHtml(token.content)}</pre></div>`;
    if(settings['math.fenced']&&['math','latex'].includes(language))return `<div class="math-block">${equation(token.content,true,settings,Number(token.meta?.equationIndex)||++fencedEquation)}</div>`;
    const value=language&&hljs.getLanguage(language)?hljs.highlight(token.content,{language,ignoreIllegals:true}).value:escapeHtml(token.content);
    const numbered=settings['code.lineNumbers']?numberedHighlightedCode(value):value;
    return `<pre class="code-block${settings['code.wrap']?' code-wrap':''}"><code class="language-${escapeHtml(language)}">${numbered}</code></pre>`;
  };
  if(settings['markdown.alerts'])md.core.ruler.after('inline','opentypora_alerts',state=>{for(let i=0;i<state.tokens.length;i++){const token=state.tokens[i];if(token.type!=='blockquote_open')continue;const inline=state.tokens[i+2];const match=inline?.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/i);if(!match)continue;token.attrSet('class',`markdown-alert markdown-alert-${match[1].toLowerCase()}`);inline.content=inline.content.slice(match[0].length);const kind=match[1].toLowerCase(),title=kind[0].toUpperCase()+kind.slice(1),icons:Record<string,string>={note:'<circle cx=\"8\" cy=\"8\" r=\"6\" fill=\"none\" stroke=\"currentColor\"/><path d=\"M7 7h2v5H7zM7 4h2v2H7z\"/>',tip:'<path d=\"M5 11h6v2H5zM6 14h4v1H6z\"/><path d=\"M5 10C0 4 5 0 8 1c3-1 8 3 3 9\" fill=\"none\" stroke=\"currentColor\"/>',important:'<path d=\"M2 1h12v11H9l-3 3v-3H2z\" fill=\"none\" stroke=\"currentColor\"/><path d=\"M7 3h2v4H7zM7 8h2v2H7z\"/>',warning:'<path d=\"M8 1l7 13H1z\" fill=\"none\" stroke=\"currentColor\"/><path d=\"M7 5h2v4H7zM7 10h2v2H7z\"/>',caution:'<path d=\"M5 1h6l4 4v6l-4 4H5l-4-4V5z\" fill=\"none\" stroke=\"currentColor\"/><path d=\"M7 4h2v5H7zM7 10h2v2H7z\"/>'};const label=md.parseInline(title,state.env)[0].children![0];label.type="html_inline";label.content=`<span class="markdown-alert-title"><svg viewBox="0 0 16 16" aria-hidden="true">${icons[kind]}</svg>${title}</span>`;inline.children=[label,...(md.parseInline(inline.content,state.env)[0].children??[])];}});
  let source=text.replace(/\r\n/g,'\n');let frontmatter='';
  const yaml=source.match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)\n?/);if(yaml){try {parseYaml(yaml[1]);frontmatter=`<pre class="frontmatter"><code>${escapeHtml(yaml[1])}</code></pre>`;source=source.slice(yaml[0].length);}catch{}}
  source=source.replace(/^\[toc\]\s*$/gim,'<opentypora-toc></opentypora-toc>');
  source=prepareMarkdownSource(source,settings);
  let html=frontmatter+md.render(source);
  html=html.replace(/<opentypora-toc><\/opentypora-toc>/g,`<nav class="markdown-toc" aria-label="目录">${headings.map(item=>`<a href="#${escapeHtml(item.id)}" data-level="${item.level}" style="margin-left:${(item.level-1)*28}px">${escapeHtml(item.text)}</a>`).join('')}</nav>`);
  const template=document.createElement('template');template.innerHTML=DOMPurify.sanitize(html,{ADD_TAGS:['math','semantics','annotation','mrow','mi','mo','mn','mfrac','msup','msub','msubsup','mover','munder','munderover','msqrt','mroot','mtable','mtr','mtd','mtext','mspace','mpadded','menclose'],ADD_ATTR:['xmlns','encoding','display','mathvariant','stretchy','data-source','data-diagram','data-line','loading'],ALLOW_UNKNOWN_PROTOCOLS:false,ALLOWED_URI_REGEXP:/^(?:(?:https?|mailto|tel|file|opentypora-asset):|data:image\/(?:png|jpeg|gif|webp|svg\+xml);|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i});for(const parent of template.content.querySelectorAll('li,blockquote,ul,ol')){for(const node of Array.from(parent.childNodes))if(node.nodeType===Node.TEXT_NODE&&/^[ \t\r\n]*$/.test(node.textContent??'')&&(node.textContent??'').includes('\n'))node.remove();}for(const image of template.content.querySelectorAll('img[src]'))image.setAttribute('src',assetUrl(image.getAttribute('src')!,imagePath));return template.innerHTML;
}
export function sequenceToMermaid(source: string) {return 'sequenceDiagram\n'+source.split(/\r?\n/).map(line=>{const title=line.match(/^\s*Title:\s*(.*)$/i);if(title)return `title ${title[1]}`;return line.replace(/(\S)\s*(-{1,2}>+)\s*(\S)/g,(_m,a,arrow,b)=>`${a}${arrow.startsWith('--')?'-->>':'->>'}${b}`);}).join('\n');}
export function flowToMermaid(source: string) {
  const nodes=new Map<string,string>();const edges:string[]=[];
  for(const line of source.split(/\r?\n/)){const definition=line.match(/^\s*([\w-]+)=>\s*(start|end|operation|inputoutput|subroutine|condition):\s*(.*)$/);if(definition){const [,id,type,label]=definition,clean=label.split('|')[0].replace(/"/g,"'");nodes.set(id,type==='condition'?`${id}{"${clean}"}`:type==='start'||type==='end'?`${id}(["${clean}"])`:type==='inputoutput'?`${id}[/"${clean}"/]`:`${id}["${clean}"]`);}else if(line.includes('->'))edges.push(line.trim());}
  const result=['flowchart TD',...nodes.values()];for(const edge of edges){const chain=edge.split('->');for(let i=0;i<chain.length-1;i++){const from=chain[i].match(/^([\w-]+)(?:\(([^)]*)\))?/),to=chain[i+1].match(/^([\w-]+)/);if(from&&to)result.push(`${from[1]} -->${from[2]?`|"${from[2].split(',')[0]}"|`:''} ${to[1]}`);}}return result.join('\n');
}
let diagramId=0;
export async function hydrateDiagrams(container: HTMLElement, settings: SettingsSnapshot): Promise<void> {
  const equations=container.querySelectorAll<HTMLElement>('[data-math]:not([data-hydrated="true"])');
  if(equations.length){const {renderMathSvg}=await import('./math');for(const element of equations){if(!container.contains(element))continue;try{element.innerHTML=DOMPurify.sanitize(renderMathSvg(decodeURIComponent(element.dataset.math??''),element.dataset.display==='true',settings['math.physics'],settings['math.numbering'],Number(element.dataset.equationIndex)||1),{USE_PROFILES:{svg:true,svgFilters:true},ADD_ATTR:['xmlns','aria-hidden','focusable','style']});element.dataset.hydrated='true';}catch(error){element.title=String(error);}}}
  if(!settings['markdown.diagrams']||!container.querySelector('[data-diagram]'))return;
  const legacy=container.querySelectorAll<HTMLElement>('[data-diagram]:not([data-hydrated="true"])');
  for(const element of legacy){const kind=element.dataset.diagram;if(kind!=='sequence'&&kind!=='flow')continue;const source=decodeURIComponent(element.dataset.source??'');try{element.innerHTML=DOMPurify.sanitize(renderLegacyDiagram(kind,source),{USE_PROFILES:{svg:true,svgFilters:true},ADD_ATTR:['xmlns','viewBox','width','height','role','aria-label','markerWidth','markerHeight','refX','refY','orient','fill','stroke','stroke-width','stroke-dasharray','text-anchor','font-family','font-size','font-weight','x','x1','x2','y','y1','y2','cx','cy','rx','ry','d']});element.dataset.hydrated='true';}catch(error){element.innerHTML=`<pre class="render-error">${escapeHtml(String(error))}\n${escapeHtml(source)}</pre>`;element.dataset.hydrated='true';}}
  const mermaidElements=container.querySelectorAll<HTMLElement>('[data-diagram="mermaid"]:not([data-hydrated="true"])');if(!mermaidElements.length)return;
  const {default:mermaid}=await import('mermaid');mermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,theme:settings['appearance.theme']==='night'?'dark':'default',fontFamily:'inherit'});
  for(const element of mermaidElements){if(element.dataset.hydrated==='true')continue;const source=decodeURIComponent(element.dataset.source??''),kind=element.dataset.diagram;try{const converted=kind==='sequence'?sequenceToMermaid(source):kind==='flow'?flowToMermaid(source):source;const {svg}=await mermaid.render(`opentypora-diagram-${++diagramId}`,converted);if(!container.contains(element))continue;element.innerHTML=DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},ADD_TAGS:['foreignObject','div','span','p'],ADD_ATTR:['xmlns','style']});element.dataset.hydrated='true';}catch(error){element.innerHTML=`<pre class="render-error">${escapeHtml(String(error))}\n${escapeHtml(source)}</pre>`;}}
}
