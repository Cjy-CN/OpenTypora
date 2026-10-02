// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {DocumentStore,createDocument} from '../core/document';
import {CommandRegistry} from '../core/commands';
import {COMMANDS} from '../shared/command-catalog';
import {SettingsStore} from '../shared/settings';
import {WorkspaceShell,WORKSPACE_COMMAND_IDS} from './WorkspaceShell';
import {DEFAULT_EXPORT_PROFILES} from './export-profiles';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined,container:HTMLDivElement;
afterEach(async()=>{if(root)await act(()=>root!.unmount());root=undefined;container?.remove();localStorage.clear();vi.restoreAllMocks();});
async function mount(text='# Heading\nhello HELLO\n'){
 const store=new DocumentStore(createDocument(text)),settingsStore=new SettingsStore(),registry=new CommandRegistry(COMMANDS),notify=vi.fn(),navigate=vi.fn(),context={document:store,notify};
 settingsStore.set('export.profiles',JSON.stringify(DEFAULT_EXPORT_PROFILES));
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 const onCommand=(id:string,arg?:unknown)=>{void registry.execute(id,context,arg);};
 await act(async()=>{root!.render(createElement(WorkspaceShell,{store,settingsStore,registry,context,editor:createElement('textarea',{'aria-label':'test editor',defaultValue:text}),message:'',onCommand,onNavigate:navigate}));});
 return {store,settingsStore,registry,context,navigate};
}
function input(label:string){return container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;}
async function enter(element:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));});}
describe('workspace integration',()=>{
 it('registers exactly the owned commands and unregisters on close',async()=>{const {registry}=await mount();expect(new Set(registry.implementedIds())).toEqual(new Set(WORKSPACE_COMMAND_IDS));await act(()=>root!.unmount());root=undefined;expect(registry.implementedIds()).toEqual([]);});
 it('keeps source and version unchanged for themes, outline and statistics',async()=>{const {store,registry,context,settingsStore}=await mount();const initial=store.getSnapshot();await act(()=>registry.execute('theme.night',context));expect(settingsStore.getSnapshot()['appearance.theme']).toBe('night');await act(()=>registry.execute('view.statistics',context));expect(container.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('字数统计');expect(store.getSnapshot().text).toBe(initial.text);expect(store.getSnapshot().version).toBe(initial.version);});
 it('rejects invalid regex and makes replacement one undo step',async()=>{vi.spyOn(window,'confirm').mockReturnValue(true);const {registry,context,store}=await mount('hello hello');await act(()=>registry.execute('search.replace',context));await enter(input('文内查找'),'hello');await enter(input('替换为'),'world');expect(registry.isEnabled('search.replaceAll',context)).toBe(true);await act(()=>registry.execute('search.replaceAll',context));expect(store.getSnapshot().text).toBe('world world');store.undo();expect(store.getSnapshot().text).toBe('hello hello');await act(async()=>{container.querySelector<HTMLButtonElement>('[aria-label="正则表达式"]')!.click();});await enter(input('文内查找'),'[');expect(container.querySelector('[role=alert]')?.textContent).toContain('正则无效');expect(registry.isEnabled('search.replaceAll',context)).toBe(false);});
 it('uses actual command availability in menus',async()=>{await mount();await act(async()=>{[...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='文件')!.click();});const newWindow=[...container.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(button=>button.textContent?.includes('新建窗口'));expect(newWindow?.disabled).toBe(true);});
 it('uses all schema settings with Chinese labels and validates advanced input atomically',async()=>{const {registry,context,settingsStore}=await mount();await act(()=>registry.execute('file.preferences',context));await enter(input('搜索设置'),'缩放');expect(container.textContent).toContain('界面缩放百分比');await act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent==='高级配置')!.click();});const editor=container.querySelector<HTMLTextAreaElement>('[aria-label="高级配置 JSON"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(editor,'{"appearance.zoom":120,"unknown":true}');editor.dispatchEvent(new Event('input',{bubbles:true}));[...container.querySelectorAll('button')].find(button=>button.textContent==='校验并应用')!.click();});expect(settingsStore.getSnapshot()['appearance.zoom']).toBe(100);expect(container.querySelector('[role=alert]')?.textContent).toContain('未知设置');});
 it('keeps search text outside the source and disables readonly replacement',async()=>{const {registry,context,store}=await mount('cat cat');store.patchMetadata({readonly:true});await act(()=>registry.execute('search.replace',context));await enter(input('文内查找'),'cat');await enter(input('替换为'),'dog');expect(registry.isEnabled('search.replaceAll',context)).toBe(false);expect(store.getSnapshot().text).toBe('cat cat');});
});
