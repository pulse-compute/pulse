'use strict';

// Private Fastly realization selector, never an authoring or host ABI option.
const HANDLE_OWNERSHIP_POLICY = 'fastly-handle-tracing-v1';
const { CANONICAL_NATIVE_PURE_HELPER_VERSION,
  CANONICAL_NATIVE_STAGE_CONTRACT } = require('@pulse-compute/wasm-contracts/handler/canonical-native-plan');
const expressionKinds = new Set(['literal', 'undefined', 'local', 'context-read', 'array',
  'object', 'template', 'binary', 'unary', 'conditional', 'property', 'element',
  'assignment', 'update', 'intrinsic', 'method-call', 'pure-helper-call']);
const intrinsics = new Set(['request.header', 'request.text', 'request.json', 'response.json',
  'response.text', 'schema.encode.text', 'schema.decode.text', 'state.get', 'state.set',
  'router.match', 'router.param', 'logging.emit', 'kv.namespace', 'response.custom',
  'request.body.forward-marker']);
// Explicit owner audit, independent of the provider's supported-effect list.
// These implementations return before any checkpoint; only the payload/ready
// slots and pinned opaque wrappers outlive the synchronous provider call.
const effects = new Set(['fetch', 'config.get', 'secret.get', 'kv.get', 'kv.put',
  'kv.getVersioned', 'kv.insertIfAbsent', 'kv.compareAndSwap', 'time.now',
  'package.invoke', 'crypto.digestText', 'grip.channel', 'grip.hold', 'grip.publish', 'grip.broadcast',
  'assets.lookup', 'jwt.verify', 'jwt.sign', 's3.head', 's3.getText', 's3.putText', 's3.getBody']);
const capabilities = new Set(['request', 'request.method', 'request.url', 'request.path',
  'request.headers', 'request.header', 'request.text', 'request.json', 'response.json',
  'response.text', 'schema.decode', 'schema.encode', 'state.get', 'state.set', 'logging',
  'kv', 'response', 'request.body.forward', ...effects]);

function prepareHandleOwnership({ plan, policy, schemaActive, budgeted, expressions, eventReachable }) {
  if (policy !== undefined && policy !== HANDLE_OWNERSHIP_POLICY) throw new TypeError('Unknown private handle ownership policy');
  let reason = !policy ? 'unselected-realization' : !schemaActive ? 'collector-unavailable'
    : budgeted ? 'retain-until-terminal-budget' : null;
  const decline = value => { reason ||= value; };
  if ((plan.helpers || []).some(h => ![CANONICAL_NATIVE_PURE_HELPER_VERSION, 'pulse.canonical-native-helper.v1'].includes(h.version))
    || (plan.stages || []).some(s => s.version !== CANONICAL_NATIVE_STAGE_CONTRACT.version)) decline('unaudited-frame');
  if ((plan.effects || []).some(e => !effects.has(e.kind))) decline('unaudited-effect');
  if (eventReachable) decline('event-lifecycle');
  if (plan.packages?.application) decline('package-owned-emitter');
  if ((plan.capabilities || []).some(c => !capabilities.has(c))) decline('unaudited-capability');
  // Pure helpers never checkpoint. Their borrowed return and earlier operands
  // reach the outer expression's root before the dispatcher can collect.
  for (const e of expressions) {
    if (!expressionKinds.has(e.kind)
      || e.kind === 'pure-helper-call' && !(plan.helpers || []).some(h => h.id === e.helperId && h.version === CANONICAL_NATIVE_PURE_HELPER_VERSION)
      || e.kind === 'intrinsic' && !intrinsics.has(e.name)
      || e.kind === 'method-call' && !['string.trim', 'text', 'json', 'header'].includes(e.method)
      || e.kind === 'context-read' && !['req.method', 'req.url', 'req.path', 'req.headers'].includes((e.path || []).join('.'))) decline('unaudited-expression');
  }
  function statements(body, inLoop = false) {
    for (const s of body || []) {
      if (s.kind === 'if') { statements(s.then, inLoop); statements(s.else, inLoop); }
      else if (s.kind === 'pure-loop') statements(s.body, true);
      else if (['break', 'continue'].includes(s.kind)) { if (!inLoop) decline('unproven-loop-transfer'); }
      else if (!['local', 'expression', 'return', 'handler-call', 'helper-call', 'stage-call', 'effect', 'effect-group'].includes(s.kind)) decline('unaudited-statement');
    }
  }
  statements(plan.entry.body);
  for (const handler of plan.handlers || []) statements(handler.body);
  for (const frame of [...(plan.helpers || []), ...(plan.stages || [])]) statements(frame.body);
  return Object.freeze({
    enabled: reason === null,
    checkpoint: reason === null ? '__pulse_handle_checkpoint()' : '',
    manifest: roots => Object.freeze({ policy: policy || null, enabled: reason === null,
      reason, roots: reason === null ? Object.freeze([...roots]) : Object.freeze([]),
      checkpoints: reason === null ? 'completed-expressions-loop-control-and-transferred-effects' : 'none',
      ...(reason === null ? { pureHelpers: 'defer-until-caller-expression-completes',
        resources: 'pin-until-invocation-end' } : {}) })
  });
}

module.exports = { prepareHandleOwnership };
