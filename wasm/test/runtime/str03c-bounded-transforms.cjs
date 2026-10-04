'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Writable } = require('node:stream');
const ts = require('typescript');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const runtime = require('../../../packages/runtime/src/host');
const { executeNodeJavascriptApplication } = require('../../../packages/provider-node/src/javascript/runtime-host');
const { executeNativeWithIncomingBody } = require('../../../packages/provider-node/src/runtime/incoming-body');
const { createGeneratedOutput } = require('../../../packages/provider-node/src/runtime/generated-output');
const { createTransformInput, normalizeBodyTransform, limits } = require('../../../packages/provider-node/src/runtime/body-transform');
const { collector, executeNative } = require('../../../packages/provider-node/src/runtime/generated-output-test');
const { resolveProject } = require('../../packages/cli/src/project-config');
const { buildProject, startDevServer } = require('../../packages/cli/src/project-execution');
const options = { generatedOutput: true, bodyTransform: true, maxDurationMs: 5000, outputCollect: true, strict: false };
const source = `export default async function handler(ctx) {
  await ctx.output.start();
  for (let i = 0; i < 18; i++) {
    const chunk = await ctx.req.readTextChunk();
    if (chunk.done) break;
    await ctx.output.write(chunk.text + chunk.text);
  }
  return ctx.output.close();
}`;
const cache = new Map();
function compile(text = source) {
  if (!cache.has(text)) cache.set(text, compileCanonicalNativePlan(buildCanonicalNativePlan(compileCanonicalSource(text, {
    fileName: 'str03c.ts', strict: false, requireAsync: true
  })), { cwd: path.resolve(__dirname, '../../..') }));
  return cache.get(text);
}
function authored(text) {
  const module = { exports: {} };
  Function('module', 'exports', ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(module, module.exports);
  return module.exports.default;
}
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function stream(bytes, size = 7, state = {}) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      state.pulls = (state.pulls || 0) + 1;
      if (offset === bytes.length) return controller.close();
      const end = Math.min(bytes.length, offset + size);
      controller.enqueue(Uint8Array.from(bytes.subarray(offset, end))); offset = end;
    },
    cancel() { state.cancelled = true; }
  }, { highWaterMark: 0 });
}
function request(body, headers) { return new Request('http://fixture/', { method: 'POST', body, headers, duplex: 'half' }); }
async function run(target, text, body, extra = {}) {
  const settings = { ...options, ...extra };
  if (target === 'native') return executeNative(compile(text), { ...settings, request: { method: 'POST', body } }, executeNativeWithIncomingBody);
  const collected = collector({ ...settings, requestMethod: 'POST' });
  try {
    await executeNodeJavascriptApplication(authored(text), request(body), { ...settings, signal: collected.budget.signal, requestBudget: collected.budget, outputExecution: collected.outputExecution });
    await collected.outputExecution.finish();
    return { response: { body: collected.body() } };
  } finally { collected.dispose(); }
}
async function parityAndLimits() {
  const native = compile();
  assert.equal(native.manifest.policy.bodyTransform.maxExpansionRatio, 4);
  const bytes = Buffer.from('\uFEFF' + '🙂€text'.repeat(7000));
  const input = bytes.subarray(0, 65530); // Choose a complete UTF-8 ending below the cap.
  const valid = Buffer.from(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input));
  let expected;
  const measurements = [];
  for (const target of ['native', 'javascript']) {
    for (const size of [1, 4093, 65536]) {
      const result = await run(target, source, stream(valid, size), { onBodyTransformObservation: value => measurements.push(value) });
      expected ??= result.response.body;
      assert.equal(result.response.body, expected, 'chunk boundaries must not depend on transport fragmentation');
      assert.equal(Buffer.byteLength(result.response.body), valid.length * 2);
      if (target === 'native') { assert.ok(result.memory.bytes < 64 * 1024 * 1024); assert.ok(result.guestMemoryBytes <= 4096 * 65536); }
    }
    assert.equal((await run(target, source, '')).response.body, '');
    const quadruple = source.replace('chunk.text + chunk.text', 'chunk.text + chunk.text + chunk.text + chunk.text');
    assert.equal(Buffer.byteLength((await run(target, quadruple, stream(Buffer.alloc(65536, 97), 1000))).response.body), limits.outputBytes);
    assert.equal(Buffer.byteLength((await run(target, quadruple, stream(valid, 1))).response.body), valid.length * 4);
    const isolated = await Promise.all(['first🙂', 'second€'].map(body => run(target, source, stream(Buffer.from(body), 1))));
    assert.deepEqual(isolated.map(result => result.response.body), ['first🙂first🙂', 'second€second€']);
    for (const [text, body, code] of [
      [source, stream(Buffer.from([0x61, 0xf0, 0x9f]), 1), 'PULSE_TRANSFORM_UTF8_INVALID'],
      [source, stream(Buffer.from([0xc0, 0xaf]), 1), 'PULSE_TRANSFORM_UTF8_INVALID'],
      [source, stream(Buffer.alloc(65537, 97), 4093), 'PULSE_TRANSFORM_INPUT_LIMIT'],
      [source.replace('chunk.text + chunk.text', 'chunk.text + chunk.text + chunk.text + chunk.text + chunk.text'), 'a', 'PULSE_TRANSFORM_OUTPUT_LIMIT'],
      ["export default async function handler(ctx){await ctx.output.start();return ctx.output.close();}", '', 'PULSE_TRANSFORM_EOF_REQUIRED'],
      ["export default async function handler(ctx){await ctx.output.start();await ctx.output.write('prefix');return ctx.output.close();}", 'a', 'PULSE_TRANSFORM_OUTPUT_LIMIT']
    ]) await assert.rejects(() => run(target, text, body), error => error.code === code || error.cause?.code === code, `${target}: ${code}`);
  }
  assert.ok(measurements.every(value => value.maxQueuedBytes <= 65536 + 4093 + 3 && value.maxTextBytes <= 4096 && value.reads <= 18));
  assert.throws(() => normalizeBodyTransform(true, { ...options, bodyForwarding: { maxBytes: 1 } }), { code: 'PULSE_TRANSFORM_CONFIG_INVALID' });
  assert.throws(() => normalizeBodyTransform(true, { ...options, generatedOutput: false }), { code: 'PULSE_TRANSFORM_CONFIG_INVALID' });
  assert.throws(() => createTransformInput(request('', { 'content-length': '65537' }), options), { code: 'PULSE_TRANSFORM_INPUT_LIMIT' });
  const rejectedState = {};
  assert.throws(() => createTransformInput(request(stream(Buffer.from('unread'), 1, rejectedState), { 'content-length': '65537' }), options), { code: 'PULSE_TRANSFORM_INPUT_LIMIT' });
  assert.equal(rejectedState.cancelled, true);
  assert.equal(rejectedState.pulls || 0, 0);
  for (const body of [
    "await ctx.parallel({chunk:ctx.req.readTextChunk()});return ctx.text('bad');",
    "ctx.req.readTextChunk();return ctx.text('bad');",
    "const t=await ctx.req.text();const c=await ctx.req.readTextChunk();return ctx.text(t);"
  ]) assert.throws(() => compile(`export default async function handler(ctx){${body}}`));
  const owner = createTransformInput(request('text'), options);
  assert.throws(() => owner.structured(), { code: 'PULSE_REQUEST_BODY_OWNERSHIP' }); await owner.close();
  for (const text of [
    "export default async function handler(ctx){return ctx.text('denied');}",
    "export default async function handler(ctx){await ctx.parallel({chunk:ctx.req.readTextChunk()});return ctx.text('bad');}",
    "export default async function handler(ctx){const c=ctx.req.readTextChunk();await ctx.req.text();return ctx.text('bad');}"
  ]) {
    const state = {};
    await run('javascript', text, stream(Buffer.from('unread'), 1, state));
    assert.equal(state.pulls || 0, 0, 'denial/invalid ownership must not pull input');
    assert.equal(state.cancelled, true);
  }
  return { wasmSha256: native.inspection.sha256, maxQueuedBytes: Math.max(...measurements.map(item => item.maxQueuedBytes)), maxTextBytes: Math.max(...measurements.map(item => item.maxTextBytes)), measuredExpansionRatio: 2, maximumExpansionRatio: 4 };
}
async function backpressureAndCancellation() {
  for (const target of ['native', 'javascript']) for (const mode of ['finish', 'abort', 'deadline']) {
    const state = {}, first = deferred();
    const duration = mode === 'deadline' ? 100 : 5000;
    const abort = new AbortController();
    const budget = runtime.createRequestBudget({ maxDurationMs: duration, signal: abort.signal });
    let release, writes = 0;
    const sink = new Writable({ highWaterMark: 1, write(_chunk, _encoding, done) { writes++; if (writes === 1) { release = done; first.resolve(); } else done(); } });
    sink.setHeader = () => {};
    const output = createGeneratedOutput(sink, { ...options, maxDurationMs: duration, requestBudget: budget, requestMethod: 'POST' });
    const settings = { ...options, requestBudget: budget, signal: budget.signal, outputExecution: output };
    const body = stream(Buffer.alloc(20000, 97), 4093, state);
    const running = target === 'native'
      ? executeNativeWithIncomingBody(compile(), { ...settings, request: { method: 'POST', body } })
      : executeNodeJavascriptApplication(authored(source), request(body), settings);
    const observed = running.then(value => ({ value }), error => ({ error }));
    try {
      await first.promise; await turn();
      assert.equal(state.pulls, 1, 'blocked writer must prevent the next input pull');
      assert.equal(writes, 1);
      if (mode !== 'finish') {
        if (mode === 'abort') abort.abort(new Error('fixture disconnect'));
        assert.ok((await observed).error);
        assert.equal(state.cancelled, true);
        release(); await turn(); assert.equal(state.pulls, 1); assert.equal(writes, 1);
      } else {
        release(); const result = await observed; if (result.error) throw result.error;
        await output.finish(); assert.equal(output.snapshot().expansionRatio, 2); assert.equal(output.finished, true);
      }
    } finally { output.dispose(); budget.close(); }
  }
  // A read that never settles consumes the same request deadline and is cancelled.
  for (const target of ['native', 'javascript']) {
    const state = {};
    const stalled = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { state.cancelled = true; } }, { highWaterMark: 0 });
    await assert.rejects(() => run(target, source, stalled, { maxDurationMs: 50 }));
    assert.equal(state.cancelled, true);
  }
}
async function httpWorkflow() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-str03c-'));
  let dev;
  try {
    fs.mkdirSync(path.join(root, 'node_modules/@pulse-compute'), { recursive: true });
    fs.symlinkSync(path.resolve(__dirname, '../../../packages/pulse'), path.join(root, 'node_modules/@pulse-compute/pulse'), 'dir');
    fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, '.pulse'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'str03c', private: true, type: 'module', dependencies: { '@pulse-compute/pulse': require('../../../packages/pulse/package.json').version } }));
    fs.writeFileSync(path.join(root, 'src/index.ts'), "import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.post('/'," + source.replace('export default async function handler', 'async function handler').replace(/;?\s*$/, '') + ');export default app;');
    fs.writeFileSync(path.join(root, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>({pulse:{entry:'src/index.ts',defaultProfile:'native',strict:false},native:{host:'node',target:'native',node:{bodyTransform:true,generatedOutput:true,maxDurationMs:5000}},javascript:{host:'node',target:'javascript',node:{bodyTransform:true,generatedOutput:true,maxDurationMs:5000}},disabled:{host:'node',target:'native',node:{generatedOutput:true,maxDurationMs:5000}},disabledJs:{host:'node',target:'javascript',node:{generatedOutput:true,maxDurationMs:5000}},fastly:{host:'fastly',target:'native'},fastlyJs:{host:'fastly',target:'javascript'}}));`);
    for (const profile of ['disabled', 'disabledJs', 'fastly', 'fastlyJs']) await assert.rejects(async () => buildProject(resolveProject({ cwd: root, profile })), /transform|capabilit|eligible|support/i);
    for (const profile of ['native', 'javascript']) {
      const project = resolveProject({ cwd: root, profile });
      const built = await buildProject(project); if (profile === 'native') assert.ok(built.files.nativeWasm);
      dev = await startDevServer(project, { port: 0, watch: false });
      const first = deferred(), finished = deferred(), chunks = [];
      const req = http.request(dev.ready.url, { method: 'POST' }, res => {
        res.on('data', chunk => { chunks.push(chunk); first.resolve(); });
        res.on('end', () => finished.resolve()); res.on('error', error => finished.resolve(error));
      });
      req.on('error', error => { first.resolve(error); finished.resolve(error); });
      req.setTimeout(5000, () => req.destroy(new Error('STR-03C HTTP timeout')));
      req.write('a'.repeat(4093));
      const error = await first.promise; if (error) throw error;
      assert.equal(Buffer.concat(chunks).toString(), 'a'.repeat(8186), 'real socket receives transformed output before input EOF');
      req.end('🙂tail'); const endError = await finished.promise; if (endError) throw endError;
      assert.equal(Buffer.concat(chunks).toString(), 'a'.repeat(8186) + '🙂tail🙂tail');
      dev.server.closeAllConnections(); await new Promise(resolve => dev.server.close(resolve)); dev = undefined;
    }
  } finally {
    if (dev) { dev.server.closeAllConnections(); await new Promise(resolve => dev.server.close(resolve)); }
    fs.rmSync(root, { recursive: true, force: true });
  }
}
async function main() {
  const evidence = await parityAndLimits(); await backpressureAndCancellation(); await httpWorkflow();
  console.log(JSON.stringify({ status: 'passed', ...evidence, scope: 'STR-03C workspace Native/JavaScript UTF-8 transforms, actual Wasm, fixed framing, independent caps, ratio, blocked-writer demand, cancellation, deadlines, build/dev real HTTP; no installed qualification or release seal' }));
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error.stack); console.error(JSON.stringify(error.diagnostics || error.detail)); process.exitCode = 1; });
