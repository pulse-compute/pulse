(function () {
  'use strict';
  const capsule = JSON.parse(document.getElementById('report-data').textContent), m = PulseGraph.index(capsule);
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const button = (text, action, cls) => { const e = el('button', cls, text); e.type = 'button'; e.addEventListener('click', action); return e; };
  const state = { view: 'atlas', scope: null, selected: m.registrations[0]?.id, open: new Set(), query: '', zoom: 1, key: [...m.groups.keys()].find(k => k.startsWith('binding:')) || [...m.groups.keys()][0], owner: null, ownerPage: 0, consumerPage: 0, association: null };
  const history = { ids: state.selected ? [state.selected] : [], position: 0 };
  let atlasNodes = [];
  const camera = PulseGraphCamera({ viewport: $('viewport'), graph: $('graph'), overview: $('minimap'), zoomLabel: $('zoom-reset'), onZoom: value => { state.zoom = value; } });
  const descriptions = {
    atlas: ['The shape of your application', 'Focus a subrouter, expand its structure, and follow a registration back to the execution table. Curves show containment.'],
    lanes: ['One registration. Every retained link.', 'Next candidate is dispatch order, not proof of continuation. Child and parent-return links keep mount boundaries visible.'],
    dependencies: ['Why is this capability here?', 'Start with a binding or capability. Separate authored ownership from retained contextual consumers.']
  };
  const short = value => value?.slice(0, 18) || 'Not recorded';
  function rememberSelection(id) {
    if (history.ids[history.position] === id) return;
    history.ids.splice(history.position + 1); history.ids.push(id);
    if (history.ids.length > 100) history.ids.shift(); history.position = history.ids.length - 1;
  }
  function inScope(r) { return !state.scope || r.id === state.scope || r.mountPath.includes(state.scope); }
  function choose(id, scroll = true, remember = true) {
    if (!m.byId.has(id)) return;
    state.selected = id;
    const r = m.byId.get(id);
    if (!inScope(r)) state.scope = null;
    r.mountPath.forEach(mount => state.open.add(mount));
    if (remember) rememberSelection(id);
    render();
    if (scroll) { const row = $('rows').querySelector('.active'), parent = row?.closest('.table-scroll'); if (row && parent) parent.scrollTop = row.offsetTop - parent.querySelector('thead').offsetHeight; }
  }
  function focusNode(id) {
    requestAnimationFrame(() => { const node = [...$('graph').querySelectorAll('[data-registration]')].find(n => n.dataset.registration === id); if (node) { camera.reveal(node); node.focus({ preventScroll: true }); } });
  }
  function focusMount(id) {
    state.scope = id && m.byId.get(id)?.kind === 'mount' ? id : null;
    state.view = 'atlas'; state.query = ''; $('search').value = '';
    state.open.clear(); if (state.scope) state.open.add(state.scope);
    if (state.scope && (!m.byId.has(state.selected) || !inScope(m.byId.get(state.selected)))) { state.selected = state.scope; rememberSelection(state.selected); }
    if (state.selected) m.byId.get(state.selected).mountPath.forEach(mount => state.open.add(mount));
    render(); requestAnimationFrame(() => { camera.setZoom(1); camera.reveal($('graph').querySelector('.node.selected')); ($('breadcrumbs').querySelector('[aria-current]') || $('breadcrumbs').querySelector('button')).focus({ preventScroll: true }); });
  }
  function toggleMount(r) {
    if (state.open.has(r.id)) state.open.delete(r.id); else state.open.add(r.id);
    render(); focusNode(r.id);
  }
  function navigateAtlas(event, r) {
    if (state.view !== 'atlas') return;
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault(); const at = atlasNodes.findIndex(n => n.id === r.id); let target;
    if (event.key === 'ArrowUp') target = atlasNodes[at - 1];
    if (event.key === 'ArrowDown') target = atlasNodes[at + 1];
    if (event.key === 'Home') target = atlasNodes[0];
    if (event.key === 'End') target = atlasNodes.at(-1);
    if (event.key === 'ArrowRight') {
      if (m.children.has(r.id) && !state.query && !state.open.has(r.id) && state.scope !== r.id) { toggleMount(r); return; }
      target = (m.children.get(r.id) || []).find(child => atlasNodes.some(n => n.id === child.id));
    }
    if (event.key === 'ArrowLeft') {
      if (!state.query && state.open.has(r.id) && state.scope !== r.id) { toggleMount(r); return; }
      target = m.byId.get(r.mountPath.at(-1));
    }
    if (target) { choose(target.id); focusNode(target.id); }
  }
  function title(r) { return '#' + r.order + ' ' + m.label(r); }
  function sourceText(source) {
    return source?.state === 'available' ? source.value.file + ':' + source.value.start.line + ':' + source.value.start.column : 'Source unavailable · ' + (source?.reason || 'not-recorded');
  }
  function controlText(r) {
    const c = r.control;
    if (c?.state !== 'available') return 'Control not recorded';
    return [c.value.normal && 'may continue', c.value.error && 'may transfer error', c.value.terminal && 'may terminate', c.value.eligibility && 'eligibility gate'].filter(Boolean).join(' · ') || 'No recorded outcome';
  }
  function node({ x, y, name, meta, tag, kind = '', selected = false, action, id }) {
    const b = button('', action || (() => {}), 'node ' + kind + (selected ? ' selected' : ''));
    b.style.left = x + 'px'; b.style.top = y + 'px';
    b.title = [name, meta, tag].filter(Boolean).join(' · ');
    b.setAttribute('aria-label', b.title); if (id) b.dataset.registration = id;
    if (tag) b.append(el('span', 'tag', tag));
    b.append(el('span', 'name', name), el('span', 'meta', meta));
    $('graph').append(b); return b;
  }
  function registrationNode(r, x, y) {
    const b = node({ x, y, name: title(r), meta: m.match(r), tag: r.kind, kind: r.kind, selected: r.id === state.selected, id: r.id, action: () => { choose(r.id); focusNode(r.id); } });
    b.addEventListener('keydown', event => navigateAtlas(event, r)); return b;
  }
  let svg;
  function begin(width, height) {
    $('graph').replaceChildren(); $('graph').style.width = width + 'px'; $('graph').style.height = height + 'px';
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', width); svg.setAttribute('height', height); svg.classList.add('wires'); svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(svg.namespaceURI, 'defs'), marker = document.createElementNS(svg.namespaceURI, 'marker'), arrow = document.createElementNS(svg.namespaceURI, 'path');
    for (const [k, v] of Object.entries({ id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' })) marker.setAttribute(k, v);
    arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); arrow.setAttribute('fill', '#829abe'); marker.append(arrow); defs.append(marker); svg.append(defs); $('graph').append(svg);
  }
  function wire(from, to, kind, label, arrow = false) {
    const p = document.createElementNS(svg.namespaceURI, 'path'), mid = (from.x + to.x) / 2;
    p.setAttribute('d', `M ${from.x} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x} ${to.y}`); p.setAttribute('class', 'wire ' + kind);
    if (arrow) p.setAttribute('marker-end', 'url(#arrow)'); svg.append(p);
    if (label) { const t = document.createElementNS(svg.namespaceURI, 'text'); t.setAttribute('x', mid); t.setAttribute('y', (from.y + to.y) / 2 - 7); t.setAttribute('text-anchor', 'middle'); t.setAttribute('class', 'edge-label'); t.textContent = label; svg.append(t); }
  }
  function column(text, x, y = 16) { const e = el('div', 'column-label', text); e.style.left = x + 'px'; e.style.top = y + 'px'; $('graph').append(e); }
  function legend(labels) { $('legend').replaceChildren(...labels.map(text => el('span', '', text))); }
  function atlas() {
    const layout = PulseGraph.atlasLayout(m, { scope: state.scope, open: state.open, query: state.query });
    const { placements, edges } = layout;
    atlasNodes = placements.filter(p => p.r).map(p => p.r).sort((a, b) => a.order - b.order);
    const selected = m.byId.get(state.selected), branch = selected?.kind === 'mount' ? selected.id : selected?.mountPath.at(-1);
    const focus = button('Focus subrouter', () => focusMount(branch)); focus.id = 'focus-branch'; focus.disabled = !branch || branch === state.scope;
    const expand = button('Open one level', () => {
      const closed = placements.filter(p => p.r && p.kids.length && !p.expanded), depth = Math.min(...closed.map(p => p.depth));
      closed.filter(p => p.depth === depth).forEach(p => state.open.add(p.r.id)); render();
    }); expand.id = 'expand-level'; expand.disabled = !!state.query || !placements.some(p => p.r && p.kids.length && !p.expanded);
    const collapse = button('Collapse mounts', () => { state.open.clear(); render(); }); collapse.disabled = !!state.query;
    $('view-controls').append(focus, expand, collapse, el('span', 'hint', state.query ? layout.matches.length + ' matches in this scope' : 'Select for evidence · + expands a mount'));
    begin(layout.width, layout.height);
    const ancestry = new Set([state.selected, ...(selected?.mountPath || [])]);
    edges.forEach(([a, b]) => wire({ x: a.x + 220, y: a.y + 29 }, { x: b.x, y: b.y + 29 }, 'child' + (ancestry.has(b.r?.id) ? ' selected-path' : '')));
    for (const p of placements) {
      if (!p.r) { node({ x: p.x, y: p.y, name: capsule.application.name, meta: 'Application · root registrations', kind: 'root', tag: 'ROOT', action: () => focusMount(null) }); continue; }
      const b = registrationNode(p.r, p.x, p.y);
      if (p.r.id !== state.selected && ancestry.has(p.r.id)) b.classList.add('ancestor');
      b.setAttribute('aria-pressed', String(p.r.id === state.selected));
      if (state.query && !m.search(p.r, state.query)) b.classList.add('dim');
      if (p.r.kind === 'mount') {
        b.setAttribute('aria-expanded', String(p.expanded));
        const count = m.registrations.filter(r => r.mountPath.includes(p.r.id)).length;
        b.append(el('span', 'node-count', count + ' contained registrations'));
      }
      if (p.kids.length && p.r.id !== state.scope) {
        const expand = button(p.expanded ? '−' : '+', () => toggleMount(p.r), 'expand');
        expand.style.left = p.x + 208 + 'px'; expand.style.top = p.y + 46 + 'px'; expand.setAttribute('aria-label', (p.expanded ? 'Collapse ' : 'Expand ') + m.label(p.r)); expand.setAttribute('aria-expanded', String(p.expanded)); expand.disabled = !!state.query; $('graph').append(expand);
      }
    }
    const nodes = [...$('graph').querySelectorAll('[data-registration]')], tabstop = nodes.find(n => n.dataset.registration === state.selected) || nodes[0];
    nodes.forEach(n => { n.tabIndex = n === tabstop ? 0 : -1; });
    if (state.query && !layout.matches.length) $('graph').append(el('p', 'empty', 'No registrations match this search in the current scope. Clear search or return to Application.'));
    $('scope-status').textContent = atlasNodes.length + ' nodes shown · ' + m.registrations.filter(inScope).length + ' registrations in scope';
    legend(['Route / method registration', 'Middleware', 'Mount containment · bright path = selected ancestry']);
  }
  function lanes() {
    const focus = m.byId.get(state.selected); if (!focus) return empty('Select a registration in the table.');
    const n = m.neighbors(focus.id), left = [...new Set(n.incoming.map(e => e.from))].map(id => m.byId.get(id)), right = [...new Set(n.outgoing.map(e => e.to))].map(id => m.byId.get(id));
    const points = new Map(); let top = 55; const bands = [];
    for (const lane of ['normal', 'error', 'event']) {
      const groups = [left.filter(r => m.lane(r) === lane), m.lane(focus) === lane ? [focus] : [], right.filter(r => m.lane(r) === lane)];
      const count = Math.max(1, ...groups.map(g => g.length)); bands.push({ lane, top });
      groups.forEach((list, col) => list.forEach((r, i) => points.set(col + ':' + r.id, { r, x: 30 + col * 310, y: top + 35 + i * 82 })));
      top += count * 82 + 65;
    }
    begin(920, top);
    ['Incoming references', 'Selected registration', 'Outgoing references'].forEach((t, i) => column(t, 30 + i * 310));
    bands.forEach(b => { const e = el('div', 'lane-band', b.lane.toUpperCase() + ' LANE'); e.style.top = b.top + 'px'; $('graph').append(e); });
    const focusPoint = points.get('1:' + focus.id), labels = { next: 'next candidate', child: 'child entry', parentContinue: 'parent return' };
    function link(a, b, kind, offset) { wire({ x: a.x + 220, y: a.y + 29 + offset }, { x: b.x, y: b.y + 29 + offset }, kind, labels[kind], true); }
    function links(edges, incoming) {
      edges.forEach(e => { const peers = edges.filter(other => other.from === e.from && other.to === e.to), offset = (peers.indexOf(e) - (peers.length - 1) / 2) * 24;
        link(incoming ? points.get('0:' + e.from) : focusPoint, incoming ? focusPoint : points.get('2:' + e.to), e.kind, offset); });
    }
    links(n.incoming, true); links(n.outgoing, false);
    points.forEach(p => registrationNode(p.r, p.x, p.y));
    const note = el('span', 'hint', controlText(focus) + '. A terminal outcome stops matched execution even if a next-candidate link exists.'); $('view-controls').append(note);
    if (focus.control?.value?.error) $('explanation').append(el('p', '', 'An explicit error transfer is possible. No error-target edge is invented here: only retained next, child and parent-return links are drawn.'));
    legend(['Dashed: next candidate', 'Dotted: parent return', 'Solid: child entry']);
  }
  function groupLabel(key) {
    if (key.startsWith('binding:')) { const b = m.bindingById.get(key.slice(8)); return 'Binding · ' + (b ? b.kind + ' / ' + b.name : 'unavailable'); }
    if (key.startsWith('cap:')) return 'Capability · ' + key.slice(4);
    return 'Binding resolution · ' + key.slice(11);
  }
  function selectControl(labelText, values, selected, change) {
    const label = el('label', '', labelText), select = el('select'); select.setAttribute('aria-label', labelText);
    for (const [value, text] of values) { const option = el('option', '', text); option.value = value; select.append(option); }
    select.value = selected || ''; select.addEventListener('change', () => change(select.value)); label.append(select); return label;
  }
  function pager(name, count, page, change) {
    const p = el('div', 'pager'), pages = Math.max(1, Math.ceil(count / 8));
    const back = button('←', () => change(page - 1)), next = button('→', () => change(page + 1)); back.disabled = page === 0; next.disabled = page + 1 >= pages;
    back.setAttribute('aria-label', 'Previous ' + name); next.setAttribute('aria-label', 'Next ' + name);
    p.append(back, el('span', '', name + ': ' + (count ? page * 8 + 1 : 0) + '–' + Math.min(count, (page + 1) * 8) + ' of ' + count + ' observed'), next); return p;
  }
  function dependencies() {
    if (!m.uses.length) return empty('Use-site evidence is not available in this snapshot.');
    const keys = [...m.groups.keys()].sort((a, b) => groupLabel(a).localeCompare(groupLabel(b)));
    $('view-controls').append(selectControl('Inspect', keys.map(k => [k, groupLabel(k)]), state.key, key => { state.key = key; state.owner = null; state.ownerPage = state.consumerPage = 0; state.association = null; render(); }));
    const all = m.dependency(state.key), focused = m.dependency(state.key, state.owner);
    if (state.owner) $('view-controls').append(button('All owners ×', () => { state.owner = null; state.consumerPage = 0; state.association = null; render(); }));
    $('view-controls').append(pager('Owners', all.owners.length, state.ownerPage, page => { state.ownerPage = page; render(); }), pager('Consumers', focused.consumers.length, state.consumerPage, page => { state.consumerPage = page; render(); }));
    const owners = all.owners.slice(state.ownerPage * 8, (state.ownerPage + 1) * 8), consumers = focused.consumers.slice(state.consumerPage * 8, (state.consumerPage + 1) * 8);
    begin(940, Math.max(370, Math.max(owners.length, consumers.length) * 80 + 100));
    column('Binding / capability', 30); column('Authored owners · select to focus', 340); column('Contextual consumers · select why', 650);
    const rootY = 100;
    node({ x: 30, y: rootY, name: groupLabel(state.key).split(' · ').slice(1).join(' · '), meta: all.sites.length + ' authored use sites', tag: 'EVIDENCE', kind: 'root' });
    const ownerPoints = new Map();
    owners.forEach((id, i) => { const h = m.definitions.get(id), y = 60 + i * 80; ownerPoints.set(id, y);
      wire({ x: 250, y: rootY + 29 }, { x: 340, y: y + 29 }, 'ownership');
      node({ x: 340, y, name: m.filename(h?.source)?.split('/').at(-1)?.replace(/\.[^.]+$/, '') || h?.name || short(id), meta: (h?.name || 'definition') + ' · ' + sourceText(h?.source), tag: all.sites.filter(u => u.ownerId === id).length + ' sites', selected: state.owner === id, action: () => { state.owner = state.owner === id ? null : id; state.consumerPage = 0; state.association = null; render(); } });
    });
    consumers.forEach((id, i) => { const r = m.byId.get(id), y = 60 + i * 80, rows = focused.rows.filter(a => a.consumerRegistrationId === id);
      const linked = new Set(rows.map(a => m.useById.get(a.useSiteId).ownerId));
      for (const owner of linked) if (ownerPoints.has(owner)) wire({ x: 560, y: ownerPoints.get(owner) + 29 }, { x: 650, y: y + 29 }, 'association');
      node({ x: 650, y, name: title(r), meta: m.match(r), tag: rows.length + ' links', kind: r.kind, selected: r.id === state.selected, id, action: () => { state.association = rows[0]?.id; choose(id); } });
    });
    if (!consumers.length) { const e = el('p', 'empty', 'No contextual consumers retained for this selection. Missing associations do not prove absence of use.'); e.style.position = 'absolute'; e.style.left = '625px'; e.style.top = '65px'; e.style.width = '280px'; $('graph').append(e); }
    const rows = focused.rows.filter(a => a.consumerRegistrationId === state.selected);
    let selected = rows.find(a => a.id === state.association) || rows[0];
    if (selected) {
      state.association = selected.id;
      $('explanation').append(el('h3', '', 'Why this registration is associated'), selectControl('Explanation', rows.map((a, i) => [a.id, (i + 1) + ' · ' + m.useById.get(a.useSiteId).operation + ' · ' + a.lane + ' · ' + (a.conditional === true ? 'conditional candidate' : a.conditional === false ? 'direct ownership' : 'conditionality unknown')]), selected.id, id => { state.association = id; render(); }));
      const use = m.useById.get(selected.useSiteId);
      $('explanation').append(el('p', '', sourceText(use.source)), el('p', '', 'Binding resolution: ' + use.binding.state + ' · association coverage: ' + selected.coverage.status));
      const hops = el('div', 'hops');
      selected.via.forEach((hop, i) => { const r = m.byId.get(hop.id), call = m.a.helperCalls.find(c => c.id === hop.id); const h = call && m.definitions.get(call.calleeId);
        const b = button((i + 1) + ' · ' + (r ? m.label(r) : h?.name || short(hop.id)), () => { if (r) choose(r.id); }, ''); b.append(el('span', '', hop.kind)); b.title = hop.id; if (!r) { b.disabled = true; b.title = JSON.stringify(call || hop); } hops.append(b);
      });
      $('explanation').append(hops);
      const details = el('details'); details.append(el('summary', '', 'Exact association and use-site evidence'), el('pre', 'source', JSON.stringify({ association: selected, useSite: use }, null, 2))); $('explanation').append(details);
    } else $('explanation').append(el('p', '', 'Select a contextual consumer to inspect an exact retained explanation. Pagination changes the visible nodes only; all evidence remains in the export.'));
    legend(['Dashed: contextual association', 'Solid: authored ownership', 'Counts describe evidence, not calls']);
  }
  function empty(text) { begin(800, 320); $('graph').append(el('p', 'empty', text)); }
  function details() {
    const panel = $('details'); panel.replaceChildren(); const r = m.byId.get(state.selected);
    if (!r) { panel.append(el('p', '', 'Select a registration to inspect its authored evidence.')); return; }
    const h = m.definitions.get(r.handlerId), intro = el('div'); intro.append(el('div', 'eyebrow', 'SELECTED / #' + r.order), el('h2', '', m.label(r)), el('span', 'badge', r.kind), el('p', 'source', m.match(r)));
    const evidence = el('div'); evidence.append(el('h3', '', 'Control facts'), el('p', 'source', controlText(r)), el('h3', '', 'Registration source'), el('p', 'source', sourceText(r.source)));
    if (h) {
      evidence.append(el('h3', '', 'Authored definition'), el('p', '', h.name + ' · ' + h.kind), el('p', 'source', sourceText(h.source)), el('span', 'badge', (m.instances.get(h.id)?.length || 0) + ' registration instances'));
      for (const instance of m.instances.get(h.id) || []) if (instance.id !== r.id) evidence.append(button('↗ ' + title(instance), () => choose(instance.id), 'link'));
    } else evidence.append(el('p', 'source', 'Routing structure · no authored handler identity.'));
    evidence.append(el('h3', '', 'Mount ancestry'));
    if (!r.mountPath.length) evidence.append(el('p', 'source', 'Application root'));
    r.mountPath.forEach(id => evidence.append(button('↗ ' + title(m.byId.get(id)), () => choose(id), 'link')));
    const branch = r.kind === 'mount' ? r.id : r.mountPath.at(-1);
    if (branch) evidence.append(button(r.kind === 'mount' ? 'Focus this subrouter →' : 'Focus owning subrouter →', () => focusMount(branch), 'link'));
    evidence.append(button('Follow retained links →', () => { state.view = 'lanes'; render(); }, 'link'));
    const raw = el('details'); raw.append(el('summary', '', 'Identity, spans & retained facts'), el('pre', '', JSON.stringify({ registration: r, definition: h || null }, null, 2)));
    evidence.append(raw); panel.append(intro, evidence);
  }
  function table() {
    const rows = m.registrations.filter(r => m.search(r, state.query) && (state.view !== 'atlas' || inScope(r))); $('table-count').textContent = rows.length + ' / ' + m.registrations.length + ' observed'; $('rows').replaceChildren();
    for (const r of rows) {
      const row = el('tr', r.id === state.selected ? 'active' : ''); const h = m.definitions.get(r.handlerId), name = el('td');
      const select = button(m.label(r), () => { choose(r.id, false); requestAnimationFrame(() => { const b = [...$('rows').querySelectorAll('[data-table-registration]')].find(n => n.dataset.tableRegistration === r.id); b?.focus({ preventScroll: true }); }); });
      select.dataset.tableRegistration = r.id; name.append(select, el('small', '', r.kind));
      row.append(el('td', '', '#' + r.order), name, el('td', '', m.match(r)), el('td', 'source', h ? h.name + ' · ' + sourceText(h.source) : sourceText(r.source)), el('td', '', controlText(r))); $('rows').append(row);
    }
    if (!rows.length) { const row = el('tr'), cell = el('td', '', m.a ? 'No registrations match this search.' : 'Registration analytics not recorded in this snapshot.'); cell.colSpan = 5; row.append(cell); $('rows').append(row); }
  }
  function zoom(delta) { camera.setZoom(delta === null ? 1 : state.zoom + delta); }
  function selectedRegistrationNode() { return [...$('graph').querySelectorAll('[data-registration]')].find(n => n.dataset.registration === state.selected); }
  function revealSelection() { camera.reveal(selectedRegistrationNode() || $('graph').querySelector('.node.selected')); }
  window.addEventListener('resize', () => requestAnimationFrame(revealSelection));
  function navigation() {
    $('selection-back').disabled = history.position <= 0;
    $('selection-forward').disabled = history.position >= history.ids.length - 1;
    const crumbs = $('breadcrumbs'); crumbs.replaceChildren(button('Application', () => focusMount(null)));
    if (state.scope) for (const id of [...m.byId.get(state.scope).mountPath, state.scope]) {
      crumbs.append(el('span', '', '/')); const b = button(m.label(m.byId.get(id)), () => focusMount(id));
      if (id === state.scope) b.setAttribute('aria-current', 'location'); crumbs.append(b);
    }
    $('scope-status').textContent = state.view === 'atlas' ? '' : 'Selection stays linked across views';
  }
  function render() {
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    $('view-title').textContent = descriptions[state.view][0]; $('view-description').textContent = descriptions[state.view][1];
    $('view-controls').replaceChildren(); $('explanation').replaceChildren(); $('legend').replaceChildren(); navigation();
    if (!m.a) empty('This historical capsule has no handler analytics. Topology and dependencies are not recorded; they are not empty or zero.');
    else ({ atlas, lanes, dependencies })[state.view]();
    details(); table(); camera.refresh(); requestAnimationFrame(revealSelection);
  }
  $('title').textContent = capsule.application.name + ' / Execution atlas';
  const stats = [['routes', capsule.routes.length], ['registrations', m.a ? m.registrations.length : '—'], ['definitions', m.a ? m.handlers.length : '—'], ['mounts', m.a ? m.registrations.filter(r => r.kind === 'mount').length : '—']];
  stats.forEach(([name, count]) => { const s = el('div', 'stat'); s.append(el('strong', '', String(count)), el('span', '', name + ' observed')); $('stats').append(s); });
  const coverage = m.a?.coverage.associations; $('coverage').textContent = coverage ? 'Associations: ' + coverage.status + (coverage.reason ? ' · ' + coverage.reason : '') : 'Analytics not recorded';
  const grid = el('div', 'coverage-grid');
  for (const [kind, c] of Object.entries(m.a?.coverage || {})) { const cell = el('div'); cell.append(el('strong', '', kind + ' · ' + c.status), el('p', '', c.observed + ' observed / ' + (c.expected === null ? 'unknown expected' : c.expected + ' expected')), el('p', '', c.reason || 'Complete within the retained static basis')); grid.append(cell); }
  $('provenance').append(grid, el('p', '', 'Capsule hash: ' + capsule.evidenceHash.value), el('p', '', 'Artifact: ' + capsule.context.primaryArtifactId), el('p', '', 'Toolchain and recipe: ' + JSON.stringify(capsule.provenance.recipe)));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));
  $('search').addEventListener('input', () => { state.query = $('search').value.trim(); render(); });
  $('selection-back').addEventListener('click', () => { if (history.position > 0) { state.query = ''; $('search').value = ''; choose(history.ids[--history.position], true, false); } });
  $('selection-forward').addEventListener('click', () => { if (history.position < history.ids.length - 1) { state.query = ''; $('search').value = ''; choose(history.ids[++history.position], true, false); } });
  $('fit-graph').addEventListener('click', () => camera.fit());
  $('center-selection').addEventListener('click', () => {
    if (!state.selected) return;
    state.query = ''; $('search').value = '';
    if (!selectedRegistrationNode()) state.view = 'atlas';
    choose(state.selected); requestAnimationFrame(() => camera.center(selectedRegistrationNode()));
  });
  $('zoom-in').addEventListener('click', () => zoom(.1)); $('zoom-out').addEventListener('click', () => zoom(-.1)); $('zoom-reset').addEventListener('click', () => zoom(null));
  $('export').addEventListener('click', () => { const blob = new Blob([JSON.stringify(capsule)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = 'pulse-report-evidence.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  render();
})();
