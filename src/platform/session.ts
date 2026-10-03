import type { DocumentStore } from '../core/document';
import { createDocument } from '../core/document';
import { parentDirectory } from '../core/paths';
import type { DesktopBridge, DocumentSession, SavedFile } from '../shared/contracts';

export type LeaveDecision = 'save' | 'discard' | 'cancel';
export interface SessionPrompts {
  leave(): Promise<LeaveDecision>;
  conflict(): Promise<'overwrite' | 'saveAs' | 'cancel'>;
  notify(message: string): void;
  prepareSave?(): void;
  saveOnSwitch?(): boolean;
  /** Resolve against previous.path; check its ID/version and apply at most one asset transaction. */
  relocateAssets?(previous: DocumentSession, saved: SavedFile): Promise<boolean>;
}

/** Serializes file transitions without freezing editing or sharing a save result across documents. */
export class SessionCoordinator {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private store: DocumentStore, private bridge: DesktopBridge, private prompts: SessionPrompts) {}

  private exclusive<T>(run: () => Promise<T>) {
    const next = this.pending.then(run, run);
    this.pending = next.catch(() => {});
    return next;
  }
  private sameDocument(snapshot: DocumentSession) { return this.store.getSnapshot().documentId === snapshot.documentId; }
  private unchanged(snapshot: DocumentSession) {
    const current = this.store.getSnapshot();
    return current.documentId === snapshot.documentId && current.version === snapshot.version;
  }
  private changed(snapshot: DocumentSession) {
    if (this.sameDocument(snapshot)) this.store.patchMetadata({ saveState: 'failed' });
    this.prompts.notify('DOCUMENT_CHANGED：操作期间文档已改变，请重试；当前内容和恢复草稿已保留');
    return false;
  }
  private failed(snapshot: DocumentSession, error: unknown) {
    if (this.sameDocument(snapshot)) this.store.patchMetadata({ saveState: 'failed' });
    this.prompts.notify(error instanceof Error ? error.message : String(error));
    return false;
  }
  private restoreMetadata(snapshot: DocumentSession, savedText?: string) {
    if (!this.sameDocument(snapshot)) return;
    const current = this.store.getSnapshot();
    if (savedText !== undefined && this.store.getSavedText() !== savedText && current.diskFingerprint) {
      this.store.markSaved({ path: current.path ?? snapshot.path ?? '', version: snapshot.savedVersion, fingerprint: snapshot.diskFingerprint ?? current.diskFingerprint }, savedText);
    }
    this.store.patchMetadata({ path: snapshot.path, diskFingerprint: snapshot.diskFingerprint, readonly: snapshot.readonly, saveState: 'failed' });
  }
  private async deleteRecovery(snapshot: DocumentSession) {
    try {
      const result = await this.bridge.deleteRecovery(snapshot.recoveryId);
      if (!result.ok) this.prompts.notify(`恢复草稿清理失败：${result.error.message}`);
    } catch (error) { this.prompts.notify(`恢复草稿清理失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  private async completeSave(snapshot: DocumentSession) {
    if (!this.unchanged(snapshot) || this.store.getSnapshot().dirty) return false;
    await this.deleteRecovery(snapshot);
    if (!this.unchanged(snapshot) || this.store.getSnapshot().dirty) return false;
    this.prompts.notify('已保存');
    return true;
  }

  save(as = false) { return this.exclusive(() => this.saveNow(as)); }

  private async saveNow(as = false, force = false, finalize = true, prepare = true, onWritten?: (saved: SavedFile) => void): Promise<boolean> {
    let snapshot = this.store.getSnapshot();
    const previousSavedText = this.store.getSavedText();
    if (snapshot.readonly && !as) { this.prompts.notify('文件为只读，请使用另存为'); return false; }
    try {
      if (prepare && !snapshot.readonly) {
        this.prompts.prepareSave?.();
        if (!this.sameDocument(snapshot)) return this.changed(snapshot);
        snapshot = this.store.getSnapshot();
      }
      this.store.patchMetadata({ saveState: 'saving' });
      const result = await this.bridge.save({ path: as ? null : snapshot.path, text: snapshot.text, version: snapshot.version, encoding: snapshot.encoding, bom: snapshot.bom, expectedFingerprint: as ? null : snapshot.diskFingerprint, force });
      if (result.ok && result.value) onWritten?.(result.value);
      if (!this.sameDocument(snapshot)) return this.changed(snapshot);
      if (!result.ok) {
        this.store.patchMetadata({ saveState: result.error.code === 'EXTERNAL_CONFLICT' ? 'conflict' : 'failed' });
        if (result.error.code === 'EXTERNAL_CONFLICT' && !force) {
          const choice = await this.prompts.conflict();
          if (!this.unchanged(snapshot)) return this.changed(snapshot);
          if (choice === 'overwrite') return this.saveNow(false, true, finalize, prepare, onWritten);
          if (choice === 'saveAs') return this.saveNow(true, false, finalize, prepare, onWritten);
          return false;
        }
        this.prompts.notify(result.error.message);
        return false;
      }
      if (!result.value) {
        this.store.patchMetadata({ saveState: snapshot.saveState === 'saving' ? 'idle' : snapshot.saveState });
        return false;
      }
      if (result.value.version !== snapshot.version) return this.failed(snapshot, new Error('INVALID_SAVE_VERSION：保存响应版本与本次正文不一致'));
      const relocated = result.value.path !== snapshot.path;
      let completed = snapshot;
      if (relocated) {
        if (!this.unchanged(snapshot)) return this.changed(snapshot);
        // A readonly source stays locked until a new file really exists; the hook can now edit its copy.
        if (as && snapshot.readonly) this.store.patchMetadata({ readonly: false });
        let textChanged: boolean;
        try {
          textChanged = await this.prompts.relocateAssets?.(snapshot, result.value) ?? false;
          const current = this.store.getSnapshot();
          if (current.documentId !== snapshot.documentId || current.version !== snapshot.version + (textChanged ? 1 : 0)) {
            this.restoreMetadata(snapshot);
            return this.changed(snapshot);
          }
        } catch (error) {
          this.restoreMetadata(snapshot);
          return this.failed(snapshot, error);
        }
        this.store.markSaved(result.value, snapshot.text);
        completed = this.store.getSnapshot();
        if (textChanged) {
          // Call the internal operation, never the queued public save(), to avoid self-deadlock.
          if (!await this.saveNow(false, false, false, false, onWritten)) {
            this.restoreMetadata(snapshot, previousSavedText);
            return false;
          }
          completed = this.store.getSnapshot();
        }
      } else {
        if (as) this.store.patchMetadata({ readonly: false });
        this.store.markSaved(result.value, snapshot.text);
      }
      return finalize ? this.completeSave(completed) : this.unchanged(completed) && !this.store.getSnapshot().dirty;
    } catch (error) {
      this.restoreMetadata(snapshot, previousSavedText);
      return this.failed(snapshot, error);
    }
  }

  /** Permission to leave is bound to a document version; cleanup belongs to the successful transition. */
  private async mayLeave(): Promise<DocumentSession | null> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot.dirty) return snapshot;
    if (this.prompts.saveOnSwitch?.()) return await this.saveNow() ? this.store.getSnapshot() : null;
    const choice = await this.prompts.leave();
    if (!this.unchanged(snapshot)) { this.changed(snapshot); return null; }
    if (choice === 'save') return await this.saveNow() ? this.store.getSnapshot() : null;
    return choice === 'discard' ? snapshot : null;
  }

  open(path?: string) {
    return this.exclusive(async () => {
      const previous = await this.mayLeave();
      if (!previous) return false;
      try {
        const result = await this.bridge.open(path);
        if (!result.ok) { this.prompts.notify(result.error.message); return false; }
        if (!result.value) return false;
        if (!this.unchanged(previous)) return this.changed(previous);
        this.store.load(result.value);
        this.store.patchMetadata({ rootDirectory: parentDirectory(result.value.path) });
        await this.deleteRecovery(previous);
        return true;
      } catch (error) { return this.failed(previous, error); }
    });
  }
  newDocument() {
    return this.exclusive(async () => {
      const previous = await this.mayLeave();
      if (!previous) return false;
      if (!this.unchanged(previous)) return this.changed(previous);
      this.store.replaceSession(createDocument());
      this.store.patchMetadata({ rootDirectory: previous.rootDirectory });
      await this.deleteRecovery(previous);
      return true;
    });
  }
  close() {
    return this.exclusive(async () => {
      const previous = await this.mayLeave();
      if (!previous) return false;
      if (!this.unchanged(previous)) return this.changed(previous);
      try {
        const result = await this.bridge.windowAction('close');
        if (!result.ok) { this.prompts.notify(result.error.message); return false; }
        if (!this.unchanged(previous)) return this.changed(previous);
        await this.deleteRecovery(previous);
        return true;
      } catch (error) { return this.failed(previous, error); }
    });
  }
  importFile(path?: string) {
    return this.exclusive(async () => {
      const previous = await this.mayLeave();
      if (!previous) return false;
      try {
        const result = await this.bridge.import(path);
        if (!result.ok) { this.prompts.notify(result.error.message); return false; }
        if (!result.value) return false;
        if (!this.unchanged(previous)) return this.changed(previous);
        this.store.replaceSession(createDocument(result.value.text));
        this.store.patchMetadata({ rootDirectory: previous.rootDirectory });
        await this.deleteRecovery(previous);
        this.prompts.notify(result.value.warnings.join('；') || `已导入 ${result.value.sourcePath}`);
        return true;
      } catch (error) { return this.failed(previous, error); }
    });
  }

  move(to: string) {
    return this.exclusive(async () => {
      if (this.store.getSnapshot().dirty && !await this.saveNow(false, false, false)) return false;
      const previous = this.store.getSnapshot();
      if (!previous.path) { this.prompts.notify('请先保存当前文档'); return false; }
      if (previous.readonly) { this.prompts.notify('文件为只读，请使用另存为'); return false; }
      if (to === previous.path) return true;
      let movedPath: string | null = null;
      let writtenAtDestination: SavedFile | null = null;
      try {
        this.store.patchMetadata({ saveState: 'saving' });
        const result = await this.bridge.moveFile(previous.path, to);
        if (!result.ok) { this.prompts.notify(result.error.message); if (this.sameDocument(previous)) this.store.patchMetadata({ saveState: 'failed' }); return false; }
        movedPath = result.value;
        if (!this.unchanged(previous)) throw new Error('DOCUMENT_CHANGED：移动期间文档已改变，请重试');
        if (movedPath === previous.path) { this.store.patchMetadata({ saveState: previous.saveState }); return true; }
        const opened = await this.bridge.readFile(movedPath);
        if (!opened.ok) throw new Error(opened.error.message);
        if (!this.unchanged(previous)) throw new Error('DOCUMENT_CHANGED：移动期间文档已改变，请重试');
        if (previous.diskFingerprint && opened.value.fingerprint.hash !== previous.diskFingerprint.hash) throw new Error('EXTERNAL_CONFLICT：移动的文件已在外部修改，请重新打开后重试');
        const saved: SavedFile = { path: movedPath, version: previous.version, fingerprint: opened.value.fingerprint };
        const textChanged = await this.prompts.relocateAssets?.(previous, saved) ?? false;
        const current = this.store.getSnapshot();
        if (current.documentId !== previous.documentId || current.version !== previous.version + (textChanged ? 1 : 0)) throw new Error('DOCUMENT_CHANGED：资源迁移期间文档已改变，请重试');
        this.store.markSaved(saved, previous.text);
        const completed = this.store.getSnapshot();
        if (textChanged && !await this.saveNow(false, false, false, false, written => { if (written.path === movedPath) writtenAtDestination = written; })) throw new Error('移动后的资源引用未完成保存，请重试；恢复草稿已保留');
        if (!this.unchanged(completed) || this.store.getSnapshot().dirty) throw new Error('DOCUMENT_CHANGED：移动期间文档已改变，请重试');
        await this.deleteRecovery(completed);
        this.prompts.notify('已移动文件');
        return true;
      } catch (error) {
        if (movedPath && movedPath !== previous.path) {
          if (writtenAtDestination) {
            // A late save can already have written migrated URLs. Restore the old disk source before
            // moving it back, using the exact last write fingerprint rather than overwriting changes.
            try {
              const rewritten = await this.bridge.save({ path: movedPath, text: previous.text, version: previous.version, encoding: previous.encoding, bom: previous.bom, expectedFingerprint: (writtenAtDestination as SavedFile).fingerprint, force: false });
              if (!rewritten.ok || !rewritten.value) this.prompts.notify(`移动正文回滚失败，恢复草稿已保留：${rewritten.ok ? '保存已取消' : rewritten.error.message}`);
            } catch (rewriteError) { this.prompts.notify(`移动正文回滚失败，恢复草稿已保留：${rewriteError instanceof Error ? rewriteError.message : String(rewriteError)}`); }
          }
          try {
            const rollback = await this.bridge.moveFile(movedPath, previous.path);
            if (!rollback.ok) this.prompts.notify(`移动回滚失败，文件仍位于 ${movedPath}：${rollback.error.message}`);
          } catch (rollbackError) { this.prompts.notify(`移动回滚失败，文件仍位于 ${movedPath}：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`); }
        }
        // previous was clean before the move; restore its baseline without replacing text/history.
        this.restoreMetadata(previous, previous.text);
        return this.failed(previous, error);
      }
    });
  }
}
