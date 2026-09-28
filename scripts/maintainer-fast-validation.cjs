#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { matchesPattern } = require('./maintenance-policy.cjs');
const { revisionRange } = require('./maintainer-validation-routing.cjs');
const { validateReport } = require('./maintainer-portable-validation.cjs');
const { tasks } = require('../wasm/test/suite/registry.cjs');

const ROOT = path.resolve(__dirname, '..');
const CORE = Object.freeze(['package-exports', 'api-surface', 'target-support', 'node-cross-target-conformance', 'schema-codecs-smoke']);
const FOCUSED = Object.freeze({
  'cli-and-diagnostics': ['cli-command-spec', 'cli-project-guards'],
  'compiler-default': ['canonical-api-lowering', 'javascript-effect-adapter'],
  documentation: [],
  'tests-and-evidence': []
});

const FAST_TASKS = Object.freeze([...new Set([...CORE, ...Object.values(FOCUSED).flat(), 'schema-registry', 'continuation-registry'])].sort());
const ALLOWED_FAST_TASKS = new Set([...FAST_TASKS, 'schema-codecs']);

function fullSchemaReason(file, rules, match) {
  if (rules.length === 0) return `${file}: unknown schema impact`;
  // Documentation synchronization mirrors maintainer pages into the CLI package;
  // those copies are documentation, not CLI execution dependencies.
  if (match(file, 'wasm/packages/cli/docs/**') &&
      rules.every((rule) => ['documentation', 'cli-and-diagnostics'].includes(rule.id))) return null;
  // Only these known owners can use the subset. Compiler/runtime/provider,
  // dependency and configuration changes keep the full corpus, even when the
  // filename does not contain "schema". Use the trusted base's classifications.
  const sharedOwners = rules.filter((rule) => !['documentation', 'maintainer-control-plane', 'tests-and-evidence'].includes(rule.id));
  if (sharedOwners.length) return `${file}: shared schema dependency (${sharedOwners.map((rule) => rule.id).join(', ')})`;
  if (rules.some((rule) => rule.id === 'tests-and-evidence') &&
      (/schema|json/i.test(file) || ['wasm/test/support/**', 'wasm/test/fixtures/**', 'wasm/test/suite/**'].some((pattern) => match(file, pattern)))) {
    return `${file}: schema proof or shared test input`;
  }
  return null;
}

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: ROOT, encoding, maxBuffer: 10 * 1024 * 1024 });
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--event') { options.event = true; continue; }
    if (key === '--branch') { options.mode = 'branch'; continue; }
    if (key === '--run') { options.run = true; continue; }
    if (!['--base', '--head', '--tested', '--report'].includes(key) || !argv[i + 1]) throw new Error(`Invalid fast validation option: ${key}`);
    options[key.slice(2)] = argv[++i];
  }
  if (options.event) Object.assign(options, revisionRange(process.env.GITHUB_EVENT_NAME, JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), process.env.GITHUB_SHA, (args) => git(args).trim()));
  for (const key of ['base', 'head', 'tested', 'report']) if (!options[key]) throw new Error(`Missing --${key}`);
  for (const key of ['base', 'head', 'tested']) if (!/^[a-f0-9]{40}$/.test(options[key])) throw new Error(`Invalid ${key} SHA`);
  return options;
}

function select(policy, files, registry = tasks, match = matchesPattern) {
  if (!policy || !Array.isArray(policy.pathRules) || policy.pathRules.length === 0) throw new Error('Trusted base has no path rules');
  const chosen = new Set(CORE);
  const decisions = [];
  const blockers = [];
  const fullSchemaReasons = [];
  for (const file of [...new Set(files)].sort()) {
    if (!file || file.startsWith('/') || file.split('/').includes('..')) throw new Error(`Invalid changed path: ${file}`);
    const rules = policy.pathRules.filter((rule) => rule.patterns.some((pattern) => match(file, pattern)));
    const boundaries = [...new Set(rules.flatMap((rule) => rule.boundaries))].sort();
    const schemaReason = fullSchemaReason(file, rules, match);
    if (schemaReason) fullSchemaReasons.push(schemaReason);
    const focused = new Set();
    if (rules.length === 0) blockers.push(`${file}: unknown path`);
    if (boundaries.length) blockers.push(`${file}: protected ${boundaries.join(', ')}`);
    if (rules.some((rule) => !Object.hasOwn(FOCUSED, rule.id))) blockers.push(`${file}: unmapped owner`);
    if (rules.some((rule) => rule.id === 'tests-and-evidence')) {
      // Some registry tasks resolve dependency-bound executables through getters.
      // Selection must work before dependency installation.
      const matching = Object.entries(registry).filter(([, task]) => {
        const args = Object.getOwnPropertyDescriptor(task, 'args')?.value;
        return args?.[0] && path.relative(ROOT, args[0]).replace(/\\/g, '/') === file;
      }).map(([id]) => id);
      if (matching.length === 0) blockers.push(`${file}: no direct registry task`);
      for (const id of matching) {
        if (ALLOWED_FAST_TASKS.has(id)) focused.add(id);
        else blockers.push(`${file}: ${id} belongs to full validation`);
      }
    }
    if (rules.some((rule) => rule.id === 'compiler-default')) {
      const extra = file.includes('/schema-') || file.includes('/schema/') ? ['schema-registry', 'schema-codecs'] :
        file.includes('/runtime/') || file.includes('/handler/') ? ['continuation-registry', 'javascript-effect-adapter'] : [];
      for (const id of extra) focused.add(id);
    }
    for (const rule of rules) for (const id of FOCUSED[rule.id] || []) focused.add(id);
    for (const id of focused) chosen.add(id);
    decisions.push({ file, rules: rules.map((rule) => rule.id), boundaries, tasks: [...focused].sort() });
  }
  if (files.length === 0) {
    blockers.push('No changed paths');
    fullSchemaReasons.push('No changed paths: unknown schema impact');
  }
  if (blockers.length) for (const id of FAST_TASKS) chosen.add(id);
  if (fullSchemaReasons.length || chosen.has('schema-codecs')) {
    chosen.delete('schema-codecs-smoke');
    chosen.add('schema-registry');
    chosen.add('schema-codecs');
  }
  const selectedTasks = [...chosen].sort();
  for (const id of selectedTasks) if (!registry[id]) throw new Error(`Selected task missing from registry: ${id}`);
  return {
    status: 'selected', selectionMode: blockers.length ? 'conservative' : 'focused', selectedTasks, decisions, blockers,
    schemaCoverage: {
      task: chosen.has('schema-codecs') ? 'schema-codecs' : 'schema-codecs-smoke',
      fullReasons: fullSchemaReasons,
      extendedCoverage: chosen.has('schema-codecs') ? 'included' : 'deferred-to-main-and-release'
    },
    fullCoverage: 'deferred-to-main'
  };
}

