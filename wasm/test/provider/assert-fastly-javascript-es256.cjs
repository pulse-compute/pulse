#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
process.chdir(repoRoot);

const esbuild = require('../../../packages/provider-fastly/node_modules/esbuild');
const {
  inspectFastlyComputeLauncher,
  renderFastlyLocalConfig,
  requestFastlyCompute,
  startFastlyComputeServe
} = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const {
  HARNESS_VERSION,
  NOW,
  SUBJECT,
  loadEs256ConformanceCorpus,
  materializeEs256ConformanceCases
} = require('../jwt/jwt-es256-conformance-harness.cjs');

const REPORT_VERSION = 'pulse.fastly-javascript-es256-conformance.h4.v1';
const REALIZATION = 'runtime-builtin';
const IMPLEMENTATION = 'webcrypto.subtle.ecdsa-p256-sha-256.v1';

function parseArgs(argv) {
  let outputDirectory = path.join(repoRoot, 'wasm', '.test-results', 'boundary-h4');
  let skipBuild = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out' && argv[index + 1]) {
      outputDirectory = path.resolve(repoRoot, argv[++index]);
    } else if (argv[index] === '--skip-build') {
      skipBuild = true;
    } else {
      throw new TypeError(`Unknown or incomplete Fastly JavaScript ES256 option ${argv[index]}.`);
    }
  }
  return Object.freeze({ outputDirectory, skipBuild });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs || 180_000,
    shell: false
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `\n${detail}` : ''}`, {
      cause: result.error
    });
  }
  return Object.freeze({ durationMs: Date.now() - startedAt });
}

function applicationSource(cases) {
  const inputs = cases.map((entry) => Object.freeze({
    id: entry.id,
    input: entry.input,
    forceRealizationFailure: entry.forceRealizationFailure === true
  }));
  return `import { verifyJwtWithCrypto } from '@pulse-compute/jwt/provider';
import { crypto as runtimeCrypto } from '@pulse-compute/crypto';

const cases = new Map(${JSON.stringify(inputs)}.map((entry) => [entry.id, entry]));
const now = ${NOW};

function errorCode(error) {
  return error && error.code ? String(error.code) : 'PULSE_RUNTIME_FAILED';
}

async function execute(testCase) {
  const order = [];
  let cryptoCalls = 0;
  let clockCalls = 0;
  let schemaCalls = 0;
  const selectedCrypto = testCase.forceRealizationFailure
    ? Object.freeze({
        signature: Object.freeze({
          verify() {
            cryptoCalls += 1;
            order.push('crypto');
            return Object.freeze({ status: 'realization-failure' });
          }
        })
      })
    : Object.freeze({
        signature: Object.freeze({
          async verify(request) {
            cryptoCalls += 1;
            order.push('crypto');
            return runtimeCrypto.signature.verify(request);
          }
        })
      });
  const host = Object.freeze({
    captureWallClock() {
      clockCalls += 1;
      order.push('clock');
      return Object.freeze({ unixEpochSeconds: now, trusted: true });
    },
    validateClaims(schemaId, value) {
      schemaCalls += 1;
      order.push('schema');
      if (schemaId !== 'auth.AccessClaims') throw new Error('Unexpected schema ID.');
      return Object.freeze({ sub: value.sub, roles: value.roles });
    },
    registerSensitiveValue() {}
  });
  let output;
  let caught;
  try {
    output = await verifyJwtWithCrypto(testCase.input, host, selectedCrypto);
  } catch (error) {
    caught = error;
  }
  return Object.freeze({
    id: testCase.id,
    observedStatus: caught ? errorCode(caught) : 'valid',
    order,
    cryptoCalls,
    clockCalls,
    schemaCalls,
    claimsAvailable: Boolean(output),
    algorithm: output && output.protectedHeader && output.protectedHeader.alg || null,
    subjectMatched: Boolean(output && output.claims && output.claims.sub === ${JSON.stringify(SUBJECT)}),
    alternateTargetAttempts: 0,
    alternateRealizationAttempts: 0,
    automaticFallback: false
  });
}

