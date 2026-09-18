'use strict';

const crypto = require('node:crypto');

const phaseName = 'jwt-lowering-plan';

function loadDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../wasm/packages/contracts/src/diagnostics.js');
    }
    throw error;
  }
}

function loadJwtContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/jwt/contracts');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../wasm/packages/contracts/src/jwt/contracts.js');
    }
    throw error;
  }
}

function loadPackageContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/package/package-contract');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../wasm/packages/contracts/src/package/package-contract.js');
    }
    throw error;
  }
}

function loadCanonicalRuntimeContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/handler/canonical-runtime');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../wasm/packages/contracts/src/handler/canonical-runtime.js');
    }
    throw error;
  }
}

const {
  normalizeArtifact,
  normalizeDiagnostic,
  sourceLoc,
  stableFileName
} = loadDiagnostics();
const jwtContracts = loadJwtContracts();
const packageContracts = loadPackageContracts();
const canonicalRuntimeContracts = loadCanonicalRuntimeContracts();

function loadCryptoGuestContribution() {
  try {
    return require('@pulse-compute/crypto/pulsewasm-native')
      .pulseEs256GuestUnit();
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../crypto/pulsewasm.native.cjs').pulseEs256GuestUnit();
    }
    throw error;
  }
}

const MAX_TOKEN_AGE_SECONDS = 31_536_000;
const OPTION_MEMBERS = new Set([
  'algorithms', 'key', 'issuer', 'audience', 'subject', 'typ',
  'clockToleranceSeconds', 'maxTokenAgeSeconds', 'requiredClaims', 'claimsSchema'
]);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, stableObject(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableObject(value));
}

function loadTypeScript(inputs = {}) {
  if (inputs.ts) return inputs.ts;
  try {
    return require('typescript');
  } catch (error) {
    const diagnostic = normalizeDiagnostic({
      phase: phaseName,
      severity: 'error',
      code: 'PULSE_JWT_TYPESCRIPT_REQUIRED',
      message: 'JWT lowering plan extraction requires the TypeScript parser.',
      hint: 'Run the lowerer from the synchronized Pulse workspace toolchain.',
      loc: { file: '<jwt-lowering-plan>' }
    });
    const thrown = new Error(diagnostic.message);
    thrown.diagnostics = [diagnostic];
    throw thrown;
  }
}

function unwrapExpression(ts, node) {
  let current = node;
  while (
    current
    && (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isSatisfiesExpression && ts.isSatisfiesExpression(current)
    )
  ) current = current.expression;
  return current;
}

function locFor(sourceFile, node) {
  return node ? sourceLoc(sourceFile, node) : { file: sourceFile ? sourceFile.fileName : '<jwt-lowering-plan>' };
}

function rangeFor(sourceFile, node) {
  return Object.freeze({
    start: node && typeof node.getStart === 'function' ? node.getStart(sourceFile) : 0,
    end: node && typeof node.getEnd === 'function' ? node.getEnd() : 0
  });
}

function positionFor(sourceFile, node) {
  const offset = node && typeof node.getStart === 'function' ? node.getStart(sourceFile) : 0;
  const point = sourceFile.getLineAndCharacterOfPosition(offset);
  return Object.freeze({ line: point.line + 1, column: point.character + 1, offset });
}

function makeDiagnostic(sourceFile, node, code, message, hint, details) {
  return normalizeDiagnostic({
    phase: phaseName,
    severity: 'error',
    code,
    message,
    hint,
    details,
    loc: locFor(sourceFile, node)
  });
}

function hasErrors(diagnostics) {
  return diagnostics.some((entry) => String(entry.severity || 'error') === 'error');
}

function propertyName(ts, node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return String(node.text);
  return undefined;
}

function objectMembers(ts, sourceFile, node, allowed, diagnostics, code, subject) {
  const current = unwrapExpression(ts, node);
  if (!current || !ts.isObjectLiteralExpression(current)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current || node,
      code,
      `${subject} must be a static object literal for Native lowering.`,
      `Inline ${subject.toLowerCase()} without spreads, computed names, methods, or accessors.`
    ));
    return new Map();
  }
  const output = new Map();
  for (const member of current.properties) {
    if (!ts.isPropertyAssignment(member)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        member,
        jwtContracts.JWT_DIAGNOSTIC_CODES.OPTIONS_PROPERTY_UNSUPPORTED,
        `${subject} contains a dynamic property form that Native lowering cannot evaluate.`,
        'Use ordinary static property assignments only.'
      ));
      continue;
    }
    const name = propertyName(ts, member.name);
    if (!name || name === '__proto__' || !allowed.has(name) || output.has(name)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        member.name,
        jwtContracts.JWT_DIAGNOSTIC_CODES.OPTIONS_PROPERTY_UNSUPPORTED,
        `${subject} contains an unsupported or duplicate property.`,
        'Use each documented static property at most once.',
        { category: subject.toLowerCase().replace(/\s+/g, '-'), propertySupported: Boolean(name && allowed.has(name) && name !== '__proto__') }
      ));
      continue;
    }
    output.set(name, member.initializer);
  }
  return output;
}

function literalString(ts, node) {
  const current = unwrapExpression(ts, node);
  return current && (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current))
    ? current.text
    : undefined;
}

function literalNumber(ts, node) {
  const current = unwrapExpression(ts, node);
  if (!current) return undefined;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(current.operand)) {
    return -Number(current.operand.text);
  }
  return undefined;
}

