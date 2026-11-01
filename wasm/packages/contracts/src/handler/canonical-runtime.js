'use strict';

const CANONICAL_PROGRAM_VERSION = 'pulse.canonical-program.v2';
const CANONICAL_RUNTIME_PROTOCOL_VERSION = 'pulse.canonical-runtime-protocol.v2';
const CANONICAL_EFFECT_MARKER_KINDS = Object.freeze(['effect', 'group']);
const CANONICAL_PACKAGE_EFFECT_VERSION = 'pulse.canonical-package-effect.v1';
const CANONICAL_EFFECT_INVOCATION_POLICY = Object.freeze({
  version: 'pulse.effect-invocation.v1',
  defaultMaxEffects: 1024,
  identity: 'execution-owned single-use ticket; static effect and continuation sites remain reusable',
  authentication: 'execution, reusable site and active ticket before consumption or delivery',
  settlement: 'consume once before delivery; rejected or trapped delivery never reopens the ticket',
  rejectedAuthentication: 'no ticket consumption or guest delivery',
  terminal: 'completion, failure, explicit close and cancellation invalidate outstanding tickets',
  closure: 'invalidate delivery authority before cleanup requiring closed invocation state',
  acceptedFailure: 'accepted delivery does not imply business success; preserve the primary failure',
  budget: 'cumulative effect invocations and one inherited monotonic deadline',
  nativeResultBoundary: 'managed host; raw guest ABI v2 setters remain trusted-host operations'
});

module.exports = Object.freeze({
  CANONICAL_PROGRAM_VERSION,
  CANONICAL_RUNTIME_PROTOCOL_VERSION,
  CANONICAL_EFFECT_MARKER_KINDS,
  CANONICAL_PACKAGE_EFFECT_VERSION,
  CANONICAL_EFFECT_INVOCATION_POLICY
});
