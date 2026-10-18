import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import type { BoduAPI } from './types';
export interface Heading { id: string; text: string; level: number }
export interface Rendered { html: string; headings: Heading[]; words: number; minutes: number }
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new MarkdownIt({
  html: true, linkify: true, typographer: true, breaks: false,
  highlight(code, language) {
    try { if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value; } catch {}
    return escape(code);
  },
});
md.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
  const text = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim();
  if (!text.startsWith('$$') && text !== '\\[') return false;
  if (silent) return true;
  const delimiter = text.startsWith('$$') ? '$$' : '\\]';
  const initial = text.startsWith('$$') ? text.slice(2) : '';
  let content = initial, next = start + 1;
  if (initial.endsWith('$$') && initial.length >= 2) content = initial.slice(0, -2);
  else {
    let found = false;
    content = initial ? `${initial}\n` : '';
    while (next < end) {
      const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
      if (line.trim().endsWith(delimiter)) {
        content += line.slice(0, line.lastIndexOf(delimiter)); next++; found = true; break;
      }
      content += `${line}\n`; next++;
    }
    if (!found) return false;
  }
  const token = state.push('math_block', 'div', 0);
  token.content = content.trim(); token.map = [start, next]; token.block = true;
  state.line = next;
  return true;
});
md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
  const start = state.pos;
  const paren = state.src.slice(start, start + 2) === '\\(';
  if (!paren && (state.src[start] !== '$' || state.src[start + 1] === '$' || /\s/.test(state.src[start + 1] || ' '))) return false;
  const openLength = paren ? 2 : 1;
  const close = paren ? '\\)' : '$';
  let at = state.src.indexOf(close, start + openLength);
  while (at >= 0 && state.src[at - 1] === '\\') at = state.src.indexOf(close, at + close.length);
  if (at < 0 || (!paren && (/\s/.test(state.src[at - 1]) || /\d/.test(state.src[at + 1] || '')))) return false;
  if (!silent) { const token = state.push('math_inline', 'span', 0); token.content = state.src.slice(start + openLength, at); }
  state.pos = at + close.length;
  return true;
});
md.renderer.rules.math_inline = (tokens, i) => `<span class="math-pending" data-formula="${encodeURIComponent(tokens[i].content)}">${escape(tokens[i].content)}</span>`;
md.renderer.rules.math_block = (tokens, i) => `<div class="math-pending math-block" data-display="true" data-formula="${encodeURIComponent(tokens[i].content)}" data-line="${tokens[i].map?.[0] ?? 0}">${escape(tokens[i].content)}</div>`;
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, i, options, env, self) => {
  const token = tokens[i], language = token.info.trim().split(/\s+/)[0];
  if (language === 'mermaid') return `<div class="diagram" data-mermaid="${encodeURIComponent(token.content)}" data-line="${token.map?.[0] ?? 0}"><span class="diagram-label">MERMAID</span><div class="diagram-content"><span class="render-pending">正在绘制图表…</span></div></div>`;
  return `<div class="code-block" data-line="${token.map?.[0] ?? 0}"><div class="code-header"><span>${escape(language || '纯文本')}</span><button class="copy-code" type="button">复制代码</button></div>${defaultFence(tokens, i, options, env, self)}</div>`;
};
const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, i, options, env, self) => {
  const context = env as { path: string; api?: BoduAPI };
  const token = tokens[i], src = String(token.attrGet('src') || '');
  if (/^(https?:)?\/\//i.test(src)) return `<span class="image-unavailable">图片未加载 · 离线阅读${token.content ? ` · ${escape(token.content)}` : ''}</span>`;
  if (src.startsWith('data:image/') && !src.startsWith('data:image/svg')) {
    token.attrSet('loading', 'lazy'); return defaultImage(tokens, i, options, env, self);
  }
  if (/^(?!file:)[a-z][a-z\d+.-]*:/i.test(src)) return '';
  if (context.api) token.attrSet('src', context.api.imageUrl(context.path, src));
  else token.attrSet('src', '');
  token.attrSet('loading', 'lazy'); token.attrSet('decoding', 'async');
  return defaultImage(tokens, i, options, env, self);
};

export function renderMarkdown(content: string, path: string): Rendered {
  const env = { path, api: window.bodu };
  const tokens = md.parse(content, env);
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.map && token.nesting !== -1 && token.type !== 'inline') token.attrSet('data-line', String(token.map[0]));
    if (token.type === 'heading_open') {
      const children = tokens[i + 1]?.children || [];
      const text = children.map(t => t.type === 'image' ? t.content : t.type === 'text' || t.type === 'code_inline' || t.type === 'math_inline' ? t.content : '').join('');
      const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
      const count = used.get(base) || 0; used.set(base, count + 1);
      const id = count ? `${base}-${count}` : base;
      token.attrSet('id', id);
      headings.push({ id, text: text || '未命名标题', level: Number(token.tag.slice(1)) });
    }
    if (token.type === 'inline' && tokens[i - 1]?.type === 'paragraph_open') {
      const first = token.children?.[0];
      if (first?.type === 'text' && /^\[[ xX]\] /.test(first.content)) {
        const checked = /^\[[xX]\]/.test(first.content);
        first.content = first.content.slice(4);
        const checkbox = new MarkdownIt.Token('html_inline', '', 0);
        checkbox.content = `<input type="checkbox" disabled ${checked ? 'checked' : ''} />`;
        token.children!.unshift(checkbox);
      }
    }
  }
  const raw = md.renderer.render(tokens, md.options, env);
  const clean = DOMPurify.sanitize(raw, {
    ADD_ATTR: ['data-line', 'data-formula', 'data-display', 'data-mermaid', 'loading', 'decoding'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'video', 'audio', 'source', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcset', 'autofocus'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|file|bodu-image):|data:image\/(?:png|jpeg|gif|webp);|[^a-z]|[a-z+.-]+(?:[^a-z+.:\-]|$))/i,
  });
  // HTML <img> tags follow the same offline/local policy as Markdown images.
  const template = document.createElement('template');
  template.innerHTML = clean;
  for (const image of template.content.querySelectorAll('img')) {
    const src = image.getAttribute('src') || '';
    if (/^(https?:)?\/\//i.test(src)) {
      const placeholder = document.createElement('span'); placeholder.className = 'image-unavailable';
      placeholder.textContent = `图片未加载 · 离线阅读${image.alt ? ` · ${image.alt}` : ''}`;
      image.replaceWith(placeholder);
    } else if (src && !src.startsWith('bodu-image:') && !src.startsWith('data:image/')) {
      image.setAttribute('src', window.bodu?.imageUrl(path, src) || '');
      image.setAttribute('loading', 'lazy');
    }
  }
  const html = template.innerHTML;
  const words = (content.match(/[\p{Script=Han}]|[\p{L}\p{N}_]+/gu) || []).length;
  return { html, headings, words, minutes: Math.max(1, Math.ceil(words / 450)) };
}

