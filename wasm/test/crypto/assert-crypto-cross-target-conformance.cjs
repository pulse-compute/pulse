#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');

const {
  buildWorkspacePackage
} = require('../support/workspace-package-build.cjs');
const {
  normalizeCryptoConfiguration,
  normalizeCryptoRequirements,
  defineCryptoTargetCapabilities
} = require('../../packages/contracts/src/crypto/contracts.js');
const {
  planProjectCrypto
} = require('../../packages/compiler/src/crypto-requirement-planner.js');
const {
  buildCanonicalNativePlan
} = require('../../packages/compiler/src/canonical-native-plan.js');
const {
  compileCanonicalNativePlan
} = require('../../packages/compiler/src/canonical-native-compiler.js');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host.js');
const {
  createNodeProviderAdapter
} = require('../../../packages/provider-node/src/runtime/canonical-api-runtime.js');
const {
  NODE_NATIVE_TARGET_DESCRIPTOR
} = require('../../../packages/provider-node/src/native/target.js');
const {
  EXAMPLES,
  compileExample
} = require('../support/canonical-projects.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const wasmRoot = path.join(repoRoot, 'wasm');
const corpusFile = path.join(repoRoot, 'packages', 'crypto', 'conformance', 'hs256.json');
process.chdir(repoRoot);

function parseArguments(argv) {
  let outputDirectory = path.join(wasmRoot, '.test-results', 'crypto-c4');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete crypto conformance option: ${argv[index]}`);
    }
    outputDirectory = path.resolve(repoRoot, argv[index + 1]);
    index += 1;
  }
  return Object.freeze({ outputDirectory });
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function filesUnder(root, predicate, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(file, predicate, out);
    else if (entry.isFile() && predicate(file)) out.push(file);
  }
  return out;
}

function selectedPlan(targetDescriptor = NODE_NATIVE_TARGET_DESCRIPTOR) {
  return planProjectCrypto({
    declaration: normalizeCryptoConfiguration(['HS256']),
    requirements: normalizeCryptoRequirements([{
      algorithm: 'HS256',
      requestedBy: '@pulse-compute/crypto'
    }]),
    targetDescriptor,
    target: 'native',
    profile: 'native'
  });
}

function compiledWithCrypto(realizationPlan = selectedPlan()) {
  const base = compileExample(EXAMPLES.hello).compiled;
  return Object.freeze({
    ...base,
    cryptoRealizationPlan: realizationPlan
  });
}

function compileNative(realizationPlan, nativeOptimization) {
  return compileCanonicalNativePlan(
    buildCanonicalNativePlan(compiledWithCrypto(realizationPlan)),
    {
      cwd: repoRoot,
      ...(nativeOptimization ? { nativeOptimization } : {})
    }
  );
}

function compileNativeBaseline(nativeOptimization) {
  return compileCanonicalNativePlan(
    buildCanonicalNativePlan(compileExample(EXAMPLES.hello).compiled),
    {
      cwd: repoRoot,
      ...(nativeOptimization ? { nativeOptimization } : {})
    }
  );
}

function controllerFor(compiled) {
  return nativeHost.instantiateCanonicalNativeModule(compiled, {
    providerAdapter: createNodeProviderAdapter()
  });
}

function stage(memory, inputs) {
  const padding = 64;
  const start = memory.buffer.byteLength;
  const required = inputs.reduce(
    (total, input) => total + Math.max(input.length, 1) + padding,
    padding
  );
  memory.grow(Math.ceil(required / 65536));
  const view = new Uint8Array(memory.buffer);
  const pointers = [];
  let cursor = start + padding;
  for (const input of inputs) {
    pointers.push(cursor);
    view.set(input, cursor);
    cursor += Math.max(input.length, 1) + padding;
  }
  return Object.freeze(pointers);
}

function verifyNative(controller, input) {
  if (input.nativeMalformedKey) {
    const [dataPointer, tagPointer] = stage(controller.exports.memory, [input.data, input.tag]);
    const memoryEnd = controller.exports.memory.buffer.byteLength;
    return controller.exports.pulse_crypto_hs256_verify(
      memoryEnd - 8,
      32,
      dataPointer,
      input.data.length,
      tagPointer,
      input.tag.length
    );
  }
  if (input.nativeMalformedTag) {
    const [keyPointer, dataPointer] = stage(controller.exports.memory, [input.key, input.data]);
    const memoryEnd = controller.exports.memory.buffer.byteLength;
    return controller.exports.pulse_crypto_hs256_verify(
      keyPointer,
      input.key.length,
      dataPointer,
      input.data.length,
      memoryEnd - 8,
      32
    );
  }
  if (input.nativeOverLimit) {
    const [keyPointer, tagPointer] = stage(controller.exports.memory, [input.key, input.tag]);
    return controller.exports.pulse_crypto_hs256_verify(
      keyPointer,
      input.key.length,
      0,
      input.data.length,
      tagPointer,
      input.tag.length
    );
  }
  const [keyPointer, dataPointer, tagPointer] = stage(
    controller.exports.memory,
    [input.key, input.data, input.tag]
  );
  return controller.exports.pulse_crypto_hs256_verify(
    keyPointer,
    input.key.length,
    dataPointer,
    input.data.length,
    tagPointer,
    input.tag.length
  );
}

function statusForNative(code) {
  const statuses = new Map([
    [1, 'valid'],
    [0, 'invalid-authenticator'],
    [-1, 'invalid-key'],
    [-2, 'invalid-input'],
    [-3, 'realization-failure']
  ]);
  assert.equal(statuses.has(code), true, `unknown Native crypto result code ${code}`);
  return statuses.get(code);
}

function fixtureFor(corpus, name) {
  const published = corpus.publishedVectors.find((entry) => entry.id === name);
  if (published) {
    return {
      key: Buffer.alloc(published.keyLength, published.keyByte),
      data: Buffer.from(published.dataHex, 'hex'),
      tag: Buffer.from(published.tagHex, 'hex')
    };
  }
  const boundary = name === 'empty-data'
    ? corpus.boundaryVectors.emptyData
    : name === 'maximum-data'
      ? corpus.boundaryVectors.maximumData
      : null;
  if (!boundary) throw new Error(`Unknown C4 crypto fixture ${name}`);
  return {
    key: Buffer.alloc(boundary.keyLength, boundary.keyByte),
    data: Buffer.alloc(boundary.dataLength, boundary.dataByte),
    tag: Buffer.from(boundary.tagHex, 'hex')
  };
}

function materializeCase(corpus, definition) {
  const fixture = fixtureFor(corpus, definition.fixture);
  const input = {
    key: Buffer.from(fixture.key),
    data: Buffer.from(fixture.data),
    tag: Buffer.from(fixture.tag),
    jsMalformedKey: false,
    jsMalformedTag: false,
    nativeMalformedKey: false,
    nativeMalformedTag: false,
    nativeOverLimit: false
  };
  const mutation = definition.mutation;
  if (mutation === 'none') return input;
  if (mutation === 'zero-tag') input.tag.fill(0);
  else if (/^tag-byte-\d+$/.test(mutation)) input.tag[Number(mutation.slice(9))] ^= 0x01;
  else if (mutation === 'data-byte-0') input.data[0] ^= 0x01;
  else if (mutation === 'key-byte-0') input.key[0] ^= 0x01;
  else if (mutation === 'key-length-31') input.key = Buffer.alloc(31, 0x2a);
  else if (mutation === 'malformed-key') {
    input.jsMalformedKey = true;
    input.nativeMalformedKey = true;
  } else if (mutation === 'data-over-limit') {
    input.data = Buffer.alloc(corpus.resourceLimits.macDataBytesMaximum + 1, 0xa5);
    input.nativeOverLimit = true;
  } else if (mutation === 'malformed-tag') {
    input.jsMalformedTag = true;
    input.nativeMalformedTag = true;
  } else if (mutation === 'tag-length-31') input.tag = input.tag.subarray(0, 31);
  else throw new Error(`Unknown C4 crypto mutation ${mutation}`);
  return input;
}

async function verifyJavascript(cryptoApi, input) {
  const request = {
    algorithm: 'HS256',
    key: {
      type: 'hmac-key-bytes',
      bytes: input.jsMalformedKey ? 'malformed-key' : new Uint8Array(input.key)
    },
    data: new Uint8Array(input.data),
    tag: input.jsMalformedTag ? 'malformed-tag' : new Uint8Array(input.tag)
  };
  const result = await cryptoApi.mac.verify(request);
  assert.deepEqual(Object.keys(result), ['status']);
  return result.status;
}

function sizeImpact(baseline, realized) {
  const deltaBytes = realized.wasm.length - baseline.wasm.length;
  return Object.freeze({
    baselineBytes: baseline.wasm.length,
    hs256Bytes: realized.wasm.length,
    deltaBytes,
    deltaPercent: Number(((deltaBytes / baseline.wasm.length) * 100).toFixed(2)),
    baselineSha256: sha256(baseline.wasm),
    hs256Sha256: sha256(realized.wasm)
  });
}

function assertJwtIntegrationDisposition() {
  const jwtRoot = path.join(repoRoot, 'packages', 'jwt');
  const jwtManifest = JSON.parse(fs.readFileSync(path.join(jwtRoot, 'package.json'), 'utf8'));
  assert.equal(
    jwtManifest.dependencies['@pulse-compute/crypto'],
    'workspace:*',
    'The current tree must retain the Phase D JWT-to-crypto dependency'
  );
  const sourceFiles = filesUnder(
    path.join(jwtRoot, 'src'),
    (file) => /\.(?:ts|js|cjs|mjs)$/.test(file)
  );
  const source = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.match(source, /@pulse-compute\/crypto/);
  assert.match(source, /cryptoMacVerify/);
  const release = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'release', 'pulse-release-manifest.json'),
    'utf8'
  ));
  assert.equal(release.packages.some((entry) => entry.name === '@pulse-compute/crypto'), true);
  assert.equal(release.packages.some((entry) => entry.name === '@pulse-compute/jwt'), true);
  return Object.freeze({
    packageDependency: true,
    dependencyRange: 'workspace:*',
    sourceImport: true,
    completeComposition: true,
    semanticOwner: '@pulse-compute/crypto',
    releaseAssigned: true,
    automaticFallback: false
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const corpusBytes = fs.readFileSync(corpusFile);
  const corpus = JSON.parse(corpusBytes);
  assert.equal(corpus.version, 'pulse.crypto.hs256-conformance.v2');
  assert.deepEqual(corpus.resultStatuses, [
    'valid',
    'invalid-authenticator',
    'invalid-key',
    'invalid-input',
    'realization-failure'
  ]);
  assert.equal(corpus.publishedVectors.length, 2);
  assert.equal(corpus.verificationCases.length, 14);

  const packageBuild = buildWorkspacePackage('packages/crypto');
  const publicModule = await import(`${pathToFileURL(packageBuild.entry).href}?pulse-c4=${process.pid}`);
  const verificationModule = await import(
    `${pathToFileURL(path.join(packageBuild.outputRoot, 'internal', 'verification.js')).href}?pulse-c4=${process.pid}`
  );
  const realizationModule = await import(
    `${pathToFileURL(path.join(packageBuild.outputRoot, 'internal', 'realization.js')).href}?pulse-c4=${process.pid}`
  );

  const realizationPlan = selectedPlan();
  const nativeDefault = compileNative(realizationPlan);
  const nativeSize = compileNative(realizationPlan, 'experimental-native-size');
  const baselineDefault = compileNativeBaseline();
  const baselineSize = compileNativeBaseline('experimental-native-size');
  assert.equal(nativeDefault.guestUnits.length, 0);
  assert.equal(nativeDefault.guestLink, undefined);
  assert.equal(nativeDefault.manifest.crypto.algorithms[0].realization, 'guest-source:pulse-hmac-as');
  assert.equal(nativeDefault.manifest.crypto.automaticFallback, false);
  assert.equal(nativeSize.manifest.crypto.automaticFallback, false);

  const controllers = [
    Object.freeze({ mode: 'default', controller: controllerFor(nativeDefault) }),
    Object.freeze({ mode: 'experimental-native-size', controller: controllerFor(nativeSize) })
  ];
  const caseEvidence = [];
  for (const definition of corpus.verificationCases) {
    const input = materializeCase(corpus, definition);
    const javascript = await verifyJavascript(publicModule.crypto, input);
    assert.equal(javascript, definition.expected, `${definition.id} JavaScript`);
    const native = [];
    for (const entry of controllers) {
      const status = statusForNative(verifyNative(entry.controller, input));
      assert.equal(status, definition.expected, `${definition.id} Native ${entry.mode}`);
      native.push(Object.freeze({ optimization: entry.mode, status }));
    }
    caseEvidence.push(Object.freeze({
      id: definition.id,
      expected: definition.expected,
      javascript,
      native: Object.freeze(native)
    }));
  }

  const normalized = verificationModule.normalizeMacVerifyRequest({
    algorithm: 'HS256',
    key: {
      type: 'hmac-key-bytes',
      bytes: new Uint8Array(Buffer.alloc(32, 0x2a))
    },
    data: new Uint8Array(),
    tag: new Uint8Array(Buffer.from(corpus.boundaryVectors.emptyData.tagHex, 'hex'))
  });
  assert.equal(normalized.ok, true);
  const javascriptFailure = await realizationModule.verifyHs256WithSubtle(
    normalized.request,
    undefined
  );
  assert.equal(javascriptFailure.status, 'realization-failure');

  const unavailableTarget = {
    crypto: defineCryptoTargetCapabilities({
      target: 'native',
      algorithms: [{
        algorithm: 'HS256',
        realization: 'guest-source:pulse-hmac-as',
        implemented: false,
        status: 'unavailable-c4-proof'
      }]
    })
  };
  const unavailablePlan = selectedPlan(unavailableTarget);
  let nativeFailure;
  try {
    compileNative(unavailablePlan);
    assert.fail('an unavailable Native realization must fail');
  } catch (error) {
    assert.equal(error && error.code, 'PULSE_CRYPTO_REALIZATION_UNAVAILABLE');
    assert.equal(error && error.detail && error.detail.automaticFallback, false);
    nativeFailure = Object.freeze({
      status: 'realization-failure',
      code: error.code,
      automaticFallback: error.detail.automaticFallback
    });
  }

  const secretKey = Buffer.from('phase-c-secret-marker-never-report-0001', 'ascii');
  const secretData = Buffer.from('phase-c-sensitive-data', 'ascii');
  const secretTag = crypto.createHmac('sha256', secretKey).update(secretData).digest();
  const secretInput = {
    key: secretKey,
    data: secretData,
    tag: secretTag,
    jsMalformedKey: false,
    jsMalformedTag: false,
    nativeMalformedKey: false,
    nativeMalformedTag: false,
    nativeOverLimit: false
  };
  assert.equal(await verifyJavascript(publicModule.crypto, secretInput), 'valid');
  assert.equal(statusForNative(verifyNative(controllers[0].controller, secretInput)), 'valid');

  const jsFiles = filesUnder(
    packageBuild.outputRoot,
    (file) => file.endsWith('.js')
  ).sort();
  const jsBuffers = jsFiles.map((file) => fs.readFileSync(file));
  const jsBytes = jsBuffers.reduce((total, value) => total + value.length, 0);
  const jsGzipBytes = zlib.gzipSync(Buffer.concat(jsBuffers), { level: 9 }).length;
  const jwtIntegration = assertJwtIntegrationDisposition();

  const report = Object.freeze({
    version: 'pulse.crypto.cross-target-conformance.v2',
    status: 'passed',
    corpus: Object.freeze({
      version: corpus.version,
      sha256: sha256(corpusBytes),
      sources: Object.freeze({ ...corpus.sources }),
      publishedVectors: corpus.publishedVectors.length,
      verificationCases: corpus.verificationCases.length,
      configurationCases: Object.freeze([...corpus.configurationCases])
    }),
    resultTaxonomy: Object.freeze({
      statuses: Object.freeze([...corpus.resultStatuses]),
      identicalAcrossRealizations: true,
      nativeCodes: Object.freeze({
        valid: 1,
        invalidAuthenticator: 0,
        invalidKey: -1,
        invalidInput: -2,
        realizationFailure: -3
      })
    }),
    realizations: Object.freeze({
      javascript: Object.freeze({
        kind: 'runtime-builtin',
        backend: 'Web Crypto',
        automaticFallback: false,
        realizationFailure: javascriptFailure.status
      }),
      native: Object.freeze({
        kind: 'guest-source',
        realization: 'guest-source:pulse-hmac-as',
        backend: 'pulse-hmac-as',
        automaticFallback: false,
        guestLinked: false,
        realizationFailure: nativeFailure
      })
    }),
    cases: Object.freeze(caseEvidence),
    impact: Object.freeze({
      javascript: Object.freeze({
        measurement: 'standalone emitted runtime modules; host Web Crypto implementation excluded',
        moduleCount: jsFiles.length,
        runtimeBytes: jsBytes,
        gzipBytes: jsGzipBytes,
        hostBuiltinBytes: 0,
        incrementalRuntimeBytes: jsBytes
      }),
      native: Object.freeze({
        default: sizeImpact(baselineDefault, nativeDefault),
        experimentalNativeSize: sizeImpact(baselineSize, nativeSize),
        guestSourceBytes: nativeDefault.manifest.crypto.algorithms[0].sourceBytes
      })
    }),
    security: Object.freeze({
      publishedPrimarySourceVectors: true,
      boundedInputs: true,
      minimumKeyBytes: corpus.resourceLimits.hmacKeyBytesMinimum,
      constantTimeFullTagScan: true,
      malformedRangesNormalized: true,
      reportRedaction: true,
      noFallbackAfterRealizationFailure: true
    }),
    boundaries: Object.freeze({
      jwtIntegration,
      guestLinkRequiredForHs256: false,
      guestLinkedCrypto: false,
      signing: false,
      asymmetricCrypto: false,
      publicCustomCryptoProviders: false
    })
  });

  const serialized = stableJson(report);
  for (const marker of [
    secretKey.toString('ascii'),
    secretKey.toString('hex'),
    secretData.toString('ascii'),
    secretData.toString('hex'),
    secretTag.toString('hex')
  ]) {
    assert.equal(serialized.includes(marker), false, 'C4 report must not contain secret test material');
  }

  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const reportFile = path.join(options.outputDirectory, 'crypto-cross-target-conformance.json');
  fs.writeFileSync(reportFile, serialized);
  console.log(
    `ok - ${caseEvidence.length} shared HS256 cases match across Web Crypto and two Native optimization modes; evidence ${sha256(serialized)}`
  );
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
