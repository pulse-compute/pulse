'use strict';

// Private Fastly realization selector, never an authoring or host ABI option.
const HANDLE_OWNERSHIP_POLICY = 'fastly-handle-tracing-v1';
const expressionKinds = new Set(['literal', 'undefined', 'local', 'context-read', 'array',
  'object', 'template', 'binary', 'unary', 'conditional', 'property', 'element',
  'assignment', 'update', 'intrinsic', 'method-call']);
const intrinsics = new Set(['request.header', 'request.text', 'request.json', 'response.json',
  'response.text', 'schema.encode.text', 'schema.decode.text', 'state.get', 'state.set',
  'router.match', 'router.param', 'logging.emit']);
const capabilities = new Set(['request', 'request.method', 'request.url', 'request.path',
  'request.headers', 'request.header', 'request.text', 'request.json', 'response.json',
  'response.text', 'schema.decode', 'schema.encode', 'state.get', 'state.set', 'logging']);

function prepareHandleOwnership({ plan, policy, schemaActive, budgeted, expressions, eventReachable }) {
  if (policy !== undefined && policy !== HANDLE_OWNERSHIP_POLICY) throw new TypeError('Unknown private handle ownership policy');
  let reason = !policy ? 'unselected-realization' : !schemaActive ? 'collector-unavailable'
    : budgeted ? 'retain-until-terminal-budget' : null;
  const decline = value => { reason ||= value; };
  if ((plan.helpers || []).length || (plan.stages || []).length) decline('helper-or-stage-frame');
  if ((plan.effects || []).length || (plan.continuations || []).length) decline('effect-lifecycle');
  if (eventReachable) decline('event-lifecycle');
  if (plan.packages?.application) decline('package-owned-emitter');
  if ((plan.routing?.entries || []).some(e => e.kind === 'error')) decline('application-error-lane');
  if ((plan.capabilities || []).some(c => !capabilities.has(c))) decline('unaudited-capability');
  // Every expression returns before a checkpoint. No helper/foreign call can
  // checkpoint with an earlier caller operand still living on the native stack.
  for (const e of expressions) {
    if (!expressionKinds.has(e.kind)
      || e.kind === 'intrinsic' && !intrinsics.has(e.name)
      || e.kind === 'method-call' && e.method !== 'string.trim'
      || e.kind === 'context-read' && !['req.method', 'req.url', 'req.path', 'req.headers'].includes((e.path || []).join('.'))) decline('unaudited-expression');
  }
  function statements(body, inLoop = false) {
    for (const s of body || []) {
      if (s.kind === 'if') { statements(s.then, inLoop); statements(s.else, inLoop); }
      else if (s.kind === 'pure-loop') statements(s.body, true);
      else if (['break', 'continue'].includes(s.kind)) { if (!inLoop) decline('unproven-loop-transfer'); }
      else if (!['local', 'expression', 'return', 'handler-call'].includes(s.kind)) decline('unaudited-statement');
    }
  }
  statements(plan.entry.body);
  for (const handler of plan.handlers || []) statements(handler.body);
  return Object.freeze({
    enabled: reason === null,
    checkpoint: reason === null ? '__pulse_handle_checkpoint()' : '',
    manifest: roots => Object.freeze({ policy: policy || null, enabled: reason === null,
      reason, roots: reason === null ? Object.freeze([...roots]) : Object.freeze([]),
      checkpoints: reason === null ? 'completed-expressions-and-loop-control' : 'none' })
  });
}

module.exports = { prepareHandleOwnership };
