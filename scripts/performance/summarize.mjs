import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const median=values=>{const a=[...values].sort((x,y)=>x-y);return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;};
assert.equal(median([4,1,3,2]),2.5);assert.equal(median([3,1,2]),2);
const stats=values=>({median:median(values),max:Math.max(...values)});
function groups(rows,key,measure){
 const buckets=new Map();
 for(const row of rows){const id=key(row), bucket=buckets.get(id)||[];bucket.push(row);buckets.set(id,bucket);}
 return [...buckets].map(([key,rows])=>({key,n:rows.length,...measure(rows)})).sort((a,b)=>a.key.localeCompare(b.key));
}
if(process.argv.includes('--self-test')){console.log('Median and grouping self-check passed');process.exit(0);}
const root=process.argv[2]||'output/performance-20261120';
const browser=JSON.parse(await readFile(join(root,'browser-accepted/samples.json'),'utf8'));
assert.equal(browser.length,600,'Ten complete alternating Web pairs are required');
const web=groups(browser,r=>[r.scenario,r.width,r.state,r.version].join('/'),rows=>{
 assert.equal(rows.length,10);assert.equal(new Set(rows.map(r=>r.pair)).size,10);
 return {ms:stats(rows.map(r=>r.durationMs)),httpRequests:stats(rows.map(r=>r.resources.filter(v=>['http:','https:'].includes(v.scheme)).length)),bytesToReady:stats(rows.map(r=>r.resources.filter(v=>['http:','https:'].includes(v.scheme)).reduce((n,v)=>n+v.bytes,0))),apiRequests:stats(rows.map(r=>r.apiRequests.length))};
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
const summary={webSamples:browser.length,androidRuns:runs.length,androidPageSamples:pages.length,androidApiSamples:apis.length,web,native,api};
await writeFile(join(root,'summary.json'),JSON.stringify(summary,null,2));
const fmt=n=>Math.round(n);
const table=(headers,rows)=>[headers.join(' | '),headers.map(()=>'---').join(' | '),...rows.map(r=>r.join(' | '))].map(s=>'| '+s+' |').join('\n');
const webTable=table(['Web 场景/宽度/状态/版本','N','中位 ms','最大 ms','请求数中位','就绪前 KiB 中位'],web.map(r=>[r.key,r.n,fmt(r.ms.median),fmt(r.ms.max),fmt(r.httpRequests.median),fmt(r.bytesToReady.median/1024)]));
const nativeTable=table(['Android 页面/状态/版本','样本数','配对数','中位 ms','最大 ms'],native.map(r=>[r.key,r.n,r.pairs,fmt(r.ms.median),fmt(r.ms.max)]));
await writeFile(join(root,'summary.md'),webTable+'\n\n'+nativeTable+'\n');
console.log('Verified and summarized',browser.length,'Web samples and',runs.length,'Android runs');
