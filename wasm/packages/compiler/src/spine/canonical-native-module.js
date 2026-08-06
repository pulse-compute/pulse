'use strict';

const { defineCompilerSpineSegment, definePhaseAdapter } = require('./pipeline.js');

const traces = new WeakMap();
const facts = new WeakMap();

const CANONICAL_NATIVE_MODULE_SPINE = defineCompilerSpineSegment({
  id: 'pulse.compiler.canonical-native-module.v1',
  phases: ['native-realization', 'guest-realization', 'artifact-verification'],
  adapters: [
    definePhaseAdapter({
      id: 'pulse.canonical-native-module.native-realization',
      phase: 'native-realization',
      mode: 'provider-neutral-primary-assemblyscript-compilation',
      inputKind: 'provider-neutral-native-plan',
      outputKind: 'primary-native-realization-envelope',
      run({ value, context }) {
        const providerRequirements = context.resolveProviderRequirements(value.plan);
        return Object.freeze({
          plan: value.plan,
          options: value.options,
          providerRequirements,
          realization: context.realize(value.plan, value.options, providerRequirements)
        });
      }
    }),
    definePhaseAdapter({
      id: 'pulse.canonical-native-module.guest-realization',
      phase: 'guest-realization',
      mode: 'selected-first-party-core-wasm-composition',
      inputKind: 'primary-native-realization-envelope',
      outputKind: 'portable-native-realization-envelope',
      run({ value, context }) {
        return Object.freeze({
          ...value,
          realization: context.realizeGuests(value.realization, value.plan, value.options)
        });
      }
    }),
    definePhaseAdapter({
      id: 'pulse.canonical-native-module.artifact-verification',
      phase: 'artifact-verification',
      mode: 'canonical-native-wasm-verification',
      inputKind: 'portable-native-realization-envelope',
      outputKind: 'verified-portable-native-wasm-artifact',
      run({ value, context }) {
        const compiled = context.verify(value.realization, value.plan, value.options, value.providerRequirements);
        return Object.freeze({ ...value, compiled });
      }
    })
  ]
});

function executeCanonicalNativeModuleSpine(plan, options, realization) {
  if (!realization || typeof realization !== 'object') {
    throw new TypeError('executeCanonicalNativeModuleSpine requires realization functions.');
  }
  for (const key of ['resolveProviderRequirements', 'realize', 'realizeGuests', 'verify']) {
    if (typeof realization[key] !== 'function') throw new TypeError(`executeCanonicalNativeModuleSpine requires ${key}.`);
  }
  const result = CANONICAL_NATIVE_MODULE_SPINE.run(Object.freeze({ plan, options }), realization);
  const envelope = result.output;
  if (envelope && envelope.compiled && typeof envelope.compiled === 'object') {
    traces.set(envelope.compiled, result.trace);
    facts.set(envelope.compiled, Object.freeze({
      providerRequirements: envelope.providerRequirements,
      realization: envelope.realization
    }));
  }
  return envelope.compiled;
}

function traceForCanonicalNativeModule(compiled) {
  return compiled && typeof compiled === 'object' ? traces.get(compiled) : undefined;
}

function realizationFactsForCanonicalNativeModule(compiled) {
  return compiled && typeof compiled === 'object' ? facts.get(compiled) : undefined;
}

module.exports = Object.freeze({
  CANONICAL_NATIVE_MODULE_SPINE,
  executeCanonicalNativeModuleSpine,
  traceForCanonicalNativeModule,
  realizationFactsForCanonicalNativeModule
});
