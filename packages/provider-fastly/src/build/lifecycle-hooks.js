'use strict';

// Driver-owned lifecycle hook points for the Fastly Native request driver.
//
// The driver (this table) is the only owner of the generated text that marks a
// lifecycle position. Provider services contribute typed function bodies to a
// named point; they never match or rewrite driver text themselves. Each point
// declares its parameters, its composition rule and what every call site does
// when a guard rejects. With no contributions the driver source is returned
// unchanged, so builds that use no hooks are byte-identical by construction.
//
// Hooks are a provider-internal surface. Packages still contribute only ABI
// shims through host-extension realization artifacts; a provider service
// decides which hooks those shims need.
//
// Resolution runs after the legacy instrumenters, so hook calls sit at the very
// top of each hooked function, ahead of any guard a legacy pass inserted there.
// That keeps the current "extension fences dominate" ordering. Migrating the
// legacy instrumenters onto these points removes the need for that rule.

const KINDS = Object.freeze(['observe', 'guard', 'predicate', 'claim', 'around']);

// sites[].at: 'enter' inserts the call immediately after the anchor text (the
// anchor is a function signature or a statement); 'before' inserts it on the
// line above the anchor; 'wrap' replaces the anchor with a composed form.
const POINTS = Object.freeze({
  'request.acquired': Object.freeze({
    kind: 'observe', params: [],
    doc: 'Downstream request and body handles are loaded and owned by the driver.',
    sites: [{ anchor: '  __pulse_fastly_request_body_handle = load<i32>(changetype<usize>(handles) + 4)\n', at: 'enter-line' }]
  }),
  'effect.settle': Object.freeze({
    kind: 'guard', params: [['index', 'i32'], ['ticket', 'i32'], ['result', 'i32']],
    doc: 'A resolved effect result is about to consume its invocation ticket.',
    sites: [{ anchor: 'function __pulse_invocation_settle(index: i32, ticket: i32, result: i32): i32 {', at: 'enter', reject: 'return 0' }]
  }),
  'effect.deliver': Object.freeze({
    kind: 'around', params: [['index', 'i32'], ['result', 'i32']], afterParams: [['accepted', 'i32']],
    doc: 'Continuation hand-off; after() runs only on normal return, including rejection, never on trap.',
    sites: [{ anchor: 'return pulse_set_effect_result(index, result)', at: 'wrap' }]
  }),
  'effect.result': Object.freeze({
    kind: 'guard', params: [['effectIndex', 'i32'], ['handle', 'i32']],
    doc: 'The exported continuation setter is entered (also reachable directly by the host).',
    sites: [{ anchor: 'export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {', at: 'enter', reject: 'return 0' }]
  }),
  'invocation.close': Object.freeze({
    kind: 'observe', params: [],
    doc: 'The invocation closes; outstanding tickets are about to be cleared.',
    sites: [{ anchor: 'function __pulse_invocation_close(): void {', at: 'enter' }]
  }),
  'invocation.end': Object.freeze({
    kind: 'observe', params: [],
    doc: 'Driver run returned normally (including handled failure); not a trap finalizer.',
    sites: [{ anchor: '  __pulse_fastly_run_invocation()\n', at: 'enter-line' }]
  }),
  'invocation.closed': Object.freeze({
    kind: 'observe', params: [],
    doc: 'Driver closure and pending reaping returned normally; not a trap finalizer.',
    sites: [{ anchor: '  __pulse_invocation_close()\n', at: 'enter-line' }]
  }),
  'response.error': Object.freeze({
    kind: 'claim', params: [],
    doc: 'Service-specific error responder, behind the shared authority fence.',
    sites: [{ anchor: 'function __pulse_fastly_jwt_send_error(): void {', at: 'enter', onClaim: 'return;' }]
  }),
  'response.authority': Object.freeze({
    kind: 'predicate', params: [],
    doc: 'Whether the guest still holds downstream response authority. Every responder checks it first.',
    sites: [
      { anchor: 'function __request_send_timeout(): void {', at: 'enter', reject: 'return;', feature: 'requestBudget' },
      { anchor: 'function __pulse_fastly_jwt_send_error(): void {', at: 'enter', reject: 'return;' },
      { anchor: 'function __pulse_fastly_send_result(handle: i32): i32 {', at: 'enter',
        reject: '{ __pulse_fastly_fail(PULSE_ERROR_STATE, 282, -1); return PULSE_ERROR_STATE; }' }
    ]
  }),
  'result.claim': Object.freeze({
    kind: 'claim', params: [['result', 'i32']],
    doc: 'The final result is about to be sent downstream; a claimant completes it instead.',
    sites: [{ anchor: '  __pulse_fastly_jwt_attach_evidence(result)', at: 'before', onClaim: 'return' }]
  })
});

