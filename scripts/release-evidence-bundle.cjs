#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { expandProfile } = require('../wasm/test/suite/registry.cjs');
const { MAINTENANCE_POLICY } = require('./maintenance-policy.cjs');
const { reportForInputs, renderMarkdown } = require('./maintainer-scope.cjs');

const EVIDENCE_BUNDLE_VERSION = 'pulse.release-evidence-bundle.v1';
const AGGREGATE_VERSION = 'pulse.release-evidence-aggregate.v1';
const REPLAY_VERSION = 'pulse.binary-patch-replay.v1';
const TARGET_INTEGRITY_VERSION = 'pulse.target-integrity-report.v1';
const MIGRATION_LEDGER_VERSION = 'pulse.migration-ledger.v1';
const repoRoot = path.resolve(__dirname, '..');

const SHARD_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'historical-contracts',
    title: 'Historical contracts',
    tasks: Object.freeze([
      'suite-shape',
      'test-orchestration',
      'package-exports',
      'boundaries',
      'workspace-hygiene',
      'hidden-contracts',
      'api-surface',
      'kv-design-contract',
      'kv-native-abi-feasibility',
      'reachable-graph',
      'project-modules',
      'entities-contracts',
      'entities-json-rpc-corpus'
    ])
  }),
  Object.freeze({
    id: 'packaging-target-descriptors',
    title: 'Packaging and target descriptors',
    tasks: Object.freeze([
      'package-exports',
      'workspace-hygiene',
      'target-support',
      'provider-toolchain',
      'provider-packages',
      'provider-fastly-package',
      'fastly-javascript-packaging'
    ])
  }),
  Object.freeze({
    id: 'runtime',
    title: 'Runtime',
    tasks: Object.freeze([
      'logging-contract',
      'continuation-registry',
      'crypto-runtime-builtin',
      'bounded-app-logic',
      'bounded-read-loops',
      'time-conformance',
      'time-consumer',
      'request-budget-transport',
      'http-input-outcomes',
      'application-errors',
      'application-error-boundaries',
      'entities-javascript-runtime',
      'events-conformance',
      'canonical-api-runtime',
      'logging-runtime',
      'fastly-javascript-runtime'
    ])
  }),
  Object.freeze({
    id: 'lowering',
    title: 'Lowering',
    tasks: Object.freeze([
      'canonical-api-lowering',
      'canonical-native-plan',
      'multifile-source-identity',
      'logging-lowering',
      'canonical-router-lowering',
      'canonical-router-terminal-middleware',
      'json-as-compatibility',
      'crypto-config-planning',
      'entities-package-owned-lowering',
      'entities-envelope-feasibility',
      'entities-managed-handler',
      'entities-managed-handler-effects',
      'entities-native-runtime',
      'crypto-native-guest-source',
      'guest-link-package',
      'guest-link-materialization-stage',
      'guest-link-audit-diagnostics',
      'jwt-package-owned-lowering',
      'jwt-javascript-admission',
      'canonical-native-wasm'
    ])
  }),
  Object.freeze({
    id: 'node-providers',
    title: 'Node providers',
    tasks: Object.freeze([
      'canonical-opaque-node-emission',
      'javascript-effect-adapter',
      's3-node-transport',
      'node-router-context-parity',
      'node-cross-target-conformance'
    ])
  }),
  Object.freeze({
    id: 'fastly-native-provider',
    title: 'Fastly Native provider',
    tasks: Object.freeze([
      'provider-fastly-package',
      'provider-fastly-apps',
      'canonical-grip-fastly',
      'fastly-cli-gate-surface',
      'fastly-native-http-shell',
      'fastly-native-http-effects',
      'fastly-request-headers',
      'fastly-native-platform-capabilities',
      'fastly-conditional-kv',
      'kv-conditional-adversarial'
    ])
  }),
  Object.freeze({
    id: 'fastly-javascript-provider',
    title: 'Fastly JavaScript provider',
    tasks: Object.freeze([
      'fastly-javascript-packaging',
      'fastly-javascript-runtime',
      'fastly-javascript-tooling'
    ])
  }),
  Object.freeze({
    id: 'package-effects',
    title: 'Package effects',
    tasks: Object.freeze([
      'package-reachability',
      'crypto-digest-text-contract',
      'crypto-digest-text-conformance',
      'crypto-digest-storage-conformance',
      's3-design-contract',
      's3-read-contract',
      's3-write-contract',
      's3-native-read',
      's3-write-conformance',
      'jwt-signing',
      'jwt-es256-signing',
      'crypto-es256-signing',
      'crypto-rs256',
      'jwt-rs256',
      'assets-lowering-plan',
      'assets-package-owned-lowering',
      'grip-package-owned-lowering',
      'grip-package-runtime',
      'package-root-native',
      'assets-javascript-runtime',
      'entities-catalog',
      'entities-inspection',
      'entities-orchestration-demo',
      'grip-cross-target-conformance'
    ])
  }),
  Object.freeze({
    id: 'schema-codec-conformance',
    title: 'Schema and codec conformance',
    tasks: Object.freeze([
      'schema-registry',
      'schema-kv-parity',
      'text-capacity-conformance',
      'entities-schema-bridge',
      'fetch-projections-request-bodies',
      'config-secrets-kv-redaction',
      'kv-conditional-runtime',
      'kv-conditional-gates',
      'kv-conditional-conformance',
      'schema-codecs'
    ])
  }),
  Object.freeze({
    id: 'four-mode-semantic-corpus',
    title: 'Four-mode semantic corpus',
    tasks: Object.freeze(['crypto-cross-target-conformance', 'catalog-router-parity', 'four-mode-conformance']),
    artifact: 'fourMode'
  }),
  Object.freeze({
    id: 'cli-documentation',
    title: 'CLI and documentation',
    taskPrefix: Object.freeze(['cli-', 'docs-', 'events-cli-'])
  }),
  Object.freeze({
    id: 'package-packing',
    title: 'Package packing',
    tasks: Object.freeze(['release-packages'])
  }),
  Object.freeze({
    id: 'clean-machine-consumers',
    title: 'Clean-machine consumers',
    tasks: Object.freeze(['clean-machine-acceptance'])
  }),
  Object.freeze({
    id: 'deployment-candidates',
    title: 'Deployment candidates',
    tasks: Object.freeze(['deployment-candidates']),
    artifact: 'candidates'
  }),
  Object.freeze({
    id: 'artifact-verification',
    title: 'Artifact verification',
    tasks: Object.freeze(['release-artifact-determinism', 'release-evidence-authority']),
    artifact: 'replay'
  }),
  Object.freeze({
    id: 'maintainer-publication-controls',
    title: 'Maintainer and publication control planes',
    tasks: Object.freeze(['release-runtime-policy', 'release-tag']),
    releaseSteps: Object.freeze(['maintainer', 'publication', 'build', 'workspace-unit', 'documentation', 'release'])
  })
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, file);
}

