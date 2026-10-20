'use strict';

const VERSION = 'pulse.managed-native-primitives.v1';
const operations = new Set(['block', 'local', 'expression', 'if', 'pure-loop', 'break', 'continue', 'effect', 'parallel', 'logging', 'schema-result', 'completion']);
const expressions = new Set(['literal', 'undefined', 'input', 'local', 'effect-result', 'provider-namespace', 'property', 'element', 'array', 'object', 'template', 'binary', 'unary', 'conditional', 'context-read', 'resource-read', 'workspace-init', 'workspace-read', 'workspace-write', 'schema-text', 'scalar-assignment']);

// This contract validates the generic projection, independently of source/AST
// provenance. Packages still own dispatch and their input/output schema binding.
function validateManagedPrimitiveHandler(handler) {
  const fail = message => { throw new TypeError('Invalid managed Native primitives: ' + message); };
  const facts = handler.primitives;
  if (!facts || facts.version !== VERSION || !Array.isArray(facts.resourceIds) || !Array.isArray(facts.schemaIds)
    || !Array.isArray(facts.workspaces) || facts.workspaces.length > 4) fail('primitive table');
  const resources = new Set(facts.resourceIds), schemas = new Set(facts.schemaIds);
  if (resources.size !== facts.resourceIds.length || schemas.size !== facts.schemaIds.length
    || [...resources, ...schemas].some(id => typeof id !== 'string' || !id)) fail('identity table');
  const workspaces = new Map();
  for (const w of facts.workspaces) {
    if (!w || typeof w.id !== 'string' || workspaces.has(w.id) || !Number.isInteger(w.capacity) || w.capacity < 1 || w.capacity > 1024) fail('workspace capacity or identity');
    workspaces.set(w.id, w);
  }
  const locals = new Map(), initialized = new Set(), usedResources = new Set(), usedSchemas = new Set();
  function expression(e, live, allowInit = false) {
    if (!e || !expressions.has(e.kind)) fail('expression kind');
    if (e.kind === 'local' && !locals.has(e.id)) fail('unknown local');
    if (e.kind === 'scalar-assignment' && (!locals.get(e.id)?.mutable || !['=','+=','-=','*=','/=','%='].includes(e.operator))) fail('immutable scalar assignment');
    if (e.kind === 'resource-read') {
      if (!resources.has(e.resourceId) || !['byteLength','readU8','readU32LE','readF32LE','readUtf8'].includes(e.operation)
        || (e.operation === 'byteLength' ? e.offset !== undefined : !e.offset)
        || (e.operation === 'readUtf8' ? !e.length : e.length !== undefined)) fail('resource reference or operation');
      usedResources.add(e.resourceId);
    }
    if (e.kind.startsWith('workspace-')) {
      if (!workspaces.has(e.workspaceId)) fail('workspace reference');
      if (e.kind === 'workspace-init') {
        if (!allowInit || initialized.has(e.workspaceId) || e.offset || e.value) fail('workspace initialization');
        live.add(e.workspaceId); initialized.add(e.workspaceId);
      } else if (!live.has(e.workspaceId) || (e.kind === 'workspace-write' && (!e.offset || !e.value)) || (e.kind === 'workspace-read' && e.value)) fail('workspace dominance');
    }
    if (e.kind === 'schema-text') {
      if (!schemas.has(e.schemaId) || !['encodeJson','decodeJson'].includes(e.operation) || !e.value) fail('schema text operation');
      usedSchemas.add(e.schemaId);
    }
    function child(value) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const entry of value) child(entry); return; }
      if (expressions.has(value.kind)) expression(value, live);
      else for (const entry of Object.values(value)) child(entry);
    }
    for (const [key, value] of Object.entries(e)) if (key !== 'kind') child(value);
  }
  function body(node, live, product = 1, inLoop = false) {
    if (!node || !operations.has(node.kind)) fail('operation kind');
    if (node.kind === 'block') { for (const child of node.statements) body(child, live, product, inLoop); return; }
    if (node.kind === 'local') {
      expression(node.initializer, live);
      if (locals.has(node.id)) fail('duplicate local');
      locals.set(node.id, node); return;
    }
    if (node.kind === 'expression') { expression(node.expression, live, !inLoop && node.expression.kind === 'workspace-init'); return; }
    if (node.kind === 'if') {
      expression(node.test, live);
      const yes = new Set(live), no = new Set(live);
      body(node.thenOperation, yes, product, inLoop);
      if (node.elseOperation) body(node.elseOperation, no, product, inLoop);
      for (const id of yes) if (no.has(id)) live.add(id);
      return;
    }
    if (node.kind === 'pure-loop') {
      if (!Number.isInteger(node.maxIterations) || node.maxIterations < 0 || node.maxIterations > 1024
        || product * Math.max(1, node.maxIterations) > 65536 || locals.has(node.counter)) fail('loop bound or counter');
      locals.set(node.counter, { mutable: false });
      expression(node.test, live);
      body(node.body, new Set(live), product * Math.max(1, node.maxIterations), true); return;
    }
    if (node.kind === 'break' || node.kind === 'continue') { if (!inLoop) fail('loop control outside loop'); return; }
    if (inLoop) fail('effect or result inside pure loop');
    if (node.kind === 'schema-result') expression(node.expression, live);
    for (const arg of node.arguments || []) expression(arg, live);
    // Effect-bound locals are declared by the canonical effect projection.
    for (const binding of node.bindings || []) if (binding.id) locals.set(binding.id, { mutable: false });
    if (node.binding?.id) locals.set(node.binding.id, { mutable: false });
  }
  // Existing effect projection owns these locals; pure local declarations are
  // checked at their sites below. No effect binding may become mutable.
  for (const local of handler.locals || []) if (local.binding !== 'value') locals.set(local.id, { mutable: false });
  body(handler.body, new Set());
  if (initialized.size !== workspaces.size || usedResources.size !== resources.size || usedSchemas.size !== schemas.size) fail('unowned primitive table entry');
  return true;
}
module.exports = { MANAGED_NATIVE_PRIMITIVES_VERSION: VERSION, validateManagedPrimitiveHandler };
