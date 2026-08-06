#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const exampleRoot = path.join(repoRoot, 'examples/10-entities-tools');
const reportRoot = path.join(repoRoot, 'wasm/.test-results/entities-i10');
const compilerRoot = path.join(repoRoot, 'wasm/packages/compiler');
process.chdir(repoRoot);

const { resolveProject } = require('../../packages/cli/src/project-config.js');
const {
  compileProject,
  prepareJavascriptApplication
} = require('../../packages/cli/src/project-execution.js');
const { getProviderDriver } = require('../../packages/cli/src/provider-drivers.js');
const { writeCanonicalBuild } = require('../../packages/compiler/src/canonical-api-compiler.js');
const { createCanonicalSchemaCodecs } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs.js');
const graphApi = require('../../packages/compiler/src/project/reachable-graph-builder.js');
const managed = require('../../packages/compiler/src/spine/handler-ir-managed.js');
const entitiesLowerer = require('../../../packages/entities/pulsewasm.compiler.cjs');
const entitiesNative = require('../../../packages/entities/pulsewasm.native.cjs');
const {
  TOOLS_FACADE_POLICY,
  createToolsFacade
} = require('../../../examples/10-entities-tools/tools-facade.cjs');

const assemblyScriptRoot = path.dirname(require.resolve('assemblyscript/package.json', { paths: [compilerRoot] }));
const asc = path.join(assemblyScriptRoot, 'bin/asc.js');
const jsonAsTransform = require.resolve('json-as', { paths: [compilerRoot] });
const jsonAsRoot = path.resolve(jsonAsTransform, '..', '..', '..');
const jsonAsDependencyRoot = path.dirname(jsonAsRoot);
const reportVersion = 'pulse.entities-tools-orchestration.i10.v1';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function descriptorFromEntry(entry) {
  const start = entry.loc && entry.loc.start || { line: 1, column: 1 };
  return Object.freeze({
    version: managed.MANAGED_HANDLER_DESCRIPTOR_VERSION,
    id: `${entry.router}:${entry.discriminator}`,
    role: managed.MANAGED_HANDLER_ROLE,
    origin: Object.freeze({ file: entry.loc.file, line: start.line, column: start.column }),
    source: Object.freeze({
      file: entry.handler.file,
      exportName: entry.handler.exportName,
      localName: entry.handler.localName
    }),
    input: Object.freeze({
      kind: entry.inputSchema === null ? 'empty-value' : 'schema-value',
      schemaId: entry.inputSchema
    }),
    result: Object.freeze({
      kind: entry.outputSchema === null ? 'completion' : 'schema-value',
      schemaId: entry.outputSchema
    })
  });
}

function compileModel(compiled, project) {
  const graphBuild = graphApi.buildReachableProjectGraph(project.entryFile, {
    rootDir: exampleRoot,
    workspaceRoot: repoRoot,
    configFile: project.configFile
  });
  const lowered = entitiesLowerer.createEntitiesPackageCompilerBuilder({
    cwd: exampleRoot,
    sourcePath: project.entryFile,
    sourceText: fs.readFileSync(project.entryFile, 'utf8'),
    schemaBundle: compiled.schema.bundle
  });
  assert.equal(lowered.hasErrors, false, lowered.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join('\n'));
  const descriptors = lowered.entries.map(descriptorFromEntry);
  const managedBundle = managed.compileManagedHandlerDescriptors({ graphBuild, descriptors });
  const nativeBundle = managed.compileManagedHandlerNativeBundle(managedBundle);
  const nativeSource = entitiesNative.buildEntitiesNativeSource({
    plan: lowered.artifact.plan,
    managedHandlerNativeBundle: nativeBundle,
    schemaBundle: compiled.schema.bundle
  });
  return Object.freeze({ lowered, managedBundle, nativeBundle, nativeSource });
}

