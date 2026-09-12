'use strict';
const { normalizeBinding, namePattern } = require('@pulse-compute/s3/provider');
function normalizeNodeS3(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![null, Object.prototype].includes(Object.getPrototypeOf(input))) throw new TypeError('Node S3 bindings must be a map.');
  for (const key of Reflect.ownKeys(input)) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value')) throw new TypeError('Node S3 bindings require data properties.');
  }
  return Object.freeze(Object.fromEntries(Object.entries(input).map(([name, value]) => {
    if (!namePattern.test(name)) throw new TypeError('Node S3 logical binding name is invalid.');
    return [name, normalizeBinding(value)];
  })));
}
function validateNodeS3Operations(metadata, bindings) {
  for (const effect of metadata.providerOperations || []) {
    if (!['s3.head', 's3.getText', 's3.putText'].includes(effect.kind)) continue;
    if (!bindings.s3 || !Object.hasOwn(bindings.s3, effect.resource && effect.resource.binding)) throw new TypeError('The required Node S3 binding is missing.');
  }
}
module.exports = { normalizeNodeS3, validateNodeS3Operations };
