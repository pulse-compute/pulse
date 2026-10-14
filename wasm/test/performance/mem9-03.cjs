'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const child = require('node:child_process');
const { createHash } = require('node:crypto');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const { dependencies, environment } = require('./baseline.cjs');
const { cases, sizes } = require('./mem9-03-fixtures.cjs');
const root = path.resolve(__dirname, '../../..');
const hash = b => createHash('sha256').update(b).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
const cells = cases.flatMap(id => sizes.map(iterations => ({ id, iterations })));
function validate(r, directory = r.directory) {
  assert.equal(r.schemaVersion, 'pulse.mem9-03.v1'); assert.equal(r.status, 'passed');
  assert.equal(r.source.workingTree, ''); assert.match(r.source.sourceRevision, /^[a-f0-9]{40}$/); assert.match(r.source.sourceTree, /^[a-f0-9]{40}$/);
  assert.deepEqual(r.sourceAfter, r.source);
  assert.deepEqual(r.workers.map(({ id, iterations }) => ({ id, iterations })), cells);
  for (const w of r.workers) {
    const dir = path.join(directory, `${w.id}-${w.iterations}`);
    assert.equal(w.status, 'passed');
    const actualFiles = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort();
    assert.deepEqual(w.files.map(f => f.file), actualFiles);
    for (const f of w.files) assert.equal(hash(fs.readFileSync(path.join(dir, f.file))), f.sha256, f.file);
    const { files, ...receipt } = w;
    assert.deepEqual(receipt, read(path.join(dir, 'result.json')));
    assert.deepEqual(w.rows.map(x => x.target + '/' + (x.mode || 'observed')), ['node/observed', 'fastly/control', 'fastly/observed']);
    for (const x of w.rows) {
      assert.equal(x.responseSha256, x.expectedSha256);
      assert.equal(x.responseSha256, w.rows[0].responseSha256);
      const artifact = x.target === 'node' ? 'node.wasm' : x.mode + '.wasm';
      assert.equal(x.wasmSha256, files.find(f => f.file === artifact).sha256);
      if (x.handles !== null) {
        assert(Number.isInteger(x.handles) && x.handles > 0);
        assert.equal(Object.values(x.kinds).reduce((a, b) => a + b, 0), x.handles);
      }
    }
    const observed = w.rows[2];
    assert.equal(observed.managedAfterFullGc === null, w.id === 'stub');
    if (w.id !== 'stub') assert(observed.managedAfterFullGc > 0);
    assert.equal(w.runtime === 'stub', w.id === 'stub');
    assert.equal(w.runtime.includes('fixed-memory-runtime'), w.id === 'linked');
    if (w.id === 'numeric') assert(observed.numericRegions.regions.length > 0);
    if (w.id === 'flat-loop-cap') assert.equal(observed.numericRegions.regions.length > 0, w.iterations <= 256);
    if (w.id === 'linked') assert.equal(observed.capacityBytes, 2097152);
  }
  const control = r.workers.filter(w => w.id === 'numeric').map(w => w.rows[2]);
  assert(control.every(r => r.handles <= control[0].handles + 3), 'Existing bounded Fastly control regressed');
  assert.deepEqual(r.summary, summarize(r));
  return r;
}
function summarize(r) {
  return cases.flatMap(id => ['node', 'fastly'].map(target => {
    const ws = r.workers.filter(w => w.id === id);
    const rows = ws.map(w => w.rows.find(x => x.target === target && x.mode !== 'control'));
    const first = rows[0], last = rows.at(-1);
    return { id, target, sizes, handles: rows.map(r => r.handles), numericHandles: rows.map(r => r.kinds.number || 0), stringHandles: rows.map(r => r.kinds.string || 0),
      incrementalHandles: last.handles - first.handles, handlesPerIteration: (last.handles - first.handles) / sizes.at(-1),
      managedAfterFullGc: rows.map(r => r.managedAfterFullGc ?? null), ordinaryCapacityBytes: target === 'fastly' ? ws.map(w => w.rows[1].capacityBytes) : null,
      liveData: ws[0].liveData };
  }));
}
async function campaign(directory) {
  assert(!fs.existsSync(directory)); assert(!process.env.NODE_OPTIONS && !process.env.JSON_CACHE);
  const source = candidateIdentity(root);
  fs.mkdirSync(directory, { recursive: true });
  const r = { schemaVersion: 'pulse.mem9-03.v1', status: 'running', directory, source, dependencies: dependencies(), environment: environment(),
    domain: 'Node Native + injected Fastly ABI; default arena; no deployed or timing claims', workers: [] };
  const persist = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(r, null, 2) + '\n');
  persist(); let next = 0, failed = false;
  async function lane() {
    while (next < cells.length && !failed) {
      const cell = cells[next++], name = `${cell.id}-${cell.iterations}`, dir = path.join(directory, name);
      const fd = fs.openSync(path.join(directory, name + '.log'), 'wx');
      let outcome;
      try {
        outcome = await new Promise(resolve => {
          const p = child.spawn(process.execPath, [path.join(__dirname, 'mem9-03-worker.cjs'), cell.id, String(cell.iterations), dir], { stdio: ['ignore', fd, fd], timeout: 240000 });
          p.on('error', e => resolve({ error: e.message })); p.on('close', (code, signal) => resolve({ code, signal }));
        });
      } finally { fs.closeSync(fd); }
      if (fs.existsSync(path.join(dir, 'result.json'))) {
        r.workers.push({ ...read(path.join(dir, 'result.json')), files: fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort().map(file => ({ file, sha256: hash(fs.readFileSync(path.join(dir, file))) })) });
        r.workers.sort((a, b) => cases.indexOf(a.id) - cases.indexOf(b.id) || a.iterations - b.iterations); persist();
      }
      if (outcome.code !== 0) { failed = true; throw new Error(`${name}: ${JSON.stringify(outcome)}; see preserved worker log`); }
      console.log(`ok - ${name} (${r.workers.length}/${cells.length})`);
    }
  }
  try {
    const attempts = await Promise.allSettled([lane(), lane(), lane()]);
    const failure = attempts.find(a => a.status === 'rejected'); if (failure) throw failure.reason;
    r.sourceAfter = candidateIdentity(root); r.status = 'passed'; r.summary = summarize(r); validate(r);
  } catch (e) { r.status = 'failed'; r.error = e.stack; throw e; } finally { persist(); }
  console.log(`ok - MEM9-03: ${cells.length} cells, ${cells.length * 4} executions, immutable source and artifact hashes verified`);
}
function selfTest(r, directory) {
  validate(r, directory);
  for (const mutate of [r => { r.status = 'running'; }, r => { r.workers.pop(); }, r => { r.workers.push(r.workers[0]); }, r => { r.sourceAfter.sourceTree = '0'.repeat(40); }, r => { r.workers[0].rows[0].handles++; }, r => { r.workers[0].files[0].sha256 = '0'.repeat(64); }]) {
    const bad = structuredClone(r); mutate(bad); assert.throws(() => validate(bad, directory));
  }
  console.log('ok - incomplete, duplicate, source-changed, row-tampered and hash-tampered evidence rejected');
}
if (require.main === module) {
  const [mode, file] = process.argv.slice(2);
  if (mode === '--check' || mode === '--self-test') { const r = read(file); validate(r, path.dirname(path.resolve(file))); if (mode === '--self-test') selfTest(r, path.dirname(path.resolve(file))); console.log('ok - MEM9-03 evidence verified'); }
  else { assert.equal(mode, '--out'); campaign(path.resolve(file)).catch(e => { console.error(e.stack); process.exitCode = 1; }); }
}
module.exports = { validate, summarize };
