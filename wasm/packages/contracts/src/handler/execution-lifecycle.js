'use strict';

// Adapted from HEX shared-lifecycle research at ecc36468b5900a0de57a415379b85d12c5026f3f.

// Internal semantic contract. No provider source, ABI types, hook execution,
// scheduling, package registration or authority is supplied by this module.
const { CANONICAL_EFFECT_INVOCATION_POLICY: INVOCATION } = require('./canonical-runtime.js');

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
  cleanup: 'requires-qualified-resource-ownership-protected-capacity-and-original-remaining-deadline',
  trustedContributions: true,
  packageRegistration: false,
  scheduler: false
});

module.exports = Object.freeze({ VERSION, KINDS, COMPOSITION, POINTS, POLICY, INVOCATION });
