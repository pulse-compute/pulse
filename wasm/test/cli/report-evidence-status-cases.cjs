'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const f = require('./report-fixtures.cjs');

// Reusable against the source CLI or an isolated, installed candidate.
function runEvidenceStatusCases(cli, directory) {
  const { createCapsule, serializeCapsule } = require(path.join(cli, 'src/internal/report/capsule'));
  const { createCommandReporter } = require(path.join(cli, 'src/internal/command-reporter'));
  function run(command, args, status = 0) {
    const child = spawnSync(process.execPath, [path.join(cli, 'bin/pulse.js'), command, ...args, '--evidence-status'],
      { cwd: directory, encoding: 'utf8', timeout: 30000 });
    assert.ifError(child.error); assert.equal(child.status, status, child.stderr);
    const failure = status !== 0;
    assert.equal(failure ? child.stdout : child.stderr, '');
    const value = JSON.parse(failure ? child.stderr : child.stdout);
    assert.equal(value.kind, 'pulse.command-evidence'); assert.equal(value.presentationVersion, 1);
    assert.equal(value.exitCode, status); assert.equal(value.command, command);
    assert.equal(value.evidence.qualification, 'not-established-by-this-projection');
    return value;
  }
  function replay(value, name) {
    const capsule = createCapsule(value);
    fs.writeFileSync(path.join(directory, name), serializeCapsule(capsule));
    const output = run('report', ['--artifact', name]);
    assert.deepEqual(output.result, capsule);
    assert.deepEqual(output.evidence.identity.evidenceHash, capsule.evidenceHash);
    assert.equal(output.evidence.identity.buildEvidenceId, capsule.provenance.buildEvidenceId);
    assert.equal(output.evidence.identity.primaryArtifact.id, capsule.context.primaryArtifactId);
    return output;
  }
  const full = f.fixture(false);
  full.provenance.revision = 'a'.repeat(40); full.provenance.dirty = false; full.provenance.sourceFingerprint = 'b'.repeat(64);
  const complete = replay(full, 'status-complete.json');
  assert.equal(complete.outcome, 'completed');
  assert.equal(complete.evidence.state, 'historical-capsule');
  assert.equal(complete.evidence.snapshot, 'historical');
  assert.equal(complete.evidence.integrity, 'validated');
  assert.equal(complete.evidence.artifactBytes, 'not-checked');
  assert.deepEqual(complete.evidence.source.dirty, { state: 'available', value: false });
  assert.equal(complete.evidence.source.revision.value, full.provenance.revision);
  assert.equal(complete.evidence.source.sourceFingerprint.value, full.provenance.sourceFingerprint);
  for (const name of Object.keys(full.coverage)) assert.equal(complete.evidence.coverage.inventory[name].status, 'complete');
  assert.equal(complete.evidence.coverage.measurements.recorded, 0);

  const partial = f.fixture();
  partial.implementations = [];
  partial.coverage.implementations = { status: 'partial', observed: 0, expected: null, reason: 'incomplete-mapping' };
  partial.coverage.resources = { status: 'partial', observed: 1, expected: null, reason: 'upstream-partial' };
  const output = replay(partial, 'status-partial.json');
  assert.deepEqual(output.evidence.coverage.inventory.resources, partial.coverage.resources);
  assert.deepEqual(output.evidence.coverage.inventory.implementations, partial.coverage.implementations);
  assert.deepEqual(output.evidence.coverage.inventory.references,
    { status: 'unavailable', observed: null, expected: null, reason: 'not-recorded' });
  assert.equal(output.evidence.coverage.analytics.handlers.status, 'unavailable');
  assert.deepEqual(output.evidence.coverage.measurements,
    { recorded: 4, available: 3, exact: 2, bounded: 1, partial: 0, unavailable: 1, notApplicable: 0 });
  for (const field of Object.values(output.evidence.source)) assert.deepEqual(field, { state: 'unknown', value: null });

  for (const flag of ['--plan', '--dry-run']) {
    const planned = run('report', ['--artifact', 'absent-status.json', flag]);
    assert.equal(planned.outcome, 'planned'); assert.equal(planned.evidence.state, 'not-collected');
    assert.equal(planned.evidence.identity, null);
    assert.equal(planned.result.plan.collectOnExecution, true);
  }
  const completed = f.completed();
  for (const [name, bytes] of completed.files) fs.writeFileSync(path.join(directory, name), bytes);
  fs.writeFileSync(path.join(directory, 'report-completion.json'), completed.completionBytes);
  fs.writeFileSync(path.join(directory, 'status-manifest.json'), JSON.stringify(completed.manifest));
  const artifact = run('report', ['--artifact', 'status-manifest.json']);
  assert.equal(artifact.evidence.state, 'verified-completed-artifact');
  assert.equal(artifact.evidence.artifactBytes, 'verified');
  assert.equal(artifact.evidence.snapshot, 'current-project-unchecked');
  assert.deepEqual(artifact.evidence.coverage.missingOptionalSidecars, ['attribution']);
  fs.writeFileSync(path.join(directory, 'app.wasm'), Buffer.from('bad'));
  const invalidBytes = run('report', ['--artifact', 'status-manifest.json'], 3);
  assert.equal(invalidBytes.evidence.state, 'invalid');
  assert.equal(invalidBytes.evidence.identity, null);
  assert.equal(invalidBytes.result.error.code, 'PULSE_REPORT_INPUT_INVALID');

  const changed = { ...output.result, application: { name: 'tampered' } };
  fs.writeFileSync(path.join(directory, 'status-tampered.json'), JSON.stringify(changed));
  for (const [file, state, code] of [['absent-status.json', 'missing', 'PULSE_REPORT_EVIDENCE_MISSING'],
    ['status-tampered.json', 'invalid', 'PULSE_REPORT_INPUT_INVALID']]) {
    const failure = run('report', ['--artifact', file], 3);
    assert.equal(failure.outcome, 'failed'); assert.equal(failure.evidence.state, state);
    assert.equal(failure.result.error.code, code); assert.equal(failure.result.error.scope, 'public');
    assert(failure.result.error.docs.includes('#pulse-report-'));
    assert.equal(failure.evidence.identity, null);
  }
  const usage = run('report', ['--artifact', 'status-complete.json', '--html'], 2);
  assert.equal(usage.result.error.code, 'PULSE_ARGUMENT_UNEXPECTED');
  assert.equal(usage.evidence.state, 'not-collected');
  run('dev', [], 2); // NDJSON dev contract is intentionally unchanged.
  const inspected = run('inspect', ['--artifact', 'status-tampered.json']);
  assert.equal(inspected.evidence.state, 'not-collected'); // JSON parsing is not report admission.
  const init = run('init', ['status-new-app', '--plan']);
  assert.equal(init.outcome, 'planned'); assert(!fs.existsSync(path.join(directory, 'status-new-app')));

  // Preserve report-owner diagnostic classification through the presentation.
  for (const [code, state] of [['REPORT_STALE_INPUTS', 'stale'], ['REPORT_INPUT_VERSION', 'incompatible']]) {
    let stderr = '';
    const error = require(path.join(cli, 'src/internal/report/command')).publicReportError({ code });
    const summary = require(path.join(cli, 'src/internal/execution-error')).errorSummary(error);
    const reporter = createCommandReporter({ stdout: { write: () => assert.fail('failure must use stderr') },
      stderr: { write: text => { stderr += text; } } });
    reporter.reportDiagnostic(summary, { request: { command: 'report', evidenceStatus: true }, exitCode: 3 });
    const failed = JSON.parse(stderr);
    assert.equal(failed.evidence.state, state); assert.equal(failed.evidence.identity, null);
    assert.deepEqual(failed.result.error, JSON.parse(JSON.stringify(summary))); assert.equal(failed.exitCode, 3);
  }

  // Completed audits/tests fail on stdout, unlike thrown diagnostic failures.
  for (const command of ['doctor', 'test', 'compile', 'build', 'inspect', 'init']) {
    let stdout = '', stderr = '';
    const reporter = createCommandReporter({ stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } });
    const failed = ['doctor', 'test'].includes(command);
    const result = { status: failed ? 'failed' : 'ok', reportCompletion: { claimed: true } };
    reporter.reportExecution({ command, evidenceStatus: true }, { mode: 'project' }, { status: failed ? 1 : 0, result });
    const projected = JSON.parse(stdout);
    assert.equal(stderr, ''); assert.equal(projected.exitCode, failed ? 1 : 0);
    assert.equal(projected.outcome, failed ? 'failed' : 'completed');
    assert.deepEqual(projected.result, result); assert.equal(projected.evidence.state, 'not-collected');
  }
}
module.exports = { runEvidenceStatusCases };
