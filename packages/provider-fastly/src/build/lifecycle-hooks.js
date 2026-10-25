'use strict';

// Fastly Native bindings and emission for the shared execution/HTTP lifecycle contracts.
//
// The driver (this table) is the only owner of the generated text that marks a
// lifecycle position. Provider services contribute typed function bodies to a
// named point; they never match or rewrite driver text themselves. Each point
// binds shared parameter roles and composition rules to concrete sites and
// rejection actions. With no contributions the driver source is returned
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

const { executionLifecycle, httpLifecycle } = require('@pulse-compute/wasm-contracts/provider/toolchain');
if (executionLifecycle.VERSION !== 'pulse.execution-lifecycle.v1' || httpLifecycle.VERSION !== 'pulse.http-lifecycle.v1')
  throw hookError('Fastly lifecycle bindings require the reviewed execution and HTTP contract versions.');
const { KINDS, COMPOSITION } = executionLifecycle;
const semantics = Object.freeze({ ...executionLifecycle.POINTS, ...httpLifecycle.POINTS });

// sites[].at: 'enter' inserts the call immediately after the anchor text (the
// anchor is a function signature or a statement); 'before' inserts it on the
// line above the anchor; 'wrap' replaces the anchor with a composed form.
const BINDINGS = Object.freeze({
  'request.acquired': Object.freeze({
    params: {},
    sites: [{ anchor: '  __pulse_fastly_request_body_handle = load<i32>(changetype<usize>(handles) + 4)\n', at: 'enter-line' }]
  }),
  'effect.settle': Object.freeze({
    params: { effect: ['index', 'i32'], ticket: ['ticket', 'i32'], result: ['result', 'i32'] },
    sites: [{ anchor: 'function __pulse_invocation_settle(index: i32, ticket: i32, result: i32): i32 {', at: 'enter', reject: 'return 0' }]
  }),
  'effect.deliver': Object.freeze({
    params: { effect: ['index', 'i32'], result: ['result', 'i32'] }, afterParams: { accepted: ['accepted', 'i32'] },
    sites: [{ anchor: 'return pulse_set_effect_result(index, result)', at: 'wrap' }]
  }),
  'effect.result': Object.freeze({
    params: { effect: ['effectIndex', 'i32'], result: ['handle', 'i32'] },
    sites: [{ anchor: 'export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {', at: 'enter', reject: 'return 0' }]
  }),
  'invocation.close': Object.freeze({
    params: {},
    sites: [{ anchor: 'function __pulse_invocation_close(): void {', at: 'enter' }]
  }),
  'invocation.end': Object.freeze({
    params: {},
    sites: [{ anchor: '  __pulse_fastly_run_invocation()\n', at: 'enter-line' }]
  }),
  'invocation.closed': Object.freeze({
    params: {},
    sites: [{ anchor: '  __pulse_invocation_close()\n', at: 'enter-line' }]
  }),
  'response.error': Object.freeze({
    params: {},
    sites: [{ anchor: 'function __pulse_fastly_jwt_send_error(): void {', at: 'enter', onClaim: 'return;' }]
  }),
  'response.authority': Object.freeze({
    params: {},
    sites: [
      { anchor: 'function __request_send_timeout(): void {', at: 'enter', reject: 'return;', feature: 'requestBudget' },
      { anchor: 'function __pulse_fastly_jwt_send_error(): void {', at: 'enter', reject: 'return;' },
      { anchor: 'function __pulse_fastly_send_result(handle: i32): i32 {', at: 'enter',
        reject: '{ __pulse_fastly_fail(PULSE_ERROR_STATE, 282, -1); return PULSE_ERROR_STATE; }' }
    ]
  }),
  'result.claim': Object.freeze({
    params: { result: ['result', 'i32'] },
    sites: [{ anchor: '  __pulse_fastly_jwt_attach_evidence(result)', at: 'before', onClaim: 'return' }]
  })
});

const POINTS = bindPoints(BINDINGS);

function hookError(message, detail) {
  const error = new Error(message);
  error.code = 'PULSE_FASTLY_LIFECYCLE_HOOK_INVALID';
  error.detail = Object.freeze(detail || {});
  return error;
}

const symbol = point => '__pulse_hook_' + point.replace(/\./g, '_');
const paramList = params => params.map(([name, type]) => `${name}: ${type}`).join(', ');
const argList = params => params.map(([name]) => name).join(', ');

