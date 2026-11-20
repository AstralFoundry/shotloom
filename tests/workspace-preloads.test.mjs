import assert from 'node:assert/strict';
import test from 'node:test';
import {collectWorkspacePreloads} from '../shared/workspacePreloads.ts';

test('native warmup includes the canvas static graph while optional workspaces stay deferred',()=>{
 const files=collectWorkspacePreloads({
  'index.html':{file:'assets/login.js',imports:['react']},react:{file:'assets/react.js'},
  workbench:{name:'ReactWorkbench',file:'assets/workbench.js',imports:['react']},
  canvas:{name:'CreationView',file:'assets/canvas.js',imports:['media'],css:['assets/canvas.css']},
  media:{file:'assets/media.js'},director:{name:'DirectorDesk',file:'assets/director.js'},
  optional:{file:'assets/optional.js'},
 });
 assert.ok(files.includes('assets/canvas.js'));
 assert.ok(files.includes('assets/media.js'));
 assert.ok(files.includes('assets/canvas.css'));
 assert.equal(files.filter(file=>file==='assets/react.js').length,1);
 assert.ok(!files.includes('assets/director.js')&&!files.includes('assets/optional.js'));
});
