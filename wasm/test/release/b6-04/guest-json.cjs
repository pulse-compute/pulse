'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const guest = require('../../../packages/wasm-guest-link/src/index.js');
const { makeGuestUnitPlan } = require('../../../packages/wasm-guest-link/src/stage.js');
const { defineFinalWasmPolicy, FINAL_WASM_POLICY_VERSION } = require('../../../packages/contracts/src/provider/final-wasm-policy.js');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../../..');
const bytes = fs.readFileSync(path.join(root, 'packages/crypto/guests/es256-rustcrypto/pulse.guest-unit.json'));
const manifest = guest.normalizeGuestUnitManifest(JSON.parse(bytes));
const sorted = value => JSON.parse(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item));
assert.deepEqual(guest.normalizeGuestUnitManifest(sorted(manifest)), manifest);
const policy = defineFinalWasmPolicy({ version: FINAL_WASM_POLICY_VERSION,
  descriptorOwner: '@pulse-compute/provider-node', toolchainVersion: '1.0.0-beta.5',
  descriptorIdentity: 'pulse.node-native.json-roundtrip-proof.v1', permittedImports: [], requiredExports: [] });
const plan = makeGuestUnitPlan({}, { manifest, manifestSha256: createHash('sha256').update(bytes).digest('hex') },
  {profile:'native', finalWasmPolicy:policy, optimizationPosture:'native-default'}, Buffer.from('0061736d01000000', 'hex'));
assert.deepEqual(guest.normalizeGuestUnitPlan(sorted(plan)), guest.normalizeGuestUnitPlan(plan));
for (const [key, value] of [['lowerer','untrusted'], ['installedVersionMatches',false], ['catalogStatus','published']]) {
  const changed=sorted(plan);changed.trust[key]=value;
  assert.throws(()=>guest.normalizeGuestUnitPlan(changed),e=>e.code==='PULSE_GUEST_UNIT_OWNER_MISMATCH');
}
const changed=sorted(manifest);changed.exports.reverse();
assert.throws(()=>guest.normalizeGuestUnitManifest(changed),e=>e.code==='PULSE_GUEST_UNIT_EXPORT_MISMATCH');
console.log('ok - guest manifest/plan JSON roundtrip preserves values, trust checks and ordered arrays');
