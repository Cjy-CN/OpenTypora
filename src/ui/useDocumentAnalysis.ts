import {useEffect,useMemo,useRef,useState} from 'react';
import {parseOutline,statistics,type OutlineItem,type TextStatistics} from './model';
import {AnalysisTask} from './analysis-task';
const EMPTY_STATS:TextStatistics={words:0,characters:0,charactersWithoutSpaces:0,lines:0,minutes:0,selectedWords:0,selectedCharacters:0};
type AnalysisResult<T>={text:string;speed:number;strict:boolean;value:T;error?:string};
function useAnalysis<T>(kind:'outline'|'statistics',text:string,speed:number,strict:boolean,calculate:()=>T,empty:T):{value:T;pending:boolean;error?:string}{
 const useWorker=text.length>20000;
 const small=useMemo(()=>useWorker?empty:calculate(),[text,speed,strict,useWorker]);
 const [result,setResult]=useState<AnalysisResult<T>|null>(null);
 const analysis=useRef<AnalysisTask<T>|null>(null);
 useEffect(()=>()=>{analysis.current?.dispose();analysis.current=null;},[useWorker]);
 useEffect(()=>{
  if(!useWorker)return;
  let active=true,cancel:(()=>void)|undefined;
  const fail=(error='后台文档分析线程无法启动，请重新打开应用。')=>{if(active)setResult({text,speed,strict,value:empty,error});};
  if(typeof Worker==='undefined'){fail();return;}
  const timer=window.setTimeout(()=>{
   try{
    const task=analysis.current??(analysis.current=new AnalysisTask<T>(()=>new Worker(new URL('./analysis.worker.ts',import.meta.url),{type:'module'})));
    cancel=task.request({kind,text,speed,strict},answer=>{if(!active)return;if(answer.ok)setResult({text,speed,strict,value:answer.value});else fail(answer.error);});
   }catch{fail();}
  },kind==='statistics'?60:0);
  return()=>{active=false;window.clearTimeout(timer);cancel?.();};
 },[text,speed,strict,kind,useWorker]);
 if(!useWorker)return {value:small,pending:false};
 return result?.text===text&&result.speed===speed&&result.strict===strict?{value:result.value,pending:false,error:result.error}:{value:empty,pending:true};
}
const EMPTY_OUTLINE:OutlineItem[]=[];
export function useOutline(text:string,strict=true){return useAnalysis('outline',text,0,strict,()=>parseOutline(text,strict),EMPTY_OUTLINE);}
export function useTextStatistics(text:string,speed:number){return useAnalysis('statistics',text,speed,true,()=>statistics(text,{anchor:0,head:0},speed),EMPTY_STATS);}