function literalStringArray(ts, sourceFile, node, diagnostics, options = {}) {
  const current = unwrapExpression(ts, node);
  if (!current || !ts.isArrayLiteralExpression(current)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current || node,
      options.code || jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LITERAL_REQUIRED,
      `${options.label || 'JWT policy'} must be a static string-literal array.`,
      'Use a bounded inline array of non-empty string literals.'
    ));
    return [];
  }
  const values = [];
  for (const element of current.elements) {
    if (ts.isSpreadElement(element)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        element,
        options.code || jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LITERAL_REQUIRED,
        `${options.label || 'JWT policy'} cannot contain spread elements.`,
        'List each value explicitly.'
      ));
      continue;
    }
    const value = literalString(ts, element);
    if (value === undefined || value.trim().length === 0 || value.includes('\0')) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        element,
        options.code || jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LITERAL_REQUIRED,
        `${options.label || 'JWT policy'} must contain only non-empty string literals.`,
        'Replace the dynamic or empty entry with a static value.'
      ));
      continue;
    }
    values.push(value);
  }
  if (options.nonEmpty !== false && values.length === 0) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current,
      options.emptyCode || options.code || jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LITERAL_REQUIRED,
      `${options.label || 'JWT policy'} cannot be empty.`,
      'Declare at least one static value.'
    ));
  }
  if (options.maximum !== undefined && values.length > options.maximum) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current,
      options.limitCode || jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LIMIT_EXCEEDED,
      `${options.label || 'JWT policy'} exceeds the Native resource limit.`,
      `Use no more than ${options.maximum} entries.`,
      { category: options.category || 'policy', limit: options.maximum, actual: values.length }
    ));
  }
  if (new Set(values).size !== values.length) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current,
      options.duplicateCode || options.code || jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LITERAL_REQUIRED,
      `${options.label || 'JWT policy'} contains duplicate values.`,
      'Keep each static value once.'
    ));
  }
  return values;
}

function parseAlgorithms(ts, sourceFile, node, diagnostics) {
  const values = literalStringArray(ts, sourceFile, node, diagnostics, {
    label: 'JWT algorithms',
    category: 'algorithms',
    code: jwtContracts.JWT_DIAGNOSTIC_CODES.ALGORITHMS_LITERAL_REQUIRED,
    emptyCode: jwtContracts.JWT_DIAGNOSTIC_CODES.ALGORITHMS_EMPTY,
    duplicateCode: jwtContracts.JWT_DIAGNOSTIC_CODES.ALGORITHM_UNSUPPORTED,
    limitCode: jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LIMIT_EXCEEDED,
    maximum: jwtContracts.JWT_RESOURCE_LIMITS.algorithms
  });
  for (const value of values) {
    if (!jwtContracts.JWT_IMPLEMENTED_ALGORITHMS.includes(value)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        node,
        jwtContracts.JWT_DIAGNOSTIC_CODES.ALGORITHM_UNSUPPORTED,
        'JWT algorithms contains a value outside the package verification vocabulary.',
        `Use one or more of: ${jwtContracts.JWT_IMPLEMENTED_ALGORITHMS.join(', ')}.`,
        {
          category: 'algorithms',
          supported: jwtContracts.JWT_IMPLEMENTED_ALGORITHMS,
          unavailable: jwtContracts.JWT_ALGORITHMS.filter(
            (algorithm) => !jwtContracts.JWT_IMPLEMENTED_ALGORITHMS.includes(algorithm)
          ),
          automaticFallback: false
        }
      ));
    }
  }
  return [...new Set(values.filter(
    (value) => jwtContracts.JWT_IMPLEMENTED_ALGORITHMS.includes(value)
  ))];
}

function parseStringOrStringArray(ts, sourceFile, node, diagnostics, label) {
  const direct = literalString(ts, node);
  if (direct !== undefined) {
    if (direct.trim().length > 0 && !direct.includes('\0')) return direct;
  }
  const current = unwrapExpression(ts, node);
  if (current && ts.isArrayLiteralExpression(current)) {
    return literalStringArray(ts, sourceFile, current, diagnostics, { label, category: label.toLowerCase() });
  }
  diagnostics.push(makeDiagnostic(
    sourceFile,
    current || node,
    jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LITERAL_REQUIRED,
    `${label} must be a non-empty string literal or static string-literal array.`,
    'Inline the accepted policy value.'
  ));
  return undefined;
}

function parseOptionalString(ts, sourceFile, node, diagnostics, label, code) {
  const value = literalString(ts, node);
  if (value === undefined || value.trim().length === 0 || value.includes('\0')) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      code || jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LITERAL_REQUIRED,
      `${label} must be a non-empty string literal.`,
      'Use a static non-empty string.'
    ));
    return undefined;
  }
  return value;
}

function canonicalCoordinate(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('=')
    || !/^[A-Za-z0-9_-]+$/.test(value)
    || value.length % 4 === 1
  ) return false;
  let bytes;
  try {
    bytes = Buffer.from(value, 'base64url');
  } catch {
    return false;
  }
  return bytes.length === 32 && bytes.toString('base64url') === value;
}

