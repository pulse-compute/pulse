'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan');

const root = path.resolve(__dirname, '../../..');
const tc = acceptanceToolchain();
// A bounded UTF-16 scalar scan exercises adjacent code-unit reads.
const helperSource = [
  'export function unitEquals(text:string, at:number, expected:string):boolean {',
  '  const unit = text[at]; return unit === expected;',
  '}',
  'export function wellFormed(text:string):boolean {',
  '  let valid = true;',
  '  for (let i=0; i<320 && i<text.length; i++) {',
  '    const unit = text[i];',
  "    if (unit >= '\\ud800' && unit <= '\\udbff') {",
  "      if (i+1 >= text.length || text[i+1] < '\\udc00' || text[i+1] > '\\udfff') valid = false;",
  '    }',
  "    if (unit >= '\\udc00' && unit <= '\\udfff') {",
  "      if (i===0 || text[i-1] < '\\ud800' || text[i-1] > '\\udbff') valid = false;",
  '    }',
  '  }',
  '  return valid;',
  '}'
].join('\n');
const scanTexts = ['', 'A', '😀', 'A😀B', '\ud800', '\udc00', 'A\ud800B', 'A\udc00B', '\ud800\ud800\udc00'];
const reads = [
  ['', 0, 'A'], ['A', -1, 'A'], ['A', 0, 'A'], ['A', 1, 'A'],
  ['A', 0.5, 'A'], ['😀', 0, '\ud83d'], ['😀', 1, '\ude00'],
  ['😀', 2, '\ud83d'], ['A😀B', 3, 'B']
];
const find = (value, predicate) => {
  if (!value || typeof value !== 'object') return;
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const found = find(child, predicate);
    if (found) return found;
  }
};
const rehash = plan => {
  delete plan.planHash;
  plan.planHash = createHash('sha256').update(stableStringify(plan)).digest('hex');
  return plan;
};

async function main() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-s01-'));
  try {
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.mkdirSync(path.join(cwd, '.pulse'));
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 'runtime']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    const config = { pulse: { entry: 'src/index.ts', strict: false, defaultProfile: 'node-native' },
      'node-native': { host: 'node', target: 'native' },
      'node-javascript': { host: 'node', target: 'javascript' },
      'fastly-native': { host: 'fastly', target: 'native' } };
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'),
      "import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(" + JSON.stringify(config) + '));');
    fs.writeFileSync(path.join(cwd, 'src/helper.ts'), helperSource);
    const routes = [
      ...reads.map(([value, index, expected], i) => ({
        path: '/read-' + i, expected: String(value[index] === expected),
        source: 'unitEquals(' + [JSON.stringify(value), index, JSON.stringify(expected)].join(',') + ')'
      })),
      ...scanTexts.map((value, i) => ({
        path: '/scan-' + i, expected: String(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)),
        source: 'wellFormed(' + JSON.stringify(value) + ')'
      }))
    ];
    const writeEntry = lines => fs.writeFileSync(path.join(cwd, 'src/index.ts'),
      "import {Pulse} from '@pulse-compute/pulse';import {unitEquals,wellFormed} from './helper';const app=new Pulse({auto:true});"
      + lines + 'export default app;');
    writeEntry(routes.map(row => "app.get(" + JSON.stringify(row.path) + ",async(ctx)=>ctx.text(''+" + row.source + '));').join('\n'));
    const projects = Object.fromEntries(Object.keys(config).filter(k => k !== 'pulse').map(profile => [profile, tc.resolveProject({ cwd, profile })]));
    const compiled = tc.compileNativeProjectInMemory(projects['node-native']);
    const plan = compiled.plan;
    validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));
    const firstIndex = find(plan.helpers[0].body, e => e.kind === 'element');
    assert.equal(firstIndex?.valueKind, 'string-or-undefined');
    const forged = structuredClone(plan);
    find(forged.helpers[0].body, e => e.kind === 'element').valueKind = 'string';
    assert.throws(() => validateCanonicalNativePlan(rehash(forged)), error => {
      assert.ok(error.diagnostics?.some(d => d.message === 'pure expression kind mismatch'));
      assert.ok(!error.diagnostics?.some(d => d.message === 'plan hash mismatch'));
      return true;
    });
    const wrongIndex = structuredClone(plan);
    const element = find(wrongIndex.helpers[0].body, e => e.kind === 'element');
    element.index = { kind: 'literal', value: '0', valueKind: 'string' };
    assert.throws(() => validateCanonicalNativePlan(rehash(wrongIndex)), error =>
      error.diagnostics?.some(d => d.message === 'pure element requires a numeric array or string and numeric index'));
    const fastly = require('../../../packages/provider-fastly/src/build/native-platform-capabilities')
      .compileFastlyNativePlatformCapabilitiesPlan(plan, {
        cwd: root, canonicalBuild: true, emitWat: false, requirePlatformCapability: false
      });
    const js = tc.prepareJavascriptApplication(projects['node-javascript']);
    for (const row of routes) {
      const request = { method: 'GET', path: row.path, url: 'https://s01.test' + row.path, headers: [], body: '' };
      const native = await tc.executeCanonicalNativeModule(compiled.native, { request, strict: false });
      const platform = tc.executeFastlyNativePlatformCapabilities(fastly, { request });
      const javascript = await tc.executeNodeJavascriptApplication(js.loaded.application, new Request(request.url), { strict: false });
      assert.equal(native.response.status, 200, row.path + ' Node Native');
      assert.equal(platform.response.status, 200, row.path + ' Fastly Native');
      assert.equal(javascript.status, 200, row.path + ' JavaScript');
      assert.equal(native.response.body, row.expected, row.path + ' Node Native');
      assert.equal(platform.response.body, row.expected, row.path + ' Fastly Native');
      assert.equal(await javascript.text(), row.expected, row.path + ' JavaScript');
    }
    const badSources = [
      ['return text[at];', 'string', 'PULSE_NATIVE_PURE_HELPER_RESULT_UNSUPPORTED'],
      ['const unit=text[at];return unit.length;', 'number', 'PULSE_NATIVE_PURE_HELPER_RESULT_UNSUPPORTED'],
      ["return text['0']==='A';", 'boolean', 'PULSE_CANONICAL_NATIVE_PLAN_INVALID']
    ];
    for (const [body, resultType, code] of badSources) {
      fs.writeFileSync(path.join(cwd, 'src/helper.ts'), helperSource.replace(
        /export function unitEquals\([^{]+\{[^}]+\}/,
        'export function unitEquals(text:string,at:number,expected:string):' + resultType + ' {' + body + '}'
      ));
      assert.throws(() => tc.compileNativeProjectInMemory(projects['node-native']), error =>
        error.diagnostics?.some(d => d.code === code), body);
    }
    console.log(JSON.stringify({ status: 'passed', routes: routes.length, executions: routes.length * 3,
      nodeWasmBytes: compiled.native.wasm.length, fastlyWasmBytes: fastly.wasm.length,
      stringIndexKind: firstIndex.valueKind, forgedPlans: 2, negativeSources: badSources.length,
      semantics: 'UTF-16 code-unit indexing; missing indices are undefined' }));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

const keep = setInterval(() => {}, 1000);
main().catch(error => { console.error(error, error.diagnostics); process.exitCode = 1; }).finally(() => clearInterval(keep));