addEventListener('fetch', (event) => event.respondWith((async () => {
  try {
    const url = new URL(event.request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\\/case\\//, ''));
    const testCase = cases.get(id);
    if (!testCase) return new Response('not found', { status: 404 });
    const result = await execute(testCase);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  } catch (_) {
    return new Response('conformance failure', { status: 500 });
  }
})()));
`;
}

function normalizeCase(testCase, observed) {
  assert.equal(observed.id, testCase.id);
  assert.equal(observed.observedStatus, testCase.expectedStatus, testCase.id);
  if (testCase.expectedOrder) assert.deepEqual(observed.order, testCase.expectedOrder, testCase.id);
  if (testCase.requireClaimsUnavailable) {
    assert.equal(observed.clockCalls, 0, testCase.id);
    assert.equal(observed.schemaCalls, 0, testCase.id);
    assert.equal(observed.claimsAvailable, false, testCase.id);
  }
  if (observed.observedStatus === 'valid') {
    assert.equal(observed.algorithm, 'ES256', testCase.id);
    assert.equal(observed.subjectMatched, true, testCase.id);
  }
  assert.equal(observed.alternateTargetAttempts, 0, testCase.id);
  assert.equal(observed.alternateRealizationAttempts, 0, testCase.id);
  assert.equal(observed.automaticFallback, false, testCase.id);
  return Object.freeze({
    id: testCase.id,
    status: 'passed',
    evaluation: 'runtime',
    expectedStatus: testCase.expectedStatus,
    observedStatus: observed.observedStatus,
    order: Object.freeze([...observed.order]),
    observation: Object.freeze({
      cryptoCalls: observed.cryptoCalls,
      clockCalls: observed.clockCalls,
      schemaCalls: observed.schemaCalls,
      claimsAvailable: observed.claimsAvailable,
      alternateTargetAttempts: 0,
      alternateRealizationAttempts: 0,
      automaticFallback: false
    }),
    runtime: 'fastly-js-compute-webcrypto-viceroy'
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const loaded = loadEs256ConformanceCorpus();
  const materialized = materializeEs256ConformanceCases(loaded);
  assert.equal(materialized.version, HARNESS_VERSION);
  const stages = [];
  if (!options.skipBuild) {
    stages.push(Object.freeze({
      id: 'typescript-build',
      ...run(process.execPath, [
        'node_modules/typescript/bin/tsc',
        '-b',
        'packages/crypto',
        'packages/jwt'
      ])
    }));
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-js-es256-h4-'));
  let server;
  try {
    const source = applicationSource(materialized.cases);
    const distFile = path.join(tempRoot, 'dist', 'index.js');
    const wasmFile = path.join(tempRoot, 'bin', 'main.wasm');
    fs.mkdirSync(path.dirname(distFile), { recursive: true });
    fs.mkdirSync(path.dirname(wasmFile), { recursive: true });
    const bundleStartedAt = Date.now();
    const build = await esbuild.build({
      absWorkingDir: repoRoot,
      stdin: {
        contents: source,
        resolveDir: path.join(repoRoot, 'packages/provider-fastly'),
        sourcefile: 'pulse-fastly-javascript-es256-h4.js',
        loader: 'js'
      },
      outfile: distFile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: ['es2022'],
      conditions: ['fastly', 'module', 'import', 'default'],
      mainFields: ['module', 'main'],
      packages: 'bundle',
      external: ['fastly:*'],
      legalComments: 'none',
      sourcemap: false,
      treeShaking: true,
      logLevel: 'silent',
      metafile: true
    });
    stages.push(Object.freeze({
      id: 'fastly-javascript-bundle',
      durationMs: Date.now() - bundleStartedAt
    }));
    stages.push(Object.freeze({
      id: 'js-compute-runtime',
      ...run(
        path.join(repoRoot, 'packages/provider-fastly/node_modules/.bin/js-compute-runtime'),
        [
          '--env',
          `WASMTIME_HOME=${path.join(tempRoot, '.wasmtime')},XDG_CACHE_HOME=${path.join(tempRoot, '.cache')}`,
          distFile,
          wasmFile
        ],
        {
          cwd: tempRoot,
          timeoutMs: 300_000,
          env: { WASMTIME_HOME: path.join(tempRoot, '.wasmtime') }
        }
      )
    }));
    fs.writeFileSync(
      path.join(tempRoot, 'fastly.toml'),
      renderFastlyLocalConfig({
        name: 'pulse-fastly-javascript-es256-h4',
        description: 'Pulse H4 Fastly JavaScript ES256 conformance'
      })
    );

    const launcher = inspectFastlyComputeLauncher({
      binary: process.env.PULSE_FASTLY_BIN,
      viceroyBinary: process.env.PULSE_VICEROY_BIN,
      env: process.env,
      timeoutMs: 10_000
    });
    const executionStartedAt = Date.now();
    server = await startFastlyComputeServe({
      launcher,
      packageRoot: tempRoot,
      wasmFile,
      manifestFile: path.join(tempRoot, 'fastly.toml'),
      startTimeoutMs: 45_000
    });
    const cases = [];
    for (const testCase of materialized.cases) {
      const response = await requestFastlyCompute(server, {
        path: `/case/${encodeURIComponent(testCase.id)}`,
        timeoutMs: 30_000
      });
      assert.equal(response.status, 200, `${testCase.id}: ${response.body.toString('utf8')}`);
      cases.push(normalizeCase(testCase, JSON.parse(response.body.toString('utf8'))));
    }
    stages.push(Object.freeze({
      id: 'viceroy-corpus',
      durationMs: Date.now() - executionStartedAt
    }));

    const bundleBytes = fs.readFileSync(distFile);
    const wasmBytes = fs.readFileSync(wasmFile);
    const report = Object.freeze({
      version: REPORT_VERSION,
      status: 'passed',
      provider: 'fastly',
      target: 'javascript',
      targetId: 'fastly-javascript',
      corpusVersion: loaded.corpus.version,
      corpusSemanticHash: loaded.semanticHash,
      realization: REALIZATION,
      implementation: IMPLEMENTATION,
      required: true,
      requiredExecutions: cases.length,
      completedExecutions: cases.length,
      skippedExecutions: 0,
      cases: Object.freeze(cases),
      artifact: Object.freeze({
        bundleBytes: bundleBytes.byteLength,
        bundleSha256: sha256(bundleBytes),
        wasmBytes: wasmBytes.byteLength,
        wasmSha256: sha256(wasmBytes),
        bundledInputFiles: Object.keys(build.metafile.inputs).length
      }),
      engine: Object.freeze({
        kind: launcher.kind,
        owner: launcher.owner,
        version: launcher.inspection.version,
        binarySha256: sha256(fs.readFileSync(launcher.inspection.binary))
      }),
      stages: Object.freeze(stages),
      alternateTargetAttempts: 0,
      alternateRealizationAttempts: 0,
      automaticFallback: false
    });
    fs.mkdirSync(options.outputDirectory, { recursive: true });
    const reportFile = path.join(
      options.outputDirectory,
      'fastly-javascript-es256-conformance.json'
    );
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
      status: 'passed',
      target: report.targetId,
      corpusCases: cases.length,
      executions: cases.length,
      skipped: 0,
      engine: report.engine.kind,
      evidence: path.relative(repoRoot, reportFile).replace(/\\/g, '/')
    }, null, 2)}\n`);
  } finally {
    if (server) {
      await server.stop();
      server.child.stdout.destroy();
      server.child.stderr.destroy();
      server.child.unref();
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  REPORT_VERSION,
  applicationSource,
  normalizeCase
});
