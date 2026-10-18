import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, ChevronsUpDown, FileText, Folder, FolderOpen, History, List, Maximize2, Minus, Moon, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Settings2, Sun, X, Save, FilePlus2, Pencil, Columns2, Bold, Italic, Strikethrough, ListOrdered, ListChecks, Quote, Link2, ImagePlus, Table2, Code2, Undo2, Redo2, WrapText, Replace } from 'lucide-react';
import type { DocumentFile, Entry, SavedState, SearchResponse, Settings } from './types';
import { enhanceMarkdown, renderMarkdown } from './markdown';
import { welcome, WELCOME_PATH } from './welcome';
import { normalizeDoc, useEditing } from './editing/useEditing';
import { ConfirmDialog, LinkDialog, TableDialog, HistoryDialog, BatchReplaceDialog } from './editing/Dialogs';
import { serializeTable } from './editing/table';
import type { TableData } from './editing/table';
const Editor = lazy(() => import('./editing/Editor'));

const defaults: Settings = { theme: 'light', font: 'sans', fontSize: 17, width: 860, lineHeight: 1.9 };
const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) || p;
const dirname = (p: string) => p.replace(/[\\/][^\\/]+$/, '');
const api = window.bodu;
function IconButton({ title, children, onClick, active = false, disabled = false }: { title: string; children: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>;
}
function FileNode({ entry, active, onOpen, depth = 0 }: { entry: Entry; active: string; onOpen: (path: string) => void; depth?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');
  async function click() {
    if (!entry.directory) { onOpen(entry.path); return; }
    if (!expanded && !children) {
      try { setChildren(await api!.listDirectory(entry.path)); } catch { setError('无法读取此文件夹'); }
    }
    setExpanded(!expanded);
  }
  return <>
    <button className={`file-row ${active === entry.path ? 'selected' : ''}`} style={{ paddingLeft: 12 + depth * 14 }} title={entry.path} onClick={() => void click()}>
      {entry.directory ? <><span className="tree-chevron">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span><Folder size={15} /></> : <FileText size={15} />}
      <span>{entry.name.replace(/\.(md|markdown)$/i, '')}</span>
    </button>
    {expanded && <div>{error && <p className="tree-note">{error}</p>}{children?.map(e => <FileNode key={e.path} entry={e} active={active} onOpen={onOpen} depth={depth + 1} />)}{children?.length === 0 && <p className="tree-note">没有 Markdown 文档</p>}</div>}
  </>;
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [tabs, setTabs] = useState<DocumentFile[]>([]);
  const [active, setActive] = useState(WELCOME_PATH);
  const [settings, setSettings] = useState(defaults);
  const [folder, setFolder] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [recent, setRecent] = useState<NonNullable<SavedState['recent']>>([]);
  const [recentMode, setRecentMode] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [outline, setOutline] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState(0);
  const [matchIndex, setMatchIndex] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [folderQuery, setFolderQuery] = useState('');
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [currentHeading, setCurrentHeading] = useState('');
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState('');
  const [dragging, setDragging] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [tableEdit, setTableEdit] = useState<{ data: TableData; range?: { from: number; to: number } } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [editorWrap, setEditorWrap] = useState(true);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [debouncedContent, setDebouncedContent] = useState('');
  const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  const positions = useRef<Record<string, number>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const folderSearchRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<SavedState>({});
  const headingLock = useRef(0);
  const anchorRequest = useRef<{ path: string; hash?: string; line?: number } | null>(null);
  const documentFile = tabs.find(t => t.path === active) || welcome;
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
  const notify = useCallback((message: string) => setToast(message), []);
  const remember = useCallback((docs: DocumentFile[]) => {
    const now = Date.now();
    setRecent(old => [...docs.filter(d => d.path !== WELCOME_PATH).map(d => ({ path: d.path, name: d.name, time: now })), ...old.filter(e => !docs.some(d => d.path === e.path))].slice(0, 30));
  }, []);
  const persistState = useCallback(async () => { await api?.saveState(stateRef.current); }, []);
  const editing = useEditing({ tabs, setTabs, active, setActive, notify, remember, persistState });
  useEffect(() => { const timer = setTimeout(() => setDebouncedContent(documentFile.content), 180); return () => clearTimeout(timer); }, [documentFile.content]);
  const previewContent = editing.mode === 'read' ? documentFile.content : debouncedContent;
  const rendered = useMemo(() => renderMarkdown(previewContent, documentFile.path), [previewContent, documentFile.path]);
  useEffect(() => {
    if (!editing.question && !linkOpen && !tableEdit && !historyOpen && !batchOpen) return;
    const dialog = document.querySelector<HTMLElement>('.confirm-layer [role="dialog"]') || [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1);
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(e => e.getClientRects().length);
    const initial = dialog.querySelector<HTMLElement>('input:not([type="checkbox"])') || focusable()[0];
    initial?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      } else if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (editing.question) editing.answer('cancel');
        else { setLinkOpen(false); setTableEdit(null); setHistoryOpen(false); setBatchOpen(false); }
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { window.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, [editing.question, linkOpen, tableEdit, historyOpen, batchOpen]);
  const addDocuments = useCallback((docs: DocumentFile[]) => {
    if (!docs.length) return;
    setTabs(old => { const next = [...old]; for (const source of docs) { const doc = normalizeDoc(source); const index = next.findIndex(e => e.path === doc.path); if (index >= 0) { if (!next[index].dirty) next[index] = doc; } else next.push(doc); } return next; });
    setActive(docs.at(-1)!.path); remember(docs);
  }, [remember]);
  const openFile = useCallback(async (path: string) => {
    if (path === WELCOME_PATH) { addDocuments([welcome]); return; }
    try { if (!api) throw new Error('请在礴读桌面程序中打开本地文档'); addDocuments([await api.readFile(path)]); }
    catch (error) { notify(`无法打开：${error instanceof Error ? error.message : '文件不存在或无权读取'}`); }
  }, [addDocuments, notify]);
  const pickFiles = useCallback(async () => {
    try { if (!api) { notify('当前是界面预览，请运行礴读桌面版打开本地文件'); return; } addDocuments(await api.pickFiles()); }
    catch (error) { notify(`打开失败：${(error as Error).message}`); }
  }, [addDocuments, notify]);
  const pickFolder = useCallback(async () => {
    try { if (!api) { notify('请在礴读桌面版中打开文件夹'); return; } const result = await api.pickFolder(); if (result) { setFolder(result.path); setEntries(result.entries); setSearchMode(false); setRecentMode(false); setSearchResponse(null); } }
    catch (error) { notify(`无法打开文件夹：${(error as Error).message}`); }
  }, [notify]);
  const closeTab = editing.closeTab;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!api) { setTabs([welcome]); setLoaded(true); return; }
      try {
        const { state, pending, drafts } = await api.boot();
        if (cancelled) return;
        setSettings({ ...defaults, ...state.settings, fontSize: Math.min(28, Math.max(13, Number(state.settings?.fontSize) || defaults.fontSize)), width: Math.min(1200, Math.max(620, Number(state.settings?.width) || defaults.width)) });
        positions.current = state.positions || {};
        setRecent(state.recent || []); setSidebar(state.sidebar ?? true); setOutline(state.outline ?? true);
        editing.setModes(state.modes || {});
        const restored: DocumentFile[] = [];
        for (const p of (state.tabs || []).slice(0, 20)) {
          try { restored.push(normalizeDoc(p === WELCOME_PATH ? welcome : await api.readFile(p))); } catch { /* Missing files remain available in recent history. */ }
        }
        if (cancelled) return;
        if (pending.length) {
          for (const source of pending) { const doc = normalizeDoc(source); const i = restored.findIndex(d => d.path === doc.path); if (i < 0) restored.push(doc); else restored[i] = doc; }
          remember(pending);
        }
        await editing.recoverDrafts(restored, drafts || []);
        if (cancelled) return;
        setTabs(restored.length ? restored : [welcome]);
        setActive(pending.at(-1)?.path || (restored.some(d => d.path === state.active) ? state.active! : restored[0]?.path || WELCOME_PATH));
        if (state.folder) { try { const tree = await api.listDirectory(state.folder); if (!cancelled) { setFolder(state.folder); setEntries(tree); } } catch { if (!cancelled) notify('上次的文件夹已不可用，请重新选择'); } }
      } catch { if (!cancelled) { setTabs([welcome]); notify('未能恢复上次会话，已打开阅读指南'); } }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [notify, remember]);
  useEffect(() => api?.onOpenFiles(addDocuments), [addDocuments]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.title = `${documentFile.name.replace(/\.md$/i, '')} · 礴读`;
  }, [dark, documentFile.name]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setSystemDark(media.matches); media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 5500); return () => clearTimeout(id); }, [toast]);
  useEffect(() => { if (findOpen) { findRef.current?.focus(); findRef.current?.select(); } }, [findOpen]);
  useEffect(() => { if (searchMode) folderSearchRef.current?.focus(); }, [searchMode]);

  const snapshot = useCallback((): SavedState => ({ settings, tabs: tabs.map(t => t.path), active, folder, recent, positions: positions.current, sidebar, outline, modes: editing.modes }), [settings, tabs, active, folder, recent, sidebar, outline, editing.modes]);
  stateRef.current = snapshot();
  useEffect(() => {
    if (!loaded || !api) return;
    const timer = setTimeout(() => { void api.saveState(stateRef.current).catch(() => notify('阅读设置保存失败，请检查磁盘空间')); }, 200);
    return () => clearTimeout(timer);
  }, [loaded, snapshot, notify]);
  useEffect(() => api?.onFlushState(() => { void api.saveState(stateRef.current); }), []);

  // Restore only after the article DOM has changed; font/theme changes keep the current position.
  useLayoutEffect(() => {
    if (!loaded || !scrollRef.current) return;
    const root = scrollRef.current;
    root.scrollTop = positions.current[documentFile.path] || 0;
    setProgress(root.scrollHeight > root.clientHeight ? root.scrollTop / (root.scrollHeight - root.clientHeight) * 100 : 0);
    setCurrentHeading(rendered.headings[0]?.id || '');
    setMatchIndex(0);
  }, [documentFile.path, loaded]);
  // This also handles links/search results targeting the document already on screen.
  useLayoutEffect(() => {
    const request = anchorRequest.current;
    if (request?.path === documentFile.path) {
      requestAnimationFrame(() => {
        if (request.hash) {
          let hash = request.hash; try { hash = decodeURIComponent(hash); } catch {}
          document.getElementById(hash)?.scrollIntoView({ block: 'start' });
        }
        if (request.line !== undefined) {
          if (editing.mode !== 'read') editing.editorRef.current?.goToLine(request.line!);
          const candidates = [...(articleRef.current?.querySelectorAll<HTMLElement>('[data-line]') || [])];
          const target = candidates.reverse().find(e => Number(e.dataset.line) <= request.line! - 1);
          target?.scrollIntoView({ block: 'center' });
        }
      });
      anchorRequest.current = null;
    }
  });
  useEffect(() => {
    if (!articleRef.current || !loaded) return;
    let cancelled = false;
    void enhanceMarkdown(articleRef.current, dark, () => cancelled).catch(() => { if (!cancelled) notify('部分公式或图表暂时无法渲染'); });
    return () => { cancelled = true; };
  }, [rendered, dark, loaded, notify, editing.mode]);

  // Search DOM text only, so markup and hidden formula annotations never count as matches.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    for (const mark of article.querySelectorAll('mark.search-match')) mark.replaceWith(document.createTextNode(mark.textContent || ''));
    article.normalize();
    if (!findOpen || !query.trim()) { setMatches(0); return; }
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, { acceptNode(node) {
      return node.parentElement?.closest('button, .katex, .diagram, .math-pending, .image-unavailable') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    } });
    const nodes: Text[] = []; let node;
    while ((node = walker.nextNode())) nodes.push(node as Text);
    let count = 0;
    for (const text of nodes) {
      const original = text.data, lower = original.toLocaleLowerCase(), term = query.toLocaleLowerCase();
      let at = 0, index = lower.indexOf(term);
      if (index < 0) continue;
      const fragment = document.createDocumentFragment();
      while (index >= 0 && count < 10000) {
        fragment.append(original.slice(at, index));
        const mark = document.createElement('mark'); mark.className = 'search-match'; mark.textContent = original.slice(index, index + query.length);
        fragment.append(mark); count++; at = index + query.length; index = lower.indexOf(term, at);
      }
      fragment.append(original.slice(at)); text.replaceWith(fragment);
    }
    setMatches(count); setMatchIndex(0);
  }, [findOpen, query, rendered, loaded, editing.mode]);
  useEffect(() => {
    const marks = articleRef.current?.querySelectorAll('mark.search-match');
    marks?.forEach((mark, i) => mark.classList.toggle('current-match', i === matchIndex));
    if (findOpen && matches) marks?.[matchIndex]?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [matchIndex, matches, findOpen, query]);

  useEffect(() => {
    if (!searchMode || !folder || !api || !folderQuery.trim()) { setSearchResponse(null); setSearching(false); void api?.cancelSearch(); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void api.searchFolder(folder, folderQuery.trim()).then(result => { if (!cancelled) setSearchResponse(result); }).catch(() => { if (!cancelled) notify('文件夹搜索失败，请检查文件夹是否可用'); }).finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); void api.cancelSearch(); };
  }, [searchMode, folder, folderQuery, notify]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (event.key === 'Escape') { setFindOpen(false); setSettingsOpen(false); return; }
      if (!ctrl) return;
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); void (event.shiftKey ? pickFolder() : pickFiles()); }
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); if (event.shiftKey) { setSidebar(true); setSearchMode(true); } else if (editing.mode !== 'read') editing.editorRef.current?.find(); else setFindOpen(true); }
      else if (event.key.toLowerCase() === 'h' && editing.mode !== 'read') { event.preventDefault(); editing.editorRef.current?.find(); }
      else if (event.key.toLowerCase() === 'n') { event.preventDefault(); editing.newDocument(); }
      else if (event.key.toLowerCase() === 's') { event.preventDefault(); void editing.save(active, event.shiftKey); }
      else if (event.key.toLowerCase() === 'w') { event.preventDefault(); closeTab(active); }
      else if (event.key.toLowerCase() === 'b') { event.preventDefault(); setSidebar(v => !v); }
      else if (event.key === 'Tab' && tabs.length) { event.preventDefault(); const i = tabs.findIndex(d => d.path === active); setActive(tabs[(i + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length].path); }
      else if (['=', '+', '-'].includes(event.key)) { event.preventDefault(); setSettings(s => ({ ...s, fontSize: Math.max(13, Math.min(28, s.fontSize + (event.key === '-' ? -1 : 1))) })); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [active, closeTab, tabs, pickFiles, pickFolder, editing.mode, editing.newDocument, editing.save]);

  const saveScrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollFrame = useRef(0);
  function onScroll() {
    const root = scrollRef.current; if (!root) return;
    positions.current[documentFile.path] = root.scrollTop;
    if (!scrollFrame.current) scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      setProgress(root.scrollHeight <= root.clientHeight ? 100 : Math.round(root.scrollTop / (root.scrollHeight - root.clientHeight) * 100));
      if (Date.now() > headingLock.current) {
        const top = root.getBoundingClientRect().top;
        const headings = rendered.headings.map(h => document.getElementById(h.id)).filter(Boolean) as HTMLElement[];
        const heading = headings.filter(e => e.getBoundingClientRect().top <= top + 110).at(-1) || headings[0];
        if (heading) setCurrentHeading(heading.id);
      }
    });
    clearTimeout(saveScrollTimer.current);
    saveScrollTimer.current = setTimeout(() => { if (loaded) void api?.saveState(stateRef.current).catch(() => {}); }, 200);
  }
  async function onArticleClick(event: React.MouseEvent<HTMLElement>) {
    const element = event.target as HTMLElement;
    const copy = element.closest<HTMLButtonElement>('.copy-code');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.closest('.code-block')?.querySelector('code')?.textContent || ''); copy.textContent = '已复制'; setTimeout(() => { if (copy.isConnected) copy.textContent = '复制代码'; }, 1800); } catch { notify('复制失败，请手动选择代码复制'); }
      return;
    }
    const link = element.closest<HTMLAnchorElement>('a');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href'); if (!href) return;
    if (href.startsWith('#')) { try { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} return; }
    if (!api) { notify('请在桌面版中打开链接'); return; }
    try { const result = await api.openLink(documentFile.path, href); if (result) { anchorRequest.current = { path: result.doc.path, hash: result.hash }; addDocuments([result.doc]); } }
    catch (error) { notify((error as Error).message); }
  }
  async function refreshFolder() {
    if (!api || !folder) return;
    try { setEntries(await api.listDirectory(folder)); } catch { notify('文件夹已不可用'); }
  }
  const setOption = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(old => ({ ...old, [key]: value }));
  function openTable() {
    const current = editing.editorRef.current?.table();
    setTableEdit(current ? { data: current.data, range: { from: current.from, to: current.to } } : { data: { rows: [['列一', '列二'], ['', ''], ['', '']], align: ['left', 'left'] } });
  }
  async function refreshReplaced(paths: string[]) {
    const updated = await Promise.all(paths.filter(p => tabs.some(d => d.path === p)).map(p => api!.readFile(p).then(normalizeDoc)));
    setTabs(old => old.map(doc => { const changed = updated.find(d => d.path === doc.path); return doc.dirty || !changed ? doc : { ...changed, id: doc.id }; }));
  }
  const style = { '--reading-width': `${settings.width}px`, '--reading-font-size': `${settings.fontSize}px`, '--reading-line-height': settings.lineHeight } as CSSProperties;

  return <div className={`app ${dark ? 'dark' : ''}`} style={style}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={event => { if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); if (api) void api.openDropped(api.droppedPaths([...event.dataTransfer.files])).then(docs => docs.length ? addDocuments(docs) : notify('请拖入 .md 或 .markdown 文件')).catch(error => notify((error as Error).message)); }}>
    <header className="titlebar">
      <div className="brand"><span className="brand-icon"><BookOpen size={17} strokeWidth={1.7} /></span><span>礴读</span><span className="brand-divider" /><span className="brand-tagline">文字之间，自有天地</span></div>
      <div className="titlebar-middle">{documentFile.path !== WELCOME_PATH ? dirname(documentFile.path) : '本地 Markdown 阅读器'}</div>
      <div className="window-actions"><button aria-label="最小化" onClick={() => void api?.windowAction('minimize')}><Minus size={15} /></button><button aria-label="最大化或还原" onClick={() => void api?.windowAction('maximize')}><Maximize2 size={12} /></button><button className="window-close" aria-label="关闭窗口" onClick={() => void api?.windowAction('close')}><X size={17} /></button></div>
    </header>
    <div className="workspace">
      {sidebar && <aside className="sidebar">
        <div className="sidebar-actions"><button className="open-file" onClick={() => void pickFiles()}><Plus size={17} /><span>打开文件</span><kbd>Ctrl O</kbd></button><IconButton title="打开文件夹 (Ctrl+Shift+O)" onClick={() => void pickFolder()}><FolderOpen size={18} /></IconButton></div>
        <div className="sidebar-switch"><button className={!searchMode ? 'active' : ''} onClick={() => setSearchMode(false)}><Folder size={14} />文档</button><button className={searchMode ? 'active' : ''} onClick={() => setSearchMode(true)}><Search size={14} />全文搜索</button></div>
        {searchMode ? <div className="folder-search">
          <div className="sidebar-label"><span>在文件夹中搜索</span><IconButton title="文件夹批量替换" disabled={!folder} onClick={() => setBatchOpen(true)}><Replace size={14} /></IconButton></div>
          {folder ? <><p className="search-folder-name" title={folder}><Folder size={13} />{basename(folder)}</p><div className="search-field"><Search size={15} /><input aria-label="搜索文件夹" placeholder="输入关键词…" ref={folderSearchRef} value={folderQuery} onChange={e => setFolderQuery(e.target.value)} />{folderQuery && <button aria-label="清空全文搜索" onClick={() => setFolderQuery('')}><X size={13} /></button>}</div><div className="search-summary" role="status">{searching ? '正在搜索本地文档…' : searchResponse ? `${searchResponse.results.length} 篇文档 · 已扫描 ${searchResponse.scanned} 篇${searchResponse.skipped ? ` · 跳过 ${searchResponse.skipped} 篇` : ''}` : '搜索此文件夹及其子文件夹'}</div><div className="search-results">{searchResponse?.results.map(result => <div className="search-result" key={result.path}><button className="result-title" title={result.relative} onClick={() => { void openFile(result.path); }}><FileText size={14} /><span>{result.name}</span><small>{result.total}</small></button>{result.matches.map(match => <button className="result-match" key={match.line} onClick={() => { anchorRequest.current = { path: result.path, line: match.line }; void openFile(result.path); }}><span>{match.line}</span><p>{match.text}</p></button>)}</div>)}{!searching && searchResponse?.results.length === 0 && <p className="empty-note">没有找到匹配内容</p>}{searchResponse?.truncated && <p className="empty-note">结果较多，请缩小搜索范围</p>}</div></> : <div className="sidebar-empty"><Search size={28} strokeWidth={1.3} /><p>搜索整个文档文件夹</p><button className="text-button" onClick={() => void pickFolder()}>选择文件夹 <ChevronRight size={13} /></button></div>}
        </div> : <>
          <section className="files-section"><div className="sidebar-label"><span>{folder && !recentMode ? basename(folder) : '最近打开'}</span>{folder ? <div className="file-section-actions"><IconButton title={recentMode ? '返回文件夹' : '显示最近打开'} onClick={() => setRecentMode(v => !v)}>{recentMode ? <Folder size={13} /> : <History size={13} />}</IconButton>{!recentMode && <IconButton title="刷新文件夹" onClick={() => void refreshFolder()}><RefreshCw size={13} /></IconButton>}</div> : <History size={13} />}</div>
            <div className="file-list" key={`${folder}-${recentMode}`}>{folder && !recentMode ? entries.map(entry => <FileNode key={entry.path} entry={entry} active={active} onOpen={path => void openFile(path)} />) : <>{recent.map(item => <button className={`file-row ${active === item.path ? 'selected' : ''}`} key={item.path} title={item.path} onClick={() => void openFile(item.path)}><FileText size={15} /><span>{item.name.replace(/\.(md|markdown)$/i, '')}</span></button>)}{!recent.length && <p className="empty-note">打开的文档会出现在这里</p>}</>}
              <button className={`file-row guide-row ${active === WELCOME_PATH ? 'selected' : ''}`} onClick={() => addDocuments([welcome])}><BookOpen size={15} /><span>阅读指南</span><span className="mini-badge">入门</span></button>
            </div>
          </section>
          <section className="outline-section"><button className="sidebar-label outline-toggle" onClick={() => setOutline(v => !v)}><span><List size={13} />文档目录</span>{outline ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>{outline && <nav className="outline" aria-label="文章标题目录">{rendered.headings.map((heading, i) => <button key={heading.id} title={heading.text} className={`${currentHeading === heading.id ? 'current' : ''} level-${heading.level}`} style={{ paddingLeft: `${14 + Math.max(0, heading.level - 1) * 12}px` }} onClick={() => { headingLock.current = Date.now() + 700; setCurrentHeading(heading.id); const element = document.getElementById(heading.id); if (editing.mode !== 'read') editing.editorRef.current?.goToLine(Number(element?.dataset.line || 0) + 1); if (editing.mode !== 'edit') element?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><span className="outline-guide">{heading.level === 1 ? '○' : '·'}</span><span>{heading.text}</span>{i === 0 && <span className="outline-top">H1</span>}</button>)}{!rendered.headings.length && <p className="empty-note">文档中还没有标题</p>}</nav>}</section>
        </>}
        <div className="sidebar-footer"><span><i />完全离线 · 自在阅读</span><IconButton title="阅读设置" onClick={() => setSettingsOpen(v => !v)}><Settings2 size={15} /></IconButton></div>
      </aside>}
      <main className="main-panel">
        <div className="tabs-bar">{!sidebar && <IconButton title="展开侧栏 (Ctrl+B)" onClick={() => setSidebar(true)}><PanelLeftOpen size={16} /></IconButton>}<div className="tabs" role="tablist" aria-label="打开的文档">{tabs.map(tab => <div className={`tab ${active === tab.path ? 'active' : ''}`} key={tab.id || tab.path}><button role="tab" aria-selected={active === tab.path} title={tab.path === WELCOME_PATH ? '阅读指南' : tab.path} onClick={() => setActive(tab.path)}>{tab.path === WELCOME_PATH ? <BookOpen size={14} /> : <FileText size={14} />}<span>{tab.name.replace(/\.(md|markdown)$/i, '')}</span>{tab.dirty && <i className="dirty-dot" aria-hidden="true" title="未保存" />}</button><button className="close-tab" aria-label={`关闭 ${tab.name}`} onClick={() => void closeTab(tab.path)}><X size={12} /></button></div>)}</div><IconButton title="新建文档 (Ctrl+N)" onClick={() => editing.newDocument()}><FilePlus2 size={17} /></IconButton><div className="tabs-spacer" /></div>
        <div className="reading-toolbar"><div className="breadcrumb">{sidebar && <IconButton title="收起侧栏 (Ctrl+B)" onClick={() => setSidebar(false)}><PanelLeftClose size={16} /></IconButton>}<span className="breadcrumb-parent">{documentFile.path.startsWith('bodu:new:') ? '新建文档' : folder && documentFile.path.startsWith(folder) ? basename(folder) : documentFile.path === WELCOME_PATH ? '开始阅读' : basename(dirname(documentFile.path))}</span><ChevronRight size={12} /><span className="breadcrumb-file" title={documentFile.path}>{documentFile.name}</span></div><div className="reading-actions"><div className="view-modes" role="group" aria-label="阅读与编辑模式"><IconButton title="阅读模式" active={editing.mode === 'read'} onClick={() => editing.setMode('read')}><BookOpen size={15} /></IconButton><IconButton title="编辑模式" active={editing.mode === 'edit'} onClick={() => { setFindOpen(false); editing.beginEditing('edit'); }}><Pencil size={15} /></IconButton><IconButton title="左右对照" active={editing.mode === 'split'} onClick={() => { setFindOpen(false); editing.beginEditing('split'); }}><Columns2 size={15} /></IconButton></div><IconButton title="保存文档 (Ctrl+S)" disabled={documentFile.path === WELCOME_PATH || editing.saving} onClick={() => void editing.save()}><Save size={16} /></IconButton><IconButton title="版本历史" disabled={documentFile.path.startsWith('bodu:')} onClick={() => setHistoryOpen(true)}><History size={16} /></IconButton><IconButton title="搜索文章 (Ctrl+F)" onClick={() => editing.mode !== 'read' ? editing.editorRef.current?.find() : setFindOpen(v => !v)} active={findOpen}><Search size={17} /></IconButton><button className={`type-button ${settingsOpen ? 'is-active' : ''}`} aria-label="排版与主题" title="排版与主题" onClick={() => setSettingsOpen(v => !v)}>Aa</button><IconButton title={dark ? '切换浅色模式' : '切换深色模式'} onClick={() => setOption('theme', dark ? 'light' : 'dark')}>{dark ? <Sun size={17} /> : <Moon size={17} />}</IconButton></div></div>
        {editing.external && <div className="external-banner" role="status"><span>{editing.external}</span><button onClick={() => void editing.reload()}>载入磁盘版本</button><button onClick={() => void editing.save(active, true)}>另存为</button></div>}
        {editing.mode !== 'read' && <div className="editor-toolbar" role="toolbar" aria-label="Markdown 格式工具栏"><IconButton title="撤销 (Ctrl+Z)" onClick={() => editing.editorRef.current?.undo()}><Undo2 size={15} /></IconButton><IconButton title="重做 (Ctrl+Y)" onClick={() => editing.editorRef.current?.redo()}><Redo2 size={15} /></IconButton><span className="toolbar-divider" /><select aria-label="设置标题" defaultValue="" onChange={e => { if (e.target.value) editing.editorRef.current?.prefix(e.target.value); e.target.value = ''; }}><option value="">标题</option><option value="# ">一级标题</option><option value="## ">二级标题</option><option value="### ">三级标题</option></select><IconButton title="加粗 (Ctrl+B)" onClick={() => editing.editorRef.current?.wrap('**', '**')}><Bold size={15} /></IconButton><IconButton title="斜体 (Ctrl+I)" onClick={() => editing.editorRef.current?.wrap('*', '*')}><Italic size={15} /></IconButton><IconButton title="删除线" onClick={() => editing.editorRef.current?.wrap('~~', '~~')}><Strikethrough size={15} /></IconButton><span className="toolbar-divider" /><IconButton title="无序列表" onClick={() => editing.editorRef.current?.prefix('- ')}><List size={15} /></IconButton><IconButton title="有序列表" onClick={() => editing.editorRef.current?.prefix('1. ')}><ListOrdered size={15} /></IconButton><IconButton title="任务列表" onClick={() => editing.editorRef.current?.prefix('- [ ] ')}><ListChecks size={15} /></IconButton><IconButton title="引用" onClick={() => editing.editorRef.current?.prefix('> ')}><Quote size={15} /></IconButton><span className="toolbar-divider" /><IconButton title="插入链接" onClick={() => setLinkOpen(true)}><Link2 size={15} /></IconButton><IconButton title="插入图片" onClick={() => void editing.insertImage()}><ImagePlus size={15} /></IconButton><IconButton title="插入或编辑表格" onClick={openTable}><Table2 size={15} /></IconButton><IconButton title="代码块" onClick={() => editing.editorRef.current?.wrap('```\n', '\n```', '代码')}><Code2 size={15} /></IconButton><span className="toolbar-divider" /><IconButton title="自动换行" active={editorWrap} onClick={() => setEditorWrap(v => !v)}><WrapText size={15} /></IconButton><IconButton title="查找与替换 (Ctrl+H)" onClick={() => editing.editorRef.current?.find()}><Replace size={15} /></IconButton><button className="save-as-button" disabled={editing.saving} onClick={() => void editing.save(active, true)}>另存为</button></div>}
        {findOpen && <div className="find-bar"><Search size={16} /><input aria-label="搜索文章" ref={findRef} placeholder="搜索当前文章…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && matches) { e.preventDefault(); setMatchIndex(i => (i + (e.shiftKey ? -1 : 1) + matches) % matches); } }} /><span className="find-count">{query ? matches ? `${matchIndex + 1} / ${matches >= 10000 ? '10000+' : matches}` : '无结果' : ''}</span><IconButton title="上一个匹配" onClick={() => matches && setMatchIndex(i => (i - 1 + matches) % matches)}><ArrowUp size={15} /></IconButton><IconButton title="下一个匹配" onClick={() => matches && setMatchIndex(i => (i + 1) % matches)}><ArrowDown size={15} /></IconButton><IconButton title="关闭搜索" onClick={() => setFindOpen(false)}><X size={16} /></IconButton></div>}
        <div className={`document-workspace mode-${editing.mode}`}>
        {editing.mode !== 'read' && loaded && <Suspense fallback={<div className="editor-loading">正在准备编辑器…</div>}><Editor ref={editing.editorRef} key={documentFile.id || documentFile.path} id={documentFile.id || documentFile.path} path={documentFile.path} content={documentFile.content} dark={dark} wrap={editorWrap} onChange={editing.updateContent} onPasteImage={blob => void editing.insertImage(blob)} onCursor={(line, column) => setCursor({ line, column })} /></Suspense>}
        <div className="reader-scroll" style={editing.mode === 'edit' ? { display: 'none' } : undefined} ref={scrollRef} onScroll={onScroll}>
          {loaded && <div className="article-shell"><div className="article-eyebrow"><span className="eyebrow-line" />{documentFile.path === WELCOME_PATH ? '遇见礴读' : '静心阅读'}<span className="article-meta">{rendered.minutes} 分钟阅读 · {rendered.words.toLocaleString()} 字</span></div><article ref={articleRef} className={`markdown font-${settings.font}`} onClick={event => void onArticleClick(event)} onError={event => { const target = event.target as HTMLElement; if (target.tagName === 'IMG') { target.classList.add('broken-image'); target.setAttribute('alt', `图片不可用 · ${target.getAttribute('alt') || '请检查本地路径'}`); } }} dangerouslySetInnerHTML={{ __html: rendered.html }} /><div className="article-end"><span /><BookOpen size={16} strokeWidth={1.3} /><span /></div><p className="end-text">读到这里，也是一种收获。</p></div>}
          {!loaded && <div className="loading-state"><BookOpen size={28} /><p>正在打开你的阅读空间…</p></div>}
        </div>
        </div>
        <footer className="statusbar"><div><FileText size={12} /><span>Markdown</span><span className="status-divider" /><span>{rendered.words.toLocaleString()} 字</span>{documentFile.path !== WELCOME_PATH && <><span className="status-divider" /><span>{editing.saving ? '保存中…' : documentFile.dirty ? '未保存 · 本机草稿恢复' : '已保存'}</span><span className="status-divider" /><span>{documentFile.encoding?.toUpperCase() || 'UTF8'} · {documentFile.eol === '\r\n' ? 'CRLF' : 'LF'}</span></>}</div><div>{editing.mode !== 'read' && <><span>行 {cursor.line}，列 {cursor.column}</span><span className="status-divider" /></>}<span>{settings.fontSize} px</span><span className="status-divider" /><span>已读 {Math.min(100, Math.round(progress))}%</span><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><button title="回到顶部" aria-label="回到顶部" onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowUp size={12} /></button></div></footer>
      </main>
    </div>
    {editing.question && <ConfirmDialog question={editing.question} answer={editing.answer} />}
    {linkOpen && <LinkDialog text={editing.editorRef.current?.selection().text || ''} close={() => setLinkOpen(false)} insert={text => editing.editorRef.current?.insert(text)} />}
    {tableEdit && <TableDialog initial={tableEdit.data} close={() => setTableEdit(null)} apply={data => editing.editorRef.current?.insert(`${tableEdit.range ? '' : '\n\n'}${serializeTable(data)}\n`, tableEdit.range)} />}
    {historyOpen && <HistoryDialog doc={documentFile} close={() => setHistoryOpen(false)} restore={content => { editing.setMode('edit'); editing.updateContent(active, content.replace(/\r\n|\r/g, '\n')); notify('历史内容已载入编辑器；保存后写入原文件，也可撤销恢复操作'); }} notify={notify} />}
    {batchOpen && <BatchReplaceDialog folder={folder} dirtyPaths={tabs.filter(d => d.dirty).map(d => d.path)} close={() => setBatchOpen(false)} flush={editing.flushDrafts} refreshed={refreshReplaced} notify={notify} />}
    {settingsOpen && <><div className="popover-backdrop" onClick={() => setSettingsOpen(false)} /><section className="settings-popover" aria-label="阅读设置"><div className="popover-heading"><div><span className="small-label">你的阅读偏好</span><h2>舒服一点，读久一点。</h2></div><IconButton title="关闭阅读设置" onClick={() => setSettingsOpen(false)}><X size={16} /></IconButton></div><label className="setting-label">外观</label><div className="theme-options">{(['light', 'dark', 'system'] as const).map((theme, i) => <button key={theme} className={settings.theme === theme ? 'chosen' : ''} onClick={() => setOption('theme', theme)}>{i === 0 ? <Sun size={17} /> : i === 1 ? <Moon size={17} /> : <ChevronsUpDown size={17} />}<span>{['浅色', '深色', '跟随系统'][i]}</span>{settings.theme === theme && <Check size={12} />}</button>)}</div><label className="setting-label" htmlFor="font-select">正文字体</label><select id="font-select" value={settings.font} onChange={e => setOption('font', e.target.value as Settings['font'])}><option value="sans">系统黑体 · 清晰自然</option><option value="serif">宋体 · 书页质感</option><option value="mono">等宽字体 · 技术阅读</option></select><div className="setting-label"><label htmlFor="font-size">字号</label><span>{settings.fontSize} px</span></div><div className="range-row"><span className="range-a">A</span><input id="font-size" aria-label="字号" type="range" min="13" max="28" step="1" value={settings.fontSize} onChange={e => setOption('fontSize', Number(e.target.value))} /><span className="range-a large">A</span></div><div className="setting-label"><label htmlFor="reading-width">正文宽度</label><span>{settings.width} px</span></div><input id="reading-width" aria-label="正文宽度" type="range" min="620" max="1200" step="20" value={settings.width} onChange={e => setOption('width', Number(e.target.value))} /><div className="setting-label"><label htmlFor="line-height">行距</label><span>{settings.lineHeight.toFixed(1)}</span></div><input id="line-height" aria-label="行距" type="range" min="1.5" max="2.3" step="0.1" value={settings.lineHeight} onChange={e => setOption('lineHeight', Number(e.target.value))} /><div className="settings-note"><span>偏好会自动保存在本机</span><button className="text-button" onClick={() => setSettings(defaults)}>恢复默认</button></div></section></>}
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast('')}><X size={14} /></button></div>}
    {dragging && <div className="drop-overlay"><div><BookOpen size={44} strokeWidth={1.2} /><h2>放下文档，开始阅读</h2><p>支持 .md 和 .markdown 文件</p></div></div>}
  </div>;
}
