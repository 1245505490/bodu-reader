import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter, dropCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { defaultHighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language';
import { tableAt } from './table';

export interface EditorHandle {
  insert(text: string, range?: { from: number; to: number }): void;
  wrap(before: string, after: string, fallback?: string): void;
  prefix(prefix: string): void;
  undo(): void; redo(): void; find(): void; focus(): void;
  selection(): { from: number; to: number; text: string };
  table(): ReturnType<typeof tableAt>;
  goToLine(line: number): void;
}
interface Props { id: string; path: string; content: string; dark: boolean; wrap: boolean; onChange(path: string, content: string): void; onPasteImage(blob: Blob): void; onCursor?(line: number, column: number): void }
const cache = new Map<string, { state: EditorState; scroll: number }>();
const wrapOption = new Compartment(), themeOption = new Compartment(), interactionOption = new Compartment();
const phrases = { 'Find': '查找', 'Replace': '替换为', 'next': '下一个', 'previous': '上一个', 'all': '选择全部', 'match case': '区分大小写', 'by word': '整词匹配', 'regexp': '正则表达式', 'replace': '替换', 'replace all': '全部替换', 'close': '关闭', 'No matches found': '没有找到匹配内容', 'replaced $ matches': '已替换 $ 处', 'replaced match on line $': '已替换第 $ 行匹配' };

const Editor = forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const parent = useRef<HTMLDivElement>(null), viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props); latest.current = props;
  function insert(text: string, range?: { from: number; to: number }) {
    const view = viewRef.current; if (!view) return;
    const selection = range || view.state.selection.main;
    view.dispatch({ changes: { from: selection.from, to: selection.to, insert: text }, selection: { anchor: selection.from + text.length }, scrollIntoView: true, userEvent: 'input' }); view.focus();
  }
  function wrap(before: string, after: string, fallback = '文字') {
    const view = viewRef.current; if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || fallback;
    view.dispatch({ changes: { from, to, insert: `${before}${selected}${after}` }, selection: EditorSelection.range(from + before.length, from + before.length + selected.length), userEvent: 'input' }); view.focus();
  }
  function prefix(prefix: string) {
    const view = viewRef.current; if (!view) return;
    const { from, to } = view.state.selection.main;
    const first = view.state.doc.lineAt(from), last = view.state.doc.lineAt(to);
    const selection = view.state.sliceDoc(first.from, last.to);
    const text = selection.split('\n').map((line, i) => `${prefix === '1. ' ? `${i + 1}. ` : prefix}${line}`).join('\n');
    insert(text, { from: first.from, to: last.to });
  }
  useImperativeHandle(ref, () => ({
    insert, wrap, prefix,
    undo() { if (viewRef.current) { undo(viewRef.current); viewRef.current.focus(); } },
    redo() { if (viewRef.current) { redo(viewRef.current); viewRef.current.focus(); } },
    find() { if (viewRef.current) openSearchPanel(viewRef.current); },
    focus() { viewRef.current?.focus(); },
    selection() { const view = viewRef.current; const range = view?.state.selection.main; return { from: range?.from || 0, to: range?.to || 0, text: view && range ? view.state.sliceDoc(range.from, range.to) : '' }; },
    table() { const view = viewRef.current; return view ? tableAt(view.state.doc.toString(), view.state.selection.main.head) : null; },
    goToLine(line) { const view = viewRef.current; if (!view) return; const target = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, line))); view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) }); },
  }));
  useEffect(() => {
    const previous = cache.get(props.id);
    const state = previous?.state || EditorState.create({ doc: props.content, extensions: [
      lineNumbers(), highlightActiveLineGutter(), drawSelection(), dropCursor(), highlightActiveLine(), history(),
      markdown(), syntaxHighlighting(defaultHighlightStyle), bracketMatching(), highlightSelectionMatches(), search({ top: true }),
      EditorState.phrases.of(phrases),
      wrapOption.of(props.wrap ? EditorView.lineWrapping : []), themeOption.of(EditorView.theme({}, { dark: props.dark })),
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown 编辑器', spellcheck: 'false' }),
      interactionOption.of([]),
    ] });
    const view = new EditorView({ state, parent: parent.current! }); viewRef.current = view;
    // Rebind callbacks when restoring a cached state. History/selection survive, component refs do not.
    view.dispatch({ effects: interactionOption.reconfigure([
      keymap.of([{ key: 'Mod-b', run: () => { wrap('**', '**'); return true; } }, { key: 'Mod-i', run: () => { wrap('*', '*'); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.domEventHandlers({ paste(event) {
        const item = [...(event.clipboardData?.items || [])].find(entry => entry.type.startsWith('image/'));
        const blob = item?.getAsFile(); if (!blob) return false;
        event.preventDefault(); latest.current.onPasteImage(blob); return true;
      } }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) latest.current.onChange(latest.current.path, update.state.doc.toString());
        if (update.selectionSet || update.docChanged) { const cursor = update.state.selection.main.head; const line = update.state.doc.lineAt(cursor); latest.current.onCursor?.(line.number, cursor - line.from + 1); }
      }),
    ]) });
    if (previous) view.scrollDOM.scrollTop = previous.scroll;
    if (state.doc.toString() !== props.content) view.dispatch({ changes: { from: 0, to: state.doc.length, insert: props.content } });
    view.dispatch({ effects: [wrapOption.reconfigure(props.wrap ? EditorView.lineWrapping : []), themeOption.reconfigure(EditorView.theme({}, { dark: props.dark }))] });
    const cursor = view.state.selection.main.head, line = view.state.doc.lineAt(cursor);
    latest.current.onCursor?.(line.number, cursor - line.from + 1);
    view.focus();
    return () => {
      cache.delete(props.id); cache.set(props.id, { state: view.state, scroll: view.scrollDOM.scrollTop });
      while (cache.size > 30) cache.delete(cache.keys().next().value!);
      view.destroy(); viewRef.current = null;
    };
  }, [props.id]);
  useEffect(() => {
    const view = viewRef.current; if (!view || view.state.doc.toString() === props.content) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.content }, selection: { anchor: Math.min(view.state.selection.main.head, props.content.length) } });
  }, [props.content]);
  useEffect(() => { viewRef.current?.dispatch({ effects: wrapOption.reconfigure(props.wrap ? EditorView.lineWrapping : []) }); }, [props.wrap]);
  useEffect(() => { viewRef.current?.dispatch({ effects: themeOption.reconfigure(EditorView.theme({}, { dark: props.dark })) }); }, [props.dark]);
  return <div className="editor-host" ref={parent} />;
});
export default Editor;
