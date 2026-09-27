#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { expandProfile } = require('../wasm/test/suite/registry.cjs');

const ROOT = path.resolve(__dirname, '..');
const PROFILES = Object.freeze(['unit', 'native', 'javascript', 'conformance']);
const PREFIX = 'pulse-portable-shard';

function shardPlan(expand = expandProfile) {
  const conformance = expand('conformance');
  const rsa = ['jwt-rs256'];
  const schema = ['schema-codecs', 'schema-kv-parity'];
  for (const task of [...rsa, ...schema]) assert(conformance.includes(task), `Conformance anchor missing: ${task}`);
  const isolated = new Set([...rsa, ...schema]);
  const plan = {
    unit: expand('unit'),
    native: expand('native'),
    javascript: expand('javascript'),
    'conformance-rsa': rsa,
    'conformance-schema': schema,
    'conformance-rest': conformance.filter((task) => !isolated.has(task))
  };
  const actual = Object.values(plan).flat();
  const expected = PROFILES.flatMap((profile) => expand(profile));
  assert(Object.values(plan).every((tasks) => tasks.length > 0), 'Empty portable shard');
  assert.equal(new Set(actual).size, actual.length, 'Portable shards must not duplicate tasks');
  assert.deepEqual([...actual].sort(), [...expected].sort(), 'Portable shard union differs from registered profiles');
  return plan;
}

function identity(env = process.env) {
  assert(/^[0-9a-f]{40}$/.test(env.GITHUB_SHA || ''), 'GITHUB_SHA must identify the tested commit');
  assert(/^\d+$/.test(env.GITHUB_RUN_ID || ''), 'GITHUB_RUN_ID is required');
  assert(/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT || ''), 'GITHUB_RUN_ATTEMPT is required');
  return { testedSha: env.GITHUB_SHA, workflowRunId: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT) };
}

function validateWorkflow(source) {
  const jobs = [...source.matchAll(/^  ([a-z][a-z-]*):\s*$/gm)];
  const job = (name) => {
    const index = jobs.findIndex((match) => match[1] === name);
    assert(index >= 0, `Missing workflow job: ${name}`);
    return source.slice(jobs[index].index, jobs[index + 1]?.index || source.length);
  };
  const shards = job('portable-shards');
  const gate = job('portable');
  const matrix = shards.match(/^        shard: \[([^\]]+)\]$/m);
  assert(matrix, 'Missing portable shard matrix');
  assert.deepEqual(matrix[1].split(',').map((id) => id.trim()), Object.keys(shardPlan()), 'Workflow matrix differs from portable plan');
  assert(shards.includes('      fail-fast: false'), 'A failed shard must not cancel sibling evidence');
  assert(shards.includes('    needs: maintenance'), 'Validate the portable contract before running shards');
  assert(shards.includes('node scripts/maintainer-portable-validation.cjs run "$PORTABLE_SHARD"'), 'Workflow must run registered shards');
  assert(shards.includes('      - name: Upload portable failure evidence and success reports\n        if: always()'), 'Shard evidence must survive failures');
  assert(gate.includes('    name: portable\n    needs: portable-shards\n    if: always()'), 'Portable gate must evaluate failed, cancelled, or skipped shards');
  assert(gate.includes('PORTABLE_SHARDS_RESULT: ${{ needs.portable-shards.result }}'), 'Gate needs the shard job result');
  assert(gate.includes('node scripts/maintainer-portable-validation.cjs aggregate .portable-artifacts'), 'Missing portable coverage aggregate');
  assert(!/continue-on-error:/u.test(shards + gate), 'Portable failures must not be ignored');
  for (const block of [shards, gate]) assert(block.includes('ref: ${{ github.sha }}'), 'Portable jobs must pin the tested SHA');
}

function validateReport(report, expectedTasks, testedSha) {
  assert.equal(report.schemaVersion, 2, 'Unsupported runner report');
  assert.equal(report.sourceRevision, testedSha, 'Runner report has a different tested SHA');
  assert.equal(report.sourceIdentity?.sourceRevision, testedSha, 'Runner source identity differs');
  assert.equal(report.status, 'passed', 'Runner report is not passing');
  assert.equal(report.currentTask, null, 'Runner still has a current task');
  assert(Number.isFinite(Date.parse(report.startedAt)) && Number.isFinite(Date.parse(report.finishedAt)), 'Runner report is not terminal');
  assert(Date.parse(report.finishedAt) >= Date.parse(report.startedAt), 'Invalid runner interval');
  assert(Number.isFinite(report.durationMs) && report.durationMs >= 0, 'Invalid runner duration');
  assert.deepEqual(report.requestedTasks, expectedTasks, 'Requested task set differs');
  assert.deepEqual(report.selectedTasks, expectedTasks, 'Selected task set differs');
  assert.equal(report.completedTasks, expectedTasks.length, 'Incomplete task count');
  assert.deepEqual(report.results.map((result) => result.name), expectedTasks, 'Completed task set differs');
  for (const result of report.results) {
    assert.equal(result.status, 'passed', `Task did not pass: ${result.name}`);
    assert.equal(result.exitCode, 0, `Task exit was not zero: ${result.name}`);
  }
}

