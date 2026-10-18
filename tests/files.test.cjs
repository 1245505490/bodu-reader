const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readDocument, listDirectory, searchDirectory, decode, isInside, MAX_FILE_SIZE } = require('../electron/files.cjs');
const root = path.resolve('.local-fixtures/file-service');

test('decodes UTF-8, UTF-16 with BOM, and GB18030', () => {
  assert.equal(decode(Buffer.from('中文正文')), '中文正文');
  assert.equal(decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文', 'utf16le')])), '中文');
  assert.equal(decode(Buffer.from([0xd6, 0xd0, 0xce, 0xc4])), '中文');
});
test('path boundaries reject sibling-prefix and parent traversal', () => {
  assert.equal(isInside(root, path.join(root, 'nested/a.md')), true);
  assert.equal(isInside(root, root + '-other/a.md'), false);
  assert.equal(isInside(root, path.resolve(root, '../escape.md')), false);
});
test('reads actual document data, limits large files, and searches nested Chinese paths', async () => {
  await fs.mkdir(path.join(root, '子目录'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
  await fs.writeFile(path.join(root, '说明 文档.md'), '# 中文标题\n第一行搜索词\n第二行搜索词\n');
  await fs.writeFile(path.join(root, '子目录', '更多.markdown'), '# 更多\n也有搜索词\n');
  await fs.writeFile(path.join(root, 'node_modules', 'ignore.md'), '搜索词');
  await fs.writeFile(path.join(root, 'ignore.txt'), '搜索词');
  const doc = await readDocument(path.join(root, '说明 文档.md'));
  assert.match(doc.content, /中文标题/);
  const entries = await listDirectory(root);
  assert.equal(entries[0].name, '子目录');
  assert.equal(entries.some(e => e.name === 'node_modules' || e.name === 'ignore.txt'), false);
  const results = await searchDirectory(root, '搜索词');
  assert.equal(results.results.length, 2);
  assert.equal(results.scanned, 2);
  assert.equal(results.results.find(e => e.name === '说明 文档.md').total, 2);
  assert.equal(results.results.find(e => e.name === '说明 文档.md').matches[0].line, 2);
  assert.equal((await searchDirectory(root, '  ')).results.length, 0);
  const controller = new AbortController(); controller.abort();
  assert.equal((await searchDirectory(root, '搜索词', controller.signal)).scanned, 0);
  const big = path.join(root, 'large.md');
  const file = await fs.open(big, 'w'); await file.truncate(MAX_FILE_SIZE + 1); await file.close();
  await assert.rejects(() => readDocument(big), /20 MB/);
  await fs.unlink(big);
  await assert.rejects(() => readDocument(path.join(root, 'ignore.txt')), /请选择/);
});
