const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const iconv = require('iconv-lite');
const { readDocument, isMarkdown, MAX_FILE_SIZE, SKIP_DIRS } = require('./files.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const idFor = value => hash(process.platform === 'win32' ? value.toLowerCase() : value);
const locks = new Map();
function serial(key, operation) {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  locks.set(key, next);
  void next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
  return next;
}
async function atomicWrite(target, buffer, mode) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.bodu-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', mode ?? 0o600);
    await handle.writeFile(buffer); await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temporary, target);
  } finally { await handle?.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); }
}
function encode(content, format = {}) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE_SIZE) throw new Error('文档超过 20 MB，无法保存');
  const encoding = ['utf8', 'utf16le', 'utf16be', 'gb18030'].includes(format.encoding) ? format.encoding : 'utf8';
  const normalized = content.replace(/\r\n|\r|\n/g, format.eol === '\r\n' ? '\r\n' : '\n');
  let bytes = iconv.encode(normalized, encoding);
  if (iconv.decode(bytes, encoding) !== normalized) throw new Error('原文件编码无法表示部分文字，请另存为 UTF-8 文档');
  if (format.bom && encoding !== 'gb18030') bytes = Buffer.concat([Buffer.from(encoding === 'utf8' ? [0xef, 0xbb, 0xbf] : encoding === 'utf16be' ? [0xfe, 0xff] : [0xff, 0xfe]), bytes]);
  if (bytes.length > MAX_FILE_SIZE) throw new Error('保存后的文档超过 20 MB');
  return bytes;
}
function createStorage(userData) {
  const historyRoot = path.join(userData, 'history');
  const draftsRoot = path.join(userData, 'drafts');
  async function history(doc, label) {
    const directory = path.join(historyRoot, idFor(doc.path));
    await fs.mkdir(directory, { recursive: true });
    const id = `${Date.now()}-${doc.revision.slice(0, 12)}.json`;
    const existing = (await fs.readdir(directory)).filter(name => /^\d+-[a-f\d]+\.json$/.test(name)).sort().reverse();
    if (existing[0]?.endsWith(`-${doc.revision.slice(0, 12)}.json`)) return;
    const snapshot = { id, path: doc.path, time: Date.now(), content: doc.content, revision: doc.revision, encoding: doc.encoding, eol: doc.eol, bom: doc.bom, label };
    await atomicWrite(path.join(directory, id), JSON.stringify(snapshot));
    let total = 0;
    const all = [id, ...existing].sort().reverse();
    for (let i = 0; i < all.length; i++) {
      const file = path.join(directory, all[i]);
      total += (await fs.stat(file)).size;
      if (i >= 30 || (total > 100 * 1024 * 1024 && i > 0)) await fs.unlink(file);
    }
  }
  async function save(options) {
    const target = path.resolve(options.path);
    if (!isMarkdown(target)) throw new Error('文件名必须以 .md 或 .markdown 结尾');
    return serial(idFor(target), async () => {
      let current = null, mode;
      try { current = await readDocument(target); mode = (await fs.stat(target)).mode; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!options.force && (current?.revision || null) !== (options.revision || null)) return { status: 'conflict', current };
      if (mode !== undefined && !(mode & 0o200)) throw new Error('文件为只读，无法保存；请另存为其他文档');
      const buffer = encode(options.content, options.format || current || {});
      if (current?.revision === hash(buffer)) return { status: 'saved', doc: current };
      if (current) await history(current, options.label || '修改前');
      // Check again after writing history; an external editor may have saved in the meantime.
      if (!options.force) {
        let latest = null;
        try { latest = await readDocument(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if ((latest?.revision || null) !== (options.revision || null)) return { status: 'conflict', current: latest };
      }
      await atomicWrite(target, buffer, mode);
      const doc = await readDocument(target);
      let historyWarning = false;
      try { await history(doc, '保存后'); } catch { historyWarning = true; }
      return { status: 'saved', doc, historyWarning };
    });
  }
  async function writeDraft(draft) {
    if (!draft || typeof draft.path !== 'string' || typeof draft.content !== 'string' || Buffer.byteLength(draft.content) > MAX_FILE_SIZE) throw new Error('恢复草稿数据无效或超过 20 MB');
    return serial(`draft:${idFor(draft.path)}`, async () => {
      await fs.mkdir(draftsRoot, { recursive: true });
      await atomicWrite(path.join(draftsRoot, `${idFor(draft.path)}.json`), JSON.stringify({ ...draft, time: Date.now() }));
    });
  }
  async function removeDraft(docPath) {
    return serial(`draft:${idFor(docPath)}`, () => fs.unlink(path.join(draftsRoot, `${idFor(docPath)}.json`)).catch(e => { if (e.code !== 'ENOENT') throw e; }));
  }
  async function getDrafts() {
    let names; try { names = await fs.readdir(draftsRoot); } catch { return []; }
    const drafts = [];
    for (const name of names.filter(n => /^[a-f\d]{64}\.json$/.test(n)).slice(0, 100)) {
      try { const item = JSON.parse(await fs.readFile(path.join(draftsRoot, name), 'utf8')); if (typeof item.path === 'string' && typeof item.content === 'string') drafts.push(item); } catch {}
    }
    return drafts;
  }
  async function listHistory(docPath) {
    const directory = path.join(historyRoot, idFor(docPath));
    let names; try { names = await fs.readdir(directory); } catch { return []; }
    const result = [];
    for (const name of names.filter(n => /^\d+-[a-f\d]+\.json$/.test(n)).sort().reverse()) {
      try { const item = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')); result.push({ id: name, time: item.time, label: item.label, size: Buffer.byteLength(item.content), excerpt: item.content.slice(0, 140) }); } catch {}
    }
    return result;
  }
  async function getHistory(docPath, id) {
    if (!/^\d+-[a-f\d]+\.json$/.test(id)) throw new Error('无效的历史版本');
    return JSON.parse(await fs.readFile(path.join(historyRoot, idFor(docPath), id), 'utf8'));
  }
  async function flush() { await Promise.allSettled([...locks.values()]); }
  return { save, writeDraft, removeDraft, getDrafts, listHistory, getHistory, flush };
}
function replaceText(content, query, replacement, caseSensitive) {
  if (!query) return { content, count: 0 };
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  let count = 0;
  return { content: content.replace(expression, () => { count++; return replacement; }), count };
}
async function previewReplacement(root, query, replacement, caseSensitive) {
  if (!query || query.length > 500 || replacement.length > 10000) throw new Error('请输入有效的查找和替换内容');
  const queue = [root], changes = [];
  let scanned = 0, skipped = 0, truncated = false;
  while (queue.length && !truncated) {
    const folder = queue.shift(); let entries;
    try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch { skipped++; continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) queue.push(file); continue; }
      if (!isMarkdown(file)) continue;
      if (scanned++ >= 10000) { truncated = true; break; }
      try {
        const doc = await readDocument(file);
        const result = replaceText(doc.content, query, replacement, caseSensitive);
        if (result.count && result.content !== doc.content) {
          const at = caseSensitive ? doc.content.indexOf(query) : doc.content.toLowerCase().indexOf(query.toLowerCase());
          const before = doc.content.slice(Math.max(0, at - 35), at + query.length + 70);
          changes.push({ path: doc.path, name: doc.name, relative: path.relative(root, doc.path), revision: doc.revision, count: result.count, before, after: replaceText(before, query, replacement, caseSensitive).content });
        }
      } catch { skipped++; }
      if (changes.length >= 200) { truncated = true; break; }
    }
  }
  return { changes, scanned, skipped, truncated };
}
module.exports = { createStorage, encode, replaceText, previewReplacement, atomicWrite };
