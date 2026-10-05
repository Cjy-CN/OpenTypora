import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useOutline,useTextStatistics} from '../../src/ui/useDocumentAnalysis';
import {parseOutline,statistics} from '../../src/ui/model';

interface Measurement {kind:string;characters:number;ms:number}
interface TrackedWorker {terminated:number;kind?:string}
const workers:TrackedWorker[]=[],measurements:Measurement[]=[];
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker {
 private record:TrackedWorker={terminated:0};
 private request:{kind:string;text:string;started:number}|undefined;
 constructor(url:string|URL,options?:WorkerOptions){
  super(url,options);workers.push(this.record);
  this.addEventListener('message',()=>{
   if(this.request){measurements.push({kind:this.request.kind,characters:this.request.text.length,ms:performance.now()-this.request.started});this.request=undefined;}
  });
 }
 postMessage(message:unknown,options:Transferable[]|StructuredSerializeOptions=[]){
  const input=message as {kind:string;text:string};this.record.kind=input.kind;this.request={...input,started:performance.now()};
  if(Array.isArray(options))super.postMessage(message,options);else super.postMessage(message,options);
 }
 terminate(){this.record.terminated++;super.terminate();}
};
let output:{outline:ReturnType<typeof useOutline>;statistics:ReturnType<typeof useTextStatistics>};
function Probe({text,speed,strict}:{text:string;speed:number;strict:boolean}){
 output={outline:useOutline(text,strict),statistics:useTextStatistics(text,speed)};return null;
}
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),middle=sorted.length>>>1;return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
const equal=(actual:unknown,expected:unknown,message:string)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(message);};
const waitFor=async(check:()=>boolean)=>{const deadline=performance.now()+12000;while(!check()){if(performance.now()>deadline)throw new Error('Analysis did not complete');await new Promise(resolve=>setTimeout(resolve,5));}};
async function runAnalysisAudit(expectReuse=true){
 const root=createRoot(document.getElementById('root')!);
 const released=(worker:TrackedWorker)=>expectReuse?worker.terminated===1:worker.terminated>=1;
 const render=(text:string,speed=300,strict=true)=>flushSync(()=>root.render(createElement(Probe,{text,speed,strict})));
 const check=async(text:string,speed=300,strict=true)=>{
  await waitFor(()=>!output.outline.pending&&!output.statistics.pending);
  if(output.outline.error||output.statistics.error)throw new Error(output.outline.error||output.statistics.error);
  equal(output.outline.value,parseOutline(text,strict),'Outline source/offset mismatch');
  equal(output.statistics.value,statistics(text,{anchor:0,head:0},speed),'Statistics mismatch');
 };
 try{
  const rows=[];
  for(const count of [350,2000]){
   const base=Array.from({length:count},(_,i)=>'## Heading '+i+'\n\nA Markdown document with **bold**, a [link](https://example.com), 中文段落和 📝 emoji.\n\n').join('');
   const begin=measurements.length;
   for(let trial=0;trial<3;trial++)for(let edit=0;edit<8;edit++){
    const text=base+'Current edit '+trial+'-'+edit;render(text);await check(text);
   }
   rows.push({characters:base.length,utf8Bytes:new TextEncoder().encode(base).length,trials:3,updatesPerTrial:8,
    jobs:['outline','statistics'].map(kind=>{const samples=measurements.slice(begin).filter(sample=>sample.kind===kind).map(sample=>sample.ms);return {kind,samples,medianMs:median(samples)};})});
  }
  if(expectReuse)equal(workers.length,2,'Workers were recreated after ordinary document updates');
  const strictText='###Loose\r\n'+'body '.repeat(5000);render(strictText,100,false);await check(strictText,100,false);
  render(strictText,200,true);await check(strictText,200,true);
  // A short document releases the long-document worker working sets.
  render('short');await check('short');if(workers.some(worker=>!released(worker)))throw new Error('Short document retained a worker');
  const previous=workers.length;render(strictText);await check(strictText);
  equal(workers.length,previous+2,'Long document did not restart its workers');
  return {documentAnalysis:true,rows,workers:workers.length,ordinaryUpdates:48,sourceAndResultEquality:true,scope:'Original React hooks and analysis worker in Chromium; job timings exclude the statistics debounce and React rendering.'};
 }finally{
  flushSync(()=>root.unmount());if(workers.some(worker=>!released(worker)))throw new Error('Unmount retained a worker');
 }
}
Object.assign(window,{runAnalysisAudit});