// Map semantic roles to concrete local names/types. Shared contracts never need
// to know AssemblyScript, driver signatures, anchor order or diagnostic stages.
function bindPoints(bindings) {
  const bound = {};
  function parameters(roles, values = {}, point) {
    if (Object.keys(values).length !== roles.length || roles.some(role => !Object.hasOwn(values, role)))
      throw hookError('Lifecycle binding must realize every semantic parameter role exactly once.', { point });
    return Object.freeze(roles.map(role => {
      const value = values[role];
      if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'string' || !v.length))
        throw hookError('Lifecycle parameter binding requires a local name and type.', { point, role });
      return Object.freeze([...value]);
    }));
  }
  for (const [name, binding] of Object.entries(bindings)) {
    if (!Object.hasOwn(semantics, name)) throw hookError('Unknown lifecycle binding point.', { point: name });
    const semantic = semantics[name];
    if (Object.hasOwn(binding, 'kind') || Object.hasOwn(binding, 'doc'))
      throw hookError('Lifecycle bindings cannot override shared semantics.', { point: name });
    bound[name] = Object.freeze({ ...semantic,
      params: parameters(semantic.parameters, binding.params, name),
      afterParams: parameters(semantic.afterParameters || [], binding.afterParams, name),
      sites: Object.freeze(binding.sites.map(site => Object.freeze({ ...site })))
    });
  }
  // Entry insertion reverses table order at a shared anchor. Realize the HTTP
  // contract's outer fence explicitly, instead of silently depending on order.
  const names = Object.keys(bound);
  for (const [name, point] of Object.entries(bound)) for (const inner of point.dominates || []) {
    if (bound[inner] && point.sites.some(site => bound[inner].sites.some(other => site.anchor === other.anchor))
      && names.indexOf(name) <= names.indexOf(inner))
      throw hookError('Lifecycle binding order violates the shared authority fence.', { point: name, inner });
  }
  return Object.freeze(bound);
}

function validate(contributions) {
  const ordered = executionLifecycle.orderedContributions(contributions, POINTS, hookError);
  for (const item of ordered) {
    const point = POINTS[item.point];
    const bodies = COMPOSITION[point.kind].dispatch === 'around' ? ['before', 'after'] : ['body'];
    for (const field of bodies) {
      if (typeof item[field] !== 'string') throw hookError(`Lifecycle hook ${point.kind} contribution requires ${field}.`, { point: item.point, owner: item.owner });
      // Trusted provider source, not a source sandbox. Module-shape checks and
      // emission remain here; shared metadata does not require source bodies.
      if (/\b(?:import|export)\b/.test(item[field])) throw hookError('Lifecycle hook bodies cannot import or export.', { point: item.point, owner: item.owner });
    }
  }
  return ordered;
}

// Emit one function per contribution (parameters and module globals, not caller locals)
// and one dispatcher per point that applies the point's composition rule.
function functions(name, point, items) {
  const lines = [];
  const p = point.params;
  const rule = COMPOSITION[point.kind];
  items.forEach((item, n) => {
    const fn = `${symbol(name)}_${n}`;
    if (rule.dispatch === 'around') {
      lines.push(`function ${fn}_before(${paramList(p)}): void {\n${item.before}\n}`);
      lines.push(`function ${fn}_after(${paramList([...p, ...point.afterParams])}): void {\n${item.after}\n}`);
    } else {
      const result = rule.result === 'void' ? 'void' : 'bool';
      lines.push(`function ${fn}(${paramList(p)}): ${result} {\n${item.body}\n}`);
    }
  });
  const call = (n, suffix = '', params = p) => `${symbol(name)}_${n}${suffix}(${argList(params)})`;
  const all = items.map((_, n) => n);
  const d = symbol(name);
  if (rule.dispatch === 'all') lines.push(`function ${d}(${paramList(p)}): void { ${all.map(n => call(n) + ';').join(' ')} }`);
  if (rule.dispatch === 'all-true') lines.push(`function ${d}(${paramList(p)}): bool { ${all.map(n => `if (!${call(n)}) return false;`).join(' ')} return true }`);
  if (rule.dispatch === 'first-true') lines.push(`function ${d}(${paramList(p)}): bool { ${all.map(n => `if (${call(n)}) return true;`).join(' ')} return false }`);
  if (rule.dispatch === 'around') {
    const after = [...p, ...point.afterParams];
    lines.push(`function ${d}_before(${paramList(p)}): void { ${all.map(n => call(n, '_before') + ';').join(' ')} }`);
    // Reverse normal-return notifications. A trap skips these; this is not finally.
    const afterOrder = rule.afterOrder === 'descending' ? [...all].reverse() : all;
    lines.push(`function ${d}_after(${paramList(after)}): void { ${afterOrder.map(n => call(n, '_after', after) + ';').join(' ')} }`);
  }
  return lines.join('\n');
}

function siteCall(name, point, site) {
  const d = symbol(name);
  const args = argList(point.params);
  if (COMPOSITION[point.kind].dispatch === 'all') return `${d}(${args})`;
  if (COMPOSITION[point.kind].dispatch === 'all-true') return `if (!${d}(${args})) ${site.reject}`;
  if (COMPOSITION[point.kind].dispatch === 'first-true') return `if (${d}(${args})) ${site.onClaim}`;
  throw hookError(`No call form for ${point.kind} at ${name}.`);
}

function occurrences(source, anchor) {
  let count = 0, at = source.indexOf(anchor);
  while (at >= 0) { count++; at = source.indexOf(anchor, at + anchor.length); }
  return count;
}

function compose(source, contributions = [], features = {}) {
  const ordered = validate(contributions);
  const record = [];
  if (!contributions.length) return { source, record };
  const byPoint = new Map();
  for (const item of ordered) {
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

module.exports = Object.freeze({ KINDS, POINTS, BINDINGS, bindPoints, compose, describe, validate });
