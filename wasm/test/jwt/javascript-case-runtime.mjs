import {
  CRYPTO_RESOURCE_LIMITS,
  crypto as runtimeBuiltinCrypto,
} from '../../../packages/crypto/dist/index.js';
import {
  verifyJwtWithCrypto,
} from '../../../packages/jwt/dist/provider.js';

export const JAVASCRIPT_CASE_RUNTIME_VERSION =
  'pulse.jwt-javascript-case-runtime.e1.v1';

function ordinaryObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!ordinaryObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

function sameJson(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function dataValue(value, name) {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function byteLength(value) {
  return value instanceof Uint8Array ? value.byteLength : -1;
}

function reachesRuntimePrimitive(request) {
  const key = dataValue(request, 'key');
  const keyBytes = dataValue(key, 'bytes');
  const data = dataValue(request, 'data');
  const tag = dataValue(request, 'tag');
  return dataValue(request, 'algorithm') === 'HS256'
    && dataValue(key, 'type') === 'hmac-key-bytes'
    && byteLength(keyBytes) >= CRYPTO_RESOURCE_LIMITS.hmacKeyBytesMinimum
    && byteLength(keyBytes) <= CRYPTO_RESOURCE_LIMITS.hmacKeyBytesMaximum
    && byteLength(data) >= 0
    && byteLength(data) <= CRYPTO_RESOURCE_LIMITS.macDataBytesMaximum
    && byteLength(tag) === CRYPTO_RESOURCE_LIMITS.hs256TagBytes;
}

function safeError(error) {
  const code = dataValue(error, 'code');
  const detail = dataValue(error, 'detail');
  const category = dataValue(detail, 'category');
  const automaticFallback = dataValue(detail, 'automaticFallback');
  return Object.freeze({
    code: typeof code === 'string' && /^PULSE_[A-Z0-9_]{1,96}$/.test(code)
      ? code
      : 'PULSE_JWT_OPERATION_FAILED',
    category: typeof category === 'string' && /^[a-z0-9-]{1,96}$/.test(category)
      ? category
      : null,
    automaticFallback: automaticFallback === true ? true : false,
  });
}

function immutableResultObservation(result, schemaValue) {
  const claims = dataValue(result, 'claims');
  const protectedHeader = dataValue(result, 'protectedHeader');
  const roles = dataValue(claims, 'roles');
  return Object.freeze({
    detached: claims !== schemaValue,
    immutablePaths: Object.freeze({
      '$': Object.isFrozen(result),
      '$.claims': Object.isFrozen(claims),
      '$.claims.roles': Array.isArray(roles) && Object.isFrozen(roles),
      '$.protectedHeader': Object.isFrozen(protectedHeader),
    }),
    claimKeys: ordinaryObject(claims) ? Object.freeze(Object.keys(claims).sort()) : Object.freeze([]),
    protectedHeaderKeys: ordinaryObject(protectedHeader)
      ? Object.freeze(Object.keys(protectedHeader).sort())
      : Object.freeze([]),
  });
}

function emptyObservation() {
  return {
    secretCalls: 0,
    cryptoRequests: 0,
    cryptoPrimitiveCalls: 0,
    clockCalls: 0,
    schemaCalls: 0,
    realizationAttempts: 0,
    alternateTargetAttempts: 0,
    alternateRealizationAttempts: 0,
    claimStringsRegistered: 0,
    secretBytes: null,
    cryptoKeyBytes: null,
    cryptoDataBytes: null,
    cryptoTagBytes: null,
    cryptoStatus: null,
    tokenRegistered: false,
    secretRegistered: false,
    subjectRegistered: false,
    eventOrder: [],
  };
}

function frozenObservation(value) {
  return Object.freeze({
    ...value,
    eventOrder: Object.freeze([...value.eventOrder]),
    automaticFallback: false,
    claimsParsed: value.claimStringsRegistered > 0,
    claimsObserved: value.claimStringsRegistered > 0,
    registeredClaimsStatus: value.schemaCalls > 0 ? 'passed' : null,
  });
}

export async function executeJavascriptSemanticCase(input, authority) {
  const observed = emptyObservation();
  let resolvedSecret;
  let schemaValue;
  const host = Object.freeze({
    async resolveSecret(binding) {
      observed.secretCalls += 1;
      observed.eventOrder.push('secret');
      resolvedSecret = await authority.resolveSecret(binding);
      if (typeof resolvedSecret === 'string') {
        observed.secretBytes = new TextEncoder().encode(resolvedSecret).byteLength;
      } else if (resolvedSecret instanceof Uint8Array) {
        observed.secretBytes = resolvedSecret.byteLength;
      }
      return resolvedSecret;
    },
    async captureWallClock() {
      observed.clockCalls += 1;
      observed.eventOrder.push('clock');
      return authority.captureWallClock();
    },
    async validateClaims(schemaId, claims, context) {
      observed.schemaCalls += 1;
      observed.eventOrder.push('schema');
      schemaValue = await authority.validateClaims(
        schemaId,
        claims,
        context,
        input.schemaMode,
      );
      return schemaValue;
    },
    registerSensitiveValue(value) {
      if (typeof value !== 'string') return;
      if (value === input.verifierInput.token) {
        observed.tokenRegistered = true;
        return;
      }
      if (typeof resolvedSecret === 'string' && value === resolvedSecret) {
        observed.secretRegistered = true;
        return;
      }
      observed.claimStringsRegistered += 1;
      if (value === input.sensitive.subject) observed.subjectRegistered = true;
    },
  });
  const selectedCrypto = Object.freeze({
    mac: Object.freeze({
      async verify(request) {
        observed.cryptoRequests += 1;
        observed.realizationAttempts += 1;
        observed.eventOrder.push('crypto');
        observed.cryptoKeyBytes = byteLength(dataValue(dataValue(request, 'key'), 'bytes'));
        observed.cryptoDataBytes = byteLength(dataValue(request, 'data'));
        observed.cryptoTagBytes = byteLength(dataValue(request, 'tag'));
        if (reachesRuntimePrimitive(request)) observed.cryptoPrimitiveCalls += 1;
        if (input.cryptoMode === 'selected-realization-failure') {
          observed.cryptoStatus = 'realization-failure';
          return Object.freeze({ status: 'realization-failure' });
        }
        const result = await runtimeBuiltinCrypto.mac.verify(request);
        observed.cryptoStatus = dataValue(result, 'status') || null;
        return result;
      },
    }),
  });

  try {
    const result = await verifyJwtWithCrypto(
      input.verifierInput,
      host,
      selectedCrypto,
    );
    return Object.freeze({
      version: JAVASCRIPT_CASE_RUNTIME_VERSION,
      status: 'success',
      resultMatchesExpected: sameJson(result, input.expectedResult),
      result: immutableResultObservation(result, schemaValue),
      error: null,
      observation: frozenObservation(observed),
    });
  } catch (error) {
    return Object.freeze({
      version: JAVASCRIPT_CASE_RUNTIME_VERSION,
      status: 'error',
      resultMatchesExpected: false,
      result: null,
      error: safeError(error),
      observation: frozenObservation(observed),
    });
  }
}
