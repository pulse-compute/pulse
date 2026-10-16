'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { withBoxedHostControl, executionSemantics } = require('../support/host-numeric-control.cjs');
const host = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime');
const [owner, runtime, count, directory] = process.argv.slice(2), iterations = Number(count);
assert(['entry', 'helper', 'stage'].includes(owner)); assert(['schema', 'stub'].includes(runtime)); assert([0, 64, 256].includes(iterations));
assert.equal(typeof global.gc, 'function', 'Manual worker requires --expose-gc for process samples only');
assert(!fs.existsSync(directory)); fs.mkdirSync(directory, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const report = { owner, runtime, iterations, invocations: 2, status: 'running', rows: [] };
const write = (file, value) => fs.writeFileSync(path.join(directory, file), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');
const persist = () => write('result.json', report); persist();
async function main() {
  const cwd = path.join(directory, 'fixture'), read = runtime === 'schema' ? "const input=await ctx.req.json('proof.Input');" : '';
  const loop = `let n=70000;for(let i=0;i<${iterations};i++){n+=1;}`;
  const files = owner === 'helper' ? {
    'src/helper.ts': `export function sum():number {${loop}return n;}`,
    'src/index.ts': `import {Pulse} from '@pulse-compute/pulse';import {sum} from './helper';const app=new Pulse({auto:true});app.post('/',async ctx=>{${read}const a=sum();const b=sum();return ctx.text(a+':'+b);});export default app;`,
  } : owner === 'stage' ? {
    'src/helper.ts': `export default async function shared(ctx,next){${loop}const text=await ctx.fetch('https://numeric-owner.test/value',{method:'POST',body:''+n}).text();const trace=ctx.state.get('trace')||'';ctx.state.set('trace',trace+n+';');return next();}`,
    'src/index.ts': `import {Pulse} from '@pulse-compute/pulse';import shared from './helper';const app=new Pulse({auto:true});app.post('/',shared);app.use(shared);app.post('/',async ctx=>{${read}return ctx.text(ctx.state.get('trace'));});export default app;`,
  } : {
    'src/index.ts': `import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.post('/',async ctx=>{${read}${loop}const a=n;n=70000;for(let j=0;j<${iterations};j++){n+=1;}return ctx.text(a+':'+n);});export default app;`,
  };
  if (runtime === 'stub') files['.pulse/config.ts'] = `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false},node:{host:'node',target:'native'}}));`;
  require('../provider/assert-fastly-numeric-owners.cjs').writeProject(cwd, files); write('fixture.json', files);
  const tc = require('../s3/acceptance-toolchain.cjs').acceptanceToolchain();
  const project = tc.resolveProject({ cwd, profile: 'node' });
  const { plan, native } = tc.compileNativeProjectInMemory(project, { reportCapture: false, emitWat: false });
  assert.equal(native.manifest.schemaCodecs.active, runtime === 'schema');
  if (owner === 'helper') assert.equal(plan.helpers.length, 1);
  if (owner === 'stage') assert.equal(plan.stages.length, 1);
  write('plan.json', plan);
  const boxed = withBoxedHostControl(c => c.compileCanonicalNativePlan(plan, { cwd, reportCapture: false, emitWat: false }));
  const expected = owner === 'stage' ? `${70000 + iterations};`.repeat(2) : `${70000 + iterations}:${70000 + iterations}`;
  const outcomes = [];
  for (const [strategy, artifact] of [['boxed', boxed], ['numeric', native]]) {
    write(strategy + '.wasm', artifact.wasm); write(strategy + '.generated.ts', artifact.source); write(strategy + '.manifest.json', artifact.manifest);
    if (strategy === 'numeric') assert(artifact.manifest.numericRegions.regions.length > 0);
    for (const mode of ['ordinary', 'observed']) {
      let heap, instance;
      const originalPut = host.ValueHeap.prototype.put, Instance = WebAssembly.Instance;
      global.gc(); const processBefore = process.memoryUsage();
      if (mode === 'observed') {
        host.ValueHeap.prototype.put = function(value) { heap = this; return originalPut.call(this, value); };
        WebAssembly.Instance = new Proxy(Instance, { construct(Target, args) { instance = Reflect.construct(Target, args); return instance; } });
      }
      let r;
      try {
        r = await host.executeCanonicalNativeModule(artifact, { executionId: 'mem9-05', strict: false,
          request: { method: 'POST', path: '/', headers: [['content-type', 'application/json']], body: '{"n":1}' },
          providerAdapter: createNodeProviderAdapter(), fetches: { 'https://numeric-owner.test/value': { status: 200, body: 'ok' } } });
      } finally { host.ValueHeap.prototype.put = originalPut; WebAssembly.Instance = Instance; }
      assert.equal(r.response.status, 200); assert.equal(r.response.body, expected);
      const kinds = {};
      if (heap) { for (const v of heap.values.values()) { const kind = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; kinds[kind] = (kinds[kind] || 0) + 1; } assert.equal(heap.size(), r.valueHandleCount); }
      // Keep the observed request heap rooted: this measures within-request
      // table retention. Process totals include the compiler and artifacts;
      // neither heapUsed nor RSS is attributable to these entries alone.
      global.gc(); const processAfter = process.memoryUsage();
      const row = { strategy, mode, handles: r.valueHandleCount, kinds: heap ? kinds : null,
        guestCapacityBytes: instance?.exports.memory.buffer.byteLength ?? null, guestManagedBytes: null,
        processBefore, processAfter, wasmSha256: hash(artifact.wasm), responseSha256: hash(r.response.body), expectedSha256: hash(expected) };
      if (heap) assert.equal(heap.size(), row.handles, 'Host GC cannot remove strongly retained table entries');
      outcomes.push(executionSemantics(r));
      report.rows.push(row); persist();
    }
  }
  for (const outcome of outcomes) assert.deepEqual(outcome, outcomes[0]);
  report.status = 'passed'; persist(); console.log(`ok - MEM9-05 ${owner}/${runtime}/${iterations}`);
}
main().catch(e => { report.status = 'failed'; report.error = e.stack; report.detail = e.detail; persist(); console.error(e); process.exitCode = 1; });
