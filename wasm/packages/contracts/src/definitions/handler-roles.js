'use strict';

const HANDLER_ROLE_VERSION = 'pulsewasm.handler-role-definitions.v1';

const HANDLER_ROLE_DEFINITIONS = Object.freeze([
  Object.freeze({ role: 'route', params: 2, display: '(ctx, next) => PulseResult | void', asyncAllowed: false, generatorAllowed: false, promiseReturnAllowed: false }),
  Object.freeze({ role: 'middleware', params: 2, display: '(ctx, next) => PulseResult | void', asyncAllowed: false, generatorAllowed: false, promiseReturnAllowed: false }),
  Object.freeze({ role: 'lifecycle', params: 2, display: '(ctx, next) => void', asyncAllowed: false, generatorAllowed: false, promiseReturnAllowed: false }),
  Object.freeze({ role: 'error', params: 3, display: '(err, ctx, next) => PulseResult | void', asyncAllowed: false, generatorAllowed: false, promiseReturnAllowed: false }),
  Object.freeze({ role: 'channel', params: 1, display: '(ctx) => string | string[]', asyncAllowed: false, generatorAllowed: false, promiseReturnAllowed: false })
]);

function buildHandlerRoleRegistry(definitions = HANDLER_ROLE_DEFINITIONS) {
  const list = Array.from(definitions);
  const byRole = new Map();
  for (const definition of list) {
    if (!definition || !definition.role) throw new Error('Handler role definition is missing a role.');
    if (byRole.has(definition.role)) throw new Error(`Duplicate handler role definition: ${definition.role}`);
    byRole.set(definition.role, definition);
  }
  return Object.freeze({
    version: HANDLER_ROLE_VERSION,
    definitions: Object.freeze(list),
    byRole,
    get(role) {
      return byRole.get(role);
    },
    has(role) {
      return byRole.has(role);
    },
    roleNames() {
      return Array.from(byRole.keys());
    },
    asSignatureMap() {
      const out = {};
      for (const [role, definition] of byRole.entries()) {
        out[role] = { params: definition.params, display: definition.display };
      }
      return out;
    }
  });
}

const DEFAULT_HANDLER_ROLE_REGISTRY = buildHandlerRoleRegistry();
const ROLE_SIGNATURES = DEFAULT_HANDLER_ROLE_REGISTRY.asSignatureMap();

function roleForOperation(op) {
  if (!op) return undefined;
  if (op.route) return 'route';
  if (op.kind === 'use') return 'middleware';
  if (op.kind === 'get' || op.kind === 'post') return 'route';
  if (op.kind === 'lifecycle') return 'lifecycle';
  if (op.kind === 'error') return 'error';
  if (op.kind === 'channel') return 'channel';
  if (op.role) return op.role;
  return undefined;
}

module.exports = {
  HANDLER_ROLE_VERSION,
  HANDLER_ROLE_DEFINITIONS,
  DEFAULT_HANDLER_ROLE_REGISTRY,
  ROLE_SIGNATURES,
  buildHandlerRoleRegistry,
  roleForOperation
};
