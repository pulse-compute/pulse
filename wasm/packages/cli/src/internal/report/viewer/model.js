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
  const resourceIndex = new Map(P.resources.map((r, i) => [r.id, i]));
  const entries = byId(P.entries), bodies = byId(P.bodies);
  const helpers = (P.implementations || []).filter(row => row.artifactId === A.id
    && ['authored-helper', 'consolidated-stage'].includes(row.origin));
  const helperIndex = new Map(helpers.map((row, i) => [row.id, i]));
  const helperOrigins = {'authored-helper':'Authored helper', 'consolidated-stage':'Consolidated stage'};
  const helperState = !P.implementations ? 'not-recorded'
    : !P.implementations.some(row => row.artifactId === A.id) ? 'no-primary-records' : 'recorded';
  const entryLabel = entry => `Entry ${entry.order + 1} · ${entry.kind}${entry.flow?.path ? ' · ' + (entry.flow.method || '') + ' ' + entry.flow.path : ''}`;
  // Presentation ordinals are capsule-local links, not new authored identities.
  const helperLabel = row => helperOrigins[row.origin] + ' ' + (helperIndex.get(row.id) + 1);
  function helperSize(rows) {
    const counts = new Map();
    for (const row of rows) for (const id of row.bodyIds) counts.set(id, (counts.get(id) || 0) + 1);
    const ids = [...counts.keys()];
    const mapped = rows.reduce((n,row) => n + row.bodyCoverage.observed, 0);
    const expected = rows.reduce((n,row) => n + row.bodyCoverage.expected, 0);
    return { bodyIds:ids, bytes:ids.length ? ids.reduce((n,id) => n + bodies.get(id).bytes, 0) : null,
      mapped, expected, partial:mapped !== expected,
      overlappingBodies:[...counts.values()].filter(count => count > 1).length };
  }
  const routeHelpers = route => helpers.filter(row => row.routeIds.includes(route.id));
  const primaryImplementations = (P.implementations || []).filter(row => row.artifactId === A.id);
  const dispatchers = primaryImplementations.filter(row => row.origin === 'dispatcher');
  // Join consumers at the physical-body/chunk boundary, not the whole logical
  // implementation: its other chunks may have different associated entries.
  const bodyConsumers = new Map();
  for (const row of primaryImplementations) for (const chunk of row.chunks) {
    if (chunk.bodyId === null) continue;
    if (!bodyConsumers.has(chunk.bodyId)) bodyConsumers.set(chunk.bodyId, new Set());
    for (const id of chunk.entryIds) bodyConsumers.get(chunk.bodyId).add(id);
  }
  function routeDispatchers(route) {
    const records = dispatchers.filter(row => row.routeIds.includes(route.id));
    const size = helperSize(records);
    return { records, size, bodies:size.bodyIds.map(id => {
      const entryIds = [...bodyConsumers.get(id)].sort();
      return { ...bodies.get(id), entryIds,
        routeIds:P.routes.filter(row => row.composition.some(key => entryIds.includes(key))).map(row => row.id),
        records:records.filter(row => row.bodyIds.includes(id)) };
    }), missing:records.filter(row => !row.bodyIds.length) };
  }
  // Containment follows the registration's own entry, never its bounded
  // composition. Union physical bodies independently of logical carrier chunks.
  function containingBodies(selectedRoutes) {
    const entryIds = new Set(selectedRoutes.map(row => row.entryId));
    const chunks = [...new Map(dispatchers.flatMap(row => row.chunks)
      .filter(chunk => chunk.entryIds.some(id => entryIds.has(id)))
      .map(chunk => [chunk.chunk, chunk])).values()];
    const bodyIds = [...new Set(chunks.map(chunk => chunk.bodyId).filter(id => id !== null))];
    const contained = selectedRoutes.filter(route => chunks.some(chunk => chunk.entryIds.includes(route.entryId)));
    return { chunks, bodyIds, bytes:bodyIds.length ? bodyIds.reduce((n,id) => n + bodies.get(id).bytes, 0) : null,
      mapped:chunks.filter(chunk => chunk.bodyId !== null).length, expected:chunks.length,
      registrations:contained.length, unrecorded:selectedRoutes.length - contained.length,
      partial:chunks.some(chunk => chunk.bodyId === null),
      bodies:bodyIds.map(id => {
        const knownEntries = [...bodyConsumers.get(id)].sort();
        return {...bodies.get(id), entryIds:knownEntries,
          routeIds:P.routes.filter(route => knownEntries.includes(route.entryId)).map(route => route.id),
          chunks:chunks.filter(chunk => chunk.bodyId === id),
          evidenceIds:[...new Set(dispatchers.filter(row => row.chunks.some(chunk => chunk.bodyId === id
            && chunk.entryIds.some(key => entryIds.has(key)))).flatMap(row => row.evidenceIds))]};
      }), missing:chunks.filter(chunk => chunk.bodyId === null) };
  }
  const routeContainment = route => containingBodies([route]);
  const entryHelpers = route => helpers.filter(row => row.chunks.some(chunk => chunk.entryIds.includes(route.entryId)));
  const schemaReferences = new Map();
  for (const reference of P.references || []) if (reference.kind === 'schema' && reference.targetId) {
    if (!schemaReferences.has(reference.targetId)) schemaReferences.set(reference.targetId, []);
    schemaReferences.get(reference.targetId).push(reference);
  }
  function schemaUsage(schema) {
    const refs = schemaReferences.get(schema.id) || [];
    const incomplete = refs.some(row => row.entryCoverage.status !== 'complete');
    const externalPackages = [...new Set(refs.flatMap(row => row.externalPackages || []))].sort();
    const label = schema.entryIds.length ? 'Used' + (incomplete ? ' · consumer coverage incomplete' : '')
      : refs.length ? 'Referenced · consumer unresolved'
      : P.references ? 'No observed use · not proven unused' : 'Usage tracing not recorded';
    return { label, externalPackages };
  }
  const representationLabels = {'base64-text':'Packed base64 text', 'pulse.report-schema-shape.v1':'Normalized descriptor', 'package-guest-unit':'Package guest unit', 'native-string':'Native string storage (unmapped)'};
  const resourceScopes = {'selected-embedded-assets':'Selected embedded assets', 'schema-codecs':'Generated schema codecs',
    'package-guest-units':'Package guest units', 'package-realizations':'Package realization records', 'generated-support':'Other generated support', 'canonical-text-responses':'Canonical text-response sites'};
  const metrics = {'handler-body':'Handler body', own:'Own (exclusive)', reachable:'Reachable', shared:'Shared'};
  const measurementIndex = new Map();
  for (const m of P.measurements) if (m.artifactId === A.id && m.stage === A.stage) {
    const key = m.subjectId + ':' + m.metric;
    if (!measurementIndex.has(key)) measurementIndex.set(key, []);
    measurementIndex.get(key).push(m);
  }
  // Repeated evidence for the same measurement is not missing data. Coalesce
  // only equivalent claims; equal byte counts with different scopes still differ.
  const resolutions = new Map();
  for (const [key, records] of measurementIndex) {
    const groups = new Map();
    for (const row of records) {
      const {id, fact, ...claim} = row, {evidenceIds, ...value} = fact;
      const signature = canonical({...claim, bodyIds:[...(claim.bodyIds || [])].sort(), fact:value});
      if (!groups.has(signature)) groups.set(signature, {...row, fact:{...fact, evidenceIds:[]}, recordIds:[]});
      const group = groups.get(signature);
      group.recordIds.push(id);
      group.fact.evidenceIds = [...new Set([...group.fact.evidenceIds, ...evidenceIds])].sort();
    }
    const variants = [...groups.values()];
    resolutions.set(key, {records, variants, measurement:variants.length === 1 ? variants[0] : undefined});
  }
  const measurementResolution = (r, metric) => resolutions.get(r.id + ':' + metric) || {records:[], variants:[], measurement:undefined};
  const measurement = (r, metric) => measurementResolution(r, metric).measurement;
  const routeBehavior = route => ({ terminal:'Terminal', continuing:'Continuing' })[route.behavior?.kind] || 'Behavior not recorded';
  const routeCounts = { registrations:P.routes.length,
    distinctMethodPaths:P.coverage.routes.status === 'unavailable' && !P.routes.length ? null
      : new Set(P.routes.map(row => JSON.stringify([row.method, row.path]))).size,
    terminal:P.routes.filter(row => row.behavior?.kind === 'terminal').length,
    continuing:P.routes.filter(row => row.behavior?.kind === 'continuing').length,
    unknown:P.routes.filter(row => !row.behavior).length };
  function handlerAttribution(route) {
    const resolution = measurementResolution(route, 'handler-body'), m = resolution.measurement;
    if (resolution.variants.length > 1) return {code:'conflicting-evidence', label:'Conflicting measurements', detail:'Distinct measurement claims remain unresolved.'};
    if (m?.fact.state === 'available' && m.fact.coverage === 'exact') return {code:'exact', label:'Exact handler bodies', detail:'Mapped handler bodies; excludes data and downstream execution.'};
    // Only the registration's own entry establishes its containing carriers.
    // A preceding middleware carrier in bounded composition is not its body.
    const chunks = dispatchers.flatMap(row => row.chunks).filter(row => row.entryIds.includes(route.entryId));
    const mixed = chunks.some(row => row.bodyId !== null && bodyConsumers.get(row.bodyId)?.size > 1);
    const missing = chunks.some(row => row.bodyId === null);
    if (mixed) return {code:'mixed-dispatcher', label:'Mixed dispatcher ownership',
      detail:'Handler code shares containing bodies with other entries; isolated handler bytes are unavailable.'
        + (missing ? ' Some containing symbols also lack final mappings.' : '')
        + (m?.fact.state === 'available' ? ' The displayed partial value covers separately mapped code only.' : '')};
    if (missing) return {code:'missing-final-symbol', label:'Final symbol not mapped', detail:'Compiler associations exist, but some containing symbols have no surviving final body mapping.'};
    if (chunks.length) return {code:'dispatcher-contained', label:'Dispatcher-contained handler', detail:'Containing bodies are mapped. Association with one observed entry does not prove exclusive handler bytes.'};
    if (m?.fact.reason === 'dispatcher-carrier') return {code:'dispatcher-unresolved', label:'Dispatcher attribution unresolved', detail:'The measurement records a carrier, but retained mappings cannot establish its containing bodies or co-owners.'};
    return {code:m?.fact.reason || 'missing-evidence', label:m?.fact.state === 'available' ? 'Partial handler mapping' : 'Handler evidence unavailable',
      detail:'Attribution evidence: ' + (m?.fact.reason || 'missing-evidence') + '. No mixed ownership is inferred.'};
  }
  const measurementIssue = (r, metric) => {
    const result = measurementResolution(r, metric);
    return result.variants.length > 1 ? result.variants.length + ' distinct measurements; compare values, methods and scope in Size attribution' : 'missing-evidence';
  };
  const factValue = f => f?.state === 'available' ? f.value : null;
  const qualifier = f => f ? [f.state, f.basis, f.coverage, f.reason].filter(Boolean).join(' · ') : 'unavailable · missing-evidence';
  const metricValue = r => factValue(measurement(r, state.metric)?.fact);
  const sourceText = source => source ? `${source.file}:${source.line}:${source.column}` : 'Not recorded';
  const inventoryCount = name => P.coverage[name].status === 'not-applicable' ? 'N/A' : P.coverage[name].status === 'unavailable' && !P[name].length ? 'Unavailable' : String(P[name].length);
  const prefix = r => '/' + r.path.split('/').filter(Boolean).slice(0, 2).join('/');
  const declarationState = r => r.declarationIds.length ? 'recorded' : r.compositionCoverage === 'complete' ? 'not-declared' : 'unavailable';
  const declarationLabels = {recorded:'Declarations recorded', 'not-declared':'Not declared', unavailable:'Unavailable'};
  const state = {view:'routes', search:'', group:'all', method:'all', declaration:'all', binding:'all', availability:'all', metric:'handler-body', sort:'order', dir:'asc', selected:null, drawerTab:'facts', schemaSearch:'', schemaSort:'name', schemaDir:'asc', resourceSort:'name', resourceDir:'asc', expandedSchemas:new Set(), expandedResources:new Set(),
    helperSearch:'', helperOrigin:'all', helperRole:'all', helperSort:'name', helperDir:'asc', expandedHelpers:new Set()};
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
  function sortedResources() {
    const value = r => state.resourceSort === 'name' ? r.name : state.resourceSort === 'input' ? factValue(r.inputBytes)
      : state.resourceSort === 'representation' ? factValue(r.generator?.representationBytes) : factValue(r.retainedPayloadBytes);
    return [...P.resources].sort((a,b)=>compareValues(value(a),value(b),state.resourceDir)||resourceIndex.get(a.id)-resourceIndex.get(b.id));
  }
  function filteredHelpers() {
    const value = row => state.helperSort === 'size' ? helperSize([row]).bytes
      : state.helperSort === 'consumers' ? row.entryIds.length : helperIndex.get(row.id);
    return helpers.filter(row => (state.helperOrigin === 'all' || row.origin === state.helperOrigin)
      && (state.helperRole === 'all' || row.roles.includes(state.helperRole))
      && [helperLabel(row),row.canonicalId,...row.roles,
        ...row.entryIds.map(id => entryLabel(entries.get(id))),
        ...row.routeIds.map(id => {const route=routes.get(id);return route.method+' '+route.path;})]
        .join(' ').toLowerCase().includes(state.helperSearch))
      .sort((a,b) => compareValues(value(a),value(b),state.helperDir) || helperIndex.get(a.id)-helperIndex.get(b.id));
  }
  function composition(artifact) {
    if (artifact.sectionCoverage.status !== 'complete') return null;
    const parts = [{id:'code',label:'Code',bytes:0},{id:'data',label:'Data',bytes:0},{id:'custom',label:'Custom',bytes:0},{id:'other',label:'Other + header',bytes:8}];
    for (const s of artifact.sections) parts[s.id===10?0:s.id===11?1:s.id===0?2:3].bytes += s.bytes;
    return parts;
  }
  const mappingCoverage = metric => ({available:P.routes.filter(r => factValue(measurement(r,metric)?.fact) !== null).length, total:P.routes.length});
  return {canonicalJson,A,routes,schemas,bindings,evidence,declarations,routeIndex,schemaIndex,schemaUsage,resourceIndex,representationLabels,resourceScopes,metrics,measurement,measurementResolution,measurementIssue,factValue,qualifier,sourceText,inventoryCount,prefix,declarationState,declarationLabels,state,filteredRoutes,filteredSchemas,sortedResources,composition,mappingCoverage,
    entries,helpers,helperIndex,helperOrigins,helperState,entryLabel,helperLabel,helperSize,routeHelpers,filteredHelpers,routeDispatchers,
    routeBehavior,routeCounts,handlerAttribution,containingBodies,routeContainment,entryHelpers};
}
if (typeof module !== 'undefined') module.exports = { createReportViewModel };
