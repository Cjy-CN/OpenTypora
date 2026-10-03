import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { markdownBlocks, orderedSelection, sourceLines, type MarkdownBlock } from '../core/formatting';
import type { SelectionRange } from '../shared/contracts';
import type { SettingsSnapshot } from '../shared/settings';
import { escapeHtml, renderMarkdown } from '../render/markdown';

/** The extra source lines belong to the projection only; canonical source never changes. */
export function previewReplacementEnd(text:string,block:MarkdownBlock,selection:SelectionRange,composing=false):number {
  if(composing)return block.to;
  const separator=text.slice(block.to).match(/^(?:\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r))*(?:[ \t]+$)?/)?.[0]??'';
  const end=block.to+separator.length,{from,to}=orderedSelection(selection);
  const selected=from===to?from>=block.to&&from<end:from<end&&to>block.to;
  return selected?block.to:end;
}

interface Definition {from:number;to:number;label:string;source:string;body:string;footnote:boolean}
interface SourceIndex {definitions:Definition[];blocks:MarkdownBlock[];footnotes?:Map<string,number[]>}
const indexes=new Map<string,SourceIndex>();
function sourceIndex(text:string):SourceIndex {
  const cached=indexes.get(text);if(cached)return cached;
  const blocks=markdownBlocks(text),index={definitions:extractDefinitions(text,blocks),blocks};
  if(indexes.size>=2)indexes.delete(indexes.keys().next().value!);indexes.set(text,index);return index;
}
function definitions(text:string):Definition[] {return sourceIndex(text).definitions;}
function extractDefinitions(text:string,blocks:MarkdownBlock[]):Definition[] {
  const result:Definition[]=[];
  for(const block of blocks){
    if(['code','yaml','math','html'].includes(block.kind))continue;
    const lines=sourceLines(block.text);
    for(let index=0;index<lines.length;index++){
      const line=lines[index],match=/^ {0,3}\[([^\]\r\n]+)\]:[ \t]*(.*)$/.exec(line.text);if(!match)continue;
      let last=index;while(last+1<lines.length&&/^(?: {4}|\t)/.test(lines[last+1].text))last++;
      const from=block.from+line.from,to=block.from+lines[last].to,isFootnote=match[1].startsWith('^');
      if(isFootnote&&/\s/.test(match[1]))continue;
      const continuation=lines.slice(index+1,last+1).map(row=>row.text.replace(/^(?: {4}|\t)/,''));
      result.push({from,to,label:isFootnote?match[1].slice(1):match[1],source:text.slice(from,to),body:[match[2],...continuation].join('\n'),footnote:isFootnote});index=last;
    }
  }
  return result;
}
export function liveReferences(text:string):string {return definitions(text).map(item=>item.source).join('\n');}
function escapedAt(text:string,position:number):boolean {let slashes=0;for(let index=position-1;index>=0&&text[index]==='\\';index--)slashes++;return slashes%2===1;}
function literalAt(tree:ReturnType<typeof markdownLanguage.parser.parse>,position:number):boolean {
  for(let node=tree.resolveInner(position,1);node;node=node.parent!)if(['InlineCode','FencedCode','CodeBlock','HTMLBlock','InlineHTML'].includes(node.name))return true;
  return false;
}
export function footnoteReferencePositions(text:string,label:string):number[] {
  const index=sourceIndex(text);if(index.footnotes)return index.footnotes.get(label)??[];
  const tree=markdownLanguage.parser.parse(text),blocks=index.blocks,positions=new Map<string,number[]>();let blockIndex=0;
  for(const match of text.matchAll(/\[\^([^\]\s]+)\](?!:)/g)){
    if(escapedAt(text,match.index!)||literalAt(tree,match.index!))continue;
    while(blockIndex<blocks.length&&blocks[blockIndex].to<=match.index!)blockIndex++;
    const block=blocks[blockIndex];
    if(block&&['code','yaml','math','html'].includes(block.kind))continue;
    const entries=positions.get(match[1])??[];entries.push(match.index!);positions.set(match[1],entries);
  }
  index.footnotes=positions;return positions.get(label)??[];
}
/** Resolve against current source rather than keeping a DOM offset after edits. */
export function liveFootnoteTarget(text:string,link:HTMLElement):number|null {
  const label=link.dataset.footnoteLabel;if(!label)return null;
  if(link.dataset.footnoteAction==='definition')return definitions(text).find(item=>item.footnote&&item.label===label)?.from??null;
  if(link.dataset.footnoteAction==='reference')return footnoteReferencePositions(text,label)[Number(link.dataset.footnoteOccurrence??0)]??null;
  return null;
}
export function footnoteBacklinks(text:string,label:string):HTMLElement {
  const container=document.createElement('span');container.className='ot-live-footnote-backlinks';
  footnoteReferencePositions(text,label).forEach((position,index)=>{
    const link=document.createElement('a');link.className='ot-live-footnote-backref';link.textContent='↩';link.setAttribute('aria-label',`返回脚注 ${label} 的第 ${index+1} 个引用`);link.href=`#ot-fnref-${position}`;link.dataset.footnoteLabel=label;link.dataset.footnoteAction='reference';link.dataset.footnoteOccurrence=String(index);container.append(' ',link);
  });
  return container;
}
function commentProjection(source:string):string {
  if(!source.includes('<!--'))return source;
  const tree=markdownLanguage.parser.parse(source);
  return source.replace(/<!--[\s\S]*?-->/g,(comment:string,position:number)=>literalAt(tree,position)&&tree.resolveInner(position,1).name!=='HTMLBlock'||escapedAt(source,position)?comment:`<span class="ot-live-comment">${escapeHtml(comment)}</span>`);
}
function readingHtml(source:string,references:string,settings:SettingsSnapshot,path:string|null,sourceFrom:number,projectComments=true):string {
  const input=source+(references?'\n\n'+references:''),environment:{footnotes?:{list?:{label?:string}[]}}={};
  const template=document.createElement('template');template.innerHTML=renderMarkdown((projectComments?commentProjection(source):source)+(references?'\n\n'+references:''),settings,{path});
  template.content.querySelectorAll('.footnotes-sep,.footnotes').forEach(element=>element.remove());
  if(template.content.querySelector('.footnote-ref'))new MarkdownIt({html:true}).use(footnote).parse(input,environment);
  const occurrences=new Map<string,number>();template.content.querySelectorAll<HTMLAnchorElement>('.footnote-ref a').forEach(link=>{
    const number=Number(link.getAttribute('href')?.match(/^#fn(\d+)/)?.[1]),label=environment.footnotes?.list?.[number-1]?.label;if(!label)return;
    const occurrence=occurrences.get(label)??0;occurrences.set(label,occurrence+1);const position=footnoteReferencePositions(source,label)[occurrence]??0;
    link.textContent=label;link.classList.add('ot-live-footnote-ref');link.dataset.footnoteLabel=label;link.dataset.footnoteAction='definition';link.id=`ot-fnref-${sourceFrom+position}`;link.href=`#ot-fn-${encodeURIComponent(label)}`;
  });
  return template.innerHTML;
}
/** Live editor exposes hidden definitions/comments at their original source location. */
export function renderLiveBlock(block:MarkdownBlock,text:string,settings:SettingsSnapshot,path:string|null):string {
  const allDefinitions=definitions(text),references=allDefinitions.map(item=>item.source).join('\n'),local=allDefinitions.filter(item=>item.from>=block.from&&item.to<=block.to);
  if(!local.length)return readingHtml(block.text,references,settings,path,block.from,!['code','yaml','math'].includes(block.kind));
  const container=document.createElement('div');let cursor=block.from;
  for(const definition of local){
    const preceding=text.slice(cursor,definition.from);if(preceding.trim())container.insertAdjacentHTML('beforeend',readingHtml(preceding,references,settings,path,cursor));
    const element=document.createElement('div');element.className='ot-live-reference';
    if(!definition.footnote)element.textContent=definition.source;
    else {
      element.id=`ot-fn-${encodeURIComponent(definition.label)}`;
      const prefix=document.createElement('span');prefix.className='ot-live-reference-label';prefix.textContent=`[^${definition.label}]: `;element.append(prefix);
      const body=document.createElement('span');body.className='ot-live-reference-body';body.innerHTML=readingHtml(definition.body,references,settings,path,definition.from);element.append(body);
      element.append(footnoteBacklinks(text,definition.label));
    }
    container.append(element);cursor=definition.to;
  }
  const following=text.slice(cursor,block.to);if(following.trim())container.insertAdjacentHTML('beforeend',readingHtml(following,references,settings,path,cursor));
  return container.innerHTML;
}