function atomicJson(file, value) {
  atomicWrite(file, stableJson(value));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    fail('PULSE_RELEASE_EVIDENCE_READ_FAILED', `Cannot read JSON evidence ${file}: ${error.message}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: options.encoding === null ? null : 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs || 10 * 60 * 1000,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    const stdout = result.stdout ? String(result.stdout) : '';
    const stderr = result.stderr ? String(result.stderr) : '';
    const detail = [stdout, stderr].filter(Boolean).join('\n').trim();
    fail(
      options.code || 'PULSE_RELEASE_EVIDENCE_COMMAND_FAILED',
      `${options.description || [command, ...args].join(' ')} failed${detail ? `:\n${detail}` : ''}`
    );
  }
  return result;
}

function gitRevision(reference) {
  const result = run('git', ['rev-parse', `${reference}^{commit}`], {
    description: `Resolve Git revision ${reference}`
  });
  const revision = String(result.stdout || '').trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    fail('PULSE_RELEASE_EVIDENCE_REVISION_INVALID', `Invalid Git revision for ${reference}: ${revision}`);
  }
  return revision;
}

function parseArgs(argv) {
  const options = {
    head: 'HEAD',
    label: 'release',
    releaseSeal: path.join(repoRoot, 'wasm', '.test-results', 'release-seal.json'),
    taskReport: path.join(repoRoot, 'wasm', '.test-results', 'release-tasks.json'),
    fourMode: path.join(repoRoot, 'wasm', '.test-results', 'four-mode-conformance.json'),
    candidateReport: path.join(repoRoot, 'wasm', '.test-results', 'deployment-candidates.json'),
    candidates: path.join(repoRoot, 'wasm', '.test-results', 'deployment-candidates')
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const take = (name) => {
      const value = argv[++index];
      if (!value || value.startsWith('-')) fail('PULSE_RELEASE_EVIDENCE_ARGUMENT', `${name} requires a value`);
      return value;
    };
    if (token === '--base') options.base = take(token);
    else if (token.startsWith('--base=')) options.base = token.slice(7);
    else if (token === '--head') options.head = take(token);
    else if (token.startsWith('--head=')) options.head = token.slice(7);
    else if (token === '--label') options.label = take(token);
    else if (token.startsWith('--label=')) options.label = token.slice(8);
    else if (token === '--out') options.outDir = path.resolve(take(token));
    else if (token.startsWith('--out=')) options.outDir = path.resolve(token.slice(6));
    else if (token === '--release-seal') options.releaseSeal = path.resolve(take(token));
    else if (token.startsWith('--release-seal=')) options.releaseSeal = path.resolve(token.slice(15));
    else if (token === '--task-report') options.taskReport = path.resolve(take(token));
    else if (token.startsWith('--task-report=')) options.taskReport = path.resolve(token.slice(14));
    else if (token === '--four-mode') options.fourMode = path.resolve(take(token));
    else if (token.startsWith('--four-mode=')) options.fourMode = path.resolve(token.slice(12));
    else if (token === '--candidate-report') options.candidateReport = path.resolve(take(token));
    else if (token.startsWith('--candidate-report=')) options.candidateReport = path.resolve(token.slice(19));
    else if (token === '--candidates') options.candidates = path.resolve(take(token));
    else if (token.startsWith('--candidates=')) options.candidates = path.resolve(token.slice(13));
    else if (token === '--help' || token === '-h') options.help = true;
    else fail('PULSE_RELEASE_EVIDENCE_ARGUMENT', `Unknown release-evidence option: ${token}`);
  }
  if (!options.help && !options.base) fail('PULSE_RELEASE_EVIDENCE_ARGUMENT', '--base is required');
  if (!options.help && !options.outDir) fail('PULSE_RELEASE_EVIDENCE_ARGUMENT', '--out is required');
  const label = String(options.label || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(label)) {
    fail('PULSE_RELEASE_EVIDENCE_ARGUMENT', `Invalid evidence label: ${label}`);
  }
  options.label = label.toLowerCase();
  return Object.freeze(options);
}

function usage() {
  return [
    'Usage: node scripts/release-evidence-bundle.cjs --base <ref> --out <directory> [options]',
    '',
    'Options:',
    '  --head <ref>              sealed source revision (default: HEAD)',
    '  --label <name>            artifact filename label',
    '  --release-seal <file>     release control-plane report',
    '  --task-report <file>      release task report',
    '  --four-mode <file>        four-mode conformance report',
    '  --candidate-report <file> offline candidate report',
    '  --candidates <directory>  offline candidate directory',
    '  --out <directory>         new evidence output directory',
    '  -h, --help                show this help',
    '',
    'The authority packages existing passing evidence. It never deploys or publishes.'
  ].join('\n');
}

function assertRevision(value, expected, label) {
  if (value !== expected) {
    fail(
      'PULSE_RELEASE_EVIDENCE_REVISION_MISMATCH',
      `${label} belongs to ${String(value)}, expected ${expected}.`
    );
  }
}

function artifactStatus(name, artifacts) {
  if (name === 'fourMode') {
    const report = artifacts.fourMode;
    return report && report.status === 'passed' && report.proof && report.proof.summary.mismatches === 0
      ? 'passed'
      : 'failed';
  }
  if (name === 'candidates') {
    const report = artifacts.candidates;
    return report && report.status === 'passed'
      && report.summary.total === 2
      && report.summary.providerRealityValidated === 0
      && report.summary.deployed === 0
      && report.summary.published === 0
      ? 'passed'
      : 'failed';
  }
  if (name === 'replay') return artifacts.replay && artifacts.replay.status === 'passed' ? 'passed' : 'failed';
  return 'failed';
}

// This checks the plan only. Passing coverage is never execution evidence.
function validateShardCoverage(expectedTasks = expandProfile('release'), definitions = SHARD_DEFINITIONS) {
  const known = new Set(expectedTasks);
  const ids = new Set();
  const shards = definitions.map((definition) => {
    if (!definition.id || ids.has(definition.id)) {
      fail('PULSE_RELEASE_EVIDENCE_SHARD_INVALID', `Duplicate or missing release shard ID: ${definition.id}`);
    }
    ids.add(definition.id);
    const tasks = definition.taskPrefix
      ? expectedTasks.filter((name) => definition.taskPrefix.some((prefix) => name.startsWith(prefix)))
      : [...(definition.tasks || [])];
    const unknown = tasks.filter((name) => !known.has(name));
    if (unknown.length) {
      fail('PULSE_RELEASE_EVIDENCE_TASK_UNKNOWN', `Shard ${definition.id} references tasks outside the release profile: ${unknown.join(', ')}`);
    }
    if (!tasks.length || new Set(tasks).size !== tasks.length) {
      fail('PULSE_RELEASE_EVIDENCE_SHARD_INVALID', `Shard ${definition.id} has empty or duplicate task coverage`);
    }
    return Object.freeze({ ...definition, tasks: Object.freeze(tasks) });
  });
  const covered = new Set(shards.flatMap((shard) => shard.tasks));
  const missing = expectedTasks.filter((name) => !covered.has(name));
  if (missing.length) {
    fail('PULSE_RELEASE_EVIDENCE_TASK_UNMAPPED', `Release tasks are not mapped to a shard: ${missing.join(', ')}`);
  }
  if (shards.length !== 16) {
    fail('PULSE_RELEASE_EVIDENCE_SHARD_INVALID', `Expected 16 release evidence shards, found ${shards.length}`);
  }
  return Object.freeze(shards);
}

function aggregateValidation(input) {
  const {
    sourceRevision,
    releaseSeal,
    taskReport,
    fourMode,
    candidates,
    replay
  } = input;
  assertRevision(releaseSeal.sourceRevision, sourceRevision, 'Release seal');
  assertRevision(taskReport.sourceRevision, sourceRevision, 'Release task report');
  assertRevision(fourMode.sourceRevision, sourceRevision, 'Four-mode report');
  assertRevision(candidates.sourceRevision, sourceRevision, 'Candidate report');
  if (releaseSeal.status !== 'passed') fail('PULSE_RELEASE_EVIDENCE_RELEASE_FAILED', 'Release seal did not pass.');
  if (taskReport.status !== 'passed') fail('PULSE_RELEASE_EVIDENCE_TASKS_FAILED', 'Release task report did not pass.');

  const expectedTasks = expandProfile('release');
  assert.deepEqual(taskReport.requestedTasks, expectedTasks, 'Release task request does not match the current release profile');
  assert.deepEqual(taskReport.selectedTasks, expectedTasks, 'Release task selection does not match the current release profile');
  if (taskReport.completedTasks !== expectedTasks.length || taskReport.results.length !== expectedTasks.length) {
    fail('PULSE_RELEASE_EVIDENCE_TASKS_INCOMPLETE', 'Release task report is incomplete.');
  }
  const resultByName = new Map(taskReport.results.map((entry) => [entry.name, entry]));
  for (const task of expectedTasks) {
    const result = resultByName.get(task);
    if (!result || result.status !== 'passed') {
      fail('PULSE_RELEASE_EVIDENCE_TASK_FAILED', `Release task is not passing: ${task}`);
    }
  }
  const stepById = new Map(releaseSeal.steps.map((entry) => [entry.id, entry]));
  const artifacts = { fourMode, candidates, replay };
  const shards = validateShardCoverage(expectedTasks).map((definition) => {
    const taskNames = definition.tasks;
    const taskResults = taskNames.map((name) => {
      const result = resultByName.get(name);
      return Object.freeze({
        name,
        status: result && result.status || 'missing',
        evidence: result && result.evidence || null,
        durationMs: result && result.durationMs || null
      });
    });
    const releaseSteps = (definition.releaseSteps || []).map((id) => {
      const step = stepById.get(id);
      return Object.freeze({ id, status: step && step.status || 'missing' });
    });
    const evidenceStatus = definition.artifact ? artifactStatus(definition.artifact, artifacts) : 'passed';
    const status = taskResults.every((entry) => entry.status === 'passed')
      && releaseSteps.every((entry) => entry.status === 'passed')
      && evidenceStatus === 'passed'
      ? 'passed'
      : 'failed';
    return Object.freeze({
      id: definition.id,
      title: definition.title,
      status,
      tasks: Object.freeze(taskResults),
      releaseSteps: Object.freeze(releaseSteps),
      artifact: definition.artifact
        ? Object.freeze({ id: definition.artifact, status: evidenceStatus })
        : null
    });
  });
  if (shards.length !== 16 || shards.some((entry) => entry.status !== 'passed')) {
    fail('PULSE_RELEASE_EVIDENCE_SHARD_FAILED', 'One or more release evidence shards did not pass.');
  }
  return Object.freeze({
    schemaVersion: AGGREGATE_VERSION,
    sourceRevision,
    status: 'passed',
    generatedAt: new Date().toISOString(),
    shards: Object.freeze(shards),
    summary: Object.freeze({
      shards: shards.length,
      passed: shards.filter((entry) => entry.status === 'passed').length,
      failed: shards.filter((entry) => entry.status !== 'passed').length,
      releaseTasks: expectedTasks.length,
      releaseTasksPassed: expectedTasks.length,
      providerReality: releaseSeal.externalFastly && releaseSeal.externalFastly.status || 'not-inspected',
      deploymentPerformed: false,
      publicationPerformed: false
    })
  });
}

function treeSnapshot(root) {
  const entries = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      const relative = slash(path.relative(root, file));
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) visit(file);
      else if (stat.isSymbolicLink()) {
        entries.push(Object.freeze({
          file: relative,
          mode: '120000',
          sha256: sha256(Buffer.from(fs.readlinkSync(file)))
        }));
      } else if (stat.isFile()) {
        entries.push(Object.freeze({
          file: relative,
          mode: stat.mode & 0o111 ? '100755' : '100644',
          bytes: stat.size,
          sha256: sha256File(file)
        }));
      } else {
        fail('PULSE_RELEASE_EVIDENCE_SPECIAL_FILE', `Unsupported source entry: ${file}`);
      }
    }
  }
  visit(root);
  return Object.freeze(entries);
}

function writePatchReplay(baseRevision, headRevision, patchFile, reportFile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-replay-'));
  const baseRoot = path.join(root, 'base');
  const headRoot = path.join(root, 'head');
  const baseArchive = path.join(root, 'base.tar');
  const headArchive = path.join(root, 'head.tar');
  fs.mkdirSync(baseRoot);
  fs.mkdirSync(headRoot);
  try {
    run('git', ['archive', '--format=tar', '--output', baseArchive, baseRevision], {
      description: 'Archive patch replay base'
    });
    run('git', ['archive', '--format=tar', '--output', headArchive, headRevision], {
      description: 'Archive patch replay head'
    });
    run('tar', ['-xf', baseArchive, '-C', baseRoot], { description: 'Extract patch replay base' });
    run('tar', ['-xf', headArchive, '-C', headRoot], { description: 'Extract patch replay head' });
    run('git', ['apply', '--binary', '--check', patchFile], {
      cwd: baseRoot,
      description: 'Check exact binary patch replay'
    });
    run('git', ['apply', '--binary', '--whitespace=nowarn', patchFile], {
      cwd: baseRoot,
      description: 'Apply exact binary patch replay'
    });
    const applied = treeSnapshot(baseRoot);
    const expected = treeSnapshot(headRoot);
    assert.deepEqual(applied, expected, 'Binary patch replay tree must exactly match the sealed head tree');
    const report = Object.freeze({
      schemaVersion: REPLAY_VERSION,
      status: 'passed',
      baseRevision,
      headRevision,
      patch: Object.freeze({
        file: path.basename(patchFile),
        bytes: fs.statSync(patchFile).size,
        sha256: sha256File(patchFile)
      }),
      files: expected.length,
      treeSha256: sha256(JSON.stringify(expected)),
      comparison: 'file-path-mode-bytes'
    });
    atomicJson(reportFile, report);
    return report;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function migrationLedger(baseRevision, headRevision) {
  const result = run('git', [
    'diff',
    '--name-status',
    '--find-renames',
    '-z',
    baseRevision,
    headRevision
  ], { encoding: null, description: 'Build migration ledger' });
  const fields = result.stdout.toString('utf8').split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (/^[RC]/.test(status)) {
      entries.push(Object.freeze({ status, from: slash(fields[index++]), file: slash(fields[index++]) }));
    } else {
      entries.push(Object.freeze({ status, file: slash(fields[index++]) }));
    }
  }
  return Object.freeze({
    schemaVersion: MIGRATION_LEDGER_VERSION,
    baseRevision,
    headRevision,
    entries: Object.freeze(entries),
    summary: Object.freeze({
      total: entries.length,
      added: entries.filter((entry) => entry.status === 'A').length,
      modified: entries.filter((entry) => entry.status === 'M').length,
      deleted: entries.filter((entry) => entry.status === 'D').length,
      renamed: entries.filter((entry) => entry.status.startsWith('R')).length
    })
  });
}

function scopeReport(ledger, baseRevision, headRevision) {
  const files = [...new Set(ledger.entries.map((entry) => entry.file))].sort();
  const advisory = reportForInputs({
    base: baseRevision,
    head: headRevision,
    body: '',
    files
  }, { allowMissingDeclaration: true });
  const boundaries = advisory.inferred.protectedBoundaries;
  const body = [
    MAINTENANCE_POLICY.pullRequestDeclaration.startMarker,
    'Change class: release',
    'Scope: release-change',
    `Protected boundaries: ${boundaries.length ? boundaries.join(', ') : 'none'}`,
    'Human decision: required',
    MAINTENANCE_POLICY.pullRequestDeclaration.endMarker
  ].join('\n');
  const report = reportForInputs({
    base: baseRevision,
    head: headRevision,
    body,
    files
  }, {});
  if (report.status === 'fail') {
    fail('PULSE_RELEASE_EVIDENCE_SCOPE_FAILED', `Maintainer scope report failed: ${report.consistency.errors.join('; ')}`);
  }
  return report;
}

function targetIntegrityReport(headRevision, fourMode, candidates) {
  // Provider realization needs installed workspace links; shard preflight does not.
  const {
    FASTLY_JAVASCRIPT_TARGET_SUPPORT_DECLARATION
  } = require('../packages/provider-fastly/src/javascript/support.js');

  const availability = FASTLY_JAVASCRIPT_TARGET_SUPPORT_DECLARATION.availability;
  if (availability.definition !== 'full-target-support'
      || !availability.fullTargetSupportReady
      || !availability.generalAvailable) {
    fail('PULSE_RELEASE_EVIDENCE_TARGET_UNSEALED', 'Fastly JavaScript full-target-support availability is not sealed.');
  }
  const integrity = fourMode.proof.targetIntegrity;
  for (const field of [
    'configuredTargetMatchesArtifact',
    'inspectMatchesExecution',
    'unavailableBehaviorFailsBeforeDeployment'
  ]) {
    if (integrity[field] !== true) fail('PULSE_RELEASE_EVIDENCE_TARGET_INTEGRITY', `Target integrity field is not true: ${field}`);
  }
  if (integrity.automaticFallback !== false
      || integrity.javascriptContainsNativeArtifact !== false
      || integrity.nativeMasqueradesAsJavascript !== false) {
    fail('PULSE_RELEASE_EVIDENCE_TARGET_INTEGRITY', 'Target substitution or fallback evidence is invalid.');
  }
  return Object.freeze({
    schemaVersion: TARGET_INTEGRITY_VERSION,
    sourceRevision: headRevision,
    status: 'passed',
    availability,
    fourMode: Object.freeze({
      proofSha256: fourMode.proof.proofSha256,
      summary: fourMode.proof.summary,
      targetIntegrity: integrity
    }),
    candidates: Object.freeze(candidates.candidates.map((entry) => Object.freeze({
      provider: entry.provider,
      target: entry.target,
      targetId: entry.targetId,
      status: entry.status,
      inputClosureSha256: entry.inputClosureSha256,
      runtimeArtifact: entry.runtimeArtifact,
      automaticFallback: false,
      providerRealityValidated: false,
      deploymentPerformed: false,
      publicationPerformed: false
    }))),
    boundary: Object.freeze({
      providerReality: candidates.policy.providerRealityInvoked ? 'performed' : 'not-performed',
      deployment: candidates.policy.deploymentPerformed ? 'performed' : 'not-performed',
      publication: candidates.policy.publicationPerformed ? 'performed' : 'not-performed'
    })
  });
}

function verifyCandidateDirectory(root, report, headRevision) {
  const resolved = path.resolve(root);
  const embeddedReport = readJson(path.join(resolved, 'candidate-report.json'));
  assert.deepEqual(embeddedReport, report, 'Candidate directory report must match the revision-bound report');
  const expectedEntries = [
    'candidate-report.json',
    ...report.candidates.map((entry) => entry.directory)
  ].sort();
  const actualEntries = fs.readdirSync(resolved).sort();
  assert.deepEqual(actualEntries, expectedEntries, 'Candidate directory contains an unexpected top-level entry');

  for (const candidate of report.candidates) {
    if (path.basename(candidate.directory) !== candidate.directory) {
      fail('PULSE_RELEASE_EVIDENCE_CANDIDATE_PATH', `Unsafe candidate directory: ${candidate.directory}`);
    }
    const candidateRoot = path.join(resolved, candidate.directory);
    const actualFiles = treeSnapshot(candidateRoot).map((entry) => Object.freeze({
      file: entry.file,
      bytes: entry.bytes,
      sha256: entry.sha256
    }));
    assert.deepEqual(actualFiles, candidate.files, `${candidate.target} candidate files do not match their report`);
    const runtimeFile = candidate.files.find((entry) => entry.file === candidate.runtimeArtifact.file);
    assert.ok(runtimeFile, `${candidate.target} candidate report is missing its runtime artifact`);
    assert.equal(runtimeFile.bytes, candidate.runtimeArtifact.bytes);
    assert.equal(runtimeFile.sha256, candidate.runtimeArtifact.sha256);
    const manifest = readJson(path.join(candidateRoot, 'pulse-offline-candidate.json'));
    assertRevision(manifest.sourceRevision, headRevision, `${candidate.target} candidate`);
    assert.equal(manifest.provider, candidate.provider);
    assert.equal(manifest.target, candidate.target);
    assert.equal(manifest.targetId, candidate.targetId);
    assert.deepEqual(manifest.runtimeArtifact, candidate.runtimeArtifact);
    assert.equal(manifest.providerRealityValidated, false);
    assert.equal(manifest.deploymentPerformed, false);
    assert.equal(manifest.publicationPerformed, false);
  }
}

function checksumLines(root) {
  return treeSnapshot(root)
    .filter((entry) => entry.mode !== '120000' && entry.file !== 'SHA256SUMS')
    .map((entry) => `${entry.sha256}  ${entry.file}`)
    .join('\n') + '\n';
}

function finalSealMarkdown(input) {
  const { label, baseRevision, headRevision, aggregate, replay, candidates, scope } = input;
  const javascript = candidates.candidates.find((entry) => entry.target === 'javascript');
  const native = candidates.candidates.find((entry) => entry.target === 'native');
  return [
    `# Pulse ${label} offline release seal`,
    '',
    `Source range: \`${baseRevision}\` → \`${headRevision}\``,
    '',
    '## Outcome',
    '',
    `- Aggregate validation: ${aggregate.summary.passed}/${aggregate.summary.shards} shards passed.`,
    `- Release tasks: ${aggregate.summary.releaseTasksPassed}/${aggregate.summary.releaseTasks} passed.`,
    `- Exact binary patch replay: passed across ${replay.files} source files.`,
    '- Fastly JavaScript full-target-support availability: sealed.',
    `- Fastly Native candidate: \`${native.runtimeArtifact.sha256}\`.`,
    `- Fastly JavaScript runtime candidate: \`${javascript.runtimeArtifact.sha256}\`.`,
    `- External Fastly provider reality: \`${aggregate.summary.providerReality}\`.`,
    '- Deployment performed: no.',
    '- Publication performed: no.',
    '',
    'The Fastly JavaScript source closure and deployment metadata are byte-deterministic.',
    'The pinned downstream JavaScript runtime compiler was executed successfully; its',
    'Wizer-produced runtime bytes are bound to this delivery by SHA-256 and are not',
    'claimed byte-reproducible. The Fastly Native runtime artifact is byte-identical',
    'across two clean builds.',
    '',
    '## Authority',
    '',
    `Maintainer scope status: \`${scope.status}\`. Human release authority remains required`,
    'for any merge, tag, deployment, or publication.',
    ''
  ].join('\n');
}

