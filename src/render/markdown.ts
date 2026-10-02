import MarkdownIt from 'markdown-it';
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

export interface RenderContext { path?: string | null }
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function assetUrl(url: string, path?: string | null) {
  if (/^(?:https?:|data:image\/(?:png|jpeg|gif|webp|svg\+xml);|opentypora-asset:)/i.test(url)) return url;
  if (!path && !/^[a-z]:[\\/]/i.test(url) && !url.startsWith('/')) return url;
  const absolute = /^[a-z]:[\\/]/i.test(url) || url.startsWith('/') ? url : `${path!.replace(/[\\/][^\\/]*$/, '')}/${url}`;
  const parts: string[] = []; for(const part of absolute.replace(/\\/g,'/').split('/')) { if(part==='..') parts.pop(); else if(part!=='.') parts.push(part); }
  return `opentypora-asset://local/${encodeURIComponent(parts.join('/'))}`;
}
function equation(source: string, display: boolean, settings: SettingsSnapshot) {
  if(settings['math.htmlRepresentation']==='source') return `<code class="math-source">${escapeHtml(source)}</code>`;
  try { const html=katex.renderToString(source, {displayMode:display,throwOnError:false,strict:'ignore',trust:false,output:settings['math.htmlRepresentation']==='mathml'?'mathml':'htmlAndMathml',macros:settings['math.physics']?{'\\ket':'\\left|#1\\right\\rangle','\\bra':'\\left\\langle#1\\right|','\\abs':'\\left|#1\\right|','\\norm':'\\left\\|#1\\right\\|','\\qty':'\\left(#1\\right)'}:undefined});return settings['math.htmlRepresentation']==='svg'?`<span class="math-svg" data-math="${escapeHtml(encodeURIComponent(source))}" data-display="${display}">${html}</span>`:html; }
  catch(error) { return `<code class="render-error">${escapeHtml(String(error))}</code>`; }
}
function mathPlugin(md: InstanceType<typeof MarkdownIt>, settings: SettingsSnapshot) {
  md.inline.ruler.before('escape','opentypora_math',(state,silent)=>{
    const rest=state.src.slice(state.pos); let opener='',closer='';
    if(settings['markdown.inlineMath'] && rest.startsWith('$') && !rest.startsWith('$$')) { opener='$';closer='$'; }
    else if(settings['math.latexDelimiters'] && rest.startsWith('\\(')) {opener='\\(';closer='\\)';}
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
  md.renderer.rules.opentypora_math_block=(tokens,index)=>`<div class="math-block">${equation(tokens[index].content,true,settings)}</div>\n`;
}
export function renderMarkdown(text: string, settings: SettingsSnapshot, context: RenderContext = {}): string {
  const md=new MarkdownIt({html:true,linkify:settings['markdown.autoLink'],breaks:settings['text.preserveBreaks'],typographer:settings['markdown.smartMode']==='render' && (settings['markdown.smartQuotes']||settings['markdown.smartDashes'])});
  md.use(footnote).use(taskLists,{enabled:true,label:true}).use(emoji);
  if(settings['markdown.highlight'])md.use(mark);if(settings['markdown.sub'])md.use(sub);if(settings['markdown.sup'])md.use(sup);
  mathPlugin(md,settings);
  const headings: {id:string;text:string;level:number}[]=[];const slugs=new Map<string,number>();
  md.renderer.rules.heading_open=(tokens,index)=>{const title=tokens[index+1]?.content??'';const slug=title.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-|-$/g,'')||'heading';const count=slugs.get(slug)??0;slugs.set(slug,count+1);const id=count?`${slug}-${count}`:slug;headings.push({id,text:title,level:Number(tokens[index].tag.slice(1))});return `<${tokens[index].tag} id="${escapeHtml(id)}">`;};
  md.renderer.rules.image=(tokens,index,options,env,self)=>{const token=tokens[index];token.attrSet('src',assetUrl(String(token.attrGet('src')??''),context.path));token.attrSet('loading','lazy');token.attrSet('alt',token.content);return self.renderToken(tokens,index,options);};
  md.renderer.rules.fence=(tokens,index)=>{const token=tokens[index],language=token.info.trim().split(/\s+/)[0].toLowerCase();
    if(settings['markdown.diagrams']&&['mermaid','sequence','flow'].includes(language))return `<div class="diagram" data-diagram="${language}" data-source="${escapeHtml(encodeURIComponent(token.content))}"><pre>${escapeHtml(token.content)}</pre></div>`;
    if(settings['math.fenced']&&['math','latex'].includes(language))return `<div class="math-block">${equation(token.content,true,settings)}</div>`;
    const value=language&&hljs.getLanguage(language)?hljs.highlight(token.content,{language,ignoreIllegals:true}).value:escapeHtml(token.content);
    const numbered=settings['code.lineNumbers']?value.replace(/\n$/,'').split('\n').map((line,i)=>`<span class="code-line" data-line="${i+1}">${line||' '}</span>`).join('\n'):value;
    return `<pre class="code-block${settings['code.wrap']?' code-wrap':''}"><code class="language-${escapeHtml(language)}">${numbered}</code></pre>`;
  };
  if(settings['markdown.alerts'])md.core.ruler.after('inline','opentypora_alerts',state=>{for(let i=0;i<state.tokens.length;i++){const token=state.tokens[i];if(token.type!=='blockquote_open')continue;const inline=state.tokens[i+2];const match=inline?.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/i);if(!match)continue;token.attrSet('class',`markdown-alert markdown-alert-${match[1].toLowerCase()}`);inline.content=inline.content.slice(match[0].length);inline.children=md.parseInline(`**${match[1]}**\n${inline.content}`,state.env)[0].children;}});
  let source=text.replace(/\r\n/g,'\n');let frontmatter='';
  const yaml=source.match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)\n?/);if(yaml){try {parseYaml(yaml[1]);frontmatter=`<details class="frontmatter"><summary>YAML Front Matter</summary><pre>${escapeHtml(yaml[1])}</pre></details>`;source=source.slice(yaml[0].length);}catch{}}
  source=source.replace(/^\[toc\]\s*$/gim,'<opentypora-toc></opentypora-toc>');
  let html=frontmatter+md.render(source);
  html=html.replace(/<opentypora-toc><\/opentypora-toc>/g,`<nav class="markdown-toc" aria-label="目录">${headings.map(item=>`<a href="#${escapeHtml(item.id)}" style="margin-left:${(item.level-1)*16}px">${escapeHtml(item.text)}</a>`).join('')}</nav>`);
  return DOMPurify.sanitize(html,{ADD_TAGS:['math','semantics','annotation','mrow','mi','mo','mn','mfrac','msup','msub','msubsup','mover','munder','munderover','msqrt','mroot','mtable','mtr','mtd','mtext','mspace','mpadded','menclose'],ADD_ATTR:['xmlns','encoding','display','mathvariant','stretchy','data-source','data-diagram','data-line','loading'],ALLOW_UNKNOWN_PROTOCOLS:false,ALLOWED_URI_REGEXP:/^(?:(?:https?|mailto|tel|opentypora-asset):|data:image\/(?:png|jpeg|gif|webp|svg\+xml);|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i});
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
  if(equations.length){const {renderMathSvg}=await import('./math');for(const element of equations){if(!container.contains(element))continue;try{element.innerHTML=DOMPurify.sanitize(renderMathSvg(decodeURIComponent(element.dataset.math??''),element.dataset.display==='true',settings['math.physics'],settings['math.numbering']),{USE_PROFILES:{svg:true,svgFilters:true},ADD_ATTR:['xmlns','aria-hidden','focusable','style']});element.dataset.hydrated='true';}catch(error){element.title=String(error);}}}
  if(!settings['markdown.diagrams']||!container.querySelector('[data-diagram]'))return;
  const {default:mermaid}=await import('mermaid');mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:settings['appearance.theme']==='night'?'dark':'default',fontFamily:'inherit'});
  for(const element of container.querySelectorAll<HTMLElement>('[data-diagram]')){if(element.dataset.hydrated==='true')continue;const source=decodeURIComponent(element.dataset.source??''),kind=element.dataset.diagram;try{const converted=kind==='sequence'?sequenceToMermaid(source):kind==='flow'?flowToMermaid(source):source;const {svg}=await mermaid.render(`opentypora-diagram-${++diagramId}`,converted);if(!container.contains(element))continue;element.innerHTML=DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},ADD_TAGS:['foreignObject','div','span','p'],ADD_ATTR:['xmlns','style']});element.dataset.hydrated='true';}catch(error){element.innerHTML=`<pre class="render-error">${escapeHtml(String(error))}\n${escapeHtml(source)}</pre>`;}}
}
