'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), child = require('node:child_process');
const { createHash } = require('node:crypto');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const { dependencies, environment } = require('./baseline.cjs');
const { cells, name } = require('./mem9-06a-fixtures.cjs');
const { scenarios } = require('../provider/assert-fastly-numeric-runtimes.cjs');
const { POLICY, LINKED_POLICY } = require('../../packages/runtime-core-as/src/compiler/canonical-native-numeric');
const root = path.resolve(__dirname, '../../..'), hash = bytes => createHash('sha256').update(bytes).digest('hex'), read = file => JSON.parse(fs.readFileSync(file));
function validate(report, directory = report.directory) {
  assert.equal(report.schemaVersion, 'pulse.mem9-06b.v1'); assert.equal(report.status, 'passed');
  assert.equal(report.source.workingTree, ''); assert.deepEqual(report.sourceAfter, report.source);
  assert.deepEqual(report.workers.map(({ runtime, iterations, arena }) => ({ runtime, iterations, arena })), cells);
  for (const w of report.workers) {
    assert.equal(w.status, 'passed'); const dir = path.join(directory, name(w)), { files, ...receipt } = w;
    assert.deepEqual(receipt, read(path.join(dir, 'result.json')));
    assert.deepEqual(files.map(f => f.file), fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort());
    for (const f of files) assert.equal(hash(fs.readFileSync(path.join(dir, f.file))), f.sha256);
    const generated = read(path.join(dir, 'generation.json')).production;
    assert.equal(generated.numericRegions.policy, w.runtime === 'stub' ? POLICY : LINKED_POLICY);
    if (w.runtime === 'schema-linked') {
      assert.deepEqual(w.rows, []); assert.equal(w.proof.selected, 0); assert.equal(w.proof.reason, 'schema-active-linked');
      assert.equal(generated.numericRegions.enabled, false); assert.equal(generated.numericRegions.regions.length, 0);
      assert.equal(hash(fs.readFileSync(path.join(dir, 'production.source.ts'))), hash(fs.readFileSync(path.join(dir, 'boxed.source.ts'))));
      assert.equal(w.recipes.length, 0); continue;
    }
    assert(generated.numericRegions.enabled); assert(w.proof.selected > 0); assert.equal(w.recipes.length, 4);
    assert.deepEqual(w.rows.map(r => `${r.strategy}/${r.mode}`), ['boxed/ordinary', 'boxed/observed', 'production/ordinary', 'production/observed']);
    for (const row of w.rows) {
      assert.equal(row.wasmSha256, files.find(f => f.file === `${row.strategy}-${row.mode}.wasm`).sha256);
      assert.equal(row.selected > 0, row.strategy === 'production'); assert.deepEqual(row.executions.map(e => e.scenario), scenarios);
      if (w.runtime !== 'stub') {
        const audit = read(path.join(dir, `${row.strategy}-${row.mode}.guest-link.json`)).audit;
        assert.equal(audit.status, 'passed'); assert.equal(audit.instructions.memoryGrow, 0); assert(audit.checks.every(c => c.status === 'passed'));
      }
      for (let i = 0; i < scenarios.length; i++) {
        const e = row.executions[i]; assert.equal(e.outcomeSha256, w.rows[0].executions[i].outcomeSha256);
        if (['transport', 'deadline', 'cancel'].includes(e.scenario)) continue;
        assert(e.capacityBytes > 0); if (w.runtime !== 'stub') assert.equal(e.capacityBytes, 2097152);
        if (row.mode === 'ordinary') { assert.equal(e.handles, null); assert.equal(e.allocatorSpanBytes, null); }
        else { assert(e.handles > 0 && e.numbers > 0 && e.allocatorSpanBytes > 0); if (w.runtime === 'stub') assert.equal(e.managedAfterFullGc, null); else assert(e.managedAfterFullGc > 0); }
      }
    }
  }
  for (const runtime of ['stub', 'ES256', 'RS256']) {
    const [low, high] = report.workers.filter(w => w.runtime === runtime);
    assert.equal(high.rows[1].executions[0].numbers - low.rows[1].executions[0].numbers, 1280);
    assert.equal(high.rows[3].executions[0].numbers, low.rows[3].executions[0].numbers);
    assert(high.rows[3].executions[0].handles < high.rows[1].executions[0].handles);
    if (runtime === 'stub') assert(high.rows[3].executions[0].allocatorSpanBytes < high.rows[1].executions[0].allocatorSpanBytes);
    else assert(high.rows[3].executions[0].managedAfterFullGc < high.rows[1].executions[0].managedAfterFullGc);
  }
  return report;
}
async function campaign(directory) {
  assert(!fs.existsSync(directory)); assert(!process.env.NODE_OPTIONS && !process.env.JSON_CACHE);
  const source = candidateIdentity(root); fs.mkdirSync(directory, { recursive: true });
  const report = { schemaVersion: 'pulse.mem9-06b.v1', status: 'running', directory, source, dependencies: dependencies(), environment: environment(),
    domain: 'Real Fastly production writer, injected ABI host. Entries, allocator span, managed bytes and linear capacity are separate. No timing/RSS/deployed claim.', workers: [] };
  const persist = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); persist();
  let next = 0, failed = false;
  async function lane() {
    while (next < cells.length && !failed) {
      const cell = cells[next++], dir = path.join(directory, name(cell)), fd = fs.openSync(path.join(directory, name(cell) + '.log'), 'wx'); let outcome;
      try { outcome = await new Promise(resolve => { const p = child.spawn(process.execPath, [path.join(__dirname, 'mem9-06b-worker.cjs'), cell.runtime, String(cell.iterations), cell.arena, dir], { stdio: ['ignore', fd, fd], timeout: 240000 }); p.on('error', e => resolve({ error: e.message })); p.on('close', (code, signal) => resolve({ code, signal })); }); }
      finally { fs.closeSync(fd); }
      if (fs.existsSync(path.join(dir, 'result.json'))) { report.workers.push({ ...read(path.join(dir, 'result.json')), files: fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort().map(file => ({ file, sha256: hash(fs.readFileSync(path.join(dir, file))) })) }); report.workers.sort((a, b) => cells.findIndex(c => name(c) === name(a)) - cells.findIndex(c => name(c) === name(b))); persist(); }
      if (outcome.code !== 0) { failed = true; throw Error(`${name(cell)} failed: ${JSON.stringify(outcome)}`); } console.log(`ok - ${name(cell)}`);
    }
  }
  try { const results = await Promise.allSettled([lane(), lane()]); const failure = results.find(x => x.status === 'rejected'); if (failure) throw failure.reason; report.sourceAfter = candidateIdentity(root); report.status = 'passed'; validate(report); }
  catch (e) { report.status = 'failed'; report.error = e.stack; throw e; } finally { persist(); }
  for (const mutate of [r => r.workers.pop(), r => r.sourceAfter.sourceTree = '0'.repeat(40), r => r.workers[0].files[0].sha256 = '0'.repeat(64)]) { const bad = structuredClone(report); mutate(bad); assert.throws(() => validate(bad)); }
  console.log('ok - MEM9-06B production retention, semantics, failure/recovery, exclusions and evidence integrity');
}
if (require.main === module) { const [mode, file] = process.argv.slice(2); if (mode === '--check') { validate(read(file), path.dirname(path.resolve(file))); console.log('ok - MEM9-06B evidence verified'); } else { assert.equal(mode, '--out'); campaign(path.resolve(file)).catch(e => { console.error(e.stack); process.exitCode = 1; }); } }
module.exports = { validate };
