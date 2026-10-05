import type {AnalysisInput,AnalysisResponse} from './analysis-protocol';

export const ANALYSIS_TIMEOUT_MS=10000;
const WORKER_ERROR='后台文档分析线程无法启动，请重新打开应用。';
const TIMEOUT_ERROR='后台文档分析超过时限，请缩小文档或重新打开应用。';
type Completion<T>={ok:true;value:T}|{ok:false;error:string};
interface Task<T>{id:number;input:AnalysisInput;reply:((result:Completion<T>)=>void)|undefined}

/** Reuse the worker, retaining at most one running and one latest pending calculation. */
export class AnalysisTask<T> {
 private worker:Worker|undefined;
 private running:Task<T>|undefined;
 private queued:Task<T>|undefined;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private nextId=0;
 private disposed=false;
 constructor(private readonly createWorker:()=>Worker){}

 request(input:AnalysisInput,reply:(result:Completion<T>)=>void):()=>void {
  if(this.disposed)throw new Error('文档分析线程已关闭');
  const task:Task<T>={id:++this.nextId,input,reply};
  if(this.queued)this.queued.reply=undefined;
  this.queued=task;this.pump();
  return()=>{task.reply=undefined;if(this.queued===task)this.queued=undefined;};
 }
 private stopWorker(){
  const worker=this.worker;this.worker=undefined;
  if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}
 }
 private fail(error=WORKER_ERROR){
  this.stopWorker();this.finish({ok:false,error});
 }
 private finish(result:Completion<T>){
  clearTimeout(this.timer);this.timer=undefined;
  const task=this.running;this.running=undefined;
  try{task?.reply?.(result);}finally{this.pump();}
 }
 private ensureWorker():Worker {
  if(this.worker)return this.worker;
  const worker=this.createWorker();this.worker=worker;
  worker.onmessage=(event:MessageEvent<AnalysisResponse>)=>{
   if(this.worker!==worker||!this.running||this.running.id!==event.data.id)return;
   if(event.data.ok)this.finish({ok:true,value:event.data.value as T});
   else this.fail(event.data.error);
  };
  worker.onerror=event=>{event.preventDefault();if(this.worker===worker)this.fail();};
  worker.onmessageerror=()=>{if(this.worker===worker)this.fail();};
  return worker;
 }
 private pump(){
  if(this.disposed||this.running||!this.queued)return;
  this.running=this.queued;this.queued=undefined;
  try{
   const worker=this.ensureWorker();
   this.timer=setTimeout(()=>this.fail(TIMEOUT_ERROR),ANALYSIS_TIMEOUT_MS);
   worker.postMessage({id:this.running.id,...this.running.input});
  }catch{this.fail();}
 }
 dispose(){
  this.disposed=true;clearTimeout(this.timer);this.timer=undefined;
  this.running=undefined;this.queued=undefined;this.stopWorker();
 }
}
