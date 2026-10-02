import {useEffect,useMemo,useRef,useState} from 'react';
import type {SearchOptions} from '../shared/contracts';
import {searchDocument,type SearchResult} from './model';
import {SEARCH_TIMEOUT_MS} from './search-task';
const EMPTY:SearchResult={matches:[],error:null,truncated:false};
/** Arbitrary user regex runs in a disposable worker so even catastrophic backtracking is cancellable. */
export function useDocumentSearch(text:string,query:string,options:SearchOptions):SearchResult{
 const literal=useMemo(()=>options.regex?EMPTY:searchDocument(text,query,options),[text,query,options]);
 const sequence=useRef(0);const [computed,setComputed]=useState<{text:string;query:string;options:SearchOptions;result:SearchResult}|null>(null);
 useEffect(()=>{
  if(!options.regex||!query)return;const id=++sequence.current;
  const deliver=(result:SearchResult)=>{if(sequence.current===id)setComputed({text,query,options,result});};
  const validation=searchDocument('',query,options);if(validation.error){deliver(validation);return;}
  if(typeof Worker==='undefined'){deliver({...EMPTY,error:'搜索线程不可用，请使用普通文本查找或重新打开应用。'});return;}
  let worker:Worker;try{worker=new Worker(new URL('./search.worker.ts',import.meta.url),{type:'module'});}catch{deliver({...EMPTY,error:'搜索线程无法启动，请使用普通文本查找或重新打开应用。'});return;}
  const timer=window.setTimeout(()=>{worker.terminate();deliver({...EMPTY,error:'正则计算超过时限。请缩小范围或简化表达式。'});},SEARCH_TIMEOUT_MS);
  worker.onmessage=(event:MessageEvent<SearchResult>)=>{window.clearTimeout(timer);worker.terminate();deliver(event.data);};
  worker.onerror=()=>{window.clearTimeout(timer);worker.terminate();deliver({...EMPTY,error:'搜索线程无法启动，请使用普通文本查找或重新打开应用。'});};
  try{worker.postMessage({kind:'search',text,query,options});}catch{window.clearTimeout(timer);worker.terminate();deliver({...EMPTY,error:'搜索任务无法发送到后台线程，请重新打开应用。'});}
  return()=>{sequence.current++;window.clearTimeout(timer);worker.terminate();};
 },[text,query,options]);
 if(!options.regex)return literal;
 if(!query)return EMPTY;
 return computed&&computed.text===text&&computed.query===query&&computed.options===options?computed.result:EMPTY;
}
