import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ExportProfile, RecoveryDraft } from '../../src/shared/contracts';
import { validateSetting } from '../../src/shared/settings';
import { atomicWrite } from './files';
import { object, safeId, serviceError, string } from './validation';
export class Storage {
  private queues=new Map<string,Promise<unknown>>();
  constructor(readonly directory:string){}
  private async serial<T>(key:string,operation:()=>Promise<T>):Promise<T>{const previous=this.queues.get(key)||Promise.resolve();const task=previous.catch(()=>undefined).then(operation);this.queues.set(key,task);try{return await task;}finally{if(this.queues.get(key)===task)this.queues.delete(key);}}
  async load(name:string,fallback:unknown={}):Promise<any>{try{return JSON.parse(await fs.readFile(join(this.directory,`${safeId(name)}.json`),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw serviceError('CONFIG_CORRUPT',`配置 ${name} 无法读取，请从高级配置备份恢复`);}}
  async save(name:string,value:unknown):Promise<void>{await fs.mkdir(this.directory,{recursive:true});await atomicWrite(join(this.directory,`${safeId(name)}.json`),JSON.stringify(value,null,2));}
  async loadSettings():Promise<Record<string,unknown>>{const settings=object(await this.load('settings'));for(const [key,value]of Object.entries(settings)){const check=validateSetting(key,value);if(!check.ok)throw serviceError(check.error.code,check.error.message);}return settings;}
  async saveSettings(settings:unknown):Promise<void>{const values=object(settings,'配置');for(const [key,value]of Object.entries(values)){const check=validateSetting(key,value);if(!check.ok)throw serviceError(check.error.code,check.error.message);}await this.save('settings',values);}
  async backup(name:string):Promise<string|null>{const path=join(this.directory,`${safeId(name)}.json`),backup=`${path}.${Date.now()}.backup`;try{await fs.copyFile(path,backup);return backup;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
  async writeRecovery(draft:RecoveryDraft):Promise<void>{await this.serial(`recovery-${safeId(draft.id)}`,()=>this.writeRecoveryLocked(draft));}
  private async writeRecoveryLocked(draft:RecoveryDraft):Promise<void>{
    const value=object(draft,'草稿'),id=safeId(value.id),session=object(value.session,'文档');string(session.text,'正文',64_000_000);safeId(session.documentId);safeId(session.recoveryId);
    if(!Number.isFinite(value.savedAt)||!Number.isInteger(session.version))throw serviceError('INVALID_DRAFT','恢复草稿时间或版本错误');
    const directory=join(this.directory,'recovery');await fs.mkdir(directory,{recursive:true});
    const path=join(directory,`${id}.json`);try{const previous=JSON.parse(await fs.readFile(path,'utf8'));if(previous.savedAt>draft.savedAt||(previous.session.documentId===session.documentId&&previous.session.version>Number(session.version)))return;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
    await atomicWrite(path,JSON.stringify(draft));
  }
  async listRecovery():Promise<RecoveryDraft[]>{
    const directory=join(this.directory,'recovery');let names:string[];try{names=await fs.readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error;}
    const drafts:RecoveryDraft[]=[];const corrupt:string[]=[];
    for(const name of names.filter(name=>/^[\w.-]+\.json$/.test(name))){try{const draft=JSON.parse(await fs.readFile(join(directory,name),'utf8'));if(typeof draft.session?.text!=='string'||typeof draft.savedAt!=='number')throw new Error();drafts.push(draft);}catch{corrupt.push(name);}}
    if(corrupt.length)throw serviceError('RECOVERY_CORRUPT','部分恢复草稿损坏，原草稿已保留', { validDrafts:drafts,corrupt });return drafts.sort((a,b)=>b.savedAt-a.savedAt);
  }
  async deleteRecovery(id:string):Promise<void>{await fs.unlink(join(this.directory,'recovery',`${safeId(id)}.json`)).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  async history():Promise<{path:string;kind:string;openedAt:number}[]>{return this.load('history',[]);}
  async remember(path:string,kind='file'):Promise<void>{await this.serial('history',async()=>{const settings=await this.loadSettings();if(settings['file.history']===false)return;const history=await this.history();await this.save('history',[{path,kind,openedAt:Date.now()},...history.filter(item=>item.path!==path)].slice(0,100));});}
  async saveProfiles(profiles:ExportProfile[]):Promise<void>{if(!Array.isArray(profiles)||profiles.length>100)throw serviceError('INVALID_PROFILES','导出配置必须是最多100项的列表');const ids=new Set<string>();for(const profile of profiles){safeId(profile.id);string(profile.name,'名称');if(ids.has(profile.id))throw serviceError('INVALID_PROFILES','导出配置ID重复');ids.add(profile.id);if(!Array.isArray(profile.args)||profile.args.some(arg=>typeof arg!=='string'))throw serviceError('INVALID_PROFILES','导出参数必须是字符串列表');object(profile.options);string(profile.extension,'后缀');}await this.backup('export-profiles');await this.save('export-profiles',profiles);}
}
