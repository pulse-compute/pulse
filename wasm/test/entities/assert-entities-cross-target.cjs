#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const fixtureRoot = path.join(repoRoot, 'wasm/test/fixtures/projects/entities-cross-target');
const corpusFile = path.join(__dirname, 'entities-cross-target-corpus.json');
const reportRoot = path.join(repoRoot, 'wasm/.test-results/entities-i9');
const compilerRoot = path.join(repoRoot, 'wasm/packages/compiler');
const deterministicJsComputeEnvironment = path.join(repoRoot, 'wasm/test/support/deterministic-js-compute-environment.cjs');
const jsComputeRuntimeCli = path.join(repoRoot, 'packages/provider-fastly/node_modules/@fastly/js-compute/dist/cli/js-compute-runtime-cli.js');
const jsComputeCacheRoot = path.join(os.tmpdir(), 'pulse-entities-i9-js-compute-cache');
const sensitiveSecret = 'entities-i9-sensitive-secret';
const reportVersion = 'pulse.entities-four-mode-conformance.i9.v1';
process.chdir(repoRoot);

const { resolveProject } = require('../../packages/cli/src/project-config.js');
const {
  buildProject,
  compileProject,
  prepareJavascriptApplication
} = require('../../packages/cli/src/project-execution.js');
const { getProviderDriver } = require('../../packages/cli/src/provider-drivers.js');
const { createCanonicalSchemaCodecs } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const entitiesLowerer = require('../../../packages/entities/pulsewasm.compiler.cjs');
const entitiesNative = require('../../../packages/entities/pulsewasm.native.cjs');
const fastlyEntitiesNative = require('../../../packages/provider-fastly/src/build/entities-native.js');
const graphApi = require('../../packages/compiler/src/project/reachable-graph-builder.js');
const managed = require('../../packages/compiler/src/spine/handler-ir-managed.js');
const {
  inspectFastlyComputeLauncher,
  renderFastlyLocalConfig,
  requestFastlyCompute,
  startFastlyComputeServe
} = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const {
  classifyNodeJavascriptCapability
} = require('../../../packages/provider-node/src/javascript/target-support-policy.js');
const {
  classifyFastlyJavascriptCapability
} = require('../../../packages/provider-fastly/src/javascript/target-support-policy.js');
const fastlyEsbuild = require('../../../packages/provider-fastly/node_modules/esbuild');

