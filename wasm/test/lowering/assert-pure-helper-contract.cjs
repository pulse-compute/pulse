'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
const fixtures = path.join(__dirname, '../fixtures/pure-helpers');
const expected = require('../fixtures/pure-helpers/expectations.json');
assert.equal(expected.status, 'scalar-supported-records-unsupported');
const program = ts.createProgram(['scalar.ts', 'partition.ts', 'types.ts'].map(file => path.join(fixtures, file)), {
  strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022,
});
assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [],
  'fixtures must satisfy ordinary TypeScript checking');

// Execute the authored fixtures with TypeScript's ordinary transpiler. This is
// a source oracle, not a second Pulse compiler or Native/JS parity claim.
function sourceExports(file) {
  const source = fs.readFileSync(path.join(fixtures, file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(output.outputText, { exports }, { timeout: 1000 });
  return exports;
}
const { isPositive } = sourceExports('scalar.ts');
for (const [input, result] of [[-1, false], [0, false], [-0, false], [1, true], [0.5, true]]) {
  assert.equal(isPositive(input), result);
}
const { validPartition } = sourceExports('partition.ts');
const fresh = () => ({ subjectKind: 'item', subjectId: 'abc', partition: 0,
  revision: 1, root: { hash: 'hash', node: 0 }, counters: Array(10).fill(0) });
let oracleCases = 0;
function check(head, result, kind = 'item', id = 'abc', partition = 0) {
  const before = structuredClone(head);
  assert.equal(validPartition(head, kind, id, partition), result);
  assert.deepEqual(head, before, 'borrowed input remains unchanged');
  oracleCases++;
}
check(fresh(), true);
check({ ...fresh(), partition: 15 }, true, 'item', 'abc', 15);
check(fresh(), false, 'other');
check(fresh(), false, 'item', 'other');
for (const partition of [-1, 0.5, 16]) check({ ...fresh(), partition }, false, 'item', 'abc', partition);
check({ ...fresh(), partition: 1 }, false);
for (const length of [0, 9, 11]) check({ ...fresh(), counters: Array(length).fill(0) }, false);
for (const value of [-1, 0.5, 2147483648]) {
  check({ ...fresh(), revision: value }, false);
  check({ ...fresh(), root: { hash: 'hash', node: value } }, false);
}
check({ ...fresh(), root: { hash: '', node: 0 } }, false);
check({ ...fresh(), revision: 2147483647, root: { hash: 'hash', node: 2147483647 } }, true);
for (let index = 0; index < 10; index++) {
  for (const value of [-1, 0.5, 2147483648, 2147483647]) {
    const head = fresh(); head.counters[index] = value;
    check(head, value === 2147483647);
  }
}
check(fresh(), true); // An earlier rejection cannot leak local state.

const tc = acceptanceToolchain();
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-pf01-'));
let rejections = 0;
try {
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.mkdirSync(path.join(cwd, '.pulse'));
  fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
  for (const name of ['pulse', 'runtime']) {
    fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
  }
  for (const file of ['scalar.ts', 'partition.ts', 'types.ts']) {
    fs.copyFileSync(path.join(fixtures, file), path.join(cwd, 'src', file));
  }
  fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false},node:{host:'node',target:'native'}}));`);
  const cases = [
    { module: 'scalar', name: 'isPositive', setup: '', args: '1' },
    { module: 'partition', name: 'validPartition',
      setup: `const head = ${JSON.stringify(fresh())};`, args: "head, 'item', 'abc', 0" },
  ];
  for (const fixture of cases) {
    for (const site of ['binding', 'condition']) {
      const call = `${fixture.name}(${fixture.args})`;
      const body = site === 'binding'
        ? `const valid = ${call}; if (!valid) return ctx.text('invalid');`
        : `if (!${call}) return ctx.text('invalid');`;
      fs.writeFileSync(path.join(cwd, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';
import {${fixture.name}} from './${fixture.module}';
const app = new Pulse({auto:true});
app.get('/', async(ctx) => { ${fixture.setup} ${body} return ctx.text('valid'); });
export default app;`);
      if (fixture.module === 'scalar') {
        const compiled = tc.compileProject(tc.resolveProject({ cwd, profile: 'node' }));
        const plan = require('../../packages/compiler/src/canonical-native-plan').buildCanonicalNativePlan(compiled);
        assert.equal(plan.helpers.length, 1);
        continue;
      }
      assert.throws(() => tc.compileProject(tc.resolveProject({ cwd, profile: 'node' })), error => {
        assert.equal(error.code, expected.errorCode);
        assert.ok(error.diagnostics.some(d => d.code === expected.diagnosticCode), JSON.stringify(error.diagnostics));
        return true;
      }, `${fixture.module}/${site}: update to positive coverage only in ${fixture.module === 'scalar' ? expected.scalarImplementation : expected.recordImplementation}`);
      rejections++;
    }
  }
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: 'passed', nativeSupport: expected.status, scalarOracleCases: 5,
  recordOracleCases: oracleCases, expectedRecordRejections: rejections }));
