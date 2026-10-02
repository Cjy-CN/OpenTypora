import type {SearchMatch,SearchOptions,TextChange} from '../shared/contracts';
import {replacementChanges} from './model';

export const SEARCH_TIMEOUT_MS=1000;
export function calculateReplacement(text:string,query:string,replacement:string,options:SearchOptions,only?:SearchMatch):Promise<TextChange[]>{
 if(!options.regex)return Promise.resolve(replacementChanges(text,query,replacement,options,only));
 if(typeof Worker==='undefined')return Promise.reject(new Error('搜索线程不可用，请使用普通文本替换或重新打开应用。'));
 return new Promise((resolve,reject)=>{
  let worker:Worker;
  try{worker=new Worker(new URL('./search.worker.ts',import.meta.url),{type:'module'});}catch{reject(new Error('搜索线程无法启动，请使用普通文本替换或重新打开应用。'));return;}
  const finish=()=>{window.clearTimeout(timer);worker.terminate();};
  const timer=window.setTimeout(()=>{finish();reject(new Error('正则计算超过时限。请缩小范围或简化表达式。'));},SEARCH_TIMEOUT_MS);
  worker.onmessage=(event:MessageEvent<{ok:true;value:TextChange[]}|{ok:false;error:string}>)=>{finish();if(event.data.ok)resolve(event.data.value);else reject(new Error(event.data.error));};
  worker.onerror=()=>{finish();reject(new Error('搜索线程无法运行，请使用普通文本替换或重新打开应用。'));};
  try{worker.postMessage({kind:'replace',text,query,replacement,options,only});}catch{finish();reject(new Error('替换任务无法发送到搜索线程，请重新打开应用。'));}
 });
}
