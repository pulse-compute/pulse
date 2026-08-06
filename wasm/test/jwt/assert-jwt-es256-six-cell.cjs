#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const outputDirectory = path.join(repoRoot, 'wasm', '.test-results', 'boundary-h4');
const MATRIX_VERSION = 'pulse.jwt-es256-six-cell-matrix.h4.v1';

process.chdir(repoRoot);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function run(id, file, args, timeoutMs) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    shell: false
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`${id} failed${detail ? `\n${detail}` : ''}`, {
      cause: result.error
    });
  }
  return Object.freeze({
    id,
    status: 'passed',
    durationMs: Date.now() - startedAt,
    output: String(result.stdout || '').trim()
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function semanticProjection(cases) {
  return cases.map(({ runtime, ...entry }) => entry);
}

function fileRecord(file) {
  const bytes = fs.readFileSync(file);
  return Object.freeze({
    file: path.relative(repoRoot, file).replace(/\\/g, '/'),
    bytes: bytes.byteLength,
    sha256: sha256(bytes)
  });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt-six-cell-h4-'));
try {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const g4Output = path.join(tempRoot, 'g4');
  const stages = [];
  stages.push(run(
    'five-cell-exact-artifact-replay',
    path.join(repoRoot, 'wasm/test/jwt/assert-jwt-es256-cross-target.cjs'),
    ['--out', g4Output],
    1_800_000
  ));
  stages.push(run(
    'fastly-javascript-viceroy-corpus',
    path.join(repoRoot, 'wasm/test/provider/assert-fastly-javascript-es256.cjs'),
    ['--out', outputDirectory, '--skip-build'],
    600_000
  ));

  const g4EvidenceFile = path.join(g4Output, 'jwt-g4-evidence.json');
  const g4Matrix = readJson(path.join(g4Output, 'es256-target-matrix.json'));
  const javascript = readJson(path.join(g4Output, 'es256-javascript-conformance.json'));
  const fastlyJavascriptFile = path.join(
    outputDirectory,
    'fastly-javascript-es256-conformance.json'
  );
  const fastlyJavascript = readJson(fastlyJavascriptFile);
  assert.equal(g4Matrix.status, 'passed');
  assert.equal(g4Matrix.requiredCells.length, 5);
  assert.equal(g4Matrix.requiredSemanticEvaluations, 190);
  assert.equal(fastlyJavascript.status, 'passed');
  assert.equal(fastlyJavascript.requiredExecutions, 38);
  assert.equal(fastlyJavascript.completedExecutions, 38);
  assert.equal(fastlyJavascript.skippedExecutions, 0);
  assert.equal(
    fastlyJavascript.corpusSemanticHash,
    javascript.corpusSemanticHash
  );
  assert.deepEqual(
    semanticProjection(fastlyJavascript.cases),
    semanticProjection(javascript.node.cases)
  );

  const requiredCells = Object.freeze([
    g4Matrix.requiredCells[0],
    Object.freeze({
      id: 'fastly-javascript',
      status: 'passed',
      executions: 38,
      skipped: 0,
      engine: fastlyJavascript.engine.kind,
      artifactSha256: fastlyJavascript.artifact.wasmSha256
    }),
    ...g4Matrix.requiredCells.slice(1)
  ]);
  const matrix = Object.freeze({
    version: MATRIX_VERSION,
    stage: 'H4',
    status: 'PASS',
    corpusVersion: javascript.corpusVersion,
    corpusSemanticHash: javascript.corpusSemanticHash,
    caseIds: javascript.caseIds,
    requiredCells,
    requiredCellCount: 6,
    corpusCases: javascript.caseIds.length,
    requiredSemanticEvaluations: javascript.caseIds.length * 6,
    completedSemanticEvaluations: javascript.caseIds.length * 6,
    skippedRequiredEvaluations: 0,
    exactInputOutputFailureParity: true,
    providerRuntimeParity: true,
    alternateAlgorithmAttempts: 0,
    alternateTargetAttempts: 0,
    alternateProviderAttempts: 0,
    alternateRealizationAttempts: 0,
    automaticFallback: false,
    sources: Object.freeze({
      fiveCellReplay: fileRecord(g4EvidenceFile),
      fastlyJavascript: fileRecord(fastlyJavascriptFile)
    }),
    stages: Object.freeze(stages.map(({ output, ...stage }) => stage))
  });
  const matrixFile = path.join(outputDirectory, 'es256-six-cell-matrix.json');
  fs.writeFileSync(matrixFile, `${JSON.stringify(matrix, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    stage: 'H4',
    status: 'passed',
    requiredCells: 6,
    corpusCases: matrix.corpusCases,
    semanticEvaluations: matrix.completedSemanticEvaluations,
    skipped: 0,
    evidence: path.relative(repoRoot, matrixFile).replace(/\\/g, '/')
  }, null, 2)}\n`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

