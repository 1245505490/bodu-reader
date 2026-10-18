const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('bodu', {
  boot: () => ipcRenderer.invoke('boot'),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  readFile: p => ipcRenderer.invoke('read-file', p),
  listDirectory: p => ipcRenderer.invoke('list-directory', p),
  searchFolder: (p, q) => ipcRenderer.invoke('search-folder', p, q),
  cancelSearch: () => ipcRenderer.invoke('cancel-search'),
  saveState: state => ipcRenderer.invoke('save-state', state),
  writeDraft: draft => ipcRenderer.invoke('write-draft', draft),
  removeDraft: path => ipcRenderer.invoke('remove-draft', path),
  saveFile: options => ipcRenderer.invoke('save-file', options),
  listHistory: path => ipcRenderer.invoke('list-history', path),
  getHistory: (path, id) => ipcRenderer.invoke('get-history', path, id),
  pickImage: path => ipcRenderer.invoke('pick-image', path),
  pasteImage: (path, bytes) => ipcRenderer.invoke('paste-image', path, bytes),
  previewReplace: (path, query, replacement, sensitive) => ipcRenderer.invoke('preview-replace', path, query, replacement, sensitive),
  applyReplace: (id, paths) => ipcRenderer.invoke('apply-replace', id, paths),
  openLink: (from, href) => ipcRenderer.invoke('open-link', from, href),
  imageUrl: (from, href) => `bodu-image://local/image?from=${encodeURIComponent(from)}&src=${encodeURIComponent(href)}`,
  droppedPaths: files => Array.from(files).map(file => webUtils.getPathForFile(file)),
  openDropped: paths => ipcRenderer.invoke('open-dropped', paths),
  windowAction: action => ipcRenderer.invoke('window-action', action),
  onOpenFiles: callback => {
    const listener = (_, docs) => callback(docs);
    ipcRenderer.on('open-files', listener);
    return () => ipcRenderer.removeListener('open-files', listener);
  },
  onFlushState: callback => {
    const listener = () => { callback(); ipcRenderer.send('state-flushed'); };
    ipcRenderer.on('flush-state', listener);
    return () => ipcRenderer.removeListener('flush-state', listener);
  },
  onCloseRequest: callback => {
    const listener = async () => {
      try { ipcRenderer.send('close-ready', await callback()); }
      catch { ipcRenderer.send('close-ready', false); }
    };
    ipcRenderer.on('request-close', listener);
    return () => ipcRenderer.removeListener('request-close', listener);
  },
});
