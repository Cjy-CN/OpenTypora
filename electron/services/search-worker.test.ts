import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RegexSearchWorker} from './search-worker';
import {searchFiles} from './search';
const tracked=vi.hoisted(()=>({workers:[] as import('node:worker_threads').Worker[]}));
vi.mock('node:worker_threads',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:worker_threads')>();
 return {...actual,Worker:class extends actual.Worker {
  constructor(...args:ConstructorParameters<typeof actual.Worker>){super(...args);tracked.workers.push(this);}
 }};
});
let directory:string;
beforeEach(async()=>{tracked.workers=[];directory=await fs.mkdtemp(join(tmpdir(),'opentypora-search-worker-'));});
afterEach(async()=>{await Promise.all(tracked.workers.map(worker=>worker.terminate()));await fs.rm(directory,{recursive:true,force:true});});
const options={regex:true,caseSensitive:false,wholeWord:true};

describe('per-search reusable regex worker',()=>{
 it('uses one thread across files and releases it after the search',async()=>{
  await fs.mkdir(join(directory,'child'));
  await fs.writeFile(join(directory,'a.md'),'😀\r\nAlpha alphaBeta\r\nALPHA\r\n');
  await fs.writeFile(join(directory,'b.txt'),'Alpha');
  await fs.writeFile(join(directory,'child','c.md'),'alpha\n');
  const expected=await searchFiles(directory,'alpha',{...options,regex:false});
  expect(tracked.workers).toHaveLength(0);
  expect(await searchFiles(directory,'alpha',options)).toEqual(expected);
  expect(expected).toHaveLength(4);expect(expected.find(match=>match.line===2)).toMatchObject({from:4,to:9});
  expect(tracked.workers).toHaveLength(1);expect(tracked.workers[0].threadId).toBe(-1);
 });
 it('isolates simultaneous searches and their match results',async()=>{
  await fs.writeFile(join(directory,'a.md'),'alpha\nbeta\nalpha\n');await fs.writeFile(join(directory,'b.md'),'beta\n');
  const [alpha,beta]=await Promise.all([searchFiles(directory,'alpha',options),searchFiles(directory,'beta',options)]);
  expect(alpha.map(match=>match.excerpt)).toEqual(['alpha','alpha']);expect(beta.map(match=>match.excerpt)).toEqual(['beta','beta']);
  expect(tracked.workers).toHaveLength(2);expect(tracked.workers.every(worker=>worker.threadId===-1)).toBe(true);
 });
 it('creates no worker for empty or already cancelled searches',async()=>{
  expect(await searchFiles(directory,'',options)).toEqual([]);
  const controller=new AbortController();controller.abort();
  await expect(searchFiles(directory,'alpha',options,controller.signal)).rejects.toMatchObject({code:'CANCELLED'});
  expect(tracked.workers).toHaveLength(0);
 });
 it('resets matching state between jobs and advances empty matches by Unicode code point',async()=>{
  const worker=new RegexSearchWorker();
  try{
   expect(await worker.matches('📝x',/(?=.)/gu)).toEqual([{line:1,excerpt:'📝x',from:0,to:0},{line:1,excerpt:'📝x',from:2,to:2}]);
   expect(await worker.matches('x\nx',/x/g)).toEqual([{line:1,excerpt:'x',from:0,to:1},{line:2,excerpt:'x',from:2,to:3}]);
   expect(tracked.workers).toHaveLength(1);
  }finally{await worker.dispose();}
 });
 it('terminates runaway regex work, keeps the main loop responsive, and restarts for the next file',async()=>{
  const worker=new RegexSearchWorker();let responsive=false;
  try{
   const pending=worker.matches('a'.repeat(200)+'!',/(a+)+$/g);setTimeout(()=>{responsive=true;},50);
   await expect(pending).rejects.toMatchObject({code:'REGEX_TIMEOUT'});expect(responsive).toBe(true);
   expect(await worker.matches('aaaa',/(a+)+$/g)).toMatchObject([{from:0,to:4}]);expect(tracked.workers).toHaveLength(2);
  }finally{await worker.dispose();}
 },5000);
 it('aborts active matching and allows independent subsequent work',async()=>{
  const worker=new RegexSearchWorker(),controller=new AbortController();
  try{
   const pending=worker.matches('a'.repeat(200)+'!',/(a+)+$/g,controller.signal);
   const rejected=expect(pending).rejects.toMatchObject({code:'CANCELLED'});controller.abort();await rejected;
   expect(await worker.matches('safe',/safe/g)).toMatchObject([{from:0,to:4}]);expect(tracked.workers).toHaveLength(2);
  }finally{await worker.dispose();}
 });
 it('preserves the result limit and releases the search thread on failure',async()=>{
  await fs.writeFile(join(directory,'limit.md'),'x'.repeat(20000));
  await expect(searchFiles(directory,'x',{...options,wholeWord:false})).rejects.toMatchObject({code:'SEARCH_LIMIT'});
  expect(tracked.workers).toHaveLength(1);expect(tracked.workers[0].threadId).toBe(-1);
 });
 it('returns completed matches alongside a timeout failure and releases all threads',async()=>{
  await fs.writeFile(join(directory,'a.md'),'aaaa');await fs.writeFile(join(directory,'b.md'),'a'.repeat(200)+'!');
  try{await searchFiles(directory,'(a+)+$',{...options,wholeWord:false});throw new Error('Expected partial search failure');}
  catch(error){expect(error).toMatchObject({code:'SEARCH_PARTIAL'});const detail=JSON.parse((error as {detail:string}).detail);expect(detail.matches).toMatchObject([{from:0,to:4}]);expect(detail.failures).toHaveLength(1);expect(detail.failures[0].error).toContain('超过1秒');}
  expect(tracked.workers.every(worker=>worker.threadId===-1)).toBe(true);
 },5000);
});
