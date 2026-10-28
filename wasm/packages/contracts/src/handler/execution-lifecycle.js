'use strict';

// Internal semantic contract. No provider source, ABI types, hook execution,
// scheduling, package registration or authority is supplied by this module.
const VERSION = 'pulse.execution-lifecycle.v1';

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const COMPOSITION = deepFreeze({
  observe: { dispatch: 'all', result: 'void', order: 'ascending' },
  guard: { dispatch: 'all-true', result: 'boolean', order: 'ascending', shortCircuit: true },
  predicate: { dispatch: 'all-true', result: 'boolean', order: 'ascending', shortCircuit: true },
  claim: { dispatch: 'first-true', result: 'boolean', order: 'ascending', shortCircuit: true },
  around: { dispatch: 'around', result: 'void', order: 'ascending', afterOrder: 'descending', afterOn: 'normal-return-only' }
});
const KINDS = Object.freeze(Object.keys(COMPOSITION));

// Parameters are semantic roles. A provider owns their concrete representation,
// local names and ABI signature; an effect result need not be a numeric handle.
const POINTS = deepFreeze({
  'effect.settle': {
    kind: 'guard', parameters: ['effect', 'ticket', 'result'],
    doc: 'Authenticate a resolved result before consuming its invocation ticket.',
    rejection: 'do-not-consume-ticket-or-deliver'
  },
  'effect.deliver': {
    kind: 'around', parameters: ['effect', 'result'], afterParameters: ['accepted'],
    doc: 'Deliver the settled result; notify after normal return, including rejection, never after a trap.'
  },
  'effect.result': {
    kind: 'guard', parameters: ['effect', 'result'],
    doc: 'Authenticate entry to the continuation result setter, including external entry.',
    rejection: 'do-not-deliver'
  },
  'invocation.close': {
    kind: 'observe', parameters: [],
    doc: 'Closure begins before outstanding invocation tickets are invalidated.'
  },
  'invocation.end': {
    kind: 'observe', parameters: [],
    doc: 'Driver execution returned normally, including handled failures, before closure.',
    runsOn: 'normal-return-only'
  },
  'invocation.closed': {
    kind: 'observe', parameters: [],
    doc: 'Closure returned after ticket invalidation and provider-specific closure work.',
    runsOn: 'normal-return-only'
  }
});

const POLICY = deepFreeze({
  orders: 'distinct-safe-integers-per-point',
  owners: 'one-contribution-per-owner-per-point',
  registrationOrder: 'irrelevant',
  rejectionAction: 'provider-call-site-owned-within-point-postcondition',
  trap: 'no-after-or-exit-finalization-guarantee',
  cleanup: 'requires-qualified-resource-ownership-and-existing-budget',
  trustedContributions: true,
  packageRegistration: false,
  scheduler: false
});

function contractError(message, detail) {
  const error = new TypeError(message);
  error.code = 'PULSEWASM_EXECUTION_LIFECYCLE_INVALID';
  error.detail = Object.freeze(detail || {});
  return error;
}

// Validate metadata only. Provider source/body validation and concrete point
// availability belong to the adapter. HTTP points require explicit opt-in by
// supplying that capability's point set; they are absent from the default set.
function orderedContributions(contributions, points = POINTS, error = contractError) {
  if (!Array.isArray(contributions)) throw error('Lifecycle hook contributions must be a list.');
  const seen = new Set(), orders = new Map();
  for (const item of contributions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw error('Lifecycle hook contribution must be a record.');
    const point = Object.hasOwn(points, item.point) ? points[item.point] : undefined;
    if (!point) throw error(`Unknown lifecycle hook point ${item.point}.`, { point: item.point, owner: item.owner });
    if (!Object.hasOwn(COMPOSITION, point.kind)) throw error('Unknown lifecycle composition kind.', { point: item.point });
    if (typeof item.owner !== 'string' || !/^[a-z0-9][a-z0-9.:-]{0,95}$/.test(item.owner)) throw error('Lifecycle hook owner must be a bounded identifier.', { point: item.point });
    if (!Number.isSafeInteger(item.order)) throw error('Lifecycle hook contribution requires a safe integer order.', { point: item.point, owner: item.owner });
    const key = item.point + '\0' + item.owner;
    if (seen.has(key)) throw error('An owner may contribute to a lifecycle hook point once.', { point: item.point, owner: item.owner });
    seen.add(key);
    const orderKey = item.point + '\0' + item.order;
    if (orders.has(orderKey)) throw error('Lifecycle hook contributions on one point need distinct orders.', { point: item.point, owners: [orders.get(orderKey), item.owner] });
    orders.set(orderKey, item.owner);
  }
  return [...contributions].sort((a, b) => a.order - b.order || a.owner.localeCompare(b.owner));
}

module.exports = Object.freeze({ VERSION, KINDS, COMPOSITION, POINTS, POLICY, orderedContributions });