function parseEs256Jwk(ts, sourceFile, node, diagnostics) {
  const members = objectMembers(
    ts,
    sourceFile,
    node,
    new Set(['kty', 'crv', 'x', 'y', 'alg', 'use', 'key_ops', 'kid']),
    diagnostics,
    jwtContracts.JWT_DIAGNOSTIC_CODES.JWK_INVALID,
    'ES256 public JWK'
  );
  const required = {};
  for (const name of ['kty', 'crv', 'x', 'y']) {
    const value = members.has(name) ? literalString(ts, members.get(name)) : undefined;
    if (value === undefined || value.length === 0) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        members.get(name) || node,
        jwtContracts.JWT_DIAGNOSTIC_CODES.JWK_INVALID,
        `ES256 public JWK requires static ${name}.`,
        'Use a bounded inline public P-256 JWK.'
      ));
    } else required[name] = value;
  }
  if (required.kty !== undefined && required.kty !== 'EC') diagnostics.push(makeDiagnostic(
    sourceFile,
    members.get('kty') || node,
    jwtContracts.JWT_DIAGNOSTIC_CODES.JWK_INVALID,
    'ES256 public JWK kty must be EC.',
    'Use kty: "EC".'
  ));
  if (required.crv !== undefined && required.crv !== 'P-256') diagnostics.push(makeDiagnostic(
    sourceFile,
    members.get('crv') || node,
    jwtContracts.JWT_DIAGNOSTIC_CODES.JWK_INVALID,
    'ES256 public JWK crv must be P-256.',
    'Use crv: "P-256".'
  ));
  for (const name of ['x', 'y']) {
    if (required[name] !== undefined && !canonicalCoordinate(required[name])) diagnostics.push(makeDiagnostic(
      sourceFile,
      members.get(name) || node,
      jwtContracts.JWT_DIAGNOSTIC_CODES.JWK_INVALID,
      `ES256 public JWK ${name} must be canonical unpadded base64url for exactly 32 bytes.`,
      'Use one exact P-256 coordinate.'
    ));
  }

  const output = { ...required };
  for (const name of ['alg', 'use', 'kid']) {
    if (!members.has(name)) continue;
    const value = parseOptionalString(
      ts,
      sourceFile,
      members.get(name),
      diagnostics,
      `ES256 public JWK ${name}`,
      jwtContracts.JWT_DIAGNOSTIC_CODES.JWK_INVALID
    );
    if (value !== undefined) output[name] = value;
  }
  if (output.alg !== undefined && output.alg !== 'ES256') diagnostics.push(makeDiagnostic(
    sourceFile,
    members.get('alg'),
    jwtContracts.JWT_DIAGNOSTIC_CODES.KEY_ALGORITHM_MISMATCH,
    'ES256 public JWK alg must be absent or ES256.',
    'Remove alg or use alg: "ES256".'
  ));
  if (output.use !== undefined && output.use !== 'sig') diagnostics.push(makeDiagnostic(
    sourceFile,
    members.get('use'),
    jwtContracts.JWT_DIAGNOSTIC_CODES.JWK_INVALID,
    'ES256 public JWK use must be absent or sig.',
    'Remove use or use use: "sig".'
  ));
  if (members.has('key_ops')) {
    const operations = literalStringArray(
      ts,
      sourceFile,
      members.get('key_ops'),
      diagnostics,
      {
        label: 'ES256 public JWK key_ops',
        category: 'jwk-key-ops',
        maximum: 1,
        code: jwtContracts.JWT_DIAGNOSTIC_CODES.JWK_INVALID,
        limitCode: jwtContracts.JWT_DIAGNOSTIC_CODES.JWK_INVALID
      }
    );
    if (operations.length !== 1 || operations[0] !== 'verify') diagnostics.push(makeDiagnostic(
      sourceFile,
      members.get('key_ops'),
      jwtContracts.JWT_DIAGNOSTIC_CODES.JWK_INVALID,
      'ES256 public JWK key_ops must be absent or exactly ["verify"].',
      'Remove key_ops or declare only verify.'
    ));
    output.key_ops = operations;
  }
  return deepFreeze(output);
}

function parseEs256Jwks(ts, sourceFile, node, diagnostics) {
  const current = unwrapExpression(ts, node);
  if (!current || !ts.isArrayLiteralExpression(current)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current || node,
      jwtContracts.JWT_DIAGNOSTIC_CODES.KEY_LITERAL_REQUIRED,
      'ES256 JWKS keys must be a bounded static array.',
      'Inline no more than 16 public P-256 JWK objects.'
    ));
    return [];
  }
  if (current.elements.length === 0) diagnostics.push(makeDiagnostic(
    sourceFile,
    current,
    jwtContracts.JWT_DIAGNOSTIC_CODES.JWKS_AMBIGUOUS,
    'ES256 JWKS cannot be empty.',
    'Declare at least one public P-256 JWK.'
  ));
  if (current.elements.length > jwtContracts.JWT_RESOURCE_LIMITS.jwksEntries) diagnostics.push(makeDiagnostic(
    sourceFile,
    current,
    jwtContracts.JWT_DIAGNOSTIC_CODES.JWKS_LIMIT_EXCEEDED,
    'ES256 JWKS exceeds the static key limit.',
    `Use no more than ${jwtContracts.JWT_RESOURCE_LIMITS.jwksEntries} keys.`,
    {
      limit: jwtContracts.JWT_RESOURCE_LIMITS.jwksEntries,
      actual: current.elements.length
    }
  ));
  const keys = current.elements.slice(0, jwtContracts.JWT_RESOURCE_LIMITS.jwksEntries)
    .map((entry) => parseEs256Jwk(ts, sourceFile, entry, diagnostics));
  const kids = keys.map((entry) => entry.kid).filter(Boolean);
  if (new Set(kids).size !== kids.length) diagnostics.push(makeDiagnostic(
    sourceFile,
    current,
    jwtContracts.JWT_DIAGNOSTIC_CODES.JWKS_AMBIGUOUS,
    'ES256 JWKS contains duplicate kid values.',
    'Keep each configured kid unique.'
  ));
  return keys;
}

function keyArtifact(type, keys) {
  const material = type === 'jwk'
    ? { type, key: keys[0] }
    : { type, keys };
  const materialHash = crypto.createHash('sha256')
    .update(stableStringify(material))
    .digest('hex');
  const id = `pulse.jwt.es256-key.${materialHash.slice(0, 24)}`;
  return Object.freeze({
    descriptor: Object.freeze({
      type,
      count: keys.length,
      keyArtifactId: id,
      materialHash
    }),
    resource: Object.freeze({
      keyType: type,
      keyArtifactId: id,
      secretBinding: null
    }),
    realizationArtifact: deepFreeze({
      version: 'pulse.jwt-es256-key-artifact.v1',
      id,
      contractId: jwtContracts.JWT_CONTRACT_ID,
      package: jwtContracts.JWT_PACKAGE_NAME,
      kind: 'jwt-es256-static-public-key',
      mediaType: 'application/vnd.pulse.jwt-es256-key+json',
      materialHash,
      redaction: ['x', 'y'],
      data: material
    })
  });
}

