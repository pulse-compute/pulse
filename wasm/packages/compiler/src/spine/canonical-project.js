'use strict';

const { defineCompilerSpineSegment, definePassThroughAdapter, definePhaseAdapter } = require('./pipeline.js');

const traces = new WeakMap();

const CANONICAL_PROJECT_SPINE = defineCompilerSpineSegment({
  id: 'pulse.compiler.canonical-project.v1',
  phases: [
    'root-extraction',
    'surface-recognition',
    'surface-normalization',
    'semantic-classification',
    'contract-validation',
    'canonical-ir'
  ],
  adapters: [
    definePassThroughAdapter({
      id: 'pulse.legacy.canonical-project.root-extraction',
      phase: 'root-extraction',
      inputKind: 'canonical-project-request',
      outputKind: 'legacy-project-request'
    }),
    definePassThroughAdapter({
      id: 'pulse.legacy.canonical-project.surface-recognition',
      phase: 'surface-recognition',
      inputKind: 'legacy-project-request',
      outputKind: 'legacy-project-request'
    }),
    definePassThroughAdapter({
      id: 'pulse.legacy.canonical-project.surface-normalization',
      phase: 'surface-normalization',
      inputKind: 'legacy-project-request',
      outputKind: 'legacy-project-request'
    }),
    definePassThroughAdapter({
      id: 'pulse.legacy.canonical-project.semantic-classification',
      phase: 'semantic-classification',
      inputKind: 'legacy-project-request',
      outputKind: 'legacy-project-request'
    }),
    definePassThroughAdapter({
      id: 'pulse.legacy.canonical-project.contract-validation',
      phase: 'contract-validation',
      inputKind: 'legacy-project-request',
      outputKind: 'legacy-project-request'
    }),
    definePhaseAdapter({
      id: 'pulse.legacy.canonical-project.canonical-ir',
      phase: 'canonical-ir',
      mode: 'legacy-envelope',
      inputKind: 'legacy-project-request',
      outputKind: 'canonical-project-program',
      run({ value, context }) {
        return context.compileLegacy(value.entryFile, value.options);
      }
    })
  ]
});

function executeCanonicalProjectSpine(entryFile, options, compileLegacy) {
  if (typeof compileLegacy !== 'function') throw new TypeError('executeCanonicalProjectSpine requires a legacy compiler function.');
  const result = CANONICAL_PROJECT_SPINE.run(Object.freeze({ entryFile, options }), { compileLegacy });
  if (result.output && typeof result.output === 'object') traces.set(result.output, result.trace);
  return result.output;
}

function traceForCanonicalProjectOutput(output) {
  return output && typeof output === 'object' ? traces.get(output) : undefined;
}

module.exports = Object.freeze({
  CANONICAL_PROJECT_SPINE,
  executeCanonicalProjectSpine,
  traceForCanonicalProjectOutput
});
