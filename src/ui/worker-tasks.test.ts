// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {useOutline,useTextStatistics} from './useDocumentAnalysis';
import {useDocumentSearch} from './useDocumentSearch';
import {calculateReplacement,SEARCH_TIMEOUT_MS} from './search-task';
import {statistics} from './model';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
class FakeWorker {
 static instances:FakeWorker[]=[];
 onmessage:((event:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;
 terminate=vi.fn();postMessage=vi.fn();
 constructor(){FakeWorker.instances.push(this);}
 deliver(value:unknown){this.onmessage?.({data:value} as MessageEvent);}
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
 it('recomputes large-document outlines after strict mode changes and rejects the former answer',async()=>{mount();const text='###Loose\r\n'+ 'body '.repeat(5000);await act(()=>root!.render(createElement(Outline,{text,strict:true})));await act(()=>vi.advanceTimersByTime(0));const old=FakeWorker.instances[0];expect(old.postMessage).toHaveBeenCalledWith(expect.objectContaining({kind:'outline',strict:true,text}));await act(()=>root!.render(createElement(Outline,{text,strict:false})));expect(old.terminate).toHaveBeenCalled();await act(()=>vi.advanceTimersByTime(0));const current=FakeWorker.instances[1];expect(current.postMessage).toHaveBeenCalledWith(expect.objectContaining({strict:false}));await act(()=>old.deliver([]));expect(state().pending).toBe(true);await act(()=>current.deliver([{id:'heading-0',title:'Loose',level:3,from:0,to:8,parent:null}]));expect(state().value[0].title).toBe('Loose');expect(state().pending).toBe(false);});
 it('terminates old analysis tasks and rejects their late result',async()=>{
  mount();const first='old '.repeat(6000),second='new '.repeat(6000);
  await act(()=>root!.render(createElement(Statistics,{text:first,speed:382})));await act(()=>vi.advanceTimersByTime(60));const old=FakeWorker.instances[0];
  await act(()=>root!.render(createElement(Statistics,{text:second,speed:382})));expect(old.terminate).toHaveBeenCalled();await act(()=>vi.advanceTimersByTime(60));
  await act(()=>old.deliver(statistics('old',{anchor:0,head:0},382)));expect(state().pending).toBe(true);
  const current=FakeWorker.instances[1];await act(()=>current.deliver({words:6000}));expect(state().value.words).toBe(6000);expect(state().pending).toBe(false);expect(current.terminate).toHaveBeenCalled();
 });
 it('recovers from a failed statistics worker when reading speed changes',async()=>{
  mount();const text='text '.repeat(5000);await act(()=>root!.render(createElement(Statistics,{text,speed:382})));await act(()=>vi.advanceTimersByTime(60));await act(()=>FakeWorker.instances[0].onerror?.());expect(state().error).toContain('无法启动');
  await act(()=>root!.render(createElement(Statistics,{text,speed:100})));await act(()=>vi.advanceTimersByTime(60));await act(()=>FakeWorker.instances[1].deliver({words:5000,minutes:50}));expect(state().error).toBeUndefined();expect(state().value.minutes).toBe(50);
 });
 it('ignores a late regex answer after the query changes',async()=>{
  mount();await act(()=>root!.render(createElement(Search,{text:'cat dog',query:'cat'})));const old=FakeWorker.instances[0];await act(()=>root!.render(createElement(Search,{text:'cat dog',query:'dog'})));expect(old.terminate).toHaveBeenCalled();await act(()=>old.deliver({matches:[{from:0,to:3,text:'cat'}],error:null,truncated:false}));expect(state().matches).toEqual([]);await act(()=>FakeWorker.instances[1].deliver({matches:[{from:4,to:7,text:'dog'}],error:null,truncated:false}));expect(state().matches[0].from).toBe(4);
 });
 it('bounds regex replacement time and never substitutes a synchronous fallback',async()=>{
  mount();const pending=calculateReplacement('a'.repeat(30000),'a+','x',options);const rejected=expect(pending).rejects.toThrow('超过时限');await act(()=>vi.advanceTimersByTime(SEARCH_TIMEOUT_MS+1));await rejected;expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({kind:'replace'}));expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();vi.stubGlobal('Worker',undefined);await expect(calculateReplacement('abc','a','x',options)).rejects.toThrow('不可用');
 });
});
