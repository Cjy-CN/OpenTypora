import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type { ExportSnapshot, ExportResult, ImportResult, ExportProfile } from '../../src/shared/contracts';
import { atomicWrite } from './files';
import { authorizeDirectory, resolveAuthorizedAsset } from './access';
import { runCommand, variables, findExecutable } from './process';
import { absolutePath, number, object, serviceError, string, strings } from './validation';
export interface RenderService {
  pdf(html:string,options:Record<string,unknown>,signal?:AbortSignal):Promise<Buffer>;
  image(html:string,options:Record<string,unknown>,signal?:AbortSignal):Promise<Buffer[]>;
}
export const OUTPUT_FORMATS:Record<string,string>={docx:'docx',odt:'odt',rtf:'rtf',epub:'epub',latex:'latex',mediawiki:'mediawiki',rst:'rst',textile:'textile',opml:'opml',markdown:'markdown',native:'native'};
export const INPUT_FORMATS:Record<string,string>={'.html':'html','.htm':'html','.docx':'docx','.odt':'odt','.rtf':'rtf','.epub':'epub','.tex':'latex','.latex':'latex','.wiki':'mediawiki','.mediawiki':'mediawiki','.rst':'rst','.textile':'textile','.opml':'opml','.md':'markdown','.markdown':'markdown','.txt':'markdown','.json':'json','.native':'native'};
const escape=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function normalizeOptions(input:Record<string,unknown>):Record<string,unknown>{const options={...input};for(const [key,alias]of Object.entries({h1PageBreak:'pageBreakH1',headHtml:'head',bodyHtml:'body',yamlOverrides:'yamlOverride',imageWidth:'width',imageQuality:'quality'})){if(options[key]===undefined)options[key]=options[alias];}if(options.bodyHtml===undefined)options.bodyHtml=options.extraHtml;return options;}
const YAML_LAYOUT_KEYS=['pageSize','margins','header','footer','author','title','h1PageBreak','pageBreakH1','fontSize','imageWidth','width','imageQuality','quality','landscape'];
export function effectiveOptions(snapshot:ExportSnapshot):Record<string,unknown>{
  const options=normalizeOptions(object(snapshot.profile.options,'导出设置'));if(options.yamlOverrides&&snapshot.text.startsWith('---')){
    const match=snapshot.text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);if(match){let yaml;try{yaml=parseYaml(match[1]);}catch{throw serviceError('YAML_INVALID','YAML元数据无法解析');}if(yaml&&typeof yaml==='object'){const source=yaml.export&&typeof yaml.export==='object'?yaml.export:yaml;for(const key of YAML_LAYOUT_KEYS)if(source[key]!==undefined)options[key]=source[key];}}
  }return normalizeOptions(options);
}
export function validateProfile(profile:ExportProfile):void{
  object(profile,'导出配置');string(profile.name,'名称');if(!['pdf','pdf-latex','html','html-plain','image','custom','pandoc',...Object.keys(OUTPUT_FORMATS)].includes(profile.format))throw serviceError('INVALID_FORMAT','不支持此导出格式');
  if(!/^\.?[a-zA-Z0-9]{1,16}$/.test(string(profile.extension,'后缀')))throw serviceError('INVALID_EXTENSION','导出后缀只能包含字母和数字');strings(profile.args);object(profile.options);
  if(profile.afterCommand){object(profile.afterCommand);string(profile.afterCommand.executable,'后置程序');strings(profile.afterCommand.args);}
}
function removeActiveContent(html:string):string{
  return html.replace(/<(script|iframe|object|embed|form|input|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(script|iframe|object|embed|form|input|button)\b[^>]*\/?>/gi,'').replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/\s+(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi,'');
}
export async function exportHtml(snapshot:ExportSnapshot,options:Record<string,unknown>,warnings:string[],request:typeof fetch=fetch,signal?:AbortSignal):Promise<string>{
  let content=removeActiveContent(string(snapshot.html,'HTML',128_000_000));
  const sourceBody=content.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);if(sourceBody)content=sourceBody[1];
  const originalStyles=snapshot.html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi)?.join('\n')||'';
  if(snapshot.profile.format==='html-plain')content=content.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/\s+(?:style|class)=(?:"[^"]*"|'[^']*')/gi,'');
  // Inline images makes exported HTML/PDF independent from source paths and network access.
  const images=[...content.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)];
  for(const match of images){const src=match[2];if(/^data:/i.test(src))continue;try{let bytes:Buffer,mime:string|undefined;
    if(/^https?:/i.test(src)){
      const timeout=AbortSignal.timeout(10_000),response=await request(src.replace(/&amp;/g,'&'),{signal:signal?AbortSignal.any([signal,timeout]):timeout});if(!response.ok||!response.body)throw new Error(`HTTP ${response.status}`);mime=response.headers.get('content-type')?.split(';')[0];if(!mime||!/^image\/(png|jpeg|gif|svg\+xml|webp|avif|bmp)$/i.test(mime))throw new Error('远程地址未返回支持的图片类型');const reader=response.body.getReader(),parts:Buffer[]=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>32_000_000){await reader.cancel();throw new Error('图片超过32MB内嵌上限');}parts.push(Buffer.from(value));}bytes=Buffer.concat(parts);
    }else{
      const candidate=src.startsWith('file:')?fileURLToPath(src):src.startsWith('opentypora-asset:')?src:join(snapshot.path?dirname(snapshot.path):process.cwd(),decodeURIComponent(src));const path=await resolveAuthorizedAsset(candidate);if(!path)throw new Error('图片未授权或不存在');bytes=await fs.readFile(path);if(bytes.length>32_000_000)throw new Error('图片超过32MB内嵌上限');const type:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.webp':'image/webp','.avif':'image/avif','.bmp':'image/bmp'};mime=type[extname(path).toLowerCase()];if(!mime)throw new Error('不支持图片类型');
    }content=content.replace(match[0],match[0].replace(src,`data:${mime};base64,${bytes.toString('base64')}`));
  }catch(error){if(signal?.aborted)throw serviceError('CANCELLED','导出已取消');warnings.push(`资源 ${src}：${(error as Error).message}；输出保留原引用，离线可能不可用`);}}
  const body=removeActiveContent(String(options.bodyHtml||'')),head=removeActiveContent(String(options.headHtml||''));
  const outline=options.retainOutline?`<nav class="export-outline" aria-label="目录"><ul>${[...content.matchAll(/<h([1-6])\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/h\1>/gi)].map(match=>`<li class="level-${match[1]}"><a href="#${escape(match[2])}">${match[3].replace(/<[^>]+>/g,'')}</a></li>`).join('')}</ul></nav>`:'';
  const css=snapshot.profile.format==='html-plain'?'':`${originalStyles}<style>${String(options.themeCss||'')}html{font-family:system-ui,"Microsoft YaHei",sans-serif}body{max-width:960px;margin:32px auto;padding:0 24px;font-size:${number(options.fontSize,16,6,96)}px;line-height:1.7}img,svg{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #aaa;padding:6px 10px}blockquote{border-left:4px solid #bbb;padding-left:16px}.export-outline{border-bottom:1px solid #bbb}.level-2{margin-left:16px}.level-3{margin-left:32px}@media print{body{max-width:none;margin:0;padding:0}tr,img,svg{break-inside:avoid}pre{break-inside:auto}${options.h1PageBreak?'h1:not(:first-child){break-before:page}':''}}</style>`;
  return`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'"><meta name="author" content="${escape(String(options.author||''))}"><title>${escape(String(options.title||snapshot.title))}</title>${css}${head}</head><body>${outline}<main>${content}</main>${body}</body></html>`;
}
export class ExportService {
  constructor(readonly userData:string,readonly render:RenderService,readonly request:typeof fetch=fetch){}
  async export(input:ExportSnapshot,target:string,settings:Record<string,unknown>,signal?:AbortSignal):Promise<ExportResult>{
    const snapshot=structuredClone(input);object(snapshot);string(snapshot.text,'正文',64_000_000);validateProfile(snapshot.profile);target=absolutePath(target,'输出路径');const options=effectiveOptions(snapshot),warnings:string[]=[];
    const workspace=join(this.userData,'exports',randomUUID());await fs.mkdir(workspace,{recursive:true});const staged=join(workspace,`output.${snapshot.profile.extension.replace(/^\./,'')}`);const source=join(workspace,'input.md');await fs.writeFile(source,snapshot.text,'utf8');
    try{
      if(signal?.aborted)throw serviceError('CANCELLED','导出已取消');const format=snapshot.profile.format;
      if(['html','html-plain','pdf','image'].includes(format)){
        const html=await exportHtml(snapshot,options,warnings,this.request,signal);
        if(format==='html'||format==='html-plain')await atomicWrite(target,html);
        else if(format==='pdf')await atomicWrite(target,await this.render.pdf(html,options,signal));
        else{options.imageFormat=/\.jpe?g$/i.test(target)?'jpeg':'png';const images=await this.render.image(html,options,signal);for(let index=0;index<images.length;index++)await atomicWrite(index?join(dirname(target),`${basename(target,extname(target))}-${index+1}${extname(target)}`):target,images[index]);if(images.length>1)warnings.push(`长文已分为${images.length}张图片；首张为${target}`);}
      }else if(format==='custom'){
        const executable=string(options.executable,'转换程序');let args=options.args===undefined?snapshot.profile.args:strings(options.args);args=variables(args,{input:source,output:staged,resourceDir:snapshot.path?dirname(snapshot.path):workspace,title:snapshot.title});
        if(!args.some(arg=>arg===staged||arg.includes(staged)))throw serviceError('OUTPUT_ARGUMENT_REQUIRED','自定义命令需使用 ${output} 指定输出路径');await runCommand(executable,args,{cwd:snapshot.path?dirname(snapshot.path):workspace,signal});await fs.access(staged);await atomicWrite(target,await fs.readFile(staged));
      }else{
        const executable=String(options.pandocPath||settings['export.pandocPath']||'pandoc');const output=format==='pandoc'?String(options.outputFormat||''):format==='pdf-latex'?'latex':String(options.outputFormat||OUTPUT_FORMATS[format]);if(!output||!/^[a-zA-Z0-9_+-]+$/.test(output))throw serviceError('INVALID_FORMAT','请选择有效Pandoc输出格式');
        const inputFormat=String(options.inputFormat||'markdown+tex_math_dollars+pipe_tables+task_lists+footnotes');if(!/^[a-zA-Z0-9_+-]+$/.test(inputFormat))throw serviceError('INVALID_FORMAT','Pandoc输入格式无效');
        const args=['--from',inputFormat,'--to',output,'--standalone','--resource-path',snapshot.path?dirname(snapshot.path):workspace,'--output',staged];
        if(format==='pdf-latex'){const engine=String(options.pdfEngine||'xelatex');if(!await findExecutable(engine))throw serviceError('DEPENDENCY_MISSING', 'LaTeX PDF 需要 '+engine+'；请安装 TeX Live/MiKTeX 或配置 pdfEngine 绝对路径');args.push('--pdf-engine',engine);}
        if(options.referenceDoc)args.push('--reference-doc',absolutePath(options.referenceDoc));if(options.template)args.push('--template',absolutePath(options.template));if(options.author)args.push('--metadata',`author=${String(options.author)}`);if(options.title||snapshot.title)args.push('--metadata',`title=${String(options.title||snapshot.title)}`);
        args.push(...variables(snapshot.profile.args,{input:source,output:staged,resourceDir:snapshot.path?dirname(snapshot.path):workspace,title:snapshot.title}),source);const result=await runCommand(executable,args,{cwd:snapshot.path?dirname(snapshot.path):workspace,signal,timeout:180_000});if(result.stderr.trim())warnings.push(result.stderr.trim().slice(-4000));
        if(/```\s*(mermaid|flow|sequence)/i.test(snapshot.text))warnings.push('Pandoc结构格式保留图表代码；渲染图表请使用HTML/PDF/图片导出');if(/==[^=]+==/.test(snapshot.text))warnings.push('目标格式可能不保留高亮扩展，检查生成结果');
        await fs.access(staged);await atomicWrite(target,await fs.readFile(staged));
      }
      return{path:target,warnings};
    }finally{await fs.rm(workspace,{recursive:true,force:true});}
  }
  async import(sourcePath:string,settings:Record<string,unknown>,signal?:AbortSignal):Promise<ImportResult>{
    const source=absolutePath(sourcePath),format=INPUT_FORMATS[extname(source).toLowerCase()];if(!format)throw serviceError('UNSUPPORTED_IMPORT','不支持此输入格式；PDF不声明为可语义导入');
    const directory=join(this.userData,'imports',randomUUID());await fs.mkdir(directory,{recursive:true});const output=join(directory,'imported.md'),media=join(directory,'media');
    try{const result=await runCommand(String(settings['export.pandocPath']||'pandoc'),['--from',format,'--to','markdown+pipe_tables+tex_math_dollars+footnotes','--extract-media',media,'--output',output,source],{cwd:dirname(source),signal,timeout:180_000});const text=await fs.readFile(output,'utf8');await authorizeDirectory(directory);await fs.unlink(output);return{text,sourcePath:source,warnings:result.stderr.trim()?[result.stderr.trim().slice(-4000)]:[]};}catch(error){await fs.rm(directory,{recursive:true,force:true});throw error;}
  }
}
