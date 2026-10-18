const { spawn } = require('node:child_process');
const path = require('node:path');
const vite = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], { stdio: 'inherit' });
let desktop;
async function start() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:5173')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  const env = { ...process.env, BODU_DEV_URL: 'http://127.0.0.1:5173', BODU_USER_DATA: process.env.BODU_USER_DATA || path.resolve('.local-fixtures/development-state') };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = spawn(require('electron'), ['.'], { stdio: 'inherit', env });
  desktop.on('exit', () => { vite.kill(); process.exit(); });
}
void start();
process.on('SIGINT', () => { desktop?.kill(); vite.kill(); process.exit(); });
