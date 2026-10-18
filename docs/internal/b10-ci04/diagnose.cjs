'use strict';
// Bounded development comparison, not a release or installed acceptance receipt.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const [rootArg, outArg] = process.argv.slice(2);
const root = fs.realpathSync(rootArg), out = path.resolve(outArg);
const load = file => require(path.join(root, file));
const parallel = load('scripts/release-parallel.cjs'), recovery = load('scripts/release-recovery.cjs');
const { candidateIdentity } = load('scripts/release-feature-acceptance.cjs');
const { runSelectedTasks } = load('wasm/scripts/run-wasm-tests.cjs');
const { tasks } = load('wasm/test/suite/registry.cjs');
const names = ['report-capsule-contract', 'cli-report-viewer', 'cli-report-retained-evidence',
  'cli-report-relationships', 'cli-report-resource-inventory', 'cli-report-graph-diagnostics',
  'entities-orchestration-demo', 's3-body-read', 'shared-stage-o19', 'cli-report-capture-proof'];
const candidate = candidateIdentity(root), hash = b => createHash('sha256').update(b).digest('hex');
fs.mkdirSync(out);
const report = { qualification: false, candidate, status: 'running', names, node: process.version,
  nodeSha256: hash(fs.readFileSync(process.execPath)), driverSha256: hash(fs.readFileSync(__filename)),
  inputs: recovery.inputIdentity(root), hints: Object.fromEntries(names.map(n => [n, parallel.scheduling(n,tasks[n])])) };
const write = () => fs.writeFileSync(path.join(out,'result.json'), JSON.stringify(report,null,2)+'\n');
async function main() {
  let layout, observer;
  try {
    layout = parallel.prepareWorkspaces(root,candidate,2,6144,1);
    const workers = layout.workspaces.map(w=>({...w,inputs:recovery.inputIdentity(w.directory)}));
    const context = {schemaVersion:recovery.SCHEMA,candidate:{...candidate,repoRoot:root},
      selections:{release:names},scheduling:{...layout,workspaces:workers}};
    report.workerInputs = workers.map(w=>w.inputs);
    const state = {results:[],runDir:path.join(out,'runs'),sourceEnv:{}};
    fs.mkdirSync(path.join(state.runDir,'tasks'),{recursive:true});
    // Focused execution deliberately has no production recovery configuration.
    // Verify and reconcile isolated workspaces at experiment barriers only.
    const bindings = workers.map(w=>({root,candidate,directory:w.directory,inputs:w.inputs,
      layoutFile:path.join(path.dirname(w.directory),'layout.json')}));
    for (const b of bindings) parallel.verifyWorker(b);
    fs.mkdirSync(path.join(out,'process'));
    observer = load('scripts/release-resource-observer.cjs').startObserver(process.pid,path.join(out,'process'),root);
    report.samplerPid = observer.pid;
    const trace = fs.openSync(path.join(out,'schedule.jsonl'),'wx');
    const started = performance.now();
    try {
      await runSelectedTasks({state,selection:{selected:names,requested:names},taskMap:tasks,
        workspaces:layout.workspaces,compilerWorkers:1,
        persist(){fs.writeSync(trace,JSON.stringify({at:performance.now()-started,current:state.currentTasks,
          phases:state.currentTaskPhases,completed:state.results.length})+'\n');}});
    } finally { report.elapsedMs=performance.now()-started; fs.closeSync(trace); report.results=state.results; report.error=state.error; }
    assert.equal(state.results.length,names.length);
    assert(state.results.every(r=>r.status==='passed'&&r.cleanup.status==='passed'));
    report.logs = state.results.map(r=>{const file=path.resolve(root,'wasm',r.logPath),bytes=fs.readFileSync(file);
      return {name:r.name,bytes:bytes.length,sha256:hash(bytes)};});
    report.workerCleanup = bindings.map(b=>parallel.cleanupWorker(b));
    report.status='passed';
  } finally {
    if(observer)report.observer=await observer.stop();
    if(layout)parallel.cleanupWorkspaces(root,candidate.sourceTree,2);
    report.terminalCandidate=candidateIdentity(root);assert.deepEqual(report.terminalCandidate,candidate);
    write();
  }
}
main().catch(e=>{report.status='failed';report.failure=e.stack;write();console.error(e);process.exitCode=1;});
