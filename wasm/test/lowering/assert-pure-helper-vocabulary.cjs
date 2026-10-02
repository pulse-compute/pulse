'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const values = require('../../packages/compiler/src/pure-helper-values');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');

const root = path.resolve(__dirname, '../../..');
const digest = value => createHash('sha256').update(value).digest('hex');
const record = fields => ({ kind: 'record', fields });
const field = (name, type) => ({ name, type });
const array = { kind: 'number-array' };
const nested = record([field('name', 'string'), field('child', record([field('count', 'number')])), field('items', array)]);

// Literal expectations characterize today's bounded shapes, not future admission.
const shapes = [
  ['string', true], ['number', true], ['boolean', true],
  ['string-or-undefined', false], ['unknown', false], [undefined, false],
  [array, true], [{ kind: 'number-array', mutable: true }, false],
  [nested, true], [record([]), false],
  [record(Array.from({ length: 32 }, (_, i) => field('f' + i, 'number'))), true],
  [record(Array.from({ length: 33 }, (_, i) => field('f' + i, 'number'))), false],
  [record([field('x', record([field('y', record([field('z', 'number')]))]))]), false],
  [record([field('constructor', 'string')]), false],
  [record([field('x', 'number'), field('x', 'number')]), false],
  [record([field('x', 'string-or-undefined')]), false],
];
for (const [type, expected] of shapes) assert.equal(values.validType(type), expected, JSON.stringify(type));

const types = new Map([['s', 'string'], ['n', 'number'], ['b', 'boolean'], ['optional', 'string-or-undefined'], ['a', array], ['r', nested]]);
const local = id => ({ kind: 'local', id, valueKind: 'forged-tag' });
const binary = (operator, left, right) => ({ kind: 'binary', operator, left: local(left), right: local(right), valueKind: 'forged-tag' });
const operations = [
  ['+', 's', 'n', 'string'], ['+', 'n', 'n', 'number'], ['-', 'n', 'n', 'number'],
  ['*', 'n', 'n', 'number'], ['/', 'n', 'n', 'number'], ['%', 'n', 'n', 'number'],
  ['**', 'n', 'n', 'number'], ['&', 'n', 'n', 'number'], ['|', 'n', 'n', 'number'],
  ['^', 'n', 'n', 'number'], ['<<', 'n', 'n', 'number'], ['>>', 'n', 'n', 'number'], ['>>>', 'n', 'n', 'number'],
  ['===', 's', 'n', 'boolean'], ['!==', 'b', 'b', 'boolean'], ['==', 'n', 'n', 'boolean'], ['!=', 'n', 'n', 'boolean'],
  ['<', 'n', 'n', 'boolean'], ['<=', 'n', 'n', 'boolean'], ['>', 'n', 'n', 'boolean'], ['>=', 'n', 'n', 'boolean'],
  ['&&', 'b', 'b', 'boolean'], ['||', 's', 's', 'string'], ['??', 'optional', 's', 'string'],
  ['||', 'optional', 's', 'string'], ['||', 's', 'optional', undefined], ['&&', 's', 'n', undefined],
  ['&&', 'r', 'r', nested], ['+', 'r', 'n', undefined],
];
for (const [operator, a, b, expected] of operations) assert.deepEqual(values.readType(binary(operator, a, b), types), expected);
for (const [operator, expected] of [['!', 'boolean'], ['typeof', 'string'], ['+', 'number'], ['-', 'number'], ['~', 'number'], ['void', undefined]]) {
  assert.equal(values.readType({ kind: 'unary', operator, value: local('n'), valueKind: 'forged-tag' }, types), expected);
}
assert.equal(values.readType({ kind: 'property', object: local('s'), property: 'length' }, types), 'number');
assert.equal(values.readType({ kind: 'element', object: local('a'), index: local('n') }, types), 'number');
// Inference proves this result; the independent helper-body validator still rejects it.
assert.equal(values.readType({ kind: 'element', object: local('s'), index: local('n') }, types), 'string');
assert.equal(values.readType({ kind: 'element', object: local('r'), index: { kind: 'literal', value: 'name' } }, types), 'string');