function parseKey(ts, sourceFile, node, algorithms, diagnostics) {
  const members = objectMembers(
    ts,
    sourceFile,
    node,
    new Set(['type', 'binding', 'key', 'keys']),
    diagnostics,
    jwtContracts.JWT_DIAGNOSTIC_CODES.KEY_LITERAL_REQUIRED,
    'JWT key descriptor'
  );
  const type = members.has('type') ? literalString(ts, members.get('type')) : undefined;
  if (!jwtContracts.JWT_KEY_TYPES.includes(type)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      members.get('type') || node,
      jwtContracts.JWT_DIAGNOSTIC_CODES.KEY_TYPE_UNSUPPORTED,
      'JWT key descriptor requires static type secret, jwk, or jwks.',
      'Choose one documented verification key form.'
    ));
    return Object.freeze({
      descriptor: Object.freeze({ type: 'unknown', count: 0 }),
      resource: Object.freeze({ keyType: 'unknown', keyArtifactId: null, secretBinding: null }),
      realizationArtifact: null
    });
  }
  if (type === 'secret') {
    if (members.size !== 2 || !members.has('binding')) diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      jwtContracts.JWT_DIAGNOSTIC_CODES.KEY_LITERAL_REQUIRED,
      'Named-secret JWT keys require exactly type and binding.',
      'Use { type: "secret", binding: "NAME" }.'
    ));
    const binding = parseOptionalString(
      ts,
      sourceFile,
      members.get('binding'),
      diagnostics,
      'JWT secret binding',
      jwtContracts.JWT_DIAGNOSTIC_CODES.KEY_LITERAL_REQUIRED
    );
    if (algorithms.some((algorithm) => algorithm !== 'HS256')) diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      jwtContracts.JWT_DIAGNOSTIC_CODES.KEY_ALGORITHM_MISMATCH,
      'Named-secret JWT verification is compatible only with HS256.',
      'Use HS256 alone.',
      { keyType: 'secret', algorithms }
    ));
    return Object.freeze({
      descriptor: Object.freeze({ type, count: 1 }),
      resource: Object.freeze({
        keyType: type,
        keyArtifactId: null,
        secretBinding: binding || null
      }),
      realizationArtifact: null
    });
  }

  if (algorithms.length !== 1 || algorithms[0] !== 'ES256') {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      jwtContracts.JWT_DIAGNOSTIC_CODES.KEY_ALGORITHM_MISMATCH,
      'Public P-256 JWT keys are compatible only with ES256.',
      'Use ES256 alone.',
      { keyType: type, algorithms }
    ));
    return Object.freeze({
      descriptor: Object.freeze({ type, count: 0 }),
      resource: Object.freeze({
        keyType: type,
        keyArtifactId: null,
        secretBinding: null
      }),
      realizationArtifact: null
    });
  }
  if (type === 'jwk') {
    if (members.size !== 2 || !members.has('key')) diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      jwtContracts.JWT_DIAGNOSTIC_CODES.KEY_LITERAL_REQUIRED,
      'Inline JWK descriptors require exactly type and key.',
      'Use { type: "jwk", key: { ...publicP256Jwk } }.'
    ));
    return keyArtifact(
      type,
      [parseEs256Jwk(ts, sourceFile, members.get('key'), diagnostics)]
    );
  }
  if (members.size !== 2 || !members.has('keys')) diagnostics.push(makeDiagnostic(
    sourceFile,
    node,
    jwtContracts.JWT_DIAGNOSTIC_CODES.KEY_LITERAL_REQUIRED,
    'Static JWKS descriptors require exactly type and keys.',
    'Use { type: "jwks", keys: [ ...publicP256Jwks ] }.'
  ));
  return keyArtifact(
    type,
    parseEs256Jwks(ts, sourceFile, members.get('keys'), diagnostics)
  );
}

function schemaSets(schemaBundle) {
  const registrySchemas = schemaBundle && schemaBundle.registry && Array.isArray(schemaBundle.registry.schemas)
    ? schemaBundle.registry.schemas
    : [];
  const realized = new Set(registrySchemas.map((entry) => String(entry.id)));
  const declared = new Set(
    schemaBundle && Array.isArray(schemaBundle.declaredSchemaIds)
      ? schemaBundle.declaredSchemaIds.map(String)
      : (
          schemaBundle && Array.isArray(schemaBundle.schemaIds)
            ? schemaBundle.schemaIds.map(String)
            : [...realized]
        )
  );
  return { declared, realized };
}

function parseOptions(ts, sourceFile, node, diagnostics, inputs) {
  const members = objectMembers(
    ts,
    sourceFile,
    node,
    OPTION_MEMBERS,
    diagnostics,
    jwtContracts.JWT_DIAGNOSTIC_CODES.OPTIONS_LITERAL_REQUIRED,
    'JWT verification options'
  );
  if (!members.has('algorithms') || !members.has('key')) diagnostics.push(makeDiagnostic(
    sourceFile,
    node,
    jwtContracts.JWT_DIAGNOSTIC_CODES.ARGUMENT_SHAPE_UNSUPPORTED,
    'JWT verification options require static algorithms and key properties.',
    'Declare both algorithms and key in the inline options object.'
  ));

  const algorithms = parseAlgorithms(ts, sourceFile, members.get('algorithms'), diagnostics);
  const key = parseKey(ts, sourceFile, members.get('key'), algorithms, diagnostics);
  const policy = { algorithms };
  if (members.has('issuer')) policy.issuer = parseStringOrStringArray(ts, sourceFile, members.get('issuer'), diagnostics, 'JWT issuer');
  if (members.has('audience')) policy.audience = parseStringOrStringArray(ts, sourceFile, members.get('audience'), diagnostics, 'JWT audience');
  if (members.has('subject')) policy.subject = parseOptionalString(ts, sourceFile, members.get('subject'), diagnostics, 'JWT subject');
  if (members.has('typ')) policy.typ = parseOptionalString(ts, sourceFile, members.get('typ'), diagnostics, 'JWT typ');
  if (members.has('clockToleranceSeconds')) {
    const value = literalNumber(ts, members.get('clockToleranceSeconds'));
    if (!Number.isSafeInteger(value) || value < 0 || value > jwtContracts.JWT_RESOURCE_LIMITS.clockToleranceSeconds) diagnostics.push(makeDiagnostic(
      sourceFile,
      members.get('clockToleranceSeconds'),
      jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LIMIT_EXCEEDED,
      'JWT clockToleranceSeconds must be a static integer within the package limit.',
      `Use an integer from 0 through ${jwtContracts.JWT_RESOURCE_LIMITS.clockToleranceSeconds}.`,
      { category: 'clock-tolerance', limit: jwtContracts.JWT_RESOURCE_LIMITS.clockToleranceSeconds }
    ));
    else policy.clockToleranceSeconds = value;
  }
  if (members.has('maxTokenAgeSeconds')) {
    const value = literalNumber(ts, members.get('maxTokenAgeSeconds'));
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TOKEN_AGE_SECONDS) diagnostics.push(makeDiagnostic(
      sourceFile,
      members.get('maxTokenAgeSeconds'),
      jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LIMIT_EXCEEDED,
      'JWT maxTokenAgeSeconds must be a bounded static integer.',
      `Use an integer from 1 through ${MAX_TOKEN_AGE_SECONDS}.`,
      { category: 'max-token-age', limit: MAX_TOKEN_AGE_SECONDS }
    ));
    else policy.maxTokenAgeSeconds = value;
  }
  if (members.has('requiredClaims')) policy.requiredClaims = literalStringArray(
    ts,
    sourceFile,
    members.get('requiredClaims'),
    diagnostics,
    {
      label: 'JWT requiredClaims',
      category: 'required-claims',
      maximum: jwtContracts.JWT_RESOURCE_LIMITS.requiredClaimNames
    }
  );

  let schemaReference;
  if (members.has('claimsSchema')) {
    const schemaId = literalString(ts, members.get('claimsSchema'));
    if (schemaId === undefined || schemaId.trim().length === 0 || schemaId.includes('\0')) diagnostics.push(makeDiagnostic(
      sourceFile,
      members.get('claimsSchema'),
      jwtContracts.JWT_DIAGNOSTIC_CODES.SCHEMA_LITERAL_REQUIRED,
      'JWT claimsSchema must be a non-empty schema ID literal.',
      'Reference one statically declared project schema.'
    ));
    else {
      policy.claimsSchema = schemaId;
      const sets = schemaSets(inputs.schemaBundle);
      if (!sets.declared.has(schemaId)) diagnostics.push(makeDiagnostic(
        sourceFile,
        members.get('claimsSchema'),
        jwtContracts.JWT_DIAGNOSTIC_CODES.SCHEMA_UNKNOWN,
        `JWT claims schema ${JSON.stringify(schemaId)} is not declared by pulse.schema.`,
        'Declare the schema in the selected project registry or correct the literal ID.',
        { usage: 'jwt-claims', schemaId, declared: [...sets.declared].sort() }
      ));
      else if (!sets.realized.has(schemaId)) diagnostics.push(makeDiagnostic(
        sourceFile,
        members.get('claimsSchema'),
        jwtContracts.JWT_DIAGNOSTIC_CODES.SCHEMA_UNREALIZED,
        `JWT claims schema ${JSON.stringify(schemaId)} has no cross-target codec realization.`,
        'Use a schema whose codec shape is realized on both targets.',
        { usage: 'jwt-claims', schemaId, fullCodecRealization: false, automaticFallback: false }
      ));
      schemaReference = Object.freeze({
        id: schemaId,
        usage: 'jwt-claims',
        capability: 'schema.decode',
        file: sourceFile.fileName,
        position: positionFor(sourceFile, members.get('claimsSchema'))
      });
    }
  }
  return Object.freeze({
    policy: deepFreeze(policy),
    key,
    schemaReference,
    providerRequirements: jwtContracts.jwtVerifyNativeRequirements({
      algorithms,
      key: { type: key.descriptor.type },
      ...(policy.claimsSchema ? { claimsSchema: policy.claimsSchema } : {})
    })
  });
}

