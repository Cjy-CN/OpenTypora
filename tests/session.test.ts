import {describe,expect,it,vi} from 'vitest';
import {SessionCoordinator} from '../src/platform/session';
import {DocumentStore,createDocument} from '../src/core/document';
import type {DesktopBridge,SavedFile} from '../src/shared/contracts';
const saved:SavedFile={path:'E:/a.md',version:1,fingerprint:{modifiedAt:1,size:1,hash:'x'}};
const prompts=()=>({leave:vi.fn(async()=> 'save' as const),conflict:vi.fn(async()=> 'cancel' as const),notify:vi.fn()});
describe('file session transitions',()=>{
  it('retains later edits and rejects switching when a save snapshot becomes outdated',async()=>{const store=new DocumentStore(createDocument('first'));let finish!:(value:unknown)=>void;const bridge={save:vi.fn(()=>new Promise(resolve=>finish=resolve)),deleteRecovery:vi.fn(async()=>({ok:true,value:undefined}))} as unknown as DesktopBridge;const coordinator=new SessionCoordinator(store,bridge,prompts());const operation=coordinator.newDocument();await new Promise(resolve=>setTimeout(resolve,0));store.replaceText('later');finish({ok:true,value:{...saved,version:0}});expect(await operation).toBe(false);expect(store.getSnapshot().text).toBe('later');expect(store.getSnapshot().dirty).toBe(true);});
  it('never closes a dirty document after cancelling save',async()=>{const store=new DocumentStore(createDocument('unsaved'));const bridge={save:vi.fn(async()=>({ok:true,value:null})),windowAction:vi.fn()} as unknown as DesktopBridge;expect(await new SessionCoordinator(store,bridge,prompts()).close()).toBe(false);expect(bridge.windowAction).not.toHaveBeenCalled();});
  it('never silently overwrites a disk conflict',async()=>{const store=new DocumentStore(createDocument('unsaved'));const bridge={save:vi.fn(async()=>({ok:false,error:{code:'EXTERNAL_CONFLICT',message:'changed',retryable:true}}))} as unknown as DesktopBridge;const dialogs=prompts();expect(await new SessionCoordinator(store,bridge,dialogs).save()).toBe(false);expect(dialogs.conflict).toHaveBeenCalledOnce();expect(bridge.save).toHaveBeenCalledOnce();expect(store.getSnapshot().saveState).toBe('conflict');});
});
