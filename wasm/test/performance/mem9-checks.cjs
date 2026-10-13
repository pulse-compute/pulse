'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {validate}=require('./mem9.cjs');
assert.equal(process.argv.length,3,'Usage: mem9-checks.cjs /path/to/report.json');
const r=JSON.parse(fs.readFileSync(process.argv[2]));
// Relocate only the campaign root; all worker receipts retain their exact bytes.
r.directory=path.dirname(path.resolve(process.argv[2]));validate(r);
const changes=[x=>x.status='running',x=>x.source.workingTree='dirty',x=>x.workers.pop(),
  x=>x.workers[0].rows.pop(),x=>x.workers[1].controlGate.status='passed',
  x=>x.workers[0].rows[3].ownershipMask=0,x=>x.workers[0].rows[3].handles++,
  x=>x.workers[0].rows[0].responseSha256='0'.repeat(64),x=>x.sources['wasm/test/performance/mem9.cjs']='0'.repeat(64)];
for(const change of changes){const copy=structuredClone(r);change(copy);assert.throws(()=>validate(copy));}
console.log('ok - MEM9-01 retained evidence replay and '+changes.length+' incomplete, altered, or incorrectly passing report rejections');
