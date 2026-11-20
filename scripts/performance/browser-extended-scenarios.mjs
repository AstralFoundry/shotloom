export function extendedScenarios(fixture) {
 const account='route=account';
 const media=`project=${fixture.mediaProjectId}`;
 const adminReady=`!!document.querySelector('.admin-summary') && !document.querySelector('.admin-panel .ant-spin-spinning')`;
 const editorRoot=`document.querySelector('.clip-studio-runtime-host')?.shadowRoot`;
 const filesSteps=[
  {ready:`!!document.querySelector('.react-flow__viewport')`,action:`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`},
  {ready:`!!document.querySelector('.project-search-input-row input')`,action:`(()=>{const input=document.querySelector('.project-search-input-row input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'File');input.dispatchEvent(new Event('input',{bubbles:true}));})()`},
  {ready:`[...document.querySelectorAll('.project-search-results button')].some(b=>b.querySelector('.project-search-kind')?.textContent==='File')`,action:`[...document.querySelectorAll('.project-search-results button')].find(b=>b.querySelector('.project-search-kind')?.textContent==='File').click()`},
 ];
 const adminTab=key=>({path:'/admin',prepare:adminReady,action:`document.querySelector('[id$="-tab-${key}"]').click()`});
 return [
  {name:'assets-library',query:`route=creation&${media}`,steps:[...filesSteps,{ready:`!!document.querySelector('.resource-browser')`,action:`document.querySelector('.resource-browser').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:200}))`},{ready:`[...document.querySelectorAll('.ant-dropdown-menu-item')].some(b=>b.textContent==='Media library')`,action:`[...document.querySelectorAll('.ant-dropdown-menu-item')].find(b=>b.textContent==='Media library').click()`}],prepare:`!!document.querySelector('.asset-scope-tabs')`,action:`document.querySelectorAll('.asset-scope-tabs label')[1].click()`,ready:`document.querySelectorAll('.material-node-wrap').length>0 && !document.querySelector('.resource-browser .ant-spin-spinning')`},
  {name:'materials',query:`route=creation&${media}`,steps:filesSteps,ready:`document.querySelectorAll('.material-node-wrap').length===48`},
  {name:'tasks',query:`route=creation&project=${fixture.taskProjectId}`,prepare:`!!document.querySelector('.react-flow__viewport')`,action:`[...document.querySelectorAll('.side-item')].find(b=>b.textContent.trim()==='Project tasks').click()`,ready:`document.querySelectorAll('.task-record').length===3`},
  {name:'topup',query:`${account}&panel=topup`,ready:`!!document.querySelector('.account-topup-preview strong') && !document.querySelector('.account-topup-preview strong').textContent.includes('—')`},
  {name:'feedback',query:account,prepare:`document.querySelectorAll('.account-action').length===3`,action:`document.querySelectorAll('.account-action')[2].click()`,followup:{ready:`!!document.querySelector('[id$="-tab-history"]')`,action:`document.querySelector('[id$="-tab-history"]').click()`},ready:`!!document.querySelector('.support-record')`},
  {name:'notifications',query:account,prepare:`document.querySelectorAll('.account-action').length===3`,action:`document.querySelectorAll('.account-action')[1].click()`,ready:`!!document.querySelector('.support-notification') || !!document.querySelector('.support-dialog .ant-empty')`},
  {name:'admin-models',path:'/admin',ready:adminReady},
  {name:'admin-users',...adminTab('users'),ready:`!!document.querySelector('.ant-tabs-content-active .admin-table tbody .admin-identity') && !document.querySelector('.ant-tabs-content-active .ant-spin-spinning')`},
  {name:'admin-feedback',...adminTab('feedback'),ready:`!!document.querySelector('.ant-tabs-content-active .support-record')`},
  {name:'admin-audit',...adminTab('audit'),ready:`!!document.querySelector('.ant-tabs-content-active .admin-table') && !document.querySelector('.ant-tabs-content-active .ant-spin-spinning')`},
  {name:'director',query:`route=creation&project=${fixture.directorProjectId}`,prepare:`!!document.querySelector('.director-node-open-button')`,action:`document.querySelector('.director-node-open-button').click()`,ready:`!!document.querySelector('.director-detail-frame')?.contentDocument?.querySelector('canvas')`},
  {name:'editor',baselineTimeout:true,query:`route=creation&project=${fixture.editorProjectId}`,prepare:`!!document.querySelector('.react-flow__viewport')`,action:`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Video editing').click()`,ready:`!!${editorRoot}?.querySelector('[aria-label="Select clip QA editor image 0"]')`},
 ];
}


