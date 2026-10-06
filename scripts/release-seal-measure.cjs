#!/usr/bin/env node
'use strict';

// Manual observation only: the release controller and its evidence verifier
// retain all qualification decisions. No benchmark is added to release gates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { runCommand } = require('./release-process.cjs');
const { atomicJson } = require('./release-recovery.cjs');
const ROOT = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function parseArgs(argv) {
  const options = { sealArgs: ['--require-fastly'], interruptAt: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--out' || token === '--interrupt-at') {
      const value = argv[++i];
      assert(value && !value.startsWith('-'), `${token} requires a value`);
      options[token === '--out' ? 'out' : 'interruptAt'] = value;
    } else if (['--dependency-bundle', '--timeout-minutes'].includes(token)) {
      const value = argv[++i];
      assert(value && !value.startsWith('-'), `${token} requires a value`);
      options.sealArgs.push(token, value);
    } else if (token === '--skip-install') options.sealArgs.push(token);
    else if (token === '--verify-resume') options.verifyResume = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown measurement option: ${token}`);
  }
  require('./validate-release.cjs').parseArgs(options.sealArgs);
  assert(!options.interruptAt || require('./release-feature-acceptance.cjs').REQUIRED_TASKS.includes(options.interruptAt),
    '--interrupt-at must name a required installed feature gate');
  assert(!(options.verifyResume && options.interruptAt), '--verify-resume and --interrupt-at cannot be combined');
  return options;
}

// A temporary preload outside the checkout preserves installed-consumer
// isolation. It records categories only, never arguments or environment values.
function observerSource(events) {
  return `'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const emit = value => fs.appendFileSync(${JSON.stringify(events)}, JSON.stringify(value) + '\\n');
for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = cp[method];
  cp[method] = function(command, args, ...rest) {
    const argv = Array.isArray(args) ? args : [];
    const binary = path.basename(String(command));
    const category = argv.some(arg => /[/\\\\]assemblyscript[/\\\\]bin[/\\\\]asc\\.js$/.test(arg)) ? 'asc'
      : /^(pnpm|npm)(\\.cmd)?$/.test(binary) && argv.includes('pack') ? 'pack'
      : /^(pnpm|npm)(\\.cmd)?$/.test(binary) && (argv.includes('install') || argv.includes('i')) ? 'install' : null;
    if (category) emit({kind: 'launch', category});
    return original.call(this, command, args, ...rest);
  };
}
process.on('exit', () => {
  const usage = process.resourceUsage();
  emit({kind: 'node-exit', cpuMicros: usage.userCPUTime + usage.systemCPUTime, maxRSSKiB: usage.maxRSS});
});
`;
}

function summarize(report, wallMs, events) {
  const reports = Object.entries(report?.recovery?.artifacts || {}).filter(([key]) => ['taskReport', 'featureTasks'].includes(key))
    .map(([, file]) => fs.existsSync(file) ? read(file) : null).filter(Boolean);
  const tasks = reports.flatMap(item => item.results || []);
  const sum = (items, key) => items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
  const packFile = report?.runDirectory && path.join(report.runDirectory, 'packages/pulse-shared-pack.json');
  return {
    wallMs, controllerMs: report?.durationMs ?? null,
    workerOccupancyMs: sum(tasks.filter(task => task.execution !== 'reused'), 'durationMs'),
    workerTimeDefinition: 'Serial executed task elapsed time, including waits and cleanup; not CPU time or bootstrap steps',
    tasks: { completed: tasks.length, passed: tasks.filter(task => task.status === 'passed').length,
      executed: tasks.filter(task => task.execution !== 'reused').length, reused: tasks.filter(task => task.execution === 'reused').length },
    avoidedTaskOccupancyMs: sum(tasks.filter(task => task.execution === 'reused'), 'reusedDurationMs'),
    candidatePackages: packFile && fs.existsSync(packFile) ? read(path.join(report.runDirectory, 'packages/pulse-release-manifest.json')).packageCount : null,
    observedLaunches: Object.fromEntries(['asc', 'pack', 'install'].map(category => [category,
      events.filter(event => event.kind === 'launch' && event.category === category).length])),
    observationScope: 'Node child_process launches under inherited preload; lower bounds. Shell launches and consumers that clear NODE_OPTIONS are excluded. Counts include failed attempts.',
    workerCpuMs: null, peakProcessTreeRSSKiB: null,
    resourceLimit: 'Whole-worker CPU and simultaneous process-tree RSS are not measured by this portable observer',
    observedNodeCpuMs: sum(events.filter(event => event.kind === 'node-exit'), 'cpuMicros') / 1000,
    peakObservedNodeRSSKiB: Math.max(0, ...events.filter(event => event.kind === 'node-exit').map(event => event.maxRSSKiB))
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node scripts/release-seal-measure.cjs --out .pulse-seal/measurements/<new-name> [--skip-install | --dependency-bundle <file>] [--timeout-minutes N] [--interrupt-at <installed-task> | --verify-resume]');
    return;
  }
  assert(options.out, '--out is required');
  const candidate = require('./release-feature-acceptance.cjs').candidateIdentity(ROOT);
  const out = path.resolve(ROOT, options.out), parent = path.join(ROOT, '.pulse-seal/measurements');
  assert(path.dirname(out) === parent, '--out must be a new direct child of .pulse-seal/measurements');
  // Reject symlink parents before creating anything or changing a prior report.
  for (const directory of [path.join(ROOT, '.pulse-seal'), parent]) {
    if (fs.existsSync(directory)) assert(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Measurement parent must be an ordinary directory');
  }
  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(out); // An existing result is never overwritten.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-seal-observer-'));
  const eventsFile = path.join(out, 'events.jsonl'), log = fs.openSync(path.join(out, 'controller.log'), 'wx');
  fs.writeFileSync(eventsFile, '');
  const preload = path.join(temporary, 'observer.cjs');
  fs.writeFileSync(preload, observerSource(eventsFile));
  // Reuse this exact preload path and environment across all attempts: release
  // recovery binds the complete environment, not just selected public options.
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(preload)}`.trim() };
  const controller = new AbortController();
  const handlers = ['SIGTERM', 'SIGINT'].map(signal => {
    const handler = () => controller.abort(signal);
    process.on(signal, handler);
    return [signal, handler];
  });
  const startedAt = new Date().toISOString(), started = performance.now();
  const previousAlias = path.join(ROOT, 'wasm/.test-results/release-seal.json');
  const attempts = [];
  let failure = null;
  try {
    const phases = options.verifyResume ? ['fresh', 'interrupted-resume', 'resume']
      : options.interruptAt ? ['interrupted-fresh', 'resume'] : ['fresh'];
    for (const phase of phases) {
      const prior = attempts.at(-1);
      if (phase === 'interrupted-resume' && prior.report.status !== 'passed') break;
      if (phase === 'resume' && (!prior.interruptionSent || prior.report.status !== 'interrupted')) break;
      const sealArgs = [...options.sealArgs, ...(phase.endsWith('resume') ? ['--resume', prior.report.runDirectory] : [])];
      const previousRunId = fs.existsSync(previousAlias) ? read(previousAlias).runId : null;
      const eventOffset = fs.statSync(eventsFile).size, attemptStarted = performance.now();
      let child, interrupted = false, timer, result, report = null, terminalFile = null, outputTail = '';
      try {
        if (phase.startsWith('interrupted-')) timer = setInterval(() => {
          try {
            const owner = read(path.join(ROOT, '.pulse-seal/active.json'));
            if (!child || owner.pid !== child.pid) return;
            const current = read(path.join(owner.directory, 'report.json'));
            if (current.runId === previousRunId || current.status !== 'running' || !current.recovery?.artifacts?.featureTasks) return;
            const runner = read(current.recovery.artifacts.featureTasks);
            const ready = phase === 'interrupted-resume'
              ? current.currentStep === 'fastly-reality' && runner.status === 'passed'
              : runner.currentTask === options.interruptAt && runner.currentTaskPhase === 'execution';
            if (ready && child && !interrupted) {
              interrupted = true;
              child.kill('SIGTERM');
            }
          } catch (_) { /* Atomic reports may not exist before their stage begins. */ }
        }, 50);
        result = await runCommand(process.execPath, ['scripts/validate-release.cjs', ...sealArgs], {
          cwd: ROOT, env, signal: controller.signal,
          timeoutMs: require('./validate-release.cjs').parseArgs(sealArgs).timeoutMs + 60000,
          onChild: value => { child = value; },
          onOutput(name, chunk) {
            fs.writeSync(log, chunk); process[name].write(chunk);
            outputTail = (outputTail + chunk.toString()).slice(-8192);
            terminalFile ||= outputTail.match(/\[pulse:release\] Terminal report: ([^\r\n]+)\r?\n/)?.[1];
          }
        });
        if (terminalFile) {
          assert.equal(path.dirname(path.dirname(terminalFile)), path.join(ROOT, '.pulse-seal/attempts'), 'Terminal report is outside this checkout');
          report = read(terminalFile);
          assert.notEqual(report.runId, previousRunId, 'Controller returned an old attempt');
        }
        assert(report && report.status !== 'running', 'Controller did not retain a new terminal attempt');
        assert.deepEqual(report.candidate, candidate, 'Measured candidate differs from clean source');
        if (report.status === 'passed') {
          assert.equal(result.status, 0, 'Passing report has nonzero process exit');
          require('./release-evidence-bundle.cjs').validateRecoveryEvidence(report);
          if (phase === 'resume') {
            assert.equal(report.recovery.previousDirectory, prior.report.runDirectory, 'Resume selected another attempt');
            assert.deepEqual(report.recovery.context, prior.report.recovery.context, 'Resume context changed');
          }
        }
        assert.deepEqual(require('./release-feature-acceptance.cjs').candidateIdentity(ROOT), candidate, 'Source changed during measurement');
      } finally { clearInterval(timer); }
      const events = fs.readFileSync(eventsFile).subarray(eventOffset).toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const attempt = { phase, report, interruptionSent: interrupted, metrics: summarize(report, Math.round(performance.now() - attemptStarted), events) };
      attempts.push(attempt);
      if (phase === 'interrupted-resume' && report.status === 'interrupted') {
        assert.deepEqual(report.recovery.context, prior.report.recovery.context, 'Interrupted retry context changed');
        assert.equal(attempt.metrics.tasks.executed, 0, 'Interrupted retry unexpectedly executed recoverable work');
        assert.equal(report.recovery.sharedPack.execution, 'reused', 'Interrupted retry reconstructed the shared pack');
      }
      if (phase === 'resume' && report.status === 'passed') assert(attempt.metrics.tasks.reused > 0, 'Resume reused no completed work');
      atomicJson(path.join(out, `${phase}.json`), attempt);
      if (phase.startsWith('interrupted-') && report.status === 'passed') throw new Error('Requested interruption was missed; no recovery demonstration');
    }
  } catch (error) { failure = error.message; }
  finally {
    fs.closeSync(log);
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
  const final = attempts.at(-1);
  const measurement = { schemaVersion: 'pulse.seal-measurement.v1', candidate, startedAt, completedAt: new Date().toISOString(),
    status: failure ? 'invalid' : final?.report.status || 'failed', qualificationPassed: !failure && final?.report.status === 'passed',
    error: failure || final?.report.error || null, attemptDirectory: final?.report.runDirectory || null,
    commandOptions: options.sealArgs, interruptionRequested: options.verifyResume ? 'fastly-reality after checkpoint restoration' : options.interruptAt,
    recoveryDemonstrated: !failure && final?.phase === 'resume' && final?.report.status === 'passed',
    environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(),
      dependencyProvenance: options.sealArgs.includes('--skip-install') ? 'Existing graph; provenance must be supplied by the operator' : 'Controller restoration',
      observerPreload: preload },
    expectedCoverage: {releaseTasks: require('../wasm/test/suite/registry.cjs').expandProfile('release').length,
      installedGates: require('./release-feature-acceptance.cjs').REQUIRED_TASKS.length},
    totalWallMs: Math.round(performance.now() - started),
    freshCompleteWallMs: attempts[0]?.phase === 'fresh' && attempts[0].report.status === 'passed' ? attempts[0].metrics.wallMs : null,
    attempts: attempts.map(({ report, ...attempt }) => ({ ...attempt, status: report.status, directory: report.runDirectory })) };
  atomicJson(path.join(out, 'measurement.json'), measurement);
  // Keep the tiny preload with the attempts. A later recovery must retain the
  // same environment; neither timings nor this wrapper waive that requirement.
  console.log(`Measurement: ${path.join(out, 'measurement.json')}`);
  if (!measurement.qualificationPassed) process.exitCode = 1;
  return measurement;
}

module.exports = { parseArgs, observerSource, summarize, main };
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
