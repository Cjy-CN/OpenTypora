import type {DocumentStore} from '../core/document';
import type {DesktopBridge} from '../shared/contracts';

/** A disk read can finish after editing, saving, or switching to another document. */
export async function refreshExternalFile(store:DocumentStore,bridge:Pick<DesktopBridge,'readFile'>,path:string,notify:(message:string)=>void){
  const before=store.getSnapshot();if(before.path?.toLowerCase()!==path.toLowerCase())return;
  const result=await bridge.readFile(path);if(!result.ok){notify(result.error.message);return;}
  const current=store.getSnapshot();
  if(current.documentId!==before.documentId||current.version!==before.version||current.diskFingerprint?.hash!==before.diskFingerprint?.hash||result.value.fingerprint.hash===before.diskFingerprint?.hash)return;
  if(current.dirty){store.markConflict();notify('磁盘内容已改变，请在保存时处理冲突');return;}
  store.load(result.value);store.patchMetadata({rootDirectory:before.rootDirectory,documentOverrides:before.documentOverrides});store.setSelection(current.selection);
}
