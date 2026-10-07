'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tasks, expandProfile } = require('../suite/registry.cjs');
const { RELEASE_VERSION } = require('../../../scripts/package-support.cjs');
const { REQUIRED_TASKS, SEPARATE_GATES, validateCoverage, validateAcceptance, validateSummary } = require('../../../scripts/release-feature-acceptance.cjs');
const { installedAcceptanceReport } = require('../support/installed-acceptance-report.cjs');

validateCoverage(tasks, expandProfile);
assert.throws(() => validateCoverage({ ...tasks, 's3-body-installed': undefined }, expandProfile), /Missing installed feature gate/);
assert.throws(() => validateCoverage(tasks, () => []), /lost cross-lane task/);
assert.throws(() => validateCoverage(tasks, name => [...expandProfile(name), 'jwt-installed-workflow']), /remain separate/);
assert(REQUIRED_TASKS.includes('mcp-installed'));
assert(!SEPARATE_GATES.some(gate => gate.task === 'mcp-installed'));
assert.throws(() => validateCoverage(tasks, expandProfile, ['mcp-installed']), /remain separate from fast/);
assert.equal(SEPARATE_GATES.find(gate => gate.task === 'kv-conditional-acceptance').classification, 'external-required');
assert.equal(SEPARATE_GATES.find(gate => gate.task === 'str03c-bounded-transforms').classification, 'experimental');
assert.equal(installedAcceptanceReport('/focused.json', {}), '/focused.json');
assert.throws(() => installedAcceptanceReport('/focused.json', { PULSE_RELEASE_FEATURE_REPORT_DIR: '/unused', PULSEWASM_SUITE_TASK: '../invalid' }), /registered installed task/);

const identity = { sourceRevision: 'a'.repeat(40), sourceTree: 'b'.repeat(40), workingTree: '' };
const startedAt = '2026-10-04T00:00:00.000Z';
const runner = {
  schemaVersion: 2, sourceRevision: identity.sourceRevision, sourceIdentity: { sourceRevision: identity.sourceRevision },
  status: 'passed', currentTask: null, startedAt, finishedAt: startedAt, durationMs: 0,
  requestedTasks: [...REQUIRED_TASKS], selectedTasks: [...REQUIRED_TASKS], completedTasks: REQUIRED_TASKS.length,
  results: REQUIRED_TASKS.map(name => ({ name, status: 'passed', exitCode: 0 }))
};
const reports = Object.fromEntries(REQUIRED_TASKS.map(task => [task, {
  source: identity.sourceRevision, sourceTree: identity.sourceTree, workingTree: '', status: 'passed',
  workingDiffSha256: crypto.createHash('sha256').update('').digest('hex'), acceptanceScriptSha256: 'c'.repeat(64),
  packages: [{ name: '@pulse-compute/pulse', version: RELEASE_VERSION, sha256: 'd'.repeat(64) }]
}]));
assert.equal(validateAcceptance(runner, reports, identity).gates.length, 11);
const summary = validateAcceptance(runner, reports, identity);
assert.equal(validateSummary(summary, identity.sourceRevision), summary);
assert.throws(() => validateSummary(undefined, identity.sourceRevision), /Missing installed feature acceptance/);
assert.throws(() => validateSummary({ ...summary, status: 'failed' }, identity.sourceRevision), /did not pass/);
assert.throws(() => validateSummary(summary, 'e'.repeat(40)), /another source/);
assert.throws(() => validateSummary({ ...summary, gates: summary.gates.slice(1) }, identity.sourceRevision), /Incomplete installed feature gates/);
function reject(mutator, pattern) {
  const copy = structuredClone({ runner, reports, identity });
  mutator(copy);
  assert.throws(() => validateAcceptance(copy.runner, copy.reports, copy.identity), pattern);
}
const first = REQUIRED_TASKS[0];
reject(x => x.runner.status = 'running', /not passing/);
reject(x => x.runner.finishedAt = null, /not terminal/);
reject(x => x.runner.completedTasks--, /Incomplete task count/);
reject(x => x.runner.results[1].name = first, /Completed task set differs/);
reject(x => x.runner.selectedTasks.pop(), /Selected task set differs/);
reject(x => x.runner.sourceRevision = 'e'.repeat(40), /different tested SHA/);
reject(x => x.reports[first].status = 'failed', /not passing/);
reject(x => x.reports[first].source = 'e'.repeat(40), /another candidate/);
reject(x => x.reports[first].sourceTree = 'e'.repeat(40), /tree differs/);
reject(x => x.reports[first].workingTree = ' M src/index.ts', /dirty source/);
reject(x => x.reports[first].workingDiffSha256 = 'e'.repeat(64), /diff differs/);
reject(x => delete x.reports[first].acceptanceScriptSha256, /Missing oracle identity/);
reject(x => delete x.reports[first], /differ from gate set/);
reject(x => x.reports[first].packages = [], /Missing installed tarball/);
reject(x => x.reports[first].packages[0].name = '@pulse-compute/api', /Non-published package/);
reject(x => x.reports[first].packages[0].version = '1.0.0-beta.4', /Mixed installed version/);
reject(x => x.reports[first].packages[0].sha256 = '', /Missing tarball hash/);
reject(x => x.reports[first].packages[0].sha256 = 'e'.repeat(64), /Mixed candidate tarball/);
reject(x => x.identity.workingTree = '?? fixture.ts', /Candidate must be clean/);

