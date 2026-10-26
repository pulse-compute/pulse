'use strict';

const { executionLifecycle, httpLifecycle, lifecyclePlanner } = require('@pulse-compute/wasm-contracts/provider/toolchain');
const { createLifecycleEmitter } = require('@pulse-compute/wasm-runtime-core-as/compiler/canonical-native');
const forwarding = require('./native-body-forwarding.js');
const authority = require('./response-authority.js');

// Provider-owned site and ABI bindings. No anchors, source scanning or insertion
// order. The shared planner owns semantic roles; the shared emitter owns AS.
function create(plan, bindings, services = []) {
  if (!Array.isArray(services)) throw new TypeError('Internal lifecycle services must be a list.');
  const hooks = [...(forwarding.hooks(plan)), ...services];
  const needsAuthority = hooks.some(hook => ['response.error', 'response.authority', 'result.claim'].includes(hook.point));
  if (needsAuthority) hooks.push(...authority.hooks());
  if (plan.packages?.application && hooks.length) throw Object.assign(new Error('Lifecycle contributions require the canonical driver emitter; package-owned emitters are not yet bound.'), { code: 'PULSE_FASTLY_LIFECYCLE_HOOK_INVALID' });
  const sites = [
    { id: 'request-acquired', points: [{ point: 'request.acquired', parameters: {} }] },
    { id: 'effect-settle', points: [{ point: 'effect.settle', parameters: { effect: 'settle.index', ticket: 'settle.ticket', result: 'settle.result' }, reject: 'reject-settle' }] },
    { id: 'effect-deliver', points: [{ point: 'effect.deliver', parameters: { effect: 'settle.index', result: 'settle.result' }, afterParameters: { accepted: 'delivery.accepted' } }] },
    { id: 'effect-result', points: [{ point: 'effect.result', parameters: { effect: 'setter.index', result: 'setter.result' }, reject: 'reject-result' }] },
    { id: 'invocation-close', points: [{ point: 'invocation.close', parameters: {} }] },
    { id: 'invocation-end', points: [{ point: 'invocation.end', parameters: {} }] },
    { id: 'invocation-closed', points: [{ point: 'invocation.closed', parameters: {} }] },
    { id: 'response-error', points: [
      { point: 'response.authority', parameters: {}, reject: 'stop-error' },
      { point: 'response.error', parameters: {}, onClaim: 'stop-error' }
    ] },
    { id: 'response-send', points: [{ point: 'response.authority', parameters: {}, reject: 'reject-send' }] },
    ...(bindings.maxDurationMs === undefined ? [] : [{ id: 'response-timeout', points: [{ point: 'response.authority', parameters: {}, reject: 'stop-error' }] }]),
    { id: 'result-claim', points: [{ point: 'result.claim', parameters: { result: 'driver.result' }, onClaim: 'stop-error' }] }
  ];
  const emitter = createLifecycleEmitter({
    bindings: { version: lifecyclePlanner.BINDINGS_VERSION, executionVersion: executionLifecycle.VERSION, httpVersion: httpLifecycle.VERSION, sites },
    contributions: hooks.map(({ point, owner, order }) => ({ point, owner, order })),
    implementations: hooks.map(({ order, ...implementation }) => implementation),
    values: {
      'settle.index': { name: 'index', type: 'i32' }, 'settle.ticket': { name: 'ticket', type: 'i32' }, 'settle.result': { name: 'result', type: 'i32' },
      'setter.index': { name: 'effectIndex', type: 'i32' }, 'setter.result': { name: 'handle', type: 'i32' },
      'delivery.accepted': { name: '__pulse_delivery_accepted', type: 'i32' }, 'driver.result': { name: 'result', type: 'i32' }
    },
    actions: { 'reject-settle': 'return 0;', 'reject-result': 'return 0;', 'stop-error': 'return;', 'reject-send': '{ __pulse_fastly_fail(PULSE_ERROR_STATE, 282, -1); return PULSE_ERROR_STATE; }' }
  });
  return Object.freeze({ ...emitter, authority: needsAuthority,
    // Legacy error/body/deadline owners instrument only the inner implementation.
    // Structural wrappers keep shared authority outside them, regardless of pass order.
    legacyName: name => emitter.active ? name + '_impl' : name,
    supportSource: [emitter.source, ...(needsAuthority ? [authority.runtimeSource()] : [])].filter(Boolean).join('\n')
  });
}
module.exports = Object.freeze({ create });