function compileNative(source, root, label) {
  fs.mkdirSync(root, { recursive: true });
  const input = path.join(root, 'entities-tools.as.ts');
  const output = path.join(root, `${label}.wasm`);
  fs.writeFileSync(input, source, 'utf8');
  const result = spawnSync(process.execPath, [
    asc,
    path.basename(input),
    '--outFile', output,
    '--runtime', 'incremental',
    '--exportRuntime',
    '--exportTable',
    '--noAssert',
    '-O3',
    '--transform', jsonAsTransform,
    '--path', jsonAsDependencyRoot,
    '--path', path.join(compilerRoot, 'node_modules')
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0' },
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return fs.readFileSync(output);
}

async function runJavascript(compiled, project, catalog) {
  const entitiesRuntime = await import(pathToFileURL(path.join(repoRoot, 'packages/entities/dist/index.js')).href);
  const prepared = prepareJavascriptApplication(project, {
    schemaBundle: compiled.schema.bundle,
    allowedPackages: { '@pulse-compute/entities': entitiesRuntime }
  });
  assert.equal(prepared.plan.loadable, true);
  assert.ok(prepared.loaded && prepared.loaded.application);
  const javascript = getProviderDriver('node', { projectRoot: exampleRoot }).javascript;
  const schemaCodecs = createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
  const envelopes = [];
  const executions = [];
  const fetches = [];
  const facade = createToolsFacade({
    catalog,
    async invoke(request) {
      envelopes.push(JSON.parse(request.body));
      const execution = await javascript.executeTestCase(prepared.loaded.application, {
        name: `tools-facade-${envelopes.length}`,
        request: {
          method: request.method,
          path: '/',
          headers: request.headers,
          body: request.body
        }
      }, {
        schemaCodecs,
        strict: true,
        provider: 'node',
        reporting: project.reporting,
        networkFetch: false,
        async fetchImplementation(requestUrl) {
          const value = String(requestUrl);
          fetches.push(value);
          assert.equal(value, 'https://directory.example.test/customers/ada@example.test');
          return new Response('Ada Lovelace', {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' }
          });
        }
      });
      executions.push(execution);
      return execution.response;
    }
  });

  const discovery = facade.listTools();
  assert.deepEqual(discovery, {
    version: 'pulse.entities-tools-catalog-demo.v1',
    tools: [
      {
        name: 'customer.lookup',
        title: 'Look up customer',
        description: 'Looks up one customer through the configured directory backend.',
        inputSchemaId: 'tools.CustomerLookupInput',
        outputSchemaId: 'tools.CustomerLookupOutput',
        annotations: { readOnlyHint: true }
      },
      {
        name: 'system.status',
        title: 'Check system status',
        description: 'Checks that the governed entity request boundary is available.',
        inputSchemaId: null,
        outputSchemaId: null,
        annotations: { readOnlyHint: true }
      }
    ]
  });
  assert.equal(Object.isFrozen(discovery), true);
  assert.equal(Object.isFrozen(discovery.tools), true);

  const status = await facade.callTool('system.status', undefined, { id: 'status-1' });
  const customer = await facade.callTool('customer.lookup', {
    email: 'ada@example.test'
  }, { id: 'lookup-1' });
  assert.equal(status, null);
  assert.deepEqual(customer, { email: 'ada@example.test', displayName: 'Ada Lovelace' });
  assert.deepEqual(envelopes, [
    { jsonrpc: '2.0', method: 'system.status', id: 'status-1' },
    {
      jsonrpc: '2.0',
      method: 'customer.lookup',
      params: { email: 'ada@example.test' },
      id: 'lookup-1'
    }
  ]);
  assert.deepEqual(executions.map((entry) => entry.effectCount), [1, 2]);
  assert.deepEqual(fetches, ['https://directory.example.test/customers/ada@example.test']);

  const callsBeforeRejection = envelopes.length;
  await assert.rejects(() => facade.callTool('unknown.tool', undefined), RangeError);
  await assert.rejects(() => facade.callTool('customer.lookup', undefined), TypeError);
  assert.equal(envelopes.length, callsBeforeRejection);

  return Object.freeze({
    discovery,
    envelopes: Object.freeze(envelopes),
    effects: executions.reduce((total, entry) => total + entry.effectCount, 0),
    fetches: Object.freeze(fetches)
  });
}

async function main() {
  assert.deepEqual(TOOLS_FACADE_POLICY, {
    completeMcpServer: false,
    discovery: 'static-entity-catalog',
    invocation: 'json-rpc-2.0-request-boundary',
    governedExecution: 'pulse-entity-handler',
    excluded: [
      'sse',
      'sessions',
      'tasks',
      'resources',
      'prompts',
      'sampling',
      'authorization',
      'transport-negotiation',
      'runtime-core-protocol-state'
    ]
  });
  const facadeSource = fs.readFileSync(path.join(exampleRoot, 'tools-facade.cjs'), 'utf8');
  assert.doesNotMatch(facadeSource, /@pulse-compute\//);
  assert.doesNotMatch(facadeSource, /\b(?:createServer|listen)\s*\(/);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-entities-i10-'));
  try {
    const project = resolveProject({ cwd: exampleRoot, profile: 'node-javascript' });
    const compiled = compileProject(project);
    assert.equal(compiled.packageApplication.realization, 'provider-dependent');
    const build = writeCanonicalBuild(compiled, path.join(tempRoot, 'catalog-build'));
    const catalogArtifact = build.packageInspectionArtifacts.find((entry) => entry.id === 'pulse.entities-catalog.v1');
    assert.ok(catalogArtifact);
    assert.equal(path.basename(catalogArtifact.file), 'entities-catalog.json');
    const catalogBytes = fs.readFileSync(catalogArtifact.file);
    const catalog = JSON.parse(catalogBytes.toString('utf8'));
    assert.equal(catalog.version, 'pulse.entities-catalog.v1');
    assert.equal(catalog.routers.length, 1);
    assert.deepEqual(catalog.routers[0].entities.map((entry) => entry.name), ['customer.lookup', 'system.status']);
    assert.ok(catalog.routers[0].entities.every((entry) => Object.values(entry.eligibility).every(Boolean)));

    const javascript = await runJavascript(compiled, project, catalog);
    const nativeProject = resolveProject({ cwd: exampleRoot, profile: 'node-native' });
    const nativeCompiled = compileProject(nativeProject);
    const model = compileModel(nativeCompiled, nativeProject);
    assert.equal(model.nativeSource.summary.routes, 2);
    assert.equal(model.nativeSource.summary.schemas, 2);
    assert.equal(model.nativeSource.summary.effects, 1);
    assert.equal(model.nativeSource.sourceSha256, sha256(model.nativeSource.source));
    const firstWasm = compileNative(model.nativeSource.source, path.join(tempRoot, 'native-a'), 'entities-tools');
    const secondWasm = compileNative(model.nativeSource.source, path.join(tempRoot, 'native-b'), 'entities-tools');
    assert.deepEqual(secondWasm, firstWasm, 'I10 Native artifact must reproduce exactly');
    const nativeModule = new WebAssembly.Module(firstWasm);
    const imports = WebAssembly.Module.imports(nativeModule).map((entry) => `${entry.module}:${entry.name}`).sort();
    const exports = WebAssembly.Module.exports(nativeModule).map((entry) => entry.name).sort();
    assert.equal(imports.some((entry) => /javascript|js-compute|asyncify/i.test(entry)), false);
    for (const required of [
      'pulse_entities_set_request',
      'pulse_entities_start',
      'pulse_entities_resume',
      'pulse_entities_response_status'
    ]) assert.ok(exports.includes(required), `missing Native export ${required}`);

    const report = Object.freeze({
      version: reportVersion,
      status: 'passed',
      scope: Object.freeze({
        completeMcpServer: false,
        excluded: TOOLS_FACADE_POLICY.excluded
      }),
      catalog: Object.freeze({
        version: catalog.version,
        sha256: sha256(catalogBytes),
        tools: javascript.discovery.tools.map((tool) => Object.freeze({
          name: tool.name,
          inputSchemaId: tool.inputSchemaId,
          outputSchemaId: tool.outputSchemaId
        }))
      }),
      invocation: Object.freeze({
        protocol: 'json-rpc-2.0',
        calls: javascript.envelopes.length,
        governedEffects: javascript.effects,
        backendFetches: javascript.fetches.length
      }),
      native: Object.freeze({
        kind: 'package-owned-native-wasm',
        sourceSha256: model.nativeSource.sourceSha256,
        wasmSha256: sha256(firstWasm),
        bytes: firstWasm.byteLength,
        imports: Object.freeze(imports),
        routes: model.nativeSource.summary.routes,
        schemas: model.nativeSource.summary.schemas,
        effects: model.nativeSource.summary.effects,
        reproducible: true,
        automaticFallback: false
      })
    });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    fs.mkdirSync(reportRoot, { recursive: true });
    const reportFile = path.join(reportRoot, 'entities-tools-orchestration.json');
    fs.writeFileSync(reportFile, serialized);
    process.stdout.write(`${JSON.stringify({
      status: report.status,
      tools: report.catalog.tools.length,
      calls: report.invocation.calls,
      governedEffects: report.invocation.governedEffects,
      nativeBytes: report.native.bytes,
      report: path.relative(repoRoot, reportFile).replace(/\\/g, '/'),
      reportSha256: sha256(serialized)
    }, null, 2)}\n`);
    process.stdout.write('ok - I10 projects static catalog metadata through an external tools facade, invokes governed JSON-RPC entities, and inspects reproducible package-owned Native Wasm without protocol state or fallback\n');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
