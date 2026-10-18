const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const iconv = require('iconv-lite');
const { createStorage, encode, replaceText, previewReplacement } = require('../electron/storage.cjs');
const { readDocument } = require('../electron/files.cjs');
const root = path.resolve('.local-fixtures/storage-tests');

test('editing: preserves encoding, BOM, CRLF and detects metadata accurately', async () => {
  await fs.mkdir(root, { recursive: true });
  const storage = createStorage(path.join(root, `data-${Date.now()}`));
  for (const encoding of ['utf8', 'utf16le', 'utf16be', 'gb18030']) {
    const file = path.join(root, `${encoding}.md`);
    const format = { encoding, bom: encoding !== 'gb18030', eol: '\r\n' };
    await fs.writeFile(file, encode('# 中文\n第一行\n', format));
    const before = await readDocument(file);
    assert.equal(before.encoding, encoding); assert.equal(before.bom, format.bom); assert.equal(before.eol, '\r\n');
    const saved = await storage.save({ path: file, content: '# 修改中文\n第二行\n', revision: before.revision, format: before });
    assert.equal(saved.status, 'saved'); assert.equal(saved.doc.encoding, encoding); assert.equal(saved.doc.bom, format.bom);
    assert.equal(saved.doc.content, '# 修改中文\r\n第二行\r\n');
    assert.equal((await storage.listHistory(file)).length, 2);
  }
});
test('editing: conflicts, deletion, simultaneous saves, failed writes and read-only files preserve content', async () => {
  await fs.mkdir(root, { recursive: true });
  const storage = createStorage(path.join(root, `conflict-${Date.now()}`));
  const file = path.join(root, '冲突.md');
  await fs.writeFile(file, '原文'); const original = await readDocument(file);
  await fs.writeFile(file, '外部修改');
  const conflict = await storage.save({ path: file, content: '本地编辑', revision: original.revision });
  assert.equal(conflict.status, 'conflict'); assert.equal(await fs.readFile(file, 'utf8'), '外部修改');
  const force = await storage.save({ path: file, content: '确认覆盖', revision: original.revision, force: true });
  assert.equal(force.status, 'saved');
  const latest = await readDocument(file);
  const concurrent = await Promise.all([storage.save({ path: file, content: '甲', revision: latest.revision }), storage.save({ path: file, content: '乙', revision: latest.revision })]);
  assert.deepEqual(concurrent.map(r => r.status), ['saved', 'conflict']);
  const beforeDelete = await readDocument(file); await fs.unlink(file);
  assert.equal((await storage.save({ path: file, content: '不要静默重建', revision: beforeDelete.revision })).status, 'conflict');
  assert.equal((await storage.save({ path: file, content: '确认重建', force: true })).status, 'saved');
  await fs.chmod(file, 0o444);
  try { await assert.rejects(() => storage.save({ path: file, content: '不可写', force: true }), /只读/); }
  finally { await fs.chmod(file, 0o666); }
  assert.equal(await fs.readFile(file, 'utf8'), '确认重建');
  await assert.rejects(() => storage.save({ path: path.join(root, 'missing', 'no.md'), content: '内容' }));
  assert.equal((await fs.readdir(root)).some(n => n.endsWith('.tmp')), false);
});
test('editing: drafts and history recover independently and history identifiers cannot traverse', async () => {
  const storage = createStorage(path.join(root, `draft-${Date.now()}`));
  const file = path.join(root, '历史.md');
  await fs.writeFile(file, '最初版本'); const before = await readDocument(file);
  await storage.writeDraft({ ...before, content: '未保存内容' });
  assert.equal((await storage.getDrafts())[0].content, '未保存内容');
  assert.equal(await fs.readFile(file, 'utf8'), '最初版本');
  const saved = await storage.save({ path: file, content: '第二版本', revision: before.revision });
  assert.equal(saved.status, 'saved');
  const versions = await storage.listHistory(file);
  const items = await Promise.all(versions.map(v => storage.getHistory(file, v.id)));
  assert.ok(items.some(i => i.content === '最初版本'));
  assert.ok(items.some(i => i.content === '第二版本'));
  await assert.rejects(() => storage.getHistory(file, '../escape.json'), /无效/);
  await storage.removeDraft(file); assert.equal((await storage.getDrafts()).length, 0);
  await storage.flush();
});
test('editing: batch replacement treats query and replacement literally, previews before changing', async () => {
  assert.deepEqual(replaceText('A.a a.a', 'a.a', '$&', false), { content: '$& $&', count: 2 });
  assert.deepEqual(replaceText('ABC abc', 'abc', '新', true), { content: 'ABC 新', count: 1 });
  const directory = path.join(root, '批量'); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, '一.md'), '测试 测试');
  await fs.writeFile(path.join(directory, '二.md'), '不变');
  const plan = await previewReplacement(directory, '测试', '修改', false);
  assert.equal(plan.changes.length, 1); assert.equal(plan.changes[0].count, 2);
  assert.equal(await fs.readFile(path.join(directory, '一.md'), 'utf8'), '测试 测试');
  assert.equal(plan.changes[0].after, '修改 修改');
  await assert.rejects(() => previewReplacement(directory, '', '新', false), /有效/);
});
