import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {connectPage} from './browser-cdp.mjs';
import {extendedScenarios} from './browser-extended-scenarios.mjs';

const fixture=JSON.parse(await readFile(process.env.SHOTLOOM_QA_FIXTURE,'utf8'));
assert.equal(new URL(fixture.origin).port,'14433');
const directory=process.env.SHOTLOOM_QA_EVIDENCE || 'output/performance-20261120/browser';
await mkdir(directory,{recursive:true});
const page=await connectPage(process.env.SHOTLOOM_QA_CDP || 'http://127.0.0.1:54114');
const coreScenarios=[
 {name:'projects',query:'route=projects',ready:`document.querySelectorAll('.project-entry').length > 0 || document.querySelectorAll('article[aria-label^="Open project"]').length > 0`,label:'Project library'},
 {name:'skills',query:'route=skills',ready:`document.body.innerText.includes('Native Acceptance Skill') && !document.querySelector('.skills-browser[aria-busy="true"]')`,label:'Skills'},
 {name:'account',query:'route=account',ready:`!!document.querySelector('.account-wallet[aria-busy="false"] strong') && document.querySelector('.account-wallet strong').textContent!=='—'`,label:'My account'},
 {name:'settings',query:'route=account&panel=settings',ready:`document.querySelector('.settings-nav') && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Done')`},
 {name:'canvas-empty',query:`route=creation&project=${fixture.projectId}`,ready:`!!document.querySelector('.react-flow__viewport')`},
 {name:'canvas-media',query:`route=creation&project=${fixture.mediaProjectId}`,ready:`[...document.querySelectorAll('.react-flow__node img')].some(i=>{const r=i.getBoundingClientRect();return i.complete&&i.naturalWidth>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight})`},
];
const allScenarios=process.env.SHOTLOOM_QA_SUITE==='extended'?extendedScenarios(fixture):coreScenarios;
const scenarios=allScenarios.filter(value=>!process.env.SHOTLOOM_QA_SCENARIOS || process.env.SHOTLOOM_QA_SCENARIOS.split(',').includes(value.name));
const separator=fixture.cookie.indexOf('=');
await page.send('Network.setCookie',{name:fixture.cookie.slice(0,separator),value:fixture.cookie.slice(separator+1),url:fixture.origin,path:'/',secure:true,httpOnly:true,sameSite:'Lax'});
let rows=process.env.SHOTLOOM_QA_RESUME==='1' ? JSON.parse(await readFile(`${directory}/samples.json`,'utf8')) : [],requests=[],responses=new Map(),eligible=new Map(),active=false;
page.on('Network.requestWillBeSent',value=>{if(active)eligible.set(value.requestId,value.timestamp);});
page.on('Network.responseReceived',value=>{if(active&&eligible.has(value.requestId))responses.set(value.requestId,{path:new URL(value.response.url).pathname,scheme:new URL(value.response.url).protocol,status:value.response.status,serverTiming:Object.entries(value.response.headers).find(([key])=>key.toLowerCase()==='server-timing')?.[1],requestId:Object.entries(value.response.headers).find(([key])=>key.toLowerCase()==='x-request-id')?.[1],ttfbMs:value.response.timing?.receiveHeadersStart,cached:value.response.fromDiskCache||value.response.fromServiceWorker||false});});
page.on('Network.loadingFinished',value=>{if(active&&responses.has(value.requestId))requests.push({...responses.get(value.requestId),durationMs:(value.timestamp-eligible.get(value.requestId))*1000,bytes:value.encodedDataLength});});
async function sample(scenario,version,width,pair,state) {
 const origin=fixture.origin.replace(':14433',version==='baseline'?':14434':':14433');
 if(state!=='return'){
   await page.send('Page.stopLoading');
   await page.send('Page.navigate',{url:'about:blank'});
   await page.wait(`location.href==='about:blank' && document.readyState==='complete'`);
 }
 if(state==='cold') {await page.send('Network.clearBrowserCache');await page.send('Storage.clearDataForOrigin',{origin,storageTypes:'local_storage,indexeddb,cache_storage,service_workers'});}
 requests=[];responses.clear();eligible.clear();active=true;const start=performance.now();
 if(state==='return') {
   await page.evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim()===${JSON.stringify(scenario.label)}).click()`);
 } else {
   const previous=await page.evaluate('performance.timeOrigin');
   const url=scenario.path?`${origin}${scenario.path}`:`${origin}/?${scenario.query}`;
   await page.send('Page.navigate',{url});
   await page.wait(`performance.timeOrigin !== ${previous} && location.href === ${JSON.stringify(url)} && document.readyState !== 'loading'`);
 }
 let readinessFailure;
 try {
   for (const step of scenario.steps || []) { await page.wait(step.ready,90000); await page.evaluate(step.action); }
   if(scenario.prepare){await page.wait(scenario.prepare,90000);await page.evaluate(scenario.action);}
   if(scenario.followup){await page.wait(scenario.followup.ready);await page.evaluate(scenario.followup.action);}
   await page.wait(scenario.ready,90000);
 }
 catch(error) {
   const failure={pair,width,scenario:scenario.name,version,state,message:error.message,dom:await page.evaluate(`({url:location.href,locale:localStorage.getItem('shotloom:locale'),text:document.body.innerText.slice(-1800)})`),requests};
   await writeFile(`${directory}/failure.json`,JSON.stringify(failure,null,2));
   await writeFile(`${directory}/failure-${pair}-${width}-${scenario.name}-${version}-${state}.json`,JSON.stringify(failure,null,2));
   if(version!=='baseline'||!scenario.baselineTimeout||!error.message.startsWith('Page readiness timeout:'))throw error;
   readinessFailure=error.message;
 }
 await page.evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
 const durationMs=performance.now()-start;
 const metrics=await page.evaluate(`({firstFrame:performance.getEntriesByName('shotloom-media-first-frame').map(e=>e.startTime),resources:performance.getEntriesByType('resource').length,overflow:document.documentElement.scrollWidth>innerWidth+1})`);
 active=false;
 const row={pair,version,width,state,scenario:scenario.name,durationMs,...(readinessFailure?{readinessFailure}:{}),requests:requests.length,bytes:requests.reduce((sum,r)=>sum+r.bytes,0),resources:requests,apiRequests:requests.filter(r=>r.path.startsWith('/api/')),metrics};
 rows.push(row);await writeFile(`${directory}/samples.json`,JSON.stringify(rows,null,2));
 console.log(pair,version,width,state,scenario.name,Math.round(durationMs),row.requests,row.bytes,readinessFailure?'BASELINE_TIMEOUT':'');
}
try {
 for(let pair=1;pair<=Number(process.env.SHOTLOOM_QA_PAIRS||10);pair++)for(const width of [390,1280])for(const scenario of scenarios){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
   for(const version of pair%2?['baseline','candidate']:['candidate','baseline']) {
     const matches=row=>row.pair===pair&&row.width===width&&row.scenario===scenario.name&&row.version===version;
     const existing=rows.filter(matches);
     if(existing.length===(scenario.label?3:2))continue;
     if(existing.length){
       await writeFile(`${directory}/interrupted-${pair}-${width}-${scenario.name}-${version}.json`,JSON.stringify(existing,null,2));
       rows=rows.filter(row=>!matches(row));
     }
     for(const state of ['cold','warm'])await sample(scenario,version,width,pair,state);
     if(scenario.label){
       const away=scenario.name==='skills'?'Project library':'Skills';
       await page.evaluate(`[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim()===${JSON.stringify(away)}).click()`);
       await page.wait(away==='Skills'?allScenarios.find(s=>s.name==='skills').ready:allScenarios.find(s=>s.name==='projects').ready);
       await sample(scenario,version,width,pair,'return');
     }
   }
 }
 assert.equal(rows.length,Number(process.env.SHOTLOOM_QA_PAIRS||10)*2*2*(scenarios.length*2+scenarios.filter(s=>s.label).length));
} finally {page.close();}