function collectFacadeBindings(ts, sourceFile, manifest) {
  const bindings = {
    namespaces: new Set(),
    verify: new Set(),
    sign: new Set(),
    bearer: new Set(),
    imports: []
  };
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const moduleName = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
    if (moduleName !== manifest.lowerableSubpath) continue;
    const clause = statement.importClause;
    if (clause.name) {
      bindings.namespaces.add(clause.name.text);
      bindings.imports.push({ imported: 'default', local: clause.name.text, loc: locFor(sourceFile, clause.name) });
    }
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      bindings.namespaces.add(named.name.text);
      bindings.imports.push({ imported: '*', local: named.name.text, loc: locFor(sourceFile, named.name) });
    }
    if (named && ts.isNamedImports(named)) {
      for (const specifier of named.elements) {
        if (specifier.isTypeOnly) continue;
        const imported = specifier.propertyName ? specifier.propertyName.text : specifier.name.text;
        const local = specifier.name.text;
        if (imported === 'jwt' || imported === 'default') bindings.namespaces.add(local);
        if (imported === 'verify') bindings.verify.add(local);
        if (imported === 'sign') bindings.sign.add(local);
        if (imported === 'bearer') bindings.bearer.add(local);
        bindings.imports.push({ imported, local, loc: locFor(sourceFile, specifier.name) });
      }
    }
  }
  return bindings;
}

function resolveFacadeCall(ts, call, bindings) {
  const expression = unwrapExpression(ts, call.expression);
  if (expression && ts.isPropertyAccessExpression(expression)) {
    const object = unwrapExpression(ts, expression.expression);
    if (object && ts.isIdentifier(object) && bindings.namespaces.has(object.text)) {
      if (['verify', 'bearer', 'sign'].includes(expression.name.text)) {
        return { method: expression.name.text, local: object.text };
      }
    }
  }
  if (expression && ts.isIdentifier(expression)) {
    if (bindings.verify.has(expression.text)) return { method: 'verify', local: expression.text };
    if (bindings.sign.has(expression.text)) return { method: 'sign', local: expression.text };
    if (bindings.bearer.has(expression.text)) return { method: 'bearer', local: expression.text };
  }
  return undefined;
}

function enclosingContextName(ts, node) {
  let current = node;
  while (current) {
    if (ts.isFunctionLike(current)) {
      const parameter = current.parameters && current.parameters[0];
      return parameter && ts.isIdentifier(parameter.name) ? parameter.name.text : undefined;
    }
    current = current.parent;
  }
  return undefined;
}

function currentContextArgument(ts, node, contextName) {
  const current = unwrapExpression(ts, node);
  return Boolean(current && ts.isIdentifier(current) && current.text === contextName);
}

function currentRequestArgument(ts, node, contextName) {
  const current = unwrapExpression(ts, node);
  if (!current || !ts.isPropertyAccessExpression(current) || current.name.text !== 'req') return false;
  const object = unwrapExpression(ts, current.expression);
  return Boolean(object && ts.isIdentifier(object) && object.text === contextName);
}

