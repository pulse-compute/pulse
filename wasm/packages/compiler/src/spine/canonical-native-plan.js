'use strict';

const { defineCompilerSpineSegment, definePhaseAdapter } = require('./pipeline.js');
const {
  packageOperationRecognitionForCompiled,
  packageOperationRecognitionFromEffects,
  lowerCanonicalPackageOperations
} = require('./package-operation-seam.js');
const { collectProviderRequirements } = require('./provider-requirement-authority.js');

const traces = new WeakMap();
const facts = new WeakMap();

const CANONICAL_NATIVE_PLAN_SPINE = defineCompilerSpineSegment({
  id: 'pulse.compiler.canonical-native-plan.v1',
  phases: ['native-lowering', 'package-lowering'],
  adapters: [
    definePhaseAdapter({
      id: 'pulse.canonical-native-plan.native-lowering',
      phase: 'native-lowering',
      mode: 'canonical-native-plan-builder',
      inputKind: 'canonical-program',
      outputKind: 'canonical-native-plan-envelope',
      run({ value, context }) {
        return Object.freeze({
          compiled: value.compiled,
          options: value.options,
          plan: context.buildNativePlan(value.compiled, value.options)
        });
      }
    }),
    definePhaseAdapter({
      id: 'pulse.canonical-native-plan.package-lowering',
      phase: 'package-lowering',
      mode: 'canonical-package-operations-only',
      inputKind: 'canonical-native-plan-envelope',
      outputKind: 'provider-neutral-native-plan-envelope',
      run({ value }) {
        const recognition = packageOperationRecognitionForCompiled(value.compiled)
          || packageOperationRecognitionFromEffects((value.compiled.metadata && value.compiled.metadata.packageEffects) || []);
        const packageLowering = lowerCanonicalPackageOperations(recognition);
        const providerRequirements = collectProviderRequirements(value.plan, packageLowering);
        return Object.freeze({ ...value, recognition, packageLowering, providerRequirements });
      }
    })
  ]
});

function executeCanonicalNativePlanSpine(compiled, options, buildNativePlan) {
  if (typeof buildNativePlan !== 'function') throw new TypeError('executeCanonicalNativePlanSpine requires a native-plan builder.');
  const result = CANONICAL_NATIVE_PLAN_SPINE.run(Object.freeze({ compiled, options }), { buildNativePlan });
  const envelope = result.output;
  if (envelope && envelope.plan && typeof envelope.plan === 'object') {
    traces.set(envelope.plan, result.trace);
    facts.set(envelope.plan, Object.freeze({
      packageRecognition: envelope.recognition,
      packageLowering: envelope.packageLowering,
      providerRequirements: envelope.providerRequirements
    }));
  }
  return envelope.plan;
}

function traceForCanonicalNativePlan(plan) {
  return plan && typeof plan === 'object' ? traces.get(plan) : undefined;
}

function loweringFactsForCanonicalNativePlan(plan) {
  return plan && typeof plan === 'object' ? facts.get(plan) : undefined;
}

function packageLoweringForCanonicalNativePlan(plan) {
  const record = loweringFactsForCanonicalNativePlan(plan);
  return record && record.packageLowering;
}

function providerRequirementsForCanonicalNativePlan(plan) {
  const record = loweringFactsForCanonicalNativePlan(plan);
  return record && record.providerRequirements;
}

module.exports = Object.freeze({
  CANONICAL_NATIVE_PLAN_SPINE,
  executeCanonicalNativePlanSpine,
  traceForCanonicalNativePlan,
  loweringFactsForCanonicalNativePlan,
  packageLoweringForCanonicalNativePlan,
  providerRequirementsForCanonicalNativePlan
});
