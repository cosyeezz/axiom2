import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupRows, cleanupProgress } from '../src/client/pages/desktop-cleanup.js';
const state = {revision:'r',scopes:[{id:'global',name:'Application',kind:'global' as const}],warnings:['另一个资源的状态提醒'],items:[{id:'ours',scopeId:'global',name:'Fixture',kind:'mcp' as const,description:'',source:'',managed:true,removable:true,cleanup:['private program']}]};
const row = cleanupRows({resources:state})[0];
test('unrelated warnings and failures cannot settle a missing cleanup request',()=>{
  assert.equal(cleanupProgress(row,{...state,items:[]},'request-A').state,'unknown');
  assert.equal(cleanupProgress(row,{...state,items:[],jobs:[{id:'request-other',running:false,message:'old failure',error:'其他任务失败'}]},'request-A').state,'unknown');
});
test('a matching active job stays running despite a family-wide warning',()=>{
  assert.equal(cleanupProgress(row,{...state,jobs:[{id:'request-A',running:true,message:'仍在移除'}]},'request-A').state,'running');
});
test('only the matching task failure is reported as failed',()=>{
  const jobs=[{id:'request-A',running:false,message:'failed',error:'所选范围未能移除'}];
  assert.equal(cleanupProgress(row,{...state,items:[],jobs},'request-A').state,'failed');
  assert.match(cleanupProgress(row,{...state,items:[],jobs},'request-A').message,/所选范围/);
});
test('matching terminal job and verified selected scope do not fail on unrelated warnings',()=>{
  assert.equal(cleanupProgress(row,{...state,items:[],jobs:[{id:'request-A',running:false,message:'done'}]},'request-A').state,'verified');
});
