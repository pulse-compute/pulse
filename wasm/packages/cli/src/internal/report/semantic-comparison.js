'use strict';

// Comparison-only joins over retained facts. Source slots are explicitly weaker
// than retained IDs: neither establishes source/body equivalence after an edit.
const { canonicalJson: json, sha256 } = require('./data');
const { SEMANTIC_COLLECTIONS } = require('./comparison-schema');
const keyFor = (name, value) => name + ':' + sha256(json(value));
const coverage = (c, name) => c.analytics?.coverage[name]
  || { status: 'unavailable', observed: 0, expected: null, reason: 'not-recorded' };
const rows = (c, name) => c.analytics?.[name] || [];
const slot = fact => fact?.state === 'available'
  ? [fact.value.file, fact.value.start.offset, fact.value.end.offset] : null;
const group = (records, key) => {
  const result = new Map();
  for (const row of records) { const value = key(row); if (!result.has(value)) result.set(value, []); result.get(value).push(row); }
  return result;
};
function logical(name, row, map) {
  const source = slot(row.source), ref = id => id === null ? null : map.get(id);
  const links = ids => ids.every(id => map.has(id)) ? ids.map(id => map.get(id)) : undefined;
  if (name === 'handlers') return source ? [row.kind, source] : null;
  if (name === 'registrations') {
    const mounts = links(row.mountPath);
    return source && mounts && (row.handlerId === null || map.has(row.handlerId))
      ? [source, row.kind, row.routerPath, mounts, ref(row.handlerId)] : null;
  }
  if (name === 'useSites') return source && map.has(row.ownerId) ? [ref(row.ownerId), source] : null;
  if (name === 'helperCalls') return source && map.has(row.callerId) && map.has(row.calleeId)
    ? [ref(row.callerId), ref(row.calleeId), source] : null;
  if (name === 'associations') return map.has(row.consumerRegistrationId) && map.has(row.useSiteId) && links(row.via.map(hop => hop.id))
    ? [ref(row.consumerRegistrationId), ref(row.useSiteId), row.via.map(hop => [hop.kind, ref(hop.id)])] : null;
  return null;
}
function matching(capsules, name, maps) {
  const records = capsules.map(c => rows(c, name)), pairs = [], pending = [];
  const remaining = records.map(side => new Map(side.map(row => [row.id, row])));
  const add = (a, b, key, basis) => {
    pairs.push({ key, before:a, after:b, basis });
    maps[0].set(a.id,key); maps[1].set(b.id,key);
    remaining[0].delete(a.id); remaining[1].delete(b.id);
  };
  for (const a of records[0]) {
    const b=remaining[1].get(a.id);
    if (b) add(a,b,keyFor(name,['retained',a.id]),'retained-identity');
  }
  // Mount instances precede their children. Nested/repeated mounts never join
  // merely because their registrations share the same authored source span.
  const depths = name === 'registrations'
    ? [...new Set(records.flat().map(row => row.mountPath.length))].sort((a,b)=>a-b) : [0];
  for (const depth of depths) {
    const groups = remaining.map((side,index) => group([...side.values()].filter(row => name !== 'registrations' || row.mountPath.length === depth), row => {
      const key=logical(name,row,maps[index]);return key===null?null:keyFor(name,['comparison',key]);
    }));
    const universe = records.map((side,index)=>group(side.filter(row=>name!=='registrations'||row.mountPath.length===depth),row=>{
      const key=logical(name,row,maps[index]);return key===null?null:keyFor(name,['comparison',key]);
    }));
    for (const key of [...new Set([...groups[0].keys(),...groups[1].keys()])].filter(key=>key!==null).sort()) {
      const a=groups[0].get(key)||[], b=groups[1].get(key)||[];
      const ambiguous=(universe[0].get(key)?.length||0)>1||(universe[1].get(key)?.length||0)>1;
      if (!ambiguous && a.length===1 && b.length===1) add(a[0],b[0],key,name==='associations'?'semantic-links':'authored-source-slot');
      else {
        pending.push({key,before:a,after:b,reason:ambiguous?'ambiguous-identity':null});
        for (const [index,side] of [a,b].entries()) for (const row of side) {
          remaining[index].delete(row.id);if(!ambiguous)maps[index].set(row.id,key);
        }
      }
    }
  }
  if (remaining.some(side=>side.size)) pending.push({key:keyFor(name,['unresolved']),before:[...remaining[0].values()],after:[...remaining[1].values()],reason:'missing-identity'});
  // A moved/renamed source can leave both sides unmatched. Do not turn that
  // identity gap into paired deletion/addition claims. Link-defined association
  // paths may differ once all referenced identities have been established.
  if (name !== 'associations' && pending.some(row=>row.before.length) && pending.some(row=>row.after.length)) {
    for (const item of pending) if (!item.reason) {
      item.reason='missing-identity';
      item.before.forEach(row=>maps[0].delete(row.id)); item.after.forEach(row=>maps[1].delete(row.id));
    }
  }
  return {pairs,pending};
}
function projector(c, maps, legacy, ranks) {
  const bindingById = new Map(c.bindings.map(row=>[row.id,row]));
  const refs = (ids, ordered=false, lookup=maps) => {
    const keys=ids.map(id=>lookup.get(id)).filter(Boolean);
    return { keys:ordered?keys:[...new Set(keys)].sort(), complete:keys.length===ids.length, unresolved:ids.length-keys.length };
  };
  return (name,row) => {
    const evidence={evidence:row.evidence};
    if(name==='handlers')return {...evidence,kind:row.kind,name:row.name,source:row.source,package:row.package};
    if(name==='registrations')return {...evidence,kind:row.kind,authored:row.authored,source:row.source,
      handler:refs(row.handlerId?[row.handlerId]:[]),routerPath:row.routerPath,mountPath:refs(row.mountPath,true),match:row.match,
      ...(row.control?{control:row.control}:{}),...(ranks.has(row.id)?{relativeOrder:ranks.get(row.id)}:{}),
      flow:Object.fromEntries(Object.entries(row.flow).map(([name,id])=>[name,refs(id?[id]:[])]))};
    if(name==='useSites')return {...evidence,owner:refs([row.ownerId]),surfaceId:row.surfaceId,operation:row.operation,capability:row.capability,source:row.source,
      binding:{state:row.binding.state,kind:row.binding.kind,reason:row.binding.reason,complete:['resolved','not-applicable'].includes(row.binding.state),logicalName:bindingById.get(row.binding.bindingId)?.name??null,
        reference:refs(row.binding.referenceId?[row.binding.referenceId]:[],false,legacy),target:refs(row.binding.bindingId?[row.binding.bindingId]:[],false,legacy)}};
    if(name==='helperCalls')return {...evidence,caller:refs([row.callerId]),callee:refs([row.calleeId]),registrations:refs(row.registrationIds),source:row.source};
    return {...evidence,consumer:refs([row.consumerRegistrationId]),useSite:refs([row.useSiteId]),
      via:{hops:row.via.map(hop=>({kind:hop.kind,reference:refs([hop.id])})),complete:row.via.every(hop=>maps.has(hop.id))},
      lane:row.lane,conditional:row.conditional,coverage:row.coverage};
  };
}
function labeler(c) {
  const definitions=new Map(rows(c,'handlers').map(row=>[row.id,row]));
  const registrations=new Map(rows(c,'registrations').map(row=>[row.id,row]));
  const sites=new Map(rows(c,'useSites').map(row=>[row.id,row]));
  const definition=id=>definitions.get(id)?.name || definitions.get(id)?.kind || 'Unknown definition';
  const registration=row=>[row.kind,row.match.value?.method,row.match.value?.path,row.match.value?.eventType].filter(Boolean).join(' ');
  return (name,row)=>name==='handlers' ? row.name || row.kind
    : name==='registrations' ? registration(row)
      : name==='useSites' ? definition(row.ownerId)+' · '+row.surfaceId
        : name==='helperCalls' ? definition(row.callerId)+' → '+definition(row.calleeId)
          : registration(registrations.get(row.consumerRegistrationId))+' → '+sites.get(row.useSiteId).surfaceId+' · '+row.lane;
}
function prepareSemanticComparison(before, after, legacyMaps) {
  const capsules=[before,after], maps=[new Map(),new Map()], matches=new Map(), ranks=[new Map(),new Map()];
  for(const name of SEMANTIC_COLLECTIONS)matches.set(name,matching(capsules,name,maps));
  for(const [index,side] of ['before','after'].entries())[...matches.get('registrations').pairs]
    .sort((a,b)=>a[side].order-b[side].order).forEach((pair,rank)=>ranks[index].set(pair[side].id,rank));
  return {matches,label:capsules.map(labeler),project:capsules.map((c,index)=>projector(c,maps[index],legacyMaps[index],ranks[index]))};
}
function identityCoverage(inventory, changes, side) {
  if(inventory.status==='unavailable'||inventory.status==='not-applicable')return {...inventory};
  const unresolved=changes.filter(row=>row.status==='unresolved'&&row.reason!=='incomplete-inventory')
    .reduce((sum,row)=>sum+row[side+'Ids'].length,0);
  return {status:unresolved?'partial':'complete',observed:inventory.observed-unresolved,expected:inventory.observed,
    reason:unresolved?'unresolved-identity':null};
}
module.exports={prepareSemanticComparison,coverage,identityCoverage};
