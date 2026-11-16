import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const failures=[];
function walk(root) {
  return readdirSync(root,{withFileTypes:true})
    .filter(entry => !(root === 'electron' && entry.name === 'resources'))
    .flatMap(entry=>entry.isDirectory()?walk(join(root,entry.name)):[join(root,entry.name)]);
}
// Harness 主机保持自己的 db/ + crud/ 分层，两套边界各自成立。
const harnessSql = /harness\/host\/src\/db\/|harness\/host\/src\/crud\//;
// Electron 主进程的存储边界：SQL 只允许出现在 db.ts 与领域存储模块里。
const sqlAllowed = new Set(['electron/core/db.ts','electron/core/storage.ts','electron/core/projectStorage.ts']);
for(const file of [...walk('electron'),...walk('harness/host/src')]) {
  if(!/\.(ts|mjs)$/.test(file)) continue;
  const source=readFileSync(file,'utf8');
  if(/project\.shotloom\.json|shotloom-bindings\.json|shotloom-tool-catalogs\.json|dsh-session-persistence-jsonl|dsh-storage-json/.test(source)) failures.push(`${file}: old runtime storage`);
  if(!sqlAllowed.has(file) && !harnessSql.test(file) && /\.prepare\(\s*[`'"]|\.exec\(\s*[`'"]/.test(source)) failures.push(`${file}: SQL outside the storage layer`);
  if(!file.includes('/db/') && !file.includes('/crud/') && !sqlAllowed.has(file) && /::Entity::|\.orm\.(select|insert|update|delete)\(/.test(source)) failures.push(`${file}: ORM access outside the storage layer`);
}
for(const file of ['renderer/src/services/tauriApi.ts','renderer/src/services/clipSnapshotStore.ts','renderer/src/app/editor/openReel/ClipStudioRuntimeHost.tsx']) {
  const source=readFileSync(file,'utf8');
  if(/localStorage|project\.shotloom\.json|\.shotloom\/editors/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,''))) failures.push(`${file}: desktop business storage bypasses SQLite`);
}
if(failures.length) {console.error(failures.join('\n'));process.exit(1);}
console.log('Storage discipline passed: SQLite / storage-layer boundaries and legacy entry points.');
