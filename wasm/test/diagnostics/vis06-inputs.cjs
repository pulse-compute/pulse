'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setup } = require('../support/report-analytics-fixture.cjs');
const { sha256, canonicalJson } = require('../../packages/cli/src/internal/report/data');
const { stableReportId } = require('../../packages/cli/src/internal/report/capsule');
const { projectHandlerTopology, validateHandlerTopology } = require('../../packages/cli/src/internal/report/handler-topology');
const { compileProject } = require('../../packages/cli/src/project-execution');
const { resolveProject } = require('../../packages/cli/src/project-config');
const { buildCanonicalNativePlan, collectCanonicalReportReferences } = require('../../packages/compiler/src/canonical-native-plan');

function capture(directory, small = false) {
  setup(directory, 'full', true);
  if (small) fs.writeFileSync(path.join(directory, 'src/index.ts'), `import { Pulse } from '@pulse-compute/pulse';
const app = new Pulse({ auto: true });
app.get('/', async ctx => { const value = await ctx.config.get('REGION'); return ctx.text(value); });
export default app;
`);
  const project = resolveProject({ cwd: directory, metadataOnly: true });
  const compiled = compileProject(project), plan = buildCanonicalNativePlan(compiled);
  const observed = collectCanonicalReportReferences(compiled, plan), topology = observed.topology;
  // Fixture declarations are known config/secret bindings; resolution uses the
  // canonical compiler reference facts, never inferred names or file labels.
  const bindings = [], references = [];
  for (const ref of observed.references.filter(r => r.kind === 'binding' && r.state === 'resolved')) {
    const id = stableReportId('binding', `${ref.bindingKind}:${ref.canonicalId}`);
    bindings.push({ id, name: ref.canonicalId, kind: ref.bindingKind });
    references.push({ ...ref, id: 'reference:' + sha256(`${ref.bindingKind}:${ref.canonicalId}`), targetId: id });
  }
  const analytics = require('../support/report-legacy-analytics.cjs')(projectHandlerTopology(topology, references));
  const entries = analytics.registrations.map(r => ({ id: r.id, canonicalId: r.canonicalId,
    order: r.order, handlerId: r.handlerId, kind: r.kind === 'mount' ? 'other' : r.kind,
    name: r.match.value.eventType, flow: { nextEntryId: r.flow.next, childEntryId: r.flow.child,
      parentContinueEntryId: r.flow.parentContinue, routerPath: r.routerPath,
      path: r.match.value.path, method: r.match.value.method,
      scoped: r.kind === 'middleware' && r.control.value.pattern !== null } }));
  const result = { kind: 'pulse.vis06-compiler-fixture', analytics, entries, references, bindings,
    provenance: { host: project.provider, target: 'native', recipe: 'canonical planning; no Wasm emission',
      sources: ['src/index.ts', 'src/analytics.ts', '.pulse/config.ts'].map(file => ({ file,
        sha256: sha256(fs.readFileSync(path.join(directory, file))) })),
      compilerVersion: require('../../packages/compiler/package.json').version } };
  validateHandlerTopology(result);
  result.provenance.sourceSha256 = sha256(canonicalJson(result.provenance.sources));
  return result;
}
module.exports = { capture };
if (require.main === module) {
  const directory = path.resolve(process.argv[2]); fs.mkdirSync(directory, { recursive: true });
  for (const [name, small] of [['small', true], ['mixed', false]]) {
    const value = capture(path.join(directory, name), small);
    fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify(value));
    console.log(JSON.stringify({ name, registrations: value.analytics.registrations.length,
      useSites: value.analytics.useSites.length, associations: value.analytics.associations.length }));
  }
}
