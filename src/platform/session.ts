import type { DocumentStore } from '../core/document';
import { createDocument } from '../core/document';
import type { DesktopBridge, SavedFile } from '../shared/contracts';
export type LeaveDecision = 'save' | 'discard' | 'cancel';
export interface SessionPrompts {
  leave(): Promise<LeaveDecision>;
  conflict(): Promise<'overwrite'|'saveAs'|'cancel'>;
  notify(message: string): void;
}
/** Serializes file transitions so an in-flight save cannot mark a different document clean. */
export class SessionCoordinator {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private store: DocumentStore, private bridge: DesktopBridge, private prompts: SessionPrompts) {}
  private exclusive<T>(run:()=>Promise<T>) { const next=this.pending.then(run,run);this.pending=next.catch(()=>{});return next; }
  save(as=false) {return this.exclusive(()=>this.saveNow(as));}
  private async saveNow(as=false,force=false):Promise<boolean> {
    const snapshot=this.store.getSnapshot();
    if(snapshot.readonly&&!as){this.prompts.notify('文件为只读，请使用另存为');return false;}
    this.store.patchMetadata({saveState:'saving'});
    const result=await this.bridge.save({path:as?null:snapshot.path,text:snapshot.text,version:snapshot.version,encoding:snapshot.encoding,bom:snapshot.bom,expectedFingerprint:as?null:snapshot.diskFingerprint,force});
    if(!result.ok){if(this.store.getSnapshot().documentId===snapshot.documentId)this.store.patchMetadata({saveState:result.error.code==='EXTERNAL_CONFLICT'?'conflict':'failed'});
      if(result.error.code==='EXTERNAL_CONFLICT'){const choice=await this.prompts.conflict();if(choice==='overwrite')return this.saveNow(false,true);if(choice==='saveAs')return this.saveNow(true);return false;}
      this.prompts.notify(result.error.message);return false;
    }
    if(!result.value){if(this.store.getSnapshot().documentId===snapshot.documentId)this.store.patchMetadata({saveState:'idle'});return false;}
    if(as)this.store.patchMetadata({readonly:false});
    this.acceptSave(result.value,snapshot.documentId,snapshot.text);
    return this.store.getSnapshot().documentId===snapshot.documentId&&!this.store.getSnapshot().dirty;
  }
  private acceptSave(result:SavedFile,documentId:string,text:string){if(this.store.getSnapshot().documentId!==documentId)return;this.store.markSaved(result,text);if(!this.store.getSnapshot().dirty)void this.bridge.deleteRecovery(this.store.getSnapshot().recoveryId);this.prompts.notify('已保存');}
  private async mayLeave(){if(!this.store.getSnapshot().dirty)return true;const choice=await this.prompts.leave();if(choice==='save')return this.saveNow();if(choice==='discard'){await this.bridge.deleteRecovery(this.store.getSnapshot().recoveryId);return true;}return false;}
  open(path?:string){return this.exclusive(async()=>{if(!await this.mayLeave())return false;const result=await this.bridge.open(path);if(!result.ok){this.prompts.notify(result.error.message);return false;}if(!result.value)return false;const root=this.store.getSnapshot().rootDirectory;this.store.load(result.value);if(root)this.store.patchMetadata({rootDirectory:root});return true;});}
  newDocument(){return this.exclusive(async()=>{if(!await this.mayLeave())return false;const root=this.store.getSnapshot().rootDirectory;this.store.replaceSession(createDocument());this.store.patchMetadata({rootDirectory:root});return true;});}
  close(){return this.exclusive(async()=>{if(!await this.mayLeave())return false;const result=await this.bridge.windowAction('close');if(!result.ok)this.prompts.notify(result.error.message);return result.ok;});}
  importFile(path?:string){return this.exclusive(async()=>{if(!await this.mayLeave())return false;const result=await this.bridge.import(path);if(!result.ok){this.prompts.notify(result.error.message);return false;}if(!result.value)return false;this.store.replaceSession(createDocument(result.value.text));this.prompts.notify(result.value.warnings.join('；')||`已导入 ${result.value.sourcePath}`);return true;});}
}
