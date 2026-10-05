import {Worker} from 'node:worker_threads';
import type {FileSearchMatch} from '../../src/shared/contracts';
import {serviceError} from './validation';

type Matches=Omit<FileSearchMatch,'path'>[];
interface PendingSearch {id:number;worker:Worker;finish:(error?:Error,matches?:Matches)=>void}
const WORKER_SOURCE=`
const {parentPort}=require('node:worker_threads');
parentPort.on('message',({id,text,source,flags})=>{
 const pattern=new RegExp(source,flags),matches=[];let match,scanned=0,line=1;
 while((match=pattern.exec(text))){
  line+=(text.slice(scanned,match.index).match(/\\n/g)||[]).length;scanned=match.index;
  const begin=text.lastIndexOf('\\n',match.index-1)+1,end=text.indexOf('\\n',match.index);
  matches.push({line,excerpt:text.slice(begin,end<0?text.length:end).slice(0,500),from:match.index,to:match.index+match[0].length});
  if(matches.length>=20000){parentPort.postMessage({id,error:'SEARCH_LIMIT'});return;}
  if(!match[0])pattern.lastIndex+=text.codePointAt(pattern.lastIndex)>0xffff?2:1;
 }
 parentPort.postMessage({id,matches});
});`;

/** One search owns one worker; files run sequentially and never share it with another search. */
export class RegexSearchWorker {
 private worker:Worker|undefined;
 private pending:PendingSearch|undefined;
 private nextId=0;
 private closed=false;
 private stopping=new Set<Promise<number>>();

 private stop(worker:Worker){
  if(this.worker===worker)this.worker=undefined;
  const stopped=worker.terminate();this.stopping.add(stopped);
  void stopped.then(()=>this.stopping.delete(stopped),()=>this.stopping.delete(stopped));
 }
 private ensureWorker():Worker {
  if(this.worker)return this.worker;
  const worker=new Worker(WORKER_SOURCE,{eval:true});this.worker=worker;
  worker.on('message',(value:{id:number;matches?:Matches;error?:string})=>{
   if(this.pending?.worker!==worker||this.pending.id!==value.id)return;
   this.pending.finish(value.error?serviceError(value.error,'命中超过20000项，请缩小范围'):undefined,value.matches);
  });
  worker.on('error',error=>{if(this.pending?.worker===worker)this.pending.finish(error);else this.stop(worker);});
  worker.on('exit',()=>{
   if(this.worker===worker)this.worker=undefined;
   if(this.pending?.worker===worker)this.pending.finish(serviceError('SEARCH_WORKER','正则搜索工作线程异常退出'));
  });
  return worker;
 }
 async matches(text:string,pattern:RegExp,signal?:AbortSignal):Promise<Matches>{
  if(this.closed||signal?.aborted)throw serviceError('CANCELLED','搜索已取消');
  if(this.pending)throw serviceError('SEARCH_WORKER','搜索线程已有运行中的文件');
  const worker=this.ensureWorker(),id=++this.nextId;
  return new Promise((resolve,reject)=>{
   const finish=(error?:Error,matches:Matches=[])=>{
    if(this.pending!==pending)return;
    this.pending=undefined;clearTimeout(timer);signal?.removeEventListener('abort',abort);
    if(error){this.stop(worker);reject(error);}else resolve(matches);
   };
   const pending:PendingSearch={id,worker,finish};this.pending=pending;
   const abort=()=>finish(serviceError('CANCELLED','搜索已取消'));
   const timer=setTimeout(()=>finish(serviceError('REGEX_TIMEOUT','此正则在单文件运行超过1秒，请简化表达式')),1000);
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted){abort();return;}
   try{worker.postMessage({id,text,source:pattern.source,flags:pattern.flags});}catch(error){finish(error as Error);}
  });
 }
 async dispose():Promise<void>{
  this.closed=true;
  this.pending?.finish(serviceError('CANCELLED','搜索已取消'));
  if(this.worker)this.stop(this.worker);
  await Promise.allSettled(this.stopping);
 }
}
