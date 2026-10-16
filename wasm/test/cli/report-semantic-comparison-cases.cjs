'use strict';
const assert=require('node:assert/strict');
const f=require('./report-fixtures.cjs');
const {fixture}=require('./report-handler-viewer-cases.cjs');
const {compareCapsules,validateComparison,parseComparison,serializeComparison}=require('../../packages/cli/src/internal/report/comparison');
const {deriveHandlerAssociations}=require('../../packages/cli/src/internal/report/handler-associations');
const {projectHandlerTopology}=require('../../packages/cli/src/internal/report/handler-topology');
const {canonicalJson,sha256}=require('../../packages/cli/src/internal/report/data');
const {SEMANTIC_COLLECTIONS,COLLECTIONS}=require('../../packages/cli/src/internal/report/comparison-schema');
const {renderComparison}=require('../../packages/cli/src/internal/report/comparison-viewer');
const inventory=(result,name)=>result.summary.inventories.find(row=>row.collection===name);
const changes=(result,name)=>result.sections.find(row=>row.collection===name)?.changes||[];
const compare=(a,b)=>compareCapsules(f.createCapsule(a),f.createCapsule(b));
function derive(c) {
  const result=deriveHandlerAssociations(c.analytics);c.analytics.associations=result.rows;c.analytics.coverage.associations=result.coverage;return c;
}
function rehash(c) {const {comparisonHash,...payload}=c;c.comparisonHash.value=sha256(canonicalJson(payload));return c;}
module.exports=function semanticCases() {
  const base=fixture(), bounded=fixture('http','experimental-native-bounded-size');
  const before=serializeComparison(compare(base,base)), same=compare(base,base);
  assert.equal(same.matchingVersion,'pulse.report-matching.v2');
  assert.deepEqual(same.sections,[]);
  for(const name of SEMANTIC_COLLECTIONS) {
    const row=inventory(same,name);assert.equal(row.counts.unchanged,base.analytics[name].length);
    assert.equal(row.identityCoverage.before.status,'complete');assert.equal(row.identityCoverage.after.observed,base.analytics[name].length);
  }
  const recipe=compare(base,bounded);
  assert.deepEqual(base.analytics,bounded.analytics);
  assert.notEqual(base.artifacts[0].sha256,bounded.artifacts[0].sha256,'real recipe changes physical artifact');
  assert.equal(recipe.compatibility.status,'different-build');
  for(const name of SEMANTIC_COLLECTIONS)assert.deepEqual(inventory(recipe,name),inventory(same,name),'recipe is independent of '+name);
  assert.ok(!recipe.sections.some(row=>SEMANTIC_COLLECTIONS.includes(row.collection)));
  const edited=fixture('http','default',source=>source.replace("ctx.config.get('REGION')","ctx.config.get('SCOPED')"));
  const changed=compare(base,edited);
  const legacySides=[base,edited].map(c=>{const copy=structuredClone(c);delete copy.analytics;return copy;});
  const legacyResult=compare(...legacySides);
  for(const name of COLLECTIONS) {
    assert.deepEqual(inventory(changed,name),inventory(legacyResult,name),'semantic registration IDs cannot overwrite legacy entry joins');
    assert.deepEqual(changes(changed,name),changes(legacyResult,name));
  }
  assert.ok(changes(changed,'useSites').some(row=>row.fields.some(field=>field.path==='/binding')),'binding change follows source slot after compiler ID churn');
  assert.ok(changes(changed,'handlers').some(row=>row.basis==='authored-source-slot'));
  assert.ok(!changes(changed,'useSites').some(row=>row.status==='added'||row.status==='removed'),'same source slot is an explicit comparison match');
  for(const row of changes(changed,'useSites'))for(const field of row.fields)assert.equal(field.delta,null,'semantic values never acquire byte deltas');

  const renamed=structuredClone(base), renamedHandler=renamed.analytics.handlers.find(row=>row.name?.startsWith('<inline:'));
  assert.ok(renamedHandler);
  renamedHandler.name='Friendly retained label';
  const naming=compare(base,renamed);
  assert.equal(inventory(naming,'handlers').counts.modified,1);
  assert.equal(changes(naming,'handlers')[0].basis,'retained-identity');
  assert.equal(changes(naming,'handlers')[0].label,renamedHandler.name);
  assert.deepEqual(changes(naming,'handlers')[0].fields.map(field=>field.path),['/name']);
  for(const name of SEMANTIC_COLLECTIONS.filter(name=>name!=='handlers'))assert.deepEqual(inventory(naming,name),inventory(same,name),'display names cannot change semantic identity');

  let next=structuredClone(base);
  const owner=next.analytics.handlers.find(row=>row.name==='reused');
  const sites=next.analytics.useSites.filter(row=>row.ownerId===owner.id&&row.surfaceId==='ctx.config.get');
  assert.equal(sites.length,3);
  const to=sites.find(row=>next.bindings.find(b=>b.id===row.binding.bindingId)?.name==='OTHER');
  sites.find(row=>row.id!==to.id).binding=structuredClone(to.binding);
  let result=compare(base,next);
  assert.equal(inventory(result,'useSites').counts.modified,1,'one repeated read changes independently');
  assert.equal(changes(result,'useSites')[0].basis,'retained-identity');
  next=structuredClone(base);next.analytics.useSites[0].capability={state:'unavailable',value:null,reason:'not-recorded'};
  result=compare(base,next);assert.equal(inventory(result,'useSites').counts.coverageChanged,1);
  next=structuredClone(base);next.analytics.useSites.find(row=>row.binding.state==='resolved').binding={state:'unknown',kind:'config',bindingId:null,referenceId:null,reason:'unresolved-reference'};
  result=compare(base,next);assert.equal(inventory(result,'useSites').counts.coverageChanged,1);
  next=structuredClone(base);next.analytics.handlers[0].source={state:'unavailable',value:null,reason:'not-recorded'};
  result=compare(base,next);assert.equal(inventory(result,'handlers').counts.coverageChanged,1);

  next=structuredClone(base);next.analytics.useSites.pop();next.analytics.coverage.useSites=f.coverage(next.analytics.useSites.length);derive(next);
  result=compare(base,next);assert.equal(inventory(result,'useSites').counts.removed,1);
  assert.equal(inventory(compare(next,base),'useSites').counts.added,1);
  next.analytics.coverage.useSites={status:'partial',observed:next.analytics.useSites.length,expected:null,reason:'not-recorded'};derive(next);
  result=compare(base,next);assert.equal(inventory(result,'useSites').counts.removed,0);assert.equal(inventory(result,'useSites').counts.unresolvedBefore,1);
  assert.equal(inventory(result,'useSites').delta,null);

  const legacy=structuredClone(base);delete legacy.analytics;
  for(const [a,b] of [[legacy,base],[base,legacy]]) {
    result=compare(a,b);
    for(const name of SEMANTIC_COLLECTIONS) {
      const row=inventory(result,name);assert.equal(row.delta,null);assert.equal(row.counts.added+row.counts.removed,0);
      assert.equal(row.identityCoverage[a===legacy?'before':'after'].status,'unavailable');
    }
  }
  assert.equal(compare(legacy,legacy).matchingVersion,'pulse.report-matching.v1');
  const unavailable=structuredClone(legacy);unavailable.analytics=projectHandlerTopology();
  assert.equal(inventory(compare(unavailable,base),'handlers').before.status,'unavailable');

  // Same names at changed locations do not join; bilateral identity gaps remain
  // unresolved instead of inventing deletions/additions or a rename mapping.
  function extra(c, suffix, offset) {
    const row=structuredClone(c.analytics.handlers.find(row=>row.kind==='handler'));
    row.canonicalId='comparison-extra-'+suffix;row.id=f.id('handler',row.canonicalId);row.name='same display name';
    row.source.value.start.offset+=offset;row.source.value.end.offset+=offset;
    c.analytics.handlers.push(row);c.analytics.coverage.handlers=f.coverage(c.analytics.handlers.length);return row;
  }
  let a=structuredClone(base),b=structuredClone(base);extra(a,'old',0);extra(b,'new',10000);
  result=compare(a,b);assert.equal(inventory(result,'handlers').counts.unresolvedBefore,1);assert.equal(inventory(result,'handlers').counts.unresolvedAfter,1);
  assert.equal(inventory(result,'handlers').identityCoverage.before.status,'partial');
  a=structuredClone(base);b=structuredClone(base);extra(a,'a',0);extra(a,'b',0);extra(b,'c',0);extra(b,'d',0);
  result=compare(a,b);assert.ok(changes(result,'handlers').some(row=>row.reason==='ambiguous-identity'));
  assert.equal(inventory(result,'handlers').counts.unresolvedBefore,2);

  // Losing canonical control is coverage, not a claim that middleware stopped
  // running. The retained association graph is rederived before comparison.
  next=structuredClone(base);delete next.analytics.registrations[0].control;derive(next);
  result=compare(base,next);assert.ok(inventory(result,'associations').counts.coverageChanged>0);
  const registrationOwner=next.analytics.handlers.find(h=>h.id===next.analytics.registrations[0].handlerId);
  assert.ok(changes(result,'registrations')[0].label.startsWith(registrationOwner.name+' '),'registration comparisons use retained handler names');
  assert.ok(changes(result,'associations').some(row=>row.fields.some(field=>field.path==='/conditional'&&field.after.value===null)));
  for(const row of next.analytics.registrations)delete row.control;derive(next);
  assert.equal(inventory(compare(base,next),'associations').counts.removed,0,'unavailable associations are not deletion');
  const event=fixture('event'), eventResult=compare(event,event);
  assert.equal(inventory(eventResult,'associations').counts.unchanged,event.analytics.associations.length);
  assert.ok(event.analytics.associations.some(row=>row.lane==='event'));

  const script = `const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const M=require('node:module'),load=M._load;M._load=function(name,...args){if(/project-execution|retained$|compiler|provider-|viewer|child_process|^(node:)?(fs|http|https|net)$/.test(name))throw Error('Unexpected work: '+name);return load.call(this,name,...args)};const c=require(${JSON.stringify(require.resolve('../../packages/cli/src/internal/report/comparison'))});process.stdout.write(c.serializeComparison(c.compareCapsules(...input)));`;
  const passive=require('node:child_process').execFileSync(process.execPath,['-e',script],{input:JSON.stringify([base,edited]),cwd:'/',encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,LANG:'tr_TR.UTF-8',TZ:'Pacific/Auckland'}});
  assert.equal(passive,serializeComparison(changed),'semantic replay needs no files, compiler, provider or network');
  assert.equal(serializeComparison(parseComparison(before)),before);
  assert.equal(serializeComparison(compare(base,base)),before,'deterministic serialization');
  const badEdits=[x=>delete inventory(x,'handlers').identityCoverage,
    x=>inventory(x,'handlers').identityCoverage.before.observed++,
    x=>x.matchingVersion='pulse.report-matching.v1',
    x=>x.summary.inventories.pop(),x=>x.summary.inventories.reverse()];
  for(const edit of badEdits){const copy=structuredClone(same);edit(copy);assert.throws(()=>validateComparison(rehash(copy)));}
  const badBasis=structuredClone(changed);changes(badBasis,'handlers')[0].basis='same-artifact';assert.throws(()=>validateComparison(rehash(badBasis)));
  const hostile=structuredClone(edited);hostile.analytics.handlers[0].name='<img src=x onerror=alert(1)>';
  const hostileComparison=compare(base,hostile),html=renderComparison(hostileComparison);
  assert.match(html,/Authored analytics/);assert.match(html,/Comparison identity coverage/);assert.match(html,/authored source slot/);
  assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;img src=x'));
  const payload=parseComparison(html.match(/<script id="pulse-comparison-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(serializeComparison(payload),serializeComparison(hostileComparison));
  assert.equal(html,renderComparison(hostileComparison));
  assert.ok(html.includes('id="compare-useSites"'));
  require('./report-comparison-viewer-cases.cjs').interactionCases(hostileComparison);
  console.log('ok - AN9-06 semantic inventories, recipe independence, source-slot/retained identity, ambiguity, coverage and offline comparison HTML');
  return {base,changed,recipe};
};
