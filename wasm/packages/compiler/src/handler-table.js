'use strict';

const { PACKAGE_VERSION, normalizeArtifact, stableFileName } = require('./diagnostics.js');
const { createHandlerStableId, createHandlerStableInput } = require('./stable-id.js');
const { DEFAULT_HANDLER_ROLE_REGISTRY, ROLE_SIGNATURES, roleForOperation } = require('./definitions/handler-roles.js');
const { HANDLER_ID_POLICY, HANDLER_TABLE_VERSION } = loadContractsHandlerTable();
const EVENT_ROLE_SIGNATURE = Object.freeze({ params: 1, display: '(ctx) => Promise<void>' });

function loadContractsHandlerTable() {
  try {
    return require('@pulse-compute/wasm-contracts/handler-table');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../contracts/src/handler-table.js');
    }
    throw error;
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}

function handlerDisplayName(entry) {
  return entry.localName || entry.exportName || entry.inlineName || entry.id;
}

function createUse(router, op, role, ref) {
  const use = {
    role,
    router: router.name,
    opKind: op.kind,
    order: op.order,
    statementOrder: op.statementOrder,
    loc: ref?.loc || op.loc
  };
  if (op.route || op.kind === 'get' || op.kind === 'post') {
    use.method = op.method || op.kind.toUpperCase();
    use.path = op.path;
  }
  if (op.kind === 'use' && op.path) use.path = op.path;
  if (op.kind === 'lifecycle') use.event = op.event;
  if (role === 'event') {
    use.event = op.type;
    use.schemaId = op.declaration && op.declaration.schemaId;
  }
  return use;
}

function expectedSignatureForRole(role, registry = DEFAULT_HANDLER_ROLE_REGISTRY) {
  const definition = registry.get(role);
  return definition ? { params: definition.params, display: definition.display } : undefined;
}

function validateEntryForRole(entry, role, use, diagnostics, options = {}) {
  entry._validatedRoleKeys ||= new Set();
  const key = `${entry.id}:${role}`;
  if (entry._validatedRoleKeys.has(key)) return;
  entry._validatedRoleKeys.add(key);

  const expected = typeof options.expectedSignatureForRole === 'function'
    ? options.expectedSignatureForRole(role, entry, use)
    : expectedSignatureForRole(role);
  const signature = entry.signature || {};
  const loc = entry.loc || use?.loc || { file: entry.file || '<unknown>' };

  if (!expected) return;

  // Sprint 1 Wave 2: managed Router handlers are async-shaped authoring functions.
  // Promise runtime semantics remain rejected by the shared handler-surface normalizer.

  if ((signature.nonIdentifierParams || []).length > 0) {
    diagnostics.push({
      pass: 'handler-table',
      code: 'PULSEWASM_UNSUPPORTED_HANDLER_PARAMETER',
      severity: 'error',
      message: `Handler "${handlerDisplayName(entry)}" uses destructured or non-identifier parameters.`,
      hint: `Use the explicit ${expected.display} role signature.`,
      loc
    });
  }

  const expectedParams = Array.isArray(expected.params) ? expected.params : [expected.params];
  if (!expectedParams.includes(signature.paramCount)) {
    diagnostics.push({
      pass: 'handler-table',
      code: 'PULSEWASM_ROLE_SIGNATURE_MISMATCH',
      severity: 'error',
      message: `Handler "${handlerDisplayName(entry)}" is used as ${role} but has ${signature.paramCount ?? 0} parameter(s).`,
      hint: `Expected ${expected.display}.`,
      loc
    });
  }
}

function cleanEntry(entry) {
  const out = { ...entry };
  delete out._validatedRoleKeys;
  out.roles = uniqueSorted(out.roles || []);
  return out;
}