// Exercise the owning release orchestration: successful aggregate replay must
// still stop on a failing installed-feature gate before external host evidence.
async function verifySealOrchestration() {
  const supervisor = require('../../../scripts/release-process.cjs');
  const sealModule = require.resolve('../../../scripts/validate-release.cjs');
  const originalRun = supervisor.runCommand;
  const recovery = require('../../../scripts/release-recovery.cjs');
  const originalAcquire = recovery.acquireSealLock;
  const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-seal-fixture-lock-'));
  const acceptance = require('../../../scripts/release-feature-acceptance.cjs');
  const originalCandidate = acceptance.candidateIdentity;
  const originalWrite = process.stdout.write;
  const commands = [];
  let sharedEnvironment;
  try {
    // A controller fixture must not claim the enclosing seal's checkout lock.
    recovery.acquireSealLock = (_root, directory) => originalAcquire(lockRoot, directory);
    acceptance.candidateIdentity = () => ({
      sourceRevision: require('../../../scripts/source-identity.cjs').resolveSourceIdentity(path.resolve(__dirname, '../../..')).sourceRevision,
      sourceTree: 'a'.repeat(40), workingTree: ''
    });
    supervisor.runCommand = async (command, args, options) => {
      if (args[0] === '-e') return originalRun(command, args, options); // real bounded cleanup
      commands.push(args);
      if (args.includes('scripts/release-shared-pack.cjs')) {
        const directory = args[args.indexOf('--out') + 1];
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'pulse-shared-pack.json'), '{}');
      }
      if (args.includes('--profile')) {
        sharedEnvironment = {
          directory: options.env.PULSE_RELEASE_SHARED_PACK,
          digest: options.env.PULSE_RELEASE_SHARED_PACK_SHA256
        };
        assert(sharedEnvironment.directory);
        assert.match(sharedEnvironment.digest, /^[a-f0-9]{64}$/);
      }
      if (args.includes('scripts/release-feature-acceptance.cjs')) {
        assert.deepEqual({ directory: options.env.PULSE_RELEASE_SHARED_PACK, digest: options.env.PULSE_RELEASE_SHARED_PACK_SHA256 }, sharedEnvironment);
      }
      return { status: args.includes('scripts/release-feature-acceptance.cjs') ? 1 : 0, signal: null };
    };
    process.stdout.write = () => true;
    delete require.cache[sealModule];
    await assert.rejects(() => require(sealModule).main(['--skip-install', '--no-report']),
      error => error.code === 'PULSE_RELEASE_SEAL_STEP_FAILED' && error.step.id === 'installed-features');
    assert(commands.some(args => args.includes('--profile') && args.includes('release')));
    assert(commands.some(args => args.includes('scripts/release-feature-acceptance.cjs')));
    assert(!commands.some(args => args.includes('provider-fastly-compute-reality')));
  } finally {
    supervisor.runCommand = originalRun;
    recovery.acquireSealLock = originalAcquire;
    fs.rmSync(lockRoot, { recursive: true, force: true });
    acceptance.candidateIdentity = originalCandidate;
    process.stdout.write = originalWrite;
    delete require.cache[sealModule];
  }
  console.log('ok - eleven separate installed gates, cross-lane coverage and fail-closed candidate/report identity');

}
verifySealOrchestration().catch(error => { console.error(error); process.exitCode = 1; });
