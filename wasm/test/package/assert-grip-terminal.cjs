'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const installed = process.argv.includes('--installed');
const root = installed ? process.cwd() : path.resolve(__dirname, '../../..');
const pkg = installed ? path.join(root, 'node_modules/@pulse-compute/grip') : path.join(root, 'packages/grip');
const compiler = name => require(installed ? '@pulse-compute/wasm-compiler/' + name : '../../packages/compiler/src/' + name);
const provider = name => require(installed ? '@pulse-compute/provider-fastly/' + name : '../../../packages/provider-fastly/src/' + name);
const execute = require(installed ? './terminal-host.cjs' : '../support/terminal-host.cjs');
const cliBuild = require(installed ? './terminal-cli.cjs' : '../support/terminal-cli.cjs');
const observer = require(installed ? './terminal-observer.cjs' : '../support/terminal-observer.cjs');
const ts = require('typescript');
const builder = require(path.join(pkg, 'pulsewasm.compiler.cjs')).buildGripLoweringPlan;
const { compileCanonicalProject, packageRealizationArtifactsForCompiled } = compiler('canonical-project-compiler');
const { buildCanonicalNativePlan } = compiler('canonical-native-plan');
const target = provider('build/canonical-target');
// Observation/omission probes use the verified packed internal seam, not a public export.
const platformFile = installed ? path.join(path.dirname(require.resolve('@pulse-compute/provider-fastly/build/canonical-target')), 'native-platform-capabilities.js') : path.join(root, 'packages/provider-fastly/src/build/native-platform-capabilities.js');
if (installed) assert(fs.realpathSync(platformFile).startsWith(root + path.sep));
const platform = require(platformFile);
const toolchain = provider('toolchain');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-grip-terminal-'));
const cells = [];
const imports = "import { handoffFanout as transfer } from '@pulse-compute/grip/experimental';";
const author = body => `${imports} export default async function handler(ctx) { ${body} }`;
function lower(sourceText) { return builder({ sourceText, sourcePath: path.join(temp, 'app.ts'), typescript: ts }); }
function compile(source) {
  fs.writeFileSync(path.join(temp, 'app.ts'), source);
  const compiled = compileCanonicalProject(path.join(temp, 'app.ts'), {
    rootDir: temp, workspaceRoot: temp, packageDirs: [pkg], requireAsync: true, strict: true,
    applicationProjectMetadata: { selectedProfile: { name: 'test', source: 'fixture' }, strict: true,
      target: 'native', host: 'fastly', projectHash: '3'.repeat(64), configPlanHash: '4'.repeat(64),
      bindings: { config: [], secret: [] }, fragments: {} }
  });
  return { compiled, plan: buildCanonicalNativePlan(compiled), realizationArtifacts: packageRealizationArtifactsForCompiled(compiled) };
}
async function main() {
  fs.mkdirSync(path.join(temp, 'node_modules/@pulse-compute'), { recursive: true });
  fs.symlinkSync(pkg, path.join(temp, 'node_modules/@pulse-compute/grip'));
  const rootApi = await import(pathToFileURL(path.join(pkg, 'dist/index.js')));
  const experimental = await import(pathToFileURL(path.join(pkg, 'dist/experimental.js')));
  assert.deepEqual(Object.keys(experimental).sort(), ['handoffFanout', 'handoffWebSocket']);
  for (const name of Object.keys(experimental)) {
    assert.equal(rootApi[name], undefined); assert.equal(rootApi.grip[name], undefined);
    assert.throws(() => experimental[name]({}, 'edge'), { code: 'PULSE_HOST_EXTENSION_TARGET' });
  }
  assert(rootApi.handoff({ channel: 'events' }) instanceof Response);
  for (const body of ["return transfer({}, 'edge');", "return transfer(ctx, ctx.req.path);",
    "return transfer(ctx, '');", "return void transfer(ctx, 'edge');", "return transfer?.(ctx, 'edge');", "return transfer(ctx, 'edge', 1);", "transfer(ctx, 'edge'); return ctx.text('bad');",
    "const token = transfer(ctx, 'edge'); return token;", "{ const ctx = {}; return transfer(ctx, 'edge'); }"]) {
    const p = lower(author(body)); assert(p.hasErrors, body);
    assert(p.diagnostics.some(d => d.code === 'PULSE_HOST_EXTENSION_PLACEMENT'));
    assert.equal(p.realizationArtifacts.length, 0);
  }
  assert.equal(lower(author("function inner(transfer) { return transfer(ctx, 'edge'); } return ctx.text('ok');")).canonicalEffects.length, 0);
  assert.equal(lower("import type { handoffFanout as transfer } from '@pulse-compute/grip/experimental'; export default async function handler(ctx) { return ctx.text('ok'); }").canonicalEffects.length, 0);
  assert.equal(lower("import {handoffFanout} from '@pulse-compute/grip'; export default async function handler(ctx) {return handoffFanout(ctx,'edge');}").canonicalEffects.length, 0);
  assert.equal(lower(author("return transfer(ctx, 'edge');")).canonicalEffects.length, 1);
  for (const [operation, abiName] of [['handoffFanout', 'redirect_to_grip_proxy_v2'], ['handoffWebSocket', 'redirect_to_websocket_proxy_v2']]) {
    const { compiled, plan, realizationArtifacts } = compile(`import * as terminal from '@pulse-compute/grip/experimental'; export default async function handler(ctx) { if(ctx.req.path === '/plain') return ctx.text('plain'); return terminal.${operation}(ctx, 'edge'); }`);
    assert.equal(realizationArtifacts.length, 1);
    assert.equal(realizationArtifacts[0].data.operation, operation);
    const providerConfig = { bindings: { backends: { edge: 'edge_backend' } }, maxDurationMs: 1000 };
    const input = { plan, cwd: root, projectRoot: temp, providerConfig, realizationArtifacts,
      targetDescriptor: toolchain.createDriver().targets.native, outDir: path.join(temp, 'out'),
      providerPlan: toolchain.createDriver().createLoweringPlan(compiled.metadata, providerConfig), metadata: compiled.metadata };
    const { native } = target.inspectFastlyCanonicalTarget(input);
    target.writeFastlyCanonicalTarget({ ...input, native });
    const bytes = fs.readFileSync(path.join(input.outDir, 'bin/main.wasm'));
    assert.deepEqual(bytes, native.wasm);
    const result = execute(bytes, { abi: 'fastly_http_req', abiName });
    assert.ifError(result.trap); assert.equal(result.error, 0); assert.equal(result.calls, 1); assert.equal(result.sends.length, 0);
    assert.equal(execute(bytes, { abi: 'fastly_http_req', abiName, path: '/plain' }).sends[0].body, 'plain');
    assert.equal(native.manifest.hostExtensions.contributions[0].package, '@pulse-compute/grip');
    assert.deepEqual(native.inspection.imports.filter(i => i.name.startsWith('redirect_')).map(i => i.name), [abiName]);
    const observed = platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { ...providerConfig, cwd: root, realizationArtifacts, lifecycleServices: observer() });
    const observation = execute(observed.wasm, { abi: 'fastly_http_req', abiName });
    assert.equal(observation.instance.exports.pulse_fastly_jwt_secret_calls(), 12345678);
    for (const descriptor of [{ provider: 'node', target: 'native', targetId: 'node-native' }, { provider: 'fastly', target: 'javascript', targetId: 'fastly-compute-javascript' }]) {
      assert.throws(() => platform.compileFastlyNativePlatformCapabilitiesPlan(plan, { ...providerConfig, realizationArtifacts, targetDescriptor: descriptor }), { code: 'PULSE_HOST_EXTENSION_TARGET' });
    }
    const cliBytes = cliBuild(temp, root, installed);
    const cliResult = execute(cliBytes, { abi: 'fastly_http_req', abiName });
    assert.ifError(cliResult.trap); assert.equal(cliResult.calls, 1); assert.equal(cliResult.sends.length, 0);
    cells.push({ operation, abi: abiName, wasmSha256: native.manifest.wasm.sha256 });
  }
  for (const source of ["export default async function handler(ctx) { return ctx.text('plain'); }", author("return ctx.text('plain');"), "import {handoff} from '@pulse-compute/grip'; export default async function handler(ctx) {return handoff({channel:'events'});}"]) {
    const { plan, realizationArtifacts } = compile(source);
    assert.equal(realizationArtifacts.length, 0);
    const generated = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, { realizationArtifacts, requirePlatformCapability: false });
    assert.doesNotMatch(generated.source, /__pulse_extension_|redirect_to_grip_proxy|redirect_to_websocket_proxy|__pulse_lifecycle_/);
  }
  // Compile the packed declarations with real handler types and package exports.
  fs.writeFileSync(path.join(temp, 'types.mts'), `import type { Handler, PulseContext } from '@pulse-compute/runtime';
import { handoffFanout, handoffWebSocket } from '@pulse-compute/grip/experimental';
import grip from '@pulse-compute/grip';
// @ts-expect-error experimental methods are not root exports
import { handoffFanout as forbidden } from '@pulse-compute/grip';
const one: Handler = async ctx => handoffFanout(ctx, 'edge');
const two: Handler = async ctx => handoffWebSocket(ctx, 'edge');
declare const ctx: PulseContext;
// @ts-expect-error context is required
handoffFanout('edge');
// @ts-expect-error not a root method
grip.handoffFanout(ctx, 'edge');
// @ts-expect-error no constructible terminal value
const completion: ReturnType<typeof handoffFanout> = {};
`);
  const runtime = installed ? path.join(root, 'node_modules/@pulse-compute/runtime') : path.join(root, 'packages/runtime');
  fs.symlinkSync(runtime, path.join(temp, 'node_modules/@pulse-compute/runtime'));
  const program = ts.createProgram([path.join(temp, 'types.mts')], { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  console.log(JSON.stringify({ status: 'passed', mode: installed ? 'installed' : 'workspace', qualification: 'injected ABI only', cells }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