const tc = acceptanceToolchain();
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-r101-'));
try {
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.mkdirSync(path.join(cwd, '.pulse'));
  fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
  for (const name of ['pulse', 'runtime']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
  fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false},node:{host:'node',target:'native'}}));`);
  function compile(helper, caller = `const result=check(2);return ctx.text(''+result);`) {
    fs.writeFileSync(path.join(cwd, 'src/helper.ts'), helper);
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';import {check} from './helper';const app=new Pulse({auto:true});app.get('/',async(ctx)=>{${caller}});export default app;`);
    const compiled = tc.compileProject(tc.resolveProject({ cwd, profile: 'node' }));
    const plan = buildCanonicalNativePlan(compiled);
    validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan)));
    return { plan, compiled };
  }
  const positives = [
    [`export function check(n:number):number {let x=n;x+=2;x--;if(x>0)return ~(-x);return +x;}`],
    [`export function check(s:string,b:boolean):string {const text=s+'!';if(b&&s.length>0)return text;return typeof b;}`, `const result=check('abc',true);return ctx.text(result);`],
    [`export function check(a:number[]):number {return a[0]+a.length;}`, `const result=check([2,3]);return ctx.text(''+result);`],
    [`interface R{name:string;child:{count:number};items:number[]}export function check(r:R):string {const alias=r.child;return r.name+(alias.count+r.items[0]);}`, `const result=check({name:'a',child:{count:2},items:[3]});return ctx.text(result);`],
    [`export function check(n:number):boolean {return n>=0&&(n===1||n!==2);}`],
    [`export function check(s:string):string {return s||'fallback';}`, `const result=check(ctx.req.header('x-value')||'');return ctx.text(result);`],
    [`export function check(s:string):string {return s;}`, `const input='abc';const result=check(input[0]);return ctx.text(result);`],
  ];
  const accepted = positives.map(args => {
    const { plan, compiled } = compile(...args);
    return { planHash: plan.planHash, generatedSourceSha256: digest(compiled.generatedSource), resultKind: plan.helpers[0].resultKind };
  });
  const negatives = [
    [`export function check(s:string):string {return s[0];}`, `const result=check('abc');return ctx.text(result);`, 'PULSE_CANONICAL_NATIVE_PLAN_INVALID'],
    [`export function check(n:number):number {return 'bad';}`, undefined, 'PULSE_NATIVE_PURE_HELPER_RESULT_UNSUPPORTED'],
    [`export function check(r:{x?:number}):number {return r.x;}`, `const result=check({x:1});return ctx.text(''+result);`, 'PULSE_NATIVE_PURE_HELPER_SIGNATURE_UNSUPPORTED'],
    [`export function check(r:{x:{y:{z:number}}}):number {return r.x.y.z;}`, `const result=check({x:{y:{z:1}}});return ctx.text(''+result);`, 'PULSE_NATIVE_PURE_HELPER_SIGNATURE_UNSUPPORTED'],
    [`export function check(n:number):number {return n as number;}`, undefined, 'PULSE_NATIVE_PURE_HELPER_VALUE_UNSUPPORTED'],
    [`export function check(n:number):number {return check(n);}`, undefined, 'PULSE_NATIVE_PURE_HELPER_CALL_UNSUPPORTED'],
    [`export function check(s:string):number {return s-1;}`, `const result=check('1');return ctx.text(''+result);`, 'PULSE_CANONICAL_NATIVE_PLAN_INVALID'],
  ];
  const rejected = negatives.map(([helper, caller, expected]) => {
    let diagnostics;
    assert.throws(() => compile(helper, caller), error => {
      diagnostics = error.diagnostics;
      assert.ok(diagnostics?.some(d => d.code === expected), JSON.stringify(diagnostics));
      return true;
    });
    return diagnostics;
  });
  const { plan } = compile(...positives[3]);
  const native = compileCanonicalNativePlan(plan, { cwd: root, emitWat: false });
  console.log(JSON.stringify({ status: 'passed', shapeCases: shapes.length, operationCases: operations.length + 10,
    accepted, rejected, native: { wasmBytes: native.wasm.length, wasmSha256: digest(native.wasm), sourceSha256: digest(native.source) },
    stringIndexBoundary: 'caller projection admitted; inferred string helper-body index rejected' }));
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
