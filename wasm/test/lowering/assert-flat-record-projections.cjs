'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { gzipSync } = require('node:zlib');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const fixture = require('../runtime/compiler-efficiency/n01/cases.json');
const root = path.resolve(__dirname, '../../..');
const consumer = process.env.N03_CONSUMER;
const installed = consumer && createRequire(path.join(consumer, 'package.json'));
const tc = acceptanceToolchain(consumer);
const api = installed ? installed('@pulse-compute/wasm-compiler/canonical-native-plan') : require('../../packages/compiler/src/canonical-native-plan');
const codecsApi = installed ? installed('@pulse-compute/wasm-schema-json/compiler/canonical-schema-codecs') : require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const fastlyApi = installed ? require(path.join(path.dirname(installed.resolve('@pulse-compute/provider-fastly')), 'build/native-platform-capabilities.js')) : require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const output = process.env.N03_OUTPUT;
const report = { status: 'running', node: process.version, runnerSha256: sha(fs.readFileSync(__filename)), scope: process.env.N03_PLAN_ONLY === '1' ? 'development-plan-only' : 'cross-target-and-independent-validation', matrix: [], positives: [], negatives: [], forged: [] };
const save = () => { if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); };
const find = (value, test) => {
  if (!value || typeof value !== 'object') return;
  if (test(value)) return value;
  for (const child of Object.values(value)) { const found = find(child, test); if (found) return found; }
};
const prefix = "const data=ctx.decodeJson<Cells>(await ctx.req.text(),'probe.Cells');";
const loop = content => `for(let i=0;i<24&&i<data.items.length;i++){${content}}`;
const helper = fixture.cases[0].helper;
const codes = e => [...new Set((e.diagnostics || []).map(d => d.code))].sort();
function inventory() {
  if (!consumer) return;
  const file = path.join(consumer, 'candidate.json'), candidate = JSON.parse(fs.readFileSync(file));
  for (const f of candidate.modifiedFiles) assert.equal(sha(fs.readFileSync(path.join(consumer, f.path))), f.sha256, f.path);
  return { sourceCommit: candidate.sourceCommit, sourceTree: candidate.sourceTree, candidateSha256: sha(fs.readFileSync(file)),
    packageFiles: candidate.modifiedFiles.length, manifestSha256: candidate.officialPackManifestSha256,
    lockSha256: sha(fs.readFileSync(path.join(consumer, 'package-lock.json'))) };
}
async function main() {
  if (output) assert.ok(!fs.existsSync(output), 'fresh evidence path required');
  report.packages = inventory(); save();
  const cwd = fs.mkdtempSync(path.join(consumer || os.tmpdir(), 'pulse-n03-'));
  try {
    fs.mkdirSync(path.join(cwd, 'src')); fs.mkdirSync(path.join(cwd, '.pulse'));
    if (!consumer) {
      fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
      for (const n of ['pulse', 'runtime']) fs.symlinkSync(path.join(root, 'packages', n), path.join(cwd, 'node_modules/@pulse-compute', n), 'dir');
    }
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), "import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false},node:{host:'node',target:'native'},js:{host:'node',target:'javascript'}}));");
    fs.writeFileSync(path.join(cwd, 'src/types.ts'), fixture.types);
    fs.writeFileSync(path.join(cwd, 'src/schemas.ts'), "import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';import type {" + fixture.schemaTypes.join(',') + "} from './types';export default defineSchemaRegistry({schemas:{" + fixture.schemaTypes.map(t => `'probe.${t}':schema<${t}>()`).join(',') + '}});');
    function write(body, source = helper) {
      fs.writeFileSync(path.join(cwd, 'src/helper.ts'), source);
      fs.writeFileSync(path.join(cwd, 'src/index.ts'), "import {Pulse} from '@pulse-compute/pulse';import type {" + fixture.schemaTypes.join(',') + "} from './types';import {check} from './helper';const app=new Pulse({auto:true});app.post('/',async(ctx)=>{" + body + "});export default app;");
    }
    const project = profile => tc.resolveProject({ cwd, profile });
    const plan = (body, source) => { write(body, source); return api.buildCanonicalNativePlan(tc.compileProject(project('node'), { target: 'native' })); };
    // Retain N-01's historical matrix. This new gate states the exact delta.
    const unlocked = new Set(['flat-constant-index-guarded', 'flat-bounded-direct-projection', 'flat-bounded-element-alias', 'flat-bounded-array-alias', 'flat-bounded-loop-spread']);
    for (const spec of fixture.cases) {
      let error;
      try { api.validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan(spec.body + "return ctx.text(''+answer);", spec.helper)))); } catch (e) { error = e; }
      const expected = unlocked.has(spec.id) ? 'admitted' : spec.expected;
      const expectedCodes = unlocked.has(spec.id) ? [] : spec.id === 'flat-constant-index-unguarded' ? ['PULSE_CANONICAL_NATIVE_PLAN_INVALID'] : spec.expectedDiagnosticCodes;
      const row = { id: spec.id, status: error ? 'rejected' : 'admitted', codes: error ? codes(error) : [], expected, message: error?.message, diagnostics: error?.diagnostics };
      report.matrix.push(row); save(); assert.equal(row.status, expected, spec.id); assert.deepEqual(row.codes, expectedCodes, spec.id);
    }
    const positives = [
      { id: 'direct-loop', body: prefix + "let answer=true;" + loop("if(!check(data.items[i].text))answer=false;") + "return ctx.text(''+answer);", expected: items => String(items.slice(0, 24).every(e => !e.text.includes('\0'))) },
      { id: 'aliases-loop', body: prefix + "const entries=data.items;let answer=true;for(let i=0;i<24&&i<entries.length;i++){const entry=entries[i];const alias=entry;if(!check(alias.text))answer=false;}return ctx.text(''+answer);", expected: items => String(items.slice(0, 24).every(e => !e.text.includes('\0'))) },
      { id: 'spread-after-loop', body: prefix + "let selected={text:'',tag:'initial'};" + loop("const entry=data.items[i];if(entry.tag==='selected')selected={...selected,text:entry.text};") + "return ctx.text(''+check(selected.text));", expected: items => String(!(items.slice(0, 24).filter(e => e.tag === 'selected').at(-1)?.text || '').includes('\0')) },
      { id: 'constant-early-return', body: prefix + "if(data.items.length===0)return ctx.text('empty');const entry=data.items[0];return ctx.text(''+check(entry.text));", expected: items => items.length ? String(!items[0].text.includes('\0')) : 'empty' },
      { id: 'constant-branch', body: prefix + "if(data.items.length>1){return ctx.text(''+check(data.items[1].text));}return ctx.text('short');", expected: items => items.length > 1 ? String(!items[1].text.includes('\0')) : 'short' },
      { id: 'scalar-after-loop', body: prefix + "let text='';" + loop("const entry=data.items[i];text=entry.text;") + "return ctx.text(''+check(text));", expected: items => String(!(items.slice(0, 24).at(-1)?.text || '').includes('\0')) },
      { id: 'short-circuit', body: prefix + "return ctx.text(''+(data.items.length>0&&check(data.items[0].text)));", expected: items => String(items.length > 0 && !items[0].text.includes('\0')) }
      ,{ id: 'independent-inline-scan', body: prefix + "let selected={text:''};let repeated=false;" + loop("const entry=data.items[i];for(let j=0;j<24&&j<i;j++){if(data.items[j].tag===entry.tag)repeated=true;}selected={...selected,text:entry.text};") + "return ctx.text(''+check(selected.text));", expected: items => String(!(items.slice(0, 24).at(-1)?.text || '').includes('\0')) }
    ];
    const cell = text => ({ tag: 'selected', text });
    const vectors = [[], [cell('ready')], [cell('\0')], [cell(''), cell('hello')], [cell('ok'), cell('\0')],
      Array.from({ length: 24 }, (_, i) => cell(i === 23 ? '\0' : 'ok')),
      Array.from({ length: 25 }, (_, i) => cell(i === 24 ? '\0' : 'ok')), [cell('😀')], [cell('reset')]];
    const plans = new Map();
    for (const spec of positives) {
      write(spec.body);
      if (process.env.N03_PLAN_ONLY === '1') { plans.set(spec.id, plan(spec.body)); continue; }
      const compiled = tc.compileNativeProjectInMemory(project('node'));
      plans.set(spec.id, compiled.plan); api.validateCanonicalNativePlan(JSON.parse(JSON.stringify(compiled.plan)));
      assert.equal(compiled.plan.helpers.length, 1);
      assert.ok(compiled.plan.helpers[0].parameters.every(p => !p.borrow));
      const fastly = fastlyApi.compileFastlyNativePlatformCapabilitiesPlan(compiled.plan, { cwd: consumer || root, canonicalBuild: true, emitWat: false, requirePlatformCapability: false });
      const js = tc.prepareJavascriptApplication(project('js'));
      const schemaCodecs = codecsApi.createCanonicalSchemaCodecs(compiled.plan.schemas.registry);
      const row = { id: spec.id, cases: 0, executions: 0, nodeWasmBytes: compiled.native.wasm.length, fastlyWasmBytes: fastly.wasm.length,
        nodeGzip9Bytes: gzipSync(compiled.native.wasm, { level: 9 }).length, fastlyGzip9Bytes: gzipSync(fastly.wasm, { level: 9 }).length };
      for (const items of vectors) {
        const request = { method: 'POST', path: '/', url: 'https://n03.test/', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) };
        const expected = spec.expected(items);
        const nativeResult = await tc.executeCanonicalNativeModule(compiled.native, { request, strict: false });
        const fastlyResult = tc.executeFastlyNativePlatformCapabilities(fastly, { request });
        const jsResult = await tc.executeNodeJavascriptApplication(js.loaded.application, new Request(request.url, { method: 'POST', headers: request.headers, body: request.body }), { strict: false, schemaCodecs });
        assert.deepEqual([nativeResult.response.status, nativeResult.response.body], [200, expected], spec.id);
        assert.deepEqual([fastlyResult.response.status, fastlyResult.response.body], [200, expected], spec.id);
        assert.deepEqual([jsResult.status, await jsResult.text()], [200, expected], spec.id);
        row.cases++; row.executions += 3;
      }
      report.positives.push(row); save(); console.log(spec.id, row.executions);
    }
    const negative = (id, body, source = helper) => {
      let error; try { plan(body, source); } catch (e) { error = e; }
      report.negatives.push({ id, codes: error ? codes(error) : [], diagnostics: error?.diagnostics }); save();
      assert.ok(error?.diagnostics?.length, id);
      assert.ok(codes(error).every(c => ['PULSE_CANONICAL_NATIVE_PLAN_INVALID', 'PULSE_NATIVE_PURE_HELPER_ARGUMENT_UNSUPPORTED', 'PULSE_NATIVE_PURE_HELPER_SIGNATURE_UNSUPPORTED', 'PULSE_NATIVE_PURE_HELPER_CAPTURE_UNSUPPORTED', 'PULSE_CANONICAL_PURE_LOOP_UNSUPPORTED'].includes(c)), id + ':' + codes(error));
    };
    for (const [id, read] of [['negative-index', '-1'], ['fractional-index', '0.5'], ['wrong-index', '1']]) negative(id, prefix + `if(data.items.length>0)return ctx.text(''+check(data.items[${read}].text));return ctx.text('empty');`);
    negative('wrong-array', prefix + "const other=ctx.decodeJson<Cells>('{}','probe.Cells');if(other.items.length>0)return ctx.text(''+check(data.items[0].text));return ctx.text('empty');");
    negative('guard-after-read', prefix + "const entry=data.items[0];if(data.items.length>0)return ctx.text(''+check(entry.text));return ctx.text('empty');");
    negative('wrong-branch', prefix + "if(data.items.length===0)return ctx.text(''+check(data.items[0].text));return ctx.text('other');");
    negative('unguarded-loop', prefix + "let answer=true;for(let i=0;i<24;i++){if(!check(data.items[i].text))answer=false;}return ctx.text(''+answer);");
    negative('shadow-index', prefix + "let answer=true;for(let i=0;i<24&&i<data.items.length;i++){const j=25;if(!check(data.items[j].text))answer=false;}return ctx.text(''+answer);");
    negative('mutated-index', prefix + "let answer=true;" + loop("i=0;if(!check(data.items[i].text))answer=false;") + "return ctx.text(''+answer);");
    for (const mutation of ["data.items[0].text='bad';", "const alias=data.items;alias[0]={tag:'x',text:'bad'};", "const holder={list:data.items};holder.list[0].text='bad';", 'data.items=[];']) {
      negative('write-after-call-' + mutation, prefix + "if(data.items.length===0)return ctx.text('empty');const answer=check(data.items[0].text);" + mutation + "return ctx.text(''+answer);");
    }
    negative('mutable-array-alias', prefix + "let entries=data.items;if(entries.length===0)return ctx.text('empty');return ctx.text(''+check(entries[0].text));");
    negative('reassigned-array', prefix + "let entries=data.items;entries=data.items;if(entries.length===0)return ctx.text('empty');return ctx.text(''+check(entries[0].text));");
    negative('retain-element', prefix + "if(data.items.length===0)return ctx.text('empty');const entry=data.items[0];const holder={entry};return ctx.text(''+check(entry.text));");
    negative('structured-helper-argument', prefix + "if(data.items.length===0)return ctx.text('empty');return ctx.text(''+check(data.items[0]));", "export function check(entry:{tag:string;text:string}):boolean{return entry.text==='ok';}");
    negative('structured-response', prefix + "if(data.items.length===0)return ctx.text('empty');const entry=data.items[0];const answer=check(entry.text);return ctx.json(entry);");
    negative('continuation-array', prefix + "await ctx.kv('records').get('x');if(data.items.length===0)return ctx.text('empty');return ctx.text(''+check(data.items[0].text));");
    negative('unknown-origin', "const data=await ctx.req.json();if(data.items.length===0)return ctx.text('empty');return ctx.text(''+check(data.items[0].text));");
    negative('assertion-origin', "const data=(await ctx.req.json()) as Cells;if(data.items.length===0)return ctx.text('empty');return ctx.text(''+check(data.items[0].text));");
    negative('over-budget', prefix + "let answer=true;for(let i=0;i<257&&i<data.items.length;i++){if(!check(data.items[i].text))answer=false;}return ctx.text(''+answer);");
    negative('inline-read-does-not-prove-argument', prefix + "let answer=true;" + loop("for(let j=0;j<24&&j<i;j++){if(!check(data.items[j].text))answer=false;}") + "return ctx.text(''+answer);", "export function check(value:string):boolean{return value==='ok';}");
    const forge = (id, base, mutate, expected = /flat-record|pure argument|pure input|pure loop|invalid pure helper/) => {
      const p = structuredClone(plans.get(base)); mutate(p); delete p.planHash; p.planHash = sha(api.stableStringify(p));
      let error; try { api.validateCanonicalNativePlan(p); } catch (e) { error = e; }
      report.forged.push({ id, diagnostics: error?.diagnostics }); save();
      assert.ok(error?.diagnostics?.some(d => expected.test(d.message)), id);
      assert.ok(!error.diagnostics.some(d => d.message === 'plan hash mismatch'), id);
    };
    const element = p => find(p.handlers, e => e.kind === 'element' && e.object?.property === 'items');
    const bound = p => find(p.handlers, e => e.kind === 'binary' && e.right?.property === 'length');
    const literal = value => ({ kind: 'literal', value, valueKind: 'number' });
    forge('missing-length-bound', 'direct-loop', p => { bound(p).right = literal(24); });
    forge('wrong-array-bound', 'direct-loop', p => { bound(p).right.object.property = 'other'; });
    for (const value of [-1, 0.5, 24]) forge('forged-index-' + value, 'direct-loop', p => { element(p).index = literal(value); });
    forge('wrong-branch', 'constant-early-return', p => { find(p.handlers, e => e.kind === 'binary' && e.operator === '===').operator = '!=='; });
    for (const mutate of [f => { f.required = false; }, f => { f.value = { kind: 'f64' }; }, f => { f.name = 'other'; }]) forge('changed-element-shape-' + report.forged.length, 'direct-loop', p => { mutate(p.schemas.registry.schemas.find(s => s.id === 'probe.Cells').root.fields[0].value.element.fields[1]); });
    forge('unknown-decoder', 'direct-loop', p => { find(p.handlers, e => e.kind === 'intrinsic' && e.name === 'schema.decode.text').arguments[1].value = 'missing.Schema'; });
    forge('mutable-element-alias', 'aliases-loop', p => { const l = p.locals.find(l => l.name === 'entry'); l.declaration = 'let'; find(p.handlers, e => e.kind === 'local' && e.localId === l.id).declaration = 'let'; });
    forge('element-after-loop', 'aliases-loop', p => { const body = p.handlers[0].body; const loop = find(body, e => e.kind === 'pure-loop'); const statement = loop.body.pop(); body.splice(body.length - 1, 0, statement); });
    forge('guard-after-initializer', 'constant-early-return', p => { const b = p.handlers[0].body, i = b.findIndex(s => s.kind === 'if' && s.test?.left?.property === 'length'); [b[i], b[i+1]] = [b[i+1], b[i]]; });
    forge('duplicate-element-binding', 'aliases-loop', p => { const b = find(p.handlers, e => e.kind === 'pure-loop').body; b.splice(1, 0, structuredClone(b[0])); });
    forge('scalar-tag-forgery', 'spread-after-loop', p => { const field = find(p.handlers, e => e.kind === 'property' && e.property === 'text' && e.object?.name === 'entry'); field.property = 'missing'; });
    forge('alias-write-after-call', 'aliases-loop', p => {
      const l = p.locals.find(l => l.name === 'alias');
      find(p.handlers, e => e.kind === 'pure-loop').body.push({ kind: 'expression', expression: { kind: 'assignment', operator: '=',
        target: { kind: 'property', object: { kind: 'local', id: l.id, name: l.name, valueKind: 'object' }, property: 'text', valueKind: 'string' },
        value: { kind: 'literal', value: 'bad', valueKind: 'string' }, valueKind: 'string' } });
    });
    forge('reassigned-array-root', 'direct-loop', p => {
      const l = p.locals.find(l => l.name === 'data');
      p.handlers[0].body.push({ kind: 'expression', expression: { kind: 'assignment', operator: '=',
        target: { kind: 'local', id: l.id, name: l.name, valueKind: l.valueKind },
        value: structuredClone(find(p.handlers, e => e.kind === 'local' && e.localId === l.id).value), valueKind: l.valueKind } });
    });
    forge('loop-over-budget', 'direct-loop', p => { const l = find(p.handlers, e => e.kind === 'pure-loop'); l.maxIterations = 257; l.test.left.right.value = 257; });
    assert.deepEqual(inventory(), report.packages);
    report.status = 'passed'; save();
    console.log(JSON.stringify({ status: report.status, matrix: report.matrix.length, positives: report.positives.length,
      executions: report.positives.reduce((n, r) => n + r.executions, 0), negatives: report.negatives.length, forged: report.forged.length }));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
const keep = setInterval(() => {}, 1000);
main().catch(error => { report.status = 'failed'; report.failure = { message: error.message, diagnostics: error.diagnostics }; save(); console.error(error, error.diagnostics); process.exitCode = 1; }).finally(() => clearInterval(keep));
