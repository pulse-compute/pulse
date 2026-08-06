import { SecretStore } from 'fastly:secret-store';
import fastlyJwtVerifier from '../../../packages/provider-fastly/src/javascript/jwt-verifier.js';
import {
  executeJavascriptSemanticCase,
} from './javascript-case-runtime.mjs';

const FASTLY_JAVASCRIPT_REALITY_ENTRY_VERSION =
  'pulse.fastly-javascript-jwt-reality-entry.e1.v1';
const SECRET_STORE = 'jwt_e1_secrets';
const { createFastlyJavascriptJwtVerify } = fastlyJwtVerifier;

function dataValue(value, name) {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function safeError(error) {
  const code = dataValue(error, 'code');
  const detail = dataValue(error, 'detail');
  const category = dataValue(detail, 'category');
  return Object.freeze({
    code: typeof code === 'string' && /^PULSE_[A-Z0-9_]{1,96}$/.test(code)
      ? code
      : 'PULSE_JWT_OPERATION_FAILED',
    category: typeof category === 'string' && /^[a-z0-9-]{1,96}$/.test(category)
      ? category
      : null,
    automaticFallback: dataValue(detail, 'automaticFallback') === true,
  });
}

function normalizedClaims(claims) {
  return {
    sub: String(claims.sub),
    roles: Array.isArray(claims.roles) ? claims.roles.map(String) : [],
  };
}

function schemaAuthority(mode, claims) {
  if (mode === 'reject') {
    const error = new Error('rejected by the E1 schema negative control');
    error.code = 'PULSE_SCHEMA_VALUE_INVALID';
    error.detail = Object.freeze({
      path: '$.roles',
      expected: 'string',
      actualKind: 'array',
    });
    throw error;
  }
  return normalizedClaims(claims);
}

function requestAuthority(input) {
  const store = new SecretStore(SECRET_STORE);
  return Object.freeze({
    async resolveSecret(binding) {
      const entry = await store.get(binding);
      return entry === null || entry === undefined ? undefined : entry.plaintext();
    },
    captureWallClock() {
      return Object.freeze({
        unixEpochSeconds: input.clockInstantUnixSeconds,
        trusted: true,
      });
    },
    validateClaims(_schemaId, claims, _context, mode) {
      return schemaAuthority(mode, claims);
    },
  });
}

async function executeAdapterProbe(input) {
  const store = new SecretStore(SECRET_STORE);
  const observed = {
    secretCalls: 0,
    schemaCalls: 0,
    tokenRegistered: false,
    secretRegistered: false,
    subjectRegistered: false,
  };
  let resolvedSecret;
  const verify = createFastlyJavascriptJwtVerify({
    async secretLookup(binding) {
      observed.secretCalls += 1;
      const entry = await store.get(binding);
      resolvedSecret = entry === null || entry === undefined
        ? undefined
        : entry.plaintext();
      return resolvedSecret;
    },
  });
  try {
    const result = await verify(input.effect, {
      registerRedactionValue(value) {
        if (value === input.effect.payload.token) observed.tokenRegistered = true;
        else if (typeof resolvedSecret === 'string' && value === resolvedSecret) {
          observed.secretRegistered = true;
        } else if (value === input.sensitive.subject) {
          observed.subjectRegistered = true;
        }
      },
      validateSchemaValue(_schemaId, claims) {
        observed.schemaCalls += 1;
        return schemaAuthority(input.schemaMode, claims);
      },
    });
    const claims = dataValue(result, 'claims');
    const header = dataValue(result, 'protectedHeader');
    return Object.freeze({
      status: 'success',
      error: null,
      resultMatchesExpected:
        JSON.stringify(result) === JSON.stringify(input.expectedResult),
      resultImmutable: Object.isFrozen(result)
        && Object.isFrozen(claims)
        && Object.isFrozen(header),
      observation: Object.freeze({
        ...observed,
        providerDefaultClock: 'Date.now',
        automaticFallback: false,
      }),
    });
  } catch (error) {
    return Object.freeze({
      status: 'error',
      error: safeError(error),
      resultMatchesExpected: false,
      resultImmutable: false,
      observation: Object.freeze({
        ...observed,
        providerDefaultClock: 'Date.now',
        automaticFallback: false,
      }),
    });
  }
}

async function handle(request) {
  if (request.method !== 'POST') {
    return new Response('Not Found', { status: 404 });
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 65536) {
    return new Response('Invalid request', { status: 400 });
  }
  const input = await request.json();
  const result = input.mode === 'adapter'
    ? await executeAdapterProbe(input)
    : await executeJavascriptSemanticCase(input.caseInput, requestAuthority(input.caseInput));
  return new Response(JSON.stringify({
    version: FASTLY_JAVASCRIPT_REALITY_ENTRY_VERSION,
    result,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});
