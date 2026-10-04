'use strict';

const crypto = require('node:crypto');
const {
  CANONICAL_NATIVE_IMPORT_NAMES,
  CANONICAL_NATIVE_VALUE_TRANSFER_MAX_BYTES
} = require('@pulse-compute/wasm-contracts/handler/canonical-native-runtime');

function enabled(plan) { return Boolean(plan.packages && plan.packages.application); }

// The package owns request dispatch, codecs and continuations. This adapter only
// binds its canonical host imports to the same Fastly runtime as ordinary handlers.
function portable(plan) {
  const application = plan.packages.application;
  if (application.contractId !== 'pulse.entities'
    || application.version !== 'pulse.package-native-application.v1'
    || application.effectFailure !== 'package-completion'
    || application.automaticFallback !== false
    || crypto.createHash('sha256').update(application.source).digest('hex') !== application.sourceHash) {
    throw new Error('Unsupported or invalid Fastly package Native application.');
  }
  const source = application.source.replace(
    /^@external\("pulse_host", "([a-z_]+)"\) declare function (\w+)\(([^)]*)\): (i32|void)$/gm,
    (_declaration, name, symbol, parameters, result) => {
      if (!CANONICAL_NATIVE_IMPORT_NAMES.includes(name)) throw new Error('Unsupported package host import: ' + name);
      const args = parameters ? parameters.split(',').map(parameter => parameter.trim().split(':')[0]).join(', ') : '';
      if (name === 'value_json') return `function ${symbol}(${parameters}): i32 {
  // A failed request read must reach the provider's terminal error response,
  // without trapping JSON.parse<string> in the guest first.
  if (handle <= 0) return changetype<i32>('""')
  const text = __pulse_fastly_json(handle, 0)
  if (String.UTF8.byteLength(text) > ${CANONICAL_NATIVE_VALUE_TRANSFER_MAX_BYTES}) {
    __pulse_fastly_fail(PULSE_ERROR_VALUE, 172, -1); return changetype<i32>('null')
  }
  return changetype<i32>(text)
}`;
      const guard = name === 'log' ? `if (level <= 0 || level > ${Number(plan.logging.reporting.level)}) return; ` : '';
      return `function ${symbol}(${parameters}): ${result} { ${guard}${result === 'void' ? '' : 'return '}host_${name}(${args}) }`;
    }
  );
  if (source.includes('@external("pulse_host",')) throw new Error('Unbound package Native host import.');
  const codecs = (plan.schemas?.registry?.schemas || []).map((_schema, index) => `
function __pulse_schema_decode_${index}(input: string): string { return changetype<string>(pulse_schema_decode(${index}, changetype<i32>(input))) }
function __pulse_schema_encode_${index}(input: string): string { return changetype<string>(pulse_schema_encode(${index}, changetype<i32>(input))) }`).join('\n');
  return { ...application, source: source + codecs + `\nconst __pulse_application_plan_hash: string = ${JSON.stringify(plan.planHash)}\n` };
}

function runtimeSource() {
  return `
const __pulse_package_failed = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
function __pulse_package_take_effect_failure(): bool {
  const code = __pulse_fastly_last_error
  // Deadlines, invalid lifecycle transitions and request/body failures remain
  // provider-terminal. Only an admitted effect's operational failure is framed.
  if (__pulse_fastly_error_stage == 260 || __pulse_fastly_error_stage == 261) return false
  if (code != PULSE_ERROR_HOSTCALL && code != PULSE_ERROR_TRANSPORT
    && code != PULSE_ERROR_JSON && code != PULSE_ERROR_SCHEMA && code != PULSE_ERROR_VALUE) return false
  __pulse_fastly_last_error = 0; __pulse_fastly_error_stage = 0; __pulse_fastly_error_effect = -1
  return true
}
function host_effect_begin(effectIndex: i32, payload: i32): void {
  if (__pulse_fastly_last_error != 0) return
  __pulse_package_effect_begin(effectIndex, payload)
  if (__pulse_package_take_effect_failure()) unchecked(__pulse_package_failed[effectIndex] = 1)
}
`;
}

function instrument(source) {
  const signature = 'function host_effect_begin(effectIndex: i32, payload: i32): void {';
  if (!source.includes(signature)) throw new Error('Fastly package effect admission boundary drift.');
  return source.replace(signature, 'function __pulse_package_effect_begin(effectIndex: i32, payload: i32): void {') + runtimeSource();
}

function driverLoop() {
  return `  while (runStatus == 1 && __pulse_fastly_last_error == 0) {
    for (let effectIndex = 0; effectIndex < PULSE_FASTLY_EFFECT_COUNT; effectIndex += 1) {
      const invocation = unchecked(__pulse_invocation_tickets[effectIndex])
      if (invocation == 0) continue
      let failed = unchecked(__pulse_package_failed[effectIndex]) != 0
      unchecked(__pulse_package_failed[effectIndex] = 0)
      let result = failed ? 0 : __pulse_fastly_resolve_effect(effectIndex)
      if (__pulse_package_take_effect_failure()) { failed = true; result = 0 }
      if (__pulse_fastly_last_error != 0) { __pulse_fastly_jwt_send_error(); return }
      if (!failed && result <= 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 101, effectIndex); __pulse_fastly_jwt_send_error(); return }
      if (__pulse_invocation_settle(effectIndex, invocation, result) != 1 || __pulse_fastly_last_error != 0) {
        __pulse_fastly_fail(PULSE_ERROR_STATE, 101, effectIndex); __pulse_fastly_jwt_send_error(); return
      }
    }
    runStatus = pulse_resume()
  }`;
}

module.exports = { enabled, portable, instrument, driverLoop };
