'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runDevelopment, createContext, parseArgs, readAttempt, allowReuse } = require('../../../scripts/development-recovery.cjs');
const { validateReport } = require('../../../scripts/maintainer-portable-validation.cjs');
const { acquireSealLock } = require('../../../scripts/release-recovery.cjs');
const { fingerprint } = require('../../../scripts/release-checkpoints.cjs');

async function verifyDevelopmentRecovery() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-development-test-'));
  const retained = [];
  const sourceRevision = 'a'.repeat(40);
  let input = 'same';
  const contextFactory = (checkout, selectedTasks) => ({ checkout, sourceRevision, selectedTasks, input });
  const trace = path.join(root, 'trace');
  const fail = path.join(root, 'fail');
  const names = Array.from({ length: 150 }, (_, i) => `fixture-${i + 1}`);
  const source = `const fs = require('node:fs'); const [trace, name, fail] = process.argv.slice(1);
    fs.appendFileSync(trace, name + '\\n'); if(name === 'fixture-150' && fs.existsSync(fail)) process.exit(9);`;
  const taskMap = Object.fromEntries(names.map(name => [name, { command: process.execPath,
    args: ['-e', source, trace, name, fail], evidence: 'unit', description: 'development recovery fixture', timeoutMs: 3000 }]));
  async function run(options, extra = {}) {
    const result = await runDevelopment({ root, options, taskMap, contextFactory, ...extra });
    for (const item of result.report.results) if (item.retainedTaskRoot) retained.push(item.retainedTaskRoot);
    assert(result.report.finishedAt);
    assert.equal(result.report.qualification, false);
    assert.throws(() => validateReport(result.report, result.report.selectedTasks, sourceRevision), /Unsupported runner report/);
    return result;
  }
  try {
    for (const args of [[], ['--no-report'], ['--from', 'x'], ['--resume'], ['--resume', root, '--task', 'x']]) assert.throws(() => parseArgs(args));
    assert.deepEqual(parseArgs(['--task', 'api-surface']), { profiles: [], tasks: ['api-surface'] });
    assert(!allowReuse('perf-benchmark', taskMap[names[0]]));
    for (const evidence of ['providers', 'external', 'release']) assert(!allowReuse('fixture', { ...taskMap[names[0]], evidence }));

    fs.writeFileSync(fail, 'deliberate failure');
    const initial = await run({ profiles: [], tasks: names });
    assert.equal(initial.report.status, 'failed');
    assert.equal(initial.report.results.filter(x => x.status === 'passed').length, 149);
    // A disconnect can leave the progress report truncated. Receipts, not the
    // mutable aggregate, are authority for development reuse.
    fs.writeFileSync(path.join(initial.directory, 'report.json'), '{interrupted');
    const originalManifest = fs.readFileSync(path.join(initial.directory, 'manifest.json'));
    const originalReceipt = fs.readFileSync(initial.report.results[0].checkpoint.receiptPath);
    fs.rmSync(fail);
    const resumed = await run({ resume: initial.directory });
    assert.equal(resumed.report.status, 'passed');
    assert.deepEqual(resumed.report.recovery.counts, { selected: 150, completed: 150, reused: 149, executed: 1, remaining: 0 });
    assert.equal(fs.readFileSync(trace, 'utf8').trim().split('\n').length, 151);
    assert.equal(fs.readFileSync(path.join(initial.directory, 'report.json'), 'utf8'), '{interrupted');
    assert.deepEqual(fs.readFileSync(path.join(initial.directory, 'manifest.json')), originalManifest);
    assert.deepEqual(fs.readFileSync(initial.report.results[0].checkpoint.receiptPath), originalReceipt);

    const first = await run({ profiles: [], tasks: names.slice(0, 2) });
    fs.writeFileSync(first.report.results[0].checkpoint.receiptPath, '{truncated');
    const corrupt = await run({ resume: first.directory });
    assert.deepEqual(corrupt.report.results.map(x => x.execution), ['executed', 'reused']);
    const receipt = corrupt.report.results[1].checkpoint.receiptPath;
    fs.rmSync(path.join(path.dirname(receipt), path.basename(receipt, '.json'), 'task-log'));
    const missing = await run({ resume: corrupt.directory });
    assert.deepEqual(missing.report.results.map(x => x.execution), ['reused', 'executed']);
    input = 'changed';
    const changed = await run({ resume: missing.directory });
    assert.equal(changed.report.status, 'failed');
    assert.equal(changed.report.completedTasks, 0);
    assert.match(changed.report.error.message, /inputs changed/);
    input = 'same';
    const drift = await run({ profiles: [], tasks: [names[0]] }, { onChild(child) { if (!child) input = 'drift'; } });
    assert.equal(drift.report.status, 'failed');
    assert.equal(drift.report.results[0].status, 'failed');
    assert.match(drift.report.results[0].error, /inputs changed/);
    input = 'same';
    const afterDrift = await run({ resume: drift.directory });
    assert.equal(afterDrift.report.results[0].execution, 'executed');

    const interrupted = await run({ profiles: [], tasks: [names[0]] }, {
      onChild(child) { if (child) process.emit('SIGTERM'); }
    });
    assert.equal(interrupted.report.status, 'interrupted');
    const afterSignal = await run({ resume: interrupted.directory });
    assert.equal(afterSignal.report.results[0].execution, 'executed');
    assert.equal(afterSignal.report.status, 'passed');

    const freshOnly = { ...taskMap, [names[0]]: { ...taskMap[names[0]], evidence: 'external' } };
    const external = await run({ profiles: [], tasks: [names[0]] }, { taskMap: freshOnly });
    const externalAgain = await run({ resume: external.directory }, { taskMap: freshOnly });
    assert.equal(externalAgain.report.results[0].execution, 'executed');
    const lock = acquireSealLock(root);
    try { await assert.rejects(run({ profiles: [], tasks: [names[0]] }), /still active/); }
    finally { lock.release(); }
    assert.throws(() => readAttempt(root, path.dirname(first.directory)), /this checkout/);
    const link = path.join(root, '.pulse-development/attempts/linked');
    fs.symlinkSync(first.directory, link);
    assert.throws(() => readAttempt(root, link), /symlink/);
    fs.rmSync(link);
    fs.writeFileSync(path.join(first.directory, 'manifest.json'), '{}');
    const malformed = await run({ resume: first.directory });
    assert.equal(malformed.report.status, 'failed');
    assert.equal(malformed.report.completedTasks, 0);

    // Real Git/dependency/build/tool/environment identity, independent of the
    // small injected context used by the subprocess-scale recovery fixture.
    const checkout = path.join(root, 'checkout'); fs.mkdirSync(checkout);
    const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { stdio: 'pipe' });
    git('init'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
    fs.writeFileSync(path.join(checkout, '.gitignore'), 'node_modules/\ndist/\n.validation-tools/\n');
    fs.writeFileSync(path.join(checkout, 'source'), 'source');
    git('add', '.'); git('commit', '-m', 'fixture');
    for (const dir of ['wasm', 'node_modules', 'dist', '.validation-tools/pnpm/bin']) fs.mkdirSync(path.join(checkout, dir), { recursive: true });
    const dependency = path.join(checkout, 'node_modules/dependency.js'), build = path.join(checkout, 'dist/index.js');
    const pnpm = path.join(checkout, '.validation-tools/pnpm/bin/pnpm');
    for (const file of [dependency, build, pnpm]) fs.writeFileSync(file, 'original');
    const capture = env => createContext(checkout, [names[0]], env || { PATH: '' }, taskMap);
    const baseline = fingerprint(capture());
    for (const file of [dependency, build, pnpm]) {
      fs.writeFileSync(file, 'changed'); assert.notEqual(fingerprint(capture()), baseline); fs.writeFileSync(file, 'original');
    }
    assert.notEqual(fingerprint(capture({ PATH: '', SECRET: 'not-stored' })), baseline);
    assert(!JSON.stringify(capture({ PATH: '', SECRET: 'not-stored' })).includes('not-stored'));
    fs.writeFileSync(path.join(checkout, 'source'), 'changed'); assert.throws(capture, /clean committed/);
    git('add', '.'); git('commit', '-m', 'changed source'); assert.notEqual(fingerprint(capture()), baseline);
    console.log('ok - development recovery: 149 verified passes plus one rerun; immutable attempts, signals, drift, corruption, locks and qualification isolation');
  } finally {
    for (const directory of retained) fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}
module.exports = { verifyDevelopmentRecovery };
if (require.main === module) verifyDevelopmentRecovery().catch(error => { console.error(error); process.exitCode = 1; });
