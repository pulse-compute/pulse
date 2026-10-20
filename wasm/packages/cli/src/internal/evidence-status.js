'use strict';

// Presentation only. Admission, hashing and freshness remain report-owner work.
// Never inspect Git, infer source identity, or turn command success into proof.
const { validateCapsule } = require('./report/capsule');
const unknownCoverage = () => ({ status: 'unavailable', observed: null, expected: null, reason: 'not-recorded' });
const identityField = value => ({ state: value === null ? 'unknown' : 'available', value });

function reportEvidence(collected) {
  const c = validateCapsule(collected.capsule);
  const historical = collected.kind === 'historical-capsule';
  if (!historical && collected.kind !== 'completed-wasm') throw new TypeError('Expected admitted report evidence');
  const primary = c.artifacts.find(row => row.id === c.context.primaryArtifactId);
  const inventory = Object.fromEntries(['routes', 'entries', 'schemas', 'bindings', 'resources', 'references', 'implementations']
    .map(name => [name, c.coverage[name] || unknownCoverage()]));
  const analytics = Object.fromEntries(['handlers', 'registrations', 'useSites', 'helperCalls']
    .map(name => [name, c.analytics?.coverage[name] || unknownCoverage()]));
  const measurements = { recorded: c.measurements.length, available: 0, exact: 0, bounded: 0, partial: 0, unavailable: 0, notApplicable: 0 };
  for (const { fact } of c.measurements) {
    if (fact.state === 'available') { measurements.available++; measurements[fact.coverage]++; }
    else if (fact.state === 'unavailable') measurements.unavailable++;
    else measurements.notApplicable++;
  }
  return {
    state: historical ? 'historical-capsule' : 'verified-completed-artifact',
    integrity: 'validated',
    artifactBytes: historical ? 'not-checked' : 'verified',
    snapshot: historical ? 'historical' : collected.currentSnapshotMatched === true ? 'current-inputs-matched' : 'current-project-unchecked',
    identity: { evidenceHash: c.evidenceHash, buildEvidenceId: c.provenance.buildEvidenceId,
      primaryArtifact: { id: primary.id, sha256: primary.sha256, bytes: primary.bytes, stage: primary.stage },
      artifactCount: c.artifacts.length, context: c.context },
    source: Object.fromEntries(['revision', 'dirty', 'sourceFingerprint'].map(name => [name, identityField(c.provenance[name])])),
    coverage: { inventory, analytics, measurements, missingOptionalSidecars: collected.missingOptionalSidecars },
    qualification: 'not-established-by-this-projection'
  };
}

function uncollectedEvidence(code) {
  const states = { PULSE_REPORT_EVIDENCE_MISSING: 'missing', PULSE_REPORT_INPUT_INVALID: 'invalid',
    PULSE_REPORT_STALE: 'stale', PULSE_REPORT_INCOMPATIBLE: 'incompatible' };
  const state = Object.hasOwn(states, code) ? states[code] : 'not-collected';
  return { state, integrity: 'not-established', artifactBytes: 'not-checked', snapshot: 'not-checked',
    identity: null, source: { revision: identityField(null), dirty: identityField(null), sourceFingerprint: identityField(null) },
    coverage: null, qualification: 'not-established-by-this-projection' };
}

function evidencePresentation({ command, cliVersion, outcome, exitCode, result, collected, diagnostic }) {
  return { kind: 'pulse.command-evidence', presentationVersion: 1, command, cliVersion, outcome, exitCode,
    evidence: collected ? reportEvidence(collected) : uncollectedEvidence(diagnostic?.code), result };
}

module.exports = { evidencePresentation, reportEvidence };