function aggregate(candidates, expected, jobsResult, plan = shardPlan()) {
  assert.equal(jobsResult, 'success', 'Portable shard jobs did not all succeed');
  const latest = new Map();
  const seen = new Set();
  for (const candidate of candidates) {
    const { metadata } = candidate;
    assert.equal(metadata.schemaVersion, 'pulse.portable-shard.v1', 'Invalid shard metadata');
    assert(Object.hasOwn(plan, metadata.shard), `Unexpected shard: ${metadata.shard}`);
    assert.equal(metadata.workflowRunId, expected.workflowRunId, 'Shard belongs to another workflow run');
    assert.equal(metadata.testedSha, expected.testedSha, 'Shard belongs to another tested SHA');
    assert(Number.isSafeInteger(metadata.attempt) && metadata.attempt > 0 && metadata.attempt <= expected.attempt, 'Invalid shard attempt');
    const key = `${metadata.shard}:${metadata.attempt}`;
    assert(!seen.has(key), `Duplicate shard attempt: ${key}`);
    seen.add(key);
    if (!latest.has(metadata.shard) || latest.get(metadata.shard).metadata.attempt < metadata.attempt) latest.set(metadata.shard, candidate);
  }
  const shards = [];
  for (const [name, tasks] of Object.entries(plan)) {
    const candidate = latest.get(name);
    assert(candidate, `Missing shard: ${name}`);
    assert.equal(candidate.metadata.exitCode, 0, `Shard did not exit successfully: ${name}`);
    assert.deepEqual(candidate.metadata.tasks, tasks, `Shard selection differs: ${name}`);
    validateReport(candidate.report, tasks, expected.testedSha);
    shards.push({ name, attempt: candidate.metadata.attempt, tasks, durationMs: candidate.report.durationMs, startedAt: candidate.report.startedAt, finishedAt: candidate.report.finishedAt });
  }
  return {
    schemaVersion: 'pulse.portable-aggregate.v1', status: 'passed', ...expected,
    profiles: PROFILES, completedTasks: shards.reduce((sum, shard) => sum + shard.tasks.length, 0),
    shards,
    taskWallTimeMs: Math.max(...shards.map((shard) => Date.parse(shard.finishedAt))) - Math.min(...shards.map((shard) => Date.parse(shard.startedAt)))
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

function runShard(shard, expected) {
  const tasks = shardPlan()[shard];
  assert(tasks, `Unknown shard: ${shard}`);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(revision, expected.testedSha, 'Checkout differs from tested SHA');
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--'], { cwd: ROOT, stdio: 'pipe' });
  const directory = path.join(ROOT, 'wasm', '.test-results', 'portable', shard);
  const metadata = { schemaVersion: 'pulse.portable-shard.v1', ...expected, shard, tasks, exitCode: null };
  writeJson(path.join(directory, 'identity.json'), metadata);
  const reportFile = path.join(directory, 'report.json');
  fs.rmSync(reportFile, { force: true });
  console.log(`Portable shard ${shard}; tested ${revision}; tasks ${tasks.join(', ')}`);
  const child = spawnSync(process.execPath, ['wasm/scripts/run-wasm-tests.cjs', ...tasks.flatMap((task) => ['--task', task]), '--report', reportFile], { cwd: ROOT, stdio: 'inherit' });
  metadata.exitCode = child.status ?? 1;
  if (child.error) metadata.error = child.error.message;
  try { validateReport(JSON.parse(fs.readFileSync(reportFile, 'utf8')), tasks, revision); }
  catch (error) { metadata.error = error.message; metadata.exitCode ||= 1; }
  writeJson(path.join(directory, 'identity.json'), metadata);
  process.exitCode = metadata.exitCode;
}

function aggregateArtifacts(directory, expected, jobsResult) {
  const output = path.join(ROOT, 'wasm', '.test-results', 'portable-aggregate.json');
  try {
    const candidates = fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
      assert(entry.isDirectory(), `Unexpected artifact entry: ${entry.name}`);
      const metadata = JSON.parse(fs.readFileSync(path.join(directory, entry.name, 'identity.json'), 'utf8'));
      assert.equal(entry.name, `${PREFIX}-${metadata.workflowRunId}-${metadata.attempt}-${metadata.shard}`, 'Artifact name differs from shard identity');
      // A failed attempt may have no runner report. Preserve its metadata so it
      // cannot silently fall back to an older passing attempt.
      const reportPath = path.join(directory, entry.name, 'report.json');
      return { metadata, report: fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null };
    });
    const result = aggregate(candidates, expected, jobsResult);
    writeJson(output, result);
    console.log(JSON.stringify(result, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Portable validation\n\nPassed ${result.completedTasks} tasks across ${result.shards.length} shards at \`${result.testedSha}\`.\n\n| Shard | Attempt | Tasks | Task time |\n| --- | ---: | ---: | ---: |\n${result.shards.map((shard) => `| ${shard.name} | ${shard.attempt} | ${shard.tasks.length} | ${(shard.durationMs / 1000).toFixed(2)} s |`).join('\n')}\n`);
  } catch (error) {
    writeJson(output, { schemaVersion: 'pulse.portable-aggregate.v1', status: 'failed', ...expected, error: error.message });
    throw error;
  }
}

function main() {
  const [command, argument, ...extra] = process.argv.slice(2);
  assert.equal(extra.length, 0, 'Unexpected portable validation arguments');
  if (command === 'plan' && !argument) { console.log(JSON.stringify(shardPlan(), null, 2)); return; }
  const expected = identity();
  if (command === 'run' && argument) runShard(argument, expected);
  else if (command === 'aggregate' && argument) aggregateArtifacts(path.resolve(argument), expected, process.env.PORTABLE_SHARDS_RESULT);
  else throw new Error('Usage: maintainer-portable-validation.cjs plan | run <shard> | aggregate <artifact-directory>');
}

module.exports = { PROFILES, shardPlan, validateWorkflow, validateReport, aggregate, aggregateArtifacts, identity };
if (require.main === module) {
  try { main(); }
  catch (error) { console.error(`Portable validation failed: ${error.message}`); process.exitCode = 1; }
}