function placementForCall(ts, call, contextName) {
  let current = call;
  let parent = current.parent;
  let awaited = false;
  if (parent && ts.isAwaitExpression(parent)) {
    awaited = true;
    current = parent;
    parent = current.parent;
  }
  if (parent && ts.isVariableDeclaration(parent) && parent.initializer === current) {
    return { kind: 'variable', awaited, declaration: parent };
  }
  if (parent && ts.isReturnStatement(parent)) return { kind: 'return', awaited };
  if (
    parent
    && ts.isPropertyAssignment(parent)
    && parent.initializer === current
    && parent.parent
    && ts.isObjectLiteralExpression(parent.parent)
  ) {
    let invocation = parent.parent.parent;
    if (invocation && ts.isCallExpression(invocation)) {
      const target = unwrapExpression(ts, invocation.expression);
      if (
        target
        && ts.isPropertyAccessExpression(target)
        && target.name.text === 'parallel'
      ) {
        const receiver = unwrapExpression(ts, target.expression);
        if (receiver && ts.isIdentifier(receiver) && receiver.text === contextName) {
          return { kind: 'statement', awaited, parallel: invocation };
        }
      }
    }
  }
  return { kind: 'unsupported', awaited };
}

function bearerIntrinsic(sourceFile, call) {
  const descriptor = jwtContracts.JWT_PACKAGE_INTRINSICS.bearer;
  return Object.freeze({
    version: packageContracts.PACKAGE_INTRINSIC_VERSION,
    contractId: jwtContracts.JWT_CONTRACT_ID,
    package: jwtContracts.JWT_PACKAGE_NAME,
    import: jwtContracts.JWT_PACKAGE_NAME,
    kind: 'jwt.bearer',
    operation: 'bearer',
    intrinsic: descriptor.nativeIntrinsic || descriptor.name,
    packageIntrinsic: descriptor.name,
    compilerName: descriptor.compilerName,
    valueKind: descriptor.valueKind,
    argumentIndexes: descriptor.argumentIndexes,
    staticArguments: descriptor.staticArguments,
    range: rangeFor(sourceFile, call),
    loc: locFor(sourceFile, call)
  });
}

function validateBearerTokenSource(ts, sourceFile, node, contextName, bindings, diagnostics, consumedBearers) {
  const current = unwrapExpression(ts, node);
  if (!current || !ts.isCallExpression(current)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current || node,
      jwtContracts.JWT_DIAGNOSTIC_CODES.TOKEN_SOURCE_UNSUPPORTED,
      'Native JWT verification accepts only jwt.bearer(ctx.req) as its token source.',
      'Read the current request Bearer token through the package helper.'
    ));
    return undefined;
  }
  const resolved = resolveFacadeCall(ts, current, bindings);
  if (!resolved || resolved.method !== 'bearer') {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current,
      jwtContracts.JWT_DIAGNOSTIC_CODES.TOKEN_SOURCE_UNSUPPORTED,
      'Native JWT verification accepts only the package Bearer intrinsic as its token source.',
      'Pass jwt.bearer(ctx.req) directly.'
    ));
    return undefined;
  }
  consumedBearers.add(current);
  if (current.arguments.length !== 1 || !currentRequestArgument(ts, current.arguments[0], contextName)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      current.arguments[0] || current,
      jwtContracts.JWT_DIAGNOSTIC_CODES.BEARER_REQUEST_UNSUPPORTED,
      'jwt.bearer(...) must read the current canonical handler request.',
      `Pass jwt.bearer(${contextName || 'ctx'}.req) directly.`
    ));
  }
  return bearerIntrinsic(sourceFile, current);
}

function canonicalEffect(sourceFile, call, placement, parsed) {
  return Object.freeze({
    ...jwtContracts.JWT_VERIFY_OPERATION,
    version: canonicalRuntimeContracts.CANONICAL_PACKAGE_EFFECT_VERSION,
    placement: placement.kind,
    range: rangeFor(sourceFile, call),
    resource: parsed.key.resource,
    payload: Object.freeze({
      token: Object.freeze({ kind: 'bearer-request-header' }),
      ...clone(parsed.policy)
    }),
    runtimeInputs: Object.freeze([
      Object.freeze({
        name: 'token',
        argumentIndex: 1,
        source: 'package-call-argument'
      })
    ]),
    providerRequirements: parsed.providerRequirements,
    schemaReferences: parsed.schemaReference ? Object.freeze([parsed.schemaReference]) : Object.freeze([]),
    redaction: jwtContracts.JWT_EXECUTION_REQUIREMENTS.redaction,
    loc: locFor(sourceFile, call)
  });
}

function declarationResultName(ts, placement) {
  return placement && placement.declaration && ts.isIdentifier(placement.declaration.name)
    ? placement.declaration.name.text
    : undefined;
}

function isDeclarationIdentifier(ts, node) {
  const parent = node.parent;
  return Boolean(
    parent
    && (
      (ts.isVariableDeclaration(parent) && parent.name === node)
      || (ts.isParameter(parent) && parent.name === node)
      || (ts.isImportSpecifier(parent) && parent.name === node)
      || (ts.isImportClause(parent) && parent.name === node)
      || (ts.isNamespaceImport(parent) && parent.name === node)
    )
  );
}

