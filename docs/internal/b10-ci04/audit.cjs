'use strict';
// Reconcile a captured clean control inventory with the current canonical owners.
// This records review navigation, not an inferred JavaScript call graph.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname,'../../..');
const {inventory} = require('../../../scripts/qualification-audit.cjs');
const before = JSON.parse(fs.readFileSync(process.argv[2],'utf8')), after = inventory();
const prior = require('../b10-02/results.json'), reviewed = require('./review.json');
const ids = [...after.profiles.release,...after.installedGates];
assert.equal(ids.length,201); assert.equal(new Set(ids).size,201);
assert.deepEqual(after.profiles.release,before.profiles.release);
assert.deepEqual(after.installedGates,before.installedGates);
const oldRows = new Map(before.tasks.map(t=>[t.id,t])), newRows = new Map(after.tasks.map(t=>[t.id,t]));
const sources = {}, changed = [];
const exceptions = {
  'multifile-source-indexes':'--indexes-only returns before the compilation/execution branch; do not classify the unselected full invocation.',
  'crypto-es256-signing':'Loads checked-in es256-verifier.wasm; no artifact construction.',
  'crypto-rs256':'Loads checked-in guest Wasm and generates RSA keys; no compiler launch.',
  'cli-report-size-evidence':'Synthetic Wasm and mocked Binaryen emitter; no real compiler invocation.',
  'pure-helper-contract':'TypeScript source oracle and Native plan generation only; imported toolchain compilation functions are not invoked.',
  's3-read-contract':'Binding/lowering assertions plus text-state Native plans; no materialization.',
  'pulse-context-application':'Node JavaScript build and execution; requested Native build fails managed-handler admission before materialization.',
  'pulse-context-host':'Node JavaScript example build and host assertions.',
  'mcp-authorization':'Authorization fixtures plus resource-directory Node JavaScript build.',
  'release-artifact-determinism':'Independent package/docs construction retained; explicit non-compiler hint is unchanged.'
};
function helperClosure(seed) {
  const seen = new Set(), pending = [...seed];
  while (pending.length) {
    const file = pending.pop(); if (seen.has(file)) continue;
    const absolute = path.join(root,file); assert(fs.statSync(absolute).isFile(),file); seen.add(file);
    const text = fs.readFileSync(absolute,'utf8');
    for (const match of text.matchAll(/(?:require\(|from\s+)["'](\.[^"']+)["']/g)) {
      const base = path.resolve(path.dirname(absolute),match[1]);
      for (const candidate of [base,base+'.cjs',base+'.js']) {
        if (!fs.existsSync(candidate) || !fs.lstatSync(candidate).isFile()) continue;
        const relative = path.relative(root,candidate).split(path.sep).join('/');
        if ((relative.startsWith('wasm/test/') && !relative.startsWith('wasm/test/suite/') || /^packages\/[^/]+\/test\//.test(relative)) && /\.(cjs|js|ts)$/.test(relative)) pending.push(relative);
      }
    }
  }
  return [...seen].sort();
}
const rows = ids.map(id=>{
  const old = oldRows.get(id), current = newRows.get(id), previous = prior.tasks.find(t=>t.id===id);
  assert(old&&current&&previous,id);
  const {sealScheduling:a,...oldDefinition}=old, {sealScheduling:b,...newDefinition}=current;
  assert.deepEqual(newDefinition,oldDefinition,`task definition drift: ${id}`);
  const {compiler:ac,...ah}=a, {compiler:bc,...bh}=b; assert.deepEqual(bh,ah,`non-compiler hint drift: ${id}`);
  if(ac!==bc){assert.equal(ac,false);assert.equal(bc,true);assert(reviewed[id],id);changed.push(id);}
  const files=helperClosure(previous.sourceFiles);
  for(const file of files){const bytes=fs.readFileSync(path.join(root,file));sources[file]=createHash('sha256').update(bytes).digest('hex');}
  return {id,stage:current.installedGate?'installed':'release',invocation:current.invocation,
    before:ac,after:bc,unchangedScheduling:ah,sources:files,
    rationale:reviewed[id]||exceptions[id]||(ac
      ? 'Retain conservative existing compiler admission; no downgrade. Review target/helper responsibilities in B10-02 alongside these current source bytes.'
      : 'Retain non-compiler admission: selected contract/plan, synthetic artifact, or JavaScript path. B10-02 responsibilities and current literal helper closure reviewed; imports alone do not establish execution.')};
});
assert.deepEqual(changed.slice().sort(),Object.keys(reviewed).sort());
const result={schema:'pulse.b10-ci04.hint-ledger.v1',control:before.inventorySource,
  correctedPolicySha256:createHash('sha256').update(fs.readFileSync(path.join(root,'scripts/release-parallel.cjs'))).digest('hex'),
  coverage:{release:after.profiles.release,installed:after.installedGates},
  limits:'Source review is not an exhaustive dynamic call graph. Existing conservative true hints are retained even for planning/JavaScript tasks. Tokens cover whole tasks, not exact asc processes. No task identity, invocation, priority, cost, lock, dependency, exclusivity or selection changes.',
  counts:{total:ids.length,beforeCompiler:rows.filter(r=>r.before).length,afterCompiler:rows.filter(r=>r.after).length,changed:changed.length},
  changed,sourceHashes:sources,rows};
process.stdout.write(JSON.stringify(result,null,2)+'\n');
