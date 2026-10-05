// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {useOutline,useTextStatistics} from './useDocumentAnalysis';
import {useDocumentSearch} from './useDocumentSearch';
import {calculateReplacement,SEARCH_TIMEOUT_MS} from './search-task';
import {ANALYSIS_TIMEOUT_MS} from './analysis-task';
import {statistics} from './model';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
class FakeWorker {
 static instances:FakeWorker[]=[];
 onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:ErrorEvent)=>void)|null=null;onmessageerror:(()=>void)|null=null;
 terminate=vi.fn();postMessage=vi.fn();
 constructor(){FakeWorker.instances.push(this);}
 deliver(value:unknown){this.onmessage?.({data:value} as MessageEvent);}
 answer(value:unknown,index=this.postMessage.mock.calls.length-1){this.deliver({id:this.postMessage.mock.calls[index][0].id,ok:true,value});}
 fail(){this.onerror?.({preventDefault:vi.fn()} as unknown as ErrorEvent);}
}
let root:Root|undefined,container:HTMLDivElement;
afterEach(async()=>{if(root)await act(()=>root!.unmount());root=undefined;container?.remove();vi.unstubAllGlobals();vi.useRealTimers();FakeWorker.instances=[];});
function mount(){vi.stubGlobal('Worker',FakeWorker);vi.useFakeTimers();container=document.createElement('div');document.body.append(container);root=createRoot(container);}
function Statistics({text,speed}:{text:string;speed:number}){return createElement('output',null,JSON.stringify(useTextStatistics(text,speed)));}
function Outline({text,strict}:{text:string;strict:boolean}){return createElement('output',null,JSON.stringify(useOutline(text,strict)));}
const options={caseSensitive:false,wholeWord:false,regex:true};
function Search({text,query}:{text:string;query:string}){return createElement('output',null,JSON.stringify(useDocumentSearch(text,query,options)));}
const state=()=>JSON.parse(container.textContent??'{}');
describe('background document tasks',()=>{
 it('reuses the outline worker after strict mode changes and rejects the former answer',async()=>{mount();const text='###Loose\r\n'+ 'body '.repeat(5000);await act(()=>root!.render(createElement(Outline,{text,strict:true})));await act(()=>vi.advanceTimersByTime(0));const worker=FakeWorker.instances[0];expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({kind:'outline',strict:true,text}));await act(()=>root!.render(createElement(Outline,{text,strict:false})));await act(()=>vi.advanceTimersByTime(0));expect(worker.terminate).not.toHaveBeenCalled();expect(worker.postMessage).toHaveBeenCalledTimes(1);await act(()=>worker.answer([],0));expect(state().pending).toBe(true);expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({strict:false}));await act(()=>worker.answer([{id:'heading-0',title:'Loose',level:3,from:0,to:8,parent:null}],1));expect(state().value[0].title).toBe('Loose');expect(state().pending).toBe(false);expect(FakeWorker.instances).toHaveLength(1);});
 it('keeps the analysis thread but rejects cancelled and duplicate answers',async()=>{
  mount();const first='old '.repeat(6000),second='new '.repeat(6000);
  await act(()=>root!.render(createElement(Statistics,{text:first,speed:382})));await act(()=>vi.advanceTimersByTime(60));const old=FakeWorker.instances[0];
  await act(()=>root!.render(createElement(Statistics,{text:second,speed:382})));expect(old.terminate).not.toHaveBeenCalled();await act(()=>vi.advanceTimersByTime(60));
  await act(()=>old.answer(statistics('old',{anchor:0,head:0},382),0));expect(state().pending).toBe(true);
  expect(old.postMessage).toHaveBeenCalledTimes(2);await act(()=>old.answer({words:1},0));expect(state().pending).toBe(true);
  await act(()=>old.answer({words:6000},1));expect(state().value.words).toBe(6000);expect(state().pending).toBe(false);expect(old.terminate).not.toHaveBeenCalled();expect(FakeWorker.instances).toHaveLength(1);
 });
 it('recovers from a failed statistics worker when reading speed changes',async()=>{
  mount();const text='text '.repeat(5000);await act(()=>root!.render(createElement(Statistics,{text,speed:382})));await act(()=>vi.advanceTimersByTime(60));await act(()=>FakeWorker.instances[0].fail());expect(state().error).toContain('无法启动');expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
  await act(()=>root!.render(createElement(Statistics,{text,speed:100})));await act(()=>vi.advanceTimersByTime(60));await act(()=>FakeWorker.instances[1].answer({words:5000,minutes:50}));expect(state().error).toBeUndefined();expect(state().value.minutes).toBe(50);
 });
 it('coalesces rapid changes into only the latest queued source',async()=>{
  mount();const texts=['first ','middle ','latest '].map(value=>value.repeat(6000));
  for(const text of texts){await act(()=>root!.render(createElement(Statistics,{text,speed:300})));await act(()=>vi.advanceTimersByTime(60));}
  const worker=FakeWorker.instances[0];expect(worker.postMessage).toHaveBeenCalledTimes(1);
  await act(()=>worker.answer({words:1},0));expect(state().pending).toBe(true);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({text:texts[2]}));
  await act(()=>worker.answer({words:6000},1));expect(state().value.words).toBe(6000);expect(FakeWorker.instances).toHaveLength(1);
 });
 it('terminates a timed-out thread and automatically starts the latest queued job',async()=>{
  mount();await act(()=>root!.render(createElement(Outline,{text:'first '.repeat(5000),strict:true})));await act(()=>vi.advanceTimersByTime(0));
  const failed=FakeWorker.instances[0],late=failed.onmessage;
  const text='# Latest\n'+'body '.repeat(5000);await act(()=>root!.render(createElement(Outline,{text,strict:true})));await act(()=>vi.advanceTimersByTime(0));
  await act(()=>vi.advanceTimersByTime(ANALYSIS_TIMEOUT_MS));expect(failed.terminate).toHaveBeenCalled();expect(FakeWorker.instances).toHaveLength(2);expect(state().pending).toBe(true);
  await act(()=>late?.({data:{id:1,ok:true,value:[{title:'Old'}]}} as MessageEvent));expect(state().pending).toBe(true);
  await act(()=>FakeWorker.instances[1].answer([{title:'Latest'}]));expect(state().value[0].title).toBe('Latest');expect(state().error).toBeUndefined();
 });
 it('reports an active timeout and recreates the thread for a subsequent request',async()=>{
  mount();const text='body '.repeat(5000);await act(()=>root!.render(createElement(Statistics,{text,speed:300})));await act(()=>vi.advanceTimersByTime(60));
  await act(()=>vi.advanceTimersByTime(ANALYSIS_TIMEOUT_MS));expect(state().pending).toBe(false);expect(state().error).toContain('超过时限');
  await act(()=>root!.render(createElement(Statistics,{text,speed:100})));await act(()=>vi.advanceTimersByTime(60));
  await act(()=>FakeWorker.instances[1].answer({words:5000,minutes:50}));expect(state().value.minutes).toBe(50);expect(state().error).toBeUndefined();
 });
 it('releases the worker for short documents and on unmount, then creates a fresh one if needed',async()=>{
  mount();const text='body '.repeat(5000);await act(()=>root!.render(createElement(Statistics,{text,speed:300})));await act(()=>vi.advanceTimersByTime(60));
  const worker=FakeWorker.instances[0],late=worker.onmessage;await act(()=>root!.render(createElement(Statistics,{text:'short',speed:300})));expect(worker.terminate).toHaveBeenCalledTimes(1);
  await act(()=>late?.({data:{id:1,ok:true,value:{words:999}}} as MessageEvent));expect(state().value.words).toBe(1);expect(state().pending).toBe(false);
  await act(()=>root!.render(createElement(Statistics,{text,speed:300})));await act(()=>vi.advanceTimersByTime(60));expect(FakeWorker.instances).toHaveLength(2);
  await act(()=>root!.unmount());root=undefined;expect(FakeWorker.instances[1].terminate).toHaveBeenCalledTimes(1);
 });
 it('reports posting and response failures and recovers without a synchronous fallback',async()=>{
  mount();const text='body '.repeat(5000);await act(()=>root!.render(createElement(Statistics,{text,speed:300})));await act(()=>vi.advanceTimersByTime(60));
  await act(()=>FakeWorker.instances[0].deliver({id:1,ok:false,error:'解析失败'}));expect(state().error).toBe('解析失败');expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
  await act(()=>root!.render(createElement(Statistics,{text,speed:200})));await act(()=>vi.advanceTimersByTime(60));
  const current=FakeWorker.instances[1];await act(()=>current.answer({words:5000}));expect(state().error).toBeUndefined();
  current.postMessage.mockImplementationOnce(()=>{throw new Error('DataCloneError');});
  await act(()=>root!.render(createElement(Statistics,{text,speed:100})));await act(()=>vi.advanceTimersByTime(60));expect(state().error).toContain('无法启动');expect(current.terminate).toHaveBeenCalled();
 });
 it('ignores a late regex answer after the query changes',async()=>{
  mount();await act(()=>root!.render(createElement(Search,{text:'cat dog',query:'cat'})));const old=FakeWorker.instances[0];await act(()=>root!.render(createElement(Search,{text:'cat dog',query:'dog'})));expect(old.terminate).toHaveBeenCalled();await act(()=>old.deliver({matches:[{from:0,to:3,text:'cat'}],error:null,truncated:false}));expect(state().matches).toEqual([]);await act(()=>FakeWorker.instances[1].deliver({matches:[{from:4,to:7,text:'dog'}],error:null,truncated:false}));expect(state().matches[0].from).toBe(4);
 });
 it('bounds regex replacement time and never substitutes a synchronous fallback',async()=>{
  mount();const pending=calculateReplacement('a'.repeat(30000),'a+','x',options);const rejected=expect(pending).rejects.toThrow('超过时限');await act(()=>vi.advanceTimersByTime(SEARCH_TIMEOUT_MS+1));await rejected;expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({kind:'replace'}));expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();vi.stubGlobal('Worker',undefined);await expect(calculateReplacement('abc','a','x',options)).rejects.toThrow('不可用');
 });
});
