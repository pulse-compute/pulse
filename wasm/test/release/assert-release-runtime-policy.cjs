#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PUBLICATION, versionSatisfiesCaretRange } = require('../../../scripts/package-support.cjs');
const { assertReleaseNode, fastlyAvailability } = require('../../../scripts/validate-release.cjs');

assert.equal(PUBLICATION.nodeEngines, '^22.14.0 || ^24.0.0');
assert.equal(PUBLICATION.nodeMinimumVersion, '22.14.0');
assert.equal(PUBLICATION.nodeReleaseRange, '^24.0.0');
assert.equal(PUBLICATION.nodeVersion, '24.18.0');

assert.equal(versionSatisfiesCaretRange('24.0.0', PUBLICATION.nodeReleaseRange), true);
assert.equal(versionSatisfiesCaretRange('24.14.0', PUBLICATION.nodeReleaseRange), true);
assert.equal(versionSatisfiesCaretRange('24.18.0', PUBLICATION.nodeReleaseRange), true);
assert.equal(versionSatisfiesCaretRange('22.14.0', PUBLICATION.nodeReleaseRange), false);
assert.equal(versionSatisfiesCaretRange('25.0.0', PUBLICATION.nodeReleaseRange), false);

assert.deepEqual(assertReleaseNode('24.14.0'), {
  nodeVersion: '24.14.0',
  acceptedRange: '^24.0.0',
  reproducibleToolchainVersion: '24.18.0'
});
assert.throws(
  () => assertReleaseNode('22.14.0'),
  (error) => error.code === 'PULSE_RELEASE_NODE_RANGE_MISMATCH' && /requires Node \^24\.0\.0/.test(error.message)
);

const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-runtime-policy-'));
const fastlyBinary = path.join(taskRoot, process.platform === 'win32' ? 'fastly.exe' : 'fastly');
fs.writeFileSync(fastlyBinary, `#!${process.execPath}
'use strict';
if (process.argv.includes('version') || process.argv.includes('--version')) {
  process.stdout.write('Fastly CLI version v99.7.3\\n');
  process.exit(0);
}
process.exit(64);
`);
fs.chmodSync(fastlyBinary, 0o755);

const delimiter = process.platform === 'win32' ? ';' : ':';
const availability = fastlyAvailability({
  PATH: `${taskRoot}${delimiter}${path.dirname(process.execPath)}`,
  PULSE_FASTLY_BIN: fastlyBinary
});
assert.deepEqual(availability, {
  status: 'available',
  fastlyCli: {
    binary: fastlyBinary,
    version: '99.7.3'
  },
  localComputeEngine: {
    owner: 'fastly-cli',
    selection: 'managed'
  }
});
assert.equal(Object.hasOwn(availability, 'viceroy'), false);

console.log('ok - release seals accept the Node 24 line while preserving the exact reproducible toolchain pin and require only Fastly CLI-owned local execution');
