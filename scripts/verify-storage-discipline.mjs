import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const failures=[];
function walk(root) {
  return readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(root,entry.name)):[join(root,entry.name)]);
}
for(const file of [...walk('src-tauri/src'),...walk('harness/host/src')]) {
  if(!/\.(rs|ts)$/.test(file)) continue;
  const source=readFileSync(file,'utf8');
  if(/project\.shotloom\.json|shotloom-bindings\.json|shotloom-tool-catalogs\.json|dsh-session-persistence-jsonl|dsh-storage-json/.test(source)) failures.push(`${file}: old runtime storage`);
  if(!file.includes('/database/')&&!file.includes('/db/') && /execute_unprepared\(|Statement::from_sql|\.exec\(\s*`|sql`/.test(source)) failures.push(`${file}: SQL outside database layer`);
  if(!file.includes('/crud/')&&!file.includes('/models/')&&!file.includes('/database/')&&!file.includes('/db/')&& /::Entity::|\.orm\.(select|insert|update|delete)\(/.test(source)) failures.push(`${file}: ORM access outside CRUD`);
}
for(const file of ['renderer/src/services/tauriApi.ts','renderer/src/services/clipSnapshotStore.ts','renderer/src/app/editor/openReel/ClipStudioRuntimeHost.tsx']) {
  const source=readFileSync(file,'utf8');
  if(/localStorage|project\.shotloom\.json|\.shotloom\/editors/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,''))) failures.push(`${file}: desktop business storage bypasses SQLite`);
}
if(failures.length) {console.error(failures.join('\n'));process.exit(1);}
console.log('Storage discipline passed: SQLite ORM / CRUD boundaries and legacy entry points.');
