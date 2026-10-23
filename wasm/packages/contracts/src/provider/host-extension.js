'use strict';

// Data-only contract. Selected lowerers remain trusted build dependencies.
const crypto = require('node:crypto');
const VERSION = 'pulse.host-extension.v1';
const ADMISSION_VERSION = 'pulse.host-extension-admission.v1';
const POLICY_VERSION = 'pulse.host-extension-import-policy.v1';
const TERMINAL_SERVICE = 'terminal-request-backend.v1';
const KIND = 'host-extension';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const identity = value => JSON.stringify(stable(value));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function fail(code, message, operation) {
  const error = new TypeError(message);
  error.code = 'PULSE_HOST_EXTENSION_' + code;
  error.detail = freeze(operation ? { package: operation.package, contractId: operation.contractId,
    operation: operation.operation, loc: operation.source || operation.loc || null } : {});
  throw error;
}
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID', 'Host contribution must contain plain data records.');
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!keys.includes(key) || !property.enumerable || !Object.hasOwn(property, 'value')) fail('INVALID', 'Host contribution has an unknown or executable field.');
  }
}
function text(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_@][A-Za-z0-9_@./:-]{0,255}$/.test(value)) fail('INVALID', 'Host contribution identity must be a bounded static identifier.');
  return value;
}
function list(value, maximum = 64) {
  if (!Array.isArray(value) || value.length > maximum || Object.keys(value).length !== value.length) fail('INVALID', 'Host contribution list is invalid or exceeds its bound.');
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index)) || {}, 'value')) fail('INVALID', 'Host contribution lists cannot contain accessors.');
  }
  return value;
}
function normalizeAdmission(value) {
  record(value, ['version', 'protocols', 'services']);
  if (value.version !== ADMISSION_VERSION) fail('PROTOCOL', 'Unsupported host contribution admission version.');
  const unique = values => { const result = list(values).map(text); if (new Set(result).size !== result.length) fail('CONFLICT', 'Duplicate host contribution admission declaration.'); return result.sort(); };
  return freeze({ version: ADMISSION_VERSION, protocols: unique(value.protocols), services: unique(value.services) });
}
function signature(value) {
  record(value, ['module', 'name', 'parameters', 'results']);
  function types(values, max) { return list(values, max).map(type => {
    if (!['i32', 'i64', 'f32', 'f64'].includes(type)) fail('SIGNATURE', 'Host contributions require MVP scalar function signatures.'); return type;
  }); }
  return { module: text(value.module), name: text(value.name), parameters: types(value.parameters, 32), results: types(value.results, 1) };
}
function normalizeContribution(value, authority) {
  record(value, ['version', 'id', 'kind', 'mediaType', 'package', 'contractId', 'data']);
  if (value.version !== VERSION) fail('PROTOCOL', 'Unsupported host contribution protocol version.');
  if (value.kind !== KIND || value.mediaType !== 'text/assemblyscript') fail('INVALID', 'Host contribution must carry generated AssemblyScript.');
  const owner = text(value.package), contractId = text(value.contractId), id = text(value.id);
  if (!id.startsWith(owner + ':') || id.length <= owner.length + 1
    || authority && (owner !== authority.npmPackage || contractId !== authority.contractId)) fail('OWNER', 'Host contribution must belong to its selected package and contract authority.');
  const data = value.data;
  record(data, ['target', 'operation', 'service', 'source', 'sha256', 'entry', 'imports']);
  record(data.target, ['provider', 'target', 'targetId']);
  const target = { provider: text(data.target.provider), target: text(data.target.target), targetId: text(data.target.targetId) };
  if (target.target !== 'native') fail('TARGET', 'This host contribution protocol supports Native generated source only.');
  const source = data.source;
  // v1 carries self-contained generated source only, never a filesystem path or
  // export resolver. Module syntax is deliberately excluded even in comments.
  if (typeof source !== 'string' || !source || Buffer.byteLength(source) > 65536
    || /\b(?:import|export)\b|\b__(?:pulse_|Pulse)/.test(source)) fail('SOURCE', 'Host contribution source must be bounded and self-contained, without module imports, exports or provider-private identifiers.');
  if (data.sha256 !== hash(source)) fail('SOURCE', 'Host contribution source digest does not match.');
  if (typeof data.entry !== 'string' || !/^__[A-Za-z][A-Za-z0-9_]{0,127}$/.test(data.entry) || /^__(?:pulse_|Pulse)/.test(data.entry)) fail('SOURCE', 'Host contribution entry must be a package-owned static source symbol.');
  const imports = list(data.imports).map(signature).sort((a,b) => identity(a).localeCompare(identity(b)));
  if (!imports.length || new Set(imports.map(i => identity([i.module, i.name]))).size !== imports.length) fail('CONFLICT', 'Host contribution imports must have unique module/name identities.');
  return freeze({ version: VERSION, id, kind: KIND, mediaType: 'text/assemblyscript', package: owner, contractId,
    data: { target, operation: text(data.operation), service: text(data.service), source, sha256: data.sha256, entry: data.entry, imports } });
}
const operationKey = operation => identity([operation.package, operation.contractId, operation.operation]);
function matches(operation, artifact) { return artifact.kind === KIND && operationKey(operation) === operationKey({ ...artifact, operation: artifact.data.operation }); }
function select(operations, artifacts, target = {}) {
  const used = operations.filter(operation => operation.kind === 'host.extension');
  if (!used.length) return freeze([]);
  const candidates = list(artifacts.filter(a => a.kind === KIND), 256).map(a => normalizeContribution(a));
  const ids = new Set();
  for (const artifact of candidates) { if (ids.has(artifact.id)) fail('CONFLICT', 'Duplicate host contribution identity.', used[0]); ids.add(artifact.id); }
  const admission = target.hostExtensions && normalizeAdmission(target.hostExtensions);
  const selected = new Map(), owners = new Map();
  for (const operation of used) {
    const key = identity([operation.package, operation.operation]);
    if (owners.has(key) && owners.get(key) !== operation.contractId) fail('OWNER', 'A package operation cannot have multiple contract owners.', operation);
    owners.set(key, operation.contractId);
  }
  for (const operation of used) {
    const owned = candidates.filter(a => matches(operation, a));
    const compatible = owned.filter(a => a.data.target.provider === target.provider && a.data.target.target === target.target && a.data.target.targetId === target.targetId);
    if (!compatible.length || !admission) fail('TARGET', `${operation.package}.${operation.operation} is not implemented for this host (${target.targetId || 'unspecified'}).`, operation);
    if (compatible.length !== 1) fail('CONFLICT', 'A used package operation requires exactly one compatible host contribution.', operation);
    const artifact = compatible[0];
    if (!admission.protocols.includes(artifact.version) || !admission.services.includes(artifact.data.service)) fail('PROTOCOL', 'Selected provider does not admit the contribution protocol and service.', operation);
    selected.set(operationKey(operation), artifact);
  }
  const result = [...selected.values()].sort((a,b) => a.id.localeCompare(b.id));
  if (new Set(result.map(a => a.data.entry)).size !== result.length) fail('CONFLICT', 'Selected host contribution source entry symbols collide.', used[0]);
  return freeze(result);
}
function composeImportPolicy(baseline, selected) {
  selected = list(selected, 256).map(a => normalizeContribution(a));
  const baselineImports = baseline.map(i => ({ module: i.module, name: i.name, kind: i.kind || 'function' }))
    .sort((a,b) => identity(a).localeCompare(identity(b)));
  const ceiling = new Map(baselineImports.map(i => [identity([i.module, i.name]), i]));
  const declarations = new Map();
  for (const artifact of selected) for (const declaration of artifact.data.imports) {
    const key = identity([declaration.module, declaration.name]);
    if (ceiling.has(key)) fail('CONFLICT', 'A host contribution cannot redeclare a provider baseline import.');
    const prior = declarations.get(key);
    if (prior && identity(prior) !== identity(declaration)) fail('SIGNATURE', 'Selected host contributions declare conflicting ABI signatures.');
    declarations.set(key, declaration);
  }
  const descriptor = {
    version: POLICY_VERSION, baselineSha256: hash(identity(baselineImports)),
    contributions: selected.map(a => ({ id:a.id, package:a.package, contractId:a.contractId, version:a.version,
      operation:a.data.operation, target:a.data.target, service:a.data.service, entry:a.data.entry, sha256:a.data.sha256 })).sort((a,b)=>a.id.localeCompare(b.id)),
    imports: [...declarations.values()].sort((a,b)=>identity(a).localeCompare(identity(b)))
  };
  return freeze({ ...descriptor, sha256: hash(identity(descriptor)), permittedImports: [
    ...baselineImports, ...descriptor.imports.map(i=>({module:i.module,name:i.name,kind:'function'}))
  ].sort((a,b)=>identity(a).localeCompare(identity(b))) });
}
// Validate actual binary signatures and the entire admitted ceiling. Declared
// permission is computed before this function sees any observed import.
function auditWasm(bytes, policy) {
  const descriptor = { version: policy.version, baselineSha256: policy.baselineSha256, contributions: policy.contributions, imports: policy.imports };
  const keys = new Set(policy.imports.map(i => identity([i.module, i.name])));
  const baseline = policy.permittedImports.filter(i => !keys.has(identity([i.module, i.name])));
  const expected = [...baseline, ...policy.imports.map(i => ({module:i.module, name:i.name, kind:'function'}))].sort((a,b)=>identity(a).localeCompare(identity(b)));
  if (policy.version !== POLICY_VERSION || hash(identity(descriptor)) !== policy.sha256
    || hash(identity(baseline)) !== policy.baselineSha256 || identity(expected) !== identity(policy.permittedImports))
    fail('IMPORT', 'Host contribution import policy identity does not match its contents.');
  if (!WebAssembly.validate(bytes)) fail('SIGNATURE', 'Host contribution artifact is not valid Wasm.');
  bytes = Buffer.from(bytes);
  let p = 8, limit = bytes.length;
  const types = [], imports = [];
  const byte = () => { if (p >= limit) fail('SIGNATURE', 'Truncated Wasm signature section.'); return bytes[p++]; };
  const leb = () => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const next = byte();
      value += (next & 127) * 2 ** shift;
      if (!(next & 128)) {
        if (value > 0xffffffff) fail('SIGNATURE', 'Invalid Wasm integer.');
        return value;
      }
    }
    fail('SIGNATURE', 'Invalid Wasm integer.');
  };
  const name = () => {
    const length = leb();
    if (length > limit - p) fail('SIGNATURE', 'Truncated Wasm import name.');
    const value = bytes.toString('utf8', p, p + length);
    p += length;
    return value;
  };
  const vector = () => {
    const length = leb();
    if (length > limit - p) fail('SIGNATURE', 'Invalid Wasm signature vector.');
    return Array.from({ length }, () => byte());
  };
  while (p < bytes.length) {
    limit = bytes.length;
    const id = byte(), size = leb(), end = p + size;
    if (end > bytes.length) fail('SIGNATURE', 'Truncated Wasm section.');
    limit = end;
    if (id === 1) for (let count = leb(); count > 0; count--) {
      if (byte() !== 0x60) fail('SIGNATURE', 'Unsupported Wasm type.');
      types.push([vector(), vector()]);
    }
    if (id === 2) for (let count = leb(); count > 0; count--) {
      const module = name(), field = name(), kind = byte();
      if (kind !== 0) fail('IMPORT', 'Host contribution realization permits function imports only.');
      imports.push({ module, name: field, signature: types[leb()] });
    }
    p = end;
  }
  const permitted = new Set(policy.permittedImports.map(i => identity([i.module, i.name])));
  const observed = new Map();
  for (const row of imports) {
    const key = identity([row.module, row.name]);
    if (!permitted.has(key)) fail('IMPORT', 'Emitted Wasm imports exceed the admitted host contribution ceiling.');
    if (observed.has(key) && identity(observed.get(key)) !== identity(row.signature)) {
      fail('SIGNATURE', 'Emitted imports have conflicting ABI signatures.');
    }
    observed.set(key, row.signature);
  }
  const codes = { i32: 127, i64: 126, f32: 125, f64: 124 };
  for (const declaration of policy.imports) {
    const actual = observed.get(identity([declaration.module, declaration.name]));
    const expected = [declaration.parameters.map(type => codes[type]), declaration.results.map(type => codes[type])];
    if (identity(actual) !== identity(expected)) fail('SIGNATURE', 'Emitted import is missing or has a conflicting ABI signature.');
  }
  return freeze({ policySha256: policy.sha256,
    observedImports: imports.map(({ module, name, signature }) => ({ module, name, signature })) });
}

module.exports = Object.freeze({ VERSION, ADMISSION_VERSION, POLICY_VERSION, TERMINAL_SERVICE, KIND,
  normalizeAdmission, normalizeContribution, select, matches, composeImportPolicy, auditWasm, fail });
