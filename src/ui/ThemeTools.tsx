import {localizeUi,useUiLanguage} from './i18n';
import {useRef,useState} from 'react';
import type {SettingsStore} from '../shared/settings';
export function ThemeTools({settingsStore,onCommand,notify}:{settingsStore:SettingsStore;onCommand:(id:string,arg?:unknown)=>void;notify:(message:string)=>void}){
 const language=useUiLanguage();
 const input=useRef<HTMLInputElement>(null);const [error,setError]=useState('');
 return localizeUi(<div className="settings-actions"><button onClick={()=>input.current?.click()}>加载 CSS 文件</button><input ref={input} type="file" accept=".css,text/css" hidden aria-label="加载自定义主题文件" onChange={event=>{const file=event.target.files?.[0];if(!file)return;void file.text().then(css=>{if(!css.trim())throw new Error('主题文件为空。');const result=settingsStore.set('appearance.customCss',css);if(!result.ok)throw new Error(result.error.message);settingsStore.set('appearance.theme','custom');setError('');notify(`已加载主题 ${file.name}。`);}).catch(error=>setError(error instanceof Error?error.message:'读取 CSS 失败'));event.target.value='';}}/><button onClick={()=>onCommand('theme.folder')}>打开主题目录</button><button onClick={()=>onCommand('theme.discover')}>获取主题</button>{error&&<p className="workspace-error" role="alert">{error}</p>}</div>,language);
}