function assertNewOutput(output) {
  const resolved = path.resolve(output);
  if (resolved === path.parse(resolved).root || resolved === repoRoot) {
    fail('PULSE_RELEASE_EVIDENCE_OUTPUT_UNSAFE', `Unsafe evidence output directory: ${resolved}`);
  }
  for (const target of [resolved, `${resolved}.zip`, `${resolved}.zip.sha256`]) {
    if (fs.existsSync(target)) {
      fail('PULSE_RELEASE_EVIDENCE_OUTPUT_EXISTS', `Evidence output already exists: ${target}`);
    }
  }
}

function createEvidenceBundle(options) {
  const baseRevision = gitRevision(options.base);
  const headRevision = gitRevision(options.head);
  const currentRevision = gitRevision('HEAD');
  if (currentRevision !== headRevision) {
    fail('PULSE_RELEASE_EVIDENCE_HEAD_NOT_CHECKED_OUT', 'The sealed head revision must be checked out.');
  }
  run('git', ['merge-base', '--is-ancestor', baseRevision, headRevision], {
    description: 'Verify evidence base ancestry'
  });
  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    description: 'Verify clean evidence source tree'
  });
  if (String(status.stdout || '').trim()) {
    fail('PULSE_RELEASE_EVIDENCE_DIRTY', 'The release evidence authority requires a clean source tree.');
  }

  const releaseSeal = readJson(options.releaseSeal);
  const taskReport = readJson(options.taskReport);
  const fourMode = readJson(options.fourMode);
  const candidates = readJson(options.candidateReport);
  for (const [name, report] of Object.entries({ releaseSeal, taskReport, fourMode, candidates })) {
    assertRevision(report.sourceRevision, headRevision, name);
  }
  if (!fs.existsSync(options.candidates) || !fs.statSync(options.candidates).isDirectory()) {
    fail('PULSE_RELEASE_EVIDENCE_CANDIDATES_MISSING', `Candidate directory is missing: ${options.candidates}`);
  }
  verifyCandidateDirectory(options.candidates, candidates, headRevision);

  const output = path.resolve(options.outDir);
  assertNewOutput(output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const staging = path.join(path.dirname(output), `.${path.basename(output)}.tmp-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const shortHead = headRevision.slice(0, 12);
  const shortBase = baseRevision.slice(0, 12);
  let outputCommitted = false;
  try {
    const evidenceRoot = path.join(staging, 'evidence');
    const candidateRoot = path.join(staging, 'candidates');
    fs.mkdirSync(evidenceRoot, { recursive: true });
    fs.cpSync(options.candidates, candidateRoot, { recursive: true });
    for (const [name, file] of Object.entries({
      'release-seal.json': options.releaseSeal,
      'release-tasks.json': options.taskReport,
      'four-mode-conformance.json': options.fourMode,
      'deployment-candidates.json': options.candidateReport
    })) {
      fs.copyFileSync(file, path.join(evidenceRoot, name));
    }

    const sourceArchive = path.join(staging, `pulse-${options.label}-source-${shortHead}.zip`);
    run('git', [
      'archive',
      '--format=zip',
      `--prefix=pulse-${options.label}/`,
      '--output',
      sourceArchive,
      headRevision
    ], { description: 'Create sealed source-only archive' });

    const patchFile = path.join(staging, `pulse-${options.label}-${shortBase}-to-${shortHead}.patch`);
    const patch = run('git', [
      'diff',
      '--binary',
      '--full-index',
      '--find-renames',
      baseRevision,
      headRevision
    ], { encoding: null, description: 'Create exact binary source patch', maxBuffer: 256 * 1024 * 1024 });
    atomicWrite(patchFile, patch.stdout);

    const replay = writePatchReplay(
      baseRevision,
      headRevision,
      patchFile,
      path.join(evidenceRoot, 'patch-replay.json')
    );
    const ledger = migrationLedger(baseRevision, headRevision);
    atomicJson(path.join(evidenceRoot, 'migration-ledger.json'), ledger);
    const scope = scopeReport(ledger, baseRevision, headRevision);
    atomicJson(path.join(evidenceRoot, 'scope-report.json'), scope);
    atomicWrite(path.join(evidenceRoot, 'scope-report.md'), `${renderMarkdown(scope)}\n`);
    const integrity = targetIntegrityReport(headRevision, fourMode, candidates);
    atomicJson(path.join(evidenceRoot, 'target-integrity.json'), integrity);
    const aggregate = aggregateValidation({
      sourceRevision: headRevision,
      releaseSeal,
      taskReport,
      fourMode,
      candidates,
      replay
    });
    atomicJson(path.join(evidenceRoot, 'aggregate-summary.json'), aggregate);
    atomicWrite(path.join(staging, 'FINAL-SEAL.md'), finalSealMarkdown({
      label: options.label,
      baseRevision,
      headRevision,
      aggregate,
      replay,
      candidates,
      scope
    }));

    const manifest = Object.freeze({
      schemaVersion: EVIDENCE_BUNDLE_VERSION,
      label: options.label,
      status: 'passed',
      createdAt: new Date().toISOString(),
      baseRevision,
      headRevision,
      sourceArchive: path.basename(sourceArchive),
      binaryPatch: path.basename(patchFile),
      replay: 'evidence/patch-replay.json',
      aggregate: 'evidence/aggregate-summary.json',
      fourMode: 'evidence/four-mode-conformance.json',
      targetIntegrity: 'evidence/target-integrity.json',
      migrationLedger: 'evidence/migration-ledger.json',
      scopeReport: 'evidence/scope-report.json',
      candidates: Object.freeze({
        native: 'candidates/fastly-native',
        javascript: 'candidates/fastly-javascript'
      }),
      policy: Object.freeze({
        providerRealityValidated: false,
        deploymentPerformed: false,
        publicationPerformed: false,
        humanReleaseAuthorityRequired: true
      })
    });
    atomicJson(path.join(staging, 'seal-manifest.json'), manifest);
    atomicWrite(path.join(staging, 'SHA256SUMS'), checksumLines(staging));
    fs.renameSync(staging, output);
    outputCommitted = true;

    const bundleFile = `${output}.zip`;
    run('zip', ['-X', '-q', '-r', bundleFile, path.basename(output)], {
      cwd: path.dirname(output),
      description: 'Create delivery bundle',
      timeoutMs: 10 * 60 * 1000
    });
    atomicWrite(`${bundleFile}.sha256`, `${sha256File(bundleFile)}  ${path.basename(bundleFile)}\n`);
    return Object.freeze({
      output,
      bundleFile,
      bundleSha256: sha256File(bundleFile),
      sourceArchive: path.join(output, path.basename(sourceArchive)),
      patchFile: path.join(output, path.basename(patchFile)),
      aggregate,
      replay,
      scope
    });
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (outputCommitted) {
      fs.rmSync(output, { recursive: true, force: true });
      fs.rmSync(`${output}.zip`, { force: true });
      fs.rmSync(`${output}.zip.sha256`, { force: true });
    }
    throw error;
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = createEvidenceBundle(options);
  process.stdout.write(stableJson({
    status: 'passed',
    output: result.output,
    bundle: result.bundleFile,
    bundleSha256: result.bundleSha256,
    shards: result.aggregate.summary.shards,
    releaseTasks: result.aggregate.summary.releaseTasks,
    deploymentPerformed: false,
    publicationPerformed: false
  }));
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  EVIDENCE_BUNDLE_VERSION,
  AGGREGATE_VERSION,
  REPLAY_VERSION,
  TARGET_INTEGRITY_VERSION,
  MIGRATION_LEDGER_VERSION,
  SHARD_DEFINITIONS,
  validateShardCoverage,
  parseArgs,
  aggregateValidation,
  treeSnapshot,
  migrationLedger,
  targetIntegrityReport,
  verifyCandidateDirectory,
  createEvidenceBundle
});
