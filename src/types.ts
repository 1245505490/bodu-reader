export type ViewMode = 'read' | 'edit' | 'split';
export interface DocumentFile { path: string; name: string; content: string; modified: number; size: number; revision?: string; encoding?: string; eol?: string; bom?: boolean; baseContent?: string; dirty?: boolean; id?: string }
export interface DraftFile extends DocumentFile { time?: number }
export interface HistoryEntry { id: string; time: number; label: string; size: number; excerpt: string }
export interface ReplacePlan { id: string; scanned: number; skipped: number; truncated: boolean; changes: { path: string; name: string; relative: string; revision: string; count: number; before: string; after: string }[] }
export interface ReplaceResult { path: string; status: 'saved' | 'conflict' | 'skipped' | 'error'; message: string }
export type SaveResult = { status: 'saved'; doc: DocumentFile; historyWarning?: boolean } | { status: 'cancelled' } | { status: 'conflict'; current: DocumentFile | null };
export interface Entry { path: string; name: string; directory: boolean }
export interface SearchResult { path: string; name: string; relative: string; total: number; matches: { line: number; text: string }[] }
export interface SearchResponse { results: SearchResult[]; scanned: number; skipped: number; truncated: boolean }
export interface Settings { theme: 'light' | 'dark' | 'system'; font: 'sans' | 'serif' | 'mono'; fontSize: number; width: number; lineHeight: number }
export interface SavedState {
  settings?: Settings; tabs?: string[]; active?: string; folder?: string;
  recent?: { path: string; name: string; time: number }[];
  positions?: Record<string, number>; sidebar?: boolean; outline?: boolean;
  modes?: Record<string, ViewMode>;
}
export interface BoduAPI {
  boot(): Promise<{ state: SavedState; pending: DocumentFile[]; drafts: DraftFile[]; version: string }>;
  pickFiles(): Promise<DocumentFile[]>;
  pickFolder(): Promise<{ path: string; entries: Entry[] } | null>;
  readFile(path: string): Promise<DocumentFile>;
  listDirectory(path: string): Promise<Entry[]>;
  searchFolder(path: string, query: string): Promise<SearchResponse>;
  cancelSearch(): Promise<void>;
  saveState(state: SavedState): Promise<void>;
  writeDraft(draft: DraftFile): Promise<void>;
  removeDraft(path: string): Promise<void>;
  saveFile(options: Pick<DocumentFile, 'path' | 'content' | 'revision' | 'encoding' | 'eol' | 'bom'> & { saveAs?: boolean; force?: boolean }): Promise<SaveResult>;
  listHistory(path: string): Promise<HistoryEntry[]>;
  getHistory(path: string, id: string): Promise<HistoryEntry & { content: string }>;
  pickImage(path: string): Promise<{ relative: string; name: string } | null>;
  pasteImage(path: string, bytes: Uint8Array): Promise<{ relative: string; name: string }>;
  previewReplace(path: string, query: string, replacement: string, sensitive: boolean): Promise<ReplacePlan>;
  applyReplace(id: string, paths: string[]): Promise<ReplaceResult[]>;
  openLink(from: string, href: string): Promise<{ doc: DocumentFile; hash: string } | null>;
  imageUrl(from: string, src: string): string;
  droppedPaths(files: File[]): string[];
  openDropped(paths: string[]): Promise<DocumentFile[]>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  onOpenFiles(callback: (docs: DocumentFile[]) => void): () => void;
  onFlushState(callback: () => void): () => void;
  onCloseRequest(callback: () => Promise<boolean>): () => void;
}
declare global { interface Window { bodu?: BoduAPI } }
