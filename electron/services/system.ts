import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { Storage } from './storage';
import { atomicWrite, readFile } from './files';
import { runCommand, redact } from './process';
import { absolutePath, object, serviceError, string, url } from './validation';
export interface SystemAdapter { version:string; platform:string; executable:string; userData:string; packaged?:boolean; applicationPath?:string; openPath:(path:string)=>Promise<string>; openExternal:(url:string)=>Promise<void>; request?:(url:string,init?:RequestInit)=>Promise<Response> }
export class SystemService {
  private download:AbortController|null=null;
  private downloaded:string|null=null;
  constructor(readonly storage:Storage,readonly adapter:SystemAdapter){}
  private async request(address:string,init:RequestInit={}):Promise<Response>{return(this.adapter.request||fetch)(address,{...init,signal:init.signal||AbortSignal.timeout(30_000)});}
  async checkUpdates():Promise<unknown>{
    const settings=await this.storage.loadSettings(),endpoint=url(settings['general.serviceSource']||'https://api.github.com/repos/Cjy-CN/OpenTypora/releases/latest',['https:','http:']);let response:Response;
    try{response=await this.request(endpoint,{headers:{Accept:'application/vnd.github+json'}});}catch{throw serviceError('UPDATE_NETWORK','更新源不可访问，已尝试代理；请检查网络、代理和发行源');}
    if(!response.ok)throw serviceError('UPDATE_HTTP',`更新源 HTTP ${response.status}；私有仓库需要可访问的发行镜像，不在配置中粘贴凭据`);
    let release=await response.json();if(Array.isArray(release))release=release.find(item=>!item.draft&&(settings['general.developmentUpdates']===true||!item.prerelease));if(!release)return{current:this.adapter.version,available:false,channel:settings['general.developmentUpdates']?'development':'stable'};
    const latest=String(release.tag_name||release.version||'').replace(/^v/,'');if(!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(latest))throw serviceError('UPDATE_INVALID','发行源未提供有效版本');
    const version=(value:string)=>value.replace(/^v/,'').split(/[-+]/)[0].split('.').map(Number),a=version(latest),b=version(this.adapter.version);let newer=false;for(let i=0;i<3;i++){if(a[i]!==b[i]){newer=a[i]>b[i];break;}}
    const assets=Array.isArray(release.assets)?release.assets:[];return{current:this.adapter.version,version:latest,available:newer&&!release.draft&&(!release.prerelease||settings['general.developmentUpdates']===true),channel:release.prerelease?'development':'stable',notes:String(release.body||release.notes||''),url:release.html_url,assets:assets.filter((asset:{name?:string})=>/\.(exe|msi|zip)$/i.test(asset.name||'')).map((asset:{name:string;browser_download_url:string;size:number;digest?:string})=>({name:asset.name,url:asset.browser_download_url,size:asset.size,digest:asset.digest}))};
  }
  async downloadUpdate(options:Record<string,unknown>):Promise<unknown>{
    const address=url(options.url,['https:','http:']),name=basename(new URL(address).pathname);if(!/\.(exe|msi|zip)$/i.test(name))throw serviceError('UPDATE_INVALID','更新文件必须是exe/msi/zip发行物');const check=await this.checkUpdates() as {assets?:{url:string}[]};if(!check.assets?.some(asset=>asset.url===address))throw serviceError('UPDATE_INVALID','下载地址不属于已配置发行源');
    this.download?.abort();this.download=new AbortController();const directory=join(this.adapter.userData,'updates');await fs.mkdir(directory,{recursive:true});const path=join(directory,name);let total=0;const chunks:Buffer[]=[];
    try{const response=await this.request(address,{signal:this.download.signal});if(!response.ok||!response.body)throw serviceError('UPDATE_HTTP',`下载失败 HTTP ${response.status}`);const reader=response.body.getReader();while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>800_000_000){await reader.cancel();throw serviceError('UPDATE_SIZE','更新包超过800MB限制');}chunks.push(Buffer.from(value));}const data=Buffer.concat(chunks);if(options.sha256&&createHash('sha256').update(data).digest('hex')!==string(options.sha256))throw serviceError('UPDATE_INTEGRITY','更新包校验不一致');await atomicWrite(path,data);this.downloaded=path;return{path,size:total,status:'downloaded',sha256:createHash('sha256').update(data).digest('hex')};}finally{this.download=null;}
  }
  async installUpdate():Promise<unknown>{if(!this.downloaded)throw serviceError('UPDATE_NOT_DOWNLOADED','请先下载更新');const error=await this.adapter.openPath(this.downloaded);if(error)throw serviceError('UPDATE_INSTALL',error);return{status:extname(this.downloaded)==='.zip'?'archive-opened':'installer-opened',path:this.downloaded};}
  cancelUpdate(){this.download?.abort();return{status:'cancelled'};}
  async shellNew(add:boolean):Promise<unknown>{
    if(this.adapter.platform!=='win32')throw serviceError('PLATFORM_UNSUPPORTED','资源管理器新建集成仅支持Windows');
    const key='HKCU\\Software\\Classes\\.md\\ShellNew',association='HKCU\\Software\\Classes\\.md',progid='HKCU\\Software\\Classes\\OpenTypora.md';
    const query=async(path:string,args:string[]=[])=>runCommand('reg.exe',['query',path,...args],{timeout:10_000}).then(result=>result.stdout,error=>{if((error as {code?:string}).code==='COMMAND_FAILED')return null;throw error;});
    const existing=await query(key),owner=existing?await query(key,['/v','OpenTyporaOwner']):null;
    if(existing&&!owner?.includes('org.opentypora.desktop'))throw serviceError('INTEGRATION_CONFLICT','已有应用拥有Markdown新建项，OpenTypora未改写；请先由原应用移除该项');
    if(add){
      const globalExisting=await query('HKCR\\.md\\ShellNew');if(!existing&&globalExisting)throw serviceError('INTEGRATION_CONFLICT','系统已有Markdown新建项，未覆盖其他应用');
      const directory=join(this.adapter.userData,'shell');await fs.mkdir(directory,{recursive:true});const template=join(directory,'OpenTypora.md');await atomicWrite(template,'');
      const defaultValue=await query('HKCR\\.md',['/ve']);let createdAssociation=false;
      if(!defaultValue||!defaultValue.match(/REG_SZ\s+\S/)){
        const quote=(value:string)=>`"${value.replace(/"/g,'')}"`,command=`${quote(this.adapter.executable)}${this.adapter.packaged===false&&this.adapter.applicationPath?` ${quote(this.adapter.applicationPath)}`:''} "%1"`;
        await runCommand('reg.exe',['add',progid,'/ve','/t','REG_SZ','/d','OpenTypora Markdown','/f'],{timeout:10_000});await runCommand('reg.exe',['add',`${progid}\\shell\\open\\command`,'/ve','/t','REG_SZ','/d',command,'/f'],{timeout:10_000});await runCommand('reg.exe',['add',association,'/ve','/t','REG_SZ','/d','OpenTypora.md','/f'],{timeout:10_000});createdAssociation=true;
      }
      await runCommand('reg.exe',['add',key,'/v','OpenTyporaOwner','/t','REG_SZ','/d','org.opentypora.desktop','/f'],{timeout:10_000});await runCommand('reg.exe',['add',key,'/v','FileName','/t','REG_SZ','/d',template,'/f'],{timeout:10_000});await this.storage.save('shell-integration',{key,createdAssociation:(await this.storage.load('shell-integration')).createdAssociation||createdAssociation});return{added:true,key,restartExplorerMayBeNeeded:true};
    }
    if(existing)await runCommand('reg.exe',['delete',key,'/f'],{timeout:10_000});const state=await this.storage.load('shell-integration');
    if(state.createdAssociation&&(await query(association,['/ve']))?.match(/REG_SZ\s+OpenTypora\.md\s*$/m)){await runCommand('reg.exe',['delete',association,'/ve','/f'],{timeout:10_000});await runCommand('reg.exe',['delete',progid,'/f'],{timeout:10_000});}
    await this.storage.save('shell-integration',{});return{removed:true,key,restartExplorerMayBeNeeded:true};
  }
  async action(action:string,input:unknown={}):Promise<unknown>{const options=object(input,'系统选项');switch(action){
    case'file.properties':{const file=await readFile(absolutePath(options.path));return{path:file.path,size:file.fingerprint.size,modifiedAt:file.fingerprint.modifiedAt,encoding:file.encoding,bom:file.bom,readonly:file.readonly,lineEnding:/\r\n/.test(file.text)?/(?<!\r)\n/.test(file.text)?'mixed':'CRLF':'LF'};}
    case'file.readEncoding':return readFile(absolutePath(options.path),string(options.encoding,'编码'));
    case'history.list':return this.storage.history();case'history.clear':await this.storage.save('history',[]);return undefined;
    case'config.open':{const path=join(this.adapter.userData,'settings.json');try{await fs.access(path);}catch{await this.storage.saveSettings({});}const error=await this.adapter.openPath(path);if(error)throw serviceError('OPEN_FAILED',error);return{path};}
    case'config.reload':return this.storage.loadSettings();case'config.reset':{const backup=await this.storage.backup('settings');await this.storage.saveSettings({});return{backup};}
    case'warnings.reset':await this.storage.save('warnings',{});return undefined;
    case'themes.open':{const path=join(this.adapter.userData,'themes');await fs.mkdir(path,{recursive:true});const error=await this.adapter.openPath(path);if(error)throw serviceError('OPEN_FAILED',error);return{path};}
    case'exportProfiles.load':return this.storage.load('export-profiles',[]);case'exportProfiles.save':await this.storage.saveProfiles(options.profiles as never);return undefined;
    case'updates.check':return this.checkUpdates();case'updates.download':return this.downloadUpdate(options);case'updates.install':return this.installUpdate();case'updates.cancel':return this.cancelUpdate();
    case'shellNew.add':return this.shellNew(true);case'shellNew.remove':return this.shellNew(false);
    case'telemetry.status':{const settings=await this.storage.loadSettings(),endpoint=String(settings['general.telemetryEndpoint']||'');return{enabled:settings['general.telemetry']===true,endpointConfigured:!!endpoint,endpoint,message:endpoint?'仅发送事件类型、应用版本和平台，不发送正文/文件名/路径':'未配置接收端，不发送任何数据'};}
    case'telemetry.send':{const settings=await this.storage.loadSettings();if(settings['general.telemetry']!==true)throw serviceError('TELEMETRY_DISABLED','匿名使用数据未启用，未发送任何数据');const endpoint=String(settings['general.telemetryEndpoint']||'');if(!endpoint)throw serviceError('TELEMETRY_NO_ENDPOINT','尚未配置OpenTypora数据接收端，未发送任何数据');const event=string(options.event,'事件');if(!['app.open','document.open','export.completed','feature.used','error.code'].includes(event))throw serviceError('INVALID_TELEMETRY_EVENT','事件类型不在匿名使用数据白名单');const payload={event,version:this.adapter.version,platform:this.adapter.platform};const response=await this.request(url(endpoint,['https:','http:']),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!response.ok)throw serviceError('TELEMETRY_HTTP',`数据接收端 HTTP ${response.status}`);return{sent:true,fields:Object.keys(payload)};}
    case'diagnostics':return{version:this.adapter.version,platform:this.adapter.platform,node:process.versions.node,electron:process.versions.electron,userData:this.adapter.userData,settingsPath:join(this.adapter.userData,'settings.json')};
    case'diagnostics.log':{const message=redact(string(options.message,'日志',10_000));await fs.mkdir(join(this.adapter.userData,'logs'),{recursive:true});await fs.appendFile(join(this.adapter.userData,'logs','diagnostics.log'),`${new Date().toISOString()} ${message}\n`);return undefined;}
    default:throw serviceError('INVALID_SYSTEM_ACTION',`未注册的系统操作：${action}`);
  }}
}