function buildHandlerTable(ir, options = {}) {
  const cwd = options.cwd || process.cwd();
  const diagnostics = [];
  const declarationsByName = new Map();
  const entriesBySymbolName = new Map();
  const entriesById = new Map();
  const handlers = [];
  let nextOrder = 0;

  for (const decl of ir.handlerIR || []) {
    declarationsByName.set(decl.symbolId || decl.name, decl);
  }

  function addEntry(entry) {
    const existing = entriesById.get(entry.id);
    if (existing) return existing;
    entry.order = nextOrder++;
    entry.roles ||= [];
    entry.uses ||= [];
    entriesById.set(entry.id, entry);
    handlers.push(entry);
    if (entry.symbolId) entriesBySymbolName.set(entry.symbolId, entry);
    else if (entry.localName) entriesBySymbolName.set(entry.localName, entry);
    return entry;
  }

  function entryFromDeclaration(decl) {
    const localName = decl.localName || decl.name;
    const symbolId = decl.symbolId && decl.symbolId !== localName ? decl.symbolId : undefined;
    const lookupName = symbolId || localName;
    const existing = entriesBySymbolName.get(lookupName);
    if (existing) return existing;
    const stableInput = createHandlerStableInput({
      file: decl.file,
      kind: decl.kind,
      localName,
      exportName: decl.exportName,
      inline: false,
      sourceTextHash: decl.sourceTextHash
    });
    const id = createHandlerStableId({
      file: decl.file,
      kind: decl.kind,
      localName,
      exportName: decl.exportName,
      inline: false,
      sourceTextHash: decl.sourceTextHash
    });
    return addEntry({
      id,
      stableInput,
      kind: decl.kind,
      ...(symbolId ? { symbolId } : {}),
      localName,
      exportName: decl.exportName,
      file: decl.file,
      loc: decl.loc,
      sourceTextHash: decl.sourceTextHash,
      declaration: {
        topLevel: true,
        exported: Boolean(decl.exportName)
      },
      signature: decl.signature
    });
  }

  function entryFromInline(ref, role, router, op) {
    const inlineName = `<inline:${role}:${router.name}:${op.order}>`;
    const file = stableFileName(ref.loc?.file || ir.source, cwd);
    const stableLoc = ref.loc
      ? {
          file,
          start: ref.loc.start,
          end: ref.loc.end
        }
      : undefined;
    const stableInput = createHandlerStableInput({
      file,
      kind: ref.inlineKind || 'inline-function',
      localName: null,
      exportName: null,
      inline: true,
      loc: stableLoc,
      sourceTextHash: ref.sourceTextHash
    });
    const id = createHandlerStableId({
      file,
      kind: ref.inlineKind || 'inline-function',
      localName: null,
      exportName: null,
      inline: true,
      loc: stableLoc,
      sourceTextHash: ref.sourceTextHash
    });
    return addEntry({
      id,
      stableInput,
      kind: ref.inlineKind || 'inline-function',
      inlineName,
      file,
      loc: ref.loc,
      sourceTextHash: ref.sourceTextHash,
      declaration: {
        topLevel: false,
        exported: false
      },
      signature: ref.signature
    });
  }

  function resolveRef(ref, role, router, op) {
    if (!ref) return ref;
    if (ref.kind === 'static') return clone(ref);

    let entry;
    if (ref.kind === 'identifier' || ref.kind === 'ref') {
      const decl = declarationsByName.get(ref.value);
      if (!decl) {
        diagnostics.push({
          pass: 'handler-table',
          code: 'PULSEWASM_UNRESOLVED_HANDLER_REFERENCE',
          severity: 'error',
          message: `Unable to resolve ${role} handler "${ref.value}" as a top-level handler declaration.`,
          hint: 'Use a top-level function declaration, const arrow function, or const function expression in the same entry file.',
          loc: ref.loc || op.loc
        });
        return { kind: 'unresolved', name: ref.value, role, loc: ref.loc || op.loc };
      }
      entry = entryFromDeclaration(decl);
    } else if (ref.kind === 'inline') {
      entry = entryFromInline(ref, role, router, op);
    } else {
      diagnostics.push({
        pass: 'handler-table',
        code: 'PULSEWASM_UNSUPPORTED_HANDLER_REFERENCE',
        severity: 'error',
        message: `Unsupported ${role} handler reference kind "${ref.kind}".`,
        hint: 'Use a direct handler identifier or an inline function expression.',
        loc: ref.loc || op.loc
      });
      return { kind: 'unsupported', name: ref.value, role, loc: ref.loc || op.loc };
    }

    const use = createUse(router, op, role, ref);
    entry.roles.push(role);
    entry.uses.push(use);
    validateEntryForRole(entry, role, use, diagnostics, options);

    return {
      kind: 'handler',
      id: entry.id,
      name: entry.localName || entry.inlineName,
      role,
      loc: ref.loc || op.loc
    };
  }

  const resolvedRouterIR = (ir.routerIR || []).map((router) => ({
    ...router,
    ops: (router.ops || []).map((op) => {
      const next = clone(op);
      const role = roleForOperation(next);
      if (!role) return next;
      if (next.kind === 'channel') {
        if (next.value && next.value.kind !== 'static') {
          next.value = resolveRef(next.value, role, router, next);
        }
        return next;
      }
      if (next.handler) next.handler = resolveRef(next.handler, role, router, next);
      return next;
    })
  }));

  const resolvedEventIR = (ir.eventIR || []).map((op) => {
    const next = clone(op);
    if (next.handler) next.handler = resolveRef(next.handler, 'event', { name: next.router }, next);
    return next;
  });

  const artifactHandlers = handlers.map(cleanEntry);
  const eventActive = resolvedEventIR.length > 0;
  const artifact = normalizeArtifact({
    version: HANDLER_TABLE_VERSION,
    generatedBy: PACKAGE_VERSION,
    source: ir.source,
    idPolicy: HANDLER_ID_POLICY,
    roleSignatures: eventActive ? { ...ROLE_SIGNATURES, event: EVENT_ROLE_SIGNATURE } : ROLE_SIGNATURES,
    handlers: artifactHandlers,
    summary: {
      handlers: artifactHandlers.length,
      declarationHandlers: artifactHandlers.filter((entry) => entry.declaration?.topLevel).length,
      inlineHandlers: artifactHandlers.filter((entry) => !entry.declaration?.topLevel).length,
      roles: uniqueSorted(artifactHandlers.flatMap((entry) => entry.roles || [])),
      ...(eventActive ? { eventHandlers: artifactHandlers.filter((entry) => entry.roles.includes('event')).length } : {}),
      diagnostics: diagnostics.length
    }
  }, cwd);

  return {
    handlerTable: artifact,
    diagnostics,
    resolvedIR: {
      ...ir,
      routerIR: resolvedRouterIR,
      ...(eventActive ? { eventIR: resolvedEventIR } : {}),
      handlerIR: artifact.handlers
    }
  };
}

module.exports = {
  HANDLER_ID_POLICY,
  HANDLER_TABLE_VERSION,
  ROLE_SIGNATURES,
  EVENT_ROLE_SIGNATURE,
  buildHandlerTable,
  expectedSignatureForRole,
  roleForOperation
};
