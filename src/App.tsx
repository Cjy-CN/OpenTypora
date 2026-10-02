import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DocumentStore, createDocument } from './core/document';
import { CommandRegistry } from './core/commands';
import { COMMANDS, matchesShortcut } from './shared/command-catalog';
import { SettingsStore } from './shared/settings';
import { desktop } from './platform/desktop';
const store=new DocumentStore(createDocument());
const settingsStore=new SettingsStore();
export function App(){
  const document=useSyncExternalStore(store.subscribe,store.getSnapshot), settings=useSyncExternalStore(settingsStore.subscribe,settingsStore.getSnapshot);
  const [message,setMessage]=useState('共同基线：文档模型、命令和配置已接入。'),[sourceMode,setSourceMode]=useState(true);
  const registry=useMemo(()=>new CommandRegistry(COMMANDS),[]);
  const context=useMemo(()=>({document:store,notify:setMessage}),[]);
  useEffect(()=>{
    const registrations=[
      registry.register('edit.undo',()=>store.undo(),()=>store.canUndo()),registry.register('edit.redo',()=>store.redo(),()=>store.canRedo()),
      registry.register('file.new',()=>{if(store.getSnapshot().dirty&&!window.confirm('放弃当前未保存内容？'))return;store.replaceSession(createDocument());}),
      registry.register('file.open',async()=>{if(!desktop){setMessage('文件打开需要桌面版');return;}if(store.getSnapshot().dirty&&!window.confirm('放弃当前未保存内容？'))return;const result=await desktop.open();if(!result.ok)throw new Error(result.error.message);if(result.value)store.load(result.value);}),
      registry.register('file.save',async()=>{if(!desktop){setMessage('保存需要桌面版');return;}const snapshot=store.getSnapshot();store.patchMetadata({saveState:'saving'});const result=await desktop.save({path:snapshot.path,text:snapshot.text,version:snapshot.version,encoding:snapshot.encoding,bom:snapshot.bom,expectedFingerprint:snapshot.diskFingerprint});if(!result.ok){store.patchMetadata({saveState:result.error.code==='EXTERNAL_CONFLICT'?'conflict':'failed'});throw new Error(result.error.message);}if(result.value){store.markSaved(result.value,snapshot.text);setMessage('已保存');}else store.patchMetadata({saveState:'idle'});}),
      registry.register('view.source',()=>setSourceMode(value=>!value)),registry.register('app.about',()=>setMessage('OpenTypora · 工程共同基线'))
    ];
    void desktop?.loadSettings().then(result=>{if(result.ok)settingsStore.load(result.value);else setMessage(result.error.message);});
    const dispose=desktop?.onCommand(id=>{void registry.execute(id,context).then(result=>{if(!result.ok)setMessage(result.error.message);});});
    return()=>{registrations.forEach(dispose=>dispose());dispose?.();};
  },[registry,context]);
  useEffect(()=>{window.document.title=`${document.path?.split(/[\\/]/).pop()??'未命名'}${document.dirty?' •':''} — OpenTypora`;},[document]);
  useEffect(()=>{const listener=(event:KeyboardEvent)=>{const definition=COMMANDS.find(item=>item.shortcut&&matchesShortcut(event,item.shortcut));if(definition&&registry.isEnabled(definition.id,context)){event.preventDefault();void registry.execute(definition.id,context).then(result=>{if(!result.ok)setMessage(result.error.message);});}};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);},[registry,context]);
  return <div className="baseline-app"><header><strong>OpenTypora</strong><div>{['file.new','file.open','file.save','edit.undo','edit.redo','view.source'].map(id=><button key={id} disabled={!registry.isEnabled(id,context)} onClick={()=>void registry.execute(id,context).then(result=>{if(!result.ok)setMessage(result.error.message);})}>{COMMANDS.find(item=>item.id===id)!.label}</button>)}</div></header><main><textarea aria-label="Markdown 源码" spellCheck={false} value={document.text} readOnly={document.readonly} onCompositionStart={()=>store.setComposing(true)} onCompositionEnd={()=>store.setComposing(false)} onChange={event=>store.replaceText(event.target.value,'input',{anchor:event.target.selectionStart,head:event.target.selectionEnd},'typing')} onSelect={event=>store.setSelection({anchor:event.currentTarget.selectionStart,head:event.currentTarget.selectionEnd})} placeholder="# 开始写作" style={{fontSize:settings['appearance.fontSize']}} /></main><footer><span>{sourceMode?'源码':'即时编辑模块待接入'} · {document.dirty?'未保存':'已保存'} · v{document.version}</span><span>{message}</span></footer></div>;
}
