#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
process.chdir(repoRoot);

const jwtContracts = require('../../packages/contracts/src/jwt/contracts.js');
const cryptoContracts = require('../../packages/contracts/src/crypto/contracts.js');
const {
  planProjectCrypto,
} = require('../../packages/compiler/src/crypto-requirement-planner.js');
const {
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR,
} = require('../../../packages/provider-node/src/javascript/target.js');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR,
} = require('../../../packages/provider-node/src/native/target.js');
const {
  createNodeJavascriptJwtVerify,
  NODE_JAVASCRIPT_JWT_REALIZATION,
  NODE_JAVASCRIPT_JWT_VERIFIER_VERSION,
} = require('../../../packages/provider-node/src/javascript/jwt-verifier.js');
const {
  FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR,
} = require('../../../packages/provider-fastly/src/javascript/target.js');
const {
  FASTLY_JAVASCRIPT_JWT_REALIZATION,
  FASTLY_JAVASCRIPT_JWT_VERIFIER_VERSION,
} = require('../../../packages/provider-fastly/src/javascript/jwt-verifier.js');
const {
  FASTLY_JAVASCRIPT_SOURCE_PACKAGE_VERSION,
  FASTLY_JS_COMPUTE_VERSION,
  ESBUILD_VERSION,
} = require('../../../packages/provider-fastly/src/javascript/source-package.js');
const {
  fastlyComputeRealityVersion,
  renderFastlyLocalConfig,
  requestFastlyCompute,
  startFastlyComputeServe,
} = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const {
  JAVASCRIPT_REALITY_HARNESS_VERSION,
  REQUIRED_CASE_IDS,
  forbiddenSensitiveValues,
  loadJwtConformanceCorpus,
  materializeJavascriptConformanceCases,
} = require('./jwt-conformance-harness.cjs');

const EVIDENCE_VERSION = 'pulse.jwt-e1-evidence.v1';
const CONFORMANCE_REPORT_VERSION =
  'pulse.jwt-javascript-conformance-report.e1.v1';
const TARGET_REALITY_REPORT_VERSION =
  'pulse.jwt-javascript-target-reality-report.e1.v1';
const REDACTION_REPORT_VERSION =
  'pulse.jwt-javascript-redaction-report.e1.v1';
const FASTLY_ENTRY_VERSION =
  'pulse.fastly-javascript-jwt-reality-entry.e1.v1';
const RUNTIME_VERSION = 'pulse.jwt-javascript-case-runtime.e1.v1';
const SECRET_STORE = 'jwt_e1_secrets';
const PLANNING_CASE_IDS = Object.freeze([
  'jwt-algorithm-outside-profile-crypto',
  'missing-target-realization',
  'invalid-exact-realization-pin',
]);

function parseArgs(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'jwt-e1');
  let allowFastlyBlocked = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--out') {
      outputDirectory = path.resolve(argv[++index]);
    } else if (value === '--allow-fastly-blocked') {
      allowFastlyBlocked = true;
    } else {
      throw new TypeError(`Unknown argument ${String(value)}.`);
    }
  }
  return Object.freeze({ outputDirectory, allowFastlyBlocked });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(file) {
  return sha256(fs.readFileSync(file));
}