// Execute path matching from the trusted base, including its policy dependencies.
function withTrustedPolicy(base, callback) {
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('Invalid trusted base SHA');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fast-policy-'));
  try {
    for (const file of ['scripts/maintenance-policy.cjs', 'scripts/package-support.cjs', 'release/maintenance-policy.json', 'release/pulse-release-manifest.json']) {
      const destination = path.join(directory, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, git(['show', `${base}:${file}`]));
    }
    const trusted = require(path.join(directory, 'scripts/maintenance-policy.cjs'));
    return callback(trusted.MAINTENANCE_POLICY, trusted.matchesPattern);
  } finally {
    for (const key of Object.keys(require.cache)) if (key.startsWith(`${directory}${path.sep}`)) delete require.cache[key];
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function plan(options) {
  const tested = git(['rev-parse', 'HEAD']).trim();
  if (tested !== options.tested) throw new Error(`Checkout ${tested} differs from tested SHA ${options.tested}`);
  const parents = git(['rev-list', '--parents', '-n', '1', tested]).trim().split(' ');
  if (options.mode === 'branch') {
    if (options.head !== tested) throw new Error('Branch head differs from tested SHA');
  } else if (parents.length !== 3 || parents[1] !== options.base || parents[2] !== options.head) throw new Error('Tested commit must be the merge of the exact PR base and head');
  const files = git(['diff', '--no-renames', '--name-only', '-z', options.base, tested], 'buffer').toString('utf8').split('\0').filter(Boolean);
  return withTrustedPolicy(options.base, (policy, match) => ({
    schemaVersion: 'pulse.fast-validation.v2',
    base: options.base,
    head: options.head,
    tested,
    mode: options.mode || 'merge',
    policyVersion: policy.policyVersion,
    changedFiles: files.sort(),
    ...select(policy, files, tasks, match),
    exclusions: ['Fast evidence does not claim complete portable profiles or release readiness. Full portable coverage is required at main; Node 22 and documentation run in separate jobs.']
  }));
}

function writeReport(file, report) {
  const destination = path.resolve(ROOT, file);
  if (!destination.startsWith(`${ROOT}${path.sep}`)) throw new Error('Report must be within repository');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const report = plan(options);
  if (options.run && report.status !== 'selected') throw new Error(`Fast run requires full validation: ${report.blockers.join('; ')}`);
  console.log(`Fast validation ${report.status}; tested ${report.tested}; base ${report.base}; head ${report.head}`);
  console.log(`Selected tasks: ${report.selectedTasks.join(', ') || '(none)'}`);
  console.log(`Schema coverage: ${report.schemaCoverage.task}; extended corpus ${report.schemaCoverage.extendedCoverage}`);
  for (const reason of report.schemaCoverage.fullReasons) console.log(`Full schema coverage: ${reason}`);
  for (const decision of report.decisions) console.log(`${decision.file}: ${decision.rules.join(', ') || 'unknown'} -> ${decision.tasks.join(', ') || '(none)'}`);
  for (const blocker of report.blockers) console.log(`Conservative smoke; full coverage deferred to main: ${blocker}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `status=${report.status}\n`);
  if (options.run) {
    const args = ['wasm/scripts/run-wasm-tests.cjs', ...report.selectedTasks.flatMap((id) => ['--task', id]), '--report', '.test-results/fast-portable.json'];
    fs.rmSync(path.join(ROOT, 'wasm/.test-results/fast-portable.json'), { force: true });
    const child = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    report.taskExitCode = child.status ?? 1;
    report.taskReport = 'wasm/.test-results/fast-portable.json';
    try {
      const taskReport = JSON.parse(fs.readFileSync(path.join(ROOT, report.taskReport), 'utf8'));
      validateReport(taskReport, report.selectedTasks, report.tested);
      report.coverageVerified = true;
    } catch (_) { report.coverageVerified = false; }
    if (!report.coverageVerified) {
      console.error('Fast runner report is missing, incomplete, or from a different tested SHA');
      report.taskExitCode ||= 1;
    }
  }
  report.elapsedMs = Date.now() - started;
  writeReport(options.report, report);
  if (options.run && report.taskExitCode !== 0) process.exitCode = report.taskExitCode;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`Fast validation failed closed: ${error.message}`);
    try {
      const options = parseArgs(process.argv.slice(2));
      writeReport(options.report, { schemaVersion: 'pulse.fast-validation.v2', status: 'error', base: options.base, head: options.head, tested: options.tested, error: error.message });
    } catch (_) { /* malformed arguments or unsafe report path */ }
    process.exitCode = 1;
  }
}

module.exports = { select, plan, withTrustedPolicy, FAST_TASKS };
