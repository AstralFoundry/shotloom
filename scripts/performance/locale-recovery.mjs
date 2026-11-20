import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {connectPage} from './browser-cdp.mjs';
const fixture=JSON.parse(await readFile(process.env.SHOTLOOM_QA_FIXTURE,'utf8'));
assert.equal(new URL(fixture.origin).port,'14433');
const page=await connectPage(process.env.SHOTLOOM_QA_CDP);
let intercepted=0;
page.on('Fetch.requestPaused',event=>{
 intercepted++;
 void page.send(intercepted===1?'Fetch.failRequest':'Fetch.continueRequest',{requestId:event.requestId,...(intercepted===1?{errorReason:'TimedOut'}:{})});
});
try{
 await page.send('Page.navigate',{url:'about:blank'});await page.wait(`location.href==='about:blank'`);
 await page.send('Storage.clearDataForOrigin',{origin:fixture.origin,storageTypes:'local_storage,indexeddb,cache_storage,service_workers'});
 await page.send('Fetch.enable',{patterns:[{urlPattern:`${fixture.origin}/api/settings`,requestStage:'Request'}]});
 await page.send('Page.navigate',{url:`${fixture.origin}/?route=projects`});
 await page.wait(`document.documentElement.lang==='en-US' && document.querySelectorAll('article[aria-label^="Open project"]').length===20`,60000);
 assert.ok(intercepted>=2,'Mounted preferences must use a fresh request after the failed prefetch');
 assert.equal(await page.evaluate(`document.body.innerText.includes('Application initialization failed')`),false);
 await writeFile(process.env.SHOTLOOM_QA_EVIDENCE,JSON.stringify({failedPrefetches:1,settingsReads:intercepted,englishProjectEntries:20,recovered:true},null,2));
 console.log('A failed locale prefetch recovers to the authenticated English project library');
}finally{await page.send('Fetch.disable');page.close();}
