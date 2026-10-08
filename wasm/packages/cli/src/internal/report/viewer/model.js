'use strict';
// Shared pure view projection: filters never mutate or truncate capsule records.
function createReportViewModel(P) {
  const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
    : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
      : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  const canonicalJson = canonical(P) + '\n';
  const A = P.artifacts.find(a => a.id === P.context.primaryArtifactId);
  const byId = rows => new Map(rows.map(row => [row.id, row]));
  const routes = byId(P.routes), schemas = byId(P.schemas), bindings = byId(P.bindings), evidence = byId(P.evidence), declarations = byId(P.declarations);
  const routeIndex = new Map(P.routes.map((r, i) => [r.id, i]));
  const schemaIndex = new Map(P.schemas.map((s, i) => [s.id, i]));
  const metrics = {'handler-body':'Handler body', own:'Own (exclusive)', reachable:'Reachable', shared:'Shared'};
  const measurementIndex = new Map();
  for (const m of P.measurements) if (m.artifactId === A.id && m.stage === A.stage) {
    const key = m.subjectId + ':' + m.metric;
    if (!measurementIndex.has(key)) measurementIndex.set(key, []);
    measurementIndex.get(key).push(m);
  }
  const measurement = (r, metric) => {const rows=measurementIndex.get(r.id + ':' + metric);return rows?.length===1?rows[0]:undefined;};
  const measurementIssue = (r, metric) => (measurementIndex.get(r.id + ':' + metric)?.length??0)>1 ? 'multiple measurement records; inspect full capsule' : 'missing-evidence';
  const factValue = f => f?.state === 'available' ? f.value : null;
  const qualifier = f => f ? [f.state, f.basis, f.coverage, f.reason].filter(Boolean).join(' · ') : 'unavailable · missing-evidence';
  const metricValue = r => factValue(measurement(r, state.metric)?.fact);
  const sourceText = source => source ? `${source.file}:${source.line}:${source.column}` : 'Not recorded';
  const inventoryCount = name => P.coverage[name].status === 'not-applicable' ? 'N/A' : P.coverage[name].status === 'unavailable' && !P[name].length ? 'Unavailable' : String(P[name].length);
  const prefix = r => '/' + r.path.split('/').filter(Boolean).slice(0, 2).join('/');
  const declarationState = r => r.declarationIds.length ? 'recorded' : r.compositionCoverage === 'complete' ? 'not-declared' : 'unavailable';
  const declarationLabels = {recorded:'Declarations recorded', 'not-declared':'Not declared', unavailable:'Unavailable'};
  const state = {view:'routes', search:'', group:'all', method:'all', declaration:'all', binding:'all', availability:'all', metric:'handler-body', sort:'order', dir:'asc', selected:null, drawerTab:'facts', schemaSearch:'', schemaSort:'name', schemaDir:'asc', expandedSchemas:new Set(), expandedResources:new Set()};
  function compareValues(a,b,direction) { if(a==null)return b==null?0:1;if(b==null)return -1;return (a===b?0:a<b?-1:1)*(direction==='asc'?1:-1); }
  function filteredRoutes() {
    return P.routes.filter(r => {
      const search = [r.path,r.method,r.handlerName,...r.bindingIds.map(id=>bindings.get(id)?.name)].join(' ').toLowerCase();
      return search.includes(state.search) && (state.group==='all'||prefix(r)===state.group) && (state.method==='all'||r.method===state.method)
        && (state.declaration==='all'||declarationState(r)===state.declaration) && (state.binding==='all'||r.bindingIds.includes(state.binding))
        && (state.availability==='all'||(metricValue(r)===null?'unavailable':'available')===state.availability);
    }).sort((a,b)=>compareValues(state.sort==='size'?metricValue(a):a[state.sort],state.sort==='size'?metricValue(b):b[state.sort],state.dir)||a.order-b.order);
  }
  function filteredSchemas() {
    const key=state.schemaSort, get=s=>key==='name'?s.schemaId:key==='keys'?s.structure.topLevelKeys:key==='required'?s.structure.requiredKeys:key==='descriptor'?s.structure.descriptorBytes:s.routeIds.length;
    return P.schemas.filter(s=>[s.schemaId,...s.structure.properties.map(p=>p.name+' '+p.type)].join(' ').toLowerCase().includes(state.schemaSearch)).sort((a,b)=>compareValues(get(a),get(b),state.schemaDir)||schemaIndex.get(a.id)-schemaIndex.get(b.id));
  }
  return {canonicalJson,A,routes,schemas,bindings,evidence,declarations,routeIndex,schemaIndex,metrics,measurement,measurementIssue,factValue,qualifier,sourceText,inventoryCount,prefix,declarationState,declarationLabels,state,filteredRoutes,filteredSchemas};
}
if (typeof module !== 'undefined') module.exports = { createReportViewModel };
