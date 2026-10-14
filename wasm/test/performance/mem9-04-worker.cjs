'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), child = require('node:child_process');
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const [owner, arena, count, directory] = process.argv.slice(2), iterations = Number(count);
assert(['helper', 'stage'].includes(owner)); assert(['default', 'elided'].includes(arena)); assert([0, 64, 256].includes(iterations));
assert(!fs.existsSync(directory)); fs.mkdirSync(directory, { recursive: true });
const report = { owner, arena, iterations, invocations: 2, status: 'running', rows: [], recipes: [] };
const write = (file, value) => fs.writeFileSync(path.join(directory, file), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');
const persist = () => write('result.json', report); persist();
const spawn = child.spawnSync; let strategy;
child.spawnSync = function(executable, args, options) {
  const result = spawn(executable, args, options);
  if (!args?.[0]?.endsWith('/assemblyscript/bin/asc.js')) return result;
  assert.equal(result.status, 0, result.stderr);
  report.recipes.push({ strategy, executable, args, cwd: options.cwd });
  fs.copyFileSync(path.resolve(options.cwd, args[1]), path.join(directory, strategy + '.generated.ts'));
  const observed = args.slice(1); observed[observed.indexOf('--outFile') + 1] = path.join(directory, strategy + '.observed.wasm');
  const run = spawn(executable, [path.join(__dirname, 'mem9-diagnostic-asc.mjs'), args[0], 'observed', ...observed], { ...options, timeout: 180000 });
  write(strategy + '.build.log', (run.stdout || '') + (run.stderr || ''));
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  return result;
};
try {
  const cwd = path.join(directory, 'fixture');
  const loop = `let n=70000;for(let i=0;i<${iterations};i++){n+=1;}`;
  const files = owner === 'helper' ? {
    'src/helper.ts': `export function sum():number {${loop}return n;}`,
    'src/index.ts': `import {Pulse} from '@pulse-compute/pulse';import {sum} from './helper';const app=new Pulse({auto:true});app.post('/',async ctx=>{const input=await ctx.req.json('proof.Input');const a=sum();const b=sum();return ctx.text(a+':'+b);});export default app;`,
  } : {
    'src/helper.ts': `export default async function shared(ctx,next){${loop}const text=await ctx.fetch('https://numeric-owner.test/value',{method:'POST',body:''+n}).text();const trace=ctx.state.get('trace')||'';ctx.state.set('trace',trace+n+';');return next();}`,
    'src/index.ts': `import {Pulse} from '@pulse-compute/pulse';import shared from './helper';const app=new Pulse({auto:true});app.post('/',shared);app.use(shared);app.post('/',async ctx=>{const input=await ctx.req.json('proof.Input');return ctx.text(ctx.state.get('trace'));});export default app;`,
  };
  require('../provider/assert-fastly-numeric-owners.cjs').writeProject(cwd, files); write('fixture.json', files);
  const tc = require('../s3/acceptance-toolchain.cjs').acceptanceToolchain();
  const plan = require('../../packages/compiler/src/canonical-native-plan').buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({ cwd, profile: 'node' })));
  assert.equal(owner === 'helper' ? plan.helpers.length : plan.stages.length, 1); write('plan.json', plan);
  const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
  const boxed = require('../support/numeric-region-control.cjs').withBoxedControl(p => p.compileFastlyNativePlatformCapabilitiesPlan);
  const expected = owner === 'helper' ? `${70000 + iterations}:${70000 + iterations}` : `${70000 + iterations};`.repeat(2);
  const outcomes = [];
  for (strategy of ['boxed', 'numeric']) {
    const artifact = (strategy === 'boxed' ? boxed : platform.compileFastlyNativePlatformCapabilitiesPlan)(plan, { cwd, canonicalBuild: true, requirePlatformCapability: false, emitWat: false, reportCapture: false, elideJsonCacheArena: arena === 'elided', bindings: { backends: { 'https://numeric-owner.test': 'numeric' } } });
    write(strategy + '.wasm', artifact.wasm); write(strategy + '.manifest.json', artifact.manifest);
    if (strategy === 'numeric') assert(artifact.manifest.numericRegions.regions.length > 0);
    for (const mode of ['ordinary', 'observed']) {
      const wasm = mode === 'ordinary' ? artifact.wasm : fs.readFileSync(path.join(directory, strategy + '.observed.wasm'));
      const Instance = WebAssembly.Instance, cycles = [];
      WebAssembly.Instance = new Proxy(Instance, { construct(Target, args) { return Reflect.construct(Target, [args[0], { ...args[1], mem9: { cycle(bytes) { cycles.push(bytes); } } }]); } });
      try {
        const r = tc.executeFastlyNativePlatformCapabilities(wasm, { request: { method: 'POST', path: '/', headers: [['content-type', 'application/json']], body: '{"n":70000}' }, fixtures: { 'https://numeric-owner.test/value': { status: 200, body: 'ok' } } });
        assert.equal(r.response.status, 200); assert.equal(r.response.body, expected);
        const ex = r.instance.exports, capacityBytes = ex.memory.buffer.byteLength;
        const row = { strategy, mode, wasmSha256: hash(wasm), responseSha256: hash(r.response.body), expectedSha256: hash(expected), capacityBytes, handles: ex.mem9_count?.() ?? null, numbers: ex.mem9_numbers?.() ?? null, managedAfterFullGc: null };
        if (mode === 'observed') { const before = cycles.length; ex.__collect(); assert(cycles.length > before); row.managedAfterFullGc = cycles.at(-1); assert.equal(ex.mem9_count(), row.handles); assert.equal(ex.memory.buffer.byteLength, capacityBytes); assert.equal(ex.mem9_ownership(), 511); }
        report.rows.push(row); outcomes.push({ response: r.response, trace: r.trace, outbound: r.outboundRequests }); persist();
      } finally { WebAssembly.Instance = Instance; }
    }
  }
  for (const o of outcomes) assert.deepEqual(o, outcomes[0]);
  assert.equal(report.recipes.length, 2); report.status = 'passed'; persist();
  console.log(`ok - MEM9-04 ${owner}/${arena}/${iterations}`);
} catch (e) { report.status = 'failed'; report.error = e.stack; report.detail = e.detail || e.diagnostics; persist(); console.error(e.stack); process.exitCode = 1; }
finally { child.spawnSync = spawn; }
