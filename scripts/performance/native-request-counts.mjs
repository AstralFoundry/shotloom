import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

function parse(line) {
  const match=line.match(/^\S+ \[[^\]]+\] (\S+) (\S+) (\d+) (\d+) ([\d.]+) ([\d.]+) (\d+) "(.*)"$/);
  if(!match || !/Android|okhttp/i.test(match[8]))return;
  return {method:match[1],path:match[2],status:Number(match[3]),bytes:Number(match[4]),startMs:(Number(match[6])-Number(match[5]))*1000,port:Number(match[7])};
}
function collect(requests,run) {
  const port=run.version==='candidate'?14433:14434;
  const rows=requests.filter(r=>r.port===port&&r.startMs>=run.uiStartedAtUnixMs&&r.startMs<run.uiEndedAtUnixMs);
  return {requests:rows.length,bodyBytes:rows.reduce((n,r)=>n+r.bytes,0),apiRequests:rows.filter(r=>r.path.startsWith('/api/')).length,errors:rows.filter(r=>r.status>=400).map(({method,path,status})=>({method,path,status}))};
}
if(process.argv.includes('--self-test')){
  const rows=[parse('127.0.0.1 [20/Nov/2026:12:00:00 +0000] GET /api/projects/page 200 100 0.100 10.200 14433 "okhttp/4.12"'),parse('127.0.0.1 [20/Nov/2026:12:00:00 +0000] GET / 200 900 0.100 10.200 14433 "Chrome Windows"')].filter(Boolean);
  assert.deepEqual(collect(rows,{version:'candidate',uiStartedAtUnixMs:10000,uiEndedAtUnixMs:11000}),{requests:1,bodyBytes:100,apiRequests:1,errors:[]});
  assert.equal(collect(rows,{version:'baseline',uiStartedAtUnixMs:10000,uiEndedAtUnixMs:11000}).requests,0);
  console.log('Native request window and user-agent isolation self-check passed');process.exit(0);
}
const root=process.argv[2]||'output/performance-20261120';
const requests=(await readFile(join(root,'qa-access-final.log'),'utf8')).split('\n').map(parse).filter(Boolean);
const dir=join(root,'android-final-performance');
const files=(await readdir(dir,{recursive:true})).filter(p=>/results-.*\.json$/.test(p));
assert.equal(files.length,40);
const result=[];
for(const file of files){
  const run=JSON.parse(await readFile(join(dir,file),'utf8'));
  assert.ok(run.uiEndedAtUnixMs>run.uiStartedAtUnixMs);
  const traffic=collect(requests,run);
  assert.ok(traffic.requests>0,'No matching traffic for '+file);
  result.push({pair:run.pair,version:run.version,state:run.state,...traffic});
}
await writeFile(join(root,'native-ui-requests.json'),JSON.stringify(result,null,2));
console.log('Accounted for',result.length,'isolated native UI windows; API probes are outside these windows');
