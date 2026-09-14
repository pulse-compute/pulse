'use strict';

const HANDLER_SURFACE_CONTRACT_VERSION = 'pulse.handler-surface.v4';
const HANDLER_SURFACE_CONTRACT_ID = 'pulse.handler-surface';

const HANDLER_SURFACE_CLASSES = Object.freeze([
  'handler-wrapper',
  'sync',
  'effect',
  'terminal-transfer',
  'package-owned',
  'javascript-only'
]);

const AWAIT_POLICIES = Object.freeze([
  'not-applicable',
  'forbidden',
  'synchronous-statement-only',
  'optional-redundant-warning',
  'required-when-consumed',
  'return-adopted-or-required',
  'manifest-owned',
  'native-boundary'
]);

const HANDLER_AUTHORING_POLICY_VERSION = 'pulse.handler-authoring-policy.v1';
const HANDLER_AUTHORING_MODES = Object.freeze({
  ASYNC_REQUIRED: 'async-required',
  SYNCHRONOUS_COMPATIBILITY: 'synchronous-compatibility'
});

const HANDLER_SURFACE_DIAGNOSTICS = Object.freeze({
  handlerAsyncRequired: 'PULSE_HANDLER_ASYNC_REQUIRED',
  redundantSyncAwait: 'PULSE_AWAIT_SYNC_REDUNDANT',
  logAwaitForbidden: 'PULSE_LOG_AWAIT_FORBIDDEN',
  effectAwaitRequired: 'PULSE_EFFECT_AWAIT_REQUIRED',
  nextTerminal: 'PULSE_ROUTER_NEXT_TERMINAL',
  nativeAwaitUnsupported: 'PULSE_NATIVE_AWAIT_UNSUPPORTED',
  schemaRequired: 'PULSE_SCHEMA_REQUIRED',
  unsupportedSurface: 'PULSE_HANDLER_SURFACE_UNSUPPORTED'
});

function freezeList(values) {
  return Object.freeze(Array.from(values || []));
}

function surface(definition) {
  return Object.freeze({
    ...definition,
    publicForms: freezeList(definition.publicForms),
    validPositions: freezeList(definition.validPositions),
    targetSupport: Object.freeze({
      javascript: definition.targetSupport?.javascript !== false,
      native: definition.targetSupport?.native !== false
    })
  });
}

