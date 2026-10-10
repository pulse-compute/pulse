'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const f = require('./report-fixtures.cjs');
const { compareCapsules, validateComparison, parseComparison, serializeComparison } = require(path.join(f.reportRoot, 'comparison'));
const { canonicalJson, sha256 } = require(path.join(f.reportRoot, 'data'));
const { implementationId } = require(path.join(f.reportRoot, 'implementations'));
function minimal() { return f.fixture(false); }
function addRoute(c, name, pathname = '/' + name) {
  const handler = f.id('handler', name), entry = f.id('entry', name), route = f.id('route', name);
  c.entries.push({ id: entry, canonicalId: name, kind: 'route', order: c.entries.length, handlerId: handler, name,
    source: { file: 'src/routes.ts', line: c.entries.length + 1, column: 1 }, schemaIds: [], bindingIds: [], declarationIds: [], evidenceIds: [f.buildId] });
  c.routes.push({ id: route, canonicalId: name, order: c.routes.length, method: 'GET', path: pathname, handlerId: handler,
    handlerName: name, entryId: entry, source: null, composition: [entry], schemaIds: [], bindingIds: [], declarationIds: [], evidenceIds: [f.buildId] });
  for (const key of ['routes', 'entries']) c.coverage[key] = f.coverage(c[key].length);
  return c;
}
const compare = (a, b) => compareCapsules(f.createCapsule(a), f.createCapsule(b));
const inventory = (result, name) => result.summary.inventories.find(row => row.collection === name);
const section = (result, name) => result.sections.find(row => row.collection === name)?.changes || [];
function replaceStrings(input, transform) {
  if (typeof input === 'string') return transform(input);
  if (Array.isArray(input)) return input.map(row => replaceStrings(row, transform));
  if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, row]) => [key, replaceStrings(row, transform)]));
  return input;
}
function artifactChange(c, hash = 'a'.repeat(64)) {
  const changed = replaceStrings(c, text => text.replaceAll(f.hash, hash));
  for (const row of changed.implementations || []) row.id = implementationId(row.artifactId, row.origin, row.canonicalId, row.chunks[0].chunk);
  return changed;
}
function rehash(result) {
  const { comparisonHash, ...payload } = result;
  result.comparisonHash.value = sha256(canonicalJson(payload)); return result;
}
module.exports = function comparisonCases() {
  let checks = 0;
  function check(condition, message) { checks++; assert.ok(condition, message); }
  const a = addRoute(addRoute(minimal(), 'a'), 'b'), same = compare(a, a);
  check(!same.sections.length && !same.metadataChanges.length, 'identical inputs have no detail');
  check(inventory(same, 'routes').delta === 0 && inventory(same, 'schemas').delta === 0, 'zero counts remain visible');
  check(same.compatibility.status === 'unknown', 'old build settings are not invented');
  check(same.sources.before.capsuleHash === f.createCapsule(a).evidenceHash.value, 'source identity retained');
  check(Object.isFrozen(same.sources.before.provenance), 'deep immutable result');
  assert.equal(serializeComparison(parseComparison(serializeComparison(same))), serializeComparison(same));
  const stable = artifactChange(a);
  check(!compare(a, stable).sections.length, 'artifact identity and body-index domains do not create entity changes');

  let b = addRoute(structuredClone(a), 'new');
  // Insert ahead, churn all existing compiler-generated IDs, and retain logical slots.
  b.routes.unshift(b.routes.pop()); b.entries.unshift(b.entries.pop());
  for (const key of ['routes', 'entries']) b[key].forEach((row, index) => { row.order = index; });
  const replacements = new Map();
  for (const key of ['routes', 'entries']) for (const row of b[key]) replacements.set(row.id, f.id(key === 'routes' ? 'route' : 'entry', 'churn:' + row.canonicalId));
  b = replaceStrings(b, text => replacements.get(text) || text);
  for (const key of ['routes', 'entries']) for (const row of b[key]) row.canonicalId = 'churn:' + row.canonicalId;
  let result = compare(a, b);
  check(inventory(result, 'routes').counts.added === 1 && inventory(result, 'routes').counts.unchanged === 2, 'insertion does not modify every following route');
  check(inventory(result, 'entries').counts.added === 1 && inventory(result, 'entries').counts.unchanged === 2, 'entry IDs follow matched route slots');
  check(section(result, 'routes').length === 1 && section(result, 'routes')[0].status === 'added', 'sparse detail omits unchanged rows');
  const ordered = structuredClone(a); ordered.routes.reverse(); ordered.entries.reverse();
  for (const key of ['routes', 'entries']) ordered[key].forEach((row, index) => { row.order = index; });
  check(inventory(compare(a, ordered), 'routes').counts.modified === 2, 'relative reorder of retained registrations is visible');
  const moved = structuredClone(a); moved.entries[0].source.line += 20;
  result = compare(a, moved);
  check(section(result, 'entries')[0].fields[0].path === '/source/line', 'moved location is a changed field, not remove/add');

  const replacement = addRoute(addRoute(minimal(), 'a'), 'c');
  result = compare(a, replacement);
  check(inventory(result, 'routes').delta === 0 && inventory(result, 'routes').counts.added === 1 && inventory(result, 'routes').counts.removed === 1, 'zero net count preserves replacement churn');
  const duplicate = addRoute(addRoute(minimal(), 'one', '/same'), 'two', '/same');
  const duplicateEdit = artifactChange(replaceStrings(duplicate, text => text === 'one' || text === 'two' ? 'changed-' + text : text));
  result = compare(duplicate, duplicateEdit);
  check(section(result, 'routes')[0].status === 'unresolved' && section(result, 'routes')[0].reason === 'ambiguous-identity', 'duplicate method/path does not join by ordinal or display name');
  check(!inventory(result, 'routes').counts.added && !inventory(result, 'routes').counts.removed, 'ambiguity is not counted as churn');
  const exactDuplicate = compare(duplicate, artifactChange(duplicate));
  check(inventory(exactDuplicate, 'routes').counts.unchanged === 2, 'unique exact canonical identities can disambiguate duplicate paths');
  const repeatedCanonical = structuredClone(duplicate); repeatedCanonical.routes.forEach(row => { row.canonicalId = 'same'; });
  check(inventory(compare(repeatedCanonical, artifactChange(repeatedCanonical)), 'routes').counts.unresolvedBefore === 2, 'duplicate canonical IDs preserve every row');

  const lost = minimal(); lost.coverage.routes = { status: 'unavailable', observed: 0, expected: null, reason: 'not-recorded' };
  result = compare(a, lost);
  check(inventory(result, 'routes').delta === null && inventory(result, 'routes').counts.removed === 0, 'missing inventory is not zero or deletion');
  check(inventory(result, 'routes').counts.unresolvedBefore === 2, 'missing inventory retains all unmatched evidence pointers');
  const gain = compare(lost, a);
  check(inventory(gain, 'routes').counts.added === 0 && inventory(gain, 'routes').counts.unresolvedAfter === 2, 'coverage gain is not proof of additions');

  const rich = f.fixture(), missing = structuredClone(rich);
  const measurement = missing.measurements.find(row => row.metric === 'handler-body');
  measurement.fact = f.unavailable('unsupported-mapping'); measurement.bodyIds = []; measurement.mappedChunks = 0;
  result = compare(rich, missing);
  const gap = section(result, 'routes')[0];
  check(gap.status === 'coverage-changed', 'lost attribution is a coverage change');
  check(gap.fields[0].delta === null && gap.fields[0].deltaReason === 'missing-evidence', 'no fake size saving');
  const partial = structuredClone(rich); partial.measurements[0].fact.coverage = 'partial';
  result = compare(rich, partial);
  check(section(result, 'routes')[0].fields[0].deltaReason === 'non-exact-evidence', 'partial bounds are not exact deltas');
  const contradictory = structuredClone(rich), duplicateMeasurement = structuredClone(contradictory.measurements[0]);
  duplicateMeasurement.id = f.id('measurement', 'conflicting'); duplicateMeasurement.fact = f.unavailable('unsupported-mapping');
  duplicateMeasurement.bodyIds = []; duplicateMeasurement.mappedChunks = 0; contradictory.measurements.push(duplicateMeasurement);
  result = compare(rich, contradictory);
  check(section(result, 'routes')[0].status === 'coverage-changed', 'conflicting measurements do not select the first convenient value');
  const schemaChange = structuredClone(rich); schemaChange.schemas[0].source.line++;
  result = compare(rich, schemaChange);
  check(section(result, 'schemas').length === 1 && section(result, 'schemas')[0].fields.length === 1, 'unchanged schema fields are omitted');

  const foreign = structuredClone(rich); foreign.context.host = 'fastly'; foreign.artifacts.forEach(row => { row.host = 'fastly'; row.target = 'fastly-native'; });
  result = compare(rich, foreign);
  check(result.compatibility.status === 'incompatible' && result.summary.artifactBytes.delta === null, 'cross-host bytes are not a comparable delta');
  const bounded = require('./report-build-cases.cjs').fixture(), settings = structuredClone(bounded);
  result = compare(bounded, settings);
  check(result.compatibility.status === 'compatible', 'complete identical build settings qualify');
  settings.build.compilers[0].optimization.converge = true; settings.build.compilers[0].flags.push({ name: '--converge', value: null });
  result = compare(bounded, settings);
  check(result.compatibility.status === 'different-build' && result.metadataChanges.some(row => row.path.includes('/settings/')), 'effective setting changes remain prominent without invalidating physical size arithmetic');
  const timed = structuredClone(bounded); timed.build.totalDurationMs++; timed.build.stages[0].durationMs++;
  result = compare(bounded, timed);
  check(result.compatibility.status === 'compatible' && !result.sections.length && result.metadataChanges.length > 0, 'build timing changes are metadata, not application modifications');
  const reorderedTools = structuredClone(bounded); reorderedTools.build.compilers[0].toolchain.reverse();
  check(!compare(bounded, reorderedTools).metadataChanges.length, 'toolchain array order is not a setting change');

  const helpers = structuredClone(require('./report-helper-viewer-cases.cjs').helperFixture()), helperPeer = artifactChange(helpers);
  result = compare(helpers, helperPeer);
  check(section(result, 'implementations').every(row => row.status === 'unresolved' || row.basis !== 'same-artifact'), 'function/chunk indices never establish cross-artifact identity');
  check(inventory(result, 'implementations').counts.unchanged > 0, 'named helpers survive artifact hash churn');
  const withoutHelpers = structuredClone(helpers); delete withoutHelpers.implementations; delete withoutHelpers.coverage.implementations;
  check(!inventory(compare(helpers, withoutHelpers), 'implementations').counts.removed, 'old helper telemetry does not imply deletion');
  const renamed = structuredClone(helpers); const row = renamed.implementations.find(row => row.origin === 'authored-helper');
  row.canonicalId += ':different'; row.id = implementationId(row.artifactId, row.origin, row.canonicalId, row.chunks[0].chunk);
  result = compare(helpers, renamed);
  check(!inventory(result, 'implementations').counts.removed && !inventory(result, 'implementations').counts.added, 'partial implementation inventory cannot establish addition/removal');

  const tested = structuredClone(a);
  tested.evidence.push({ ...tested.evidence[0], id: f.id('evidence', 'test-run'), kind: 'test', result: 'passed',
    method: 'test-fixture', scope: { corpus: 'unit', cases: ['one'], targets: ['native'] } });
  const failed = artifactChange(tested); failed.evidence.find(row => row.kind === 'test').result = 'failed';
  check(section(compare(tested, failed), 'evidence')[0].fields.some(row => row.path === '/result' && row.after.value === 'failed'), 'matched test results survive artifact churn and expose failure');
  const smaller = artifactChange(rich); smaller.bodies[0].bytes--;
  for (const measurement of smaller.measurements) if (measurement.bodyIds.includes(smaller.bodies[0].id)) measurement.fact.value--;
  result = compare(rich, smaller);
  check(section(result, 'routes').flatMap(row => row.fields).some(row => row.delta === -1), 'exact matching measurement deltas are directional bytes');
  check(section(result, 'routes').flatMap(row => row.fields).some(row => row.deltaReason === 'non-exact-evidence'), 'reachable bound changes remain qualified');
  const foreignSmaller = structuredClone(smaller); foreignSmaller.context.host = 'fastly'; foreignSmaller.artifacts.forEach(row => { row.host = 'fastly'; });
  check(section(compare(rich, foreignSmaller), 'routes').flatMap(row => row.fields).every(row => row.delta === null), 'incompatible targets suppress per-row deltas too');
  const reversed = compare(replacement, a), forward = compare(a, replacement);
  check(inventory(reversed, 'routes').counts.added === inventory(forward, 'routes').counts.removed, 'direction is explicit');
  check(serializeComparison(compare(a, replacement)) === serializeComparison(forward), 'deterministic result and hash');
  for (const mutate of [
    x => { x.summary.inventories[0].counts.added++; },
    x => { x.summary.artifactBytes.delta++; },
    x => { x.compatibility.status = 'compatible'; },
    x => { x.sections[0].changes[0].fields = []; },
    x => { x.sources.before.context.primaryArtifactId = 'wrong'; }
  ]) { const invalid = structuredClone(forward); mutate(invalid); assert.throws(() => validateComparison(rehash(invalid))); checks++; }
  const tampered = structuredClone(forward); tampered.sources.before.application.name = 'different';
  assert.throws(() => validateComparison(tampered), { code: 'REPORT_COMPARISON_HASH' }); checks++;
  assert.throws(() => parseComparison('{"kind":"x","kind":"y"}'), { code: 'REPORT_DUPLICATE_KEY' }); checks++;
  assert.throws(() => compareCapsules({ ...f.createCapsule(a), reportVersion: 2 }, f.createCapsule(a)), { code: 'REPORT_VERSION' }); checks++;
  const malformed = { ...f.createCapsule(a), application: { name: 'tampered' } };
  assert.throws(() => compareCapsules(malformed, f.createCapsule(a)), { code: 'REPORT_HASH' }); checks++;
  const script = `const M=require('node:module'),load=M._load;M._load=function(name,...args){if(/project-execution|retained$|compiler|provider-|viewer|child_process|^(node:)?(fs|http|https|net)$/.test(name))throw Error('Unexpected work: '+name);return load.call(this,name,...args)};const f=require(${JSON.stringify(path.join(__dirname, 'report-fixtures.cjs'))});const c=require(${JSON.stringify(path.join(f.reportRoot, 'comparison'))});process.stdout.write(c.serializeComparison(c.compareCapsules(f.createCapsule(f.fixture()),f.createCapsule(f.fixture()))));`;
  const output = execFileSync(process.execPath, ['-e', script], { cwd: '/', encoding: 'utf8', env: { ...process.env, LANG: 'tr_TR.UTF-8', TZ: 'Pacific/Auckland' } });
  check(output === serializeComparison(compare(f.fixture(), f.fixture())), 'no IO/toolchain imports and locale-independent bytes');
  console.log(JSON.stringify({ comparison: 'passed', checks, version: 1, deterministic: true, missingIsNotZero: true }));
};
if (require.main === module) module.exports();
