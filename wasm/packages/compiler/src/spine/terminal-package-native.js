'use strict';

const { findLowerableManifestRecord } = require('@pulse-compute/wasm-library-kit/compiler/package-lowering');
const { loadLowerableCompilerBuilder } = require('@pulse-compute/wasm-library-kit/compiler/handler-library-contracts');
const { compileManagedHandlerNativeBundle } = require('./handler-ir-managed.js');
const applications = new WeakMap();

function attachTerminalPackageNative(compiled, inputs) {
  applications.set(compiled, inputs);
}

function terminalPackageNativeForCompiled(compiled) {
  const inputs = applications.get(compiled);
  if (!inputs) return null;
  const { application, recognition, managedHandlers, schemaBundle, cwd, workspaceRoot } = inputs;
  const selected = recognition.packages.find(entry => entry.contractId === application.contractId);
  if (!selected || selected.builder.trust !== 'first-party') throw new TypeError('Native application requires its selected trusted lowerer.');
  const { record } = findLowerableManifestRecord({ cwd, workspaceRoot, contractId: selected.contractId, npmPackage: selected.package });
  const exportName = record?.manifest?.compiler?.nativeApplicationExport;
  if (!exportName) return null;
  const loaded = loadLowerableCompilerBuilder(record);
  const builder = Object.hasOwn(loaded.module, exportName) ? loaded.module[exportName] : null;
  if (typeof builder !== 'function') throw new TypeError('Trusted Native application builder is missing.');
  const intrinsic = recognition.intrinsics.find(entry => entry.intrinsic === application.intrinsic);
  const result = builder({
    plan: intrinsic.staticArguments[0],
    managedHandlerNativeBundle: compileManagedHandlerNativeBundle(managedHandlers),
    schemaBundle
  });
  if (result.version !== 'pulse.package-native-application.v1' || result.contractId !== selected.contractId
    || result.package !== selected.package || result.intrinsic !== application.intrinsic || result.automaticFallback !== false) {
    throw new TypeError('Trusted Native application result does not match its selected package.');
  }
  return result;
}

module.exports = { attachTerminalPackageNative, terminalPackageNativeForCompiled };
