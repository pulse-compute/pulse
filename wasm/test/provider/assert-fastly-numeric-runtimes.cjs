'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash, createPublicKey, verify } = require('node:crypto');
const { fixture } = require('../performance/mem9-06a-fixtures.cjs');
const { withBoxedControl } = require('../support/numeric-region-control.cjs');
const { POLICY, LINKED_POLICY, HOST_POLICY } = require('../../packages/runtime-core-as/src/compiler/canonical-native-numeric');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scenarios = ['ok', 'repeat', 'stop', 'transport', 'deadline', 'cancel', 'recovery'];

function qualify(cell, directory, { observed = false, onBuild = () => {} } = {}) {
  assert(!fs.existsSync(directory)); fs.mkdirSync(directory, { recursive: true });
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');
  const report = { ...cell, status: 'running', rows: [], proof: null };
  const persist = () => write('result.json', report); persist();
  try {
    const cwd = path.join(directory, 'fixture'), f = fixture(cell, cwd);
    // Add an authored timeout: neverHeaders only models expiry when one is set.
    for (const file of ['src/index.ts', 'src/shared.ts']) {
      f.files[file] = f.files[file].replaceAll("{method:'POST',body:", "{method:'POST',timeoutMs:1000,body:");
      fs.writeFileSync(path.join(cwd, file), f.files[file]);
    }
    write('fixture.json', f);
    const tc = require('../s3/acceptance-toolchain.cjs').acceptanceToolchain();
    const plan = require('../../packages/compiler/src/canonical-native-plan').buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({ cwd, profile: 'node' })));
    const lowering = require('../../packages/compiler/src/spine/canonical-native-plan').packageLoweringForCanonicalNativePlan(plan);
    assert.equal(plan.helpers.length, 4); assert.equal(plan.stages.length, 1); write('plan.json', plan);
    const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
    const boxedPlatform = withBoxedControl(p => p);
    assert.equal(require('../../../packages/provider-fastly/src/build/native-platform-capabilities'), platform);
    const options = { cwd, canonicalBuild: true, requirePlatformCapability: false, emitWat: false, reportCapture: false,
      elideJsonCacheArena: cell.arena === 'elided', bindings: tc.resolveProject({ cwd, profile: 'fastly' }).providerConfig.bindings,
      guestUnits: lowering?.guestUnits || [], realizationArtifacts: lowering?.realizationArtifacts || [],
      targetDescriptor: require('../../../packages/provider-fastly/src/toolchain').createDriver().targets.native,
      synchronizedPackages: require('../../packages/cli/release-manifest.json').packages.map(({ name, version }) => ({ name, version })) };
    assert.equal(options.guestUnits.length, f.linked ? 1 : 0);
    const generated = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options);
    const control = boxedPlatform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options);
    write('production.source.ts', generated.source); write('boxed.source.ts', control.source);
    write('generation.json', { production: generated.manifest, boxed: control.manifest });
    const numeric = generated.manifest.numericRegions;
    assert.equal(numeric.policy, f.linked ? LINKED_POLICY : POLICY);
    assert.equal(numeric.enabled, !f.schema); assert.equal(numeric.regions.length > 0, !f.schema);
    // The final writer overrides caller/intermediate policy; elision is not eligibility.
    assert.equal(platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, { ...options, numericRegions: HOST_POLICY }).source, generated.source);
    if (f.schema) {
      assert.equal(numeric.reason, 'schema-active-linked'); assert.equal(generated.source, control.source);
      report.proof = { selected: 0, policy: numeric.policy, reason: numeric.reason, boxedSourceEqual: true };
      report.status = 'passed'; persist(); return report;
    }
    const canonical = require('../../packages/runtime-core-as/src/compiler/canonical-native');
    const portable = canonical.generateCanonicalNativeAssemblyScript(plan);
    const native = canonical.generateCanonicalNativeAssemblyScript(plan, { numericRegions: numeric.policy });
    const shape = g => g.blocks.map(({ lines, ...block }) => block);
    assert.deepEqual(shape(native), shape(portable)); assert.equal(native.manifest.guardStateCount, portable.manifest.guardStateCount);
    const paths = numeric.regions.flatMap(r => r.statementPaths);
    assert(plan.stages[0].body.some(s => paths.includes(s.statementPath))); assert(paths.some(p => p.startsWith('handlers.')));
    for (const h of plan.helpers) assert.equal(paths.some(p => p.startsWith(`helpers.${h.id}.`)), ['sum', 'edges'].includes(h.source.name), h.source.name);
    for (const capability of ['response.output', 'request.body.transform']) {
      const disabled = canonical.generateCanonicalNativeAssemblyScript({ ...plan, capabilities: [...plan.capabilities, capability] }, { numericRegions: numeric.policy });
      assert.equal(disabled.manifest.numericRegions.reason, 'execution-budget'); assert.equal(disabled.manifest.numericRegions.regions.length, 0);
    }
    report.proof = { selected: numeric.regions.length, policy: numeric.policy, controlBlocksEqual: true, declined: ['unknown live-in', '257-iteration flat loop', 'output/body-transform budgets'] };
    const outcomes = new Map();
    for (const strategy of ['boxed', 'production']) for (const mode of observed ? ['ordinary', 'observed'] : ['ordinary']) {
      const name = `${strategy}-${mode}`; onBuild({ strategy, mode });
      const artifact = (strategy === 'boxed' ? boxedPlatform : platform).compileFastlyNativePlatformCapabilitiesPlan(plan, options);
      write(name + '.wasm', artifact.wasm); write(name + '.manifest.json', artifact.manifest);
      assert.equal((artifact.manifest.numericRegions?.regions.length || 0) > 0, strategy === 'production');
      if (f.linked) {
        assert.equal(artifact.guestLink.audit.status, 'passed'); assert.equal(artifact.guestLink.audit.instructions.memoryGrow, 0);
        assert(artifact.guestLink.audit.checks.every(c => c.status === 'passed')); write(name + '.guest-link.json', artifact.guestLink);
      }
      const executions = [];
      for (const scenario of scenarios) {
        const failure = ['transport', 'deadline', 'cancel'].includes(scenario);
        const controller = new AbortController(), cancelled = Object.assign(new Error('MEM9 cancellation'), { code: 'MEM9_CANCELLED' });
        const response = scenario === 'transport' ? { sendStatus: 1 } : scenario === 'deadline' ? { neverHeaders: true } : { status: 200, body: scenario === 'stop' ? 'stop' : 'ok' };
        let r, outcome;
        try {
          r = tc.executeFastlyNativePlatformCapabilities(artifact, { request: f.request, secrets: { TEST_KEY: JSON.stringify(f.key) }, clockUnixSeconds: 1800000000,
            fixtures: { 'https://mem9.test/value': response },
            ...(scenario === 'cancel' ? { signal: controller.signal, onOutboundRequest: () => controller.abort(cancelled) } : {}) });
          outcome = { response: r.response, trace: r.trace, outbound: r.outboundRequests };
        } catch (e) { if (!failure) throw e; outcome = { code: e.code, detail: e.detail }; assert(e.code); }
        if (failure) assert(!r || r.response.status >= 400, `Failure fixture must fail: ${scenario}`);
        else {
          assert.equal(r.response.status, 200);
          if (scenario === 'stop') assert.equal(r.response.body, `stopped:${70000 + cell.iterations}`);
          else {
            const value = JSON.parse(r.response.body);
            if (f.linked) for (const key of ['before', 'after']) {
              const parts = value[key].split('.'); assert.equal(parts.length, 3);
              assert.equal(JSON.parse(Buffer.from(parts[0], 'base64url')).alg, f.algorithm);
              assert.equal(JSON.parse(Buffer.from(parts[1], 'base64url')).sub, key);
              assert(verify('sha256', Buffer.from(parts.slice(0, 2).join('.')), { key: createPublicKey({ key: f.key, format: 'jwk' }), ...(f.algorithm === 'ES256' ? { dsaEncoding: 'ieee-p1363' } : {}) }, Buffer.from(parts[2], 'base64url')));
              delete value[key];
            }
            assert.deepEqual(value, f.expected);
          }
        }
        if (outcomes.has(scenario)) assert.deepEqual(outcome, outcomes.get(scenario), 'Exact response, effect bytes, lifecycle and failure parity');
        else outcomes.set(scenario, outcome);
        const row = { scenario, outcomeSha256: hash(JSON.stringify(outcome)), capacityBytes: null, handles: null, numbers: null, allocatorSpanBytes: null, managedAfterFullGc: null };
        if (r) {
          const ex = r.instance.exports; row.capacityBytes = ex.memory.buffer.byteLength;
          if (f.linked) assert.equal(row.capacityBytes, 2097152);
          if (mode === 'observed') {
            row.handles = ex.mem9_count(); row.numbers = ex.mem9_numbers(); row.allocatorSpanBytes = ex.mem9_allocated(); row.managedAfterFullGc = ex.mem9_collect?.() ?? null;
            assert.equal(ex.mem9_count(), row.handles); assert.equal(ex.memory.buffer.byteLength, row.capacityBytes); assert.equal(ex.mem9_ownership(), 511);
          }
        }
        executions.push(row);
      }
      for (const i of [1, scenarios.length - 1]) assert.deepEqual({ ...executions[i], scenario: 'ok' }, executions[0]);
      report.rows.push({ strategy, mode, wasmSha256: hash(artifact.wasm), selected: artifact.manifest.numericRegions?.regions.length || 0, executions }); persist();
    }
    assert.equal(canonical.generateCanonicalNativeAssemblyScript(plan).source, portable.source);
    assert.equal(platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, options).source, generated.source);
    report.status = 'passed'; persist(); return report;
  } catch (e) { report.status = 'failed'; report.error = e.stack; report.detail = e.detail || e.diagnostics; persist(); throw e; }
}
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-numeric-runtimes-'));
  try {
    const readPlan = require('../../packages/compiler/src/canonical-native-plan').buildCanonicalNativePlan(
      require('../../packages/compiler/src/canonical-api-compiler').compileCanonicalSource(`export default async function handler(ctx) {
        let n=70000;for(let i=0;i<1;i++){const row=await ctx.kv('pages').getVersioned('p');for(let j=0;j<64;j++){n+=1;}}return ctx.text(''+n);
      }`, { fileName: 'fastly-numeric-read-budget.ts', strict: false, target: 'native' }));
    const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
    const options = { canonicalBuild: true, requirePlatformCapability: false, bindings: { kv: { pages: 'pages' } } };
    const disabled = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(readPlan, options);
    assert.equal(disabled.manifest.numericRegions.reason, 'execution-budget');
    assert.equal(disabled.source, withBoxedControl(p => p.generateFastlyNativePlatformCapabilitiesAssemblyScript(readPlan, options)).source);
    for (const runtime of ['stub', 'ES256', 'RS256']) qualify({ runtime, iterations: 256, arena: 'default' }, path.join(directory, runtime));
    for (const arena of ['default', 'elided']) qualify({ runtime: 'schema-linked', iterations: 256, arena }, path.join(directory, 'schema-' + arena));
    console.log('ok - Fastly numeric runtimes: stub, ES256, RS256, both schema-linked exclusions, boxed semantics, failure and recovery');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { qualify, scenarios, main };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
