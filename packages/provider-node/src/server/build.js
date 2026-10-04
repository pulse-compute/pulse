'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { instantiateCanonicalNativeModule } = require('@pulse-compute/wasm-host-runtime/runtime/canonical-native-host');
const { createNodeProviderAdapter } = require('../runtime/canonical-api-runtime.js');
const { assertNodeJavascriptApplication } = require('../javascript/runtime-host.js');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

function loadBuild(options) {
  const root = fs.realpathSync(options.buildDir);
  function file(name) {
    if (typeof name !== 'string' || !name || path.isAbsolute(name) || name.split(/[\\/]/).includes('..')) throw new TypeError('Invalid Node build file path.');
    const absolute = fs.realpathSync(path.join(root, name));
    if (!absolute.startsWith(root + path.sep) || !fs.statSync(absolute).isFile()) throw new TypeError('Node build file escapes buildDir.');
    return absolute;
  }
  const json = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  const build = json('pulse-build.json');
  if (build.version !== 'pulse.project-execution.v10' || build.status !== 'built' || build.provider !== 'node' || build.configuredTarget !== options.target) throw new TypeError('Node build provider/target mismatch.');
  const capabilities = options.target === 'native' ? build.program?.capabilities : build.targetSupport?.project?.capabilities?.filter(item => item.required).map(item => item.id);
  if ((Array.isArray(capabilities) ? capabilities : []).some(id => ['response.output', 'request.body.forward', 'request.body.transform', 's3.getBody'].includes(id))) {
    throw new TypeError('This build needs a stream/body launcher extension outside NODE-01.');
  }
  if (options.target === 'javascript') {
    const manifest = json(build.application.sourcePackage);
    if (manifest.version !== 'pulse.node-javascript-source-package.v2' || manifest.provider !== 'node' || manifest.target !== 'javascript' || manifest.plan.planHash !== build.application.planHash) throw new TypeError('Invalid Node JavaScript source package.');
    for (const module of manifest.modules) {
      if (sha256(fs.readFileSync(file(module.output))) !== module.outputSha256) throw new TypeError('Node JavaScript module hash mismatch.');
    }
    const application = assertNodeJavascriptApplication(require(file(manifest.package.entry)));
    const schemaCodecs = manifest.schemas.active ? require(file(manifest.package.schemaCodecs)) : undefined;
    return { application, schemaCodecs, identity: build.application.planHash };
  }
  const portable = build.portable;
  const plan = json(portable.plan);
  const unsigned = { ...plan }; delete unsigned.planHash;
  if (plan.planHash !== portable.planHash || sha256(stable(unsigned)) !== plan.planHash) throw new TypeError('Node Native plan hash mismatch.');
  const wasm = fs.readFileSync(file(portable.wasm.file));
  if (wasm.length !== portable.wasm.bytes || sha256(wasm) !== portable.wasm.sha256) throw new TypeError('Node Native Wasm hash mismatch.');
  const realizationArtifacts = portable.packageRealizationArtifacts.file ? json(portable.packageRealizationArtifacts.file) : [];
  if (sha256(stable(realizationArtifacts)) !== portable.packageRealizationArtifacts.sha256) throw new TypeError('Node Native package artifact hash mismatch.');
  const native = { wasm, plan, realizationArtifacts };
  const preflight = instantiateCanonicalNativeModule(native, { providerAdapter: createNodeProviderAdapter(), ...options });
  preflight.close();
  return { native, identity: plan.planHash };
}

module.exports = { loadBuild };
