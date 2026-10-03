import {useEffect,useRef,useState} from 'react';
import type {AppError,DesktopBridge,Result} from '../shared/contracts';
import {Dialog} from './Dialog';
import './UpdateDialog.css';

interface ReleaseAsset {name:string;url:string;size:number;digest?:string}
interface ReleaseInfo {current:string;version?:string;available:boolean;channel:string;notes:string;url?:string;assets:ReleaseAsset[]}
interface DownloadInfo {path:string;size:number;sha256:string}
type Phase='checking'|'ready'|'downloading'|'cancelled'|'downloaded'|'installing'|'installer-opened'|'archive-opened'|'failed';
export interface UpdateDialogProps {bridge?:DesktopBridge;onClose:()=>void}

const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const invalid=(message:string):AppError=>({code:'UPDATE_INVALID_RESPONSE',message,retryable:true});
const describe=(error:unknown):AppError=>({code:'UPDATE_ACTION_FAILED',message:error instanceof Error?error.message:'更新操作未能完成，请重试。',retryable:true});
function releaseInfo(value:unknown):ReleaseInfo|null {
  const data=record(value);
  if(!data||typeof data.current!=='string'||typeof data.available!=='boolean'||(data.available&&typeof data.version!=='string'))return null;
  const assets:Array<ReleaseAsset>=[];
  if(Array.isArray(data.assets))for(const item of data.assets){const asset=record(item);if(asset&&typeof asset.name==='string'&&typeof asset.url==='string'&&/^https?:\/\//i.test(asset.url)&&/\.(exe|msi|zip)$/i.test(asset.name))assets.push({name:asset.name,url:asset.url,size:typeof asset.size==='number'&&Number.isFinite(asset.size)&&asset.size>=0?asset.size:0,...(typeof asset.digest==='string'?{digest:asset.digest}:{})});}
  return {current:data.current,version:typeof data.version==='string'?data.version:undefined,available:data.available,channel:typeof data.channel==='string'?data.channel:'stable',notes:typeof data.notes==='string'?data.notes:'',url:typeof data.url==='string'&&/^https?:\/\//i.test(data.url)?data.url:undefined,assets};
}
function downloadInfo(value:unknown):DownloadInfo|null {
  const data=record(value);
  return data&&data.status==='downloaded'&&typeof data.path==='string'&&data.path.length>0&&typeof data.size==='number'&&Number.isFinite(data.size)&&data.size>=0&&typeof data.sha256==='string'&&/^[a-f\d]{64}$/i.test(data.sha256)?{path:data.path,size:data.size,sha256:data.sha256}:null;
}
function sizeLabel(size:number){return size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(1)} KB`:`${(size/1024/1024).toFixed(1)} MB`;}

/** Every result comes from the desktop update service; opening an installer is not installation completion. */
export function UpdateDialog({bridge,onClose}:UpdateDialogProps){
  const [phase,setPhase]=useState<Phase>('checking'),[release,setRelease]=useState<ReleaseInfo|null>(null),[selected,setSelected]=useState(''),[download,setDownload]=useState<DownloadInfo|null>(null),[error,setError]=useState<AppError|null>(null),[cancelling,setCancelling]=useState(false),[openedPath,setOpenedPath]=useState('');
  const alive=useRef(false),generation=useRef(0),phaseRef=useRef<Phase>('checking'),cancelRef=useRef(false),closing=useRef(false);
  const transition=(next:Phase)=>{phaseRef.current=next;if(alive.current)setPhase(next);};
  const action=async(name:string,options?:Record<string,unknown>):Promise<Result<unknown>>=>{if(!bridge)return {ok:false,error:{code:'DESKTOP_REQUIRED',message:'检查和安装更新需要桌面版。',retryable:false}};try{return await bridge.systemAction(name,options);}catch(reason){return {ok:false,error:describe(reason)};}};
  const check=async()=>{
    if(['downloading','installing'].includes(phaseRef.current))return;
    const request=++generation.current;transition('checking');setError(null);setRelease(null);setDownload(null);setOpenedPath('');
    const result=await action('updates.check');if(!alive.current||request!==generation.current)return;
    if(!result.ok){setError(result.error);transition('failed');return;}
    const data=releaseInfo(result.value);if(!data){setError(invalid('更新源返回的版本信息无法识别，请检查通用设置中的更新源。'));transition('failed');return;}
    setRelease(data);setSelected(data.assets[0]?.url??'');transition('ready');
  };
  useEffect(()=>{alive.current=true;void check();return()=>{alive.current=false;generation.current++;if(phaseRef.current==='downloading')void action('updates.cancel');};},[bridge]);
  const downloadSelected=async()=>{
    if(!release?.available||phaseRef.current==='downloading'||phaseRef.current==='installing')return;
    const asset=release.assets.find(item=>item.url===selected);if(!asset)return;
    let sha256:string|undefined;
    if(asset.digest){const match=/^(?:sha256:)?([a-f\d]{64})$/i.exec(asset.digest);if(!match){setError(invalid('此发行文件提供了不支持的校验摘要，请在发行源中提供 SHA-256 摘要。'));return;}sha256=match[1].toLowerCase();}
    const request=++generation.current;transition('downloading');setError(null);setDownload(null);setOpenedPath('');
    const result=await action('updates.download',{url:asset.url,...(sha256?{sha256}:{})});if(!alive.current||request!==generation.current)return;
    if(!result.ok){setError(result.error);transition('failed');return;}
    const data=downloadInfo(result.value);if(!data){setError(invalid('下载服务未返回有效文件路径和 SHA-256，无法开始安装。'));transition('failed');return;}
    if(sha256&&data.sha256.toLowerCase()!==sha256){setError({code:'UPDATE_INTEGRITY',message:'下载文件的 SHA-256 与发行摘要不一致，未启动安装。',retryable:true});transition('failed');return;}
    setDownload(data);transition('downloaded');
  };
  const cancel=async():Promise<boolean>=>{
    if(phaseRef.current!=='downloading')return true;if(cancelRef.current)return false;
    cancelRef.current=true;setCancelling(true);const result=await action('updates.cancel');cancelRef.current=false;if(alive.current)setCancelling(false);
    if(!result.ok){if(alive.current)setError(result.error);return false;}
    if(record(result.value)?.status!=='cancelled'){if(alive.current)setError(invalid('下载服务未确认取消，请重试取消下载。'));return false;}
    if(phaseRef.current==='downloading'){generation.current++;transition('cancelled');if(alive.current)setError(null);}
    return true;
  };
  const close=async()=>{
    if(closing.current||phaseRef.current==='installing')return;
    closing.current=true;if(await cancel()){generation.current++;onClose();}closing.current=false;
  };
  const install=async()=>{
    if(!download||!['downloaded','installer-opened','archive-opened'].includes(phaseRef.current))return;
    const request=++generation.current;transition('installing');setError(null);const result=await action('updates.install');if(!alive.current||request!==generation.current)return;
    if(!result.ok){setError(result.error);transition('downloaded');return;}
    const value=record(result.value);if(!value||!['installer-opened','archive-opened'].includes(String(value.status))||typeof value.path!=='string'||!value.path){setError(invalid('系统未确认打开安装文件，请重试或打开文件所在目录。'));transition('downloaded');return;}
    setOpenedPath(value.path);transition(value.status as 'installer-opened'|'archive-opened');
  };
  const openRelease=async()=>{if(!bridge||!release?.url)return;try{const result=await bridge.openExternal(release.url);if(!result.ok)setError(result.error);}catch(reason){setError(describe(reason));}};
  const reveal=async()=>{if(!bridge||!download)return;try{const result=await bridge.reveal(download.path);if(!result.ok)setError(result.error);}catch(reason){setError(describe(reason));}};
  const busy=phase==='checking'||phase==='downloading'||phase==='installing';
  const status=phase==='checking'?'正在检查更新…':phase==='downloading'?'正在下载发行文件，完成后将显示实际路径和校验值。':phase==='cancelled'?'下载已取消，可重新下载。':phase==='installing'?'正在请求系统打开安装文件…':phase==='installer-opened'?'安装程序已打开，请按安装程序提示完成安装。':phase==='archive-opened'?'发行压缩包已打开，请解压后按发行说明使用。':phase==='downloaded'?'下载完成。点击“打开安装文件”后才会启动安装程序。':release?release.available?`发现新版本 ${release.version}`:'当前没有可用更新。':'检查更新失败。';
  return <Dialog title="软件更新" onClose={()=>void close()}><section className="update-dialog"><p role="status" aria-live="polite">{status}</p>{error&&<div role="alert" className="workspace-error"><p>{error.message}</p><code>{error.code}</code>{error.detail&&<pre>{error.detail}</pre>}<p>可重试操作，或在偏好设置 → 通用中检查更新源和代理配置。</p></div>}{release&&<><dl><dt>当前版本</dt><dd data-user-content>{release.current}</dd>{release.version&&<><dt>发行版本</dt><dd data-user-content>{release.version}</dd></>}<dt>发行通道</dt><dd>{release.channel==='development'?'开发版':'稳定版'}</dd></dl>{release.notes&&<div className="update-notes"><h3>发行说明</h3><pre data-user-content>{release.notes}</pre></div>}{release.available&&<>{release.assets.length?<label>发行文件<select aria-label="发行文件" value={selected} disabled={busy||!!download} onChange={event=>setSelected(event.target.value)}>{release.assets.map(asset=><option key={asset.url} value={asset.url}>{asset.name} · {sizeLabel(asset.size)}</option>)}</select></label>:<p role="alert">发行源没有提供 exe、msi 或 zip 文件，请打开发行页面获取安装说明，或检查更新源配置。</p>}<p className="update-checksum-note">{release.assets.find(asset=>asset.url===selected)?.digest?'下载时会核对发行源提供的 SHA-256 摘要。':'发行源未提供校验摘要；下载完成后显示本地 SHA-256。'}</p></>}{release.url&&<button disabled={phase==='installing'} onClick={()=>void openRelease()}>打开发行页面</button>}</>}{download&&<div className="update-downloaded"><dl><dt>文件路径</dt><dd data-user-content>{download.path}</dd><dt>文件大小</dt><dd>{sizeLabel(download.size)}</dd><dt>SHA-256</dt><dd><code data-user-content>{download.sha256}</code></dd></dl>{openedPath&&<p data-user-content>系统打开的文件：{openedPath}</p>}<button disabled={phase==='installing'} onClick={()=>void reveal()}>打开所在目录</button></div>}<div className="action-row"><button disabled={busy||!bridge} onClick={()=>void check()}>重新检查</button>{phase==='downloading'?<button disabled={cancelling} onClick={()=>void cancel()}>{cancelling?'正在取消…':'取消下载'}</button>:download?<button className="primary" disabled={phase==='installing'} onClick={()=>void install()}>打开安装文件</button>:release?.available&&release.assets.length>0?<button className="primary" disabled={busy} onClick={()=>void downloadSelected()}>下载所选文件</button>:null}<button disabled={phase==='installing'||cancelling} onClick={()=>void close()}>关闭</button></div></section></Dialog>;
}
