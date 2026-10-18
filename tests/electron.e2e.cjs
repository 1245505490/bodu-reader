const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const project = path.resolve(__dirname, '..');
const output = path.join(project, 'test-results');
const fixtures = path.join(project, '.local-fixtures', '桌面验证 文档');
const userData = path.join(output, `state-${Date.now()}`);
const sample = path.join(fixtures, '中文长文示例.md');
const failures = [], errors = [], results = [];
let desktop;
async function record(name, action) {
  const start = Date.now();
  try { await action(); results.push({ name, pass: true, ms: Date.now() - start }); console.log(`PASS ${name} (${Date.now() - start}ms)`); }
  catch (error) { failures.push({ name, error: String(error) }); console.error(`FAIL ${name}: ${error}`); }
}
async function launch(args = []) {
  const env = { ...process.env, BODU_USER_DATA: userData, BODU_E2E: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.BODU_DEV_URL;
  const started = Date.now();
  desktop = await electron.launch({ executablePath: process.env.BODU_EXE || require('electron'), args: process.env.BODU_EXE ? args : [project, ...args], env, timeout: 40000 });
  const page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  await page.locator('.markdown h1').first().waitFor({ timeout: 30000 });
  return { page, ms: Date.now() - started };
}
async function main() {
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(fixtures, { recursive: true });
  await sharp({ create: { width: 120, height: 50, channels: 4, background: '#4d6b50' } }).png().toFile(path.join(fixtures, '本地 图片.png'));
  const testFile = path.join(fixtures, '功能验证.md');
  const secondFile = path.join(fixtures, '第二篇.md');
  // Public, deterministic fixture: no personal document is required for the suite.
  await fs.writeFile(sample, '# 中文长文阅读示例\n\n用于验证离线阅读和长文排版的公开测试内容。\n' + Array.from({ length: 24 }, (_, i) => `\n## 阅读章节 ${i + 1}\n\n阅读笔记：第 ${i + 1} 节介绍文档组织、表格与代码。\n\n| 项目 | 内容 |\n| --- | --- |\n| 阅读进度 | ${i + 1} |\n\n\`\`\`javascript\nconst chapter = ${i + 1};\nconsole.log(chapter);\n\`\`\`\n\n${'这是一段中文阅读示例，检查连续正文的排版与目录定位。'.repeat(12)}\n`).join(''));
  await fs.writeFile(secondFile, '# 第二篇\n\n[返回](功能验证.md#重复标题)\n\n独立阅读位置\n' + Array.from({ length: 100 }, (_, i) => `\n## 段落 ${i}\n\n第 ${i} 段正文。`).join(''));
  await fs.writeFile(testFile, '# 功能验证\n\n离线阅读测试 搜索标记\n\n## 重复标题\n\n这里是搜索标记。\n\n## 重复标题\n\n- [x] 已完成\n- [ ] 待完成\n\n| 名称 | 数量 |\n| --- | --- |\n| 中文表格 | 42 |\n\n```typescript\nconst answer: number = 42;\n```\n\n行内公式 $E=mc^2$\n\n$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n\n```mermaid\ngraph LR\n A[开始] --> B[完成]\n```\n\n![本地图片](本地%20图片.png)\n\n![远程图片](https://example.com/remote.png)\n\n[下一篇](第二篇.md)\n\n<script>window.PWNED=true</script>\n<img src="x" onerror="window.PWNED=true">\n<a href="javascript:window.PWNED=true">危险链接</a>\n\n## 末尾\n\n搜索标记\n');
  const launchResult = await launch([process.env.BODU_SAMPLE || sample]); const page = launchResult.page;
  results.push({ name: '中文文档启动', pass: true, ms: launchResult.ms });
  console.log(`LAUNCH ${launchResult.ms}ms`);
  if (process.env.BODU_SAMPLE) {
    // Optionally smoke-test a caller's document locally, then use the public fixture.
    await page.screenshot({ path: path.join(output, '00-local-document.png') });
    const docs = await page.evaluate(async p => window.bodu.openDropped([p]), sample);
    await desktop.evaluate(({ BrowserWindow }, docs) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', docs), docs);
  }
  await record('中文长文、标题、表格和代码渲染', async () => {
    await expect(page.locator('.markdown h1')).toContainText('中文长文阅读示例');
    assert.ok(await page.locator('.markdown table').count() > 5);
    assert.ok(await page.locator('.markdown code').count() > 10);
    assert.ok(await page.locator('.outline button').count() > 10);
    await page.screenshot({ path: path.join(output, '01-long-document.png') });
  });
  await record('目录跳转与文内搜索定位', async () => {
    await page.locator('.outline button').nth(5).click();
    await expect.poll(() => page.locator('.reader-scroll').evaluate(e => e.scrollTop)).toBeGreaterThan(100);
    await page.keyboard.press('Control+f');
    await page.getByRole('textbox', { name: '搜索文章', exact: true }).fill('阅读');
    await expect.poll(() => page.locator('mark.search-match').count()).toBeGreaterThan(10);
    await page.getByRole('button', { name: '下一个匹配', exact: true }).click();
    await expect(page.locator('.find-count')).toContainText('2 /');
    await page.keyboard.press('Escape');
    await expect(page.locator('mark.search-match')).toHaveCount(0);
  });
  await record('拖入文件通道、多标签、公式、图表与相对图片离线呈现', async () => {
    // The same narrow bridge used by drag/drop; no privileged test API is shipped.
    const docs = await page.evaluate(async files => window.bodu.openDropped(files), [testFile, secondFile]);
    await desktop.evaluate(({ BrowserWindow }, docs) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', docs), docs);
    await page.getByRole('tab', { name: '功能验证', exact: true }).click();
    await expect(page.locator('.markdown .katex')).toHaveCount(2, { timeout: 20000 });
    await expect(page.locator('.diagram svg')).toHaveCount(1, { timeout: 30000 });
    await expect.poll(() => page.locator('img[alt="本地图片"]').evaluate(e => e.complete && e.naturalWidth)).toBe(120);
    await expect(page.locator('.image-unavailable')).toContainText('离线阅读');
    await expect(page.locator('.markdown h2[id="重复标题"]')).toHaveCount(1);
    await expect(page.locator('.markdown h2[id="重复标题-1"]')).toHaveCount(1);
    await expect(page.locator('.markdown input[type="checkbox"]')).toHaveCount(2);
    await expect(page.locator('.markdown .hljs-keyword')).toHaveCount(1);
    await page.locator('.reader-scroll').evaluate(e => { e.scrollTop = 0; });
    await page.screenshot({ path: path.join(output, '02-features-light.png') });
  });
  await record('文档脚本清理、渲染进程隔离与网络请求限制', async () => {
    assert.equal(await page.evaluate(() => window.PWNED), undefined);
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    assert.equal(await page.locator('.markdown script, .markdown [onerror], .markdown [href^="javascript:"]').count(), 0);
    const pref = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(pref.contextIsolation, true); assert.equal(pref.sandbox, true); assert.equal(pref.nodeIntegration, false);
    assert.equal(await page.evaluate(async () => { try { await fetch('https://example.com'); return false; } catch { return true; } }), true);
    assert.equal(await page.evaluate(async () => { try { await window.bodu.readFile('C:/Windows/win.ini'); return false; } catch { return true; } }), true);
  });
  await record('字体、字号、正文宽度、主题即时生效', async () => {
    await page.getByRole('button', { name: '排版与主题', exact: true }).click();
    await page.locator('#font-select').selectOption('serif');
    await page.locator('#font-size').fill('20');
    await page.locator('#reading-width').fill('1000');
    await page.getByRole('button', { name: '深色', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.markdown')).toHaveCSS('font-size', '20px');
    await page.getByRole('button', { name: '关闭阅读设置', exact: true }).click();
    await page.screenshot({ path: path.join(output, '03-features-dark.png') });
  });
  await record('相对 Markdown 链接与标签切换保留位置', async () => {
    await page.locator('.markdown a').filter({ hasText: '下一篇' }).click();
    await expect(page.locator('.markdown h1')).toContainText('第二篇');
    await page.locator('.reader-scroll').evaluate(e => { e.scrollTop = 1800; });
    await page.waitForTimeout(300);
    await page.getByRole('tab', { name: '功能验证', exact: true }).click();
    await page.getByRole('tab', { name: '第二篇', exact: true }).click();
    await expect.poll(() => page.locator('.reader-scroll').evaluate(e => e.scrollTop)).toBeGreaterThan(1700);
  });
  await record('原生选择文件夹、文件树与全文搜索', async () => {
    await desktop.evaluate(({ dialog }, fixtures) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixtures] }); }, fixtures);
    await page.getByRole('button', { name: '打开文件夹 (Ctrl+Shift+O)', exact: true }).click();
    await expect(page.locator('.files-section')).toContainText('功能验证');
    await page.keyboard.press('Control+Shift+f');
    await page.getByRole('textbox', { name: '搜索文件夹', exact: true }).fill('搜索标记');
    await expect(page.locator('.search-result')).toHaveCount(1, { timeout: 10000 });
    await expect(page.locator('.result-title small')).toHaveText('3');
    await page.locator('.result-match').first().click();
    await expect(page.locator('.markdown h1')).toContainText('功能验证');
    await page.locator('.reader-scroll').evaluate(e => { e.scrollTop = 0; });
    await page.locator('.result-match').last().click();
    await expect.poll(() => page.locator('.reader-scroll').evaluate(e => e.scrollTop)).toBeGreaterThan(300);
    await page.getByRole('button', { name: '文档', exact: true }).click();
    await page.getByRole('button', { name: '显示最近打开', exact: true }).click();
    await expect(page.locator('.files-section .sidebar-label')).toContainText('最近打开');
    await page.getByRole('button', { name: '返回文件夹', exact: true }).click();
  });
  await record('错误 Mermaid 显示源代码且后续图表仍能渲染', async () => {
    const errorFile = path.join(fixtures, '错误图表.md');
    await fs.writeFile(errorFile, '# 错误图表\n\n```mermaid\nnot a valid diagram !!!\n```\n\n```mermaid\ngraph TD\n A --> B\n```\n');
    const docs = await page.evaluate(async p => window.bodu.openDropped([p]), errorFile);
    await desktop.evaluate(({ BrowserWindow }, docs) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', docs), docs);
    await expect(page.locator('.diagram-error')).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator('.diagram svg')).toHaveCount(1, { timeout: 15000 });
    await page.getByRole('button', { name: '关闭 错误图表.md', exact: true }).click();
    await page.getByRole('tab', { name: '第二篇', exact: true }).click();
    await page.locator('.reader-scroll').evaluate(e => { e.scrollTop = 1900; });
  });
  await record('关闭程序后恢复标签、阅读位置和偏好', async () => {
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await desktop.close().catch(() => {});
    const next = await launch();
    await expect(next.page.locator('.markdown h1')).toContainText('第二篇');
    await expect(next.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(next.page.locator('.markdown')).toHaveCSS('font-size', '20px');
    await expect.poll(() => next.page.locator('.reader-scroll').evaluate(e => e.scrollTop)).toBeGreaterThan(1800);
    assert.ok(await next.page.getByRole('tab').count() >= 3);
    await next.page.screenshot({ path: path.join(output, '04-restored.png') });
  });
  await desktop?.close().catch(() => {});
  const report = { date: new Date().toISOString(), packaged: Boolean(process.env.BODU_EXE), results, failures, pageErrors: errors };
  await fs.writeFile(path.join(output, process.env.BODU_EXE ? 'packaged-report.json' : 'e2e-report.json'), JSON.stringify(report, null, 2));
  if (failures.length || errors.length) { console.error(JSON.stringify({ failures, errors }, null, 2)); process.exitCode = 1; }
}
main().catch(async error => { console.error(error); await desktop?.close().catch(() => {}); process.exitCode = 1; });
