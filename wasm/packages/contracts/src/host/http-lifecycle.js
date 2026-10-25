'use strict';

// Optional HTTP-serving capability semantics, independent of device/provider.
// This contract does not map host status codes or infer handle disposition.
const VERSION = 'pulse.http-lifecycle.v1';
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const POINTS = deepFreeze({
  'request.acquired': {
    kind: 'observe', parameters: [],
    doc: 'The provider acquired the incoming HTTP request and its body access.'
  },
  'response.error': {
    kind: 'claim', parameters: [],
    doc: 'A service selects an error response behind the shared response-authority fence.'
  },
  'response.authority': {
    kind: 'predicate', parameters: [],
    doc: 'Check authority before ordinary, error or timeout responders may send.',
    rejection: 'do-not-send-or-replace-response',
    dominates: ['response.error']
  },
  'result.claim': {
    kind: 'claim', parameters: ['result'],
    doc: 'A service handles the final HTTP result before ordinary response selection.'
  }
});

// Symbolic states only: a provider chooses its own representation. Transfer and
// completion observations require provider-qualified evidence for that operation.
const AUTHORITY = deepFreeze({
  states: ['owned', 'outcome-unknown', 'transferred', 'completed'],
  initial: 'owned',
  mayRespond: ['owned'],
  transitions: {
    dispatch: { from: 'owned', to: 'outcome-unknown', evidence: 'before-host-dispatch' },
    transfer: { from: 'outcome-unknown', to: 'transferred', evidence: 'provider-qualified-transfer' },
    complete: { from: 'transferred', to: 'completed', evidence: 'provider-qualified-local-completion' }
  },
  unknownOutcome: 'retain-outcome-unknown',
  trap: 'no-reopen-or-guaranteed-guest-cleanup',
  invalidTransition: 'no-state-change',
  completionIsDeliveryReceipt: false,
  completionIsHostQuiescence: false,
  authorityIsHandleOwnership: false,
  automaticRetry: false
});

module.exports = Object.freeze({ VERSION, POINTS, AUTHORITY });
