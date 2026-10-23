'use strict';
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve((require.main === module && process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '../../..')));
const { compileCanonicalProject, packageRealizationArtifactsForCompiled } = require(path.join(root, 'wasm/packages/compiler/src/canonical-project-compiler.js'));
const { buildCanonicalNativePlan } = require(path.join(root, 'wasm/packages/compiler/src/canonical-native-plan.js'));
const platform = require(path.join(root, 'packages/provider-fastly/src/build/native-platform-capabilities.js'));
function compile(name) {
  const file = path.join(root, 'docs/internal/host-extensions/fixtures', `${name}.ts`);
  const compiled = compileCanonicalProject(file, { rootDir: root, target: 'native', packageTargetDescriptor: require(path.join(root, 'packages/provider-fastly/src/toolchain/index.js')).createDriver().targets.native });
  const plan = buildCanonicalNativePlan(compiled);
  const options = { cwd: root, canonicalBuild: true, requirePlatformCapability: false,
    bindings: { backends: { fanout: 'fanout_backend' } },
    realizationArtifacts: packageRealizationArtifactsForCompiled(compiled) };
  return { compiled, plan, options, native: platform.compileFastlyNativePlatformCapabilitiesPlan(plan, options) };
}
if (require.main === module) {
  const names = process.argv.includes('--used') ? ['absent','unused','generic','fanout'] : ['absent','unused','generic'];
  const receipt = {};
  for (const name of names) {
    const { native } = compile(name);
    receipt[name] = { bytes: native.inspection.bytes, sha256: native.inspection.sha256, imports: native.inspection.imports };
  }
  console.log(JSON.stringify(receipt, null, 2));
}
module.exports = { compile };
