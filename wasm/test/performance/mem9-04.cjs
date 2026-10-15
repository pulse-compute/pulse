'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), child = require('node:child_process');
const { createHash } = require('node:crypto');
const { candidateIdentity } = require('../../../scripts/release-feature-acceptance.cjs');
const { dependencies, environment } = require('./baseline.cjs');
const root = path.resolve(__dirname, '../../..'), hash = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
const cells = ['helper', 'stage'].flatMap(owner => ['default', 'elided'].flatMap(arena => [0, 64, 256].map(iterations => ({ owner, arena, iterations }))));
const name = w => `${w.owner}-${w.arena}-${w.iterations}`;
function validate(r, directory = r.directory) {
  assert.equal(r.schemaVersion, 'pulse.mem9-04.v1'); assert.equal(r.status, 'passed'); assert.equal(r.source.workingTree, ''); assert.deepEqual(r.sourceAfter, r.source);
  assert.deepEqual(r.workers.map(({ owner, arena, iterations }) => ({ owner, arena, iterations })), cells);
  for (const w of r.workers) {
    assert.equal(w.status, 'passed'); const dir = path.join(directory, name(w)), { files, ...receipt } = w;
    assert.deepEqual(receipt, read(path.join(dir, 'result.json')));
    assert.deepEqual(files.map(f => f.file), fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort());
    for (const f of files) assert.equal(hash(fs.readFileSync(path.join(dir, f.file))), f.sha256);
    assert.deepEqual(w.rows.map(x => `${x.strategy}/${x.mode}`), ['boxed/ordinary', 'boxed/observed', 'numeric/ordinary', 'numeric/observed']);
    for (const row of w.rows) { assert.equal(row.responseSha256, row.expectedSha256); assert.equal(row.responseSha256, w.rows[0].responseSha256); assert.equal(row.wasmSha256, files.find(f => f.file === row.strategy + (row.mode === 'observed' ? '.observed' : '') + '.wasm').sha256); }
    for (const i of [0, 2]) { assert.equal(w.rows[i].capacityBytes, w.rows[i + 1].capacityBytes); assert(w.rows[i + 1].managedAfterFullGc > 0); }
  }
  for (const owner of ['helper', 'stage']) for (const arena of ['default', 'elided']) {
    const rows = r.workers.filter(w => w.owner === owner && w.arena === arena);
    for (const w of rows) assert(w.rows[3].handles <= rows[0].rows[3].handles + 8, 'Bounded roots for two invocations');
    assert(rows[2].rows[1].handles - rows[0].rows[1].handles >= 512, 'Boxed positive control must retain per-addition temporaries');
    assert(rows[2].rows[3].managedAfterFullGc < rows[2].rows[1].managedAfterFullGc);
  }
  return r;
}
async function campaign(directory) {
  assert(!fs.existsSync(directory)); assert(!process.env.NODE_OPTIONS && !process.env.JSON_CACHE);
  const source = candidateIdentity(root); fs.mkdirSync(directory, { recursive: true });
  const r = { schemaVersion: 'pulse.mem9-04.v1', status: 'running', directory, source, dependencies: dependencies(), environment: environment(), domain: 'injected Fastly ABI; two invocations per request; no timing or deployed claim', workers: [] };
  const persist = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(r, null, 2) + '\n'); persist();
  let next = 0, failed = false;
  async function lane() {
    while (next < cells.length && !failed) {
      const cell = cells[next++], dir = path.join(directory, name(cell)), fd = fs.openSync(path.join(directory, name(cell) + '.log'), 'wx');
      let outcome;
      try { outcome = await new Promise(resolve => { const p = child.spawn(process.execPath, [path.join(__dirname, 'mem9-04-worker.cjs'), cell.owner, cell.arena, String(cell.iterations), dir], { stdio: ['ignore', fd, fd], timeout: 240000 }); p.on('error', e => resolve({ error: e.message })); p.on('close', (code, signal) => resolve({ code, signal })); }); }
      finally { fs.closeSync(fd); }
      if (fs.existsSync(path.join(dir, 'result.json'))) { r.workers.push({ ...read(path.join(dir, 'result.json')), files: fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort().map(file => ({ file, sha256: hash(fs.readFileSync(path.join(dir, file))) })) }); r.workers.sort((a, b) => cells.findIndex(c => name(c) === name(a)) - cells.findIndex(c => name(c) === name(b))); persist(); }
      if (outcome.code !== 0) { failed = true; throw new Error(`${name(cell)} failed: ${JSON.stringify(outcome)}; see retained log`); }
      console.log(`ok - ${name(cell)}`);
    }
  }
  try { const results = await Promise.allSettled([lane(), lane(), lane()]); const failed = results.find(r => r.status === 'rejected'); if (failed) throw failed.reason; r.sourceAfter = candidateIdentity(root); r.status = 'passed'; validate(r); }
  catch (e) { r.status = 'failed'; r.error = e.stack; throw e; } finally { persist(); }
  console.log('ok - MEM9-04: 12 cells / 48 executions, both arenas, bounded roots and parity');
}
if (require.main === module) { const [mode, file] = process.argv.slice(2); if (mode === '--check') { validate(read(file), path.dirname(path.resolve(file))); console.log('ok - MEM9-04 evidence verified'); } else { assert.equal(mode, '--out'); campaign(path.resolve(file)).catch(e => { console.error(e.stack); process.exitCode = 1; }); } }
module.exports = { validate };
