'use strict';

const { PulseRuntimeContractError } = require('./errors.js');
const { encodeSchemaValue } = require('./schema.js');
const applications = new WeakMap();
const executions = new WeakMap();

function fail(reason) {
  throw new PulseRuntimeContractError('PULSE_CALL_BOUNDARY_INVALID', `Computation call ${reason}.`);
}

// Trusted source realization only: a fixed compiler-selected table, bound once
// to one application. This is not an application-author registration API.
function bindCallableApplication(application, targets, bindings) {
  if ((!application || !['function', 'object'].includes(typeof application)) || applications.has(application)
    || !Array.isArray(targets) || !Array.isArray(bindings) || !bindings.length
    || bindings.length > 16 || targets.length !== bindings.length) fail('binding is invalid');
  const table = new Map();
  let sites = 0;
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i], target = targets[i];
    if (typeof target !== 'function' || table.has(target)
      || typeof binding.inputSchema !== 'string' || !binding.inputSchema
      || typeof binding.outputSchema !== 'string' || !binding.outputSchema
      || !Number.isInteger(binding.maxCalls) || binding.maxCalls < 1
      || !Array.isArray(binding.resources) || binding.resources.some(id => typeof id !== 'string')) fail('target is invalid');
    sites += binding.maxCalls;
    table.set(target, Object.freeze({ inputSchema: binding.inputSchema, outputSchema: binding.outputSchema,
      maxCalls: binding.maxCalls, resources: Object.freeze([...binding.resources]) }));
  }
  if (sites > 16) fail('site limit exceeded');
  applications.set(application, table);
  return application;
}

function readonly(value, execution) {
  if (!value || typeof value !== 'object') return value;
  const copy = Array.isArray(value) ? value.map(item => readonly(item, execution))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readonly(item, execution)]));
  return new Proxy(copy, {
    get(target, key, receiver) { execution.checkOpen(); return Reflect.get(target, key, receiver); },
    has(target, key) { execution.checkOpen(); return Reflect.has(target, key); },
    ownKeys(target) { execution.checkOpen(); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { execution.checkOpen(); return Reflect.getOwnPropertyDescriptor(target, key); },
    set() { fail('input is readonly'); }, deleteProperty() { fail('input is readonly'); },
    defineProperty() { fail('input is readonly'); }, setPrototypeOf() { fail('input is readonly'); },
    preventExtensions() { fail('input is readonly'); }
  });
}

function createCallBoundary(parent, options) {
  return function call(target, input, schemas) {
    parent.checkOpen();
    const table = options.callableTable;
    const binding = table?.get(target);
    if (options.provider !== 'node' || options.target !== 'javascript' || !binding) fail('target is not admitted for Node JavaScript');
    if (!schemas || Object.keys(schemas).length !== 2
      || schemas.inputSchema !== binding.inputSchema || schemas.outputSchema !== binding.outputSchema) fail('schema pair changed');
    let state = executions.get(parent);
    if (!state) { state = { active: false, counts: new Map() }; executions.set(parent, state); }
    if (state.active) fail('cannot be nested');
    const count = (state.counts.get(target) || 0) + 1;
    if (count > binding.maxCalls) fail('static site budget exceeded');
    state.counts.set(target, count);
    let closed = false;
    const execution = Object.freeze({ checkOpen() {
      parent.checkOpen();
      if (closed) fail('lifetime is closed');
    } });
    const resources = require('./resources.js').createResourceContext(options.binaryResources, execution);
    const context = Object.freeze({
      resources: Object.freeze({ map(id) {
        execution.checkOpen();
        if (!binding.resources.includes(id)) fail('resource is not admitted');
        return resources.map(id);
      } }),
      workspace: require('./workspace.js').createNumericWorkspaceContext(execution)
    });
    state.active = true;
    try {
      const decoded = encodeSchemaValue(binding.inputSchema, input, options, { source: 'application-value' }).value;
      execution.checkOpen();
      const result = target(context, readonly(decoded, execution));
      if (result && typeof result.then === 'function') {
        // Source admission rejects async targets; still observe an invalid host
        // Promise so boundary rejection cannot create an unhandled rejection.
        if (result instanceof Promise) Promise.prototype.then.call(result, undefined, () => {});
        fail('must return synchronously');
      }
      execution.checkOpen();
      const output = encodeSchemaValue(binding.outputSchema, result, options, { source: 'application-value' }).value;
      execution.checkOpen();
      return output;
    } finally {
      closed = true;
      state.active = false;
    }
  };
}

module.exports = { bindCallableApplication, applicationCallables: application => applications.get(application),
  inheritApplicationCallables(from, to) { if (applications.has(from)) applications.set(to, applications.get(from)); },
  createCallBoundary };
