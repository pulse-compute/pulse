'use strict';
// These descriptors prove reads of existing handles, never runtime conversions.
const scalar = type => ['string', 'number', 'boolean'].includes(type);
const kind = type => typeof type === 'string' ? type : type?.kind === 'record' ? 'object' : type?.kind === 'number-array' ? 'array' : 'unknown';
function validType(type, depth = 0) {
  if (scalar(type)) return true;
  if (!type || typeof type !== 'object' || depth > 2) return false;
  if (type.kind === 'number-array') return Object.keys(type).length === 1;
  return type.kind === 'record' && depth < 2 && Object.keys(type).sort().join() === 'fields,kind'
    && Array.isArray(type.fields) && type.fields.length > 0 && type.fields.length <= 32
    && new Set(type.fields.map(f => f?.name)).size === type.fields.length
    && type.fields.every(f => f && Object.keys(f).sort().join() === 'name,type' && typeof f.name === 'string'
      && /^[A-Za-z_$][\w$]*$/.test(f.name) && !['__proto__','constructor','prototype'].includes(f.name) && validType(f.type, depth + 1));
}
function same(a, b) {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'number-array' || a.fields.length === b.fields.length && a.fields.every(f => same(f.type, b.fields.find(g => g.name === f.name)?.type));
}
function member(type, property) {
  if (type?.kind === 'number-array' && property === 'length') return 'number';
  return type?.kind === 'record' && Array.isArray(type.fields) ? type.fields.find(f => f.name === property)?.type : undefined;
}
function readType(e, types) {
  if (!e) return;
  if (e.kind === 'local') return types?.get(e.id);
  if (e.kind === 'property') return member(readType(e.object, types), e.property);
  if (e.kind === 'element' && readType(e.object, types)?.kind === 'number-array' && e.index?.valueKind === 'number') return 'number';
}
module.exports = { scalar, kind, validType, same, member, readType };
