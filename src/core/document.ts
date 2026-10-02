import type { DiskFingerprint, DocumentSession, EditTransaction, OpenedFile, SavedFile, SelectionRange } from '../shared/contracts';
interface HistoryEntry { text: string; selection: SelectionRange; group?: string; time: number }
export function detectLineEnding(text: string): DocumentSession['lineEnding'] {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  return crlf && lf ? 'mixed' : crlf ? 'CRLF' : 'LF';
}
export function createDocument(text = '', opened?: OpenedFile): DocumentSession {
  const id = crypto.randomUUID();
  return { documentId: id, path: opened?.path ?? null, text, encoding: opened?.encoding ?? 'utf-8', bom: opened?.bom ?? false,
    lineEnding: detectLineEnding(text), version: 0, savedVersion: 0, dirty: !opened && text.length > 0, readonly: opened?.readonly ?? false,
    saveState: 'idle', diskFingerprint: opened?.fingerprint ?? null, selection: { anchor: 0, head: 0 }, composing: false,
    recoveryId: id, assetSessionId: id, rootDirectory: null, documentOverrides: {} };
}
/** A store instance owns one document; the text and save versions never fork per view. */
export class DocumentStore {
  private session: DocumentSession;
  private savedText: string;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<() => void>();
  constructor(session = createDocument()) { this.session = session; this.savedText = session.dirty ? '' : session.text; }
  getSnapshot = (): DocumentSession => this.session;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit() { this.listeners.forEach(listener => listener()); }
  canUndo() { return this.undoStack.length > 0 && !this.session.readonly; }
  canRedo() { return this.redoStack.length > 0 && !this.session.readonly; }
  load(opened: OpenedFile) { this.session = createDocument(opened.text, opened); this.savedText = opened.text; this.undoStack = []; this.redoStack = []; this.emit(); }
  replaceSession(session: DocumentSession) { this.session = { ...session }; this.savedText = session.dirty ? '' : session.text; this.undoStack = []; this.redoStack = []; this.emit(); }
  setSelection(selection: SelectionRange) {
    const clamp = (position: number) => Math.max(0, Math.min(this.session.text.length, position));
    const next = { anchor: clamp(selection.anchor), head: clamp(selection.head) };
    if (next.anchor === this.session.selection.anchor && next.head === this.session.selection.head) return;
    this.session = { ...this.session, selection: next }; this.emit();
  }
  setComposing(composing: boolean) { this.session = { ...this.session, composing }; this.emit(); }
  patchMetadata(patch: Partial<Pick<DocumentSession, 'path' | 'readonly' | 'saveState' | 'rootDirectory' | 'documentOverrides' | 'encoding' | 'bom' | 'diskFingerprint'>>) { this.session = { ...this.session, ...patch }; this.emit(); }
  apply(transaction: EditTransaction): boolean {
    const current = this.session;
    if (transaction.documentId !== current.documentId || transaction.baseVersion !== current.version) throw new Error('STALE_TRANSACTION');
    if (current.readonly) throw new Error('READ_ONLY');
    const changes = [...transaction.changes].sort((a, b) => a.from - b.from);
    let end = 0;
    for (const change of changes) {
      if (!Number.isInteger(change.from) || !Number.isInteger(change.to) || change.from < end || change.from < 0 || change.to < change.from || change.to > current.text.length) throw new Error('INVALID_RANGE');
      end = change.to;
    }
    let text = current.text;
    for (const change of changes.reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
    if (text === current.text) { if (transaction.selection) this.setSelection(transaction.selection); return false; }
    const now = Date.now(), last = this.undoStack.at(-1);
    if (!transaction.historyGroup || last?.group !== transaction.historyGroup || now - last.time > 1000) {
      this.undoStack.push({ text: current.text, selection: current.selection, group: transaction.historyGroup, time: now });
    } else if (last) last.time = now;
    this.redoStack = [];
    const selection = transaction.selection ?? current.selection;
    this.session = { ...current, text, version: current.version + 1, dirty: text !== this.savedText, lineEnding: detectLineEnding(text), selection: { anchor: Math.min(text.length, selection.anchor), head: Math.min(text.length, selection.head) } };
    this.emit(); return true;
  }
  replaceText(text: string, origin: EditTransaction['origin'] = 'input', selection?: SelectionRange, historyGroup?: string) {
    return this.apply({ transactionId: crypto.randomUUID(), documentId: this.session.documentId, baseVersion: this.session.version, changes: [{ from: 0, to: this.session.text.length, insert: text }], origin, selection, historyGroup });
  }
  undo() { this.travel(this.undoStack, this.redoStack); }
  redo() { this.travel(this.redoStack, this.undoStack); }
  private travel(from: HistoryEntry[], to: HistoryEntry[]) {
    if (this.session.readonly) return;
    const entry = from.pop(); if (!entry) return;
    to.push({ text: this.session.text, selection: this.session.selection, time: Date.now() });
    this.session = { ...this.session, text: entry.text, selection: entry.selection, version: this.session.version + 1, dirty: entry.text !== this.savedText, lineEnding: detectLineEnding(entry.text) }; this.emit();
  }
  markSaved(result: SavedFile, snapshotText: string) {
    if (result.version > this.session.version) throw new Error('INVALID_SAVE_VERSION');
    this.savedText = snapshotText;
    this.session = { ...this.session, path: result.path, savedVersion: result.version, diskFingerprint: result.fingerprint, dirty: this.session.text !== snapshotText, saveState: 'idle' }; this.emit();
  }
  markConflict(fingerprint?: DiskFingerprint) { this.patchMetadata({ saveState: 'conflict', ...(fingerprint ? { diskFingerprint: fingerprint } : {}) }); }
}
