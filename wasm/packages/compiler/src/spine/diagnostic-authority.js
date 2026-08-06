'use strict';

const DIAGNOSTIC_AUTHORITY_VERSION = 'pulse.compiler-handler-diagnostics.v1';

const FRONTENDS = Object.freeze({
  'canonical-source': Object.freeze({ kind: 'CanonicalCompileDiagnostic' }),
  'canonical-router': Object.freeze({ kind: 'CanonicalRouterCompileDiagnostic' })
});

function message(value) {
  return typeof value === 'function' ? value : () => String(value);
}

function descriptor(definition) {
  return Object.freeze({
    ...definition,
    message: message(definition.message)
  });
}

const HANDLER_DIAGNOSTIC_CATALOG = Object.freeze({
  'handler.async.required': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_HANDLER_ASYNC_REQUIRED',
      message: ({ role }) => `Managed Pulse ${role || 'handler'} must be declared async. Native lowering erases the wrapper and does not include a Promise runtime.`
    }),
    'canonical-router': descriptor({
      code: 'PULSE_HANDLER_ASYNC_REQUIRED',
      message: ({ role }) => `Managed Pulse ${role || 'handler'} must be declared async. Native lowering erases the wrapper and does not include a Promise runtime.`
    })
  }),
  'handler.async.unsupported': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_CANONICAL_ASYNC_HANDLER_UNSUPPORTED',
      message: 'Canonical handlers are synchronous user functions; the compiler owns suspension.'
    }),
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_ASYNC_HANDLER_UNSUPPORTED',
      message: 'Router handlers are synchronous authoring functions; the compiler owns suspension.'
    })
  }),
  'handler.await.unsupported': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_CANONICAL_AWAIT_UNSUPPORTED',
      message: 'Canonical handlers do not expose await/Promise semantics.'
    })
  }),
  'handler.async-function.unsupported': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_CANONICAL_ASYNC_FUNCTION_UNSUPPORTED',
      message: 'Async functions are not available inside canonical handlers; the compiler owns suspension.'
    })
  }),
  'handler.await.native-unsupported': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_NATIVE_AWAIT_UNSUPPORTED',
      message: ({ expression }) => `Native Pulse supports await only on trusted Pulse effects; ${expression || 'this expression'} is not lowerable.`
    }),
    'canonical-router': descriptor({
      code: 'PULSE_NATIVE_AWAIT_UNSUPPORTED',
      message: ({ expression }) => `Native Pulse supports await only on trusted Pulse effects; ${expression || 'this expression'} is not lowerable.`
    })
  }),
  'handler.nested-async-function.unsupported': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_CANONICAL_NESTED_ASYNC_FUNCTION_UNSUPPORTED',
      message: 'Nested async functions are outside managed Pulse handler lowering.'
    }),
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_NESTED_ASYNC_FUNCTION_UNSUPPORTED',
      message: 'Nested async functions are outside managed Pulse Router handler lowering.'
    })
  }),
  'handler.promise.unsupported': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_CANONICAL_PROMISE_UNSUPPORTED',
      message: ({ construction }) => construction
        ? 'Canonical handlers do not expose Promise construction.'
        : 'Canonical handlers do not expose Promise APIs.'
    })
  }),
  'handler.context-identifier.required': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_CANONICAL_CTX_IDENTIFIER_REQUIRED',
      message: 'The ctx parameter must be a simple identifier.'
    })
  }),
  'handler.generator.unsupported': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_CANONICAL_GENERATOR_HANDLER_UNSUPPORTED',
      message: 'Generator handlers are outside the canonical handler subset.'
    }),
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_GENERATOR_HANDLER_UNSUPPORTED',
      message: 'Generator Router handlers are outside the canonical Router subset.'
    })
  }),
  'handler.signature.invalid': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_HANDLER_SIGNATURE',
      message: ({ role, expected }) => `Canonical ${role} handlers must use ${expected}.`
    })
  }),
  'handler.nested-function.unsupported': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_NESTED_FUNCTION_UNSUPPORTED',
      message: 'Nested functions are outside terminal Router handler lowering. Move helper logic into straight-line handler code.'
    })
  }),
  'handler.throw.unsupported': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_THROW_UNSUPPORTED',
      message: 'Use terminal return next(error) to enter the Router error lane; throw is not part of canonical Router middleware.'
    })
  }),
  'router.next.not-terminal': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_NEXT_NOT_TERMINAL',
      message: ({ reference }) => reference
        ? 'The next control-transfer function may only appear in terminal return next() or return next(error).'
        : 'next() is a terminal Router control transfer and must be used as return next(). The current handler never resumes afterward.'
    })
  }),
  'router.next.arity': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_NEXT_ARITY',
      message: 'next() accepts zero arguments for normal transfer or one error value for error-lane transfer.'
    })
  }),
  'router.error.shadowed': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_ERROR_SHADOWED',
      message: ({ errorName }) => `Error middleware may not shadow its ${errorName} parameter.`
    })
  }),
  'context.param.outside-route': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_PARAM_OUTSIDE_ROUTE',
      message: 'ctx.param() is available only inside a matched route handler.'
    })
  }),
  'context.param.arity': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_PARAM_ARITY',
      message: 'ctx.param() requires exactly one static parameter name.'
    })
  }),
  'context.param.dynamic': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_PARAM_DYNAMIC',
      message: 'ctx.param() requires a string literal parameter name.'
    })
  }),
  'context.param.unknown': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_PARAM_UNKNOWN',
      message: ({ route, name }) => `Route ${route} does not declare parameter ${JSON.stringify(name)}.`
    })
  }),
  'context.resolve.retired': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_RESOLVE_RETIRED',
      message: 'ctx.resolve is not part of canonical Router authoring. Effects are inferred by the canonical compiler.'
    })
  }),
  'context.resolved.retired': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_RESOLVED_RETIRED',
      message: 'ctx.resolved is not part of canonical Router authoring.'
    })
  }),
  'handler.unreachable-after-terminal': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_UNREACHABLE_AFTER_TERMINAL',
      message: 'Statements after a terminal response or next() transfer are unreachable.'
    })
  }),
  'handler.return-value.required': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_RETURN_VALUE_REQUIRED',
      message: 'Router handlers must return a Pulse response or terminal next() transfer.'
    })
  }),
  'handler.fallthrough': Object.freeze({
    'canonical-router': descriptor({
      code: 'PULSE_CANONICAL_ROUTER_HANDLER_FALLTHROUGH',
      message: ({ role }) => `Canonical ${role} handlers must return a Pulse response or terminal next() transfer on every path.`
    })
  }),
  'effect.fetch.position': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_CANONICAL_FETCH_POSITION_UNSUPPORTED',
      message: 'ctx.fetch must initialize a local variable, appear in a consecutive independent fetch group, or be returned directly for opaque pass-through.'
    })
  }),
  'effect.fetch.value-return': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_CANONICAL_FETCH_VALUE_RETURN_UNSUPPORTED',
      message: 'Return a Pulse response, not a decoded fetch body value. Wrap decoded data with ctx.json or ctx.text.'
    })
  }),
  'effect.provider.position': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_CANONICAL_PROVIDER_EFFECT_POSITION_UNSUPPORTED',
      message: ({ kind }) => `${kind} must initialize a local variable or, for kv.put, appear as a standalone statement so the compiler can own suspension.`
    })
  }),
  'effect.package.position': Object.freeze({
    'canonical-source': descriptor({
      code: 'PULSE_CANONICAL_PACKAGE_EFFECT_POSITION_UNSUPPORTED',
      message: ({ kind, placement }) => placement === 'statement'
        ? `${kind} was not declared as a standalone package effect.`
        : `${kind} must be returned directly from the handler branch.`
    })
  })
});

