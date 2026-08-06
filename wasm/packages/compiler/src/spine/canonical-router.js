'use strict';

const { defineCompilerSpineSegment, definePhaseAdapter } = require('./pipeline.js');
const {
  inspectCanonicalRouterSurfaces,
  classifyCanonicalRouterSurfaces
} = require('./handler-surface-authority.js');
const {
  prepareCanonicalRouterTopology
} = require('./router-topology-frontend.js');
const {
  prepareCanonicalRouterHandlers
} = require('./router-handler-frontend.js');
const {
  emitCanonicalRouterFromHandlerIrs
} = require('./router-handler-ir.js');

const traces = new WeakMap();
const handlerIrBundles = new WeakMap();
const surfaceFacts = new WeakMap();
const topologies = new WeakMap();

const CANONICAL_ROUTER_SPINE = defineCompilerSpineSegment({
  id: 'pulse.compiler.canonical-router.v1',
  phases: [
    'root-extraction',
    'surface-recognition',
    'surface-normalization',
    'semantic-classification',
    'contract-validation',
    'canonical-ir'
  ],
  adapters: [
    definePhaseAdapter({
      id: 'pulse.router.root-extraction',
      phase: 'root-extraction',
      mode: 'router-topology-frontend',
      inputKind: 'router-source-request',
      outputKind: 'canonical-router-topology',
      run({ value }) {
        return prepareCanonicalRouterTopology(value.sourceText, value.options || {});
      }
    }),
    definePhaseAdapter({
      id: 'pulse.shared.router.surface-recognition',
      phase: 'surface-recognition',
      mode: 'shared-router-surface-recognition',
      inputKind: 'canonical-router-topology',
      outputKind: 'recognized-canonical-router',
      run({ value }) {
        return Object.freeze({
          topology: value,
          recognition: inspectCanonicalRouterSurfaces(value, value.options || {})
        });
      }
    }),
    definePhaseAdapter({
      id: 'pulse.shared.router.surface-normalization',
      phase: 'surface-normalization',
      mode: 'behavior-preserving-router-normalization-boundary',
      inputKind: 'recognized-canonical-router',
      outputKind: 'normalized-canonical-router',
      run({ value }) {
        return Object.freeze({
          ...value,
          normalization: Object.freeze({ changed: false, behaviorChangeAllowed: false })
        });
      }
    }),
    definePhaseAdapter({
      id: 'pulse.shared.router.semantic-classification',
      phase: 'semantic-classification',
      mode: 'shared-router-semantic-classification',
      inputKind: 'normalized-canonical-router',
      outputKind: 'classified-canonical-router',
      run({ value }) {
        return Object.freeze({
          ...value,
          classification: classifyCanonicalRouterSurfaces(value.recognition, value.topology.options || {})
        });
      }
    }),
    definePhaseAdapter({
      id: 'pulse.router.handler.contract-validation',
      phase: 'contract-validation',
      mode: 'router-handler-frontend-validation',
      inputKind: 'classified-canonical-router',
      outputKind: 'validated-router-handlers',
      run({ value }) {
        const prepared = prepareCanonicalRouterHandlers(value.topology, value.recognition, value.classification);
        return Object.freeze({ ...value, prepared });
      }
    }),
    definePhaseAdapter({
      id: 'pulse.shared.router.canonical-handler-ir',
      phase: 'canonical-ir',
      mode: 'shared-router-handler-ir',
      inputKind: 'validated-router-handlers',
      outputKind: 'canonical-router-handler-ir-bundle',
      run({ value }) {
        return Object.freeze({
          ...emitCanonicalRouterFromHandlerIrs(value.prepared),
          recognition: value.recognition,
          classification: value.classification,
          normalization: value.normalization,
          topology: value.topology,
          validation: value.prepared.validation
        });
      }
    })
  ]
});

function executeCanonicalRouterSpine(sourceText, options = {}) {
  const result = CANONICAL_ROUTER_SPINE.run(Object.freeze({ sourceText, options }));
  const bundle = result.output;
  const output = bundle.output;
  if (output && typeof output === 'object') {
    traces.set(output, result.trace);
    handlerIrBundles.set(output, bundle.handlers);
    surfaceFacts.set(output, Object.freeze({
      recognition: bundle.recognition,
      classification: bundle.classification,
      normalization: bundle.normalization,
      validation: bundle.validation
    }));
    topologies.set(output, bundle.topology);
  }
  return output;
}

function traceForCanonicalRouterOutput(output) {
  return output && typeof output === 'object' ? traces.get(output) : undefined;
}

function handlerIrsForCanonicalRouterOutput(output) {
  return output && typeof output === 'object' ? handlerIrBundles.get(output) : undefined;
}

function surfaceFactsForCanonicalRouterOutput(output) {
  return output && typeof output === 'object' ? surfaceFacts.get(output) : undefined;
}

function topologyForCanonicalRouterOutput(output) {
  return output && typeof output === 'object' ? topologies.get(output) : undefined;
}

module.exports = Object.freeze({
  CANONICAL_ROUTER_SPINE,
  executeCanonicalRouterSpine,
  traceForCanonicalRouterOutput,
  handlerIrsForCanonicalRouterOutput,
  surfaceFactsForCanonicalRouterOutput,
  topologyForCanonicalRouterOutput
});
