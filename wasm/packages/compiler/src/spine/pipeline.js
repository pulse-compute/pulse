'use strict';

function loadCompilerSpineContract() {
  try {
    return require('@pulse-compute/wasm-contracts/compiler-spine');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../contracts/src/spine.js');
    }
    throw error;
  }
}

const compilerSpineContract = loadCompilerSpineContract();
const registry = compilerSpineContract.DEFAULT_COMPILER_SPINE_REGISTRY;

const compilerSpineRuntimeVersion = 'pulse.compiler-spine-runtime.v1';
const compilerSpineTraceVersion = 'pulse.compiler-spine-trace.v1';

class CompilerSpineRuntimeError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'CompilerSpineRuntimeError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CompilerSpineRuntimeError('PULSE_COMPILER_SPINE_DEFINITION_INVALID', `${field} must be a non-empty string.`, { field, value });
  }
  return value;
}

function phaseById(id) {
  const phase = registry.phases.find((entry) => entry.id === id);
  if (!phase) {
    throw new CompilerSpineRuntimeError('PULSE_COMPILER_SPINE_PHASE_UNKNOWN', `Unknown compiler spine phase ${id}.`, { phase: id });
  }
  return phase;
}

function orderedPhases(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new CompilerSpineRuntimeError('PULSE_COMPILER_SPINE_DEFINITION_INVALID', 'Compiler spine segment requires at least one phase.');
  }
  const phases = ids.map((id) => phaseById(nonEmptyString(id, 'phase')));
  for (let index = 1; index < phases.length; index += 1) {
    if (phases[index - 1].order >= phases[index].order) {
      throw new CompilerSpineRuntimeError(
        'PULSE_COMPILER_SPINE_PHASE_ORDER_INVALID',
        `Compiler spine segment phases must follow contract order: ${phases[index - 1].id} before ${phases[index].id}.`,
        { phases: ids }
      );
    }
  }
  return Object.freeze(phases);
}

function definePhaseAdapter(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new CompilerSpineRuntimeError('PULSE_COMPILER_SPINE_DEFINITION_INVALID', 'Compiler spine adapter must be an object.');
  }
  const adapter = {
    id: nonEmptyString(definition.id, 'adapter.id'),
    phase: nonEmptyString(definition.phase, 'adapter.phase'),
    mode: nonEmptyString(definition.mode, 'adapter.mode'),
    inputKind: nonEmptyString(definition.inputKind, 'adapter.inputKind'),
    outputKind: nonEmptyString(definition.outputKind, 'adapter.outputKind'),
    run: definition.run
  };
  phaseById(adapter.phase);
  if (typeof adapter.run !== 'function') {
    throw new CompilerSpineRuntimeError('PULSE_COMPILER_SPINE_DEFINITION_INVALID', `Compiler spine adapter ${adapter.id} requires a run function.`, { adapter: adapter.id });
  }
  return Object.freeze(adapter);
}

function definePassThroughAdapter(definition) {
  return definePhaseAdapter({
    ...definition,
    mode: definition.mode || 'legacy-pass-through',
    run({ value }) {
      return value;
    }
  });
}

