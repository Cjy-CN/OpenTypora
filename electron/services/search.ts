import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { RegexSearchWorker } from './search-worker';
import type { DirectoryEntry, FileSearchMatch, SearchOptions } from '../../src/shared/contracts';
import { absolutePath, object, serviceError, string } from './validation';
import { readFile } from './files';
export const MARKDOWN_EXTENSIONS=new Set(['.md','.markdown','.txt','.text','.mdx','.rmd','.qmd','.mdtxt','.mdtext','.apib','.rmarkdown','.mmd','.mkd','.mdwn','.mdown']);
export async function listDirectory(path:string):Promise<DirectoryEntry[]>{
  const root=absolutePath(path),entries=await fs.readdir(root,{withFileTypes:true});const result:DirectoryEntry[]=[];
  for(const entry of entries){if(entry.isSymbolicLink())continue;const full=join(root,entry.name);try{const stat=await fs.stat(full);let excerpt:string|undefined;if(entry.isFile()&&MARKDOWN_EXTENSIONS.has(extname(full).toLowerCase())){const handle=await fs.open(full,'r');try{const buffer=Buffer.alloc(512);const {bytesRead}=await handle.read(buffer,0,512,0);excerpt=buffer.subarray(0,bytesRead).toString('utf8').replace(/^---[\s\S]*?---/,'').replace(/[#*`>]/g,'').replace(/\s+/g,' ').slice(0,160);}finally{await handle.close();}}result.push({name:entry.name,path:full,directory:entry.isDirectory(),modifiedAt:stat.mtimeMs,size:stat.size,excerpt});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  return result.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,'zh-CN'));
}
export function searchPattern(query:string,options:SearchOptions):RegExp{
  string(query,'关键词',10_000);object(options,'搜索选项');if(['caseSensitive','wholeWord','regex'].some(key=>typeof options[key as keyof SearchOptions]!=='boolean'))throw serviceError('INVALID_ARGUMENT','搜索选项必须是布尔值');
  let pattern=options.regex?query:query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(options.wholeWord)pattern=`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`;
  try{return new RegExp(pattern,`gmu${options.caseSensitive?'':'i'}`);}catch{throw serviceError('INVALID_REGEX','无效的正则表达式');}
}
export async function searchFiles(root:string,query:string,options:SearchOptions,signal?:AbortSignal):Promise<FileSearchMatch[]>{
  root=absolutePath(root);const pattern=searchPattern(query,options);if(!query)return[];const matches:FileSearchMatch[]=[];const failures:{path:string;error:string}[]=[];let files=0;
  const regex=options.regex?new RegexSearchWorker():undefined;
  const walk=async(directory:string)=>{if(signal?.aborted)throw serviceError('CANCELLED','搜索已取消');let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(error){failures.push({path:directory,error:(error as Error).message});return;}
    for(const entry of entries){if(signal?.aborted)throw serviceError('CANCELLED','搜索已取消');if(entry.isSymbolicLink()||['.git','node_modules'].includes(entry.name))continue;const path=join(directory,entry.name);if(entry.isDirectory()){await walk(path);continue;}if(!MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase()))continue;
      if(++files>50_000)throw serviceError('SEARCH_LIMIT','文件超过50000项，请缩小搜索目录');try{if((await fs.stat(path)).size>16_000_000){failures.push({path,error:'文件超过16MB搜索上限'});continue;}const file=await readFile(path);if(regex){const found=await regex.matches(file.text,pattern,signal);matches.push(...found.map(match=>({path,...match})));if(matches.length>=20_000)throw serviceError('SEARCH_LIMIT','命中超过20000项，请缩小范围');continue;}pattern.lastIndex=0;let match:RegExpExecArray|null;let scanned=0,line=1;
        while((match=pattern.exec(file.text))){line+=(file.text.slice(scanned,match.index).match(/\n/g)||[]).length;scanned=match.index;const begin=file.text.lastIndexOf('\n',match.index-1)+1,end=file.text.indexOf('\n',match.index);matches.push({path,line,excerpt:file.text.slice(begin,end<0?file.text.length:end).slice(0,500),from:match.index,to:match.index+match[0].length});if(matches.length>=20_000)throw serviceError('SEARCH_LIMIT','命中超过20000项，请缩小范围');if(!match[0])pattern.lastIndex+=file.text.codePointAt(pattern.lastIndex)!>0xffff?2:1;}
      }catch(error){if(['SEARCH_LIMIT','CANCELLED'].includes((error as {code?:string}).code||''))throw error;failures.push({path,error:(error as Error).message});}
    }
  };try{await walk(root);if(signal?.aborted)throw serviceError('CANCELLED','搜索已取消');if(failures.length)throw serviceError('SEARCH_PARTIAL','部分文件无法搜索，已完成的结果可查看',{matches,failures});return matches;}finally{await regex?.dispose();}
}