const assemblyScriptRoot = path.dirname(require.resolve('assemblyscript/package.json', { paths: [compilerRoot] }));
const asc = path.join(assemblyScriptRoot, 'bin/asc.js');
const jsonAsTransform = require.resolve('json-as', { paths: [compilerRoot] });
const jsonAsRoot = path.resolve(jsonAsTransform, '..', '..', '..');
const jsonAsDependencyRoot = path.dirname(jsonAsRoot);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function semanticHash(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

function wasmStaticSectionHash(bytes) {
  assert.equal(Buffer.from(bytes.subarray(0, 8)).toString('hex'), '0061736d01000000', 'runtime output must be WebAssembly 1.0');
  const included = new Set([1, 2, 3, 7, 10, 13]);
  const hash = crypto.createHash('sha256');
  hash.update(bytes.subarray(0, 8));
  let offset = 8;
  while (offset < bytes.byteLength) {
    const sectionStart = offset;
    const id = bytes[offset++];
    let size = 0;
    let shift = 0;
    while (true) {
      assert.ok(offset < bytes.byteLength && shift <= 28, 'runtime Wasm section length must be bounded u32 LEB128');
      const byte = bytes[offset++];
      size |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    const sectionEnd = offset + (size >>> 0);
    assert.ok(sectionEnd <= bytes.byteLength, 'runtime Wasm section must stay inside the module');
    if (included.has(id)) hash.update(bytes.subarray(sectionStart, sectionEnd));
    offset = sectionEnd;
  }
  assert.equal(offset, bytes.byteLength);
  return hash.digest('hex');
}

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs || 300_000,
    shell: false
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `\n${detail}` : ''}`, { cause: result.error });
  }
  return Object.freeze({ durationMs: Date.now() - startedAt, stdout: result.stdout, stderr: result.stderr });
}

function materializeCorpus() {
  const source = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
  assert.equal(source.version, 'pulse.entities-cross-target-corpus.i9.v1');
  const runtimeCases = source.runtimeCases.map((entry) => {
    let body = entry.body;
    if (entry.materialize && entry.materialize.kind === 'oversized-method') {
      body = JSON.stringify({ jsonrpc: '2.0', method: 'x'.repeat(entry.materialize.bytes), id: 11 });
    }
    assert.equal(typeof body, 'string', entry.id);
    return Object.freeze({ ...entry, body });
  });
  return Object.freeze({
    source,
    runtimeCases: Object.freeze(runtimeCases),
    planningCases: Object.freeze([...source.planningCases]),
    semanticHash: semanticHash(source)
  });
}

function descriptorFromEntry(entry) {
  const start = entry.loc && entry.loc.start || { line: 1, column: 1 };
  return Object.freeze({
    version: managed.MANAGED_HANDLER_DESCRIPTOR_VERSION,
    id: `${entry.router}:${entry.discriminator}`,
    role: managed.MANAGED_HANDLER_ROLE,
    origin: Object.freeze({ file: entry.loc.file, line: start.line, column: start.column }),
    source: Object.freeze({
      file: entry.handler.file,
      exportName: entry.handler.exportName,
      localName: entry.handler.localName
    }),
    input: Object.freeze({
      kind: entry.inputSchema === null ? 'empty-value' : 'schema-value',
      schemaId: entry.inputSchema
    }),
    result: Object.freeze({
      kind: entry.outputSchema === null ? 'completion' : 'schema-value',
      schemaId: entry.outputSchema
    })
  });
}

function compileEntitiesModel() {
  const project = resolveProject({ cwd: fixtureRoot, profile: 'node-javascript' });
  const compiled = compileProject(project);
  const graphBuild = graphApi.buildReachableProjectGraph(project.entryFile, {
    rootDir: fixtureRoot,
    workspaceRoot: repoRoot,
    configFile: project.configFile
  });
  const lowered = entitiesLowerer.createEntitiesPackageCompilerBuilder({
    cwd: fixtureRoot,
    sourcePath: project.entryFile,
    sourceText: fs.readFileSync(project.entryFile, 'utf8'),
    schemaBundle: compiled.schema.bundle
  });
  assert.equal(lowered.hasErrors, false, lowered.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join('\n'));
  const descriptors = lowered.entries.map(descriptorFromEntry);
  const managedBundle = managed.compileManagedHandlerDescriptors({ graphBuild, descriptors });
  const nativeBundle = managed.compileManagedHandlerNativeBundle(managedBundle);
  const nativeSource = entitiesNative.buildEntitiesNativeSource({
    plan: lowered.artifact.plan,
    managedHandlerNativeBundle: nativeBundle,
    schemaBundle: compiled.schema.bundle
  });
  const effectBindings = [];
  let effectIndex = 0;
  for (const route of nativeSource.discriminatorTable) {
    const handler = nativeBundle.handlers.find((entry) => entry.id === route.handlerId);
    assert.ok(handler, route.handlerId);
    for (const effect of handler.effects.sites) {
      effectBindings.push(Object.freeze({
        index: effectIndex++,
        id: effect.id,
        kind: effect.kind,
        ...(effect.kind === 'fetch'
          ? { origin: 'https://directory.example.test', backend: 'directory_backend' }
          : {})
      }));
    }
  }
  assert.equal(effectBindings.length, nativeSource.summary.effects);
  return Object.freeze({ project, compiled, lowered, managedBundle, nativeBundle, nativeSource, effectBindings: Object.freeze(effectBindings) });
}

function compileNodeNative(source, root, label) {
  fs.mkdirSync(root, { recursive: true });
  const input = path.join(root, 'entities-native.as.ts');
  const output = path.join(root, `${label}.wasm`);
  const wat = path.join(root, `${label}.wat`);
  fs.writeFileSync(input, source, 'utf8');
  const stage = run(process.execPath, [
    asc,
    path.basename(input),
    '--outFile', output,
    '--textFile', wat,
    '--runtime', 'incremental',
    '--exportRuntime',
    '--exportTable',
    '--noAssert',
    '-O3',
    '--transform', jsonAsTransform,
    '--path', jsonAsDependencyRoot,
    '--path', path.join(compilerRoot, 'node_modules')
  ], {
    cwd: root,
    timeoutMs: 180_000,
    env: { JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0' }
  });
  return Object.freeze({
    bytes: fs.readFileSync(output),
    wat: fs.readFileSync(wat, 'utf8'),
    durationMs: stage.durationMs
  });
}

function stringAt(exports, pointer, length) {
  if (pointer <= 0 || length <= 0) return '';
  const view = new Uint16Array(exports.memory.buffer, pointer, length);
  let output = '';
  for (let offset = 0; offset < view.length; offset += 4096) {
    output += String.fromCharCode(...view.subarray(offset, Math.min(view.length, offset + 4096)));
  }
  return output;
}

function allocateString(exports, value) {
  const text = String(value);
  const pointer = exports.__new(text.length * 2, exports.pulse_entities_string_id());
  const view = new Uint16Array(exports.memory.buffer, pointer, text.length);
  for (let index = 0; index < text.length; index += 1) view[index] = text.charCodeAt(index);
  return pointer;
}

function executeNodeNative(bytes, body) {
  const module = new WebAssembly.Module(bytes);
  let runtimeExports;
  const effects = [];
  const logs = [];
  const instance = new WebAssembly.Instance(module, {
    env: {
      abort() { throw new Error('Entities Native json-as abort'); },
      seed() { return 0; }
    },
    pulse_entities_host: {
      effect_begin(index, pointer, length) {
        effects.push(Object.freeze({ index, payload: JSON.parse(stringAt(runtimeExports, pointer, length)) }));
      },
      log(level, pointer, length) {
        logs.push(Object.freeze({ level, payload: JSON.parse(stringAt(runtimeExports, pointer, length)) }));
      }
    }
  });
  runtimeExports = instance.exports;
  assert.equal(runtimeExports.pulse_entities_set_request(allocateString(runtimeExports, body)), 1);
  let status = runtimeExports.pulse_entities_start();
  let consumed = 0;
  while (status === runtimeExports.pulse_entities_run_suspended()) {
    const pending = effects.slice(consumed);
    assert.ok(pending.length > 0, 'suspended Node Native execution must announce an effect');
    consumed = effects.length;
    for (const effect of pending) {
      let value;
      if (effect.payload.kind === 'config.get') value = 'conformance';
      else if (effect.payload.kind === 'secret.get') value = sensitiveSecret;
      else if (effect.payload.kind === 'fetch') value = 'Ada';
      else assert.fail(`unexpected Node Native effect ${effect.payload.kind}`);
      assert.equal(runtimeExports.pulse_entities_set_effect_result(
        effect.index,
        1,
        allocateString(runtimeExports, JSON.stringify(value))
      ), 1);
    }
    status = runtimeExports.pulse_entities_resume();
  }
  assert.equal(status, runtimeExports.pulse_entities_run_complete());
  const response = Object.freeze({
    status: runtimeExports.pulse_entities_response_status(),
    body: stringAt(
      runtimeExports,
      runtimeExports.pulse_entities_response_ptr(),
      runtimeExports.pulse_entities_response_length()
    )
  });
  assert.doesNotMatch(JSON.stringify({ response, logs }), new RegExp(sensitiveSecret));
  return Object.freeze({ response, effects: effects.length, logs: logs.length });
}

function observation(testCase, response, extra = {}) {
  const body = Buffer.isBuffer(response.body) ? response.body.toString('utf8') : String(response.body || '');
  let parsedBody = null;
  if (body.length > 0) {
    try { parsedBody = JSON.parse(body); }
    catch (error) {
      assert.fail(`${testCase.id}: expected a JSON or empty response, received ${JSON.stringify(body)} (${error.message})`);
    }
  }
  const normalized = Object.freeze({
    status: Number(response.status),
    body: parsedBody === null ? null : stableValue(parsedBody)
  });
  const expected = Object.freeze({
    status: testCase.expected.status,
    body: testCase.expected.empty ? null : stableValue(testCase.expected.json)
  });
  assert.deepEqual(normalized, expected, testCase.id);
  assert.doesNotMatch(JSON.stringify(normalized), new RegExp(sensitiveSecret), testCase.id);
  return Object.freeze({
    id: testCase.id,
    status: 'passed',
    semanticHash: semanticHash(normalized),
    responseStatus: normalized.status,
    responseKind: normalized.body === null ? 'empty' : 'json',
    ...extra
  });
}

async function runNodeJavascript(corpus, model) {
  const project = resolveProject({ cwd: fixtureRoot, profile: 'node-javascript' });
  const compiled = compileProject(project);
  const entitiesRuntime = await import(pathToFileURL(path.join(repoRoot, 'packages/entities/dist/index.js')).href);
  const prepared = prepareJavascriptApplication(project, {
    schemaBundle: compiled.schema.bundle,
    allowedPackages: { '@pulse-compute/entities': entitiesRuntime }
  });
  assert.equal(prepared.plan.loadable, true);
  assert.ok(prepared.loaded && prepared.loaded.application);
  const javascript = getProviderDriver('node', { projectRoot: fixtureRoot }).javascript;
  const schemaCodecs = createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
  const cases = [];
  let effects = 0;
  for (const testCase of corpus.runtimeCases) {
    const logs = [];
    const executed = await javascript.executeTestCase(prepared.loaded.application, {
      name: testCase.id,
      request: {
        method: 'POST',
        path: '/',
        headers: [['content-type', 'application/json']],
        body: testCase.body
      },
      config: { MODE: 'conformance' },
      secrets: { TOKEN: sensitiveSecret },
      fetches: {}
    }, {
      schemaCodecs,
      strict: true,
      provider: 'node',
      reporting: project.reporting,
      networkFetch: false,
      fetchImplementation: async (requestUrl) => {
        const url = new URL(String(requestUrl));
        assert.equal(url.origin, 'https://directory.example.test');
        return new Response('Ada', { status: 200, headers: { 'content-type': 'text/plain' } });
      },
      onLogObservation(entry) { logs.push(entry); }
    });
    effects += executed.effectCount;
    assert.doesNotMatch(JSON.stringify(logs), new RegExp(sensitiveSecret), testCase.id);
    cases.push(observation(testCase, executed.response, { effects: executed.effectCount }));
  }
  return Object.freeze({
    id: 'node-javascript',
    provider: 'node',
    target: 'javascript',
    runtime: 'node-web-runtime',
    providerReality: true,
    externalProviderExecution: false,
    cases: Object.freeze(cases),
    effects,
    artifact: Object.freeze({
      kind: 'javascript-application-plan',
      planHash: prepared.plan.planHash,
      graphHash: prepared.plan.graph.graphHash,
      packageSourceSha256: model.nativeSource.sourceSha256
    })
  });
}

function runNodeNative(corpus, model, tempRoot) {
  const first = compileNodeNative(model.nativeSource.source, path.join(tempRoot, 'node-native-a'), 'entities');
  const second = compileNodeNative(model.nativeSource.source, path.join(tempRoot, 'node-native-b'), 'entities');
  assert.deepEqual(second.bytes, first.bytes, 'Node Native artifact must reproduce exactly');
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(first.bytes));
  assert.equal(imports.some((entry) => /javascript|js-compute|asyncify/i.test(`${entry.module}:${entry.name}`)), false);
  const cases = [];
  let effects = 0;
  for (const testCase of corpus.runtimeCases) {
    const executed = executeNodeNative(first.bytes, testCase.body);
    effects += executed.effects;
    cases.push(observation(testCase, executed.response, { effects: executed.effects }));
  }
  return Object.freeze({
    id: 'node-native',
    provider: 'node',
    target: 'native',
    runtime: 'assemblyscript-webassembly',
    providerReality: true,
    externalProviderExecution: false,
    cases: Object.freeze(cases),
    effects,
    artifact: Object.freeze({
      kind: 'package-owned-native-wasm',
      bytes: first.bytes.byteLength,
      sha256: sha256(first.bytes),
      sourceSha256: model.nativeSource.sourceSha256,
      reproduced: true,
      imports: Object.freeze(imports.map((entry) => `${entry.module}:${entry.name}`).sort())
    })
  });
}

function startOrigin() {
  const server = http.createServer((request, response) => {
    assert.equal(String(request.url || '').startsWith('/'), true);
    response.statusCode = 200;
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    response.end('Ada');
  });
  server.listen(0, '127.0.0.1');
  return once(server, 'listening').then(() => {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return Object.freeze({
      server,
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    });
  });
}

function localManifest(originUrl, name) {
  return renderFastlyLocalConfig({
    name,
    description: 'Pulse Entities I9 external Viceroy conformance',
    backends: {
      directory_backend: { url: originUrl, overrideHost: new URL(originUrl).host, useSni: false }
    },
    configStores: { entities_config: { MODE: 'conformance' } },
    secretStores: { entities_secrets: { TOKEN: sensitiveSecret } }
  });
}

async function executeFastlyCorpus(server, corpus) {
  const cases = [];
  try {
    for (const testCase of corpus.runtimeCases) {
      const response = await requestFastlyCompute(server, {
        method: 'POST',
        path: '/',
        headers: { 'content-type': 'application/json' },
        body: testCase.body,
        timeoutMs: 30_000
      });
      cases.push(observation(testCase, response));
    }
  } catch (error) {
    throw new Error(`${error.message}\nViceroy stdout:\n${server.logs.stdout}\nViceroy stderr:\n${server.logs.stderr}`, { cause: error });
  }
  return Object.freeze(cases);
}

async function runFastlyJavascript(corpus, launcher, origin) {
  const project = resolveProject({ cwd: fixtureRoot, profile: 'fastly-javascript' });
  const built = buildProject(project);
  assert.equal(built.status, 'built');
  assert.equal(built.buildMode, 'javascript-source-package');
  assert.equal(built.manifest.automaticFallback, false);
  const outDir = built.outDir;
  let server;
  try {
    assert.equal(fastlyEsbuild.version, '0.28.1');
    await fastlyEsbuild.build({
      absWorkingDir: outDir,
      entryPoints: ['src/index.js'],
      outfile: 'dist/index.js',
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: ['es2022'],
      conditions: ['fastly', 'module', 'import', 'default'],
      external: ['fastly:*'],
      legalComments: 'none',
      sourcemap: false,
      logLevel: 'silent'
    });
    const wasmFile = path.join(outDir, 'bin/main.wasm');
    fs.mkdirSync(path.dirname(wasmFile), { recursive: true });
    const compileRuntime = (output) => run(
      process.execPath,
      [
        jsComputeRuntimeCli,
        '--env',
        `WASMTIME_HOME=${jsComputeCacheRoot},XDG_CACHE_HOME=${jsComputeCacheRoot}`,
        path.join(outDir, 'dist/index.js'),
        output
      ],
      {
        cwd: outDir,
        timeoutMs: 300_000,
        env: { NODE_OPTIONS: `--require=${deterministicJsComputeEnvironment}` }
      }
    );
    compileRuntime(wasmFile);
    fs.writeFileSync(path.join(outDir, 'fastly.toml'), localManifest(origin.url, 'pulse-entities-i9-fastly-javascript'));
    server = await startFastlyComputeServe({
      launcher,
      packageRoot: outDir,
      wasmFile,
      manifestFile: path.join(outDir, 'fastly.toml'),
      startTimeoutMs: 60_000,
      stopTimeoutMs: 5_000
    });
    const cases = await executeFastlyCorpus(server, corpus);
    const applicationBytes = fs.readFileSync(path.join(outDir, 'src/application.js'));
    const wasm = fs.readFileSync(wasmFile);
    const runtimeModule = new WebAssembly.Module(wasm);
    const runtimeInterface = Object.freeze({
      imports: Object.freeze(WebAssembly.Module.imports(runtimeModule).map((entry) => `${entry.module}:${entry.name}:${entry.kind}`)),
      exports: Object.freeze(WebAssembly.Module.exports(runtimeModule).map((entry) => `${entry.name}:${entry.kind}`))
    });
    assert.equal(wasm.includes(Buffer.from(sensitiveSecret)), false);
    assert.equal(applicationBytes.includes(Buffer.from(sensitiveSecret)), false);
    return Object.freeze({
      id: 'fastly-javascript',
      provider: 'fastly',
      target: 'javascript',
      runtime: '@fastly/js-compute-viceroy',
      providerReality: true,
      externalProviderExecution: true,
      cases,
      effects: null,
      artifact: Object.freeze({
        kind: 'fastly-javascript-runtime-wasm',
        bundleBytes: applicationBytes.byteLength,
        bundleSha256: sha256(applicationBytes),
        runtimeStaticSectionSha256: wasmStaticSectionHash(wasm),
        runtimeInterfaceSha256: semanticHash(runtimeInterface),
        runtimeWasmExecuted: true,
        rawWizerSnapshotHashExcluded: true,
        rawWizerSnapshotHashReason: 'initialized-memory-runtime-entropy',
        applicationPlanHash: built.manifest.application.planHash,
        fixedFreeMemoryInput: true,
        toolchain: Object.freeze({ esbuild: fastlyEsbuild.version, jsCompute: '3.43.1' })
      })
    });
  } finally {
    if (server) await server.stop();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

async function runFastlyNative(corpus, model, launcher, origin, tempRoot) {
  const generatedA = fastlyEntitiesNative.generateFastlyEntitiesNativeSource(model.nativeSource, {
    configStore: 'entities_config',
    secretStore: 'entities_secrets',
    effectBindings: model.effectBindings
  });
  const generatedB = fastlyEntitiesNative.generateFastlyEntitiesNativeSource(model.nativeSource, {
    configStore: 'entities_config',
    secretStore: 'entities_secrets',
    effectBindings: model.effectBindings
  });
  assert.deepEqual(generatedB, generatedA, 'Fastly Native provider source must reproduce exactly');
  const realized = fastlyEntitiesNative.compileFastlyEntitiesNative(model.nativeSource, {
    cwd: repoRoot,
    configStore: 'entities_config',
    secretStore: 'entities_secrets',
    effectBindings: model.effectBindings,
    timeoutMs: 180_000
  });
  assert.equal(realized.policy.automaticFallback, false);
  assert.equal(realized.policy.javascriptRuntime, false);
  assert.equal(realized.wasm.includes(Buffer.from(sensitiveSecret)), false);
  assert.equal(realized.source.includes(sensitiveSecret), false);
  assert.equal(realized.imports.some((entry) => /pulse_entities_host|javascript|js-compute|asyncify/i.test(`${entry.module}:${entry.name}`)), false);
  const packageRoot = path.join(tempRoot, 'fastly-native');
  const wasmFile = path.join(packageRoot, 'bin/main.wasm');
  fs.mkdirSync(path.dirname(wasmFile), { recursive: true });
  fs.writeFileSync(wasmFile, realized.wasm);
  fs.writeFileSync(path.join(packageRoot, 'fastly.toml'), localManifest(origin.url, 'pulse-entities-i9-fastly-native'));
  let server;
  try {
    server = await startFastlyComputeServe({
      launcher,
      packageRoot,
      wasmFile,
      manifestFile: path.join(packageRoot, 'fastly.toml'),
      startTimeoutMs: 60_000,
      stopTimeoutMs: 5_000
    });
    const cases = await executeFastlyCorpus(server, corpus);
    return Object.freeze({
      id: 'fastly-native',
      provider: 'fastly',
      target: 'native',
      runtime: 'assemblyscript-fastly-hostcalls-viceroy',
      providerReality: true,
      externalProviderExecution: true,
      cases,
      effects: null,
      artifact: Object.freeze({
        kind: 'fastly-native-wasm',
        bytes: realized.artifact.bytes,
        sha256: realized.artifact.sha256,
        sourceSha256: realized.artifact.sourceSha256,
        packageSourceSha256: realized.artifact.packageSourceSha256,
        planHash: realized.artifact.planHash,
        imports: Object.freeze(realized.imports.map((entry) => `${entry.module}:${entry.name}`).sort()),
        providerSourceReproduced: true,
        compiler: Object.freeze({
          package: realized.compiler.package,
          version: realized.compiler.version,
          jsonAs: realized.compiler.jsonAs
        })
      })
    });
  } finally {
    if (server) await server.stop();
  }
}

function planningEvidence(targetId) {
  let reasonId;
  let authority;
  if (targetId === 'node-javascript') {
    const decision = classifyNodeJavascriptCapability('timer', { bindingsRedaction: true });
    assert.equal(decision.status, 'pending');
    reasonId = decision.reasonId;
    authority = decision.owner;
  } else if (targetId === 'fastly-javascript') {
    const decision = classifyFastlyJavascriptCapability('timer');
    assert.equal(decision.status, 'pending');
    reasonId = decision.reasonId;
    authority = decision.owner;
  } else {
    const driver = getProviderDriver(targetId.startsWith('fastly-') ? 'fastly' : 'node', { projectRoot: fixtureRoot });
    const descriptor = driver.targets.native;
    assert.equal((descriptor.capabilities || []).includes('timer'), false);
    reasonId = 'target-capability-not-advertised';
    authority = targetId.startsWith('fastly-') ? 'provider-fastly' : 'provider-node';
  }
  return Object.freeze({
    id: 'target-ineligible-timer',
    status: 'passed',
    evaluation: 'planning',
    capability: 'timer',
    observedStatus: 'ineligible',
    reasonId,
    authority,
    automaticFallback: false,
    semanticHash: semanticHash({ capability: 'timer', status: 'ineligible', automaticFallback: false })
  });
}

function sealTargets(runtimeTargets, corpus) {
  const byId = new Map(runtimeTargets.map((target) => [target.id, target]));
  assert.deepEqual([...byId.keys()].sort(), ['fastly-javascript', 'fastly-native', 'node-javascript', 'node-native']);
  const mismatches = [];
  for (const testCase of corpus.runtimeCases) {
    const observations = runtimeTargets.map((target) => target.cases.find((entry) => entry.id === testCase.id));
    assert.equal(observations.every(Boolean), true, testCase.id);
    const hashes = [...new Set(observations.map((entry) => entry.semanticHash))];
    if (hashes.length !== 1) mismatches.push(Object.freeze({ id: testCase.id, hashes }));
  }
  assert.deepEqual(mismatches, []);
  return Object.freeze(runtimeTargets.map((target) => Object.freeze({
    ...target,
    planningCases: Object.freeze(corpus.planningCases.map(() => planningEvidence(target.id))),
    requiredRuntimeCases: corpus.runtimeCases.length,
    completedRuntimeCases: target.cases.length,
    requiredPlanningCases: corpus.planningCases.length,
    completedPlanningCases: corpus.planningCases.length,
    skippedCases: 0,
    mismatches: 0,
    automaticFallback: false
  })));
}

async function main() {
  const corpus = materializeCorpus();
  const model = compileEntitiesModel();
  const viceroyBinary = process.env.PULSE_VICEROY_BIN;
  assert.ok(viceroyBinary, 'Entities I9 requires PULSE_VICEROY_BIN; no Fastly CLI fallback is permitted.');
  const launcher = inspectFastlyComputeLauncher({
    viceroyBinary,
    env: process.env,
    timeoutMs: 10_000
  });
  assert.equal(launcher.kind, 'viceroy-direct');
  assert.equal(launcher.inspection.version, '0.20.1');
  const binaryBytes = fs.readFileSync(launcher.inspection.binary);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-entities-i9-'));
  const origin = await startOrigin();
  try {
    const nodeJavascript = await runNodeJavascript(corpus, model);
    const nodeNative = runNodeNative(corpus, model, tempRoot);
    const fastlyJavascript = await runFastlyJavascript(corpus, launcher, origin);
    const fastlyNative = await runFastlyNative(corpus, model, launcher, origin, tempRoot);
    const targets = sealTargets([nodeJavascript, nodeNative, fastlyJavascript, fastlyNative], corpus);
    const report = Object.freeze({
      version: reportVersion,
      status: 'passed',
      corpus: Object.freeze({
        version: corpus.source.version,
        semanticHash: corpus.semanticHash,
        runtimeCases: corpus.runtimeCases.length,
        planningCases: corpus.planningCases.length,
        totalCasesPerTarget: corpus.runtimeCases.length + corpus.planningCases.length
      }),
      source: Object.freeze({
        planHash: model.nativeSource.planHash,
        packageNativeSourceSha256: model.nativeSource.sourceSha256,
        managedHandlerNativeBundleHash: model.nativeSource.managedHandlerNativeBundleHash,
        routes: model.nativeSource.summary.routes,
        schemas: model.nativeSource.summary.schemas,
        effects: model.nativeSource.summary.effects
      }),
      engine: Object.freeze({
        kind: launcher.kind,
        owner: launcher.owner,
        version: launcher.inspection.version,
        binarySha256: sha256(binaryBytes),
        source: launcher.inspection.source
      }),
      targets,
      summary: Object.freeze({
        targets: targets.length,
        requiredEvaluations: targets.length * (corpus.runtimeCases.length + corpus.planningCases.length),
        completedEvaluations: targets.length * (corpus.runtimeCases.length + corpus.planningCases.length),
        externalFastlyTargets: targets.filter((entry) => entry.externalProviderExecution).length,
        skips: 0,
        mismatches: 0,
        automaticFallback: false,
        sensitiveValuesPresent: false
      })
    });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    assert.doesNotMatch(serialized, new RegExp(sensitiveSecret));
    fs.mkdirSync(reportRoot, { recursive: true });
    const reportFile = path.join(reportRoot, 'entities-four-mode-conformance.json');
    fs.writeFileSync(reportFile, serialized);
    process.stdout.write(`${JSON.stringify({
      status: report.status,
      corpus: report.corpus.version,
      targets: report.summary.targets,
      runtimeCases: report.corpus.runtimeCases,
      planningCases: report.corpus.planningCases,
      evaluations: report.summary.completedEvaluations,
      skips: report.summary.skips,
      mismatches: report.summary.mismatches,
      automaticFallback: report.summary.automaticFallback,
      engine: `${report.engine.kind} ${report.engine.version}`,
      report: path.relative(repoRoot, reportFile).replace(/\\/g, '/'),
      reportSha256: sha256(serialized)
    }, null, 2)}\n`);
    process.stdout.write('ok - Entities I9 shared corpus matches across Node/Fastly JavaScript/Native with external Viceroy, target-integrity evidence, zero skips, and zero fallback\n');
  } finally {
    await origin.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    for (const directory of ['.pulse-i9-fastly-javascript', '.pulse-i9-fastly-native', '.pulse-i9-node-javascript', '.pulse-i9-node-native']) {
      fs.rmSync(path.join(fixtureRoot, directory), { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack || error}\n`);
  if (error && error.code) process.stderr.write(`${error.code}\n`);
  if (error && error.detail) process.stderr.write(`${JSON.stringify(error.detail, null, 2)}\n`);
  process.exitCode = 1;
});

module.exports = Object.freeze({ reportVersion, materializeCorpus, compileEntitiesModel });
