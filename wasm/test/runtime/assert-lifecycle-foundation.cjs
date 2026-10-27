'use strict';

// P10 foundation application qualification. Services use the maintained internal
// driver seams; authored programs and emitted Wasm are never patched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const installed = process.argv.includes('--installed');
const root = installed ? fs.realpathSync(process.cwd()) : path.resolve(__dirname, '../../..');
function load(name, file) {
  let directory;
  if (installed) {
    directory = path.dirname(require.resolve('@pulse-compute/' + name));
    while (!fs.existsSync(path.join(directory, 'package.json'))) {
      const parent = path.dirname(directory); assert.notEqual(parent, directory); directory = parent;
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))).name, '@pulse-compute/' + name);
    assert(fs.realpathSync(directory).startsWith(root + path.sep), 'installed product cannot load checkout modules');
  } else directory = path.join(root, name.startsWith('wasm-') ? 'wasm/packages/' + name.slice(5) : 'packages/' + name);
  // These are explicitly internal packed-consumer tests, not new public exports.
  return require(path.join(directory, 'src', file));
}
const { compileCanonicalSource } = load('wasm-compiler', 'canonical-api-compiler');
const { compileCanonicalProject } = load('wasm-compiler', 'canonical-project-compiler');
const { buildCanonicalNativePlan } = load('wasm-compiler', 'canonical-native-plan');
const { compileCanonicalNativePlan } = load('wasm-compiler', 'canonical-native-compiler');
const host = load('wasm-host-runtime', 'runtime/canonical-native-host');
const { createNodeProviderAdapter } = load('provider-node', 'runtime/canonical-api-runtime');
const fastly = load('provider-fastly', 'build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities: executeFastly } = load('provider-fastly', 'testing/native-platform-capabilities-host');
const cli = load('provider-fastly', 'testing/fastly-cli');
const requireViceroy = process.argv.includes('--viceroy');
assert(process.argv.slice(2).every(arg => ['--viceroy', '--installed'].includes(arg)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const config = { A: 'A', B: 'B', RECOVER: 'recovered' }, secrets = { TOKEN: 'fixture' };
const url = 'https://foundation.example/data';
const bindings = { configStore: 'config', secretStore: 'secrets', backends: { 'https://foundation.example': 'origin' }, kv: { pages: 'pages' } };
const hook = (point, body) => ({ point, owner: 'foundation-proof', order: 0, body });
// Existing diagnostic counters expose observations without adding a host import
// or changing the generated driver. No JWT operation participates in this corpus.
const fastlyServices = [
  hook('effect.settle', '__pulse_fastly_jwt_secret_calls++; return true'),
  { point: 'effect.deliver', owner: 'foundation-proof', order: 0,
    before: '__pulse_fastly_jwt_crypto_calls++',
    after: 'if (accepted != 1) unreachable(); __pulse_fastly_jwt_crypto_calls += 1000' },
  hook('effect.result', '__pulse_fastly_jwt_clock_calls++; return true'),
  ...['invocation.end', 'invocation.close', 'invocation.closed'].map((point, index) =>
    hook(point, `__pulse_fastly_jwt_schema_calls = __pulse_fastly_jwt_schema_calls * 10 + ${index + 1}`))
];
const cases = [
  { name: 'mixed-sequential', effects: 4, body: 'AfixtureoriginB', source: `export default async function handler(ctx) {
    const a = await ctx.config.get('A'); const token = await ctx.secret.get('TOKEN');
    const text = await ctx.fetch('${url}').text(); const b = await ctx.config.get('B');
    return ctx.text(a + token + text + b);
  }` },
  { name: 'sequential-cohorts', effects: 4, body: 'AfixtureoriginB', source: `export default async function handler(ctx) {
    const first = await ctx.parallel({a:ctx.config.get('A'), token:ctx.secret.get('TOKEN')});
    const second = await ctx.parallel({text:ctx.fetch('${url}').text(), b:ctx.config.get('B')});
    return ctx.text(first.a + first.token + second.text + second.b);
  }` },
  { name: 'repeated-site', effects: 3, body: '3', source: `export default async function handler(ctx) {
    let count=0; for(let i=0;i<3;i++){const row=await ctx.kv('pages').getVersioned('missing');
    if(row.status!=='not-found')return ctx.text('bad');count++;}return ctx.text(''+count);
  }` },
  { name: 'call-between-effects', effects: 2, body: 'A8B', callable: true, source: `import {query} from './query';
    export default async function handler(ctx) { const a=await ctx.config.get('A');
      const input=ctx.decodeJson('{"value":7}','proof.Input');
      const value=ctx.call(query,input,{inputSchema:'proof.Input',outputSchema:'proof.Output'});
      const b=await ctx.config.get('B'); return ctx.text(a+value.value+b); }` },
  { name: 'router-recovery', effects: 2, body: 'recovered', status: 400, router: true, source: `import {Router} from '@pulse-compute/runtime';
    const app=new Router(); app.get('/',async ctx=>{const a=await ctx.config.get('A');
      const value=ctx.decodeJson('invalid JSON','proof.Value');return ctx.json(value,{schema:'proof.Value'});});
    app.error(async(error,ctx,next)=>{const value=await ctx.config.get('RECOVER');return ctx.text(value,{status:400});});
    export default app;` }
];
function planFor(entry, directory) {
  const options = { fileName: entry.name + '.ts', rootDir: root, strict: false, requireAsync: true };
  // Recovery uses a deliberately failed schema read after the first effect.
  if (entry.router || entry.callable) {
    const schema = path.join(directory, 'schemas.ts');
    fs.writeFileSync(schema, `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';
      interface Value {ok:boolean} interface Input {value:number} interface Output {value:number}
      export default defineSchemaRegistry({schemas:{'proof.Value':schema<Value>(),'proof.Input':schema<Input>(),'proof.Output':schema<Output>()}});`);
    const registry = load('wasm-schema-json', 'compiler/schema-registry').extractSchemaRegistry(schema, { projectRoot: directory }).registry;
    options.schemas = { registry, maxBytes: 4096 };
    const file = path.join(directory, entry.name + '.ts'); fs.writeFileSync(file, entry.source);
    if (entry.callable) fs.writeFileSync(path.join(directory, 'query.ts'), 'export function query(ctx,input){return {value:input.value+1};}');
    return buildCanonicalNativePlan(compileCanonicalProject(file, { rootDir: directory, workspaceRoot: root, strict: false, target: 'native', schemas: options.schemas }));
  }
  return buildCanonicalNativePlan(compileCanonicalSource(entry.source, options));
}
function nodeServices(trace) {
  const observe = point => ({ point, owner: 'foundation-proof', order: 0, run() { trace.push(point); } });
  return [
    { point: 'effect.settle', owner: 'foundation-proof', order: 0, run(effect, ticket) { trace.push(['settle', effect, ticket.sequence]); return true; } },
    { point: 'effect.deliver', owner: 'foundation-proof', order: 0, before(effect) { trace.push(['before', effect]); }, after(effect, _result, accepted) { assert.equal(accepted, 1); trace.push(['after', effect]); } },
    { point: 'effect.result', owner: 'foundation-proof', order: 0, run(effect) { trace.push(['result', effect]); return true; } },
    ...['invocation.end', 'invocation.close', 'invocation.closed'].map(observe)
  ];
}
const response = value => ({ status: value.status, body: Buffer.isBuffer(value.body) ? value.body.toString() : value.body });
async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-foundation-'));
  const report = { status: 'running', mode: installed ? 'installed' : 'workspace', evidence: 'compiled drivers with injected provider outcomes', cells: [], viceroy: null };
  let origin;
  try {
    let launcher;
    if (requireViceroy) {
      launcher = cli.inspectFastlyComputeLauncher({ viceroyBinary: process.env.PULSE_VICEROY_BIN, required: true });
      assert.equal(launcher.viceroyInspection.version, '0.21.1');
      report.viceroy = { version: launcher.viceroyInspection.version,
        sha256: hash(fs.readFileSync(launcher.viceroyInspection.binary)), cases: [] };
      origin = http.createServer((_req, res) => res.end('origin'));
      origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
    }
    for (const entry of cases) {
      const plan = planFor(entry, temporary), expected = { status: entry.status || 200, body: entry.body };
      const native = compileCanonicalNativePlan(plan, { cwd: root, emitWat: false });
      const options = { cwd: root, bindings, maxDurationMs: 1000, emitWat: false, requirePlatformCapability: false };
      const plain = fastly.compileFastlyNativePlatformCapabilitiesPlan(plan, options);
      const observed = fastly.compileFastlyNativePlatformCapabilitiesPlan(plan, { ...options, lifecycleServices: fastlyServices });
      assert.deepEqual(observed.inspection.imports, plain.inspection.imports, 'selected observers add no host imports');
      for (const selected of [false, true]) {
        const trace = [];
        const node = await host.executeCanonicalNativeModule(native, {
          providerAdapter: createNodeProviderAdapter({ config, secrets, kvStores: { pages: {} }, fetches: { [url]: { status: 200, text: 'origin' } } }),
          ...(selected ? { lifecycleServices: nodeServices(trace) } : {})
        });
        assert.deepEqual(response(node.response), expected, entry.name + '/node');
        if (selected) {
          assert.deepEqual(trace.slice(-3), ['invocation.end', 'invocation.close', 'invocation.closed']);
          for (const point of ['settle', 'before', 'result', 'after']) assert.equal(trace.filter(row => row[0] === point).length, entry.effects, entry.name + '/' + point);
          const settles = trace.filter(row => row[0] === 'settle');
          assert.equal(new Set(settles.map(row => row[2])).size, entry.effects, 'each settlement has a distinct visit');
        }
        const artifact = selected ? observed : plain;
        const authority = load('provider-fastly', 'testing/conditional-kv-host').createConditionalKvAuthority();
        authority.stores.set('pages', new Map());
        const actual = executeFastly(artifact, { configStore: 'config', config, secretStore: 'secrets', secrets,
          conditionalKv: { authority }, fixtures: { [url]: { status: 200, body: 'origin' } } });
        assert.deepEqual(response(actual.response), expected, entry.name + '/fastly');
        assert.equal(actual.trace.filter(row => row.name === 'send_downstream').length, 1);
        if (selected) {
          const ex = actual.instance.exports;
          assert.equal(ex.pulse_fastly_jwt_secret_calls(), entry.effects, entry.name + '/settle');
          assert.equal(ex.pulse_fastly_jwt_crypto_calls(), entry.effects * 1001, entry.name + '/around');
          assert.equal(ex.pulse_fastly_jwt_clock_calls(), entry.effects, entry.name + '/result');
          assert.equal(ex.pulse_fastly_jwt_schema_calls(), 123, entry.name + '/end-close-closed');
        }
      }
      const cell = { name: entry.name, status: 'passed', effects: entry.effects,
        nodeSha256: hash(native.wasm), fastlyControlSha256: hash(plain.wasm), fastlySelectedSha256: hash(observed.wasm) };
      report.cells.push(cell); console.log('ok - foundation ' + entry.name);
      if (launcher) {
        const directory = path.join(temporary, entry.name); fs.mkdirSync(directory);
        const wasmFile = path.join(directory, 'main.wasm'), manifestFile = path.join(directory, 'fastly.toml');
        fs.writeFileSync(wasmFile, observed.wasm);
        fs.writeFileSync(manifestFile, cli.renderFastlyLocalConfig({ name: 'foundation-' + entry.name,
          configStores: { config }, secretStores: { secrets }, kvStores: { pages: {} },
          backends: { origin: { url: `http://127.0.0.1:${origin.address().port}`, useSni: false } } }));
        const server = await cli.startFastlyComputeServe({ launcher, packageRoot: directory, wasmFile, manifestFile });
        try {
          for (let visit = 0; visit < 2; visit++) assert.deepEqual(response(await cli.requestFastlyCompute(server)), expected);
          assert.equal(hash(fs.readFileSync(wasmFile)), cell.fastlySelectedSha256);
          report.viceroy.cases.push({ name: entry.name, requests: 2, sha256: cell.fastlySelectedSha256, status: 'passed' });
        } finally { await server.stop(); }
      }
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message;
    throw error;
  } finally {
    if (origin) { origin.closeAllConnections(); await new Promise(resolve => origin.close(resolve)); }
    fs.rmSync(temporary, { recursive: true, force: true });
    console.log(JSON.stringify(report));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
