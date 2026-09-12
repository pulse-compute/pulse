'use strict';
const { normalizeBinding, namePattern } = require('@pulse-compute/s3/provider');
function normalizeFastlyS3(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new TypeError('Fastly S3 bindings must be a map.');
  for (const key of Reflect.ownKeys(input)) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value')) throw new TypeError('Fastly S3 bindings require data properties.');
  }
  return Object.freeze(Object.fromEntries(Object.entries(input).map(([name, value]) => {
    if (!namePattern.test(name) || !value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Reflect.ownKeys(value).some((key) => { const field = Object.getOwnPropertyDescriptor(value, key); return typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value'); })) throw new TypeError('Fastly S3 binding is invalid.');
    const { backend, ...binding } = value;
    if (typeof backend !== 'string' || !namePattern.test(backend)) throw new TypeError('Fastly S3 requires a named static backend.');
    return [name, Object.freeze({ ...normalizeBinding(binding), backend })];
  })));
}
function resolveFastlyS3(effects, input) {
  const configured = normalizeFastlyS3(input);
  return Object.freeze(effects.flatMap((effect, index) => {
    if (!['s3.head', 's3.getText', 's3.putText'].includes(effect.kind)) return [];
    const name = effect.resource && effect.resource.binding;
    if (!Object.hasOwn(configured, name)) throw new TypeError('The required Fastly S3 binding is missing.');
    return [Object.freeze({ index, ...configured[name], contentType: effect.operation === 'putText' ? require('@pulse-compute/s3/provider').normalizePutOptions({ contentType: effect.payload && effect.payload.contentType }).contentType : '' })];
  }));
}
module.exports = { normalizeFastlyS3, resolveFastlyS3 };
