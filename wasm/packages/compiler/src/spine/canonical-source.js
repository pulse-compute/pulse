'use strict';

const { defineCompilerSpineSegment, definePhaseAdapter } = require('./pipeline.js');
const {
  inspectCanonicalSourceSurfaces,
  classifyCanonicalSourceSurfaces
} = require('./handler-surface-authority.js');
const {
  preparePlainHandlerSource,
  assertPlainHandlerDiagnostics
} = require('./plain-handler-frontend.js');
const {
  buildPlainHandlerIr
} = require('./handler-ir.js');
const {
  createCanonicalHandlerIr,
  payloadForCanonicalHandlerIr
} = require('./canonical-handler-ir.js');

const traces = new WeakMap();
const handlerIrs = new WeakMap();

const CANONICAL_SOURCE_SPINE = defineCompilerSpineSegment({
  id: 'pulse.compiler.canonical-source.v1',
  phases: [
    'surface-recognition',
    'surface-normalization',
    'semantic-classification',
    'contract-validation',
    'canonical-ir'
  ],
  adapters: [
    definePhaseAdapter({
      id: 'pulse.shared.canonical-source.surface-recognition',
      phase: 'surface-recognition',
      mode: 'shared-surface-recognition',
      inputKind: 'canonical-source-request',
      outputKind: 'recognized-canonical-source-request',
      run({ value, context }) {
        return Object.freeze({
          request: value,
          recognition: context.inspectSurfaces(value.sourceText, value.options || {})
        });
      }
    }),
    definePhaseAdapter({
      id: 'pulse.shared.canonical-source.surface-normalization',
      phase: 'surface-normalization',
      mode: 'behavior-preserving-normalization-boundary',
      inputKind: 'recognized-canonical-source-request',
      outputKind: 'normalized-canonical-source-request',
      run({ value }) {
        return Object.freeze({ ...value, normalization: Object.freeze({ changed: false }) });
      }
    }),
    definePhaseAdapter({
      id: 'pulse.shared.canonical-source.semantic-classification',
      phase: 'semantic-classification',
      mode: 'shared-semantic-classification',
      inputKind: 'normalized-canonical-source-request',
      outputKind: 'classified-canonical-source-request',
      run({ value, context }) {
        return Object.freeze({
          ...value,
          classification: context.classifySurfaces(value.recognition, value.request.options || {})
        });
      }
    }),
    definePhaseAdapter({
      id: 'pulse.plain-handler.canonical-source.contract-validation',
      phase: 'contract-validation',
      mode: 'plain-handler-frontend-validation',
      inputKind: 'classified-canonical-source-request',
      outputKind: 'validated-canonical-handler-source',
      run({ value }) {
        const frontend = preparePlainHandlerSource(value.request.sourceText, value.request.options || {}, value.recognition);
        return Object.freeze({
          ...value,
          frontend,
          validation: Object.freeze({
            authority: 'plain-handler-frontend',
            frontendVersion: frontend.version,
            recognitionAstReused: frontend.reusedRecognitionAst,
            behaviorChangeAllowed: false
          })
        });
      }
    }),
    definePhaseAdapter({
      id: 'pulse.shared.canonical-source.canonical-handler-ir',
      phase: 'canonical-ir',
      mode: 'shared-canonical-handler-ir',
      inputKind: 'validated-canonical-handler-source',
      outputKind: 'canonical-handler-ir',
      run({ value, context }) {
        const operationIr = buildPlainHandlerIr(value.frontend, value.request.options || {});
        assertPlainHandlerDiagnostics(value.frontend);
        return createCanonicalHandlerIr({
          frontend: value.frontend,
          operationIr,
          options: value.request.options || {},
          compilerVersion: context.compilerVersion,
          programVersion: context.programVersion,
          runtimeProtocolVersion: context.runtimeProtocolVersion,
          surfaceFacts: Object.freeze({
            recognition: value.recognition,
            classification: value.classification,
            normalization: value.frontend.normalization || value.normalization,
            validation: value.validation
          })
        });
      }
    })
  ]
});

function executeCanonicalSourceSpine(sourceText, options, implementation) {
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('executeCanonicalSourceSpine requires a canonical-source implementation object.');
  }
  for (const name of ['compilerVersion', 'programVersion', 'runtimeProtocolVersion']) {
    if (typeof implementation[name] !== 'string' || implementation[name].length === 0) {
      throw new TypeError(`executeCanonicalSourceSpine requires ${name}.`);
    }
  }
  if (typeof implementation.emitCanonicalProgram !== 'function') {
    throw new TypeError('executeCanonicalSourceSpine requires emitCanonicalProgram.');
  }
  const result = CANONICAL_SOURCE_SPINE.run(Object.freeze({ sourceText, options }), {
    compilerVersion: implementation.compilerVersion,
    programVersion: implementation.programVersion,
    runtimeProtocolVersion: implementation.runtimeProtocolVersion,
    inspectSurfaces: inspectCanonicalSourceSurfaces,
    classifySurfaces: classifyCanonicalSourceSurfaces
  });
  const output = implementation.emitCanonicalProgram(result.output);
  if (output && typeof output === 'object') {
    traces.set(output, result.trace);
    handlerIrs.set(output, result.output);
  }
  return output;
}

function traceForCanonicalSourceOutput(output) {
  return output && typeof output === 'object' ? traces.get(output) : undefined;
}

function handlerIrForCanonicalSourceOutput(output) {
  return output && typeof output === 'object' ? handlerIrs.get(output) : undefined;
}

function surfaceFactsForCanonicalSourceOutput(output) {
  const ir = handlerIrForCanonicalSourceOutput(output);
  if (!ir) return undefined;
  const payload = payloadForCanonicalHandlerIr(ir);
  return payload && payload.surfaceFacts;
}

module.exports = Object.freeze({
  CANONICAL_SOURCE_SPINE,
  executeCanonicalSourceSpine,
  traceForCanonicalSourceOutput,
  handlerIrForCanonicalSourceOutput,
  surfaceFactsForCanonicalSourceOutput
});
