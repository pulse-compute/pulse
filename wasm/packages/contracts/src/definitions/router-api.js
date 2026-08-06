'use strict';

const ROUTER_API_VERSION = 'pulsewasm.router-api-definitions.v1';

function createHttpRouteDefinition(name, method) {
  if (!name || !method) throw new Error('createHttpRouteDefinition requires name and method.');
  return Object.freeze({
    name,
    kind: 'route',
    opKind: name,
    method: String(method).toUpperCase(),
    allowedArities: [2],
    signatures: Object.freeze([
      Object.freeze({ arity: 2, pathArg: 0, handlerArg: 1 })
    ]),
    pathPolicy: 'required-static',
    role: 'route'
  });
}

const ROUTER_API_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'use',
    kind: 'middleware',
    opKind: 'use',
    allowedArities: Object.freeze([1, 2]),
    signatures: Object.freeze([
      Object.freeze({ arity: 1, handlerArg: 0 }),
      Object.freeze({ arity: 2, pathArg: 0, handlerArg: 1 })
    ]),
    pathPolicy: 'optional-static',
    role: 'middleware'
  }),
  createHttpRouteDefinition('get', 'GET'),
  createHttpRouteDefinition('head', 'HEAD'),
  createHttpRouteDefinition('post', 'POST'),
  Object.freeze({
    name: 'mount',
    kind: 'mount',
    opKind: 'mount',
    allowedArities: Object.freeze([2]),
    signatures: Object.freeze([
      Object.freeze({ arity: 2, pathArg: 0, routerArg: 1 })
    ]),
    pathPolicy: 'mount-static'
  }),
  Object.freeze({
    name: 'channel',
    kind: 'channel',
    opKind: 'channel',
    allowedArities: Object.freeze([1]),
    signatures: Object.freeze([
      Object.freeze({ arity: 1, valueArg: 0 })
    ]),
    pathPolicy: 'none',
    role: 'channel'
  }),
  Object.freeze({
    name: 'on',
    kind: 'lifecycle',
    opKind: 'lifecycle',
    allowedArities: Object.freeze([2]),
    signatures: Object.freeze([
      Object.freeze({ arity: 2, eventArg: 0, handlerArg: 1 })
    ]),
    allowedEvents: Object.freeze(['connect', 'disconnect']),
    pathPolicy: 'none',
    role: 'lifecycle'
  }),
  Object.freeze({
    name: 'error',
    kind: 'error',
    opKind: 'error',
    allowedArities: Object.freeze([1]),
    signatures: Object.freeze([
      Object.freeze({ arity: 1, handlerArg: 0 })
    ]),
    pathPolicy: 'none',
    role: 'error'
  }),
  Object.freeze({
    name: 'timeout',
    kind: 'timeout',
    opKind: 'timeout',
    allowedArities: Object.freeze([1]),
    signatures: Object.freeze([
      Object.freeze({ arity: 1, valueArg: 0 })
    ]),
    pathPolicy: 'none'
  })
]);

function buildRouterApiRegistry(definitions = ROUTER_API_DEFINITIONS) {
  const list = Array.from(definitions);
  const byName = new Map();
  for (const definition of list) {
    if (!definition || !definition.name) throw new Error('Router API definition is missing a name.');
    if (byName.has(definition.name)) throw new Error(`Duplicate router API definition: ${definition.name}`);
    byName.set(definition.name, definition);
  }
  return Object.freeze({
    version: ROUTER_API_VERSION,
    definitions: Object.freeze(list),
    byName,
    supportedMethods: new Set(byName.keys()),
    routeMethods: new Set(list.filter((definition) => definition.kind === 'route').map((definition) => definition.name)),
    get(name) {
      return byName.get(name);
    },
    has(name) {
      return byName.has(name);
    },
    supportedMethodNames() {
      return Array.from(byName.keys());
    }
  });
}

const DEFAULT_ROUTER_API_REGISTRY = buildRouterApiRegistry();
const SUPPORTED_METHODS = DEFAULT_ROUTER_API_REGISTRY.supportedMethods;
const ROUTE_METHODS = DEFAULT_ROUTER_API_REGISTRY.routeMethods;

function signatureForArity(definition, arity) {
  return (definition.signatures || []).find((signature) => signature.arity === arity);
}

function arityDisplay(definition) {
  const allowed = Array.from(definition.allowedArities || []);
  if (allowed.length === 0) return '0';
  if (allowed.length === 1) return String(allowed[0]);
  const min = Math.min(...allowed);
  const max = Math.max(...allowed);
  return allowed.length === max - min + 1 ? `${min}-${max}` : allowed.join(' or ');
}

module.exports = {
  ROUTER_API_VERSION,
  ROUTER_API_DEFINITIONS,
  DEFAULT_ROUTER_API_REGISTRY,
  SUPPORTED_METHODS,
  ROUTE_METHODS,
  arityDisplay,
  buildRouterApiRegistry,
  createHttpRouteDefinition,
  signatureForArity
};