function validateResultAccess(ts, sourceFile, entry, diagnostics) {
  const name = entry.resultName;
  if (!name) return;
  let reported = false;
  function visit(node) {
    if (reported) return;
    if (ts.isIdentifier(node) && node.text === name && !isDeclarationIdentifier(ts, node)) {
      const parent = node.parent;
      const allowed = parent
        && ts.isPropertyAccessExpression(parent)
        && parent.expression === node
        && ['claims', 'protectedHeader'].includes(parent.name.text);
      if (!allowed) {
        diagnostics.push(makeDiagnostic(
          sourceFile,
          node,
          jwtContracts.JWT_DIAGNOSTIC_CODES.RESULT_ACCESS_UNSUPPORTED,
          'Native JWT verification results may be read only through claims or protectedHeader.',
          `Use ${name}.claims or ${name}.protectedHeader without passing the complete verification object through user state.`,
          { result: 'jwt-verification' }
        ));
        reported = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function sourceFileFromInputs(ts, inputs) {
  if (inputs.sourceFile) return inputs.sourceFile;
  const sourceText = inputs.sourceText === undefined ? '' : String(inputs.sourceText);
  const sourcePath = inputs.sourcePath || '<jwt-lowering-plan>';
  return ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    /\.[cm]?tsx?$/.test(sourcePath) ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );
}

function buildJwtLoweringPlan(inputs = {}) {
  const ts = loadTypeScript(inputs);
  const sourceFile = sourceFileFromInputs(ts, inputs);
  const manifest = inputs.jwtManifest || inputs.manifest || require('./pulsewasm.manifest.cjs');
  const diagnostics = [];
  const bindings = collectFacadeBindings(ts, sourceFile, manifest);
  const entries = [];
  const privateRealizationArtifacts = [];
  const bearerCalls = [];
  const consumedBearers = new Set();

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const resolved = resolveFacadeCall(ts, node, bindings);
      if (resolved && resolved.method === 'sign') {
        const contextName = enclosingContextName(ts, node);
        const placement = placementForCall(ts, node, contextName);
        const error = (code, message) => diagnostics.push(makeDiagnostic(sourceFile, node, code, message,
          'Await jwt.sign(ctx, claims, { algorithm: "HS256", key: { type: "secret", binding: "NAME" }, expiresInSeconds: 45 }) into a local or in ctx.parallel.'));
        if (node.arguments.length !== 3 || !currentContextArgument(ts, node.arguments[0], contextName)) {
          error(jwtContracts.JWT_DIAGNOSTIC_CODES.ARGUMENT_SHAPE_UNSUPPORTED, 'Signing requires the current handler context, claims, and static options.');
          return;
        }
        if (!(placement.kind === 'variable' && placement.awaited || placement.parallel && ts.isAwaitExpression(placement.parallel.parent))) {
          error(jwtContracts.JWT_DIAGNOSTIC_CODES.PLACEMENT_UNSUPPORTED, 'Signing must be directly awaited or grouped.');
        }
        const members = objectMembers(ts, sourceFile, node.arguments[2], new Set(['algorithm', 'key', 'expiresInSeconds']), diagnostics,
          jwtContracts.JWT_DIAGNOSTIC_CODES.OPTIONS_LITERAL_REQUIRED, 'JWT signing options');
        const algorithm = literalString(ts, members.get('algorithm'));
        const expiresInSeconds = literalNumber(ts, members.get('expiresInSeconds'));
        if (algorithm !== 'HS256') error(jwtContracts.JWT_DIAGNOSTIC_CODES.ALGORITHM_UNSUPPORTED, 'Signing supports only HS256.');
        if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 300) {
          error(jwtContracts.JWT_DIAGNOSTIC_CODES.POLICY_LIMIT_EXCEEDED, 'Signing requires a literal lifetime from 1 through 300 seconds.');
        }
        const key = parseKey(ts, sourceFile, members.get('key') || node, ['HS256'], diagnostics);
        if (key.descriptor.type !== 'secret' || !key.resource.secretBinding || key.resource.secretBinding.length > 256
          || key.resource.secretBinding.includes('\0') || !key.resource.secretBinding.trim()) {
          error(jwtContracts.JWT_DIAGNOSTIC_CODES.KEY_TYPE_UNSUPPORTED, 'Signing requires a bounded named secret binding.');
        }
        const effect = Object.freeze({ ...jwtContracts.JWT_SIGN_OPERATION, placement: placement.kind,
          range: rangeFor(sourceFile, node), loc: locFor(sourceFile, node), resource: key.resource,
          payload: { algorithm: 'HS256', expiresInSeconds: expiresInSeconds || 0 },
          runtimeInputs: [{ name: 'claims', argumentIndex: 1, source: 'package-call-argument' }],
          providerRequirements: jwtContracts.JWT_SIGN_CONTRACT.providerRequirements,
          schemaReferences: [], redaction: ['claims', 'token', 'signature', 'key-material', 'secret-value'] });
        entries.push(Object.freeze({ kind: 'jwt-sign', symbol: 'jwt.sign', placement: placement.kind,
          awaited: placement.awaited, algorithms: [], key: key.descriptor,
          providerRequirements: effect.providerRequirements, range: effect.range, loc: effect.loc, canonicalEffect: effect }));
      }
      if (resolved && resolved.method === 'bearer') bearerCalls.push(node);
      if (resolved && resolved.method === 'verify') {
        const contextName = enclosingContextName(ts, node);
        if (node.arguments.length !== 3) diagnostics.push(makeDiagnostic(
          sourceFile,
          node,
          jwtContracts.JWT_DIAGNOSTIC_CODES.ARGUMENT_SHAPE_UNSUPPORTED,
          'jwt.verify(...) requires the current context, Bearer token source, and static options.',
          'Call jwt.verify(ctx, jwt.bearer(ctx.req), { ...staticPolicy }).'
        ));
        if (!currentContextArgument(ts, node.arguments[0], contextName)) diagnostics.push(makeDiagnostic(
          sourceFile,
          node.arguments[0] || node,
          jwtContracts.JWT_DIAGNOSTIC_CODES.CONTEXT_UNSUPPORTED,
          'jwt.verify(...) must receive the current canonical handler context.',
          `Pass ${contextName || 'ctx'} directly as the first argument.`
        ));
        const intrinsic = validateBearerTokenSource(
          ts,
          sourceFile,
          node.arguments[1],
          contextName,
          bindings,
          diagnostics,
          consumedBearers
        );
        const placement = placementForCall(ts, node, contextName);
        if (
          placement.kind === 'unsupported'
          || (placement.kind === 'variable' && !placement.awaited)
          || (placement.kind === 'statement' && placement.awaited)
        ) diagnostics.push(makeDiagnostic(
          sourceFile,
          node,
          jwtContracts.JWT_DIAGNOSTIC_CODES.PLACEMENT_UNSUPPORTED,
          'jwt.verify(...) is not in a supported Native effect position.',
          'Directly await it into a variable, return it, or place it directly inside awaited ctx.parallel({ ... }).',
          { placement: placement.kind, awaited: placement.awaited }
        ));
        const parsed = parseOptions(ts, sourceFile, node.arguments[2], diagnostics, inputs);
        if (parsed.key.realizationArtifact) {
          privateRealizationArtifacts.push(parsed.key.realizationArtifact);
        }
        const effect = canonicalEffect(sourceFile, node, placement, parsed);
        entries.push(Object.freeze({
          kind: 'jwt-verify',
          symbol: 'jwt.verify',
          placement: placement.kind,
          awaited: placement.awaited,
          resultName: declarationResultName(ts, placement),
          algorithms: Object.freeze([...parsed.policy.algorithms]),
          key: parsed.key.descriptor,
          providerRequirements: parsed.providerRequirements,
          schemaReference: parsed.schemaReference,
          bearerIntrinsic: intrinsic,
          range: rangeFor(sourceFile, node),
          loc: locFor(sourceFile, node),
          canonicalEffect: effect
        }));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  for (const call of bearerCalls) {
    if (consumedBearers.has(call)) continue;
    diagnostics.push(makeDiagnostic(
      sourceFile,
      call,
      jwtContracts.JWT_DIAGNOSTIC_CODES.BEARER_PLACEMENT_UNSUPPORTED,
      'jwt.bearer(...) is a Native compiler intrinsic only when used directly as jwt.verify token input.',
      'Pass jwt.bearer(ctx.req) directly as the second jwt.verify argument.'
    ));
  }
  for (const entry of entries.filter(entry => entry.kind === 'jwt-verify')) validateResultAccess(ts, sourceFile, entry, diagnostics);

  const canonicalEffects = entries.map((entry) => entry.canonicalEffect);
  const canonicalIntrinsics = entries.map((entry) => entry.bearerIntrinsic).filter(Boolean);
  const schemaReferences = entries.map((entry) => entry.schemaReference).filter(Boolean);
  const cryptoRequirements = Object.freeze([...jwtContracts.jwtCryptoRequirements(
    entries.flatMap((entry) => entry.algorithms)
  ), ...(entries.some(entry => entry.kind === 'jwt-sign') ? [{
    version: packageContracts.PACKAGE_CRYPTO_REQUIREMENT_VERSION, requestedBy: jwtContracts.JWT_PACKAGE_NAME,
    semanticOwner: '@pulse-compute/crypto', reachable: true, algorithms: ['HMAC-SHA256']
  }] : [])]);
  const keyArtifacts = entries
    .filter((entry) => entry.key.keyArtifactId)
    .map((entry) => Object.freeze({
      id: entry.key.keyArtifactId,
      keyType: entry.key.type,
      keyCount: entry.key.count,
      materialHash: entry.key.materialHash,
      materialIncludedInPlan: false
    }));
  const uniqueKeyArtifacts = [...new Map(keyArtifacts.map((entry) => [entry.id, entry])).values()];
  const realizationArtifacts = [...new Map(privateRealizationArtifacts
    .map((entry) => [entry.id, entry])).values()];
  const guestUnits = entries.some((entry) => entry.algorithms.includes('ES256'))
    ? Object.freeze([loadCryptoGuestContribution()])
    : Object.freeze([]);
  const artifact = deepFreeze(normalizeArtifact({
    version: jwtContracts.JWT_LOWERING_PLAN_VERSION,
    generatedBy: inputs.generatedBy || 'pulse.jwt-package-lowerer.v1',
    phase: phaseName,
    contractId: jwtContracts.JWT_CONTRACT_ID,
    package: jwtContracts.JWT_PACKAGE_NAME,
    lowerableSubpath: manifest.lowerableSubpath,
    status: hasErrors(diagnostics) ? 'error' : 'ok',
    source: stableFileName(sourceFile.fileName, inputs.cwd || process.cwd()),
    manifest: {
      version: manifest.version,
      contractId: manifest.contractId,
      package: manifest.npmPackage,
      builderOwner: manifest.compiler && manifest.compiler.builderOwner,
      builderTrust: manifest.compiler && manifest.compiler.trust,
      sidecar: manifest.modes && manifest.modes.wasm && manifest.modes.wasm.sidecar
    },
    entries: entries.map((entry) => ({
      kind: entry.kind,
      placement: entry.placement,
      awaited: entry.awaited,
      algorithms: entry.algorithms,
      key: entry.key,
      providerRequirements: entry.providerRequirements,
      schemaReference: entry.schemaReference,
      range: entry.range,
      loc: entry.loc
    })),
    canonicalEffects,
    canonicalIntrinsics,
    schemaReferences,
    cryptoRequirements,
    keyArtifacts: uniqueKeyArtifacts,
    diagnostics,
    policy: {
      packageOwnsRecognition: true,
      compilerOwnsPackageMapping: false,
      canonicalOperationOnly: true,
      bearerIntrinsicOnly: true,
      staticPolicyOnly: true,
      keyMaterialExcludedFromPlan: true,
      rawTokenExcludedFromPlan: true,
      providerNeutral: true,
      targetBindingSwappable: true,
      targetEligibilityDeferredToProviderBoundary: true,
      cryptoSemanticOwner: '@pulse-compute/crypto',
      cryptoRequirementComposition: true,
      jwtOwnsCryptoRealizationSelection: false,
      automaticFallback: false
    },
    summary: {
      entries: entries.length,
      effects: canonicalEffects.length,
      intrinsics: canonicalIntrinsics.length,
      schemaReferences: schemaReferences.length,
      cryptoRequirements: cryptoRequirements.length,
      keyArtifacts: uniqueKeyArtifacts.length,
      guestUnits: guestUnits.length,
      errors: diagnostics.filter((entry) => String(entry.severity || 'error') === 'error').length
    }
  }, inputs.cwd || process.cwd()));

  return Object.freeze({
    artifact,
    entries: Object.freeze(entries),
    canonicalEffects: Object.freeze(canonicalEffects),
    canonicalIntrinsics: Object.freeze(canonicalIntrinsics),
    schemaReferences: Object.freeze(schemaReferences),
    cryptoRequirements,
    keyArtifacts: Object.freeze(uniqueKeyArtifacts),
    realizationArtifacts: Object.freeze(realizationArtifacts),
    guestUnits,
    diagnostics: Object.freeze(diagnostics),
    manifest,
    dependencies: Object.freeze([]),
    hasErrors: hasErrors(diagnostics)
  });
}

const jwtLoweringBuilder = Object.freeze({
  name: 'jwt-lowering-builder',
  owner: jwtContracts.JWT_PACKAGE_NAME,
  trust: 'first-party',
  version: jwtContracts.JWT_LOWERING_PLAN_VERSION,
  build: buildJwtLoweringPlan
});

module.exports = Object.freeze({
  buildJwtLoweringPlan,
  jwtLoweringBuilder,
  JWT_DIAGNOSTIC_CODES: jwtContracts.JWT_DIAGNOSTIC_CODES
});
