'use strict';

const { lifecyclePlanner } = require('@pulse-compute/wasm-contracts/provider/toolchain');
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const types = new Set(['i32', 'u32', 'i64', 'u64', 'f32', 'f64', 'bool', 'usize', 'isize', 'string']);
function invalid(message) { throw Object.assign(new TypeError(message), { code: 'PULSEWASM_LIFECYCLE_EMISSION_INVALID' }); }

// Trusted driver-style emission, separate from semantic planning. No source
// matching: owners request a site at the point where they construct a template.
function createLifecycleEmitter({ bindings, contributions, implementations, values, actions }) {
  const plan = lifecyclePlanner.createPlan({ bindings, contributions });
  if (!Array.isArray(implementations)) invalid('Lifecycle implementations must be a list.');
  const implementation = new Map();
  for (const item of implementations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => !['point', 'owner', 'body', 'before', 'after'].includes(key))) invalid('Invalid lifecycle implementation record.');
    const key = `${item.point}\0${item.owner}`;
    if (implementation.has(key)) invalid('Duplicate lifecycle implementation.');
    implementation.set(key, item);
  }
  const used = new Set(), functions = [], dispatchers = new Map(), visited = new Set();
  const sites = new Map(plan.sites.map(site => [site.id, site]));
  const declaredSites = new Set(bindings.sites.map(site => site.id));
  const symbol = name => '__pulse_lifecycle_' + name.replaceAll('.', '_');
  function parameters(point, after = false) {
    return [...point.parameters, ...(after ? point.afterParameters : [])].map(({ role, binding }) => {
      const value = values?.[binding];
      if (!value || !identifier.test(value.name) || !types.has(value.type)) invalid('Lifecycle value needs a concrete local identifier and supported AS type.');
      return { role, ...value };
    });
  }
  const formals = params => params.map(p => `${p.role}: ${p.type}`).join(', ');
  const args = params => params.map(p => p.role).join(', ');
  for (const site of plan.sites) for (const point of site.points) {
    const params = parameters(point), afterParams = parameters(point, true);
    const signature = formals(afterParams);
    if (dispatchers.has(point.point)) {
      if (dispatchers.get(point.point) !== signature) invalid('Lifecycle sites disagree on semantic role types.');
      continue;
    }
    dispatchers.set(point.point, signature);
    const around = point.kind === 'around', name = symbol(point.point);
    const call = (index, phase = '', p = params) => `${name}_${index}${phase}(${args(p)})`;
    point.contributions.forEach((item, index) => {
      const key = `${point.point}\0${item.owner}`, body = implementation.get(key);
      if (!body) invalid('Missing lifecycle implementation.');
      used.add(key);
      const fields = around ? ['before', 'after'] : ['body'];
      if (['body', 'before', 'after'].some(field => !fields.includes(field) && Object.hasOwn(body, field))) invalid('Lifecycle implementation phase does not match its point.');
      for (const field of fields) {
        if (typeof body[field] !== 'string' || /\b(?:import|export)\b/.test(body[field])) invalid('Lifecycle bodies must be trusted function bodies without imports or exports.');
        const suffix = around ? '_' + field : '';
        functions.push(`function ${name}_${index}${suffix}(${formals(field === 'after' ? afterParams : params)}): ${point.composition.result === 'boolean' ? 'bool' : 'void'} {\n${body[field]}\n}`);
      }
    });
    const indices = point.contributions.map((_, index) => index);
    if (around) {
      functions.push(`function ${name}_before(${formals(params)}): void { ${indices.map(i => call(i, '_before') + ';').join(' ')} }`);
      functions.push(`function ${name}_after(${formals(afterParams)}): void { ${[...indices].reverse().map(i => call(i, '_after', afterParams) + ';').join(' ')} }`);
    } else {
      const dispatch = point.composition.dispatch;
      const body = indices.map(i => dispatch === 'all' ? call(i) + ';' : dispatch === 'all-true' ? `if (!${call(i)}) return false;` : `if (${call(i)}) return true;`).join(' ');
      functions.push(`function ${name}(${formals(params)}): ${point.composition.result === 'boolean' ? 'bool' : 'void'} { ${body}${dispatch === 'all-true' ? ' return true' : dispatch === 'first-true' ? ' return false' : ''} }`);
    }
  }
  if ([...implementation.keys()].some(key => !used.has(key))) invalid('Unselected lifecycle implementation.');
  // Validate actions even before their sites are emitted. They remain provider
  // source, never shared semantic postconditions or status-code interpretation.
  for (const site of plan.sites) for (const point of site.points) for (const action of [point.reject, point.onClaim].filter(Boolean)) {
    if (typeof actions?.[action] !== 'string' || !actions[action].trim()) invalid('Missing lifecycle action realization.');
  }
  function site(id, expression) {
    if (!declaredSites.has(id)) invalid('Unknown structural lifecycle site.');
    visited.add(id);
    const selected = sites.get(id);
    if (!selected) return expression === undefined ? '' : `return ${expression}`;
    const lines = [];
    for (const point of selected.points) {
      const name = symbol(point.point), p = parameters(point), arg = p.map(item => item.name).join(', ');
      if (point.kind === 'around') {
        if (typeof expression !== 'string' || !expression || selected.points.length !== 1) invalid('Around lifecycle site requires one delivery expression.');
        const accepted = parameters(point, true).at(-1);
        lines.push(`${name}_before(${arg});`, `const ${accepted.name}: ${accepted.type} = ${expression};`, `${name}_after(${parameters(point, true).map(item => item.name).join(', ')});`, `return ${accepted.name}`);
      } else {
        if (expression !== undefined) invalid('Only around lifecycle sites accept delivery expressions.');
        const call = `${name}(${arg})`;
        lines.push(point.reject ? `if (!${call}) ${actions[point.reject]}` : point.onClaim ? `if (${call}) ${actions[point.onClaim]}` : `${call};`);
      }
    }
    return lines.join('\n');
  }
  return Object.freeze({ plan, site, source: functions.join('\n'), active: plan.sites.length > 0,
    assertSites() { for (const id of sites.keys()) if (!visited.has(id)) invalid(`Active lifecycle site was not emitted: ${id}`); }
  });
}
module.exports = Object.freeze({ createLifecycleEmitter });
