'use strict';
// A versioned private sidecar. Production report readers never ingest this format.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const {validate, STATES, ROOT_STATES, VERSION} = require('./schema.cjs');
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const vector = ([handles, backingBytes, records]) => ({handles, backingBytes, records});
const WORK = vector([3,262785,6]), CLEANUP = vector([2,64,2]), EXIT = vector([2,64,2]);
const id = effect => 'binding-' + hash(effect.id).slice(0,16);
function staticEvidence(artifact) {
  const plan = artifact.plan, effects = plan.effects;
  const rootIndexes = effects.map((e,i) => e.composition ? -1 : i).filter(i => i >= 0);
  const sources = {cache: '../ra06/service.as.ts', fetch: '../ra05/adapter.as.ts', composition: '../ra07/service.as.ts'};
  const implementations = Object.fromEntries(Object.entries(sources).map(([name,file]) => [name,hash(fs.readFileSync(path.join(__dirname,file)))]));
  const bindings = effects.map((e,index) => {
    const phase = e.composition?.phase ?? (e.kind === 'fetch' ? 'core' : 'parent');
    const root = e.composition?.parent ?? index;
    const capability = e.kind === 'fetch' ? 'fetch.text' : e.operation === 'getOrSetText' ? 'cache.compose' : e.operation === 'getText' ? 'cache.read' : 'cache.write';
    const implementation = implementations[phase === 'parent' ? 'composition' : e.kind === 'fetch' ? 'fetch' : 'cache'];
    return {id:id(e), useSite:hash(e.id), capability, service:e.kind === 'fetch' ? 'core.fetch' : 'investigation-bounded-composition.v0', implementation,
      root:id(effects[root]), parent:e.composition ? id(effects[root]) : null, phase,
      resources:capability==='cache.compose'?[]:capability==='cache.read'?['cache-entry','body-reader','backing']:capability==='cache.write'?['body-writer','backing']:['request','request-body','pending-fetch','response','response-body','backing'],
      actions:capability==='cache.compose'?['compose']:capability==='cache.read'?['lookup','read','close']:capability==='cache.write'?['insert','write','commit','abandon']:['allocate','transfer','consume','read','close'],
      conditional:['loader','insert'].includes(phase), accounting:e.composition ? 'included-in-root' : 'root-envelope',
      demand:e.composition ? vector(phase === 'lookup' ? [2,257,3] : phase === 'loader' ? [3,262336,4] : [1,192,2]) : {...WORK}};
  });
  return {bindings, rootIds:rootIndexes.map(i => id(effects[i])), profile:{work:{...WORK}, cleanup:{...CLEANUP}, exit:{...EXIT}, effectsPerRoot:4},
    graph:'experimental-expanded', canonicalChildGraph:false};
}
function project(artifact, result = null) {
  const stat = staticEvidence(artifact), raw = result?.diagnostics;
  const report = {version:VERSION, target:'fastly-native-injected-host', artifact:{sha256:hash(artifact.wasm), execution:hash(artifact.control.wasm), canonicalPlan:hash(artifact.canonicalPlan), expandedPlan:hash(artifact.plan), profile:hash(stat.profile)}, static:stat, runtime:null};
  if (raw) {
    const [total,kept,sampledOut,dropped,saturated,capacity,sampleEvery,, ,admitted,closed,containment,lost,storageBytes] = raw.meta;
    const rootId = i => stat.rootIds[i], siteId = i => stat.bindings[i]?.id ?? null;
    const complete = Boolean(closed && !result.thrown && !containment && !lost && !saturated);
    const records = raw.records.map(([state,root,record,handles,bytes,count,site]) => ({id:record,root:rootId(root),binding:siteId(site),state:STATES[state],kind:bytes > 0 ? 'backing' : 'host-claim',charge:vector([handles,bytes,count])}));
    report.runtime = {scope:crypto.randomBytes(16).toString('hex'), termination:result.thrown ? 'trapped' : closed ? 'closed' : 'incomplete',
      coverage:{aggregates:complete ? 'complete' : 'partial', records:closed && !result.thrown && !containment && !lost ? 'complete' : 'partial',
        samples:complete && !sampledOut && !dropped ? 'complete' : 'partial', saturated:Boolean(saturated),containment:Boolean(containment),lost:Boolean(lost)},
      collection:{total,kept,sampledOut,dropped,capacity,sampleEvery,storageBytes},
      admission:{status:admitted ? 'admitted' : 'rejected', bindings:[...stat.rootIds], dimensions:raw.admission.map(([requested,limit],i) => ({name:['handles','backingBytes','records','effects'][i],requested,limit,shortfall:Math.max(0,requested-limit)}))},
      totals:{charged:vector(raw.charged), committed:vector(raw.committed), retainedBackingBytes:records.reduce((n,r) => n+r.charge.backingBytes,0),
        uncertainHostClaims:records.filter(r => r.kind === 'host-claim' && r.state === 'uncertain-or-fenced').reduce((n,r) => n+r.charge.handles,0),
        retired:{released:raw.transitions[3*8],consumed:raw.transitions[5*8],transferred:raw.transitions[6*8]}},
      roots:raw.roots.map(([state,h,b,r,promised,children],i) => ({binding:rootId(i),logicalState:ROOT_STATES[state],charge:vector([h,b,r]),promisedChildren:promised,pendingChildren:children})),
      records, transitions:raw.transitions.map((count,i) => ({from:STATES[Math.floor(i/8)],to:STATES[i%8],count})).filter(r => r.count),
      samples:raw.samples.map(([sequence,root,record,from,to,afterClosure,site]) => ({sequence,root:rootId(root),binding:siteId(site),record,from:STATES[from],to:STATES[to],afterClosure:Boolean(afterClosure)}))};
  }
  validate(report); return report;
}
function compare(before, after) {
  validate(before); validate(after);
  const samePlan = before.artifact.expandedPlan === after.artifact.expandedPlan;
  const sameExecution = before.artifact.execution === after.artifact.execution;
  const sameProfile = before.artifact.profile === after.artifact.profile;
  const sameBindings = canonical(before.static) === canonical(after.static);
  const available = samePlan && sameExecution && sameProfile && sameBindings && before.runtime?.coverage.aggregates === 'complete' && after.runtime?.coverage.aggregates === 'complete';
  return {version:'hex.ra08.resource-compare.v1', static:{samePlan,sameExecution,sameProfile,sameBindings,bindingsBefore:before.static.bindings.length,bindingsAfter:after.static.bindings.length,
      identityCoverage:samePlan ? 'exact' : 'unavailable'},
    runtime:{status:available ? 'available' : 'unavailable',reason:available ? null : !before.runtime || !after.runtime ? 'missing-observation' : !samePlan || !sameExecution || !sameProfile || !sameBindings ? 'incompatible-static-evidence' : 'incomplete-observation',
      chargedDelta:available ? vector(['handles','backingBytes','records'].map(k => after.runtime.totals.charged[k]-before.runtime.totals.charged[k])) : null,
      claimIdentity:'execution-scoped-not-compared', hostReclamation:'not-established'}};
}
module.exports = {project, compare, staticEvidence, canonical, hash};