let diagramSequence = 0;
export async function enhanceMarkdown(root: HTMLElement, dark: boolean, cancelled: () => boolean) {
  const math = [...root.querySelectorAll<HTMLElement>('.math-pending')];
  if (math.length) {
    const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')]);
    if (cancelled()) return;
    for (const element of math) {
      let formula = element.dataset.formula || ''; try { formula = decodeURIComponent(formula); } catch {}
      katex.render(formula, element, { displayMode: element.dataset.display === 'true', throwOnError: false, trust: false, strict: false, maxExpand: 1000, maxSize: 20 });
      element.classList.remove('math-pending');
    }
  }
  const diagrams = [...root.querySelectorAll<HTMLElement>('[data-mermaid]')];
  if (diagrams.length) {
    diagrams.forEach(element => { element.dataset.renderState = 'loading-engine'; });
    const { default: mermaid } = await import('mermaid');
    if (cancelled()) return;
    mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', securityLevel: 'strict', suppressErrorRendering: true, fontFamily: 'Microsoft YaHei UI, sans-serif', flowchart: { htmlLabels: false }, maxTextSize: 50000 });
    for (const element of diagrams) {
      if (cancelled()) return;
      const container = element.querySelector('.diagram-content')!;
      let sourceText = element.dataset.mermaid || ''; try { sourceText = decodeURIComponent(sourceText); } catch {}
      try {
        element.dataset.renderState = 'rendering';
        const { svg } = await mermaid.render(`bodu-diagram-${++diagramSequence}`, sourceText);
        if (cancelled()) return;
        container.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['style'], ADD_ATTR: ['dominant-baseline'] });
        element.dataset.renderState = 'complete';
      } catch (error) {
        console.warn('Mermaid render failed:', error);
        if (cancelled()) return;
        container.replaceChildren();
        const message = document.createElement('p'); message.className = 'diagram-error'; message.textContent = '图表语法暂时无法解析，原始内容如下：';
        const source = document.createElement('pre'); source.textContent = sourceText;
        container.append(message, source);
        element.dataset.renderState = 'error';
      }
    }
  }
}