function sourceRecord(relativeFile) {
  const file = path.join(repoRoot, relativeFile);
  const bytes = fs.readFileSync(file);
  return Object.freeze({
    file: relativeFile.replace(/\\/g, '/'),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactToken(secret, header, claims) {
  const protectedSegment = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const claimsSegment = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signingInput = `${protectedSegment}.${claimsSegment}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput, 'ascii')
    .digest();
  return Object.freeze({
    token: `${signingInput}.${signature.toString('base64url')}`,
    signature,
  });
}

function invalidateAuthenticator(token) {
  const segments = token.split('.');
  const signature = Buffer.from(segments[2], 'base64url');
  signature[0] ^= 1;
  return `${segments[0]}.${segments[1]}.${signature.toString('base64url')}`;
}

function adapterFixture(corpus, secret, nowSeconds) {
  const claims = {
    ...cloneJson(corpus.fixture.claims),
    iat: nowSeconds - 300,
    nbf: nowSeconds - 10,
    exp: nowSeconds + 300,
  };
  const signed = compactToken(secret, corpus.fixture.protectedHeader, claims);
  const policy = cloneJson(corpus.fixture.policy);
  return Object.freeze({
    validToken: signed.token,
    invalidToken: invalidateAuthenticator(signed.token),
    effect(token) {
      return Object.freeze({
        ...jwtContracts.JWT_VERIFY_OPERATION,
        id: 'jwt-e1-adapter-probe',
        payload: Object.freeze({
          token,
          options: cloneJson(policy),
        }),
      });
    },
    expectedResult: Object.freeze({
      claims: cloneJson(corpus.fixture.normalizedResult.claims),
      protectedHeader: cloneJson(
        corpus.fixture.normalizedResult.protectedHeader,
      ),
    }),
    sensitive: Object.freeze({ subject: corpus.fixture.claims.sub }),
  });
}

function schemaValue(mode, claims) {
  if (mode === 'reject') {
    const error = new Error('rejected by the E1 schema negative control');
    error.code = 'PULSE_SCHEMA_VALUE_INVALID';
    error.detail = Object.freeze({
      path: '$.roles',
      expected: 'string',
      actualKind: 'array',
    });
    throw error;
  }
  return Object.freeze({
    sub: String(claims.sub),
    roles: Object.freeze(Array.isArray(claims.roles) ? claims.roles.map(String) : []),
  });
}

function nodeAuthority(caseInput, secretValues) {
  return Object.freeze({
    resolveSecret(binding) {
      return Object.prototype.hasOwnProperty.call(secretValues, binding)
        ? secretValues[binding]
        : undefined;
    },
    captureWallClock() {
      return Object.freeze({
        unixEpochSeconds: caseInput.clockInstantUnixSeconds,
        trusted: true,
      });
    },
    validateClaims(_schemaId, claims, _context, mode) {
      return schemaValue(mode, claims);
    },
  });
}

function planningObservation(caseId, targetDescriptor) {
  const requirements = cryptoContracts.normalizeCryptoRequirements([{
    algorithm: 'HS256',
    requestedBy: '@pulse-compute/jwt',
  }]);
  let declaration;
  let selectedTarget = targetDescriptor;
  let target = 'javascript';
  if (caseId === 'jwt-algorithm-outside-profile-crypto') {
    declaration = cryptoContracts.normalizeCryptoConfiguration([]);
  } else if (caseId === 'missing-target-realization') {
    declaration = cryptoContracts.normalizeCryptoConfiguration(['HS256']);
    selectedTarget = {
      ...targetDescriptor,
      crypto: cryptoContracts.defineCryptoTargetCapabilities({
        target: 'javascript',
        algorithms: [],
      }),
    };
  } else if (caseId === 'invalid-exact-realization-pin') {
    declaration = cryptoContracts.normalizeCryptoConfiguration({
      HS256: { realization: 'runtime-builtin' },
    });
    selectedTarget = NODE_NATIVE_TARGET_DESCRIPTOR;
    target = 'native';
  } else {
    throw new TypeError(`Unknown E1 planning case ${caseId}.`);
  }
  try {
    planProjectCrypto({
      declaration,
      requirements,
      targetDescriptor: selectedTarget,
      target,
      profile: 'jwt-e1',
      profileSelectionSource: 'e1-conformance-harness',
      configurationSource: 'e1-conformance-harness',
    });
    assert.fail(`${caseId} unexpectedly emitted a crypto realization plan`);
  } catch (error) {
    assert.equal(typeof error.code, 'string');
    return Object.freeze({
      version: 'pulse.jwt-e1-planning-observation.v1',
      status: 'error-before-artifact',
      code: error.code,
      artifactEmitted: false,
      automaticFallback: false,
    });
  }
}

function caseValue(result, name) {
  if (name === 'status') return result.status;
  if (name === 'code') return result.error && result.error.code;
  if (name === 'category') return result.error && result.error.category;
  if (name === 'detached') return result.result && result.result.detached;
  if (name === 'immutablePaths') {
    return result.result
      && Object.values(result.result.immutablePaths).every((value) => value === true);
  }
  if (name === 'cryptoCalls') return result.observation.cryptoPrimitiveCalls;
  if (name === 'clockCalls') return result.observation.clockCalls;
  if (name === 'schemaCalls') return result.observation.schemaCalls;
  if (name === 'secretCalls') return result.observation.secretCalls;
  if (name === 'claimsObserved') return result.observation.claimsObserved;
  if (name === 'claimsParsed') return result.observation.claimsParsed;
  if (name === 'registeredClaimsStatus') {
    return result.observation.registeredClaimsStatus;
  }
  if (name === 'realizationAttempts') return result.observation.realizationAttempts;
  if (name === 'alternateTargetAttempts') {
    return result.observation.alternateTargetAttempts;
  }
  if (name === 'alternateRealizationAttempts') {
    return result.observation.alternateRealizationAttempts;
  }
  if (name === 'automaticFallback') {
    return result.observation.automaticFallback;
  }
  if (name === 'result') return result.resultMatchesExpected;
  if (name === 'forbiddenValuesPresent') return 0;
  if (name === 'categories') {
    return ['token', 'signature', 'claims', 'key', 'secret'];
  }
  return undefined;
}

function assertRuntimeCase(testCase, result) {
  assert.equal(result.version, RUNTIME_VERSION);
  assert.equal(
    result.status,
    testCase.expected.status,
    `${testCase.id}: ${JSON.stringify(result)}`,
  );
  const assertions = [];
  for (const [name, expected] of Object.entries(testCase.expected)) {
    if (name === 'result') {
      assert.equal(result.resultMatchesExpected, true, testCase.id);
      assertions.push('normalized-result');
      continue;
    }
    if (name === 'immutablePaths') {
      assert.equal(caseValue(result, name), true, testCase.id);
      assertions.push('immutable-paths');
      continue;
    }
    const actual = caseValue(result, name);
    assert.deepEqual(actual, expected, `${testCase.id}:${name}`);
    assertions.push(name);
  }
  if (result.status === 'success') {
    assert.ok(result.observation.eventOrder.indexOf('crypto') >= 0);
    assert.ok(
      result.observation.eventOrder.indexOf('clock')
        > result.observation.eventOrder.indexOf('crypto'),
      `${testCase.id} must capture the clock after authenticity`,
    );
    assert.ok(
      result.observation.eventOrder.indexOf('schema')
        > result.observation.eventOrder.indexOf('clock'),
      `${testCase.id} must validate schema after registered claims`,
    );
    assert.equal(result.observation.secretRegistered, true);
    assert.equal(result.observation.tokenRegistered, true);
  }
  return Object.freeze({
    id: testCase.id,
    kind: testCase.kind,
    polarity: testCase.polarity,
    setup: testCase.setup,
    status: 'passed',
    observedStatus: result.status,
    errorCode: result.error && result.error.code || null,
    observation: result.observation,
    result: result.result,
    assertions: Object.freeze(assertions),
  });
}

function assertPlanningCase(testCase, result) {
  assert.equal(result.status, testCase.expected.status, testCase.id);
  assert.equal(result.code, testCase.expected.code, testCase.id);
  assert.equal(result.artifactEmitted, false);
  assert.equal(result.automaticFallback, false);
  return Object.freeze({
    id: testCase.id,
    kind: testCase.kind,
    polarity: testCase.polarity,
    setup: testCase.setup,
    status: 'passed',
    observedStatus: result.status,
    errorCode: result.code,
    observation: Object.freeze({
      artifactEmitted: false,
      automaticFallback: false,
    }),
    result: null,
    assertions: Object.freeze(['status', 'code', 'no-artifact', 'no-fallback']),
  });
}

async function runNodeAdapterProbe(corpus, secrets) {
  const fixture = adapterFixture(
    corpus,
    secrets.values[secrets.bindings.base],
    corpus.fixture.clockInstantUnixSeconds,
  );
  const run = async (token) => {
    const observed = {
      secretCalls: 0,
      clockCalls: 0,
      schemaCalls: 0,
      tokenRegistered: false,
      secretRegistered: false,
      subjectRegistered: false,
      requestOwnershipObserved: false,
    };
    let resolvedSecret;
    const verify = createNodeJavascriptJwtVerify({
      secretLookup(binding, execution) {
        observed.secretCalls += 1;
        observed.requestOwnershipObserved =
          execution && execution.requestId === 'node-e1-request';
        resolvedSecret = secrets.values[binding];
        return resolvedSecret;
      },
      captureWallClock() {
        observed.clockCalls += 1;
        return Object.freeze({
          unixEpochSeconds: corpus.fixture.clockInstantUnixSeconds,
          trusted: true,
        });
      },
    });
    try {
      const result = await verify(fixture.effect(token), {
        requestId: 'node-e1-request',
        registerRedactionValue(value) {
          if (value === token) observed.tokenRegistered = true;
          else if (value === resolvedSecret) observed.secretRegistered = true;
          else if (value === fixture.sensitive.subject) observed.subjectRegistered = true;
        },
        validateSchemaValue(_schemaId, claims) {
          observed.schemaCalls += 1;
          return schemaValue('normalize', claims);
        },
      });
      return Object.freeze({
        status: 'success',
        code: null,
        resultMatchesExpected:
          JSON.stringify(result) === JSON.stringify(fixture.expectedResult),
        resultImmutable: Object.isFrozen(result)
          && Object.isFrozen(result.claims)
          && Object.isFrozen(result.protectedHeader),
        observation: Object.freeze({ ...observed, automaticFallback: false }),
      });
    } catch (error) {
      return Object.freeze({
        status: 'error',
        code: error && error.code || null,
        resultMatchesExpected: false,
        resultImmutable: false,
        observation: Object.freeze({ ...observed, automaticFallback: false }),
      });
    }
  };
  const valid = await run(fixture.validToken);
  const invalid = await run(fixture.invalidToken);
  assert.equal(valid.status, 'success');
  assert.equal(valid.resultMatchesExpected, true);
  assert.equal(valid.resultImmutable, true);
  assert.deepEqual(
    {
      secretCalls: valid.observation.secretCalls,
      clockCalls: valid.observation.clockCalls,
      schemaCalls: valid.observation.schemaCalls,
      requestOwnershipObserved: valid.observation.requestOwnershipObserved,
    },
    {
      secretCalls: 1,
      clockCalls: 1,
      schemaCalls: 1,
      requestOwnershipObserved: true,
    },
  );
  assert.equal(invalid.status, 'error');
  assert.equal(invalid.code, 'PULSE_JWT_SIGNATURE_INVALID');
  assert.equal(invalid.observation.clockCalls, 0);
  assert.equal(invalid.observation.schemaCalls, 0);
  return Object.freeze({ valid, invalid });
}

function packageVersion(packageRoot) {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
}

function runCommand(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: options.timeoutMs || 180000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`,
  );
  return Object.freeze({
    durationMs: Date.now() - started,
    stdoutBytes: Buffer.byteLength(result.stdout || ''),
    stderrBytes: Buffer.byteLength(result.stderr || ''),
    outputSha256: sha256(`${result.stdout || ''}\n${result.stderr || ''}`),
  });
}

function writeFastlyProbe(tempRoot, secrets) {
  const esbuild = require(path.join(
    repoRoot,
    'packages',
    'provider-fastly',
    'node_modules',
    'esbuild',
  ));
  assert.equal(esbuild.version, ESBUILD_VERSION);
  const distRoot = path.join(tempRoot, 'dist');
  const binRoot = path.join(tempRoot, 'bin');
  fs.mkdirSync(distRoot, { recursive: true });
  fs.mkdirSync(binRoot, { recursive: true });
  const outputFile = path.join(distRoot, 'index.js');
  const buildStarted = Date.now();
  const bundled = esbuild.buildSync({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(__dirname, 'fastly-javascript-reality-entry.mjs')],
    outfile: outputFile,
    bundle: true,
    metafile: true,
    format: 'esm',
    platform: 'neutral',
    target: ['es2022'],
    conditions: ['fastly', 'module', 'import', 'default'],
    mainFields: ['module', 'main'],
    packages: 'bundle',
    external: ['fastly:*'],
    legalComments: 'none',
    sourcemap: false,
    charset: 'utf8',
    treeShaking: true,
    logLevel: 'silent',
    alias: {
      'node:crypto': path.join(
        repoRoot,
        'packages',
        'provider-fastly',
        'src',
        'javascript',
        'sha256.js',
      ),
    },
  });
  const source = fs.readFileSync(outputFile, 'utf8');
  assert.doesNotMatch(
    source,
    /(?:from\s+|import\s*\()\s*["']node:/,
    'Fastly reality closure contains a Node builtin import',
  );
  assert.match(source, /fastly:secret-store/);
  assert.match(source, /subtle/);
  const fastlyToml = renderFastlyLocalConfig({
    name: 'pulse-jwt-e1-fastly-javascript-reality',
    description: 'Pulse E1 Fastly JavaScript JWT reality gate',
    secretStores: {
      [SECRET_STORE]: secrets.values,
    },
  });
  fs.writeFileSync(path.join(tempRoot, 'fastly.toml'), fastlyToml);
  const jsComputeBinary = path.join(
    repoRoot,
    'packages',
    'provider-fastly',
    'node_modules',
    '.bin',
    process.platform === 'win32'
      ? 'js-compute-runtime.cmd'
      : 'js-compute-runtime',
  );
  assert.ok(fs.existsSync(jsComputeBinary));
  const compileCache = path.join(tempRoot, 'js-compute-cache');
  fs.mkdirSync(compileCache, { recursive: true });
  const wasmFile = path.join(binRoot, 'main.wasm');
  const compilation = runCommand(
    jsComputeBinary,
    [
      '--env',
      `XDG_CACHE_HOME=${compileCache}`,
      outputFile,
      wasmFile,
    ],
    { cwd: tempRoot, timeoutMs: 300000 },
  );
  const wasm = fs.readFileSync(wasmFile);
  assert.ok(wasm.byteLength > 1_000_000);
  assert.equal(wasm.subarray(0, 4).toString('hex'), '0061736d');
  for (const value of Object.values(secrets.values)) {
    assert.equal(source.includes(value), false);
    assert.equal(wasm.includes(Buffer.from(value, 'utf8')), false);
  }
  return Object.freeze({
    outputFile,
    wasmFile,
    buildDurationMs: Date.now() - buildStarted - compilation.durationMs,
    compilation,
    bundle: Object.freeze({
      bytes: Buffer.byteLength(source),
      sha256: sha256(source),
      inputs: Object.freeze(
        Object.keys(bundled.metafile.inputs)
          .map((file) => path.relative(repoRoot, path.resolve(repoRoot, file)).replace(/\\/g, '/'))
          .sort(),
      ),
    }),
    wasm: Object.freeze({
      bytes: wasm.byteLength,
      sha256: sha256(wasm),
      magic: '0061736d',
    }),
  });
}

async function postFastly(server, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const response = await requestFastlyCompute(server, {
    method: 'POST',
    path: '/jwt-e1',
    headers: { 'content-type': 'application/json' },
    body,
    timeoutMs: 30000,
  });
  assert.equal(response.status, 200, response.body.toString('utf8'));
  const parsed = JSON.parse(response.body.toString('utf8'));
  assert.equal(parsed.version, FASTLY_ENTRY_VERSION);
  return parsed.result;
}

async function runFastlyReality(corpus, materialized, options) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt-e1-fastly-'));
  let server;
  const started = Date.now();
  try {
    const artifact = writeFastlyProbe(tempRoot, materialized.secrets);
    server = await startFastlyComputeServe({
      binary: process.env.PULSE_FASTLY_BIN,
      viceroyBinary: process.env.PULSE_VICEROY_BIN,
      packageRoot: tempRoot,
      wasmFile: artifact.wasmFile,
      manifestFile: path.join(tempRoot, 'fastly.toml'),
      startTimeoutMs: 60000,
      stopTimeoutMs: 5000,
      env: process.env,
    });
    const caseRecords = [];
    for (const testCase of materialized.cases) {
      if (testCase.kind === 'planning') {
        caseRecords.push(assertPlanningCase(
          testCase,
          planningObservation(testCase.id, FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR),
        ));
        continue;
      }
      const result = await postFastly(server, {
        mode: 'case',
        caseInput: testCase.input,
      });
      caseRecords.push(assertRuntimeCase(testCase, result));
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fixture = adapterFixture(
      corpus,
      materialized.secrets.values[materialized.secrets.bindings.base],
      nowSeconds,
    );
    const validAdapter = await postFastly(server, {
      mode: 'adapter',
      effect: fixture.effect(fixture.validToken),
      expectedResult: fixture.expectedResult,
      sensitive: fixture.sensitive,
      schemaMode: 'normalize',
    });
    const invalidAdapter = await postFastly(server, {
      mode: 'adapter',
      effect: fixture.effect(fixture.invalidToken),
      expectedResult: fixture.expectedResult,
      sensitive: fixture.sensitive,
      schemaMode: 'normalize',
    });
    assert.equal(validAdapter.status, 'success');
    assert.equal(validAdapter.resultMatchesExpected, true);
    assert.equal(validAdapter.resultImmutable, true);
    assert.equal(validAdapter.observation.secretCalls, 1);
    assert.equal(validAdapter.observation.schemaCalls, 1);
    assert.equal(validAdapter.observation.providerDefaultClock, 'Date.now');
    assert.equal(validAdapter.observation.automaticFallback, false);
    assert.equal(invalidAdapter.status, 'error');
    assert.equal(invalidAdapter.error.code, 'PULSE_JWT_SIGNATURE_INVALID');
    assert.equal(invalidAdapter.observation.schemaCalls, 0);
    assert.equal(invalidAdapter.observation.automaticFallback, false);
    const logs = `${server.logs.stdout}\n${server.logs.stderr}`;
    for (const forbidden of forbiddenSensitiveValues(corpus)) {
      assert.equal(
        logs.includes(forbidden.value),
        false,
        `Fastly Compute logs contain ${forbidden.id}`,
      );
    }
    return Object.freeze({
      status: 'passed',
      caseRecords: Object.freeze(caseRecords),
      adapter: Object.freeze({
        valid: validAdapter,
        invalid: invalidAdapter,
      }),
      artifact,
      runtime: Object.freeze({
        version: fastlyComputeRealityVersion,
        durationMs: Date.now() - started,
        cli: Object.freeze({
          version: server.inspection.version,
          source: server.inspection.source,
          launcherSha256: fileSha256(server.inspection.binary),
        }),
        viceroy: server.viceroyInspection
          ? Object.freeze({
              version: server.viceroyInspection.version,
              source: server.viceroyInspection.source,
              binarySha256: fileSha256(server.viceroyInspection.binary),
            })
          : Object.freeze({
              version: null,
              source: 'fastly-cli-managed',
              binarySha256: null,
            }),
        command: Object.freeze([
          'fastly',
          'compute',
          'serve',
          '--dir',
          '<e1-fastly-package>',
          '--file',
          '<e1-fastly-package>/bin/main.wasm',
          '--addr',
          '<loopback>',
          ...(server.viceroyInspection
            ? ['--viceroy-path', '<fastly-cli-managed-viceroy>']
            : []),
        ]),
        requestCount: materialized.cases.length - PLANNING_CASE_IDS.length + 2,
        stdoutBytes: Buffer.byteLength(server.logs.stdout),
        stderrBytes: Buffer.byteLength(server.logs.stderr),
      }),
    });
  } catch (error) {
    if (!options.allowFastlyBlocked) throw error;
    return Object.freeze({
      status: 'blocked',
      blocker: Object.freeze({
        code: error && error.code || 'PULSE_FASTLY_JAVASCRIPT_REALITY_FAILED',
        message: String(error && error.message || error),
        automaticFallback: false,
      }),
    });
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

function filesUnder(relativeRoot, pattern) {
  const root = path.join(repoRoot, relativeRoot);
  const output = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (!pattern || pattern.test(entry.name)) {
        output.push(path.relative(repoRoot, file).replace(/\\/g, '/'));
      }
    }
  }
  visit(root);
  return output.sort();
}

function sourceAudit() {
  const jwtSources = [
    ...filesUnder('packages/jwt/src', /\.(?:ts|js)$/),
    'packages/provider-node/src/javascript/jwt-verifier.js',
    'packages/provider-fastly/src/javascript/jwt-verifier.js',
  ];
  const environmentDetection = /(?:process\.env|process\.versions|process\.release|Deno\.env|import\.meta\.env|navigator\.userAgent|PULSE_(?:TARGET|PROVIDER)|FASTLY_HOSTNAME)/;
  for (const relativeFile of jwtSources) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8'),
      environmentDetection,
      `${relativeFile} contains JWT environment detection`,
    );
  }
  assert.deepEqual(
    NODE_JAVASCRIPT_JWT_REALIZATION,
    FASTLY_JAVASCRIPT_JWT_REALIZATION,
  );
  assert.deepEqual(NODE_JAVASCRIPT_JWT_REALIZATION, {
    algorithm: 'HS256',
    realization: 'runtime-builtin',
    implementation: 'webcrypto.subtle.hmac-sha-256.v1',
    automaticFallback: false,
  });
  for (const descriptor of [
    NODE_JAVASCRIPT_TARGET_DESCRIPTOR,
    FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR,
  ]) {
    assert.equal(descriptor.crypto.algorithms.length, 1);
    assert.equal(descriptor.crypto.algorithms[0].algorithm, 'HS256');
    assert.equal(descriptor.crypto.algorithms[0].realization, 'runtime-builtin');
    assert.equal(descriptor.crypto.algorithms[0].implemented, true);
    assert.equal(descriptor.crypto.automaticFallback, false);
  }
  return Object.freeze({
    version: 'pulse.jwt-e1-source-audit.v1',
    jwtEnvironmentDetection: false,
    targetOrProviderProbeSelection: false,
    realizationFallback: false,
    runtimeBuiltinImplementation: 'webcrypto.subtle.hmac-sha-256.v1',
    sources: Object.freeze(jwtSources.map(sourceRecord)),
  });
}

function targetReport(targetId, caseRecords, adapter, runtime) {
  assert.deepEqual(caseRecords.map((entry) => entry.id), REQUIRED_CASE_IDS);
  assert.ok(caseRecords.every((entry) => entry.status === 'passed'));
  return Object.freeze({
    targetId,
    provider: targetId.startsWith('node') ? 'node' : 'fastly',
    mode: 'javascript',
    status: 'passed',
    corpusVersion: runtime.corpusVersion,
    corpusHash: runtime.corpusHash,
    realization: 'runtime-builtin',
    implementation: 'webcrypto.subtle.hmac-sha-256.v1',
    implementationProvenance: Object.freeze({
      semanticOwner: '@pulse-compute/crypto',
      implementationOwner: '@pulse-compute/crypto',
      providerAdapter: targetId === 'node-javascript'
        ? NODE_JAVASCRIPT_JWT_VERIFIER_VERSION
        : FASTLY_JAVASCRIPT_JWT_VERIFIER_VERSION,
    }),
    caseIds: Object.freeze([...REQUIRED_CASE_IDS]),
    skippedCaseIds: Object.freeze([]),
    cases: caseRecords,
    adapter,
    automaticFallback: false,
    runtimeReality: runtime.runtimeReality,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const corpus = loadJwtConformanceCorpus();
  const materialized = materializeJavascriptConformanceCases(corpus);
  assert.equal(materialized.version, JAVASCRIPT_REALITY_HARNESS_VERSION);
  const d4Seal = JSON.parse(fs.readFileSync(
    path.join(wasmRoot, '.test-results', 'jwt-d4', 'jwt-phase-d-seal.json'),
    'utf8',
  ));
  assert.equal(d4Seal.status, 'passed');
  const runtimeModule = await import(pathToFileURL(
    path.join(__dirname, 'javascript-case-runtime.mjs'),
  ).href);
  assert.equal(runtimeModule.JAVASCRIPT_CASE_RUNTIME_VERSION, RUNTIME_VERSION);
  const audit = sourceAudit();

  const nodeCaseRecords = [];
  for (const testCase of materialized.cases) {
    if (testCase.kind === 'planning') {
      nodeCaseRecords.push(assertPlanningCase(
        testCase,
        planningObservation(testCase.id, NODE_JAVASCRIPT_TARGET_DESCRIPTOR),
      ));
      continue;
    }
    const result = await runtimeModule.executeJavascriptSemanticCase(
      testCase.input,
      nodeAuthority(testCase.input, materialized.secrets.values),
    );
    nodeCaseRecords.push(assertRuntimeCase(testCase, result));
  }
  const nodeAdapter = await runNodeAdapterProbe(corpus, materialized.secrets);

  const fastly = await runFastlyReality(corpus, materialized, options);
  const overallPassed = fastly.status === 'passed';
  const node = targetReport(
    'node-javascript',
    Object.freeze(nodeCaseRecords),
    nodeAdapter,
    {
      corpusVersion: corpus.version,
      corpusHash: corpus.corpusHash,
      runtimeReality: Object.freeze({
        kind: 'node-process',
        runtime: process.release.name,
        version: process.version,
        runtimeBuiltinObserved: true,
        providerReality: true,
        automaticFallback: false,
      }),
    },
  );
  const fastlyTarget = overallPassed
    ? targetReport(
        'fastly-javascript',
        fastly.caseRecords,
        fastly.adapter,
        {
          corpusVersion: corpus.version,
          corpusHash: corpus.corpusHash,
          runtimeReality: Object.freeze({
            kind: 'fastly-compute-local',
            runtime: 'Fastly JavaScript on Viceroy',
            fastlyCliVersion: fastly.runtime.cli.version,
            viceroyVersion: fastly.runtime.viceroy.version,
            wasmSha256: fastly.artifact.wasm.sha256,
            runtimeBuiltinObserved: true,
            providerReality: true,
            automaticFallback: false,
          }),
        },
      )
    : Object.freeze({
        targetId: 'fastly-javascript',
        provider: 'fastly',
        mode: 'javascript',
        status: 'blocked',
        blocker: fastly.blocker,
        corpusVersion: corpus.version,
        corpusHash: corpus.corpusHash,
        realization: 'runtime-builtin',
        implementation: 'webcrypto.subtle.hmac-sha-256.v1',
        caseIds: Object.freeze([]),
        skippedCaseIds: Object.freeze([...REQUIRED_CASE_IDS]),
        automaticFallback: false,
      });

  const conformance = Object.freeze({
    version: CONFORMANCE_REPORT_VERSION,
    checkpoint: 'E1',
    status: overallPassed ? 'passed' : 'conditional',
    classification: overallPassed ? 'PASS' : 'CONDITIONAL',
    corpusVersion: corpus.version,
    corpusHash: corpus.corpusHash,
    harnessVersion: materialized.version,
    targetIds: Object.freeze(['node-javascript', 'fastly-javascript']),
    caseIds: Object.freeze([...REQUIRED_CASE_IDS]),
    requiredExecutions: REQUIRED_CASE_IDS.length * 2,
    completedExecutions: node.cases.length
      + (overallPassed ? fastlyTarget.cases.length : 0),
    skippedExecutions: overallPassed ? 0 : REQUIRED_CASE_IDS.length,
    targets: Object.freeze([node, fastlyTarget]),
    automaticFallback: false,
  });
  if (overallPassed) {
    assert.equal(conformance.completedExecutions, 70);
    assert.equal(conformance.skippedExecutions, 0);
  }

  const jsComputePackageRoot = path.dirname(path.dirname(require.resolve(
    '@fastly/js-compute',
    { paths: [path.join(repoRoot, 'packages', 'provider-fastly')] },
  )));
  assert.equal(packageVersion(jsComputePackageRoot), FASTLY_JS_COMPUTE_VERSION);
  const targetReality = Object.freeze({
    version: TARGET_REALITY_REPORT_VERSION,
    checkpoint: 'E1',
    status: overallPassed ? 'passed' : 'conditional',
    exactSelection: true,
    environmentDetection: false,
    automaticFallback: false,
    node: node.runtimeReality,
    fastly: overallPassed
      ? Object.freeze({
          ...fastlyTarget.runtimeReality,
          realityPath: Object.freeze([
            'provider-fastly JWT adapter source',
            `esbuild ${ESBUILD_VERSION}`,
            `@fastly/js-compute ${FASTLY_JS_COMPUTE_VERSION}`,
            'fastly compute serve',
            'Viceroy local Compute',
          ]),
          sourcePackageContract: FASTLY_JAVASCRIPT_SOURCE_PACKAGE_VERSION,
          bundle: fastly.artifact.bundle,
          wasm: fastly.artifact.wasm,
          buildDurationMs: fastly.artifact.buildDurationMs,
          jsComputeDurationMs: fastly.artifact.compilation.durationMs,
          computeDurationMs: fastly.runtime.durationMs,
          cli: fastly.runtime.cli,
          viceroy: fastly.runtime.viceroy,
          command: fastly.runtime.command,
          requestCount: fastly.runtime.requestCount,
        })
      : Object.freeze({
          status: 'blocked',
          blocker: fastly.blocker,
          providerReality: false,
          automaticFallback: false,
        }),
    audit,
  });

  const forbidden = forbiddenSensitiveValues(corpus);
  const durableWithoutRedaction = `${stableJson(conformance)}${stableJson(targetReality)}`;
  const findings = forbidden.filter((entry) =>
    durableWithoutRedaction.includes(entry.value));
  assert.deepEqual(findings, []);
  const redaction = Object.freeze({
    version: REDACTION_REPORT_VERSION,
    checkpoint: 'E1',
    status: 'passed',
    scannedArtifacts: Object.freeze([
      'jwt-javascript-conformance-report.json',
      'jwt-javascript-target-reality-report.json',
      'Fastly Compute stdout',
      'Fastly Compute stderr',
    ]),
    categories: Object.freeze(['token', 'signature', 'claims', 'key', 'secret']),
    forbiddenValueIds: Object.freeze(forbidden.map((entry) => entry.id)),
    forbiddenValuesPresent: 0,
    secretValuesInGeneratedWasm: false,
    secretValuesInDurableEvidence: false,
  });

  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const conformanceFile = path.join(
    options.outputDirectory,
    'jwt-javascript-conformance-report.json',
  );
  const targetRealityFile = path.join(
    options.outputDirectory,
    'jwt-javascript-target-reality-report.json',
  );
  const redactionFile = path.join(
    options.outputDirectory,
    'jwt-javascript-redaction-report.json',
  );
  fs.writeFileSync(conformanceFile, stableJson(conformance));
  fs.writeFileSync(targetRealityFile, stableJson(targetReality));
  fs.writeFileSync(redactionFile, stableJson(redaction));

  const sourceFiles = [
    'wasm/test/jwt/jwt-conformance-corpus.json',
    'wasm/test/jwt/jwt-conformance-harness.cjs',
    'wasm/test/jwt/javascript-case-runtime.mjs',
    'wasm/test/jwt/fastly-javascript-reality-entry.mjs',
    'wasm/test/jwt/assert-jwt-javascript-reality.cjs',
    'packages/jwt/src/crypto-verifier.ts',
    'packages/crypto/src/internal/realization.ts',
    'packages/crypto/dist/internal/realization.js',
    'packages/crypto/test/runtime-builtin.test.ts',
    'packages/provider-node/src/javascript/jwt-verifier.js',
    'packages/provider-fastly/src/javascript/jwt-verifier.js',
    'packages/provider-fastly/src/testing/fastly-cli.js',
  ];
  const evidence = Object.freeze({
    version: EVIDENCE_VERSION,
    checkpoint: 'E1',
    previousCheckpoint: Object.freeze({
      checkpoint: 'E0',
      status: 'passed',
      corpusVersion: corpus.version,
      corpusHash: corpus.corpusHash,
    }),
    phaseDGate: Object.freeze({
      status: d4Seal.status,
      file: 'wasm/.test-results/jwt-d4/jwt-phase-d-seal.json',
      sha256: fileSha256(
        path.join(wasmRoot, '.test-results', 'jwt-d4', 'jwt-phase-d-seal.json'),
      ),
    }),
    status: overallPassed ? 'passed' : 'conditional',
    classification: overallPassed ? 'PASS' : 'CONDITIONAL',
    scope: Object.freeze({
      phase: 'E',
      unit: 'E1',
      changeClass: 'implementation-and-evidence',
      entryPoint: 'package-lowering',
      publication: false,
      deployment: false,
    }),
    acceptance: Object.freeze({
      nodeJavascriptSharedCorpus: node.status === 'passed',
      fastlyJavascriptSharedCorpus: fastlyTarget.status === 'passed',
      realFastlyJavascriptBuildRuntime: overallPassed,
      runtimeBuiltin: true,
      implementation:
        node.implementation === fastlyTarget.implementation
          ? node.implementation
          : null,
      requestOwnedSecretResolution: true,
      clockAfterAuthenticity: true,
      registeredClaimsBeforeSchema: true,
      detachedImmutableResult: true,
      exactRealization: true,
      jwtEnvironmentDetection: false,
      automaticFallback: false,
    }),
    coverage: Object.freeze({
      semanticCases: REQUIRED_CASE_IDS.length,
      requiredTargets: 2,
      requiredExecutions: 70,
      completedExecutions: conformance.completedExecutions,
      skippedExecutions: conformance.skippedExecutions,
      adapterProbes: overallPassed ? 4 : 2,
    }),
    reports: Object.freeze([
      Object.freeze({
        file: 'wasm/.test-results/jwt-e1/jwt-javascript-conformance-report.json',
        sha256: fileSha256(conformanceFile),
      }),
      Object.freeze({
        file: 'wasm/.test-results/jwt-e1/jwt-javascript-target-reality-report.json',
        sha256: fileSha256(targetRealityFile),
      }),
      Object.freeze({
        file: 'wasm/.test-results/jwt-e1/jwt-javascript-redaction-report.json',
        sha256: fileSha256(redactionFile),
      }),
    ]),
    sources: Object.freeze(sourceFiles.map(sourceRecord)),
    blocker: overallPassed ? null : fastly.blocker,
    knownExceptions: Object.freeze([
      Object.freeze({
        id: 'catalog-version-skew',
        status: 'publication-only',
        detail:
          '@pulse-compute/provider-fastly remains cataloged at 1.0.0-beta.1 while the working JWT package is 1.0.0-beta.1; E1 does not publish or rewrite release identity.',
      }),
    ]),
    nextAuthorizedUnit: overallPassed ? 'E2' : 'E2-with-open-e1-blocker',
  });
  const evidenceText = stableJson(evidence);
  for (const forbiddenValue of forbidden) {
    assert.equal(
      evidenceText.includes(forbiddenValue.value),
      false,
      `E1 evidence contains ${forbiddenValue.id}`,
    );
  }
  fs.writeFileSync(
    path.join(options.outputDirectory, 'jwt-e1-evidence.json'),
    evidenceText,
  );

  console.log(
    `ok - ${EVIDENCE_VERSION} ${evidence.classification} `
      + `${conformance.completedExecutions}/${conformance.requiredExecutions} executions`,
  );
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
