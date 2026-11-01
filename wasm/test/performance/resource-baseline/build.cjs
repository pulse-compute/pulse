'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const { create } = require('../../../../packages/provider-fastly/src/build/lifecycle.js');
const { runtimeSource } = require('../../../../packages/provider-fastly/src/build/effect-invocations.js');
const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function source(width, observed = false) {
  assert.ok([1, 8, 16, 32].includes(width));
  const lifecycle = create({ effects: [], capabilities: [] }, {}, [
    { point: 'invocation.closed', owner: 'fixture.ownership', order: 0, body: 'cleanup();' },
    { point: 'effect.result', owner: 'fixture.ownership', order: 0, body: 'return !__pulse_invocation_closed;' }
  ]);
  const values = {
    __WIDTH__: String(width),
    __OBSERVER__: observed ? "@external('observer', 'note') declare function note(event: i32, slot: i32): void;" : 'function note(event: i32, slot: i32): void {}',
    __INVOCATIONS__: runtimeSource({ lifecycle }), __LIFECYCLE__: lifecycle.supportSource,
    __RESULT_GUARD__: lifecycle.site('effect-result')
  };
  lifecycle.assertSites();
  let text = fs.readFileSync(path.join(__dirname, 'ownership.as.ts'), 'utf8');
  for (const [key, value] of Object.entries(values)) { assert.equal(text.split(key).length, 2); text = text.replace(key, () => value); }
  return text;
}
function build(directory, width, observed = false, mutation = null) {
  fs.mkdirSync(directory, { recursive: true });
  const name = `ownership-${width}-${observed ? 'observed' : 'control'}${mutation ? '-' + mutation : ''}`;
  const mutations = {
    cleanup: ['\ncleanup();\n', '\n// omitted cleanup\n'],
    authentication: ['unchecked(generations[index]) != ticket || unchecked(__pulse_invocation_tickets[index]) != ticket', 'false'],
    primary: ['if (primary == 0) primary = stage;', 'primary = stage;']
  };
  let text = source(width, observed);
  if (mutation) {
    assert.ok(Object.hasOwn(mutations, mutation));
    const [before, after] = mutations[mutation];
    assert.equal(text.split(before).length, 2); text = text.replace(before, after);
  }
  const entry = path.join(directory, name + '.ts'), output = path.join(directory, name + '.wasm');
  fs.writeFileSync(entry, text);
  const asc = resolveAsc(path.join(root, 'wasm/packages/compiler'));
  const args = [asc.script, entry, '--outFile', output, '--runtime', 'stub', '--optimize', '--noAssert', '--use', `abort=${name}/abort`];
  const result = spawnSync(asc.executable, args, { cwd: directory, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const bytes = fs.readFileSync(output), module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  if (!mutation) assert.deepEqual(imports.filter(item => item.module === 'fixture').map(item => item.name).sort(), ['acquire', 'dispose', 'read', 'remaining']);
  assert.equal(imports.filter(item => item.module === 'observer').length, observed ? 1 : 0);
  assert.ok(imports.every(item => ['fixture', 'observer'].includes(item.module) && item.kind === 'function'));
  return { module, identity: { width, observed, mutation, sourceSha256: hash(text), wasmSha256: hash(bytes), wasmBytes: bytes.length, imports,
    recipe: ['--runtime', 'stub', '--optimize', '--noAssert'], metadataElementBytes: 24 * width } };
}
function profile(width, payload) {
  assert.ok([1, 8, 16, 32].includes(width)); assert.ok(Number.isInteger(payload) && payload > 0 && payload <= 65536);
  const { resourceAdmission } = require('../../../packages/contracts/src/provider/toolchain.js');
  const empty = () => ({ handles: [], allocations: [], records: 0, cleanupSteps: 0 });
  const zero = { handles: 0, backingBytes: 0, records: 0, cleanupSteps: 0, effects: 0 };
  return resourceAdmission.createPlan({ version: resourceAdmission.VERSION, realization: 'fixture.binary-reader-v1',
    selected: [Math.ceil(width / 2), Math.floor(width / 2)].map((count, namespace) => ({ count, site: 'read.' + namespace,
      profile: { version: resourceAdmission.PROFILE_VERSION, owner: 'fixture.reader', operation: 'binary.read', realization: 'fixture.binary-reader-v1', effects: 1,
        work: { handles: [{ namespace: 'fixture.reader.' + namespace, count: 1 }],
          allocations: [{ id: 'payload', kind: 'fixed', bytes: payload + 1, copies: 1 }], records: 0, cleanupSteps: 0 },
        cleanup: { ...empty(), cleanupSteps: 1 }, exclusions: [] }
    })).filter(item => item.count > 0), exit: empty(), occupied: zero,
    limits: { handles: width, backingBytes: width * (payload + 1), records: 2 * width, cleanupSteps: width, effects: width }
  });
}
module.exports = { root, hash, source, build, profile };
