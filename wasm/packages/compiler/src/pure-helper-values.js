'use strict';
const { CANONICAL_NATIVE_TYPED_KV_BORROW_VERSION } = require('@pulse-compute/wasm-contracts/handler/canonical-native-plan');
// These descriptors prove reads of existing handles, never runtime conversions.
const SCALAR_TYPES = Object.freeze(['string', 'number', 'boolean']);
const BORROW_LIMITS = Object.freeze({ recordDepth: 2, recordFields: 32 });
const FORBIDDEN_FIELDS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const scalar = type => SCALAR_TYPES.includes(type);
const kind = type => typeof type === 'string' ? type : type?.kind === 'record' ? 'object' : type?.kind === 'number-array' ? 'array' : 'unknown';
function validType(type, depth = 0) {
  if (scalar(type)) return true;
  if (!type || typeof type !== 'object' || depth > BORROW_LIMITS.recordDepth) return false;
  if (type.kind === 'number-array') return Object.keys(type).length === 1;
  return type.kind === 'record' && depth < BORROW_LIMITS.recordDepth && Object.keys(type).sort().join() === 'fields,kind'
    && Array.isArray(type.fields) && type.fields.length > 0 && type.fields.length <= BORROW_LIMITS.recordFields
    && new Set(type.fields.map(f => f?.name)).size === type.fields.length
    && type.fields.every(f => f && Object.keys(f).sort().join() === 'name,type' && typeof f.name === 'string'
      && /^[A-Za-z_$][\w$]*$/.test(f.name) && !FORBIDDEN_FIELDS.includes(f.name) && validType(f.type, depth + 1));
}
function same(a, b) {
  if (a === undefined && b === undefined) return true;
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'number-array' || Array.isArray(a.fields) && Array.isArray(b.fields) && a.fields.length === b.fields.length && a.fields.every(f => same(f.type, b.fields.find(g => g.name === f.name)?.type));
}
function member(type, property) {
  if ((type === 'string' || type?.kind === 'number-array') && property === 'length') return 'number';
  return type?.kind === 'record' && Array.isArray(type.fields) ? type.fields.find(f => f.name === property)?.type : undefined;
}
// Result facts are not admission. These two existing inference boundaries have
// different evidence: plan kinds describe dynamic values; readType reconstructs
// proven structural types. Preserve their differences until policy is changed
// deliberately. Independent helper validation still owns operand/admission proof.
const BINARY_RULES = Object.freeze({
  '===': 'comparison', '!==': 'comparison', '==': 'comparison', '!=': 'comparison',
  '<': 'comparison', '<=': 'comparison', '>': 'comparison', '>=': 'comparison',
  '&&': 'logical', '||': 'logical', '??': 'logical',
  '+': 'numeric', '-': 'numeric', '*': 'numeric', '/': 'numeric', '%': 'numeric',
  '**': 'numeric', '&': 'numeric', '|': 'numeric', '^': 'numeric',
  '<<': 'numeric', '>>': 'numeric', '>>>': 'numeric'
});
const UNARY_TYPES = Object.freeze({ '!': 'boolean', typeof: 'string', '+': 'number', '-': 'number', '~': 'number' });
function binaryRule(operator) {
  return Object.hasOwn(BINARY_RULES, operator) ? BINARY_RULES[operator] : undefined;
}
function binaryResult(operator, a, b, planKind, optionalStringDefault = true) {
  const rule = binaryRule(operator);
  const unknown = planKind ? 'unknown' : undefined;
  if (rule === 'logical') {
    if (planKind ? a === b : same(a, b)) return a;
    if (optionalStringDefault && ['||', '??'].includes(operator) && (planKind
      ? a === 'string-or-undefined' && b === 'string'
        || operator === '??' && a === 'string' && b === 'string-or-undefined'
      : a === 'string-or-undefined' && b === 'string')) return 'string';
    return unknown;
  }
  if (rule === 'comparison' || planKind && operator === 'in') return 'boolean';
  if (!planKind && (!scalar(a) || !scalar(b))) return undefined;
  if (operator === '+' && (a === 'string' || b === 'string')) return 'string';
  // The proven reader historically reports numeric result facts for scalar
  // operands, even before operator admission. It must not become a validator.
  return !planKind || rule === 'numeric' ? 'number' : unknown;
}
function binaryKind(operator, leftKind, rightKind, optionalStringDefault = true) {
  return binaryResult(operator, leftKind, rightKind, true, optionalStringDefault);
}
function unaryType(operator) {
  return Object.hasOwn(UNARY_TYPES, operator) ? UNARY_TYPES[operator] : undefined;
}
function unaryKind(operator) { return unaryType(operator) || 'number'; }
function element(type, indexType, literalIndex, optionalStringIndex = false) {
  if (indexType === 'number') {
    if (type === 'string') return optionalStringIndex ? 'string-or-undefined' : 'string';
    if (type?.kind === 'number-array') return 'number';
  }
  if (typeof literalIndex === 'string') return member(type, literalIndex);
}
// Projection types are derived from declarations, literals and schema boundaries.
// They describe existing dynamic handles; they do not validate external data.
function schemaType(node) {
  if (['string','boolean'].includes(node?.kind)) return node.kind;
  if (['i32','u32','f64'].includes(node?.kind)) return 'number';
  if (node?.kind === 'array' && schemaType(node.element) === 'number') return {kind:'number-array'};
  if (node?.kind === 'object') return {kind:'record', ...(node.open || node.additionalProperties ? {open:true} : {}), fields: node.fields.map(f => ({name:f.name,
    type: f.required ? schemaType(f.value) : schemaType(f.value) === 'string' ? 'string-or-undefined' : undefined}))};
}
function schemaRead(id, registry) {
  return id?.kind === 'literal' && typeof id.value === 'string' ? schemaType(registry?.schemas?.find(s => s.id === id.value)?.root) : undefined;
}
function effectType(effect, registry) {
  if (effect.kind === 'kv.getVersioned' && effect.borrowedValue?.version === CANONICAL_NATIVE_TYPED_KV_BORROW_VERSION
    && validType(effect.borrowedValue.type)) return {kind:'record', fields:[
      {name:'status',type:'string'}, {name:'value',type:effect.borrowedValue.type}]};
  if (effect.result?.decoder?.kind === 'json') return schemaRead(effect.result.decoder.arguments?.[0], registry);
}
function readType(e, types, optionalStringIndex = false) {
  if (!e) return;
  const read = value => readType(value, types, optionalStringIndex);
  if (e.kind === 'local') return types?.get(e.id);
  if (e.kind === 'literal' && scalar(typeof e.value)) return typeof e.value;
  if (e.kind === 'property') return member(read(e.object), e.property);
  if (e.kind === 'element') {
    const type = element(read(e.object), read(e.index), e.index?.kind === 'literal' ? e.index.value : undefined, optionalStringIndex);
    if (type) return type;
  }
  if (e.kind === 'intrinsic' && e.name === 'request.text' && Array.isArray(e.arguments) && e.arguments.length === 0) return 'string';
  if (e.kind === 'intrinsic' && ['request.json','schema.decode.text'].includes(e.name)) return schemaRead(e.arguments?.[e.name === 'request.json' ? 0 : 1], types?.schemas);
  if (e.kind === 'array' && e.items.every(item => read(item) === 'number')) return {kind:'number-array'};
  if (e.kind === 'object') {
    if (!e.entries.some(entry => entry.kind === 'spread')) {
      if (e.entries.every(f => f.kind === 'property' && f.key?.kind === 'literal' && typeof f.key.value === 'string')
        && new Set(e.entries.map(f => f.key.value)).size === e.entries.length)
        return {kind:'record',fields:e.entries.map(f=>({name:f.key.value,type:read(f.value)}))};
      return;
    }
    const fields = new Map(), explicit = new Set();
    for (const entry of e.entries) {
      if (entry.kind === 'spread') {
        const spread = read(entry.value);
        if (spread?.kind !== 'record' || !validType(spread)) return;
        for (const field of spread.fields) fields.set(field.name, field.type);
      } else if (entry.kind === 'property' && entry.key?.kind === 'literal' && typeof entry.key.value === 'string'
        && !explicit.has(entry.key.value)) {
        explicit.add(entry.key.value);
        fields.set(entry.key.value, read(entry.value));
      } else return;
    }
    const result = {kind:'record', fields:[...fields].map(([name,type]) => ({name,type}))};
    if (validType(result)) return result;
  }
  if (e.kind === 'conditional') { const a=read(e.whenTrue),b=read(e.whenFalse); if(same(a,b))return a; }
  if (e.kind === 'binary') return binaryResult(e.operator, read(e.left), read(e.right), false);
  if (e.kind === 'unary') return unaryType(e.operator);
  if (e.kind === 'template') return 'string';
}
module.exports = { SCALAR_TYPES, BORROW_LIMITS, FORBIDDEN_FIELDS, scalar, kind, validType, same, member,
  binaryRule, binaryKind, unaryKind, element, readType, schemaType, schemaRead, effectType };
