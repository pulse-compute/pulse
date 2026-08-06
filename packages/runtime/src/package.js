'use strict';

const {
  PACKAGE_RUNTIME_BRIDGE_VERSION,
  PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION,
  TRUSTED_PACKAGE_EFFECT_CATALOG,
  clonePackageEffectPayload,
  createPackageRuntime,
  createPackageSchemaCodecRuntime
} = require('./internal/package-runtime.js');

module.exports = Object.freeze({
  PACKAGE_RUNTIME_BRIDGE_VERSION,
  PACKAGE_SCHEMA_CODEC_BRIDGE_VERSION,
  TRUSTED_PACKAGE_EFFECT_CATALOG,
  clonePackageEffectPayload,
  createPackageRuntime,
  createPackageSchemaCodecRuntime
});
