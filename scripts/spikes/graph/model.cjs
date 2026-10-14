/* Shared, compiler-free projection. Every edge retains its source identity. */
(function (root) {
  'use strict';
  function index(capsule) {
    const a = capsule.analytics;
    const registrations = a?.registrations || [], handlers = a?.handlers || [], uses = a?.useSites || [], associations = a?.associations || [];
    const byId = new Map(registrations.map(r => [r.id, r])), definitions = new Map(handlers.map(h => [h.id, h]));
    const useById = new Map(uses.map(u => [u.id, u])), bindingById = new Map(capsule.bindings.map(b => [b.id, b]));
    const children = new Map(), instances = new Map(), incoming = new Map(), byUse = new Map();
    const add = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
    for (const r of registrations) {
      add(children, r.mountPath.at(-1) || null, r);
      if (r.handlerId) add(instances, r.handlerId, r);
      for (const [kind, target] of Object.entries(r.flow)) if (target) add(incoming, target, { from: r.id, to: target, kind });
    }
    for (const list of children.values()) list.sort((x, y) => x.order - y.order);
    for (const row of associations) add(byUse, row.useSiteId, row);
    const filename = source => source?.state === 'available' ? source.value.file : null;
    const basename = file => file?.split('/').at(-1)?.replace(/\.[^.]+$/, '');
    function label(r) {
      if (!r) return 'Unknown registration';
      if (r.kind === 'mount') return basename(filename(children.get(r.id)?.[0]?.source)) || r.routerId.split('::').at(-1) || 'Subrouter';
      const h = definitions.get(r.handlerId), file = basename(filename(h?.source));
      return file && file !== 'index' ? file : h?.name || r.kind;
    }
    const match = r => r.match?.state === 'available' ? [r.match.value.method, r.match.value.path || r.match.value.eventType].filter(Boolean).join(' ') : 'Match not recorded';
    const lane = r => r.kind === 'error' ? 'error' : r.kind === 'event' ? 'event' : 'normal';
    const search = (r, query) => [label(r), match(r), filename(r.source), filename(definitions.get(r.handlerId)?.source), r.kind, r.id].join(' ').toLowerCase().includes(query.toLowerCase());
    function neighbors(id) {
      const r = byId.get(id);
      return { incoming: incoming.get(id) || [], outgoing: r ? Object.entries(r.flow).filter(([, to]) => to).map(([kind, to]) => ({ from: id, to, kind })) : [] };
    }
    const groups = new Map();
    for (const u of uses) {
      const cap = u.capability.state === 'available' ? u.capability.value : 'Capability not recorded';
      add(groups, 'cap:' + cap, u);
      if (u.binding.state === 'resolved') add(groups, 'binding:' + u.binding.bindingId, u);
      else if (!['not-applicable'].includes(u.binding.state)) add(groups, 'unresolved:' + u.binding.state, u);
    }
    function dependency(key, ownerId) {
      const sites = (groups.get(key) || []).filter(u => !ownerId || u.ownerId === ownerId);
      const owners = [...new Set(sites.map(u => u.ownerId))];
      const rows = sites.flatMap(u => byUse.get(u.id) || []);
      const consumers = [...new Set(rows.map(row => row.consumerRegistrationId))].sort((x, y) => byId.get(x).order - byId.get(y).order);
      return { sites, owners, rows, consumers };
    }
    return { a, registrations, handlers, uses, associations, byId, definitions, useById, bindingById, children, instances, byUse, filename, label, match, lane, search, neighbors, groups, dependency };
  }
  const api = { index };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PulseGraph = api;
})(typeof globalThis === 'object' ? globalThis : this);
