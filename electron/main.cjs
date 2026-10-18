const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session, Menu, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { readDocument, listDirectory, searchDirectory, isInside, isMarkdown } = require('./files.cjs');
const { createStorage, previewReplacement, replaceText } = require('./storage.cjs');
const { randomUUID } = require('node:crypto');

if (process.env.BODU_USER_DATA) app.setPath('userData', path.resolve(process.env.BODU_USER_DATA));
app.setName('礴读');
app.setAppUserModelId('cn.bodu.reader');
protocol.registerSchemesAsPrivileged([{ scheme: 'bodu-image', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let win, state = {}, saveChain = Promise.resolve(), searchController, ready = false, storage, closing = false, closePending = false;
const dirtyPaths = new Set(), replacementPlans = new Map();
const grantedFiles = new Set(), grantedRoots = new Set();
const key = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
const canRead = p => grantedFiles.has(key(p)) || [...grantedRoots].some(root => isInside(root, key(p)));
async function grantFile(p) {
  const doc = await readDocument(p);
  grantedFiles.add(key(doc.path));
  grantedRoots.add(key(path.dirname(doc.path)));
  return doc;
}
async function checkedPath(p) {
  if (typeof p !== 'string') throw new Error('无效路径');
  const resolved = await fs.realpath(p);
  if (!canRead(resolved)) throw new Error('请先通过“打开文件”或“打开文件夹”选择这个位置');
  return resolved;
}
const stateFile = () => path.join(app.getPath('userData'), 'reader-state.json');
async function loadState() {
  try { state = JSON.parse(await fs.readFile(stateFile(), 'utf8')); } catch { state = {}; }
  // Only locally saved, previously user-selected locations are restored.
  for (const p of [...(state.recent || []).map(e => e.path), ...(state.tabs || [])].slice(0, 60)) {
    if (typeof p === 'string' && path.isAbsolute(p) && isMarkdown(p)) { grantedFiles.add(key(p)); grantedRoots.add(key(path.dirname(p))); }
  }
  if (typeof state.folder === 'string' && path.isAbsolute(state.folder)) grantedRoots.add(key(state.folder));
}
function persist(next) {
  if (!next || typeof next !== 'object' || JSON.stringify(next).length > 500000) throw new Error('设置数据无效');
  state = next;
  saveChain = saveChain.catch(() => {}).then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(`${stateFile()}.tmp`, JSON.stringify(state), 'utf8');
    await fs.rename(`${stateFile()}.tmp`, stateFile());
  });
  return saveChain;
}
async function openArguments(argv) {
  const docs = [];
  for (const p of argv.filter(a => isMarkdown(a) && path.isAbsolute(a))) {
    try { docs.push(await grantFile(p)); } catch (e) { dialog.showErrorBox('无法打开文档', `${p}\n${e.message}`); }
  }
  if (docs.length && win) {
    if (ready) win.webContents.send('open-files', docs);
    else pendingDocs.push(...docs);
  }
}
const pendingDocs = [];
const hasLock = process.env.BODU_E2E ? true : app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', (_, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } void openArguments(argv); });
  app.whenReady().then(async () => {
    await loadState();
    storage = createStorage(app.getPath('userData'));
    const drafts = await storage.getDrafts();
    for (const draft of drafts) {
      if (isMarkdown(draft.path) && path.isAbsolute(draft.path)) { grantedFiles.add(key(draft.path)); grantedRoots.add(key(path.dirname(draft.path))); }
      dirtyPaths.add(draft.path);
    }
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const localDev = process.env.BODU_DEV_URL && /^(http|ws):\/\/127\.0\.0\.1:5173\//.test(details.url);
      callback({ cancel: /^(https?|wss?|ftp):/i.test(details.url) && !localDev });
    });
    protocol.handle('bodu-image', async request => {
      try {
        const url = new URL(request.url);
        const from = await checkedPath(url.searchParams.get('from'));
        const src = url.searchParams.get('src');
        if (!src || /^(https?|data|javascript):/i.test(src) || src.startsWith('//')) throw new Error('不支持的图片路径');
        const target = src.startsWith('file:') ? fileURLToPath(src) : path.resolve(path.dirname(from), decodeURIComponent(src.split('#')[0]));
        const real = await fs.realpath(target);
        // Images are data only; limit to granted document roots and known image extensions.
        if (!canRead(real) || !/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(real)) throw new Error('图片不在已打开的位置');
        return net.fetch(pathToFileURL(real).href);
      } catch { return new Response('Image unavailable', { status: 403 }); }
    });
    win = new BrowserWindow({
      width: 1360, height: 920, minWidth: 800, minHeight: 560,
      title: '礴读', backgroundColor: '#fafbf8', frame: false, show: false,
      icon: path.join(__dirname, '../build/icon.ico'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.once('ready-to-show', () => win.show());
    win.on('close', event => {
      if (closing) return;
      if (!ready || win.webContents.isCrashed()) { closing = true; return; }
      event.preventDefault();
      if (closePending) return;
      closePending = true;
      win.webContents.send('request-close');
    });
    ipcMain.on('close-ready', async (event, allowed) => {
      if (event.sender !== win.webContents) return;
      closePending = false;
      if (!allowed) return;
      await Promise.all([saveChain, storage.flush()]);
      closing = true;
      win.close();
    });
    if (process.env.BODU_DEV_URL) win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) { event.preventDefault(); win.webContents.toggleDevTools(); }
    });
    const register = (name, handler) => ipcMain.handle(name, (event, ...args) => {
      if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('无效的请求来源');
      return handler(...args);
    });
    register('boot', async () => {
      await openArguments(process.argv);
      ready = true;
      return { state, pending: pendingDocs.splice(0), drafts, version: app.getVersion() };
    });
    register('pick-files', async () => {
      const result = await dialog.showOpenDialog(win, { title: '打开 Markdown 文档', filters: [{ name: 'Markdown 文档', extensions: ['md', 'markdown'] }], properties: ['openFile', 'multiSelections'] });
      if (result.canceled) return [];
      return Promise.all(result.filePaths.map(grantFile));
    });
    register('pick-folder', async () => {
      const result = await dialog.showOpenDialog(win, { title: '打开文档文件夹', properties: ['openDirectory'] });
      if (result.canceled) return null;
      const root = await fs.realpath(result.filePaths[0]);
      grantedRoots.add(key(root));
      return { path: root, entries: await listDirectory(root) };
    });
    register('read-file', async p => readDocument(await checkedPath(p)));
    register('list-directory', async p => listDirectory(await checkedPath(p)));
    register('search-folder', async (p, query) => {
      searchController?.abort();
      const controller = new AbortController();
      searchController = controller;
      const root = await checkedPath(p);
      if (typeof query !== 'string' || query.length > 500) throw new Error('搜索词过长');
      return searchDirectory(root, query, controller.signal);
    });
    register('cancel-search', () => searchController?.abort());
    register('save-state', persist);
    register('write-draft', async draft => {
      if (!draft || typeof draft.path !== 'string' || (!draft.path.startsWith('bodu:new:') && !canRead(draft.path))) throw new Error('无法保存此文档的恢复草稿');
      dirtyPaths.add(draft.path);
      await storage.writeDraft(draft);
    });
    register('remove-draft', async p => { if (typeof p !== 'string') throw new Error('无效的草稿路径'); await storage.removeDraft(p); dirtyPaths.delete(p); });
    register('save-file', async options => {
      if (!options || typeof options.path !== 'string' || typeof options.content !== 'string') throw new Error('无效的保存请求');
      let target = options.path, revision = options.revision;
      if (options.saveAs || target.startsWith('bodu:')) {
        const result = await dialog.showSaveDialog(win, { title: '保存 Markdown 文档（UTF-8）', defaultPath: target.startsWith('bodu:') ? '未命名.md' : target, filters: [{ name: 'Markdown 文档', extensions: ['md', 'markdown'] }] });
        if (result.canceled || !result.filePath) return { status: 'cancelled' };
        target = result.filePath;
        if (!isMarkdown(target)) target += '.md';
        const parent = await fs.realpath(path.dirname(target));
        target = path.join(parent, path.basename(target));
        if (key(target) !== key(options.path) && [...dirtyPaths].some(p => !p.startsWith('bodu:') && key(p) === key(target))) throw new Error('目标文档已有未保存编辑，请先保存或选择其他文件名');
        grantedFiles.add(key(target)); grantedRoots.add(key(parent));
        try { revision = (await readDocument(target)).revision; } catch (e) { if (e.code !== 'ENOENT') throw e; revision = null; }
      } else {
        if (!canRead(target)) throw new Error('请先选择要编辑的文件');
        try { target = await checkedPath(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      const format = options.saveAs || options.path.startsWith('bodu:') ? { encoding: 'utf8', eol: options.eol || '\n', bom: false } : { encoding: options.encoding, eol: options.eol, bom: options.bom };
      const result = await storage.save({ path: target, content: options.content, revision, format, force: Boolean(options.force) });
      if (result.status === 'saved') { grantedFiles.add(key(result.doc.path)); grantedRoots.add(key(path.dirname(result.doc.path))); }
      return result;
    });
    register('list-history', async p => { if (!canRead(p)) throw new Error('未打开此文档'); return storage.listHistory(p); });
    register('get-history', async (p, id) => { if (!canRead(p)) throw new Error('未打开此文档'); return storage.getHistory(p, id); });
    async function imageDestination(from, bytes, original = 'image.png') {
      const doc = await checkedPath(from);
      const directory = path.join(path.dirname(doc), `${path.basename(doc, path.extname(doc))}.assets`);
      await fs.mkdir(directory, { recursive: true });
      const realDirectory = await fs.realpath(directory);
      if (!isInside(path.dirname(doc), realDirectory)) throw new Error('图片目录不可指向文档文件夹之外');
      const filename = `${Date.now()}-${randomUUID().slice(0, 8)}${path.extname(original).toLowerCase()}`;
      await fs.writeFile(path.join(realDirectory, filename), bytes, { flag: 'wx' });
      return { relative: `${encodeURIComponent(path.basename(directory))}/${encodeURIComponent(filename)}`, name: path.basename(original, path.extname(original)) };
    }
    register('pick-image', async from => {
      await checkedPath(from);
      const result = await dialog.showOpenDialog(win, { title: '插入本地图片', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }] });
      if (result.canceled) return null;
      const source = result.filePaths[0];
      if (!/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(source) || (await fs.stat(source)).size > 20 * 1024 * 1024) throw new Error('请选择 20 MB 以内的图片');
      return imageDestination(from, await fs.readFile(source), path.basename(source));
    });
    register('paste-image', async (from, bytes) => {
      await checkedPath(from);
      if (!(bytes instanceof Uint8Array) || bytes.length > 20 * 1024 * 1024) throw new Error('粘贴图片无效或超过 20 MB');
      const image = nativeImage.createFromBuffer(Buffer.from(bytes));
      if (image.isEmpty()) throw new Error('无法识别粘贴的图片');
      const size = image.getSize();
      if (size.width * size.height > 40000000) throw new Error('图片分辨率过大');
      const png = image.toPNG();
      if (png.length > 20 * 1024 * 1024) throw new Error('图片超过 20 MB');
      return imageDestination(from, png);
    });
    register('preview-replace', async (p, query, replacement, caseSensitive) => {
      const root = await checkedPath(p);
      if (typeof query !== 'string' || typeof replacement !== 'string') throw new Error('无效的替换内容');
      const plan = await previewReplacement(root, query, replacement, Boolean(caseSensitive));
      replacementPlans.clear();
      const id = randomUUID(); replacementPlans.set(id, { ...plan, root, query, replacement, caseSensitive: Boolean(caseSensitive), time: Date.now() });
      return { ...plan, id };
    });
    register('apply-replace', async (id, paths) => {
      const plan = replacementPlans.get(id);
      if (!plan || Date.now() - plan.time > 10 * 60 * 1000 || plan.truncated) throw new Error('替换预览已失效或结果过多，请重新预览');
      if (!Array.isArray(paths) || paths.length > 200) throw new Error('无效的替换范围');
      replacementPlans.delete(id);
      const results = [];
      for (const item of plan.changes.filter(c => paths.includes(c.path))) {
        try {
          if ([...dirtyPaths].some(p => key(p) === key(item.path))) { results.push({ path: item.path, status: 'skipped', message: '该文档有未保存内容，请先保存' }); continue; }
          const current = await readDocument(await checkedPath(item.path));
          if (current.revision !== item.revision) { results.push({ path: item.path, status: 'conflict', message: '文件在预览后被修改' }); continue; }
          const changed = replaceText(current.content, plan.query, plan.replacement, plan.caseSensitive);
          const saved = await storage.save({ path: current.path, content: changed.content, revision: current.revision, format: current, label: '批量替换前' });
          results.push({ path: item.path, status: saved.status, message: saved.status === 'saved' ? `${changed.count} 处已替换` : '文件被外部修改' });
        } catch (e) { results.push({ path: item.path, status: 'error', message: e.message }); }
      }
      return results;
    });
    register('open-dropped', async paths => {
      if (!Array.isArray(paths) || paths.length > 50) throw new Error('一次最多打开 50 个文件');
      const docs = [];
      for (const p of paths) if (typeof p === 'string' && isMarkdown(p)) docs.push(await grantFile(p));
      return docs;
    });
    register('open-link', async (from, href) => {
      if (typeof href !== 'string') throw new Error('无效链接');
      if (/^https?:\/\//i.test(href)) { await shell.openExternal(href); return null; }
      if (/^(?!file:)[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) throw new Error('不支持这种链接');
      if (from === 'bodu:welcome') throw new Error('请先打开本地文档');
      const base = await checkedPath(from);
      const hashIndex = href.indexOf('#');
      const hash = hashIndex >= 0 ? href.slice(hashIndex + 1) : '';
      const source = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
      const target = source.startsWith('file:') ? fileURLToPath(source) : path.resolve(path.dirname(base), decodeURIComponent(source));
      if (!isMarkdown(target)) throw new Error('当前仅支持打开 Markdown 文档链接');
      // A deliberate local Markdown link click grants the destination just like selecting a file.
      return { doc: await grantFile(target), hash };
    });
    register('window-action', action => { if (action === 'minimize') win.minimize(); else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (action === 'close') win.close(); });
    if (process.env.BODU_DEV_URL) await win.loadURL(process.env.BODU_DEV_URL);
    else await win.loadFile(path.join(__dirname, '../dist/index.html'));
  });
  app.on('window-all-closed', () => app.quit());
  let quitting = false;
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    if (win && !win.isDestroyed() && !closing) { win.close(); return; }
    quitting = true;
    Promise.allSettled([saveChain, storage?.flush()]).finally(() => app.quit());
  });
}
