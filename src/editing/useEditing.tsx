import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { DocumentFile, DraftFile, ViewMode } from '../types';
import type { EditorHandle } from './Editor';
import { WELCOME_PATH } from '../welcome';

const api = window.bodu;
export const normalizeDoc = (doc: DocumentFile): DocumentFile => {
  const content = doc.content.replace(/\r\n|\r/g, '\n');
  return { ...doc, id: doc.id || doc.path, content, baseContent: content, dirty: false };
};
type Choice = { label: string; value: string; danger?: boolean };
export interface Question { title: string; message: string; choices: Choice[]; resolve: (choice: string) => void }
interface Props {
  tabs: DocumentFile[]; setTabs: Dispatch<SetStateAction<DocumentFile[]>>;
  active: string; setActive: Dispatch<SetStateAction<string>>;
  notify: (message: string) => void; remember: (docs: DocumentFile[]) => void;
  persistState: () => Promise<void>;
}
export function useEditing(props: Props) {
  const [modes, setModes] = useState<Record<string, ViewMode>>({});
  const [question, setQuestion] = useState<Question | null>(null);
  const [saving, setSaving] = useState(false);
  const [external, setExternal] = useState<Record<string, string>>({});
  const latest = useRef(props); latest.current = props;
  const editorRef = useRef<EditorHandle | null>(null);
  const saveLocks = useRef(new Map<string, Promise<DocumentFile | null>>());
  const draftContent = useRef(new Map<string, string>());
  const ask = useCallback((title: string, message: string, choices: Choice[]) => new Promise<string>(resolve => setQuestion({ title, message, choices, resolve })), []);
  const answer = (value: string) => { const item = question; setQuestion(null); item?.resolve(value); };
  const mode = modes[props.active] || 'read';
  const setMode = useCallback((value: ViewMode, p = latest.current.active) => setModes(old => ({ ...old, [p]: value })), []);
  const updateContent = useCallback((p: string, content: string) => {
    latest.current.setTabs(old => old.map(doc => doc.path === p ? { ...doc, content, baseContent: doc.baseContent ?? doc.content, dirty: p.startsWith('bodu:new:') || content !== (doc.baseContent ?? doc.content) } : doc));
  }, []);
  const newDocument = useCallback((content = '') => {
    const p = `bodu:new:${crypto.randomUUID()}`;
    const doc: DocumentFile = { path: p, id: p, name: '未命名.md', content, baseContent: '', dirty: true, modified: 0, size: 0, encoding: 'utf8', eol: '\n', bom: false };
    latest.current.setTabs(old => [...old, doc]); latest.current.setActive(p); setMode('edit', p);
    return p;
  }, [setMode]);
  const beginEditing = (value: ViewMode) => {
    if (latest.current.active === WELCOME_PATH) {
      const p = newDocument(latest.current.tabs.find(d => d.path === WELCOME_PATH)?.content || ''); setMode(value, p);
    } else setMode(value);
  };
  const flushDrafts = useCallback(async () => {
    if (!api) return;
    const docs = latest.current.tabs;
    for (const doc of docs) {
      if (doc.dirty && draftContent.current.get(doc.path) !== doc.content) {
        await api.writeDraft({ ...doc, baseContent: undefined }); draftContent.current.set(doc.path, doc.content);
      } else if (!doc.dirty && draftContent.current.has(doc.path)) {
        await api.removeDraft(doc.path); draftContent.current.delete(doc.path);
      }
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { void flushDrafts().catch(error => props.notify(`恢复草稿保存失败：${(error as Error).message}`)); }, 350);
    return () => clearTimeout(timer);
  }, [props.tabs, flushDrafts, props.notify]);

  const save = useCallback((p = latest.current.active, saveAs = false): Promise<DocumentFile | null> => {
    const previous = saveLocks.current.get(p); if (previous) return previous;
    const operation = (async () => {
      const source = latest.current.tabs.find(d => d.path === p);
      if (!source || p === WELCOME_PATH) return null;
      if (!api) { latest.current.notify('请在礴读桌面版中保存文档'); return null; }
      setSaving(true);
      try {
        await flushDrafts();
        let result = await api.saveFile({ ...source, saveAs });
        if (result.status === 'conflict') {
          const choice = await ask('文件已在外部修改', `“${source.name}”的磁盘内容与打开时不同。请选择如何处理你的编辑。`, [
            { label: '取消', value: 'cancel' }, { label: '另存为', value: 'saveAs' },
            ...(result.current ? [{ label: '载入磁盘版本', value: 'reload' }] : []), { label: '使用当前内容覆盖', value: 'overwrite', danger: true },
          ]);
          if (choice === 'cancel') return null;
          if (choice === 'reload' && result.current) {
            const current = normalizeDoc(result.current); latest.current.setTabs(old => old.map(d => d.path === p ? { ...current, id: source.id } : d));
            await api.removeDraft(p); draftContent.current.delete(p); setExternal(old => { const next = { ...old }; delete next[p]; return next; });
            return current;
          }
          result = await api.saveFile({ ...source, saveAs: choice === 'saveAs', force: choice === 'overwrite' });
        }
        if (result.status !== 'saved') return null;
        const saved = normalizeDoc(result.doc);
        latest.current.setTabs(old => {
          const current = old.find(d => d.path === p);
          const content = current?.content ?? source.content;
          return old.filter(d => d.path === p || d.path !== saved.path).map(d => d.path === p ? { ...saved, id: source.id || p, content, baseContent: saved.content, dirty: content !== saved.content } : d);
        });
        latest.current.setActive(current => current === p ? saved.path : current);
        setModes(old => ({ ...old, [saved.path]: old[p] || 'edit' }));
        latest.current.remember([saved]);
        await api.removeDraft(p); draftContent.current.delete(p);
        setExternal(old => { const next = { ...old }; delete next[p]; return next; });
        latest.current.notify(result.historyWarning ? '文档已保存，但本次保存后的历史记录写入失败' : '文档已保存');
        return saved;
      } catch (error) { latest.current.notify(`保存失败，编辑内容已保留：${(error as Error).message}`); return null; }
      finally { setSaving(false); }
    })();
    saveLocks.current.set(p, operation);
    void operation.finally(() => saveLocks.current.delete(p));
    return operation;
  }, [ask, flushDrafts]);
  const discard = useCallback(async (p: string) => { await api?.removeDraft(p); draftContent.current.delete(p); }, []);
  const confirmDocument = useCallback(async (p: string) => {
    const pendingSave = saveLocks.current.get(p); if (pendingSave) await pendingSave;
    const doc = latest.current.tabs.find(d => d.path === p);
    if (!doc?.dirty) return true;
    const choice = await ask('保存文档更改？', `“${doc.name}”有未保存的内容。`, [{ label: '取消', value: 'cancel' }, { label: '不保存', value: 'discard', danger: true }, { label: '保存', value: 'save' }]);
    if (choice === 'cancel') return false;
    if (choice === 'save') return Boolean(await save(p));
    await discard(p); return true;
  }, [ask, save, discard]);
  const closeTab = useCallback(async (p: string) => {
    if (!(await confirmDocument(p))) return;
    latest.current.setTabs(old => {
      const index = old.findIndex(d => d.path === p), next = old.filter(d => d.path !== p);
      latest.current.setActive(current => current === p ? next[Math.min(index, next.length - 1)]?.path || WELCOME_PATH : current);
      return next;
    });
  }, [confirmDocument]);
  const closing = useRef(false);
  useEffect(() => api?.onCloseRequest(async () => {
    if (closing.current) return false;
    closing.current = true;
    try {
      await flushDrafts();
      for (const doc of [...latest.current.tabs]) if (!(await confirmDocument(doc.path))) return false;
      await latest.current.persistState();
      return true;
    } catch (error) { latest.current.notify(`无法完成退出：${(error as Error).message}`); return false; }
    finally { closing.current = false; }
  }), [flushDrafts, confirmDocument]);
  const recoverDrafts = useCallback(async (docs: DocumentFile[], drafts: DraftFile[]) => {
    let count = 0;
    for (const draft of drafts) {
      const current = docs.find(d => d.path === draft.path);
      const content = draft.content.replace(/\r\n|\r/g, '\n');
      if (current && current.content === content) { await discard(draft.path); continue; }
      const recovered: DocumentFile = { ...draft, content, id: draft.id || draft.path, baseContent: current?.content ?? '', dirty: true };
      if (current) docs[docs.indexOf(current)] = recovered; else docs.push(recovered);
      draftContent.current.set(draft.path, content); setMode('edit', draft.path); count++;
    }
    if (count) latest.current.notify(`已恢复 ${count} 篇未保存草稿；原文件未被覆盖`);
    return docs;
  }, [discard, setMode]);
  const reload = useCallback(async (p = latest.current.active) => {
    const doc = latest.current.tabs.find(d => d.path === p); if (!doc || !api) return;
    if (doc.dirty && await ask('载入磁盘版本？', '当前未保存的编辑将被替换。', [{ label: '取消', value: 'cancel' }, { label: '载入磁盘版本', value: 'reload', danger: true }]) !== 'reload') return;
    try { const disk = normalizeDoc(await api.readFile(p)); latest.current.setTabs(old => old.map(d => d.path === p ? { ...disk, id: doc.id } : d)); await discard(p); setExternal(old => { const next = { ...old }; delete next[p]; return next; }); }
    catch (error) { latest.current.notify(`无法重新载入：${(error as Error).message}`); }
  }, [ask, discard]);
  useEffect(() => {
    let cancelled = false, checking = false;
    const check = async () => {
      const doc = latest.current.tabs.find(d => d.path === latest.current.active);
      if (!doc || doc.path.startsWith('bodu:') || !api || checking || saveLocks.current.size) return;
      checking = true;
      try {
        const current = await api.readFile(doc.path);
        if (!cancelled && current.revision !== doc.revision) setExternal(old => ({ ...old, [doc.path]: '文件已被其他程序修改。保存前请选择保留当前编辑或载入磁盘版本。' }));
      } catch { if (!cancelled) setExternal(old => ({ ...old, [doc.path]: '原文件已移动、删除或暂时不可读取；你的编辑内容仍然保留。' })); }
      finally { checking = false; }
    };
    window.addEventListener('focus', check); const timer = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);
  const insertImage = async (blob?: Blob) => {
    const initial = latest.current.tabs.find(d => d.path === latest.current.active); if (!initial || !api) return;
    const doc = initial.path.startsWith('bodu:') ? await save(initial.path) : initial;
    if (!doc) return;
    try {
      const image = blob ? await api.pasteImage(doc.path, new Uint8Array(await blob.arrayBuffer())) : await api.pickImage(doc.path);
      if (image) editorRef.current?.insert(`![${image.name}](${image.relative})`);
    } catch (error) { latest.current.notify(`插入图片失败：${(error as Error).message}`); }
  };
  return { modes, setModes, mode, setMode, beginEditing, newDocument, updateContent, editorRef, save, saving, closeTab, question, answer, ask, recoverDrafts, flushDrafts, reload, external: external[props.active], insertImage };
}