function defineCompilerSpineSegment(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new CompilerSpineRuntimeError('PULSE_COMPILER_SPINE_DEFINITION_INVALID', 'Compiler spine segment must be an object.');
  }
  const id = nonEmptyString(definition.id, 'segment.id');
  const phases = orderedPhases(definition.phases);
  if (!Array.isArray(definition.adapters)) {
    throw new CompilerSpineRuntimeError('PULSE_COMPILER_SPINE_DEFINITION_INVALID', `Compiler spine segment ${id} requires an adapters array.`);
  }
  const adaptersByPhase = new Map();
  for (const raw of definition.adapters) {
    const adapter = definePhaseAdapter(raw);
    if (adaptersByPhase.has(adapter.phase)) {
      throw new CompilerSpineRuntimeError('PULSE_COMPILER_SPINE_ADAPTER_DUPLICATE', `Compiler spine segment ${id} has more than one adapter for ${adapter.phase}.`, { segment: id, phase: adapter.phase });
    }
    adaptersByPhase.set(adapter.phase, adapter);
  }
  for (const adapter of adaptersByPhase.values()) {
    if (!phases.some((phase) => phase.id === adapter.phase)) {
      throw new CompilerSpineRuntimeError('PULSE_COMPILER_SPINE_ADAPTER_OUTSIDE_SEGMENT', `Compiler spine adapter ${adapter.id} targets phase ${adapter.phase} outside segment ${id}.`, { segment: id, adapter: adapter.id, phase: adapter.phase });
    }
  }
  for (const phase of phases) {
    if (!adaptersByPhase.has(phase.id)) {
      throw new CompilerSpineRuntimeError('PULSE_COMPILER_SPINE_ADAPTER_MISSING', `Compiler spine segment ${id} has no adapter for ${phase.id}.`, { segment: id, phase: phase.id });
    }
  }

  const adapters = Object.freeze(phases.map((phase) => adaptersByPhase.get(phase.id)));
  for (let index = 1; index < adapters.length; index += 1) {
    const previous = adapters[index - 1];
    const current = adapters[index];
    if (previous.outputKind !== current.inputKind) {
      throw new CompilerSpineRuntimeError(
        'PULSE_COMPILER_SPINE_ADAPTER_SHAPE_MISMATCH',
        `Compiler spine segment ${id} cannot pass ${previous.outputKind} from ${previous.id} into ${current.inputKind} for ${current.id}.`,
        {
          segment: id,
          previousAdapter: previous.id,
          previousOutputKind: previous.outputKind,
          adapter: current.id,
          inputKind: current.inputKind
        }
      );
    }
  }
  const descriptor = Object.freeze({
    version: compilerSpineRuntimeVersion,
    id,
    contractVersion: registry.version,
    contractId: registry.contractId,
    phases: Object.freeze(phases.map((phase) => Object.freeze({
      id: phase.id,
      order: phase.order,
      input: phase.input,
      output: phase.output,
      ruleIds: Object.freeze(registry.rulesForPhase(phase.id).map((rule) => rule.id))
    }))),
    adapters: Object.freeze(adapters.map((adapter) => Object.freeze({
      id: adapter.id,
      phase: adapter.phase,
      mode: adapter.mode,
      inputKind: adapter.inputKind,
      outputKind: adapter.outputKind
    })))
  });

  function run(input, context = {}) {
    if (!context || typeof context !== 'object') {
      throw new CompilerSpineRuntimeError('PULSE_COMPILER_SPINE_CONTEXT_INVALID', `Compiler spine segment ${id} context must be an object.`, { segment: id });
    }
    const readonlyContext = Object.freeze({ ...context });
    const trace = [];
    let value = input;
    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index];
      const adapter = adapters[index];
      const rules = registry.rulesForPhase(phase.id);
      value = adapter.run(Object.freeze({ value, context: readonlyContext, phase, rules }));
      trace.push(Object.freeze({
        phase: phase.id,
        order: phase.order,
        adapter: adapter.id,
        mode: adapter.mode,
        inputKind: adapter.inputKind,
        outputKind: adapter.outputKind,
        ruleIds: Object.freeze(rules.map((rule) => rule.id))
      }));
    }
    return Object.freeze({
      output: value,
      trace: Object.freeze({
        version: compilerSpineTraceVersion,
        runtimeVersion: compilerSpineRuntimeVersion,
        contractVersion: registry.version,
        contractId: registry.contractId,
        segment: id,
        phases: Object.freeze(trace)
      })
    });
  }

  return Object.freeze({ ...descriptor, run });
}

module.exports = Object.freeze({
  runtimeVersion: compilerSpineRuntimeVersion,
  traceVersion: compilerSpineTraceVersion,
  CompilerSpineRuntimeError,
  definePhaseAdapter,
  definePassThroughAdapter,
  defineCompilerSpineSegment
});
