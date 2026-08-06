'use strict';

const constants = require('./constants.js');
const contracts = require('./contracts.js');
const errors = require('./errors.js');
const files = require('./files.js');
const inspect = require('./inspect.js');
const materialize = require('./materialize.js');
const memoryOwner = require('./memory-owner.js');
const pipeline = require('./pipeline.js');
const toolchain = require('./toolchain.js');

module.exports = Object.freeze({
  versions: constants.versions,
  memoryAbi: constants.memoryAbi,
  memoryAbiV2: constants.memoryAbiV2,
  es256FrameV2: constants.es256FrameV2,
  es256GuestUnit: constants.es256GuestUnit,
  diagnosticCodes: constants.diagnosticCodes,
  binaryenVersion: constants.binaryenVersion,
  GuestLinkError: errors.GuestLinkError,
  safeDiagnosticDetails: errors.safeDetails,
  safeDiagnosticString: errors.safeString,
  normalizeGuestUnitManifest: contracts.normalizeGuestUnitManifest,
  normalizeGuestUnitPlan: contracts.normalizeGuestUnitPlan,
  sourceTreeRecord: files.sourceTreeRecord,
  inspectWasmFile: inspect.inspectWasmFile,
  materializePackagePrebuilt: materialize.materializePackagePrebuilt,
  writeMemoryOwnerModule: memoryOwner.writeMemoryOwnerModule,
  realizeGuestLinkPlan: pipeline.realizeGuestLinkPlan,
  assertFinalArtifactIdentity: pipeline.assertFinalArtifactIdentity,
  binaryenIdentity: toolchain.binaryenIdentity
});