function hookError(message, detail) {
  const error = new Error(message);
  error.code = 'PULSE_FASTLY_LIFECYCLE_HOOK_INVALID';
  error.detail = Object.freeze(detail || {});
  return error;
}

const symbol = point => '__pulse_hook_' + point.replace(/\./g, '_');
const paramList = params => params.map(([name, type]) => `${name}: ${type}`).join(', ');
const argList = params => params.map(([name]) => name).join(', ');

function validate(contributions) {
  if (!Array.isArray(contributions)) throw hookError('Lifecycle hook contributions must be a list.');
  const seen = new Set(), orders = new Map();
  for (const item of contributions) {
    if (!item || typeof item !== 'object') throw hookError('Lifecycle hook contribution must be a record.');
    const point = Object.hasOwn(POINTS, item.point) ? POINTS[item.point] : undefined;
    if (!point) throw hookError(`Unknown lifecycle hook point ${item.point}.`, { point: item.point, owner: item.owner });
    if (typeof item.owner !== 'string' || !/^[a-z0-9][a-z0-9.:-]{0,95}$/.test(item.owner)) throw hookError('Lifecycle hook owner must be a bounded identifier.', { point: item.point });
    if (!Number.isSafeInteger(item.order)) throw hookError('Lifecycle hook contribution requires a safe integer order.', { point: item.point, owner: item.owner });
    const key = item.point + '\0' + item.owner;
    if (seen.has(key)) throw hookError('An owner may contribute to a lifecycle hook point once.', { point: item.point, owner: item.owner });
    seen.add(key);
    const orderKey = item.point + '\0' + item.order;
    if (orders.has(orderKey)) throw hookError('Lifecycle hook contributions on one point need distinct orders.', { point: item.point, owners: [orders.get(orderKey), item.owner] });
    orders.set(orderKey, item.owner);
    const bodies = point.kind === 'around' ? ['before', 'after'] : ['body'];
    for (const field of bodies) {
      if (typeof item[field] !== 'string') throw hookError(`Lifecycle hook ${point.kind} contribution requires ${field}.`, { point: item.point, owner: item.owner });
      // Contributions are trusted provider source; this only keeps the module
      // shape intact and stops a contribution from widening the export surface.
      if (/\b(?:import|export)\b/.test(item[field])) throw hookError('Lifecycle hook bodies cannot import or export.', { point: item.point, owner: item.owner });
    }
  }
}

// Emit one function per contribution (parameters and module globals, not caller locals)
// and one dispatcher per point that applies the point's composition rule.
function functions(name, point, items) {
  const lines = [];
  const p = point.params;
  items.forEach((item, n) => {
    const fn = `${symbol(name)}_${n}`;
    if (point.kind === 'around') {
      lines.push(`function ${fn}_before(${paramList(p)}): void {\n${item.before}\n}`);
      lines.push(`function ${fn}_after(${paramList([...p, ...point.afterParams])}): void {\n${item.after}\n}`);
    } else {
      const result = point.kind === 'observe' ? 'void' : 'bool';
      lines.push(`function ${fn}(${paramList(p)}): ${result} {\n${item.body}\n}`);
    }
  });
  const call = (n, suffix = '', params = p) => `${symbol(name)}_${n}${suffix}(${argList(params)})`;
  const all = items.map((_, n) => n);
  const d = symbol(name);
  if (point.kind === 'observe') lines.push(`function ${d}(${paramList(p)}): void { ${all.map(n => call(n) + ';').join(' ')} }`);
  if (point.kind === 'guard' || point.kind === 'predicate') lines.push(`function ${d}(${paramList(p)}): bool { ${all.map(n => `if (!${call(n)}) return false;`).join(' ')} return true }`);
  if (point.kind === 'claim') lines.push(`function ${d}(${paramList(p)}): bool { ${all.map(n => `if (${call(n)}) return true;`).join(' ')} return false }`);
  if (point.kind === 'around') {
    const after = [...p, ...point.afterParams];
    lines.push(`function ${d}_before(${paramList(p)}): void { ${all.map(n => call(n, '_before') + ';').join(' ')} }`);
    // Reverse normal-return notifications. A trap skips these; this is not finally.
    lines.push(`function ${d}_after(${paramList(after)}): void { ${[...all].reverse().map(n => call(n, '_after', after) + ';').join(' ')} }`);
  }
  return lines.join('\n');
}

