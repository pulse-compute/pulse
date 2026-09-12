'use strict';

const NODE_JWT_VERIFY_CAPABILITY = 'jwt.verify';

const NODE_CANONICAL_PROVIDER_CAPABILITIES = Object.freeze([
  's3.head', 's3.getText', 's3.putText',
  'request',
  'response.json',
  'response.text',
  'response.custom',
  'fetch',
  'config.get',
  'secret.get',
  'kv.get',
  'kv.put',
  'event.ingress',
  'event.emit',
  'assets.lookup',
  'grip.broadcast',
  NODE_JWT_VERIFY_CAPABILITY,
  'opaque.pass-through'
]);

const NODE_CANONICAL_PROVIDER_LOWERING = Object.freeze({
  request: 'node.http.request',
  'response.json': 'node.http.response.json',
  'response.text': 'node.http.response.text',
  'response.custom': 'node.http.response.custom',
  fetch: 'node.fetch.dispatch',
  'config.get': 'node.runtime.config.get',
  'secret.get': 'node.runtime.secret.get',
  'kv.get': 'node.runtime.kv.get',
  'kv.put': 'node.runtime.kv.put',
  'event.ingress': 'node.event.reference.ingress',
  'event.emit': 'node.event.reference.accept',
  's3.head': 'node.native.s3.head',
  's3.getText': 'node.native.s3.getText',
  's3.putText': 'node.native.s3.putText',
  'assets.lookup': 'node.runtime.assets.lookup',
  'grip.broadcast': 'node.http.grip.publish',
  [NODE_JWT_VERIFY_CAPABILITY]: 'node.native.jwt.verify',
  'opaque.pass-through': 'node.http.response.stream'
});

const NODE_NATIVE_TARGET_CAPABILITIES = Object.freeze([
  's3.head', 's3.getText', 's3.putText',
  NODE_JWT_VERIFY_CAPABILITY,
  'jwt.verify.hs256',
  'jwt.verify.es256',
  'secret.get',
  'event.ingress',
  'event.emit',
  'time.wall-clock'
]);

module.exports = Object.freeze({
  NODE_JWT_VERIFY_CAPABILITY,
  NODE_CANONICAL_PROVIDER_CAPABILITIES,
  NODE_CANONICAL_PROVIDER_LOWERING,
  NODE_NATIVE_TARGET_CAPABILITIES
});
