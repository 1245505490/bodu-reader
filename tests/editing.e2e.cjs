const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { spawn } = require('node:child_process');
const root = path.resolve('.local-fixtures', `编辑验收-${Date.now()}`);
const output = path.resolve('test-results');
const data = path.join(output, `editing-state-${Date.now()}`);
let desktop, page;
const results = [], errors = [], failures = [];
const doc = path.join(root, '编辑测试.md'), newFile = path.join(root, '新建 文档.md'), copyFile = path.join(root, '另存为.md');
const base = '# 编辑测试\n\n原始中文内容\n\n## 表格\n\n| 名称 | 数量 |\n| :--- | ---: |\n| 测试 | 1 |\n\n末尾内容\n';
async function launch(args = []) {
  const env = { ...process.env, BODU_USER_DATA: data, BODU_E2E: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.BODU_DEV_URL;
  desktop = await electron.launch({ executablePath: process.env.BODU_EXE || require('electron'), args: process.env.BODU_EXE ? args : [process.cwd(), ...args], env, timeout: 30000 });
  page = await desktop.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.locator('.tabs [role=tab]').first().waitFor();
  return page;
}
async function step(name, action) {
  const start = Date.now();
  try { await action(); results.push({ name, pass: true, ms: Date.now() - start }); console.log(`PASS ${name} (${Date.now() - start}ms)`); }
  catch (error) {
    failures.push({ name, error: String(error) }); console.error(`FAIL ${name}: ${error}`);
    await page?.screenshot({ path: path.join(output, 'editing-failure.png'), scale: 'css' }).catch(() => {});
    throw error;
  }
}
const editor = () => page.locator('.cm-content[contenteditable=true]');
async function text(content) { await editor().fill(content); await expect.poll(async () => (await editor().locator('.cm-line').allTextContents()).join('\n')).toBe(content); }
async function saveTarget(target, cancelled = false) { await desktop.evaluate(({ dialog }, { target, cancelled }) => { dialog.showSaveDialog = async () => ({ canceled: cancelled, filePath: target }); }, { target, cancelled }); }
async function open(p) { const docs = await page.evaluate(async p => window.bodu.openDropped([p]), p); await desktop.evaluate(({ BrowserWindow }, docs) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', docs), docs); await expect(page.locator('[role=tab][aria-selected=true]')).toContainText(path.basename(p, '.md')); }
async function save() { await page.keyboard.press('Control+s'); await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(0, { timeout: 10000 }); }
async function mode(name = '编辑模式') { await page.getByRole('button', { name, exact: true }).click(); if (name !== '阅读模式') await editor().waitFor(); }
async function main() {
  await fs.mkdir(root, { recursive: true }); await fs.mkdir(output, { recursive: true }); await fs.writeFile(doc, base);
  await launch([doc]);
  try {
    await step('阅读启动不加载编辑器', async () => {
      await expect(page.locator('.markdown h1')).toContainText('编辑测试');
      assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(e => /\/Editor-/.test(e.name))), false);
    });
    await step('中文编辑、未保存标记、撤销重做与格式工具栏', async () => {
      await mode(); await text('工具栏文字'); await editor().press('Control+a');
      await page.getByRole('button', { name: '加粗 (Ctrl+B)', exact: true }).click(); await expect(editor()).toHaveText('**工具栏文字**');
      await page.getByRole('button', { name: '撤销 (Ctrl+Z)', exact: true }).click(); await expect(editor()).toHaveText('工具栏文字');
      await page.getByRole('button', { name: '重做 (Ctrl+Y)', exact: true }).click(); await expect(editor()).toHaveText('**工具栏文字**');
      await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(1);
      await editor().press('Control+a'); await page.getByRole('button', { name: '斜体 (Ctrl+I)', exact: true }).click(); await expect(editor()).toHaveText('***工具栏文字***');
      await editor().press('Control+a'); await page.getByRole('button', { name: '删除线', exact: true }).click(); await expect(editor()).toHaveText('~~***工具栏文字***~~');
      await text('列表正文'); await page.getByLabel('设置标题', { exact: true }).selectOption('## '); await expect(editor()).toHaveText('## 列表正文');
      await text('条目'); await page.getByRole('button', { name: '有序列表', exact: true }).click(); await expect(editor()).toHaveText('1. 条目');
      await text('条目'); await page.getByRole('button', { name: '无序列表', exact: true }).click(); await expect(editor()).toHaveText('- 条目');
      await text('条目'); await page.getByRole('button', { name: '任务列表', exact: true }).click(); await expect(editor()).toHaveText('- [ ] 条目');
      await text('引用正文'); await page.getByRole('button', { name: '引用', exact: true }).click(); await expect(editor()).toHaveText('> 引用正文');
      await text('代码'); await editor().press('Control+a'); await page.getByRole('button', { name: '代码块', exact: true }).click(); await expect(editor()).toContainText('```');
      await page.getByRole('button', { name: '自动换行', exact: true }).click(); await expect(page.locator('.cm-lineWrapping')).toHaveCount(0);
      await page.getByRole('button', { name: '自动换行', exact: true }).click(); await expect(page.locator('.cm-lineWrapping')).toHaveCount(1);
    });
    await step('真实浏览器中文组合输入与原文件保存', async () => {
      await text('# 中文编辑\n\n'); await editor().press('Control+End');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: '中文输入测试', selectionStart: 6, selectionEnd: 6 });
      await cdp.send('Input.insertText', { text: '中文输入测试' }); await cdp.detach();
      await expect(editor()).toContainText('中文输入测试'); await save();
      const saved = await fs.readFile(doc, 'utf8'); assert.match(saved, /中文输入测试/); assert.equal(saved.match(/中文输入测试/g).length, 1);
    });
    await step('新建、取消保存、首次保存与另存为', async () => {
      await page.keyboard.press('Control+n'); await editor().waitFor(); await text('# 新建文章\n\n写下一段中文。');
      await saveTarget(newFile, true); await page.keyboard.press('Control+s'); await page.waitForTimeout(150); await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(1);
      await saveTarget(newFile); await save(); assert.match(await fs.readFile(newFile, 'utf8'), /写下一段中文/);
      await saveTarget(copyFile); await page.keyboard.press('Control+Shift+s'); await expect(page.locator('.tab.active')).toContainText('另存为');
      assert.equal(await fs.readFile(copyFile, 'utf8'), await fs.readFile(newFile, 'utf8'));
    });
    await step('另存为不会覆盖其他标签中的未保存编辑', async () => {
      const dirtyTarget = path.join(root, '另一个未保存.md'); await fs.writeFile(dirtyTarget, '目标原文');
      await open(dirtyTarget); await mode(); await text('目标未保存编辑');
      await page.getByRole('tab', { name: '另存为', exact: true }).click();
      await saveTarget(dirtyTarget); await page.keyboard.press('Control+Shift+s'); await expect(page.locator('.toast')).toContainText('目标文档已有未保存编辑');
      assert.equal(await fs.readFile(dirtyTarget, 'utf8'), '目标原文');
      await page.getByRole('tab', { name: '另一个未保存', exact: true }).click(); await expect(editor()).toHaveText('目标未保存编辑'); await save();
      await page.getByRole('tab', { name: '另存为', exact: true }).click();
    });
    await step('标签切换保留编辑、光标和独立撤销历史', async () => {
      await editor().press('Control+End'); await page.keyboard.insertText('甲标签');
      await page.getByRole('tab', { name: '编辑测试', exact: true }).click(); await mode();
      await editor().press('Control+End'); await page.keyboard.insertText('乙标签');
      await page.getByRole('tab', { name: '另存为', exact: true }).click(); await expect(editor()).toContainText('甲标签');
      await page.keyboard.insertText('光标续写'); await expect(editor()).toContainText('甲标签光标续写');
      await page.getByRole('button', { name: '撤销 (Ctrl+Z)', exact: true }).click(); await expect(editor()).not.toContainText('光标续写');
      await page.getByRole('button', { name: '重做 (Ctrl+Y)', exact: true }).click(); await expect(editor()).toContainText('光标续写');
      await save();
      assert.match(await fs.readFile(copyFile, 'utf8'), /甲标签/);
      await page.getByRole('tab', { name: '编辑测试', exact: true }).click(); await expect(editor()).toContainText('乙标签'); await save();
    });
    await step('插入链接与编辑器查找、逐项替换、全部替换和大小写', async () => {
      await text('链接文字'); await editor().press('Control+a'); await page.getByRole('button', { name: '插入链接', exact: true }).click();
      await page.getByRole('textbox', { name: '链接地址', exact: true }).fill('https://example.com');
      await page.getByRole('dialog', { name: '插入链接', exact: true }).getByRole('button', { name: '插入链接', exact: true }).click();
      await expect(editor()).toHaveText('[链接文字](https://example.com)');
      await text('Hello hello HELLO'); await page.getByRole('button', { name: '查找与替换 (Ctrl+H)', exact: true }).click();
      await page.locator('.cm-search input[name=search]').fill('hello'); await page.locator('.cm-search input[name=replace]').fill('替换');
      await page.locator('.cm-search input[name=case]').check(); await page.locator('.cm-search button[name=next]').click(); await page.locator('.cm-search button[name=replace]').click();
      await expect(editor()).toHaveText('Hello 替换 HELLO');
      await page.locator('.cm-search input[name=case]').uncheck(); await page.locator('.cm-search button[name=replaceAll]').click();
      await expect(editor()).toHaveText('替换 替换 替换'); await page.locator('.cm-search button[name=close]').click();
    });
    await step('表格可视化新增和原表格修改，保留正文与对齐', async () => {
      await text('表格前文'); await editor().press('Control+End'); await page.getByRole('button', { name: '插入或编辑表格', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '表格编辑器', exact: true });
      await dialog.getByRole('textbox', { name: '第1行第1列', exact: true }).fill('项目'); await dialog.getByRole('textbox', { name: '第2行第1列', exact: true }).fill('内容');
      await dialog.getByRole('button', { name: '添加列', exact: true }).click(); await dialog.getByRole('textbox', { name: '第1行第3列', exact: true }).fill('第三列');
      await dialog.getByRole('combobox', { name: '第2列对齐', exact: true }).selectOption('right'); await dialog.getByRole('button', { name: '添加行', exact: true }).click();
      await dialog.getByRole('button', { name: '删除第4行', exact: true }).click(); await dialog.getByRole('button', { name: '删除第3列', exact: true }).click();
      await dialog.getByRole('button', { name: '应用表格', exact: true }).click(); await expect(editor()).toContainText('| 项目 | 列二 |'); await expect(editor()).toContainText('| :--- | ---: |');
      await editor().press('Control+Home'); await editor().press('ArrowDown'); await editor().press('ArrowDown');
      await page.getByRole('button', { name: '插入或编辑表格', exact: true }).click(); await dialog.getByRole('textbox', { name: '第2行第1列', exact: true }).fill('已修改单元格'); await dialog.getByRole('button', { name: '应用表格', exact: true }).click();
      await expect(editor()).toContainText('表格前文'); await expect(editor()).toContainText('已修改单元格');
      await mode('左右对照'); await expect(page.locator('.reader-scroll .markdown table')).toHaveCount(1); await expect(page.locator('.markdown td').first()).toHaveText('已修改单元格');
      await page.screenshot({ path: path.join(output, 'editing-split.png'), scale: 'css' }); await save();
    });
    await step('选择本地图片、粘贴图片自动落盘与离线预览', async () => {
      const imageFile = path.join(root, '源 图片.png'); const image = await sharp({ create: { width: 100, height: 60, channels: 4, background: '#6b8859' } }).png().toBuffer(); await fs.writeFile(imageFile, image);
      await desktop.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, imageFile);
      await editor().press('Control+End'); await page.getByRole('button', { name: '插入图片', exact: true }).click();
      await expect.poll(() => page.locator('.markdown img').count()).toBe(1); await expect.poll(() => page.locator('.markdown img').first().evaluate(e => e.naturalWidth)).toBe(100);
      await editor().press('Control+End');
      await editor().evaluate((element, bytes) => {
        const file = new File([new Uint8Array(bytes)], 'paste.png', { type: 'image/png' }); const transfer = new DataTransfer(); transfer.items.add(file);
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      }, [...image]);
      await expect.poll(() => page.locator('.markdown img').count()).toBe(2); await expect.poll(async () => (await fs.readdir(path.join(root, '编辑测试.assets'))).length).toBe(2);
      await save(); assert.match(await fs.readFile(doc, 'utf8'), /%E7%BC%96%E8%BE%91%E6%B5%8B%E8%AF%95.assets\//);
    });
    await step('实时预览渲染公式、Mermaid 与代码', async () => {
      await text('# 实时预览\n\n$x^2$\n\n```mermaid\ngraph LR\n A --> B\n```\n\n```javascript\nconst value = 1;\n```');
      await expect(page.locator('.markdown .katex')).toHaveCount(1); await expect(page.locator('.markdown .diagram svg')).toHaveCount(1, { timeout: 20000 }); await expect(page.locator('.markdown .hljs-keyword')).toHaveCount(1);
      await save(); await page.screenshot({ path: path.join(output, 'editing-preview.png'), scale: 'css' });
    });
    await step('编辑目录跳转与切换标签后的格式快捷键', async () => {
      const headings = '# 第一节\n\n正文\n\n## 第二节\n\n正文'; await text(headings);
      await expect(page.locator('.outline')).toContainText('第二节'); await mode('编辑模式'); await page.locator('.outline button').filter({ hasText: '第二节' }).click();
      await expect(page.locator('.statusbar')).toContainText('行 5，列 1');
      await page.getByRole('tab', { name: '另存为', exact: true }).click(); await page.getByRole('tab', { name: '编辑测试', exact: true }).click();
      await editor().press('Control+a'); await editor().press('Control+b'); await expect(editor()).toContainText('**# 第一节'); await save();
    });
    await step('外部修改冲突：取消、载入、覆盖与另存为', async () => {
      await text('本地未保存 A'); await fs.writeFile(doc, '外部版本 A'); await page.keyboard.press('Control+s');
      await expect(page.getByRole('dialog', { name: '文件已在外部修改', exact: true })).toBeVisible(); await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(await fs.readFile(doc, 'utf8'), '外部版本 A'); await expect(editor()).toContainText('本地未保存 A');
      await page.keyboard.press('Control+s'); await page.getByRole('button', { name: '载入磁盘版本', exact: true }).last().click(); await expect(editor()).toHaveText('外部版本 A');
      await text('本地确认覆盖'); await fs.writeFile(doc, '外部版本 B'); await page.keyboard.press('Control+s'); await page.getByRole('button', { name: '使用当前内容覆盖', exact: true }).click(); await expect.poll(() => fs.readFile(doc, 'utf8')).toBe('本地确认覆盖');
      await text('冲突另存为内容'); await fs.writeFile(doc, '需要保留的外部版本'); const conflictCopy = path.join(root, '冲突副本.md'); await saveTarget(conflictCopy); await page.keyboard.press('Control+s'); await page.getByRole('dialog', { name: '文件已在外部修改', exact: true }).getByRole('button', { name: '另存为', exact: true }).click(); await expect(page.locator('.tab.active')).toContainText('冲突副本');
      assert.equal(await fs.readFile(doc, 'utf8'), '需要保留的外部版本'); assert.equal(await fs.readFile(conflictCopy, 'utf8'), '冲突另存为内容');
    });
    await step('版本历史浏览与恢复，保存前不改原文件', async () => {
      await text('历史版本一'); await save(); await text('历史版本二'); await save();
      const before = await fs.readFile(path.join(root, '冲突副本.md'), 'utf8');
      assert.equal(before, '历史版本二');
      await page.getByRole('button', { name: '版本历史', exact: true }).click(); await expect(page.locator('.history-list button')).not.toHaveCount(0);
      const version = page.locator('.history-list button').filter({ hasText: '历史版本一' }).first(); await version.click(); await expect(page.locator('.history-content')).toHaveText('历史版本一'); await page.getByRole('button', { name: '恢复到编辑器', exact: true }).click();
      await expect(editor()).toHaveText('历史版本一'); assert.equal(await fs.readFile(path.join(root, '冲突副本.md'), 'utf8'), before); await save();
    });
    await step('未保存标签关闭：取消、不保存、保存', async () => {
      await page.keyboard.press('Control+n'); await text('关闭时测试'); await page.keyboard.press('Control+w');
      await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
      await page.keyboard.press('Shift+Tab'); await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
      await page.keyboard.press('Escape'); await expect(editor()).toHaveText('关闭时测试');
      await page.keyboard.press('Control+w'); await page.getByRole('button', { name: '不保存', exact: true }).click(); await expect(page.getByRole('tab', { name: '未命名', exact: true })).toHaveCount(0);
      await page.keyboard.press('Control+n'); await text('关闭时保存'); const closeFile = path.join(root, '关闭保存.md'); await saveTarget(closeFile); await page.keyboard.press('Control+w'); await page.getByRole('button', { name: '保存', exact: true }).click(); await expect.poll(() => fs.readFile(closeFile, 'utf8').catch(() => '')).toBe('关闭时保存');
    });
    await step('只读保存失败保留编辑，并可另存为', async () => {
      const readonly = path.join(root, '只读.md'); await fs.writeFile(readonly, '只读原文'); await fs.chmod(readonly, 0o444);
      try { await open(readonly); await mode(); await text('只读编辑保留'); await page.keyboard.press('Control+s'); await expect(page.locator('.toast')).toContainText('只读'); await expect(editor()).toHaveText('只读编辑保留'); assert.equal(await fs.readFile(readonly, 'utf8'), '只读原文'); await saveTarget(path.join(root, '只读副本.md')); await page.keyboard.press('Control+Shift+s'); await expect(page.locator('.tab.active')).toContainText('只读副本'); }
      finally { await fs.chmod(readonly, 0o666); }
    });
    await step('原文件被删除时提示冲突，取消不重建，确认后重建', async () => {
      const removed = path.join(root, '删除冲突.md'); await fs.writeFile(removed, '原文'); await open(removed); await mode(); await text('删除后的编辑'); await fs.unlink(removed);
      await page.keyboard.press('Control+s'); await page.getByRole('dialog', { name: '文件已在外部修改', exact: true }).getByRole('button', { name: '取消', exact: true }).click(); await assert.rejects(() => fs.stat(removed)); await expect(editor()).toHaveText('删除后的编辑');
      await page.keyboard.press('Control+s'); await page.getByRole('button', { name: '使用当前内容覆盖', exact: true }).click(); await expect.poll(() => fs.readFile(removed, 'utf8').catch(() => '')).toBe('删除后的编辑');
    });
    await step('文件夹批量替换：预览、确认、脏文件和外部冲突保护', async () => {
      const a = path.join(root, '批量甲.md'), b = path.join(root, '批量乙.md'), c = path.join(root, '批量丙.md');
      await fs.writeFile(a, 'TOKEN TOKEN'); await fs.writeFile(b, 'TOKEN 乙'); await fs.writeFile(c, 'TOKEN 丙');
      await open(b); await mode(); await text('TOKEN 乙 未保存');
      await desktop.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, root);
      await page.getByRole('button', { name: '打开文件夹 (Ctrl+Shift+O)', exact: true }).click(); await page.keyboard.press('Control+Shift+f'); await page.getByRole('button', { name: '文件夹批量替换', exact: true }).click();
      await page.getByRole('textbox', { name: '批量查找内容', exact: true }).fill('TOKEN'); await page.getByRole('textbox', { name: '批量替换内容', exact: true }).fill('替换后'); await page.getByRole('button', { name: '预览更改', exact: true }).click();
      await expect(page.locator('.batch-change')).toHaveCount(3); assert.equal(await fs.readFile(a, 'utf8'), 'TOKEN TOKEN');
      await expect(page.getByRole('checkbox', { name: '替换 批量乙.md', exact: true })).toBeDisabled();
      await fs.writeFile(c, '外部变动 TOKEN');
      await page.getByRole('button', { name: '替换所选文档', exact: true }).click(); assert.equal(await fs.readFile(a, 'utf8'), 'TOKEN TOKEN');
      await page.getByRole('button', { name: '确认替换', exact: true }).click(); await expect.poll(() => fs.readFile(a, 'utf8')).toBe('替换后 替换后'); assert.equal(await fs.readFile(b, 'utf8'), 'TOKEN 乙'); assert.equal(await fs.readFile(c, 'utf8'), '外部变动 TOKEN');
      await expect(page.locator('.batch-status.conflict')).toHaveCount(1);
      const versions = await page.evaluate(async p => window.bodu.listHistory(p), a); assert.ok(versions.some(v => v.label === '批量替换前'));
      await page.screenshot({ path: path.join(output, 'editing-batch.png'), scale: 'css' }); await page.getByRole('button', { name: '关闭批量替换', exact: true }).click();
      await save();
    });
    await step('窗口退出取消与异常终止草稿恢复', async () => {
      await page.keyboard.press('Control+n'); await text('# 异常恢复\n\n尚未保存的文字');
      await page.getByRole('button', { name: '关闭窗口', exact: true }).click(); await expect(page.getByRole('dialog', { name: '保存文档更改？', exact: true })).toBeVisible(); await page.getByRole('button', { name: '取消', exact: true }).click();
      await expect(editor()).toContainText('尚未保存的文字');
      await expect.poll(async () => (await fs.readdir(path.join(data, 'drafts'))).length).toBeGreaterThan(0);
      const pid = desktop.process().pid;
      // Terminate only this isolated test process and its children, emulating an application crash.
      await new Promise((resolve, reject) => { const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('exit', resolve); killer.on('error', reject); });
      await launch(); await expect(editor()).toContainText('尚未保存的文字'); await expect(page.locator('.tab.active .dirty-dot')).toHaveCount(1);
      await page.getByRole('button', { name: '关闭窗口', exact: true }).click(); await page.getByRole('button', { name: '不保存', exact: true }).click(); await desktop.close(); desktop = null;
    });
  } finally {
    if (desktop) { const pid = desktop.process()?.pid; if (pid) await new Promise(resolve => { const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('exit', resolve); killer.on('error', resolve); }); }
    await fs.writeFile(path.join(output, process.env.BODU_EXE ? 'editing-packaged-report.json' : 'editing-report.json'), JSON.stringify({ date: new Date().toISOString(), results, failures, pageErrors: errors }, null, 2));
    if (failures.length || errors.length) process.exitCode = 1;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
