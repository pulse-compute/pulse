'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {analyze,unionMs}=require('../../../scripts/qualification-phases.cjs');
assert.equal(unionMs([[0,10],[5,15],[20,30]]),25);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'phase-analysis-'));
try {
 const file=path.join(root,'trace.jsonl');
 const rows=[{event:'process',schema:'pulse.test-phase-observation.v1',begin:0},
 {event:'start',id:1,parent:null,label:'parent',start:0},
 {event:'start',id:2,parent:1,label:'child',start:5},
 {event:'start',id:3,parent:1,label:'child',start:8},
 {event:'end',id:2,end:12,status:'returned'}, {event:'end',id:3,end:15,status:'threw'},
 {event:'end',id:1,end:20,status:'returned'}, {event:'exit',end:25,exitCode:0,dropped:0,observationErrors:0,counts:{}}];
 const put=()=>fs.writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n');put();
 const result=analyze(root);assert.equal(result.totals.parent.exclusiveMs,10);assert.equal(result.processes[0].unattributedMs,5);assert.equal(result.warnings.length,0);
 rows.pop();put();assert.equal(analyze(root).processes[0].observedMs,null);assert.equal(analyze(root).warnings.length,1);
 fs.appendFileSync(file,'{');assert(analyze(root).warnings.some(w=>w.includes('invalid JSON')));
 fs.unlinkSync(file);fs.symlinkSync(__filename,file);assert.throws(()=>analyze(root),/ordinary file/);
 console.log('ok - phase analysis unions overlapping children and preserves incomplete/invalid evidence');
} finally{fs.rmSync(root,{recursive:true,force:true});}
