#!/usr/bin/env node
'use strict';

// Evidence-only inventory for the HTML execution-graph spike.
// Input is an existing canonical capsule. This never builds or executes an app.
const fs = require('node:fs');
const { parseCapsule } = require('../../wasm/packages/cli/src/internal/report/capsule');

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = String(key(row));
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

function audit(capsule) {
  const a = capsule.analytics;
  const base = {
    kind: 'pulse.report-graph-spike-audit',
    version: 1,
    application: capsule.application.name,
    capsuleHash: capsule.evidenceHash.value,
    artifactId: capsule.context.primaryArtifactId,
    recipe: capsule.provenance.recipe,
    routes: capsule.routes.length,
    entries: capsule.entries.length,
    schemas: capsule.schemas.length,
    bindings: capsule.bindings.length,
    analytics: a ? 'recorded' : 'not-recorded',
  };
  if (!a) return base;
  const registrationCounts = new Map();
  for (const r of a.registrations) if (r.handlerId !== null) {
    registrationCounts.set(r.handlerId, (registrationCounts.get(r.handlerId) || 0) + 1);
  }
  const flowLinks = {};
  for (const kind of ['next', 'child', 'parentContinue']) {
    flowLinks[kind] = a.registrations.filter(r => r.flow[kind] !== null).length;
  }
  return {
    ...base,
    coverage: a.coverage,
    definitionKinds: countBy(a.handlers, r => r.kind),
    registrationKinds: countBy(a.registrations, r => r.kind),
    definitionSourceStates: countBy(a.handlers, r => r.source.state),
    controlStates: countBy(a.registrations, r => r.control?.state || 'not-recorded'),
    flowLinks,
    maxMountDepth: Math.max(0, ...a.registrations.map(r => r.mountPath.length)),
    reusedDefinitions: [...registrationCounts.values()].filter(n => n > 1).length,
    useSites: a.useSites.length,
    bindingResolutionStates: countBy(a.useSites, r => r.binding.state),
    helperCalls: a.helperCalls.length,
    associations: a.associations.length,
    associationLanes: countBy(a.associations, r => r.lane),
    conditionality: countBy(a.associations, r => r.conditional === null ? 'unknown' : r.conditional),
    maxExplanationHops: Math.max(0, ...a.associations.map(r => r.via.length)),
    note: 'Counts describe retained static evidence. Links and associations are not runtime traces or invocation counts.',
  };
}

if (require.main === module) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: node scripts/spikes/report-graph-audit.cjs <capsule.json>\n');
    process.exitCode = 2;
  } else {
    const capsule = parseCapsule(fs.readFileSync(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify(audit(capsule), null, 2) + '\n');
  }
}

module.exports = { audit };
