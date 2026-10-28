'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const native = require('../ra03/native/build.cjs');
const p = require('../../ownership/prototype.cjs');
const {create} = require('../../ownership/fixture.cjs');
const {root} = native;
const compiler = require(path.join(root, 'wasm/packages/compiler/src/canonical-project-compiler'));
const {buildCanonicalNativePlan} = require(path.join(root, 'wasm/packages/compiler/src/canonical-native-plan'));
const platform = require(path.join(root, 'packages/provider-fastly/src/build/native-platform-capabilities'));
const owner = require(path.join(root, 'packages/provider-fastly/src/build/host-extensions'));
const contract = require(path.join(root, 'wasm/packages/contracts/src/provider/host-extension'));
const authored = (op, width = 1, imported = true) =>
  (imported ? `import {cache} from '${p.PACKAGE}';\n` : '') +
  `export default async function handler(ctx) {\n` + (op === 'none' ? `return ctx.text('ok');` :
    `const value = await ${width === 1 ? call(op, 0) : `ctx.parallel({${Array.from({length: width}, (_, i) => `k${i}:${call(op, i)}`).join(',')}})`}; return ctx.json(value);`) + '\n}\n';
function call(op, i) { return `cache.${op}(ctx,'k${i}'${op === 'putText' ? ",'payload'" : ''})`; }
function ledger(width) {
  let s = native.source(width, 1).replaceAll('export function', 'function');
  function once(a, b) { assert.equal(s.split(a).length - 1, 1); s = s.replace(a, b); }
  once('d==1?192:4', 'd==1?320:4');
  once('committed(1)+n*256', 'committed(1)+n*384');
  return s;
}
function hooks({mutation, reverse = false} = {}) {
  const id = 'resource-accounting.cache';
  let hs = [
    {point: 'request.acquired', owner: id, order: 20, body: '  cc_init();'},
    {point: 'effect.settle', owner: id, order: 20, body: '  return cc_settle(index,ticket,result);'},
    {point: 'effect.result', owner: id, order: 20, body: '  return cc_result_guard(effectIndex,handle);'},
    {point: 'effect.deliver', owner: id, order: 20,
      before: '  cc_delivery=index; cc_event(5,index,result);',
      after: '  cc_delivery=-1; cc_accepted[index]=accepted; cc_business[index]=accepted==1 && cc_outcome[index]==1 ? 1 : 0; cc_event(6,index,accepted);'},
    {point: 'invocation.closed', owner: id, order: 20, body: '  cc_finish();'}];
  if (mutation === 'no-result-guard') hs = hs.filter(h => h.point !== 'effect.result');
  if (mutation === 'no-settle-guard') hs = hs.filter(h => h.point !== 'effect.settle');
  if (mutation === 'no-cleanup') hs = hs.filter(h => h.point !== 'invocation.closed');
  return reverse ? hs.reverse() : hs;
}
function build(output, name, op, width = 1, options = {}) {
  fs.mkdirSync(output, {recursive: true});
  // Matched unused controls share an authored path; active/error fixtures are isolated.
  const directory = path.join(root, 'wasm/.test-results/hex-ra06-' + p.hash(path.resolve(output) + ':' + (op === 'none' ? 'controls' : name)).slice(0, 12));
  assert(!fs.existsSync(directory), 'fixture workspace must be absent before a build');
  fs.mkdirSync(directory, {recursive: true});
  try {
    const fixture = create(directory), source = authored(op, width, options.imported !== false);
    fixture.write(source);
    const compiled = compiler.compileCanonicalProject(fixture.file, {rootDir: directory, workspaceRoot: directory,
      target: 'native', packageTargetDescriptor: p.TARGET});
    const plan = buildCanonicalNativePlan(compiled);
    assert.equal(plan.effects.length, op === 'none' ? 0 : width);
    assert([1, 2, 8, 16, 32].includes(width));
    for (const [i,effect] of plan.effects.entries()) {
      assert.equal(effect.kind, 'host.extension'); assert.equal(effect.operation, op);
      assert.equal(effect.package, p.PACKAGE);
      assert.equal(effect.grouped, width > 1);
      const fields = effect.inputs.find(x => x.name === 'payload').value.entries;
      assert.deepEqual(fields.map(x => [x.key.value,x.value.kind,x.value.value]),
        [['key','literal','k'+i],['value','literal',op==='putText'?'payload':'']]);
    }
    const opts = {cwd: root, canonicalBuild: true, requirePlatformCapability: false, maxDurationMs: 1000,
      bindings: {}, realizationArtifacts: compiler.packageRealizationArtifactsForCompiled(compiled)};
    let generated, policy = null;
    if (options.adapter === false) generated = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, opts);
    else generated = p.withPrototype(() => {
      owner.source = selected => {
        if (!selected.length) return '';
        const contributions = [...new Map(selected.map(s => [s.artifact.id, s.artifact])).values()];
        let service = fs.readFileSync(path.join(__dirname, 'service.as.ts'), 'utf8')
          .replaceAll('/* WIDTH */', String(width)).replaceAll('/* WRITE */', op === 'putText' ? 'true' : 'false');
        if (options.mutation === 'commit-on-cleanup') service = service.replace('return cc_abandon(h);', 'return cc_body_close(h);');
        if (options.mutation === 'refund-unknown') service = service.replace('na_observe(t,4,0);', 'cw(claim(t),1,3); na_refund(t,cr(claim(t),4),0,cr(claim(t),6));');
        if (options.mutation === 'close-unready') service = service.replace('status!=0 || unchecked(out[0])!=1', 'status!=0');
        if (options.mutation === 'dispatch-after-failure') service = service.replace('if(__pulse_fastly_last_error!=0)return false;', '');
        // Keep operation selection: the unused primitive's ABI is not emitted.
        service = service.replace(/\/\/ BEGIN (getText|putText)\n([\s\S]*?)\/\/ END \1/g,
          (_, selectedOp, code) => selectedOp === op ? code : '');
        return contributions.map(a => a.data.source).join('\n') + '\n' + ledger(width) + '\n' + service;
      };
      owner.hooks = selected => selected.length ? hooks(options) : [];
      const result = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, opts);
      const selected = owner.select(plan, opts);
      if (selected.length) {
        const original = result.source;
        const anchor = 'function __pulse_fastly_wait_ready(effectIndex: i32): i32 {';
        assert.equal(original.split(anchor).length - 1, 1, 'cache resolver anchor');
        if (!options.mutation) {
          owner.hooks = () => hooks({...options, reverse: !options.reverse});
          assert.equal(original, platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, opts).source);
        }
        const artifacts = [...new Map(selected.map(s => [s.artifact.id, s.artifact])).values()];
        // The explicit diagnostic import is a private harness baseline addition.
        // Cache authority still comes only from selected package declarations.
        policy = contract.composeImportPolicy([...platform.FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS
          .map(([module,name]) => ({module,name,kind:'function'})), {module:'ra06_proof',name:'event',kind:'function'}], artifacts);
        return {...result, source: original.replace(anchor, anchor + ' return cc_resolve(effectIndex);')};
      }
      return result;
    });
    const wasm = native.compile(generated.source, output, name);
    if (policy) contract.auditWasm(wasm, policy);
    const artifacts = compiler.packageRealizationArtifactsForCompiled(compiled);
    for (const [suffix, data] of [['ts', source], ['plan.json', plan], ['contributions.json', artifacts],
      ['policy.json', policy]])
      fs.writeFileSync(path.join(output, name + '.' + suffix), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
    if (op !== 'none') {
      assert(imports.some(i => i.module === 'fastly_cache' && i.name === (op === 'getText' ? 'lookup' : 'insert')));
      assert(!imports.some(i => i.module === 'fastly_cache' && i.name === (op === 'getText' ? 'insert' : 'lookup')));
    } else assert(!imports.some(i => i.module === 'fastly_cache' || i.module === 'ra06_proof'));
    return {wasm, source: generated.source, plan, imports, policy, authored: source};
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
}
module.exports = {...native, build, ledger, authored};
