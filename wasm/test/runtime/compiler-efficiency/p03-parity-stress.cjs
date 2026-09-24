#!/usr/bin/env node
'use strict';

// S02 evidence: independent expectations live in the JSON corpus, not in the
// observed runtime output. All generated payloads and detailed traces stay ignored.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const fixture = path.join(root, 'wasm/test/fixtures/projects/compiler-efficiency-parity');
const corpusPath = path.join(root, 'wasm/test/fixtures/conformance/compiler-efficiency-parity.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const { resolveProject } = require('../../../packages/cli/src/project-config');
const { compileNativeProjectInMemory } = require('../../../packages/cli/src/project-execution');
const platform = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const fastlyHost = require('../../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const nativeHost = require('../../../packages/host-runtime/src/runtime/canonical-native-host');
const { NativeValueBudget } = require('../../../packages/host-runtime/src/runtime/native-value-budget');
const { CANONICAL_NATIVE_READ_LOOP_MEMORY: policy } = require('../../../packages/contracts/src/handler/canonical-native-runtime');
const driver = require('../../../../packages/provider-node/src/toolchain').createDriver();
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const secrets = { S3_ID: 'fixture-id', S3_KEY: 'fixture-secret-012345678901234567890123456789' };

function pages(spec) {
  if (spec.invalidBody) return { 'https://objects.example.invalid/pages/p1': spec.invalidBody };
  return Object.fromEntries(Array.from({ length: spec.pages }, (_, index) => {
    const page = { index, next: index + 1 < spec.pages ? `p${index + 2}` : spec.tail || '', payload: '' };
    const remaining = corpus.pageBytes - Buffer.byteLength(JSON.stringify(page));
    page.payload = (corpus.seed + 'x'.repeat(remaining)).slice(0, remaining);
    const body = JSON.stringify(page);
    assert.equal(Buffer.byteLength(body), corpus.pageBytes);
    return [`https://objects.example.invalid/pages/p${index + 1}`, body];
  }));
}

function expectedEffects(spec) {
  const kinds = [];
  const reads = spec.id === 'two-object-cycle' ? 3 : spec.pages;
  for (let i = 0; i < reads; i++) {
    kinds.push('s3.getText');
    if (i + 1 !== spec.missingPage) kinds.push('crypto.digestText');
  }
  return kinds;
}

function checkResponse(actual, spec, target) {
  assert.deepEqual({ status: actual.status, body: actual.body }, spec.response, `${spec.id}: ${target} response`);
}

async function nodeCase(compiled, project, spec, responses) {
  const observed = [];
  const checkpoints = [];
  let functionPuts = 0;
  const request = { method: 'GET', path: '/pages', url: 'https://app.example.invalid/pages',
    headers: [['x-start', spec.pages ? 'p1' : ''], ['x-mode', spec.mode || '']], body: '' };
  const options = driver.executionOptions(project.providerConfig, { request, secrets, strict: false,
    fetchImplementation: async input => {
      const url = new Request(input).url;
      const body = responses[url];
      return body === undefined || Number(url.match(/\/p(\d+)$/)?.[1]) === spec.missingPage
        ? new Response('', { status: 404 })
        : new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    } });
  let heap;
  const original = nativeHost.ValueHeap.prototype.put;
  nativeHost.ValueHeap.prototype.put = function(value) {
    heap = this; if (typeof value === 'function') functionPuts++;
    return original.call(this, value);
  };
  try {
    const result = await nativeHost.executeCanonicalNativeModule(compiled, { ...options,
      providerAdapter: { ...options.providerAdapter, dispatchEffect(effect, context) {
        observed.push(effect.kind);
        checkpoints.push(heap?.budget.snapshot() || null);
        return options.providerAdapter.dispatchEffect(effect, context);
      } } });
    checkResponse(result.response, spec, 'Node Native');
    assert.deepEqual(observed, expectedEffects(spec), `${spec.id}: Node ordered effects`);
    assert.equal(result.effectCount, observed.length);
    const states = result.continuations.map(x => x.states);
    assert.equal(states.length, observed.length, `${spec.id}: one continuation per effect`);
    for (const state of states) assert.deepEqual(state, ['created', 'waiting', 'resumed', 'completed']);
    return { status: result.response.status, response: result.response.body,
      effects: observed, continuations: states, error: null, firstFailure: spec.firstFailure,
      budgetCheckpoints: checkpoints, finalBudget: result.memory,
      handles: result.valueHandleCount, functionPuts };
  } catch (error) {
    if (!spec.invalidBody) throw error;
    assert.equal(error.code, spec.nodeError);
    assert.deepEqual(observed, expectedEffects(spec));
    const states = error.execution?.continuations?.map(x => x.states);
    assert.deepEqual(states, [['created', 'waiting', 'resumed', 'completed'], ['created', 'waiting', 'resumed', 'failed']]);
    return { status: null, response: null, effects: observed, continuations: states,
      error: error.code, firstFailure: spec.firstFailure, budgetCheckpoints: checkpoints, functionPuts };
  } finally { nativeHost.ValueHeap.prototype.put = original; }
}

function fastlyCase(wasm, spec, responses) {
  const outbound = [];
  const request = { method: 'GET', path: '/pages', url: 'https://app.example.invalid/pages',
    headers: [['x-start', spec.pages ? 'p1' : ''], ['x-mode', spec.mode || '']], body: '' };
  const fixtures = Object.fromEntries(Object.entries(responses).map(([url, body]) => ['GET ' + url, {
    status: Number(url.match(/\/p(\d+)$/)?.[1]) === spec.missingPage ? 404 : 200,
    headers: [['content-type', 'application/json'], ['content-length', String(Buffer.byteLength(body))]], body
  }]));
  let result;
  try { result = fastlyHost.executeFastlyNativePlatformCapabilities(wasm, {
    request, secrets, secretStore: 'app_secrets', fixtures,
    onOutboundRequest(item) { outbound.push(new URL(item.url).pathname); }
  }); } catch (error) {
    if (!spec.invalidBody) throw error;
    assert.deepEqual({ code: error.code, lastError: error.detail?.lastError,
      errorStage: error.detail?.errorStage }, spec.fastlyError);
    assert.deepEqual(outbound, ['/pages/p1']);
    const sent = error.detail.trace.filter(x => x.module === 'fastly_http_req' && x.name === 'send_async');
    const waited = error.detail.trace.filter(x => x.module === 'fastly_http_req' && x.name === 'pending_req_wait');
    assert.deepEqual([sent.length, waited.length], [1, 1]);
    return { status: null, response: null, outbound, sends: 1, waits: 1,
      error: error.code, errorStage: error.detail.errorStage, firstFailure: spec.firstFailure };
  }
  checkResponse(result.response, spec, 'Fastly ABI');
  const reads = spec.id === 'two-object-cycle' ? 3 : spec.pages;
  assert.deepEqual(outbound, Array.from({ length: reads }, (_, index) =>
    '/pages/p' + (spec.id === 'two-object-cycle' && index === 2 ? 1 : index + 1)), `${spec.id}: Fastly request order`);
  const sent = result.trace.filter(x => x.module === 'fastly_http_req' && x.name === 'send_async');
  const waited = result.trace.filter(x => x.module === 'fastly_http_req' && x.name === 'pending_req_wait');
  assert.equal(sent.length, reads); assert.equal(waited.length, reads);
  const positions = result.trace.map((x, i) => x.module === 'fastly_http_req' &&
    (x.name === 'send_async' || x.name === 'pending_req_wait') ? [x.name, i] : null).filter(Boolean);
  for (let i = 0; i < reads; i++) assert.deepEqual(positions.slice(i * 2, i * 2 + 2).map(x => x[0]),
    ['send_async', 'pending_req_wait']);
  return { status: result.response.status, response: result.response.body,
    outbound, sends: sent.length, waits: waited.length, error: null, firstFailure: spec.firstFailure,
    finalBudget: { bytes: Number(result.instance.exports.pulse_fastly_memory_bytes()),
      values: Number(result.instance.exports.pulse_fastly_memory_values()) },
    finalLinearMemoryPages: result.instance.exports.memory.buffer.byteLength / 65536 };
}

async function cancellation(compiled, project) {
  const spec = corpus.nodeCancellation;
  const controller = new AbortController();
  const responseBody = pages({ pages: 1 })['https://objects.example.invalid/pages/p1'];
  const options = driver.executionOptions(project.providerConfig, {
    request: { method: 'GET', path: '/pages', url: 'https://app.example.invalid/pages',
      headers: [['x-start', 'p1']], body: '' }, secrets, strict: false,
    fetchImplementation: async () => new Response(responseBody, { status: 200 })
  });
  const observed = [];
  let caught;
  try {
    await nativeHost.executeCanonicalNativeModule(compiled, { ...options, signal: controller.signal,
      providerAdapter: { ...options.providerAdapter, dispatchEffect(effect, context) {
        observed.push(effect.kind);
        if (observed.length === 2) { controller.abort(); return { status: 'not-found' }; }
        return options.providerAdapter.dispatchEffect(effect, context);
      } } });
  } catch (error) { caught = error; }
  assert.equal(caught?.code, spec.errorCode);
  assert.deepEqual(observed, spec.effects);
  const states = caught.execution?.continuations?.map(x => x.states);
  assert.deepEqual(states, spec.continuations);
  return { id: spec.id, effects: observed, error: caught.code, continuations: states };
}

function hostValues() {
  const budget = new NativeValueBudget(policy);
  const heap = new nativeHost.ValueHeap(budget);
  const first = { value: 1 }, twin = { value: 1 };
  const self = { next: null }; self.next = self;
  const left = { next: null }, right = { next: left }; left.next = right;
  const shared = () => 1;
  const outcomes = {
    'same-object': heap.put(first) === heap.put(first) ? 'same-handle' : 'distinct-handles',
    'equal-looking-objects': heap.put(first) === heap.put(twin) ? 'same-handle' : 'distinct-handles',
    'self-cycle': heap.put(self) === heap.put(self.next) ? 'stable-alias' : 'broken-alias',
    'two-object-cycle': heap.put(left) === heap.put(right.next) ? 'stable-alias' : 'broken-alias'
  };
  for (const spec of corpus.hostValueCases) assert.equal(outcomes[spec.id], spec.expected, spec.id);
  const firstFunctionHandle = heap.put(shared), secondFunctionHandle = heap.put(shared);
  assert.notEqual(firstFunctionHandle, secondFunctionHandle, 'function identity is not indexed by the current host');
  return { outcomes, charged: budget.snapshot(), handles: heap.size(),
    directFunctionProbe: { sharedIdentityIndexed: false, sourceAdmission: 'unproven by direct heap insertion' } };
}

function budgetBoundary(dir) {
  const spec = corpus.budgetBoundary;
  const seen = [];
  const fastlyBudget = require('../../../../packages/provider-fastly/src/build/native-value-budget');
  const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile');
  const source = `let closed:i32=0;let stage:i32=0;
    class __PulseFastlyHeader { constructor(public name:string,public value:string){} }
    function __pulse_fastly_fail(code:i32,s:i32,index:i32):void{stage=s;}
    function __pulse_invocation_close():void{closed++;}
    ${fastlyBudget.runtimeSource({ ...policy, maxBytes: spec.maxBytes, maxValues: spec.maxValues })}
    export function charge(values:i64,bytes:i64):void{__pulse_memory_charge(values,bytes);}
    export function status():i32{return closed*1000+stage;}`;
  const entry = path.join(dir, 'budget.ts'), wasm = path.join(dir, 'budget.wasm');
  fs.writeFileSync(entry, source);
  const asc = resolveAsc(path.join(root, 'wasm/packages/compiler'));
  const built = spawnSync(asc.executable, [asc.script, entry, '--outFile', wasm, '--runtime', 'stub'], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const module = new WebAssembly.Module(fs.readFileSync(wasm));
  for (const rejected of spec.firstRejectedCharges) {
    let closes = 0;
    const budget = new NativeValueBudget({ ...policy, maxBytes: spec.maxBytes, maxValues: spec.maxValues }, () => closes++);
    budget.charge(spec.admitted.values, spec.admitted.bytes);
    assert.throws(() => budget.charge(rejected.values, rejected.bytes), { code: spec.errorCode });
    assert.deepEqual({ values: budget.values, bytes: budget.bytes }, spec.admitted);
    assert.throws(() => budget.charge(0, 0), { code: spec.errorCode });
    assert.equal(closes, 1);
    const guest = new WebAssembly.Instance(module, { env: { abort() { throw Error('abort'); } } }).exports;
    guest.charge(BigInt(spec.admitted.values), BigInt(spec.admitted.bytes));
    assert.throws(() => guest.charge(BigInt(rejected.values), BigInt(rejected.bytes)), WebAssembly.RuntimeError);
    assert.deepEqual({ values: Number(guest.pulse_fastly_memory_values()),
      bytes: Number(guest.pulse_fastly_memory_bytes()) }, spec.admitted);
    assert.equal(guest.status(), 1000 + rejected.fastlyStage);
    assert.throws(() => guest.charge(0n, 0n), WebAssembly.RuntimeError);
    seen.push({ rejected, nodeFirstFailure: spec.errorCode, fastlyFirstFailureStage: rejected.fastlyStage,
      admitted: budget.snapshot() });
  }
  return seen;
}

async function functionAdmission(dir) {
  const ts = require('typescript');
  const { compileCanonicalSource } = require('../../../packages/compiler/src/canonical-api-compiler');
  const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
  const source = fs.readFileSync(path.join(fixture, 'src/function-values.ts'), 'utf8');
  const spec = corpus.javascriptFunctionCase;
  const { compileCanonicalProject } = require('../../../packages/compiler/src/canonical-project-compiler');
  const project = compileCanonicalProject(path.join(dir, 'src/function-values.ts'), {
    rootDir: dir, workspaceRoot: root, target: 'javascript', strict: false, requireAsync: true,
    applicationProjectMetadata: { selectedProfile: { name: 'javascript', source: 'fixture' },
      target: 'javascript', host: 'node', strict: false, projectHash: '1'.repeat(64),
      configPlanHash: '2'.repeat(64), bindings: { config: [], secret: [] }, fragments: {} }
  });
  assert.equal(project.target, 'javascript');
  assert.throws(() => compileCanonicalProject(path.join(dir, 'src/function-values.ts'), {
    rootDir: dir, workspaceRoot: root, target: 'native', strict: false, requireAsync: true
  }), error => error.diagnostics?.some(x => x.code === spec.nativeProjectAdmissionCode));
  const plain = `export default async function handler(ctx){let calls=0;const shared=()=>{calls++;return calls};
    const alias=shared;const distinct=()=>{calls++;return calls};
    return ctx.text((shared===alias)+':'+(shared===distinct)+':'+shared()+':'+alias()+':'+distinct())}`;
  const inspected = compileCanonicalSource(plain, { fileName: 'function-values.ts', target: 'javascript', strict: false });
  assert.equal(inspected.metadata.effectCount, 0);
  const native = compileCanonicalSource(plain, { fileName: 'function-values.ts', strict: false });
  assert.throws(() => buildCanonicalNativePlan(native), error =>
    error.diagnostics?.some(x => x.code === spec.nativeAdmissionCode));
  // JavaScript is an explicitly selected, separate source execution. It never
  // stands in for Native and never instantiates Native's ValueHeap.
  const transpile = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  fs.writeFileSync(path.join(dir, 'src/helper-values.js'), transpile(fs.readFileSync(path.join(fixture, 'src/helper-values.ts'), 'utf8')));
  const file = path.join(dir, 'src/function-values.js'); fs.writeFileSync(file, transpile(source));
  const application = require(file).default;
  const { executeNodeJavascriptTestCase } = require('../../../../packages/provider-node/src/javascript/test-runtime');
  const result = await executeNodeJavascriptTestCase(application,
    { name: spec.id, request: { method: 'GET', path: '/functions', headers: [] } },
    { provider: 'node', strict: false, networkFetch: false });
  checkResponse(result.response, spec, 'Node JavaScript');
  return { id: spec.id, response: spec.response, javascriptAdmission: 'accepted', nativeAdmission: 'rejected',
    nativeDiagnostic: spec.nativeAdmissionCode, nativeProjectDiagnostic: spec.nativeProjectAdmissionCode,
    javascriptEffectCount: 0 };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-s02-'));
  try {
    fs.cpSync(path.join(fixture, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.cpSync(path.join(fixture, '.pulse'), path.join(dir, '.pulse'), { recursive: true });
    const packages = path.join(dir, 'node_modules/@pulse-compute'); fs.mkdirSync(packages, { recursive: true });
    for (const name of ['pulse', 's3', 'crypto']) fs.symlinkSync(path.join(root, 'packages', name), path.join(packages, name), 'dir');
    const project = resolveProject({ cwd: dir, profile: 'node' });
    const compiled = compileNativeProjectInMemory(project);
    const fp = resolveProject({ cwd: dir, profile: 'fastly' });
    const fastlyArtifact = platform.compileFastlyNativePlatformCapabilitiesPlan(compiled.plan, {
      cwd: dir, bindings: fp.providerConfig.bindings, canonicalBuild: true
    });
    const rows = [];
    for (const spec of corpus.cases) {
      const responses = pages(spec);
      const node = await nodeCase(compiled.native, project, spec, responses);
      assert.equal(node.functionPuts, 0, `${spec.id}: admitted Native source did not put functions in ValueHeap`);
      const fastly = fastlyCase(fastlyArtifact.wasm, spec, responses);
      assert.deepEqual({ status: node.status, body: node.response }, { status: fastly.status, body: fastly.response });
      rows.push({ id: spec.id, fixtureSha256: sha256(Object.values(responses).join('')),
        expectedFirstFailure: spec.firstFailure, node, fastly });
    }
    const cancellationResult = await cancellation(compiled.native, project);
    for (const row of rows) {
      assert.equal(row.node.effects.filter(x => x === 'crypto.digestText').length,
        corpus.cases.find(x => x.id === row.id).effectPairs);
      for (const [index, sample] of row.node.budgetCheckpoints.entries()) if (index) {
        assert.ok(sample.bytes >= row.node.budgetCheckpoints[index - 1].bytes);
        assert.ok(sample.values >= row.node.budgetCheckpoints[index - 1].values);
      }
    }
    const report = { schemaVersion: 'pulse.compiler-efficiency-p03.v1', status: 'passed',
      sourceRevision: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      corpusSha256: sha256(fs.readFileSync(corpusPath)),
      fixtureSha256: sha256(['.pulse/config.ts', 'src/index.ts', 'src/schemas.ts', 'src/types.ts',
        'src/function-values.ts', 'src/helper-values.ts']
        .map(p => fs.readFileSync(path.join(fixture, p))).join('')),
      nodeWasmSha256: sha256(compiled.native.wasm), fastlyWasmSha256: sha256(fastlyArtifact.wasm),
      targets: { nodeNative: rows.length, fastlyAbi: rows.length, javascript: 1 },
      cases: rows, nodeCancellation: cancellationResult, javascriptCase: await functionAdmission(dir),
      hostValues: hostValues(), budgetBoundary: budgetBoundary(dir),
      limitations: ['Fastly ABI fixture is not a local Viceroy or deployed runtime.',
        'Direct ValueHeap alias/cycle probes establish host handle semantics, not Native source admission.',
        'Fastly exports cumulative charges and Wasm capacity; Node exposes actual host budget checkpoints.'] };
    const out = path.join(root, 'wasm/.test-results/compiler-efficiency/p03/semantic-oracles.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'passed', report: path.relative(root, out), cases: report.targets }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
