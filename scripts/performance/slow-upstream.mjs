import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {connectPage} from './browser-cdp.mjs';

const fixture=JSON.parse(await readFile(process.env.SHOTLOOM_QA_FIXTURE,'utf8'));
assert.equal(new URL(fixture.origin).port,'14433');
const page=await connectPage(process.env.SHOTLOOM_QA_CDP);
const pending=new Set(), records=[];
page.on('Network.requestWillBeSent',event=>{if(new URL(event.request.url).pathname==='/api/models')pending.add(event.requestId);});
page.on('Network.loadingFinished',event=>pending.delete(event.requestId));
page.on('Network.loadingFailed',event=>pending.delete(event.requestId));
try{
 for(const scenario of [
  {name:'projects',query:'route=projects',ready:`document.querySelectorAll('article[aria-label^="Open project"]').length>0`},
  {name:'settings',query:'route=account&panel=settings',ready:`!!document.querySelector('.settings-nav') && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Done')`},
  {name:'canvas',query:`route=creation&project=${fixture.projectId}`,ready:`!!document.querySelector('.react-flow__viewport')`},
 ]){
  await page.send('Page.navigate',{url:'about:blank'});await page.wait(`location.href==='about:blank'`);pending.clear();
  const start=performance.now();
  await page.send('Page.navigate',{url:`${fixture.origin}/?${scenario.query}`});
  await page.wait(scenario.ready,12000);
  const readyMs=performance.now()-start;
  await page.wait(`document.readyState==='complete'`);
  for(let i=0;i<100&&!pending.size;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(pending.size>0,`${scenario.name} must be usable while the delayed model request is pending`);
  records.push({scenario:scenario.name,readyMs,modelsStillPending:true});
 }
 await writeFile(process.env.SHOTLOOM_QA_EVIDENCE,JSON.stringify({configuredUpstreamDelayMs:20000,records},null,2));
 console.log('Projects, settings and canvas independently ready with models still pending');
}finally{page.close();}
