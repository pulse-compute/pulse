'use strict';
// Runs outside the repository. Only the Fastly ABI model is borrowed from the
// checkout; compiler, runtime, author facade and realizations are installed bytes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { hash } = require('./bundle.cjs');
const { write, bearer, profiles } = require('./fixture.cjs');
const root = fs.realpathSync(process.cwd()), output = path.resolve(process.argv[2]);
const workspace = fs.realpathSync(process.argv[3]);
const installed = createRequire(path.join(root, 'package.json'));
function load(name) {
  assert(fs.realpathSync(installed.resolve(name)).startsWith(path.join(root, 'node_modules') + path.sep), 'Workspace product import');
  return installed(name);
}
const { resolveProject } = load('@pulse-compute/cli/project-config');
const execution = load('@pulse-compute/cli/project-execution');
const { executeCanonicalNativeModule } = load('@pulse-compute/wasm-host-runtime/runtime/canonical-native-host');
const { executeNodeJavascriptApplication } = load('@pulse-compute/provider-node/javascript/runtime-host');
const { executeFastlyJavascriptApplication } = load('@pulse-compute/provider-fastly/javascript/runtime-host');
const driver = load('@pulse-compute/provider-node/toolchain').createDriver();
const fixturePath = path.join(workspace, 'packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const { executeFastlyNativePlatformCapabilities } = require(fixturePath);
const corpus = require('./mac-text-v1.json');
const expand = value => value && typeof value === 'object' && value.repeat !== undefined ? value.repeat.repeat(value.count) + (value.suffix || '') : value;
const key = value => value?.bytes !== undefined ? new Uint8Array(value.count).fill(value.bytes) : expand(value);

async function main() {
  write(root);
  const ts = load('typescript');
  const program = ts.createProgram([path.join(root, 'app.ts')], { noEmit: true, strict: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: n => n, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  const projects = Object.fromEntries(profiles.map(profile => [profile, resolveProject({ cwd: root, profile })]));
  const node = execution.compileNativeProjectInMemory(projects['node-native']);
  const built = execution.buildProject(projects['fastly-native']);
  assert.equal(built.status, 'built');
  const wasm = fs.readFileSync(path.join(built.outDir, 'bin/main.wasm'));
  assert(WebAssembly.Module.imports(new WebAssembly.Module(wasm)).some(i => i.module === 'fastly_secret_store'));
  const js = execution.prepareJavascriptApplication(projects['node-javascript']);
  const rows = corpus.vectors.map(row => ({ ...row, expected: 'valid' }));
  const excluded = [];
  for (const c of corpus.cases) {
    // Dynamic algorithm, injected failure and malformed provider string cases
    // belong to MAC-01/02. Fetch rejects a newline in an HTTP header itself.
    if (c.overrides?.algorithm || c.overrides?.state || ['malformed-secret', 'tag-newline'].includes(c.id)) { excluded.push(c.id); continue; }
    const row = { ...corpus.vectors.find(v => v.id === c.vector), ...c.overrides, id: c.id, expected: c.expected };
    if (c.flipTagByte !== undefined) { const tag = Buffer.from(row.tag, 'hex'); tag[c.flipTagByte] ^= 1; row.tag = tag.toString('hex'); }
    rows.push(row);
  }
  const cases = [];
  for (const row of rows) for (const mode of profiles) {
    const value = key(row.secret), message = expand(row.message);
    const headers = [['authorization', bearer], ['x-request-proof', row.tag]];
    const request = { method: 'POST', path: '/', url: 'https://mac03.test/', headers, body: JSON.stringify({ message }) };
    let response, trace;
    if (mode === 'node-native') {
      ({ response, trace } = await executeCanonicalNativeModule(node.native, driver.executionOptions(projects[mode].providerConfig, { request, secrets: value === null ? {} : { REQUEST_PROOF_KEY: value }, strict: false, maxRequestBodyBytes: 1048576, maxStructuredBodyBytes: 1048576 })));
    } else if (mode === 'fastly-native') {
      const result = executeFastlyNativePlatformCapabilities({ wasm }, { request, secrets: value === null ? {} : { REQUEST_PROOF_KEY: value }, secretStore: 'app_secrets' });
      ({ response, trace } = result);
      const e = result.instance.exports;
      assert(new Uint8Array(e.memory.buffer, e.pulse_crypto_bytes_frame_v1(), 73760).every(b => b === 0), 'Owned frame was not wiped');
    } else {
      trace = [];
      const execute = mode === 'node-javascript' ? executeNodeJavascriptApplication : executeFastlyJavascriptApplication;
      const r = await execute(js.loaded.application, new Request(request.url, { method: 'POST', headers, body: request.body }), { strict: false, maxRequestBodyBytes: 1048576, maxStructuredBodyBytes: 1048576,
        capabilities: { secret: () => value === null ? undefined : value }, bindings: { secretStore: 'app_secrets' }, apis: { SecretStore: class { async get() { return value === null ? null : { plaintext: () => value }; } } }, onEffectObservation: event => trace.push(event) });
      response = { status: r.status, body: await r.text() };
    }
    assert.equal(response.status, 200, `${mode}: ${row.id}`);
    assert.deepEqual(JSON.parse(response.body), { status: row.expected, authorizationPreserved: true, existingBearer: true }, `${mode}: ${row.id}`);
    const observed = JSON.stringify(trace);
    assert(!observed.includes(row.tag), 'Tag in default trace');
    if (typeof value === 'string' && value.length >= 32) assert(!observed.includes(value), 'Key in default trace');
    cases.push({ id: row.id, target: mode, status: 'passed', outcome: row.expected });
  }
  // The same emitted artifact exercises static missing/invalid bindings that
  // the hosted runner will use, without recompilation for each secret state.
  for (const route of ['/missing', '/short', '/long']) {
    const r = executeFastlyNativePlatformCapabilities({ wasm }, { request: { method: 'POST', path: route, headers: [['authorization', bearer], ['x-request-proof', corpus.vectors[1].tag]], body: JSON.stringify({ message: corpus.vectors[1].message }) }, secrets: { MAC03_SHORT_KEY: '*'.repeat(31), MAC03_LONG_KEY: '*'.repeat(4097) }, secretStore: 'app_secrets' });
    assert.equal(r.response.status, 200);
    assert.deepEqual(JSON.parse(r.response.body), { status: 'invalid-key', authorizationPreserved: true, existingBearer: true });
  }
  const allowed = new Set([fixturePath, path.join(workspace, 'packages/provider-fastly/src/testing/native-dynamic-backends-host.js')]);
  for (const file of Object.keys(require.cache)) if (file.startsWith(workspace + path.sep)) assert(allowed.has(file), `Workspace import: ${file}`);
  fs.cpSync(built.outDir, path.join(output, 'build'), { recursive: true });
  fs.copyFileSync(path.join(root, 'app.ts'), path.join(output, 'app.ts'));
  fs.copyFileSync(path.join(root, '.pulse/config.ts'), path.join(output, 'config.ts'));
  const artifacts = [];
  function visit(dir, prefix) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = `${prefix}/${entry.name}`; if (entry.isDirectory()) visit(path.join(dir, entry.name), file); else artifacts.push({ file, sha256: hash(fs.readFileSync(path.join(dir, entry.name))) }); } }
  visit(path.join(output, 'build'), 'build');
  for (const file of ['app.ts', 'config.ts']) artifacts.push({ file, sha256: hash(fs.readFileSync(path.join(output, file))) });
  fs.writeFileSync(path.join(output, 'worker.json'), JSON.stringify({ status: 'passed', cases, excluded, bindingControls: 3, publicTypes: true, artifacts, fastlyEvidence: 'compiled-wasm-injected-host', hostedQualified: false }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', executions: cases.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
