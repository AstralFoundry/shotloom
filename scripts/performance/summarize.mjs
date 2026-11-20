import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const median=values=>{const a=[...values].sort((x,y)=>x-y);return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;};
assert.equal(median([4,1,3,2]),2.5);assert.equal(median([3,1,2]),2);
const stats=values=>({median:median(values),max:Math.max(...values)});
const readinessStats=rows=>{
 const completed=rows.filter(row=>!row.readinessFailure);
 return {ready:completed.length,timeouts:rows.length-completed.length,ms:completed.length?stats(completed.map(row=>row.durationMs)):null,timeoutWaitMs:rows.some(row=>row.readinessFailure)?stats(rows.filter(row=>row.readinessFailure).map(row=>row.durationMs)):null};
};
function parseTiming(header='') {
 const timings={};
 for(const metric of header.split(',')){
  const match=metric.trim().match(/^([\w-]+);dur=([\d.]+)/);
  if(match)timings[match[1]]=Number(match[2]);
 }
 const cache=header.match(/hit=(\d+) miss=(\d+)/);
 return {timings,hits:Number(cache?.[1]||0),misses:Number(cache?.[2]||0)};
}
function groups(rows,key,measure){
 const buckets=new Map();
 for(const row of rows){const id=key(row), bucket=buckets.get(id)||[];bucket.push(row);buckets.set(id,bucket);}
 return [...buckets].map(([key,rows])=>({key,n:rows.length,...measure(rows)})).sort((a,b)=>a.key.localeCompare(b.key));
}
if(process.argv.includes('--self-test')){
 assert.deepEqual(readinessStats([{durationMs:90000,readinessFailure:'timeout'}]),{ready:0,timeouts:1,ms:null,timeoutWaitMs:{median:90000,max:90000}});
 assert.equal(readinessStats([{durationMs:10},{durationMs:90000,readinessFailure:'timeout'}]).ms.median,10);
 assert.deepEqual(parseTiming('auth;dur=12.5, cache;desc="hit=2 miss=1", total;dur=20'),{timings:{auth:12.5,total:20},hits:2,misses:1});
 console.log('Median, grouping and censored readiness self-check passed');process.exit(0);
}
const root=process.argv[2]||'output/performance-20261120';
const core=JSON.parse(await readFile(join(root,'browser-accepted/samples.json'),'utf8'));
const extended=JSON.parse(await readFile(join(root,'browser-extended/samples.json'),'utf8'));
assert.equal(core.length,600,'Ten complete alternating core Web pairs are required');
assert.equal(extended.length,960,'Ten complete alternating extended Web pairs are required');
const browser=[...core,...extended];
const web=groups(browser,r=>[r.scenario,r.width,r.state,r.version].join('/'),rows=>{
 assert.equal(rows.length,10);assert.equal(new Set(rows.map(r=>r.pair)).size,10);
 assert.ok(rows.every(r=>!r.readinessFailure||r.version==='baseline'),'Candidate readiness failures cannot pass acceptance');
 assert.ok(rows.every(r=>Array.isArray(r.initiatedRequests)),'Started requests, including pending work, must be recorded');
 return {...readinessStats(rows),httpRequests:stats(rows.map(r=>r.initiatedRequests.filter(v=>['http:','https:'].includes(v.scheme)).length)),pendingHttpRequests:stats(rows.map(r=>r.initiatedRequests.filter(v=>['http:','https:'].includes(v.scheme)&&!v.completed).length)),bytesToReady:stats(rows.map(r=>r.resources.filter(v=>['http:','https:'].includes(v.scheme)).reduce((n,v)=>n+v.bytes,0))),apiRequests:stats(rows.map(r=>r.initiatedRequests.filter(v=>v.path.startsWith('/api/')).length))};
});
const http=browser.flatMap(row=>row.apiRequests.map(request=>({...request,version:row.version,parsed:parseTiming(request.serverTiming)})));
const phases=groups(http,row=>`${row.version}/${row.path.replace(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/gi,':id')}`,rows=>{
 const stages=[...new Set(rows.flatMap(row=>Object.keys(row.parsed.timings)))];
 return {clientMs:stats(rows.map(row=>row.durationMs)),ttfbMs:stats(rows.filter(row=>Number.isFinite(row.ttfbMs)).map(row=>row.ttfbMs)),stages:Object.fromEntries(stages.map(stage=>[stage,stats(rows.filter(row=>stage in row.parsed.timings).map(row=>row.parsed.timings[stage]))])),cacheHits:rows.reduce((n,row)=>n+row.parsed.hits,0),cacheMisses:rows.reduce((n,row)=>n+row.parsed.misses,0),errors:rows.filter(row=>row.status>=400).length};
});
const files=(await readdir(join(root,'android-final-performance'),{recursive:true})).filter(p=>/results-.*\.json$/.test(p));
const runs=await Promise.all(files.map(async p=>JSON.parse(await readFile(join(root,'android-final-performance',p),'utf8'))));
assert.equal(runs.length,40,'Ten pairs with cold/warm baseline/candidate runs are required');
assert.ok(runs.every(r=>r.failure===null));
const pages=runs.flatMap(r=>r.pages.map(p=>({...p,pair:r.pair,version:r.version,state:r.state})));
const native=groups(pages,r=>[r.page,r.state,r.version].join('/'),rows=>({ms:stats(rows.map(r=>r.ms)),pairs:new Set(rows.map(r=>r.pair)).size}));
assert.ok(native.every(r=>r.pairs===10));
const apis=runs.flatMap(r=>r.apis.map(p=>({...p,pair:r.pair,version:r.version,state:r.state})));
assert.ok(apis.every(r=>r.status===200));
const api=groups(apis,r=>[r.path,r.state,r.version].join('/'),rows=>({ms:stats(rows.map(r=>r.totalMs)),ttfb:stats(rows.map(r=>r.ttfbMs)),decodedBytes:stats(rows.map(r=>r.bytes))}));
const summary={webSamples:browser.length,coreWebSamples:core.length,extendedWebSamples:extended.length,androidRuns:runs.length,androidPageSamples:pages.length,androidApiSamples:apis.length,web,phases,native,api};
await writeFile(join(root,'summary.json'),JSON.stringify(summary,null,2));
const fmt=n=>Math.round(n);
const table=(headers,rows)=>[headers.join(' | '),headers.map(()=>'---').join(' | '),...rows.map(r=>r.join(' | '))].map(s=>'| '+s+' |').join('\n');
const webTable=table(['Web 场景/宽度/状态/版本','尝试/超时','成功中位 ms','成功最大 ms','请求数中位','就绪或截止前 KiB 中位'],web.map(r=>[r.key,`${r.n}/${r.timeouts}`,r.ms?fmt(r.ms.median):'未就绪',r.ms?fmt(r.ms.max):'未就绪',fmt(r.httpRequests.median),fmt(r.bytesToReady.median/1024)]));
const nativeTable=table(['Android 页面/状态/版本','样本数','配对数','中位 ms','最大 ms'],native.map(r=>[r.key,r.n,r.pairs,fmt(r.ms.median),fmt(r.ms.max)]));
await writeFile(join(root,'summary.md'),webTable+'\n\n'+nativeTable+'\n');
console.log('Verified and summarized',browser.length,'Web samples and',runs.length,'Android runs');
