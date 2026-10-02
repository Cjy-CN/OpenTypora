/** All source positions are UTF-16 code-unit offsets, including CR and LF. */
export interface SelectionRange { anchor: number; head: number }
export type LineEnding = 'LF' | 'CRLF' | 'mixed';
export type SaveState = 'idle' | 'saving' | 'failed' | 'conflict';
export interface DiskFingerprint { modifiedAt: number; size: number; hash: string }
export interface DocumentSession {
  documentId: string; path: string | null; text: string; encoding: string; bom: boolean; lineEnding: LineEnding;
  version: number; savedVersion: number; dirty: boolean; readonly: boolean; saveState: SaveState;
  diskFingerprint: DiskFingerprint | null; selection: SelectionRange; composing: boolean;
  recoveryId: string; assetSessionId: string; rootDirectory: string | null;
  documentOverrides: Record<string, unknown>;
}
export interface TextChange { from: number; to: number; insert: string }
export interface EditTransaction {
  transactionId: string; documentId: string; baseVersion: number; changes: TextChange[];
  selection?: SelectionRange; origin: 'input' | 'command' | 'source' | 'asset' | 'replace'; historyGroup?: string;
}
export interface AppError { code: string; message: string; retryable: boolean; detail?: string }
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };
export interface OpenedFile { path: string; text: string; encoding: string; bom: boolean; readonly: boolean; fingerprint: DiskFingerprint }
export interface SaveRequest { path: string | null; text: string; version: number; encoding: string; bom: boolean; expectedFingerprint: DiskFingerprint | null; force?: boolean }
export interface SavedFile { path: string; version: number; fingerprint: DiskFingerprint }
export interface DirectoryEntry { name: string; path: string; directory: boolean; modifiedAt: number; size: number; children?: DirectoryEntry[]; excerpt?: string }
export interface RecoveryDraft { id: string; session: DocumentSession; savedAt: number }
export interface AssetResult { path: string; url: string }
export interface UploadItem { id: string; path: string }
export interface UploadResult { id: string; url?: string; error?: string }
export type ExportFormat = 'pdf' | 'pdf-latex' | 'html' | 'html-plain' | 'image' | 'docx' | 'odt' | 'rtf' | 'epub' | 'latex' | 'mediawiki' | 'rst' | 'textile' | 'opml' | 'markdown' | 'native' | 'pandoc' | 'custom';
export interface ExportProfile {
  id: string; name: string; format: ExportFormat; extension: string; options: Record<string, unknown>;
  args: string[]; openFile: boolean; openFolder: boolean; afterCommand?: { executable: string; args: string[] };
}
export interface ExportSnapshot { documentId: string; version: number; text: string; path: string | null; html: string; title: string; profile: ExportProfile }
export interface ExportResult { path: string; warnings: string[]; postActionError?: string }
export interface ImportResult { text: string; sourcePath: string; warnings: string[] }
export interface SearchOptions { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
export interface SearchMatch { from: number; to: number; text: string }
export interface FileSearchMatch { path: string; line: number; excerpt: string; from: number; to: number }
export interface ApplicationInfo { version: string; platform: string; userData: string }
/** Deliberately narrow IPC surface: no arbitrary IPC channel exposed to documents. */
export interface DesktopBridge {
  info(): Promise<Result<ApplicationInfo>>;
  open(path?: string): Promise<Result<OpenedFile | null>>;
  save(request: SaveRequest): Promise<Result<SavedFile | null>>;
  chooseFolder(): Promise<Result<string | null>>;
  listDirectory(path: string): Promise<Result<DirectoryEntry[]>>;
  readFile(path: string): Promise<Result<OpenedFile>>;
  moveFile(from: string, to: string): Promise<Result<string>>;
  trashFile(path: string): Promise<Result<void>>;
  reveal(path: string): Promise<Result<void>>;
  openExternal(url: string): Promise<Result<void>>;
  loadSettings(): Promise<Result<Record<string, unknown>>>;
  saveSettings(settings: Record<string, unknown>): Promise<Result<void>>;
  listRecovery(): Promise<Result<RecoveryDraft[]>>;
  writeRecovery(draft: RecoveryDraft): Promise<Result<void>>;
  deleteRecovery(id: string): Promise<Result<void>>;
  insertImage(documentPath: string | null, strategy: string): Promise<Result<AssetResult | null>>;
  manageAssets(operation: string, paths: string[], destination?: string): Promise<Result<AssetResult[]>>;
  upload(items: UploadItem[], settings: Record<string, unknown>): Promise<Result<UploadResult[]>>;
  export(snapshot: ExportSnapshot): Promise<Result<ExportResult | null>>;
  import(path?: string): Promise<Result<ImportResult | null>>;
  dependencies(): Promise<Result<Record<string, { available: boolean; path?: string; version?: string }>>>;
  searchFiles(root: string, query: string, options: SearchOptions): Promise<Result<FileSearchMatch[]>>;
  windowAction(action: 'new' | 'close' | 'fullscreen' | 'alwaysOnTop' | 'devtools' | 'print'): Promise<Result<void>>;
  systemAction(action: string, options?: Record<string, unknown>): Promise<Result<unknown>>;
  onCommand(callback: (commandId: string) => void): () => void;
  onFileChanged(callback: (path: string) => void): () => void;
}
export const IPC_CHANNEL = 'opentypora:invoke';
export const BRIDGE_METHODS = ['info', 'open', 'save', 'chooseFolder', 'listDirectory', 'readFile', 'moveFile', 'trashFile', 'reveal', 'openExternal', 'loadSettings', 'saveSettings', 'listRecovery', 'writeRecovery', 'deleteRecovery', 'insertImage', 'manageAssets', 'upload', 'export', 'import', 'dependencies', 'searchFiles', 'windowAction', 'systemAction'] as const;
export type BridgeMethod = typeof BRIDGE_METHODS[number];