function positionFor(sourceFile, node) {
  const target = node || sourceFile;
  const offset = target && typeof target.getStart === 'function' ? target.getStart(sourceFile) : 0;
  const point = sourceFile.getLineAndCharacterOfPosition(offset);
  return Object.freeze({ line: point.line + 1, column: point.character + 1, offset });
}

function createCanonicalDiagnostic(options) {
  const frontend = FRONTENDS[options.frontend];
  if (!frontend) throw new TypeError(`Unknown canonical diagnostic frontend: ${options.frontend}`);
  const sourceFile = options.sourceFile;
  if (!sourceFile || typeof sourceFile.getLineAndCharacterOfPosition !== 'function') {
    throw new TypeError('Canonical diagnostics require a TypeScript SourceFile.');
  }
  return Object.freeze({
    code: String(options.code),
    kind: frontend.kind,
    severity: String(options.severity || 'error'),
    message: String(options.message),
    file: sourceFile.fileName,
    position: positionFor(sourceFile, options.node || sourceFile),
    detail: Object.freeze({ ...(options.detail || {}) })
  });
}

function createHandlerDiagnostic(options) {
  const byFrontend = HANDLER_DIAGNOSTIC_CATALOG[options.issue];
  const definition = byFrontend && byFrontend[options.frontend];
  if (!definition) {
    throw new TypeError(`Unknown handler diagnostic issue ${options.issue} for ${options.frontend}.`);
  }
  return createCanonicalDiagnostic({
    frontend: options.frontend,
    sourceFile: options.sourceFile,
    node: options.node,
    code: definition.code,
    message: definition.message(Object.freeze({ ...(options.values || {}) })),
    severity: options.severity || 'error',
    detail: options.detail || {}
  });
}

function adaptRouterDiagnostic(sourceFile, entry) {
  const start = entry && entry.loc && entry.loc.start;
  return Object.freeze({
    code: String(entry.code || 'PULSE_CANONICAL_ROUTER_EXTRACT_FAILED'),
    kind: FRONTENDS['canonical-router'].kind,
    severity: String(entry.severity || 'error'),
    message: String(entry.message || 'Router extraction failed.'),
    file: entry && entry.loc && entry.loc.file ? String(entry.loc.file) : sourceFile.fileName,
    position: start
      ? Object.freeze({ line: start.line, column: start.column, offset: start.offset })
      : positionFor(sourceFile, sourceFile),
    detail: Object.freeze({ phase: entry.phase || entry.pass, hint: entry.hint })
  });
}

function diagnosticCatalogSnapshot() {
  return Object.freeze(Object.fromEntries(Object.entries(HANDLER_DIAGNOSTIC_CATALOG).map(([issue, frontends]) => [
    issue,
    Object.freeze(Object.fromEntries(Object.entries(frontends).map(([frontend, definition]) => [frontend, definition.code])))
  ])));
}

module.exports = Object.freeze({
  DIAGNOSTIC_AUTHORITY_VERSION,
  HANDLER_DIAGNOSTIC_CATALOG,
  positionFor,
  createCanonicalDiagnostic,
  createHandlerDiagnostic,
  adaptRouterDiagnostic,
  diagnosticCatalogSnapshot
});
