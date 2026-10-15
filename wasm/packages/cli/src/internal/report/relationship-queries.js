'use strict';

// Shared Node/offline-browser query engine. Input is a validated, immutable
// analytics graph. v1 replay uses its retained rows; this engine never upgrades it.
const reportRelationships = (() => {
  const node = typeof module === 'object' && module.exports;
  const { compileRoutePath: compileCanonicalPath } = node ? require('@pulse-compute/wasm-contracts/path') : reportRoutePath;
  const hash = node ? require('./data').sha256 : reportSha256;
  const json = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
    : Array.isArray(value) ? '[' + value.map(json).join(',') + ']'
      : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + json(value[k])).join(',') + '}';
  const unavailable = () => ({status:'unavailable',observed:0,expected:null,reason:'not-recorded'});
  const coverage = (count, reason) => ({status:reason?'partial':'complete',observed:count,expected:reason?null:count,reason:reason||null});
  const WORK_LIMIT = 250000; // Existing traversal safety budget, now per entry query.

  function create(analytics) {
    const registrations = analytics?.registrations || [], useSites = analytics?.useSites || [];
    const byId = new Map(registrations.map(r => [r.id, r]));
    const sites = new Map(), calls = new Map(), patterns = new Map();
    const group = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
    for (const site of [...useSites].sort((a,b)=>a.id.localeCompare(b.id))) group(sites, site.ownerId, site);
    for (const call of [...(analytics?.helperCalls || [])].sort((a,b)=>a.id.localeCompare(b.id)))
      for (const id of call.registrationIds) group(calls, id, call);
    const available = registrations.some(r=>r.control) && ['handlers','registrations']
      .every(k=>analytics?.coverage[k].status !== 'unavailable');
    const sitesAvailable = ['useSites','helperCalls'].every(k=>analytics?.coverage[k].status !== 'unavailable');
    const upstreamPartial = ['handlers','registrations','useSites','helperCalls'].some(k=>analytics?.coverage[k].status !== 'complete');
    const http = registrations.filter(r=>r.kind !== 'event'), indices = new Map(http.map((r,i)=>[r.id,i]));
    const hop = row => ({kind:row.kind==='middleware'?'middleware':row.kind==='error'?'error':row.kind==='mount'?'mount':'direct',id:row.id});
    const ancestry = row => row.mountPath.map(id=>({kind:'mount',id}));
    // The grammar is owned by contracts; compile each distinct pattern once.
    const compileRoutePath = (value, options) => {
      if (!patterns.has(value)) patterns.set(value, compileCanonicalPath(value, options));
      return patterns.get(value);
    };
    const relation = function(gate, context) {
      if (gate === null) return 'always';
      const a = compileRoutePath(gate, { allowWildcard: true });
      const b = compileRoutePath(context || '/*', { allowWildcard: true });
      const x = a.segments.filter(s => s.kind !== 'wildcard'), y = b.segments.filter(s => s.kind !== 'wildcard');
      if (!a.wildcard && !b.wildcard && x.length !== y.length
        || !a.wildcard && x.length < y.length || !b.wildcard && y.length < x.length) return 'never';
      let contains = a.wildcard ? y.length >= x.length : !b.wildcard && x.length === y.length;
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        if (x[i].kind === 'literal' && y[i].kind === 'literal' && x[i].value !== y[i].value) return 'never';
        if (x[i].kind === 'literal' && y[i].kind !== 'literal') contains = false;
      }
      return contains ? 'always' : 'sometimes';
};
    let lastId, lastResult;
    function entry(id) {
      if (lastResult && lastId === id) return lastResult;
      const consumer = byId.get(id), relations = [];
      let work = 0, reason = upstreamPartial ? 'upstream-partial' : null;
      const budget = Symbol('query-budget'), charge = () => { if (++work > WORK_LIMIT) throw budget; };
      const finish = () => (lastId=id, lastResult={relations,coverage:available&&consumer?coverage(relations.length,reason):unavailable(),work});
      if (!available || !consumer || !consumer.handlerId) return finish();
      const extend = (previous, hop) => ({previous,hop});
      const flatten = path => {
        const tail=[];while(!Array.isArray(path)){tail.push(path.hop);path=path.previous;}
        return [...path,...tail.reverse()];
      };
      function emit(owner, path, inherited, uncertainty, direction) {
        // Persistent witness tails avoid quadratic path copying during traversal.
        relations.push({consumer:consumer.id,owner:owner.id,get via(){return flatten(path);},inherited,uncertainty,direction});
      }
      emit(consumer, [...ancestry(consumer),hop(consumer)], false, reason, 'direct');
      if (consumer.kind === 'event') return finish();
      try {
      let uncertainty = upstreamPartial ? 'upstream-partial' : null;
      const graph = http.flatMap(row => [0, 1].map(mode => {
        charge();
        const control = row.control?.state === 'available' ? row.control.value : null;
        if (!control) uncertainty = 'not-recorded';
        const expectedMode = row.kind === 'error' ? 1 : 0;
        const node = { row, mode, hit: false, edges: [] };
        function edge(id, lane, executed) {
          if (id !== null && indices.has(id)) node.edges.push({ to: indices.get(id) * 2 + lane, executed });
        }
        if (mode !== expectedMode) { edge(row.flow.next, mode, false); return node; }
        let match = control ? relation(control.pattern, consumer.control?.state === 'available' ? consumer.control.value.pattern : null) : 'sometimes';
        if (row.match.state !== 'available' || consumer.match.state !== 'available') uncertainty = 'not-recorded';
        if (row.kind === 'route' && consumer.kind === 'route' && row.match.state === 'available' && consumer.match.state === 'available'
          && row.match.value.method !== consumer.match.value.method) match = 'never';
        else if (row.kind === 'route' && consumer.kind !== 'route' && match !== 'never') match = 'sometimes';
        if (match === 'sometimes' && uncertainty !== 'not-recorded') uncertainty ||= 'unsupported-mapping';
        if (match !== 'never') {
          if (row.kind === 'mount') edge(row.flow.child, mode, true);
          else if (row.handlerId) {
            node.hit = true;
            if (!control || control.normal) edge(row.flow.next, 0, true);
            if (!control || control.error) edge(row.flow.next, 1, true);
          } else edge(row.flow.next, mode, false);
        }
        if (match !== 'always' || control?.eligibility) edge(row.flow.next, mode, false);
        return node;
      }));
      reason = uncertainty;
      const target = indices.get(consumer.id) * 2 + (consumer.kind === 'error' ? 1 : 0);
      const reachable = new Set(), queue = graph.length ? [0] : [];
      for (let i = 0; i < queue.length; i++) {
        charge(); const key = queue[i]; if (reachable.has(key)) continue; reachable.add(key);
        for (const e of graph[key].edges) queue.push(e.to);
      }
      if (!reachable.has(target) || !graph[target].hit) return finish();
      const reverse = graph.map(() => []);
      graph.forEach((node, key) => node.edges.forEach(e => reverse[e.to].push(key)));
      const before = new Set(), back = [target];
      for (let i = 0; i < back.length; i++) {
        charge(); const key = back[i]; if (before.has(key)) continue; before.add(key); back.push(...reverse[key]);
      }
      for (const key of [...before].sort((a, b) => a - b)) {
        charge(); const node = graph[key], owner = node.row;
        if (key === target || !reachable.has(key) || !node.hit || !node.edges.some(e => e.executed && before.has(e.to))) continue;
        emit(owner, [...ancestry(owner), hop(owner)], true, uncertainty, 'upstream');
      }
      // Keep a deterministic continuation witness, with skips omitted. The via
      // path explains dependencies; it is not an observed runtime trace.
      const seen = new Set(), after = graph[target].edges.filter(e => e.executed)
        .map(e => ({ key: e.to, via: [...ancestry(consumer), hop(consumer)] }));
      for (let i = 0; i < after.length; i++) {
        charge(); const { key, via } = after[i]; if (seen.has(key)) continue; seen.add(key);
        const node = graph[key];
        if (node.hit) emit(node.row, extend(via, hop(node.row)), true, uncertainty, 'continuation');
        for (const edge of node.edges) after.push({ key: edge.to, via: edge.executed ? extend(via, hop(node.row)) : via });
      }

      } catch (error) { if (error !== budget) throw error; reason='graph-budget-exhausted'; }
      return finish();
    }
    function blocks(id, select = null, selectedByOwner = new Map()) {
      if(!sitesAvailable)return {blocks:[],coverage:unavailable()};
      const result=entry(id), blocks=[];
      for (const relation of result.relations) {
        const owner=byId.get(relation.owner);
        for (const [ownerId,call] of [[owner.handlerId,null],...(calls.get(owner.id)||[]).map(c=>[c.calleeId,c])]) {
          if(!selectedByOwner.has(ownerId))selectedByOwner.set(ownerId,select?(sites.get(ownerId)||[]).filter(select):(sites.get(ownerId)||[]));
          const selected=selectedByOwner.get(ownerId);
          if (selected.length) blocks.push({relation,get via(){return call?[...relation.via,{kind:'helper',id:call.id}]:relation.via;},sites:selected});
        }
      }
      return {blocks,coverage:result.coverage};
    }
    function row(block, site) {
      const r=block.relation, via=block.via;
      const value={consumerRegistrationId:r.consumer,useSiteId:site.id,via,
        lane:byId.get(r.consumer).kind==='event'?'event':via.some(p=>p.kind==='error')?'error':'normal',
        conditional:r.inherited?r.uncertainty==='not-recorded'?null:true:false,
        coverage:coverage(1,r.uncertainty),evidence:[{basis:'derived-association',producer:'canonical-report-associations'}]};
      value.id='association:'+hash(json(['association',value.consumerRegistrationId,value.useSiteId,via,value.lane]));
      return value;
    }
    // A finite sequence of factored blocks. Only requested rows acquire hashes
    // and explanations. Paging never truncates the semantic result or capsule.
    function sequence(blocks) {
      const length=blocks.reduce((n,b)=>n+b.sites.length,0);
      return {length,
        slice(start=0,end=length) {
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end))throw new TypeError('Invalid association page');
          start=Math.max(0,start<0?length+start:start);end=Math.min(length,end<0?length+end:end);
          if(end-start>100000)throw new RangeError('Association page exceeds reader record bound');
          const result=[];let offset=0;
          for(const b of blocks){if(offset>=end)break;const stop=Math.min(b.sites.length,end-offset);
            for(let i=Math.max(0,start-offset);i<stop;i++)result.push(row(b,b.sites[i]));offset+=b.sites.length;}
          return result;
        },
        some(test) {for(const b of blocks)for(const s of b.sites)if(test({consumerRegistrationId:b.relation.consumer,useSiteId:s.id}))return true;return false;},
        *[Symbol.iterator]() {for(const b of blocks)for(const s of b.sites)yield row(b,s);}
      };
    }
    function route(id) {
      const result=blocks(id), rows=sequence(result.blocks);
      return {rows,coverage:result.coverage.status==='unavailable'?unavailable():coverage(rows.length,result.coverage.reason)};
    }
    function upstream(id) {
      const result=entry(id), relations=result.relations.filter(r=>r.direction==='upstream');
      return {relations,coverage:result.coverage.status==='unavailable'?unavailable():coverage(relations.length,result.coverage.reason)};
    }
    function binding(id, accept = () => true) {
      const selectedByOwner=new Map(), result=[], consumers=[], owners=new Set(useSites.filter(s=>s.binding.bindingId===id).map(s=>s.ownerId));
      let reason=upstreamPartial?'upstream-partial':null;
      if (!available || !sitesAvailable) return {blocks:[],consumerIds:[],rows:sequence([]),coverage:unavailable()};
      for(const consumer of registrations) {
        if(!accept(consumer))continue;
        const e=entry(consumer.id);reason ||= e.coverage.reason;
        if(!e.relations.some(r=>owners.has(byId.get(r.owner).handlerId)||(calls.get(r.owner)||[]).some(c=>owners.has(c.calleeId))))continue;
        const b=blocks(consumer.id,s=>s.binding.bindingId===id,selectedByOwner).blocks;
        if(b.length){consumers.push(consumer.id);result.push(...b);}
      }
      const rows=sequence(result);
      return {blocks:result,consumerIds:consumers.sort(),rows,coverage:coverage(rows.length,reason)};
    }
    function site(id) {
      const selectedByOwner=new Map(),result=[];let reason=upstreamPartial?'upstream-partial':null;
      if(!available||!sitesAvailable)return {rows:sequence([]),coverage:unavailable()};
      for(const consumer of registrations){const b=blocks(consumer.id,s=>s.id===id,selectedByOwner);result.push(...b.blocks);reason ||= b.coverage.reason;}
      const rows=sequence(result);return {rows,coverage:coverage(rows.length,reason)};
    }
    return {entry,upstream,route,binding,site,blocks,sequence,registrationById:byId,
      bindingIds:[...new Set(useSites.map(s=>s.binding.bindingId).filter(Boolean))].sort()};
  }
  return {create,WORK_LIMIT};
})();
if (typeof module === 'object' && module.exports) module.exports = reportRelationships;