const HANDLER_SURFACE_DEFINITIONS = Object.freeze([
  surface({
    id: 'handler.managed-async-wrapper',
    class: 'handler-wrapper',
    canonicalOperation: 'handler.managed',
    publicForms: ['async handler', 'async middleware', 'async error handler'],
    awaitPolicy: 'not-applicable',
    validPositions: ['declaration'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'erase-wrapper',
    status: 'supported'
  }),
  surface({
    id: 'router.next',
    class: 'terminal-transfer',
    canonicalOperation: 'router.transfer.normal-or-error',
    publicForms: ['next()', 'next(error)'],
    awaitPolicy: 'forbidden',
    validPositions: ['return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-router-transfer',
    status: 'existing'
  }),
  surface({
    id: 'ctx.param',
    class: 'sync',
    canonicalOperation: 'context.param.string',
    publicForms: ['ctx.param(name)'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['expression', 'return', 'condition'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'direct-context-lookup',
    status: 'existing-alias-normalization'
  }),
  surface({
    id: 'ctx.req.method',
    class: 'sync',
    canonicalOperation: 'context.request.method',
    publicForms: ['ctx.req.method'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['expression', 'return', 'condition'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'direct-request-frame-lookup',
    status: 'existing-alias-normalization'
  }),
  surface({
    id: 'ctx.req.url',
    class: 'sync',
    canonicalOperation: 'context.request.url',
    publicForms: ['ctx.req.url'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['expression', 'return', 'condition'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'direct-request-frame-lookup',
    status: 'supported'
  }),
  surface({
    id: 'ctx.req.path',
    class: 'sync',
    canonicalOperation: 'context.request.path',
    publicForms: ['ctx.req.path'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['expression', 'return', 'condition'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'direct-request-frame-lookup',
    status: 'existing-alias-normalization'
  }),
  surface({
    id: 'ctx.req.header',
    class: 'sync',
    canonicalOperation: 'context.request.header.first',
    publicForms: ['ctx.req.header(name)'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['expression', 'return', 'condition'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'direct-request-header-lookup',
    status: 'existing-alias-normalization'
  }),
  surface({
    id: 'ctx.req.headers',
    class: 'sync',
    canonicalOperation: 'context.request.headers.snapshot',
    publicForms: ['ctx.req.headers'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['expression', 'return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'immutable-request-header-snapshot',
    status: 'supported'
  }),
  surface({
    id: 'ctx.event.type',
    class: 'sync',
    canonicalOperation: 'context.event.type',
    publicForms: ['ctx.event.type'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['expression', 'condition'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'compile-time exact event selection literal',
    status: 'supported'
  }),
  surface({
    id: 'ctx.event.payload',
    class: 'sync',
    canonicalOperation: 'context.event.payload',
    publicForms: ['ctx.event.payload'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['expression', 'condition'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'host-owned immutable schema-validated value handle',
    schemaPolicy: 'registration-owned',
    status: 'supported'
  }),
  surface({
    id: 'ctx.state.get',
    class: 'sync',
    canonicalOperation: 'context.state.get.string',
    publicForms: ['ctx.state.get(key)'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['expression', 'return', 'condition'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'request-local-string-table-get',
    status: 'restore-public-surface'
  }),
  surface({
    id: 'ctx.state.set',
    class: 'sync',
    canonicalOperation: 'context.state.set.string',
    publicForms: ['ctx.state.set(key, value)'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['statement'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'request-local-string-table-set',
    status: 'restore-public-surface'
  }),
  ...['error', 'warn', 'info', 'debug'].map((level) => surface({
    id: `ctx.log.${level}`,
    class: 'sync',
    canonicalOperation: `logging.${level}`,
    publicForms: [`ctx.log.${level}(message)`],
    awaitPolicy: 'synchronous-statement-only',
    validPositions: ['statement'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-synchronous-log-or-prune-by-resolved-reporting-level',
    status: 'supported'
  })),
  surface({
    id: 'ctx.json',
    class: 'sync',
    canonicalOperation: 'result.json',
    publicForms: ['ctx.json(value, options?)'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'construct-canonical-result',
    status: 'existing-alias-normalization'
  }),
  surface({
    id: 'ctx.encodeJson',
    class: 'sync',
    canonicalOperation: 'schema.encode.text',
    publicForms: ["ctx.encodeJson(value, 'schema.id')"],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['expression', 'statement', 'return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'schema-validated-bounded-json-text',
    schemaPolicy: 'literal-schema-required',
    status: 'supported'
  }),
  surface({
    id: 'ctx.text',
    class: 'sync',
    canonicalOperation: 'result.text',
    publicForms: ['ctx.text(value, options?)'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'construct-canonical-result',
    status: 'existing-alias-normalization'
  }),
  surface({
    id: 'ctx.response',
    class: 'sync',
    canonicalOperation: 'result.response',
    publicForms: ['ctx.response(input?)'],
    awaitPolicy: 'optional-redundant-warning',
    validPositions: ['return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'construct-canonical-result',
    status: 'existing-alias-normalization'
  }),
  surface({
    id: 'ctx.req.text',
    class: 'effect',
    canonicalOperation: 'effect.request-body.text',
    publicForms: ['ctx.req.text()'],
    awaitPolicy: 'required-when-consumed',
    validPositions: ['await-expression', 'return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-effect-and-continuation',
    status: 'supported'
  }),
  surface({
    id: 'ctx.req.json.schema',
    class: 'effect',
    canonicalOperation: 'effect.request-body.json.schema',
    publicForms: ["ctx.req.json<T>('schema.id')"],
    awaitPolicy: 'required-when-consumed',
    validPositions: ['await-expression', 'return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-body-effect-and-specialized-decode',
    schemaPolicy: 'literal-schema-required',
    status: 'supported'
  }),
  surface({
    id: 'ctx.req.json.generic',
    class: 'effect',
    canonicalOperation: 'effect.request-body.json.generic',
    publicForms: ['ctx.req.json<T>()'],
    awaitPolicy: 'required-when-consumed',
    validPositions: ['await-expression', 'return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-body-effect-and-generic-parser',
    schemaPolicy: 'allowed-only-when-pulse-strict-false',
    status: 'supported-when-nonstrict'
  }),
  surface({
    id: 'ctx.parallel',
    class: 'effect',
    canonicalOperation: 'effect.group.parallel',
    publicForms: ['ctx.parallel({ key: pulseEffect, ... })'],
    awaitPolicy: 'required-when-consumed',
    validPositions: ['await-expression'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-explicit-effect-group-and-continuation',
    shapePolicy: 'static-nonempty-object-literal-with-fixed-non-index-string-keys-and-pulse-effect-values',
    status: 'supported'
  }),
  surface({
    id: 'ctx.fetch.projected',
    class: 'effect',
    canonicalOperation: 'effect.backend-fetch.projected',
    publicForms: ['ctx.fetch(url, init?).json<T>(schemaId?)', 'ctx.fetch(url, init?).text()'],
    awaitPolicy: 'required-when-consumed',
    validPositions: ['await-expression', 'return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-fetch-effect-projection-and-continuation',
    status: 'supported'
  }),
  surface({
    id: 'ctx.fetch.opaque-return',
    class: 'effect',
    canonicalOperation: 'effect.backend-fetch.opaque-return',
    publicForms: ['return ctx.fetch(url, init?)'],
    awaitPolicy: 'return-adopted-or-required',
    validPositions: ['return', 'await-expression'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-terminal-fetch-effect',
    status: 'supported'
  }),
  surface({
    id: 'ctx.config.get',
    class: 'effect',
    canonicalOperation: 'effect.binding.config.get',
    publicForms: ['ctx.config.get(name)'],
    awaitPolicy: 'required-when-consumed',
    validPositions: ['await-expression', 'return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-config-binding-effect',
    status: 'supported'
  }),
  surface({
    id: 'ctx.secret.get',
    class: 'effect',
    canonicalOperation: 'effect.binding.secret.get',
    publicForms: ['ctx.secret.get(name)'],
    awaitPolicy: 'required-when-consumed',
    validPositions: ['await-expression', 'return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-secret-binding-effect',
    redaction: 'required',
    status: 'supported'
  }),
  surface({
    id: 'ctx.kv.get',
    class: 'effect',
    canonicalOperation: 'effect.kv.get',
    publicForms: ["ctx.kv<T>('namespace').get(key)"],
    awaitPolicy: 'required-when-consumed',
    validPositions: ['await-expression', 'return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-kv-get-effect',
    status: 'supported'
  }),
  surface({
    id: 'ctx.kv.put',
    class: 'effect',
    canonicalOperation: 'effect.kv.put',
    publicForms: ["ctx.kv<T>('namespace').put(key, value)"],
    awaitPolicy: 'required-when-consumed',
    validPositions: ['await-expression', 'return'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-kv-put-effect',
    status: 'supported'
  }),
  ...['getVersioned', 'insertIfAbsent', 'compareAndSwap'].map((method) => surface({
    id: `ctx.kv.${method}`, class: 'effect', canonicalOperation: `effect.kv.${method}`,
    publicForms: [`ctx.kv<T>('namespace').${method}(${method === 'getVersioned' ? 'key' : method === 'compareAndSwap' ? 'key, generation, value' : 'key, value'})`],
    awaitPolicy: 'required-when-consumed', validPositions: ['await-expression', 'parallel-member'],
    targetSupport: { javascript: true, native: true }, nativeBehavior: 'emit-conditional-kv-effect-and-continuation',
    redaction: 'key-generation-value-required', status: 'supported'
  })),
  surface({
    id: 'ctx.emit',
    class: 'effect',
    canonicalOperation: 'effect.event.emit',
    publicForms: ["ctx.emit(type, { schema: schemaId, payload })", "ctx.emit(type, { schema: null })"],
    awaitPolicy: 'required-when-consumed',
    validPositions: ['await-expression', 'parallel-member'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'emit-canonical-event-effect-and-continuation',
    schemaPolicy: 'literal-type-and-schema-required',
    redaction: 'payload-required',
    status: 'supported'
  }),
  surface({
    id: 'package.operation',
    class: 'package-owned',
    canonicalOperation: 'package.operation',
    publicForms: ['manifest-declared-package-operation'],
    awaitPolicy: 'manifest-owned',
    validPositions: ['manifest-declared'],
    targetSupport: { javascript: true, native: true },
    nativeBehavior: 'delegate-canonical-package-operation-to-trusted-lowerer',
    status: 'existing-seam'
  }),
  surface({
    id: 'javascript.await',
    class: 'javascript-only',
    canonicalOperation: 'javascript.await',
    publicForms: ['await arbitraryLibraryCall()'],
    awaitPolicy: 'native-boundary',
    validPositions: ['await-expression'],
    targetSupport: { javascript: true, native: false },
    nativeBehavior: 'record-first-native-eligibility-boundary',
    status: 'supported-diagnostic'
  })
]);

function buildHandlerSurfaceRegistry(definitions = HANDLER_SURFACE_DEFINITIONS) {
  const byId = new Map();
  const byCanonicalOperation = new Map();
  for (const definition of definitions) {
    if (!definition || typeof definition !== 'object') throw new TypeError('Handler surface definition must be an object.');
    if (!definition.id || typeof definition.id !== 'string') throw new TypeError('Handler surface definition requires an id.');
    if (!HANDLER_SURFACE_CLASSES.includes(definition.class)) throw new TypeError(`Handler surface ${definition.id} has unsupported class ${definition.class}.`);
    if (!AWAIT_POLICIES.includes(definition.awaitPolicy)) throw new TypeError(`Handler surface ${definition.id} has unsupported await policy ${definition.awaitPolicy}.`);
    if (byId.has(definition.id)) throw new TypeError(`Duplicate handler surface id: ${definition.id}`);
    if (byCanonicalOperation.has(definition.canonicalOperation)) {
      throw new TypeError(`Duplicate canonical handler operation: ${definition.canonicalOperation}`);
    }
    byId.set(definition.id, definition);
    byCanonicalOperation.set(definition.canonicalOperation, definition);
  }
  return Object.freeze({
    version: HANDLER_SURFACE_CONTRACT_VERSION,
    contractId: HANDLER_SURFACE_CONTRACT_ID,
    definitions: Object.freeze(Array.from(definitions)),
    get(id) {
      return byId.get(id);
    },
    getByCanonicalOperation(operation) {
      return byCanonicalOperation.get(operation);
    },
    has(id) {
      return byId.has(id);
    }
  });
}

const DEFAULT_HANDLER_SURFACE_REGISTRY = buildHandlerSurfaceRegistry();

function classifyHandlerSurface(surfaceId, options = {}) {
  const definition = DEFAULT_HANDLER_SURFACE_REGISTRY.get(surfaceId);
  if (!definition) {
    return Object.freeze({
      ok: false,
      surfaceId,
      classification: 'unsupported',
      severity: 'error',
      code: HANDLER_SURFACE_DIAGNOSTICS.unsupportedSurface,
      message: `Unsupported Pulse handler surface: ${surfaceId}`
    });
  }

  if (surfaceId === 'ctx.req.json.generic' && options.strict !== false) {
    return Object.freeze({
      ok: false,
      surfaceId,
      definition,
      classification: definition.class,
      severity: 'error',
      code: HANDLER_SURFACE_DIAGNOSTICS.schemaRequired,
      message: 'Schema-less request JSON requires pulse.strict to be false.'
    });
  }

  return Object.freeze({
    ok: true,
    surfaceId,
    definition,
    classification: definition.class,
    canonicalOperation: definition.canonicalOperation,
    nativeEligible: definition.targetSupport.native
  });
}

function classifyAwaitUse(surfaceId, options = {}) {
  const classified = classifyHandlerSurface(surfaceId, options);
  if (!classified.ok) return classified;
  const definition = classified.definition;
  const awaited = options.awaited === true;
  const consumed = options.consumed !== false;
  const position = options.position || (awaited ? 'await-expression' : 'expression');

  if (definition.awaitPolicy === 'not-applicable') {
    return Object.freeze({ ...classified, action: 'preserve-handler-shape', severity: 'none', code: null });
  }
  if (definition.awaitPolicy === 'forbidden') {
    if (awaited || position !== 'return') {
      return Object.freeze({
        ...classified,
        ok: false,
        action: 'reject',
        severity: 'error',
        code: HANDLER_SURFACE_DIAGNOSTICS.nextTerminal,
        message: 'next() is a terminal Router control transfer and must be returned directly.'
      });
    }
    return Object.freeze({ ...classified, action: 'emit-terminal-transfer', severity: 'none', code: null });
  }
  if (definition.awaitPolicy === 'synchronous-statement-only') {
    if (awaited || position !== 'statement') {
      return Object.freeze({
        ...classified,
        ok: false,
        action: 'reject',
        severity: 'error',
        code: HANDLER_SURFACE_DIAGNOSTICS.logAwaitForbidden,
        message: `${surfaceId} is synchronous, returns void, and must be used as a standalone statement.`
      });
    }
    return Object.freeze({ ...classified, action: 'lower-sync-statement', severity: 'none', code: null });
  }
  if (definition.awaitPolicy === 'optional-redundant-warning') {
    if (awaited) {
      return Object.freeze({
        ...classified,
        action: 'erase-await',
        severity: 'warning',
        code: HANDLER_SURFACE_DIAGNOSTICS.redundantSyncAwait,
        message: `await is redundant for synchronous Pulse surface ${surfaceId}.`
      });
    }
    return Object.freeze({ ...classified, action: 'lower-sync', severity: 'none', code: null });
  }
  if (definition.awaitPolicy === 'required-when-consumed') {
    if (!awaited && consumed && position !== 'return') {
      return Object.freeze({
        ...classified,
        ok: false,
        action: 'reject',
        severity: 'error',
        code: HANDLER_SURFACE_DIAGNOSTICS.effectAwaitRequired,
        message: `Pulse effect ${surfaceId} must be awaited before its value is consumed.`
      });
    }
    return Object.freeze({
      ...classified,
      action: position === 'return' && !awaited ? 'lower-returned-effect' : 'lower-effect',
      severity: 'none',
      code: null
    });
  }
  if (definition.awaitPolicy === 'return-adopted-or-required') {
    if (!awaited && position !== 'return') {
      return Object.freeze({
        ...classified,
        ok: false,
        action: 'reject',
        severity: 'error',
        code: HANDLER_SURFACE_DIAGNOSTICS.effectAwaitRequired,
        message: `Pulse effect ${surfaceId} must be awaited unless returned as the terminal handler result.`
      });
    }
    return Object.freeze({
      ...classified,
      action: awaited ? 'lower-effect' : 'lower-terminal-effect',
      severity: 'none',
      code: null
    });
  }
  if (definition.awaitPolicy === 'manifest-owned') {
    return Object.freeze({ ...classified, action: 'delegate-to-package-contract', severity: 'none', code: null });
  }
  if (definition.awaitPolicy === 'native-boundary') {
    return Object.freeze({
      ...classified,
      action: 'record-native-boundary',
      severity: 'error-for-native',
      code: HANDLER_SURFACE_DIAGNOSTICS.nativeAwaitUnsupported,
      message: 'Native Pulse supports await only on recognized Pulse effects.'
    });
  }
  throw new TypeError(`Unhandled await policy ${definition.awaitPolicy}.`);
}

function handlerSurfaceContract(definitions) {
  return Object.freeze({
    version: HANDLER_SURFACE_CONTRACT_VERSION,
    contractId: HANDLER_SURFACE_CONTRACT_ID,
    classes: HANDLER_SURFACE_CLASSES,
    awaitPolicies: AWAIT_POLICIES,
    diagnostics: HANDLER_SURFACE_DIAGNOSTICS,
    definitions,
    policies: Object.freeze({
      managedHandlersAsyncShaped: true,
      nativePromiseRuntime: false,
      nativeAsyncify: false,
      redundantSyncAwaitIsFatal: false,
      arbitraryAwaitChangesTargetAutomatically: false,
      authoredThrowSupported: false,
      nextIsTerminal: true
    })
  });
}

function defaultHandlerSurfaceContract() {
  return handlerSurfaceContract(HANDLER_SURFACE_DEFINITIONS);
}

module.exports = {
  HANDLER_SURFACE_CONTRACT_VERSION,
  HANDLER_AUTHORING_POLICY_VERSION,
  HANDLER_AUTHORING_MODES,
  HANDLER_SURFACE_CONTRACT_ID,
  HANDLER_SURFACE_CLASSES,
  AWAIT_POLICIES,
  HANDLER_SURFACE_DIAGNOSTICS,
  HANDLER_SURFACE_DEFINITIONS,
  DEFAULT_HANDLER_SURFACE_REGISTRY,
  buildHandlerSurfaceRegistry,
  classifyHandlerSurface,
  classifyAwaitUse,
  defaultHandlerSurfaceContract
};
