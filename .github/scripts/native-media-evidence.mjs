import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import {connectPage} from '../../scripts/performance/browser-cdp.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let page;
for(let i=0;i<60&&!page;i++){
 try{page=await connectPage('http://127.0.0.1:9222');}catch{await pause(500);}
}
assert.ok(page,'The isolated release WebView must expose CDP through the separate test APK');
try{
 await page.wait(`performance.getEntriesByName('shotloom-media-first-frame').length>0 && [...document.querySelectorAll('.react-flow__node img')].some(i=>{const r=i.getBoundingClientRect();return i.complete&&i.naturalWidth===1920&&i.naturalHeight===1080&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight})`,90000);
 const inspect=()=>page.evaluate(`({timeOrigin:performance.timeOrigin,firstFrames:performance.getEntriesByName('shotloom-media-first-frame').map(e=>e.startTime),viewport:document.querySelector('.react-flow__viewport')?.style.transform,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,native:document.documentElement.dataset.nativeEmbedded})`);
 const before=await inspect();
 assert.ok(before.firstFrames.length>0,'A visible decoded media frame must have been recorded');
 assert.equal(before.native,'true');assert.ok(before.scrollWidth<=before.width+1);
 await writeFile('perf/media-ready.json',JSON.stringify(before,null,2));
 let returned=false;
 for(let i=0;i<120;i++){
  try{await access('perf/media-return.marker');returned=true;break;}catch{await pause(500);}
 }
 assert.ok(returned,'The native project library return gesture must complete');
 const after=await inspect();
 assert.equal(after.timeOrigin,before.timeOrigin,'Returning to the same project must retain its WebView document');
 assert.equal(after.viewport,before.viewport,'Returning must retain the canvas viewport');
 await writeFile('perf/media-preserved.json',JSON.stringify({before,after},null,2));
 console.log('Real 1080p first frame and same-project WebView retention passed');
}finally{page.close();}
