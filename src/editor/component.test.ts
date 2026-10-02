// @vitest-environment jsdom
import { afterEach,beforeAll,describe,expect,it,vi } from 'vitest';
import { act,createElement,createRef } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { DocumentStore,createDocument } from '../core/document';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { DesktopBridge } from '../shared/contracts';
import type { EditorHandle,EditorProps } from '../shared/components';
import { MarkdownEditor } from './MarkdownEditor';
import { htmlToMarkdown } from './html-paste';
const roots:Root[]=[];
beforeAll(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  Range.prototype.getClientRects=()=>[] as unknown as DOMRectList;Range.prototype.getBoundingClientRect=()=>new DOMRect();
  Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}})});
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
});
afterEach(async()=>{await act(async()=>roots.splice(0).forEach(root=>root.unmount()));document.body.innerHTML='';});
async function mount(text:string,overrides:Partial<EditorProps>={}){
  const store=new DocumentStore(createDocument(text)),ref=createRef<EditorHandle>(),host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);
  let props:EditorProps={store,settings:{...DEFAULT_SETTINGS},sourceMode:false,focusMode:false,typewriterMode:false,...overrides};
  await act(async()=>root.render(createElement(MarkdownEditor,{...props,ref})));
  const view=EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
  return {store,ref,host,view,render:async(next:Partial<EditorProps>)=>{props={...props,...next};await act(async()=>root.render(createElement(MarkdownEditor,{...props,ref})));}};
}
describe('same-source editor integration',()=>{
  it('renders rich inactive blocks and reveals a cross-block selection without mutating source',async()=>{
    const text='# 标题\r\n\r\n**粗体** 与 [链接](https://example.com)\r\n\r\n| A | B |\r\n| --- | --- |\r\n| 甲 | 😀 |',editor=await mount(text);
    expect(editor.host.querySelector('.ot-preview-block strong')?.textContent).toBe('粗体');expect(editor.host.querySelector('table')).not.toBeNull();const snapshot=editor.store.getSnapshot();
    await act(async()=>{await editor.ref.current!.execute('selection.all');});expect(editor.store.getSnapshot().text).toBe(text);expect(editor.store.getSnapshot().version).toBe(snapshot.version);expect(editor.view.state.selection.main.to).toBe(editor.view.state.doc.length);expect(editor.host.querySelector('table')).toBeNull();
  });
  it('shares typing, commands and undo across source/live mode without changing mixed newline bytes',async()=>{
    const text='😀\r\n正文\n未闭合 **',editor=await mount(text,{sourceMode:true});
    await act(async()=>editor.view.dispatch({changes:{from:3,to:3,insert:'甲'},selection:{anchor:4},userEvent:'input.type'}));expect(editor.store.getSnapshot().text).toBe('😀\r\n甲正文\n未闭合 **');
    await editor.render({sourceMode:false});await act(async()=>editor.store.setSelection({anchor:4,head:7}));await act(async()=>{await editor.ref.current!.execute('format.bold');});const version=editor.store.getSnapshot().version;
    await editor.render({sourceMode:true});expect(editor.store.getSnapshot().version).toBe(version);await act(async()=>{await editor.ref.current!.execute('edit.undo');await editor.ref.current!.execute('edit.undo');});expect(editor.store.getSnapshot().text).toBe(text);expect(editor.view.state.doc.toString()).toBe('😀\n正文\n未闭合 **');
  });
  it('syncs external source transactions and document loads instead of replaying a stale view',async()=>{
    const editor=await mount('old');await act(async()=>editor.store.replaceText('新😀\r\n文','replace',{anchor:3,head:3}));expect(editor.view.state.doc.toString()).toBe('新😀\n文');expect(editor.view.state.selection.main.head).toBe(3);
    await act(async()=>editor.store.replaceSession(createDocument('另一文档')));expect(editor.view.state.doc.toString()).toBe('另一文档');expect(editor.store.canUndo()).toBe(false);
  });
  it('edits YAML front matter as unformatted raw lines instead of a Setext heading',async()=>{const text='---\ntitle: 测试\ntags: [a, b]\n---\n\n# 正文',editor=await mount(text);const yaml=editor.host.querySelectorAll('.ot-yaml-line');expect(yaml).toHaveLength(4);expect([...yaml].map(line=>line.textContent).join('\n')).toBe('---\ntitle: 测试\ntags: [a, b]\n---');expect(editor.host.querySelector('.ot-yaml-line.ot-edit-heading')).toBeNull();expect(editor.store.getSnapshot().text).toBe(text);});
  it('protects read-only source and defers structure commands during IME composition',async()=>{
    const editor=await mount('中文');const content=editor.host.querySelector('.cm-content')!;await act(async()=>content.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'中'})));expect(editor.store.getSnapshot().composing).toBe(true);expect(await editor.ref.current!.execute('format.bold')).toBe(false);expect(editor.store.getSnapshot().text).toBe('中文');
    await act(async()=>content.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文'})));expect(editor.store.getSnapshot().composing).toBe(false);
    await act(async()=>editor.store.patchMetadata({readonly:true}));expect(await editor.ref.current!.execute('paragraph.heading1')).toBe(false);expect(content.getAttribute('contenteditable')).toBe('false');expect(editor.store.getSnapshot().text).toBe('中文');
  });
  it('scrolls typewriter input once rather than recursively dispatching view effects',async()=>{
    const editor=await mount('a',{typewriterMode:true});await act(async()=>editor.view.dispatch({changes:{from:1,to:1,insert:'b'},selection:{anchor:2},userEvent:'input.type'}));expect(editor.store.getSnapshot().text).toBe('ab');expect(editor.store.getSnapshot().version).toBe(1);
  });
  it('shows search offsets from the same raw UTF-16 source and ignores another document',async()=>{
    const editor=await mount('😀\r\nhello world',{sourceMode:true}),snapshot=editor.store.getSnapshot();await act(async()=>window.dispatchEvent(new CustomEvent('opentypora:search',{detail:{documentId:snapshot.documentId,matches:[{from:4,to:9,text:'hello'}],currentIndex:0}})));expect(editor.host.querySelector('.ot-search-current')?.textContent).toBe('hello');const before=editor.store.getSnapshot().text;await act(async()=>window.dispatchEvent(new CustomEvent('opentypora:search',{detail:{documentId:'other',matches:[],currentIndex:-1}})));expect(editor.host.querySelector('.ot-search-current')).not.toBeNull();expect(editor.store.getSnapshot().text).toBe(before);
  });
  it('scrolls search/navigation targets without collapsing their selection or stealing input focus',async()=>{const editor=await mount('第一行\n第二行\n第三行',{sourceMode:true}),search=document.createElement('input');document.body.append(search);search.focus();await act(async()=>editor.store.setSelection({anchor:4,head:7}));await act(async()=>editor.ref.current!.scrollTo(4));expect(editor.store.getSnapshot().selection).toEqual({anchor:4,head:7});expect(editor.view.state.selection.main.anchor).toBe(4);expect(editor.view.state.selection.main.head).toBe(7);expect(document.activeElement).toBe(search);expect(editor.store.getSnapshot().version).toBe(0);});
  it('keeps the source unchanged when a command parameter dialog is cancelled',async()=>{
    const editor=await mount('正文');await act(async()=>{await editor.ref.current!.execute('format.link');});const dialog=editor.host.querySelector('dialog')!;expect(dialog.open).toBe(true);await act(async()=>dialog.dispatchEvent(new Event('cancel',{cancelable:true})));expect(editor.store.getSnapshot().text).toBe('正文');expect(editor.store.getSnapshot().version).toBe(0);
  });
  it('opens a canonical command from the right-click menu and supports Escape',async()=>{
    const editor=await mount('正文');await act(async()=>editor.store.setSelection({anchor:0,head:2}));await act(async()=>editor.host.querySelector('.ot-editor')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:20})));expect(editor.host.querySelector('[role="menu"]')).not.toBeNull();const bold=[...editor.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button=>button.textContent?.startsWith('粗体'))!;await act(async()=>bold.click());expect(editor.store.getSnapshot().text).toBe('**正文**');
    await act(async()=>editor.host.querySelector('.ot-editor')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:20})));await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));expect(editor.host.querySelector('[role="menu"]')).toBeNull();
  });
  it('navigates to an editable footnote definition and back to the same reference',async()=>{
    const text='# 标题\n\n正文[^abc]\n\n[^abc]: 脚注内容',editor=await mount(text);const reference=editor.host.querySelector('.footnote-ref a')!;expect(reference).not.toBeNull();await act(async()=>reference.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0})));expect(editor.store.getSnapshot().selection.head).toBe(text.lastIndexOf('[^abc]'));
    const backlink=editor.host.querySelector('.footnote-backref')!;await act(async()=>backlink.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0})));expect(editor.store.getSnapshot().selection.head).toBe(text.indexOf('[^abc]'));expect(editor.store.getSnapshot().text).toBe(text);
  });
  it('resolves local Markdown through the authorized bridge without allowing anchor default navigation',async()=>{
    const action=vi.fn(async()=>({ok:true,value:{path:'C:\\docs\\另一.md',url:'opentypora-asset://local/x'}})),openExternal=vi.fn(),onCommand=vi.fn(),bridge={systemAction:action,openExternal} as unknown as DesktopBridge,editor=await mount('# 标题\n\n[打开](另一.md)',{bridge,onCommand});const link=editor.host.querySelector<HTMLAnchorElement>('.ot-preview-block a')!;await act(async()=>link.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,ctrlKey:true})));expect(action).toHaveBeenCalledWith('assets.resolve',{url:encodeURI('另一.md'),documentPath:null});expect(onCommand).toHaveBeenCalledWith('file.open','C:\\docs\\另一.md');expect(openExternal).not.toHaveBeenCalled();const click=new MouseEvent('click',{bubbles:true,cancelable:true});expect(link.dispatchEvent(click)).toBe(false);expect(editor.store.getSnapshot().text).toBe('# 标题\n\n[打开](另一.md)');
  });
});
describe('clipboard and untrusted rich input',()=>{
  it('does not delete source when writing the clipboard fails',async()=>{
    const bridge={systemAction:vi.fn(async()=>({ok:false,error:{code:'CLIPBOARD',message:'剪贴板不可用',retryable:true}}))} as unknown as DesktopBridge,editor=await mount('😀正文',{bridge});await act(async()=>editor.store.setSelection({anchor:0,head:4}));let result:boolean|undefined;await act(async()=>{result=await editor.ref.current!.execute('edit.cut');});expect(result).toBe(false);expect(editor.store.getSnapshot().text).toBe('😀正文');expect(editor.host.querySelector('[role="alert"]')?.textContent).toContain('剪贴板不可用');
  });
  it('copies rendered HTML or source explicitly and deletes only after a successful cut',async()=>{
    const write=vi.fn(async(_action:string,_options?:Record<string,unknown>)=>({ok:true,value:undefined})),bridge={systemAction:write} as unknown as DesktopBridge,editor=await mount('**正文**',{bridge});await act(async()=>editor.store.setSelection({anchor:0,head:6}));await act(async()=>{await editor.ref.current!.execute('edit.copyHTML');});expect(write.mock.calls[0][1]).toEqual(expect.objectContaining({text:expect.stringContaining('<strong>正文</strong>')}));await act(async()=>{await editor.ref.current!.execute('edit.cut');});expect(editor.store.getSnapshot().text).toBe('');await act(async()=>editor.store.undo());expect(editor.store.getSnapshot().text).toBe('**正文**');
  });
  it('rejects a delayed cut against a changed source version',async()=>{
    let finish!:(value:unknown)=>void;const bridge={systemAction:()=>new Promise(resolve=>finish=resolve)} as unknown as DesktopBridge,editor=await mount('原文',{bridge});await act(async()=>editor.store.setSelection({anchor:0,head:2}));let operation!:Promise<boolean>;await act(async()=>{operation=Promise.resolve(editor.ref.current!.execute('edit.cut'));});await act(async()=>editor.store.replaceText('新正文'));await act(async()=>{finish({ok:true,value:undefined});await operation;});expect(editor.store.getSnapshot().text).toBe('新正文');
  });
  it('rejects clipboard text arriving after the user moved to another selection',async()=>{
    let finish!:(value:unknown)=>void;const bridge={systemAction:()=>new Promise(resolve=>finish=resolve)} as unknown as DesktopBridge,editor=await mount('正文',{bridge});let operation!:Promise<boolean>;await act(async()=>{operation=Promise.resolve(editor.ref.current!.execute('edit.paste'));});await act(async()=>editor.store.setSelection({anchor:2,head:2}));await act(async()=>{finish({ok:true,value:{text:'旧内容'}});await operation;});expect(editor.store.getSnapshot().text).toBe('正文');expect(editor.host.querySelector('[role="alert"]')?.textContent).toContain('文档或选区已变化');
  });
  it('converts safe HTML structure and strips executable clipboard content',()=>{
    const result=htmlToMarkdown('<h2>标题</h2><p><b>中文</b> <a href="javascript:alert(1)">链接</a><script>bad()</script></p><table><tr><th>A</th></tr><tr><td>a|b</td></tr></table>');expect(result).toContain('## 标题');expect(result).toContain('**中文**');expect(result).not.toContain('bad()');expect(result).not.toContain('javascript:');expect(result).toContain('a\\|b');
  });
});
