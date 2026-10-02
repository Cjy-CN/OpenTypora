import { describe, expect, it } from 'vitest';
import { DocumentStore, createDocument, detectLineEnding } from '../src/core/document';
const fingerprint={modifiedAt:1,size:2,hash:'test'};
describe('source document invariants',()=>{
  it('preserves source bytes until an actual edit, including unknown syntax and CRLF',()=>{
    const text='---\r\nunknown: true\r\n---\r\n# 中文 🙂\r\n==unknown==  \r\n';
    const store=new DocumentStore(createDocument(text,{path:'example.md',text,encoding:'utf-8',bom:true,readonly:false,fingerprint}));
    store.setSelection({anchor:3,head:20});store.setComposing(true);store.setComposing(false);
    expect(store.getSnapshot().text).toBe(text);expect(store.getSnapshot().dirty).toBe(false);expect(store.getSnapshot().version).toBe(0);
  });
  it('rejects stale or overlapping transactions without partial edits',()=>{
    const store=new DocumentStore(createDocument('abcdef'));const snapshot=store.getSnapshot();
    expect(()=>store.apply({transactionId:'x',documentId:snapshot.documentId,baseVersion:99,changes:[{from:0,to:1,insert:'x'}],origin:'command'})).toThrow('STALE_TRANSACTION');
    expect(()=>store.apply({transactionId:'x',documentId:snapshot.documentId,baseVersion:0,changes:[{from:0,to:4,insert:'x'},{from:3,to:5,insert:'y'}],origin:'command'})).toThrow('INVALID_RANGE');
    expect(store.getSnapshot().text).toBe('abcdef');expect(store.canUndo()).toBe(false);
  });
  it('undoes cross-block changes atomically, retaining direction and Unicode source',()=>{
    const store=new DocumentStore(createDocument('甲🙂\n\n# Title'));store.setSelection({anchor:12,head:1});const snapshot=store.getSnapshot();
    store.apply({transactionId:'x',documentId:snapshot.documentId,baseVersion:0,changes:[{from:0,to:1,insert:'乙'},{from:7,to:12,insert:'New'}],origin:'command',selection:{anchor:1,head:1}});
    const changed=store.getSnapshot().text;store.undo();expect(store.getSnapshot().text).toBe(snapshot.text);expect(store.getSnapshot().selection).toEqual(snapshot.selection);store.redo();expect(store.getSnapshot().text).toBe(changed);
  });
  it('a late save never clears edits newer than its frozen snapshot',()=>{
    const store=new DocumentStore();store.replaceText('first');const frozen=store.getSnapshot();store.replaceText('second');
    store.markSaved({path:'saved.md',version:frozen.version,fingerprint},frozen.text);
    expect(store.getSnapshot().text).toBe('second');expect(store.getSnapshot().dirty).toBe(true);expect(store.getSnapshot().savedVersion).toBe(1);
    store.undo();expect(store.getSnapshot().text).toBe('first');expect(store.getSnapshot().dirty).toBe(false);
  });
  it('read-only sessions reject mutations and history travel',()=>{
    const store=new DocumentStore();store.replaceText('keep');store.patchMetadata({readonly:true});expect(()=>store.replaceText('lose')).toThrow('READ_ONLY');store.undo();expect(store.getSnapshot().text).toBe('keep');
  });
  it('distinguishes existing line endings',()=>{expect(detectLineEnding('a\r\nb')).toBe('CRLF');expect(detectLineEnding('a\nb')).toBe('LF');expect(detectLineEnding('a\r\nb\nc')).toBe('mixed');});
});