function siteCall(name, point, site) {
  const d = symbol(name);
  const args = argList(point.params);
  if (point.kind === 'observe') return `${d}(${args})`;
  if (point.kind === 'guard' || point.kind === 'predicate') return `if (!${d}(${args})) ${site.reject}`;
  if (point.kind === 'claim') return `if (${d}(${args})) ${site.onClaim}`;
  throw hookError(`No call form for ${point.kind} at ${name}.`);
}

function occurrences(source, anchor) {
  let count = 0, at = source.indexOf(anchor);
  while (at >= 0) { count++; at = source.indexOf(anchor, at + anchor.length); }
  return count;
}

function compose(source, contributions = [], features = {}) {
  validate(contributions);
  const record = [];
  if (!contributions.length) return { source, record };
  const byPoint = new Map();
  for (const item of [...contributions].sort((a, b) => a.order - b.order || a.owner.localeCompare(b.owner))) {
    if (!byPoint.has(item.point)) byPoint.set(item.point, []);
    byPoint.get(item.point).push(item);
  }
  let output = source;
  const support = [];
  // Resolve in table order so composition never depends on contribution order.
  for (const [name, point] of Object.entries(POINTS)) {
    const items = byPoint.get(name);
    if (!items) continue;
    const resolved = [];
    for (const site of point.sites) {
      const count = occurrences(output, site.anchor);
      if (site.feature) {
        if (typeof features[site.feature] !== 'boolean') throw hookError(`Lifecycle composition requires explicit ${site.feature} mode.`);
        if (!features[site.feature]) {
          if (count !== 0) throw hookError(`Unexpected lifecycle site for disabled ${site.feature}.`);
          continue;
        }
      }
      if (count !== 1) throw hookError(`Lifecycle hook ${name} anchor must occur exactly once (found ${count}); the driver template drifted.`, { point: name, anchor: site.anchor });
      let replacement;
      if (site.at === 'enter') replacement = `${site.anchor}\n  ${siteCall(name, point, site)}`;
      else if (site.at === 'enter-line') replacement = `${site.anchor}  ${siteCall(name, point, site)}\n`;
      else if (site.at === 'before') replacement = `  ${siteCall(name, point, site)}\n${site.anchor}`;
      else if (site.at === 'wrap') {
        const d = symbol(name), args = argList(point.params);
        replacement = `${d}_before(${args})\n  const accepted = pulse_set_effect_result(${args})\n  ${d}_after(${args}, accepted)\n  return accepted`;
      } else throw hookError(`Unknown site position ${site.at}.`);
      output = output.replace(site.anchor, () => replacement);
      resolved.push(site.anchor.trim().slice(0, 80));
    }
    if (!resolved.length) throw hookError(`Lifecycle hook ${name} has contributions but no site in this driver mode.`, { point: name });
    support.push(functions(name, point, items));
    record.push(Object.freeze({ point: name, kind: point.kind, owners: Object.freeze(items.map(i => i.owner)), sites: Object.freeze(resolved) }));
  }
  output += `\n// Lifecycle hooks (driver-owned points, provider-service contributions)\n${support.join('\n')}\n`;
  return { source: output, record: Object.freeze(record) };
}

function describe() {
  return Object.freeze(Object.entries(POINTS).map(([name, point]) => Object.freeze({
    point: name, kind: point.kind, params: point.params.map(([n, t]) => `${n}: ${t}`), doc: point.doc,
    sites: point.sites.map(site => site.anchor.trim().replace(/\s*\{$/, '').slice(0, 96))
  })));
}

module.exports = Object.freeze({ KINDS, POINTS, compose, describe, validate });
