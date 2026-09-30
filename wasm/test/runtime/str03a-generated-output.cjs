'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { Writable } = require('node:stream');
const ts = require('typescript');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const runtime = require('../../../packages/runtime/src/host');
const { createGeneratedOutput } = require('../../../packages/provider-node/src/runtime/generated-output');
const { resolveProject } = require('../../packages/cli/src/project-config');
const { buildProject, startDevServer } = require('../../packages/cli/src/project-execution');
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const source = `export default async function handler(ctx) {
  await ctx.output.start();
  await ctx.output.write('prefix');
  const tail = await ctx.config.get('TAIL');
  await ctx.output.write(tail);
  return ctx.output.close();
}`;
function compile(text) {
  return compileCanonicalNativePlan(buildCanonicalNativePlan(compileCanonicalSource(text, {
    fileName: 'str03a.ts', strict: false, requireAsync: true
  })), { cwd: path.resolve(__dirname, '../../..') });
}
function authored(text) {
  const module = { exports: {} };
  Function('module', 'exports', ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(module, module.exports);
  return module.exports.default;
}
async function lifecycle() {
  const native = compile(source);
  assert.equal(native.manifest.policy.generatedOutput.memory.maxBytes, 64 * 1024 * 1024);
  assert.ok(WebAssembly.Module.imports(new WebAssembly.Module(native.wasm)).some(item => item.name === 'output_close'));
  for (const target of ['native', 'javascript']) for (const abort of [false, true, 'deadline']) {
    const first = deferred(), chunks = [], headers = new Map();
    let release, calls = 0, finals = 0;
    const sink = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      if (chunks.length === 1) { release = done; first.resolve(); } else done();
    }, final(done) { finals++; done(); } });
    sink.setHeader = (name, value) => headers.set(name, value);
    sink.hasHeader = name => headers.has(name);
    const signal = new AbortController();
    const duration = abort === 'deadline' ? 50 : 5000;
    const budget = runtime.createRequestBudget({ maxDurationMs: duration, signal: signal.signal });
    const output = createGeneratedOutput(sink, { generatedOutput: true, maxDurationMs: duration, requestBudget: budget, requestMethod: 'GET' });
    const options = { outputExecution: output, requestBudget: budget, signal: budget.signal, strict: false };
    const running = target === 'native'
      ? executeCanonicalNativeModule(native, { ...options, providerAdapter: { id: 'str03a', dispatchEffect() { calls++; return 'tail'; } } })
      : runtime.executeApplication(authored(source), new Request('http://fixture/'), { ...options, capabilities: { config() { calls++; return 'tail'; } } });
    const observed = running.then(value => ({ value }), error => ({ error }));
    try {
      await first.promise; await turn();
      assert.equal(calls, 0, 'blocked write must not resume later producer effects');
      assert.equal(chunks.length, 1);
      assert.equal(finals, 0, 'first byte precedes producer completion');
      if (abort) {
        if (abort === true) signal.abort(new Error('fixture disconnect'));
        assert.ok((await observed).error); release(); await turn();
        assert.equal(calls, 0, 'late write callback must not resume cancelled producer');
        assert.equal(finals, 0);
        assert.equal(sink.destroyed, true);
      } else {
        release();
        const result = await observed;
        if (result.error) throw result.error;
        await output.finish();
        assert.equal(calls, 1); assert.equal(finals, 1);
        assert.equal(Buffer.concat(chunks).toString(), 'prefixtail');
        if (target === 'native') assert.ok(result.value.memory.bytes < 64 * 1024 * 1024);
      }
    } finally { output.dispose(); budget.close(); }
  }
  return { wasmSha256: native.inspection.sha256, wasmBytes: native.wasm.length };
}
async function boundaries() {
  for (const [body, code] of [
    ['const result = ctx.output.close(); return result;', 'PULSE_OUTPUT_CLOSE_TERMINAL'],
    ['return await ctx.output.close();', 'PULSE_OUTPUT_CLOSE_TERMINAL'],
    ["ctx.output.write('x'); return ctx.output.close();", 'PULSE_EFFECT_AWAIT_REQUIRED'],
    ["await ctx.parallel({ output: ctx.output.start() }); return ctx.text('bad');", 'PULSE_OUTPUT_PARALLEL_FORBIDDEN']
  ]) assert.throws(() => compile(`export default async function handler(ctx){${body}}`),
    error => error.diagnostics?.some(item => item.code === code), code);
  const { collector, executeNative } = require('../../../packages/provider-node/src/runtime/generated-output-test');
  const cases = [
    ["await ctx.output.start(); for(let i=0;i<64;i++){await ctx.output.write('x')} return ctx.output.close();", undefined],
    ["await ctx.output.start(); return ctx.text('wrong');", 'PULSE_OUTPUT_CLOSE_REQUIRED'],
    ["await ctx.output.start(); await ctx.output.start(); return ctx.output.close();", 'PULSE_OUTPUT_OWNERSHIP'],
    ["await ctx.output.write('x'); return ctx.output.close();", 'PULSE_OUTPUT_OWNERSHIP'],
    ["await ctx.output.start({status:204}); return ctx.output.close();", 'PULSE_OUTPUT_BODYLESS'],
    ["await ctx.output.start({headers:{'content-length':'1'}}); return ctx.output.close();", 'PULSE_OUTPUT_OPTIONS_INVALID'],
    ["await ctx.output.start(); await ctx.output.write('" + '€'.repeat(5462) + "'); return ctx.output.close();", 'PULSE_OUTPUT_LIMIT_EXCEEDED'],
    ["await ctx.output.start(); for(let i=0;i<64;i++){await ctx.output.write('x')} await ctx.output.write('x'); return ctx.output.close();", 'PULSE_OUTPUT_LIMIT_EXCEEDED']
  ];
  for (const [body, code] of cases) {
    const text = `export default async function handler(ctx){${body}}`, native = compile(text);
    for (const target of ['native', 'javascript']) {
      const options = { generatedOutput: true, maxDurationMs: 5000, outputCollect: true, strict: false, request: { method: 'GET' } };
      let collected;
      try {
        const run = async () => {
          if (target === 'native') return executeNative(native, options, executeCanonicalNativeModule);
          collected = collector({ ...options, requestMethod: 'GET' });
          await runtime.executeApplication(authored(text), new Request('http://fixture/'), { ...options, requestBudget: collected.budget, outputExecution: collected.outputExecution });
          await collected.outputExecution.finish();
          return collected.body();
        };
        if (code) await assert.rejects(run, error => error.code === code || error.cause?.code === code);
        else {
          const result = await run();
          assert.equal(target === 'native' ? result.response.body : result, 'x'.repeat(64));
        }
      } finally { collected?.dispose(); }
    }
  }
  // Invalid grouping must revoke queued dispatch before headers or bytes.
  const grouped = collector({ generatedOutput: true, maxDurationMs: 5000, requestMethod: 'GET' });
  try {
    await runtime.executeApplication(async ctx => {
      await ctx.parallel({ output: ctx.output.start() });
      return ctx.text('unexpected');
    }, new Request('http://fixture/'), { requestBudget: grouped.budget, outputExecution: grouped.outputExecution });
    assert.equal(grouped.outputExecution.started, false);
    assert.equal(grouped.body(), '');
  } finally { grouped.dispose(); }
}
async function finishDeadline() {
  const text = 'export default async function handler(ctx){await ctx.output.start();return ctx.output.close();}';
  const native = compile(text);
  for (const target of ['native', 'javascript']) {
    let release;
    const sink = new Writable({ write(_chunk, _encoding, done) { done(); }, final(done) { release = done; } });
    sink.setHeader = () => {};
    const budget = runtime.createRequestBudget({ maxDurationMs: 100 });
    const output = createGeneratedOutput(sink, { generatedOutput: true, maxDurationMs: 100, requestBudget: budget, requestMethod: 'GET' });
    try {
      const options = { outputExecution: output, requestBudget: budget, signal: budget.signal, strict: false };
      if (target === 'native') await executeCanonicalNativeModule(native, options);
      else await runtime.executeApplication(authored(text), new Request('http://fixture/'), options);
      await assert.rejects(output.finish());
      assert.equal(sink.destroyed, true);
      assert.equal(output.finished, false);
      release(); await turn();
      assert.equal(output.finished, false, 'late final callback cannot complete expired output');
    } finally { output.dispose(); budget.close(); }
  }
}
async function stop(dev) { dev.server.closeAllConnections(); await new Promise(resolve => dev.server.close(resolve)); }
async function httpWorkflow() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-str03a-'));
  let dev, originResponse;
  const origin = http.createServer((_req, res) => { originResponse = res; });
  origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
  const originUrl = `http://127.0.0.1:${origin.address().port}`;
  try {
    fs.mkdirSync(path.join(root, 'node_modules/@pulse-compute'), {recursive:true});
    fs.symlinkSync(path.resolve(__dirname, '../../../packages/pulse'), path.join(root, 'node_modules/@pulse-compute/pulse'), 'dir');
    fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, '.pulse'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'str03a', private: true, type: 'module', dependencies: { '@pulse-compute/pulse': require('../../../packages/pulse/package.json').version } }));
    fs.writeFileSync(path.join(root, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse'; const app=new Pulse({auto:true});
      app.get('/',async ctx=>{await ctx.output.start();await ctx.output.write('prefix');
      const tail=await ctx.fetch('${originUrl}/').text();await ctx.output.write(tail);return ctx.output.close()});export default app;`);
    fs.writeFileSync(path.join(root, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>({pulse:{entry:'src/index.ts',defaultProfile:'native',strict:false},
      native:{host:'node',target:'native',node:{generatedOutput:true,maxDurationMs:5000},dev:{networkFetch:true}},
      javascript:{host:'node',target:'javascript',node:{generatedOutput:true,maxDurationMs:5000},dev:{networkFetch:true}},
      disabled:{host:'node',target:'native'}, disabledJs:{host:'node',target:'javascript'},
      fastly:{host:'fastly',target:'native'}, fastlyJs:{host:'fastly',target:'javascript'}}));`);
    const sourceFile = path.join(root, 'src/index.ts'), originalSource = fs.readFileSync(sourceFile, 'utf8');
    fs.writeFileSync(sourceFile, "import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.get('/',async ctx=>{await ctx.output.start();await ctx.output.write('x');return ctx.output.close()});export default app;");
    for (const profile of ['disabled', 'disabledJs', 'fastly', 'fastlyJs']) {
      await assert.rejects(async () => buildProject(resolveProject({ cwd: root, profile })),
        error => { if (!/output|capabilit|eligible|support/i.test(error.message)) console.error(profile, error); return /output|capabilit|eligible|support/i.test(error.message); }, profile + ' must reject output during normal build');
    }
    fs.writeFileSync(sourceFile, originalSource);
    for (const target of ['native', 'javascript']) {
      const project = resolveProject({ cwd: root, profile: target });
      const built = await buildProject(project);
      if (target === 'native') assert.ok(built.files.nativeWasm);
      dev = await startDevServer(project, { port: 0, watch: false });
      const prefix = deferred(), finished = deferred(), chunks = [];
      const request = http.get(dev.ready.url, response => {
        response.on('data', chunk => { chunks.push(chunk); prefix.resolve(); });
        response.on('end', () => finished.resolve());
        response.on('error', error => finished.resolve(error));
      });
      request.on('error', error => { prefix.resolve(); finished.resolve(error); });
      request.setTimeout(5000, () => request.destroy(new Error('STR-03A HTTP fixture timeout')));
      await prefix.promise;
      assert.equal(Buffer.concat(chunks).toString(), 'prefix', target + ': real socket receives prefix before remaining producer input exists');
      for (let i = 0; !originResponse && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(originResponse); originResponse.end('tail'); originResponse = undefined;
      const error = await finished.promise; if (error) throw error;
      assert.equal(Buffer.concat(chunks).toString(), 'prefixtail');
      await stop(dev); dev = undefined;
    }
  } finally {
    if (dev) await stop(dev);
    origin.closeAllConnections(); await new Promise(resolve => origin.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
async function main() {
  const evidence = await lifecycle(); await boundaries(); await finishDeadline(); await httpWorkflow();
  console.log(JSON.stringify({ status: 'passed', ...evidence, scope: 'STR-03A workspace Native/JavaScript lowering, writer demand/cancellation/limits, normal build/dev real HTTP; installed qualification remains STR-03B' }));
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error.stack); console.error(JSON.stringify(error.diagnostics || error.detail)); process.exitCode = 1; });
