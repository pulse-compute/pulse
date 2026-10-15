'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const { discoverPackageContractCatalog } = require('../../packages/compiler/src/spine/package-operation-seam');
const { discoverLowerableLibraryManifests, loadLowerableCompilerBuilder } = require('../../packages/library-kit/src/compiler/handler-library-contracts');
const { buildReachableProjectGraph } = require('../../packages/compiler/src/project/reachable-graph-builder');
const repo = path.resolve(__dirname, '../../..');
const name = '@external-fixture/headers';
const contractId = 'external-fixture.headers';
function write(root, file, value) {
  const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); return target;
}
async function main() {
  const root = fs.mkdtempSync(path.join(__dirname, '.external-lowerer-'));
  try {
    fs.mkdirSync(path.join(root, 'node_modules/@pulse-compute'), { recursive: true });
    for (const [dependency, relative] of [['wasm-contracts', 'wasm/packages/contracts'], ['pulse', 'packages/pulse']]) {
      fs.symlinkSync(path.join(repo, relative), path.join(root, 'node_modules/@pulse-compute', dependency), 'dir');
    }
    const pkg = path.join(root, 'node_modules', name);
    // Use an existing canonical capability as the test oracle. Neither the
    // vendor identity nor its independently versioned package is registered.
    const external = {
      version: 'pulsewasm.lowerable-library-manifest.v2', kind: 'pulsewasm.lowerable-library-manifest',
      contractId, npmPackage: name, lowerableSubpath: name,
      facade: { namespace: 'headers', import: name, symbols: ['readHeader'] },
      publicApi: { package: name, symbols: ['readHeader'], compatibilitySubpaths: [] },
      compiler: { version: 'pulsewasm.lowerable-compiler-builder.v1', entry: './pulsewasm.compiler.cjs', export: 'buildHeaders', builderOwner: name, trust: 'build-dependency' },
      modes: { typescript: { entry: './index.js' }, jsEngine: { entry: './index.js', behavior: 'javascript-package-runtime' },
        wasm: { mode: 'wasm-sidecar', sidecar: './as/headers.as.ts', hostCapabilities: ['headers'],
          lowerings: [{ tsSymbol: 'headers.readHeader', asSymbol: 'request_header', hostCapabilities: ['headers'] }] } }
    };
    write(pkg, 'package.json', { name, version: '37.4.2', type: 'module', exports: './index.js', pulse: { contract: './pulse.package.json' }, pulsewasm: { manifest: './pulsewasm.manifest.cjs' } });
    const metadata = {
      version: 'pulse.package-contract.v1', kind: 'pulse.package-contract', contractId, npmPackage: name,
      description: 'An independently released request-header helper.',
      authoring: { namespace: 'headers', import: name, symbols: ['readHeader'] },
      ownership: { profileFragment: 'external-headers', helperImports: [], reExportImports: [] },
      composition: { status: 'reserved', helperSymbol: 'headers', profileToken: 'opaque-direct-use', reasonCode: 'PULSE_PACKAGE_COMPOSITION_HELPER_NOT_REALIZED' },
      targets: { native: { status: 'supported', realization: 'canonical-package-lowering', lowerableSubpath: name, providerRequirements: ['headers'] },
        javascript: { status: 'supported', realization: 'javascript-package-runtime', entry: './index.js', providerRequirements: [] } },
      lowering: { manifest: './pulsewasm.manifest.cjs', trust: 'build-dependency', canonicalOperationVersion: 'pulse.canonical-package-operation.v1', bundleVersion: 'pulse.package-lowering-bundle.v1', providerRequirementVersion: 'pulse.provider-requirement-record.v1' },
      conformance: { status: 'target-overlap', fixtureRoots: ['./conformance'], semanticCases: ['headers.readHeader'] },
      docs: { readme: './README.md', contract: './pulse.package.json' }
    };
    write(pkg, 'pulse.package.json', metadata);
    const saveManifest = value => write(pkg, 'pulsewasm.manifest.cjs', `module.exports = ${JSON.stringify(value)};`);
    saveManifest(external);
    write(pkg, 'pulsewasm.compiler.cjs', `exports.buildHeaders = input => {
      const ts = input.typescript || require('typescript');
      const source = input.sourceFile;
      const intrinsics = [];
      function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'readHeader') {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          intrinsics.push({ version: 'pulse.package-intrinsic.v1', contractId: '${contractId}', package: '${name}', import: '${name}',
            kind: 'headers.readHeader', operation: 'readHeader', intrinsic: 'request.header', compilerName: '__external_header',
            valueKind: 'string-or-undefined', argumentIndexes: [], staticArguments: ['x-fixture'],
            range: { start: node.getStart(source), end: node.getEnd() }, loc: { file: source.fileName, line: position.line + 1, column: position.character + 1 } });
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      return { artifact: { version: 'external.headers-plan.v1', contractId: '${contractId}', package: '${name}', lowerableSubpath: '${name}', status: 'ok' }, canonicalIntrinsics: intrinsics, diagnostics: [], hasErrors: false };
    };`);
    write(pkg, 'as/headers.as.ts', '// request.header is realized by the canonical compiler\n');
    write(pkg, 'README.md', 'External contract fixture.'); fs.mkdirSync(path.join(pkg, 'conformance'));
    write(pkg, 'index.js', "export function readHeader(req) { return req.header('x-fixture'); }");
    write(root, 'src/index.ts', `import { Pulse } from '@pulse-compute/pulse'; import { readHeader } from '${name}';
const app = new Pulse({ auto: true }); app.get('/', async ctx => { const result = readHeader(ctx.req); return ctx.text(result ?? 'missing'); }); export default app;`);
    write(root, '.pulse/config.ts', `import { defineConfig } from '@pulse-compute/pulse'; export default defineConfig((_scope) => ({ pulse: { entry: 'src/index.ts', defaultProfile: 'native' }, native: { host: 'node', target: 'native' }, javascript: { host: 'node', target: 'javascript' } }));`);
    const toolchain = acceptanceToolchain();
    const options = { cwd: root, workspaceRoot: repo, packageDirs: [pkg] };
    const catalog = discoverPackageContractCatalog(options);
    assert.equal(catalog.contracts[0].compilerTrust, 'build-dependency');
    assert.equal(catalog.productCatalog.contracts[0].packageVersion, '37.4.2');
    assert.equal(catalog.contracts[0].targetSupport.native, true);
    const project = toolchain.resolveProject({ cwd: root });
    const compiled = toolchain.compileNativeProjectInMemory(project);
    const expected = 'external';
    const result = await toolchain.executeCanonicalNativeModule(compiled.native, toolchain.driver.executionOptions(project.providerConfig, { request: { method: 'GET', path: '/', url: 'https://fixture.test/', headers: [['x-fixture', expected]] } }));
    assert.equal(result.response.body, expected, 'unregistered external builder produces executable Native Wasm');
    const jsProject = toolchain.resolveProject({ cwd: root, profile: 'javascript' });
    const js = toolchain.prepareJavascriptApplication(jsProject);
    const response = await toolchain.executeNodeJavascriptApplication(js.loaded.application, new Request('https://fixture.test/', { headers: { 'x-fixture': expected } }));
    assert.equal(await response.text(), expected, 'external Native lowering agrees with package JavaScript');
    const record = discoverLowerableLibraryManifests(options)[0];
    for (const [field, value] of [['version', 'pulsewasm.lowerable-compiler-builder.v99'], ['trust', 'untrusted'], ['builderOwner', '@other/owner']]) {
      const invalid = { ...external, compiler: { ...external.compiler, [field]: value } };
      saveManifest(invalid);
      assert.throws(() => discoverPackageContractCatalog(options), /must|owner/i);
      assert.throws(() => loadLowerableCompilerBuilder({ ...record, manifest: invalid }), /must|owner/i, 'direct loader cannot bypass validation');
    }
    saveManifest({ ...external, npmPackage: '@other/owner' });
    assert.throws(() => discoverPackageContractCatalog(options), /identity/);
    saveManifest({ ...external, version: 'pulsewasm.lowerable-library-manifest.v99' });
    assert.throws(() => discoverPackageContractCatalog(options), /must use/);
    saveManifest({ ...external, lowerableSubpath: '@other/owner' });
    assert.throws(() => discoverPackageContractCatalog(options), /must belong/);
    saveManifest(external);
    const linked = path.join(root, 'linked-package'); fs.symlinkSync(pkg, linked, 'dir');
    assert.equal(discoverPackageContractCatalog({ ...options, packageDirs: [linked] }).contracts[0].packageName, name, 'package-root links are supported');
    write(root, 'outside.cjs', 'throw new Error("escaped builder executed");');
    const escaped = { ...external, compiler: { ...external.compiler, entry: '../../../outside.cjs' } };
    assert.throws(() => loadLowerableCompilerBuilder({ ...record, manifest: escaped }), /package-relative/);
    fs.symlinkSync(path.join(root, 'outside.cjs'), path.join(pkg, 'escape.cjs'));
    assert.throws(() => loadLowerableCompilerBuilder({ ...record, manifest: { ...external, compiler: { ...external.compiler, entry: './escape.cjs' } } }), /inside its package/);
    const duplicate = path.join(root, 'duplicate'); fs.cpSync(pkg, duplicate, { recursive: true });
    assert.throws(() => discoverPackageContractCatalog({ ...options, packageDirs: [pkg, duplicate] }), /Duplicate/);
    // Unrelated installed declarations are not evaluated by graph compilation.
    write(root, 'node_modules/@unused/lowerer/package.json', { name: '@unused/lowerer', pulsewasm: { manifest: './pulsewasm.manifest.cjs' } });
    write(root, 'node_modules/@unused/lowerer/pulsewasm.manifest.cjs', 'throw new Error("unreachable lowerer executed");');
    assert.doesNotThrow(() => buildReachableProjectGraph(path.join(root, 'src/index.ts'), { rootDir: root, workspaceRoot: repo }));
    // Resolve a lowerer nested under an ordinary source dependency.
    const wrapper = path.join(root, 'node_modules/@external-fixture/wrapper');
    write(wrapper, 'package.json', { name: '@external-fixture/wrapper', version: '2.0.0', type: 'module', exports: './index.ts' });
    write(wrapper, 'index.ts', `import {readHeader} from '${name}'; export async function handler(ctx) { const result = readHeader(ctx.req); return ctx.text(result ?? 'missing'); }`);
    const nested = path.join(wrapper, 'node_modules', name); fs.mkdirSync(path.dirname(nested), { recursive: true }); fs.renameSync(pkg, nested);
    write(root, 'src/index.ts', `import {Pulse} from '@pulse-compute/pulse'; import {handler} from '@external-fixture/wrapper'; const app = new Pulse({auto:true}); app.get('/',handler); export default app;`);
    const nestedCompiled = toolchain.compileProject(toolchain.resolveProject({ cwd: root }));
    assert.ok(nestedCompiled.ok, 'nested external lowerer resolves from its importing dependency');
    console.log('ok - external trusted lowerer: independent version, Native/JavaScript parity, nested resolution, protocol/ownership/path/collision rejection');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stack || error); console.error(JSON.stringify({ detail: error.detail, diagnostics: error.diagnostics })); process.exitCode = 1; });
