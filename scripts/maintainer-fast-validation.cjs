#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { matchesPattern } = require('./maintenance-policy.cjs');
const { tasks } = require('../wasm/test/suite/registry.cjs');

const ROOT = path.resolve(__dirname, '..');
const CORE = Object.freeze(['package-exports', 'api-surface', 'target-support', 'node-cross-target-conformance']);
const FOCUSED = Object.freeze({
  'cli-and-diagnostics': ['cli-command-spec', 'cli-project-guards'],
  'compiler-default': ['canonical-api-lowering', 'javascript-effect-adapter'],
  documentation: [],
  'tests-and-evidence': []
});

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: ROOT, encoding, maxBuffer: 10 * 1024 * 1024 });
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--run') { options.run = true; continue; }
    if (!['--base', '--head', '--tested', '--report'].includes(key) || !argv[i + 1]) throw new Error(`Invalid fast validation option: ${key}`);
    options[key.slice(2)] = argv[++i];
  }
  for (const key of ['base', 'head', 'tested', 'report']) if (!options[key]) throw new Error(`Missing --${key}`);
  for (const key of ['base', 'head', 'tested']) if (!/^[a-f0-9]{40}$/.test(options[key])) throw new Error(`Invalid ${key} SHA`);
  return options;
}

function select(policy, files, registry = tasks) {
  if (!policy || !Array.isArray(policy.pathRules) || policy.pathRules.length === 0) throw new Error('Trusted base has no path rules');
  const chosen = new Set(CORE);
  const decisions = [];
  const blockers = [];
  for (const file of [...new Set(files)].sort()) {
    if (!file || file.startsWith('/') || file.split('/').includes('..')) throw new Error(`Invalid changed path: ${file}`);
    const rules = policy.pathRules.filter((rule) => rule.patterns.some((pattern) => matchesPattern(file, pattern)));
    const boundaries = [...new Set(rules.flatMap((rule) => rule.boundaries))].sort();
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
      for (const id of matching) focused.add(id);
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
  if (files.length === 0) blockers.push('No changed paths');
  const selectedTasks = [...chosen].sort();
  for (const id of selectedTasks) if (!registry[id]) throw new Error(`Selected task missing from registry: ${id}`);
  return { status: blockers.length ? 'requires-full' : 'selected', selectedTasks: blockers.length ? [] : selectedTasks, proposedTasks: selectedTasks, decisions, blockers };
}

function plan(options) {
  const tested = git(['rev-parse', 'HEAD']).trim();
  if (tested !== options.tested) throw new Error(`Checkout ${tested} differs from tested SHA ${options.tested}`);
  const parents = git(['rev-list', '--parents', '-n', '1', tested]).trim().split(' ');
  if (parents.length !== 3 || parents[1] !== options.base || parents[2] !== options.head) throw new Error('Tested commit must be the merge of the exact PR base and head');
  const policy = JSON.parse(git(['show', `${options.base}:release/maintenance-policy.json`]));
  const files = git(['diff', '--no-renames', '--name-only', '-z', options.base, tested], 'buffer').toString('utf8').split('\0').filter(Boolean);
  return {
    schemaVersion: 'pulse.fast-validation.v1',
    base: options.base,
    head: options.head,
    tested,
    policyVersion: policy.policyVersion,
    changedFiles: files.sort(),
    ...select(policy, files),
    exclusions: ['Full unit, native, JavaScript, conformance, CLI, provider, Node 22, release and docs profiles are not claimed by this selection.']
  };
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
  for (const decision of report.decisions) console.log(`${decision.file}: ${decision.rules.join(', ') || 'unknown'} -> ${decision.tasks.join(', ') || '(none)'}`);
  for (const blocker of report.blockers) console.log(`Requires full: ${blocker}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `status=${report.status}\n`);
  if (options.run) {
    const args = ['wasm/scripts/run-wasm-tests.cjs', ...report.selectedTasks.flatMap((id) => ['--task', id]), '--report', '.test-results/fast-portable.json'];
    const child = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    report.taskExitCode = child.status ?? 1;
    report.taskReport = 'wasm/.test-results/fast-portable.json';
    try {
      const taskReport = JSON.parse(fs.readFileSync(path.join(ROOT, report.taskReport), 'utf8'));
      const completed = taskReport.status === 'passed' && taskReport.finishedAt &&
        taskReport.completedTasks === report.selectedTasks.length &&
        JSON.stringify(taskReport.selectedTasks) === JSON.stringify(report.selectedTasks) &&
        taskReport.results.every((result) => result.status === 'passed') &&
        taskReport.sourceRevision === report.tested;
      report.coverageVerified = Boolean(completed);
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
      writeReport(options.report, { schemaVersion: 'pulse.fast-validation.v1', status: 'error', base: options.base, head: options.head, tested: options.tested, error: error.message });
    } catch (_) { /* malformed arguments or unsafe report path */ }
    process.exitCode = 1;
  }
}

module.exports = { select, plan };
