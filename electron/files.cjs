const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', 'target', 'build', '.git', '.obsidian']);
const isMarkdown = (p) => /\.(md|markdown)$/i.test(p);
const isInside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
function decode(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('gb18030').decode(buffer); }
}
async function readDocument(filePath) {
  if (typeof filePath !== 'string' || !isMarkdown(filePath)) throw new Error('请选择 .md 或 .markdown 文件');
  const canonical = await fs.realpath(filePath);
  const info = await fs.stat(canonical);
  if (!info.isFile()) throw new Error('这不是一个文件');
  if (info.size > MAX_FILE_SIZE) throw new Error('文档超过 20 MB，暂不支持打开');
  const buffer = await fs.readFile(canonical);
  const content = decode(buffer);
  let encoding = 'utf8', bom = false;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) { encoding = 'utf16le'; bom = true; }
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) { encoding = 'utf16be'; bom = true; }
  else if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) bom = true;
  else { try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { encoding = 'gb18030'; } }
  return { path: canonical, name: path.basename(canonical), content, modified: info.mtimeMs, size: info.size,
    revision: createHash('sha256').update(buffer).digest('hex'), encoding, bom, eol: content.includes('\r\n') ? '\r\n' : '\n' };
}
async function listDirectory(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.filter(e => !e.name.startsWith('.') && !e.isSymbolicLink() && (e.isDirectory() ? !SKIP_DIRS.has(e.name) : isMarkdown(e.name)))
    .map(e => ({ name: e.name, path: path.join(directory, e.name), directory: e.isDirectory() }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
}
async function searchDirectory(root, query, signal) {
  if (typeof query !== 'string' || !query.trim()) return { results: [], scanned: 0, skipped: 0, truncated: false };
  const term = query.toLocaleLowerCase();
  const results = [];
  let scanned = 0, skipped = 0, truncated = false;
  const queue = [root];
  while (queue.length && !signal?.aborted) {
    let entries;
    const folder = queue.shift();
    try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch { skipped++; continue; }
    for (const entry of entries) {
      if (signal?.aborted) break;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const filePath = path.join(folder, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) queue.push(filePath); continue; }
      if (!isMarkdown(entry.name)) continue;
      if (scanned >= 10000) { truncated = true; break; }
      try {
        scanned++;
        const doc = await readDocument(filePath);
        const lines = doc.content.split(/\r?\n/);
        const matches = [];
        let total = 0;
        for (let i = 0; i < lines.length; i++) {
          const index = lines[i].toLocaleLowerCase().indexOf(term);
          if (index < 0) continue;
          total++;
          if (matches.length < 5) matches.push({ line: i + 1, text: lines[i].slice(Math.max(0, index - 35), index + query.length + 90) });
        }
        if (total) results.push({ path: doc.path, name: doc.name, relative: path.relative(root, doc.path), matches, total });
      } catch { skipped++; }
      if (results.length >= 200) { truncated = true; break; }
    }
    if (truncated) break;
  }
  return { results, scanned, skipped, truncated };
}
module.exports = { readDocument, listDirectory, searchDirectory, decode, isInside, isMarkdown, MAX_FILE_SIZE, SKIP_DIRS };
