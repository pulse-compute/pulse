'use strict';
const { isDeepStrictEqual } = require('node:util');

// Human release direction, 2026-10-04: the documented/reported Viceroy
// missing-key CAS discrepancy is non-blocking. Keep the raw semantic failure;
// recognize only the exact observation on versions with retained evidence.
const KNOWN_VICEROY_VERSIONS = new Set(['0.21.0', '0.21.1']);
const KNOWN_FAILURE = {
  check: 'missing-key-cas',
  expected: { acknowledgement: 'conflict', subsequentRead: 'not-found' },
  actual: { acknowledgement: 'stored', subsequentRead: 'found' },
};

function localAcceptance(evidence) {
  const results = evidence?.results;
  const compute = results?.['fastly-compute'];
  const validInstall = evidence?.providerReality === true
    && evidence.installedBytesUnchanged === true && evidence.workspaceProductModules === 0
    && evidence.publicTypes === 'passed' && evidence.packageCount === 19;
  const nodePassed = results?.['node-native']?.status === 'passed'
    && results?.['node-javascript']?.status === 'passed'
    && isDeepStrictEqual(results['node-native'].failures, [])
    && isDeepStrictEqual(results['node-javascript'].failures, [])
    && results['node-native'].ambiguousCompletion === 'passed'
    && results['node-javascript'].ambiguousCompletion === 'passed';
  const knownTargets = isDeepStrictEqual(Object.keys(results || {}).sort(),
    ['fastly-compute', 'node-javascript', 'node-native']);
  const base = { semanticStatus: evidence?.status || 'unavailable',
    deployedPulseCrossLocationStillRequired: true };
  if (validInstall && nodePassed && knownTargets && evidence.status === 'passed'
    && compute?.status === 'passed' && isDeepStrictEqual(compute.failures, [])) {
    return { ...base, status: 'passed', releaseBlocking: false, knownIssues: [] };
  }
  const viceroy = compute?.toolchain?.viceroy;
  if (validInstall && nodePassed && knownTargets && evidence.status === 'failed'
    && compute?.status === 'failed' && compute.lostResponse?.status === 'passed'
    && compute.lostResponse.dispatchedRequests === 1 && compute.lostResponse.typedKvUnknown === false
    && KNOWN_VICEROY_VERSIONS.has(viceroy?.version)
    && /^[a-f0-9]{64}$/.test(viceroy.sha256 || '')
    && isDeepStrictEqual(compute.failures, [KNOWN_FAILURE])) {
    return { ...base, status: 'accepted-with-known-viceroy-discrepancy', releaseBlocking: false,
      knownIssues: [{ check: KNOWN_FAILURE.check, engine: 'Viceroy', version: viceroy.version,
        disposition: 'non-blocking by explicit human release direction on 2026-10-04',
        evidence: 'wasm/test/kv/k4/viceroy-0.21.1-beta6-evidence.json' }] };
  }
  return { ...base, status: 'failed', releaseBlocking: true, knownIssues: [] };
}
module.exports = { localAcceptance };
