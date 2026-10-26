'use strict';

const { executionLifecycle, lifecyclePlanner } = require('@pulse-compute/wasm-contracts/provider/toolchain');
const { isAsyncFunction, isGeneratorFunction } = require('node:util').types;

function invalid(message) {
  throw Object.assign(new TypeError(message), { code: 'PULSEWASM_LIFECYCLE_ADAPTER_INVALID' });
}

// Trusted, synchronous host services. This is not application configuration,
// package registration, a scheduler or a sandbox for callbacks.
function createNativeExecutionLifecycle(services = []) {
  if (!Array.isArray(services)) invalid('Native lifecycle services must be a list.');
  if (services.length === 0 && Reflect.ownKeys(services).length === 1) return undefined;
  const implementations = new Map();
  const contributions = services.map(service => {
    if (!service || ![Object.prototype, null].includes(Object.getPrototypeOf(service))) invalid('Invalid lifecycle service.');
    for (const key of Reflect.ownKeys(service)) {
      if (!['point', 'owner', 'order', 'run', 'before', 'after'].includes(key)
        || !Object.hasOwn(Object.getOwnPropertyDescriptor(service, key), 'value')) invalid('Invalid lifecycle service field.');
    }
    const semantic = executionLifecycle.POINTS[service.point];
    if (!semantic) invalid('Native host driver binds execution lifecycle only; HTTP send authority is not bound.');
    const phases = semantic.kind === 'around' ? ['before', 'after'] : ['run'];
    for (const phase of ['run', 'before', 'after']) {
      if (phases.includes(phase)) {
        if (typeof service[phase] !== 'function' || isAsyncFunction(service[phase]) || isGeneratorFunction(service[phase])) invalid('Lifecycle services must be synchronous functions.');
      } else if (Object.hasOwn(service, phase)) invalid('Lifecycle service phase does not match its point.');
    }
    implementations.set(`${service.point}\0${service.owner}`, Object.fromEntries(phases.map(phase => [phase, service[phase]])));
    return { point: service.point, owner: service.owner, order: service.order };
  });
  const plan = lifecyclePlanner.createPlan({
    bindings: { version: lifecyclePlanner.BINDINGS_VERSION, executionVersion: executionLifecycle.VERSION,
      sites: Object.entries(executionLifecycle.POINTS).map(([point, semantic]) => ({ id: point, points: [{
        point, parameters: Object.fromEntries(semantic.parameters.map(role => [role, `host.${role}`])),
        ...(semantic.kind === 'around' ? { afterParameters: { accepted: 'host.accepted' } } : {}),
        ...(semantic.kind === 'guard' ? { reject: 'reject-delivery' } : {})
      }] })) }, contributions
  });
  if (!plan.sites.length) return undefined;
  const points = new Map(plan.sites.map(site => [site.id, site.points[0]]));
  function entries(point, kind, after = false) {
    if (executionLifecycle.POINTS[point]?.kind !== kind) invalid('Lifecycle dispatch kind does not match its point.');
    const selected = points.get(point);
    return (selected ? after ? selected.after : selected.contributions : []).map(item => implementations.get(`${point}\0${item.owner}`));
  }
  function call(fn, args, boolean) {
    const result = fn(...args);
    if (result && typeof result.then === 'function') {
      // Reject accidental asynchronous services, including normal functions
      // returning promises, without leaving a rejected promise unobserved.
      Promise.resolve(result).catch(() => {});
      invalid('Lifecycle services must return synchronously.');
    }
    if (boolean ? typeof result !== 'boolean' : result !== undefined) invalid('Invalid lifecycle service return value.');
    return result;
  }
  return Object.freeze({ plan,
    guard(point, ...args) { return entries(point, 'guard').every(item => call(item.run, args, true)); },
    observe(point) { for (const item of entries(point, 'observe')) call(item.run, [], false); },
    around(point, args, deliver) {
      for (const item of entries(point, 'around')) call(item.before, args, false);
      const accepted = deliver();
      for (const item of entries(point, 'around', true)) call(item.after, [...args, accepted], false);
      return accepted;
    }
  });
}
module.exports = Object.freeze({ createNativeExecutionLifecycle });
