'use strict';

const { findLowerableManifestRecord } = require('@pulse-compute/wasm-library-kit/compiler/package-lowering');
const { loadLowerableCompilerBuilder } = require('@pulse-compute/wasm-library-kit/compiler/handler-library-contracts');
const { compileManagedHandlerNativeBundle } = require('./handler-ir-managed.js');
const { isTrustedLowerer } = require('@pulse-compute/wasm-contracts/library/manifest');
const path = require('node:path');
const applications = new WeakMap();

function attachTerminalPackageNative(compiled, inputs) {
  applications.set(compiled, inputs);
}

function terminalPackageNativeForCompiled(compiled) {
  const inputs = applications.get(compiled);
  if (!inputs) return null;
  const { application, recognition, managedHandlers, schemaBundle, cwd, workspaceRoot } = inputs;
  const selected = recognition.packages.find(entry => entry.contractId === application.contractId);
  if (!selected || !isTrustedLowerer(selected.builder.trust)) throw new TypeError('Native application requires its selected trusted lowerer.');
  const { record } = findLowerableManifestRecord({ cwd, workspaceRoot, packageDirs: recognition.dependencies.map(file => path.dirname(file)), contractId: selected.contractId, npmPackage: selected.package });
  const exportName = record?.manifest?.compiler?.nativeApplicationExport;
  if (!exportName) return null;
  const loaded = loadLowerableCompilerBuilder(record);
  const builder = Object.hasOwn(loaded.module, exportName) ? loaded.module[exportName] : null;
  if (typeof builder !== 'function') throw new TypeError('Trusted Native application builder is missing.');
  const intrinsic = recognition.intrinsics.find(entry => entry.intrinsic === application.intrinsic);
  const nativeBundle = compileManagedHandlerNativeBundle(managedHandlers);
  const result = builder({
    plan: intrinsic.staticArguments[0],
    managedHandlerNativeBundle: nativeBundle,
    schemaBundle
  });
  if (!['pulse.package-native-application.v1', 'pulse.package-native-application.v2'].includes(result.version) || result.contractId !== selected.contractId
    || result.package !== selected.package || result.intrinsic !== application.intrinsic || result.automaticFallback !== false) {
    throw new TypeError('Trusted Native application result does not match its selected package.');
  }
  function hasPrimitive(node) {
    return node && typeof node === 'object' && (['resource-read','workspace-init','schema-text','pure-loop','scalar-assignment'].includes(node.kind) || node.mutable === true || Object.values(node).some(hasPrimitive));
  }
  if (!nativeBundle.handlers.some(handler => hasPrimitive(handler.body))) return result;
  const resourceIds = [...new Set(nativeBundle.handlers.flatMap(handler => handler.primitives?.resourceIds || []))].sort();
  const numericWorkspaces = nativeBundle.handlers.flatMap((handler, index) => (handler.primitives?.workspaces || []).map(record => ({ ...record, id: `managed-${index}-${record.id}` })));
  const primitivePlan = { version: 'pulse.managed-native-primitives.v1', resourceIds, workspaces: numericWorkspaces, handlers: nativeBundle.handlers.map((handler, index) => ({ id: handler.id, index, body: handler.body, primitives: handler.primitives, locals: handler.locals })) };
  const binaryResources = resourceIds.length ? require('@pulse-compute/wasm-contracts/resources/embedded').selectResourceCatalogue(compiled.binaryResources, resourceIds) : undefined;
  const source = result.source + '\n' + require('@pulse-compute/wasm-runtime-core-as/compiler/canonical-native').generateManagedNativePrimitiveSource({ binaryResources, numericWorkspaces });
  return { ...result, source, sourceHash: require('node:crypto').createHash('sha256').update(source).digest('hex'), primitivePlan };
}

module.exports = { attachTerminalPackageNative, terminalPackageNativeForCompiled };
