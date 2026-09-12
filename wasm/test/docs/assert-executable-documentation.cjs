#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { synchronizeDocSnippets, markdownFiles } = require('../../scripts/sync-doc-snippets.cjs');
const { resolveProject } = require('../../packages/cli/src/project-config.js');

const wasmRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(wasmRoot, '..');
const pulseCli = path.join(wasmRoot, 'scripts', 'pulse.cjs');
const BUILD_DIR = '.pulse-docs-build';
const OPTIMIZED_BUILD_DIR = '.pulse-docs-build-size';

const examples = Object.freeze([
  Object.freeze({
    id: '01-hello-json',
    provider: 'node',
    guestWasmBytes: 2212,
    optimizedGuestWasmBytes: 2058,
    capabilities: ['response.json', 'response.text']
  }),
  Object.freeze({
    id: '02-request-schema',
    provider: 'node',
    guestWasmBytes: 39795,
    optimizedGuestWasmBytes: 31578,
    capabilities: ['request.json', 'response.json'],
    schemas: ['app.CreateUserInput', 'app.CreateUserOutput']
  }),
  Object.freeze({
    id: '03-fetch-composition',
    provider: 'node',
    guestWasmBytes: 5117,
    optimizedGuestWasmBytes: 4349,
    capabilities: ['fetch', 'response.json'],
    grouped: true
  }),
  Object.freeze({
    id: '05-fastly-capabilities',
    provider: 'fastly',
    guestWasmBytes: 5454,
    optimizedGuestWasmBytes: 4888,
    providerWasmBytes: 42806,
    optimizedProviderWasmBytes: 35420,
    capabilities: [
      'config.get',
      'secret.get',
      'fetch',
      'kv.get',
      'kv.put',
      'response.json'
    ],
    packageEffects: ['grip.broadcast']
  }),
  Object.freeze({
    id: '07-opaque-proxy',
    provider: 'fastly',
    guestWasmBytes: 2200,
    optimizedGuestWasmBytes: 2101,
    providerWasmBytes: 30455,
    optimizedProviderWasmBytes: 26287,
    capabilities: ['fetch'],
    opaque: true
  }),
  Object.freeze({
    id: '09-router-lowering',
    provider: 'node',
    guestWasmBytes: 6271,
    optimizedGuestWasmBytes: 5496,
    capabilities: ['fetch', 'response.json', 'response.text'],
    routes: 7
  }),
  Object.freeze({
    id: '10-entities-tools',
    provider: 'node',
    target: 'javascript',
    noApplicationWasm: true,
    candidateWorkflow: 'entities-orchestration-demo',
    capabilities: ['schema.decode', 'schema.encode'],
    schemas: ['tools.CustomerLookupInput', 'tools.CustomerLookupOutput'],
    entities: ['customer.lookup', 'system.status']
  }),
  Object.freeze({
    id: '11-events',
    provider: 'node',
    guestWasmBytes: 39358,
    optimizedGuestWasmBytes: 31313,
    capabilities: ['event.emit', 'logging', 'response.text'],
    schemas: ['events.DeviceReading', 'events.DeviceReadingAccepted'],
    events: Object.freeze({
      registrations: Object.freeze([
        Object.freeze(['device.reading', 'events.DeviceReading']),
        Object.freeze(['system.tick', null])
      ]),
      callsites: Object.freeze([
        Object.freeze(['device.reading.accepted', 'events.DeviceReadingAccepted']),
        Object.freeze(['system.heartbeat', null])
      ])
    })
  }),
  Object.freeze({
    id: '12-mcp-proxy',
    provider: 'node',
    guestWasmBytes: 2589,
    optimizedGuestWasmBytes: 2418,
    capabilities: ['fetch', 'request.text'],
    opaque: true
  }),
  Object.freeze({
    id: '13-jwt-es256',
    provider: 'node',
    guestWasmBytes: 23647,
    optimizedGuestWasmBytes: 23461,
    applicationInputBytes: 2759,
    optimizedApplicationInputBytes: 2577,
    linkedGuestInputBytes: 21009,
    optimizedLinkedGuestInputBytes: 21009,
    capabilities: ['jwt.verify', 'response.text'],
    crypto: Object.freeze({
      algorithm: 'ES256',
      realization: 'guest-linked:pulse-es256-rustcrypto-p256'
    })
  })
]);

const cleanupPaths = new Set();

function parseArgs(argv) {
  const out = { section: 'all', example: null, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--section') { out.section = argv[++i]; continue; }
    if (token.startsWith('--section=')) { out.section = token.slice(10); continue; }
    if (token === '--example') { out.example = argv[++i]; continue; }
    if (token.startsWith('--example=')) { out.example = token.slice(10); continue; }
    if (token === '--list') { out.list = true; continue; }
    if (token === '--help' || token === '-h') { out.help = true; continue; }
    throw new Error(`unknown executable-documentation option: ${token}`);
  }
  if (!['all', 'contracts', 'init-dev'].includes(out.section)) throw new Error(`unknown executable-documentation section: ${out.section}`);
  if (out.example && out.section !== 'all') throw new Error('--example cannot be combined with --section');
  if (out.example && !examples.some((entry) => entry.id === out.example)) throw new Error(`unknown documentation example: ${out.example}`);
  return Object.freeze(out);
}

function usage() {
  return [
    'Usage: node assert-executable-documentation.cjs [--section contracts|init-dev] [--example <id>]',
    '',
    'No selection runs the complete executable-documentation proof.',
    `Examples: ${examples.map((entry) => entry.id).join(', ')}`
  ].join('\n');
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function normalizeText(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
}

function assertExampleFormatting() {
  const examplesRoot = path.join(repoRoot, 'examples');
  const extensions = new Set(['.ts', '.js', '.cjs', '.json']);
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules'
          || entry.name === 'dist'
          || entry.name.startsWith('.pulse-')
          || (entry.name === 'guests' && path.basename(directory) === '.pulse')
        ) {
          continue;
        }
        visit(file);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        files.push(file);
      }
    }
  }

  visit(examplesRoot);
  for (const file of files) {
    const relativeFile = slash(path.relative(repoRoot, file));
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      assert.ok(
        lines[index].length <= 100,
        `${relativeFile}:${index + 1} exceeds the 100-column example limit`
      );
    }
  }
}

function shellDisplay(args) {
  return `pulse ${args.map((arg) => (/^[A-Za-z0-9_./:@=-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' ')}`;
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...(options.env || {}) },
    encoding: 'utf8',
    timeout: options.timeoutMs || 300000,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  assert.equal(result.status, options.expectedStatus ?? 0, [
    `command failed: ${process.execPath} ${args.join(' ')}`,
    `status: ${result.status}`,
    `stdout:\n${result.stdout || ''}`,
    `stderr:\n${result.stderr || ''}`
  ].join('\n'));
  return result;
}

function runPulse(command, projectDir, extra = [], timeoutMs = 300000) {
  const args = [pulseCli, command, ...extra, '--json'];
  const result = runNode(args, { cwd: projectDir, timeoutMs });
  let json;
  try { json = JSON.parse(result.stdout); }
  catch (error) { throw new Error(`pulse ${command} did not emit JSON for ${projectDir}: ${error.message}\n${result.stdout}`); }
  return Object.freeze({ json, stdout: result.stdout, stderr: result.stderr });
}

function runJson(args, cwd, options = {}) {
  const result = runNode([pulseCli, ...args], {
    cwd,
    timeoutMs: options.timeoutMs || 300000,
    expectedStatus: options.expectedStatus ?? 0
  });
  const stream = options.stream === 'stderr' ? result.stderr : result.stdout;
  try { return JSON.parse(stream); }
  catch (error) { throw new Error(`pulse ${args.join(' ')} did not emit JSON on ${options.stream || 'stdout'}: ${error.message}
${stream}`); }
}

function assertPartial(actual, expected, location = '$') {
  if (expected === null || typeof expected !== 'object') {
    assert.deepEqual(actual, expected, `${location} mismatch`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${location} must be an array`);
    assert.ok(actual.length >= expected.length, `${location} has ${actual.length} item(s), expected at least ${expected.length}`);
    for (let i = 0; i < expected.length; i += 1) assertPartial(actual[i], expected[i], `${location}[${i}]`);
    return;
  }
  assert.ok(actual && typeof actual === 'object' && !Array.isArray(actual), `${location} must be an object`);
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(Object.prototype.hasOwnProperty.call(actual, key), `${location}.${key} is missing`);
    assertPartial(actual[key], value, `${location}.${key}`);
  }
}

function parseRunBindings() {
  const bindings = [];
  const pattern = /<!--\s*pulse-doc-run\s+(\{[^\n]*\})\s*-->\s*```bash\r?\n([\s\S]*?)\r?\n```\s*```json\r?\n([\s\S]*?)\r?\n```/g;
  for (const file of markdownFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const relativeDoc = slash(path.relative(repoRoot, file));
    for (const match of text.matchAll(pattern)) {
      let config;
      let expected;
      try { config = JSON.parse(match[1]); }
      catch (error) { throw new Error(`invalid pulse-doc-run JSON in ${relativeDoc}: ${error.message}`); }
      try { expected = JSON.parse(match[3]); }
      catch (error) { throw new Error(`invalid documented JSON result in ${relativeDoc}: ${error.message}`); }
      bindings.push(Object.freeze({ relativeDoc, config, commandBlock: normalizeText(match[2]), expected }));
    }
  }
  return bindings;
}

function verifyRunBindings(bindings) {
  assert.ok(bindings.length >= 10, `expected at least 10 executable command/result bindings, found ${bindings.length}`);
  const exampleCoverage = new Set();
  for (const binding of bindings) {
    const { config } = binding;
    console.log(`docs - run ${binding.relativeDoc}: ${config.display || shellDisplay(config.args)}`);
    assert.ok(Array.isArray(config.args) && config.args.length > 0, `pulse-doc-run in ${binding.relativeDoc} must declare args`);
    const display = config.display || shellDisplay(config.args);
    assert.equal(binding.commandBlock, display, `documented command drift in ${binding.relativeDoc}`);

    let cwd = repoRoot;
    let cleanup;
    if (config.project) {
      const projectRoot = path.resolve(repoRoot, config.project);
      assert.ok(projectRoot.startsWith(`${repoRoot}${path.sep}`), `pulse-doc-run project escapes repository: ${config.project}`);
      assert.ok(fs.existsSync(projectRoot), `pulse-doc-run project is missing: ${config.project}`);
      cwd = projectRoot;
      const example = config.project.match(/^examples\/([^/]+)$/)?.[1];
      if (example) exampleCoverage.add(example);
      if (config.args[0] === 'build') {
        const dist = path.join(projectRoot, BUILD_DIR);
        fs.rmSync(dist, { recursive: true, force: true });
        cleanup = () => fs.rmSync(dist, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      }
    } else if (config.temp === true) {
      cwd = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-doc-run-'));
      cleanup = () => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }

    try {
      const value = runJson(config.args, cwd, {
        timeoutMs: config.timeoutMs || 300000,
        expectedStatus: config.expectedStatus ?? 0,
        stream: config.stream || 'stdout'
      });
      assertPartial(value, binding.expected, `${binding.relativeDoc}:${display}`);
    } finally {
      if (cleanup) cleanup();
    }
  }
  const lifecycleExamples = examples.filter((entry) => !entry.candidateWorkflow).map((entry) => entry.id).sort();
  assert.deepEqual([...exampleCoverage].sort(), lifecycleExamples, 'every lifecycle example must have a documented executable command/result pair');
  for (const example of examples.filter((entry) => entry.candidateWorkflow)) {
    const readme = fs.readFileSync(path.join(repoRoot, 'examples', example.id, 'README.md'), 'utf8');
    assert.match(readme, new RegExp(`--task ${example.candidateWorkflow}`), `${example.id} must name its separately executable candidate proof`);
  }
}

function commandLinesFromMarkdown() {
  const out = [];
  for (const file of markdownFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const value = line.trim();
      if (/^pulse\s+(?:init|doctor|inspect|test|dev|compile|build)\b/.test(value)) {
        out.push(Object.freeze({ file: slash(path.relative(repoRoot, file)), value }));
      }
    }
  }
  return out;
}

function assertDocumentedCommands() {
  const help = runNode([pulseCli, '--help'], { timeoutMs: 30000 }).stdout;
  const cliReference = fs.readFileSync(path.join(repoRoot, 'docs', 'reference', 'cli.md'), 'utf8');
  const referenceCommands = [...cliReference.matchAll(/(?:Syntax|Supported signatures):\r?\n\r?\n```text\r?\n([\s\S]*?)\r?\n```/g)]
    .flatMap((match) => match[1].split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  assert.ok(referenceCommands.length >= 7, 'CLI reference must contain the supported usage signatures');
  for (const command of referenceCommands) assert.ok(help.includes(command), `CLI reference usage is stale; help does not contain: ${command}`);

  const knownCommands = new Set(['init', 'doctor', 'inspect', 'test', 'dev', 'compile', 'build']);
  for (const entry of commandLinesFromMarkdown()) {
    const [, command] = /^pulse\s+(\S+)/.exec(entry.value) || [];
    assert.ok(knownCommands.has(command), `unknown documented Pulse command in ${entry.file}: ${entry.value}`);
    for (const flag of entry.value.match(/--[a-z0-9-]+/gi) || []) {
      assert.ok(help.includes(flag), `stale documented flag ${flag} in ${entry.file}: ${entry.value}`);
    }
  }
}

function collectLiteralCalls(source, expression) {
  const values = [];
  const pattern = new RegExp(`${expression}\\(\\s*['\"]([^'\"]+)['\"]`, 'g');
  for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

function assertProjectLinkage(name, inspected) {
  const projectRoot = path.join(repoRoot, 'examples', name);
  const source = fs.readFileSync(path.join(projectRoot, 'src', 'index.ts'), 'utf8');
  const configIds = new Set(inspected.compiler.schemas.registry.schemas.map((entry) => entry.id));
  for (const reference of inspected.compiler.schemas.references) assert.ok(configIds.has(reference.id), `${name} references undeclared schema ${reference.id}`);

  const providerBindings = inspected.compiler.providerLowering.bindings || {};
  const configReads = collectLiteralCalls(source, 'ctx\\.config\\.get');
  const secretReads = collectLiteralCalls(source, 'ctx\\.secret\\.get');
  const kvStores = collectLiteralCalls(source, 'ctx\\.kv(?:<[^>]+>)?');
  if (inspected.project.provider === 'fastly') {
    if (configReads.length) assert.equal(typeof providerBindings.configStore, 'string', `${name} needs a Fastly Config Store binding`);
    if (secretReads.length) assert.equal(typeof providerBindings.secretStore, 'string', `${name} needs a Fastly Secret Store binding`);
    for (const store of kvStores) assert.equal(typeof providerBindings.kv?.[store], 'string', `${name} needs Fastly KV binding ${store}`);
  }

  const inspectText = JSON.stringify(inspected);
  for (const forbidden of ['local-example-secret', 'test-example-secret']) assert.equal(inspectText.includes(forbidden), false, `${name} leaked configured secret ${forbidden}`);
}

function secretValues(project) {
  const values = [];
  for (const value of Object.values(project.dev.secrets || {})) if (typeof value === 'string' && value.length >= 4) values.push(value);
  for (const testCase of project.tests || []) {
    for (const value of Object.values(testCase.secrets || {})) if (typeof value === 'string' && value.length >= 4) values.push(value);
  }
  return [...new Set(values)];
}

function assertSecretsRedacted(outputs, secrets, exampleId) {
  const combined = outputs.map((entry) => `${entry.stdout || ''}\n${entry.stderr || ''}`).join('\n');
  for (const secret of secrets) assert.equal(combined.includes(secret), false, `${exampleId} leaked a configured secret into CLI output`);
}

function inspectWasm(file, exampleId) {
  assert.ok(fs.existsSync(file), `${exampleId} did not produce bin/main.wasm`);
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length > 1024 && bytes.length < 1024 * 1024, `${exampleId} native Fastly Wasm has an unexpected size: ${bytes.length}`);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '0061736d01000000', `${exampleId} produced an invalid Wasm header`);
  assert.equal(WebAssembly.validate(bytes), true, `${exampleId} produced invalid WebAssembly`);
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes));
  assert.ok(imports.some((entry) => entry.module === 'fastly_abi' && entry.name === 'init'), `${exampleId} native Fastly Wasm is missing fastly_abi.init`);
  assert.equal(imports.some((entry) => /pulse_host|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`)), false, `${exampleId} native Fastly Wasm contains a forbidden runtime import`);
  return bytes.length;
}

function inspectGuestWasm(file, exampleId) {
  assert.ok(fs.existsSync(file), `${exampleId} did not produce canonical-native.wasm`);
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.length > 1024 && bytes.length < 1024 * 1024, `${exampleId} application guest Wasm has an unexpected size: ${bytes.length}`);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '0061736d01000000', `${exampleId} produced an invalid guest Wasm header`);
  assert.equal(WebAssembly.validate(bytes), true, `${exampleId} produced invalid guest WebAssembly`);
  return bytes.length;
}

function documentedByteCount(bytes) {
  return `${new Intl.NumberFormat('en-US').format(bytes)} bytes`;
}

function assertExampleReadme(example, project, syncResult) {
  const readme = path.join(project.root, 'README.md');
  const text = fs.readFileSync(readme, 'utf8');
  if (example.candidateWorkflow) {
    assert.match(text, /^pulse inspect$/m, `${example.id} README must document pulse inspect`);
    assert.match(text, new RegExp(`--task ${example.candidateWorkflow}`), `${example.id} README must document its focused candidate workflow`);
  } else {
    for (const command of ['doctor', 'inspect', 'test', 'dev', 'build']) assert.match(text, new RegExp(`^pulse ${command}$`, 'm'), `${example.id} README must document pulse ${command}`);
  }
  assert.match(text, /^## Wasm size$/m, `${example.id} README must document its Wasm size baseline`);
  if (example.noApplicationWasm) {
    assert.ok(text.includes('**no application Wasm artifact**'), `${example.id} README must explicitly document that its default profile emits no application Wasm`);
    assert.ok(text.includes('`--experimental-native-size`'), `${example.id} README must explain why experimental Native size is not applicable`);
  } else {
    assert.ok(text.includes(documentedByteCount(example.guestWasmBytes)), `${example.id} README application guest Wasm size is stale`);
    assert.ok(text.includes(documentedByteCount(example.optimizedGuestWasmBytes)), `${example.id} README optimized application guest Wasm size is stale`);
    assert.ok(text.includes('`--experimental-native-size`'), `${example.id} README must identify the experimental Native-size build`);
    if (example.providerWasmBytes) {
      assert.ok(text.includes(documentedByteCount(example.providerWasmBytes)), `${example.id} README provider Wasm size is stale`);
      assert.ok(text.includes(documentedByteCount(example.optimizedProviderWasmBytes)), `${example.id} README optimized provider Wasm size is stale`);
    }
    if (example.linkedGuestInputBytes) {
      assert.ok(text.includes(documentedByteCount(example.applicationInputBytes)), `${example.id} README application input size is stale`);
      assert.ok(text.includes(documentedByteCount(example.optimizedApplicationInputBytes)), `${example.id} README optimized application input size is stale`);
      assert.ok(text.includes(documentedByteCount(example.linkedGuestInputBytes)), `${example.id} README linked guest input size is stale`);
      assert.ok(text.includes(documentedByteCount(example.optimizedLinkedGuestInputBytes)), `${example.id} README optimized linked guest input size is stale`);
    }
  }
  const relativeReadme = slash(path.relative(repoRoot, readme));
  const source = `examples/${example.id}/src/index.ts`;
  const config = `examples/${example.id}/.pulse/config.ts`;
  const harness = `examples/${example.id}/tests/pulse.harness.ts`;
  assert.ok(syncResult.references.some((entry) => entry.markdown === relativeReadme && entry.source === source), `${example.id} README must derive its handler block from ${source}`);
  assert.ok(syncResult.references.some((entry) => entry.markdown === relativeReadme && entry.source === config), `${example.id} README must derive its config block from ${config}`);
  assert.ok(syncResult.references.some((entry) => entry.markdown === relativeReadme && entry.source === harness), `${example.id} README must derive its harness block from ${harness}`);
}

function verifyOptimizedNativeBuild(example, projectDir, outputs) {
  const buildDir = path.join(projectDir, OPTIMIZED_BUILD_DIR);
  fs.rmSync(buildDir, { recursive: true, force: true });
  cleanupPaths.add(buildDir);
  const build = runPulse(
    'build',
    projectDir,
    ['--out', OPTIMIZED_BUILD_DIR, '--experimental-native-size'],
    360000
  );
  outputs.push(build);
  assert.equal(build.json.status, 'built', `${example.id} optimized pulse build failed`);
  assert.equal(build.json.provider, example.provider, `${example.id} optimized build provider mismatch`);
  assert.equal(path.resolve(build.json.outDir), buildDir, `${example.id} optimized build output mismatch`);

  const manifest = JSON.parse(fs.readFileSync(path.join(buildDir, 'pulse-build.json'), 'utf8'));
  assert.equal(manifest.portable.optimization.version, 'pulse.native-optimization.v1', `${example.id} optimized build policy version mismatch`);
  assert.equal(manifest.portable.optimization.mode, 'experimental-native-size', `${example.id} optimized build mode mismatch`);
  assert.equal(manifest.portable.optimization.experimental, true, `${example.id} optimized build must remain explicitly experimental`);
  assert.deepEqual(manifest.portable.optimization.assemblyScript, {
    optimize: true,
    optimizeLevel: 3,
    shrinkLevel: 2,
    converge: true
  }, `${example.id} optimized AssemblyScript policy mismatch`);

  const guestWasmBytes = inspectGuestWasm(path.join(buildDir, 'canonical-native.wasm'), example.id);
  assert.equal(guestWasmBytes, example.optimizedGuestWasmBytes, `${example.id} documented optimized application guest Wasm size changed`);
  if (example.linkedGuestInputBytes) {
    const report = JSON.parse(fs.readFileSync(path.join(buildDir, 'guest-link-report.json'), 'utf8'));
    assert.equal(report.inputs.primary.bytes, example.optimizedApplicationInputBytes, `${example.id} optimized primary guest-link input changed`);
    assert.equal(report.inputs.guest.bytes, example.optimizedLinkedGuestInputBytes, `${example.id} optimized linked guest input changed`);
    assert.equal(report.finalArtifact.bytes, example.optimizedGuestWasmBytes, `${example.id} optimized linked output size changed`);
  }

  let providerWasmBytes = 0;
  if (example.provider === 'fastly') {
    providerWasmBytes = inspectWasm(path.join(buildDir, 'bin', 'main.wasm'), example.id);
    assert.equal(providerWasmBytes, example.optimizedProviderWasmBytes, `${example.id} documented optimized provider Wasm size changed`);
    assert.equal(manifest.providerTarget.optimization.mode, 'experimental-native-size', `${example.id} provider output lost the optimized build policy`);
  } else {
    assert.equal(fs.existsSync(path.join(buildDir, 'bin', 'main.wasm')), false, `${example.id} optimized Node build must not claim a Fastly provider target`);
  }
  return Object.freeze({ guestWasmBytes, providerWasmBytes });
}

function verifyExampleWorkflow(example, syncResult) {
  console.log(`docs - verify canonical example ${example.id}`);
  const projectDir = path.join(repoRoot, 'examples', example.id);
  const guestCacheDir = path.join(projectDir, '.pulse', 'guests');
  fs.rmSync(guestCacheDir, { recursive: true, force: true });
  cleanupPaths.add(guestCacheDir);
  const project = resolveProject({ cwd: projectDir });
  assert.equal(project.provider, example.provider, `${example.id} provider mismatch`);
  assertExampleReadme(example, project, syncResult);

  if (example.candidateWorkflow) {
    const inspect = runPulse('inspect', projectDir, [], 180000);
    assert.equal(inspect.json.status, 'ok', `${example.id} pulse inspect failed`);
    assert.equal(inspect.json.project.target, example.target, `${example.id} inspect target mismatch`);
    for (const schemaId of example.schemas) assert.ok(inspect.json.project.schemas.ids.includes(schemaId), `${example.id} inspect output is missing schema ${schemaId}`);
    const inspection = inspect.json.compiler.packageInspection;
    assert.equal(inspection.version, 'pulse.canonical-package-inspection.v1');
    const catalog = inspection.artifacts.find((entry) => entry.id === 'pulse.entities-catalog.v1');
    assert.ok(catalog, `${example.id} inspect output is missing the Entities catalog`);
    assert.deepEqual(catalog.data.routers.flatMap((router) => router.entities.map((entity) => entity.name)), example.entities);
    const evidence = runNode([path.join(wasmRoot, 'test/entities/assert-entities-orchestration-demo.cjs')], {
      cwd: repoRoot,
      timeoutMs: 180000
    });
    assert.match(evidence.stdout, /ok - I10 projects static catalog metadata through an external tools facade/);
    return Object.freeze({
      id: example.id,
      provider: example.provider,
      tests: example.entities.length,
      capabilities: inspection.managedHandlers.summary.capabilities,
      schemas: inspect.json.project.schemas.count,
      wasmBytes: 0,
      candidateWorkflow: example.candidateWorkflow
    });
  }

  const buildDir = path.join(projectDir, BUILD_DIR);
  fs.rmSync(buildDir, { recursive: true, force: true });
  cleanupPaths.add(buildDir);
  const outputs = [];

  const doctor = runPulse('doctor', projectDir, [], 180000);
  outputs.push(doctor);
  assert.equal(doctor.json.status, 'passed', `${example.id} pulse doctor failed`);
  assert.equal(doctor.json.summary.failed, 0, `${example.id} pulse doctor reported failed checks`);

  const inspect = runPulse('inspect', projectDir, [], 180000);
  outputs.push(inspect);
  assert.equal(inspect.json.status, 'ok', `${example.id} pulse inspect failed`);
  assert.equal(inspect.json.provider.id, example.provider, `${example.id} inspect provider mismatch`);
  assert.equal(inspect.json.project.target, example.target || 'native', `${example.id} inspect target mismatch`);
  for (const capability of example.capabilities) assert.ok(inspect.json.compiler.capabilities.includes(capability), `${example.id} inspect output is missing capability ${capability}`);
  if (example.crypto) {
    const declaration = inspect.json.project.crypto && inspect.json.project.crypto.declaration;
    const selected = declaration && declaration.algorithms
      && declaration.algorithms.find((entry) => entry.algorithm === example.crypto.algorithm);
    assert.ok(selected, `${example.id} inspect output is missing ${example.crypto.algorithm} crypto selection`);
    assert.equal(selected.realization, example.crypto.realization, `${example.id} crypto realization changed`);
  }
  for (const schemaId of example.schemas || []) assert.ok(inspect.json.project.schemas.ids.includes(schemaId), `${example.id} inspect output is missing schema ${schemaId}`);
  const packageEffectKinds = [
    ...(inspect.json.compiler.packageEffects || []),
    ...(inspect.json.compiler.providerOperations || [])
  ].map((entry) => entry.capability || (entry.kind && entry.operation ? `${entry.kind}.${entry.operation}` : entry.kind || entry.operation));
  for (const effect of example.packageEffects || []) assert.ok(packageEffectKinds.includes(effect), `${example.id} inspect output is missing package effect ${effect}`);
  if (example.opaque) assert.ok(inspect.json.compiler.opaqueReturnCount >= 1, `${example.id} must expose an opaque return in inspect output`);
  if (example.grouped) assert.ok(inspect.json.compiler.groupedContinuationCount >= 1, `${example.id} must expose grouped continuation lowering`);
  if (example.routes) {
    assert.equal(inspect.json.compiler.authoring.kind, 'router', `${example.id} must expose Router authoring`);
    assert.equal(inspect.json.compiler.routing.routes.length, example.routes, `${example.id} route count mismatch`);
    assert.ok(inspect.json.compiler.effects.every((entry) => !entry.routeStableId || inspect.json.compiler.routing.routes.some((route) => route.stableId === entry.routeStableId)), `${example.id} effects must reference known routes`);
  }
  if (example.entities) {
    const inspection = inspect.json.compiler.packageInspection;
    assert.equal(inspection.version, 'pulse.canonical-package-inspection.v1', `${example.id} package inspection version mismatch`);
    const catalog = inspection.artifacts.find((entry) => entry.id === 'pulse.entities-catalog.v1');
    assert.ok(catalog, `${example.id} inspect output is missing the Entities catalog`);
    assert.deepEqual(
      catalog.data.routers.flatMap((router) => router.entities.map((entity) => entity.name)),
      example.entities,
      `${example.id} entity catalog mismatch`
    );
    assert.equal(inspection.summary.declaredHandlers, example.entities.length, `${example.id} declared-handler count mismatch`);
    assert.equal(inspection.summary.handlerEffects, 1, `${example.id} managed-handler effect count mismatch`);
  }
  if (example.events) {
    assert.equal(inspect.json.events.version, 'pulse.event-inspection.v1', `${example.id} event inspection version mismatch`);
    assert.deepEqual(
      inspect.json.events.registrations.map((entry) => [entry.type, entry.schemaId]),
      example.events.registrations,
      `${example.id} event registration catalog mismatch`
    );
    assert.deepEqual(
      inspect.json.events.callsites.map((entry) => [entry.type, entry.schemaId]),
      example.events.callsites,
      `${example.id} event emission catalog mismatch`
    );
    assert.equal(inspect.json.events.targetSupport.status, 'eligible', `${example.id} Node event target must be eligible`);
    assert.equal(inspect.json.events.targetSupport.automaticFallback, false, `${example.id} must not enable event target fallback`);
    assert.equal(inspect.json.events.policy.publicInjectionCommand, false, `${example.id} must not expose event injection`);
    assert.equal(inspect.json.events.policy.automaticLoopback, false, `${example.id} must not enable event loopback`);
  }
  assertProjectLinkage(example.id, inspect.json);

  const test = runPulse('test', projectDir, [], 180000);
  outputs.push(test);
  assert.equal(test.json.status, 'passed', `${example.id} pulse test failed`);
  assert.deepEqual(test.json.summary, { total: project.tests.length, passed: project.tests.length, failed: 0 }, `${example.id} test summary mismatch`);
  assert.deepEqual(test.json.cases.map((entry) => entry.name), project.tests.map((entry) => entry.name), `${example.id} documented test cases did not execute in config order`);
  assert.ok(test.json.cases.every((entry) => entry.status === 'passed'), `${example.id} has a failed documented test case`);
  if (example.events) {
    const eventCases = test.json.cases.filter((entry) => entry.kind === 'event');
    assert.equal(eventCases.length, 2, `${example.id} must execute two event harness cases`);
    assert.ok(eventCases.every((entry) => entry.result.status === 'completed'), `${example.id} event cases must complete`);
    assert.ok(eventCases.every((entry) => entry.emittedFrameCount === 1), `${example.id} event cases must accept one exact outbound frame`);
    assert.ok(eventCases.every((entry) => entry.adapter.automaticLoopback === false), `${example.id} must keep event ingress and emission separate`);
  }

  const build = runPulse('build', projectDir, ['--out', BUILD_DIR], 360000);
  outputs.push(build);
  assert.equal(build.json.status, 'built', `${example.id} pulse build failed`);
  assert.equal(build.json.provider, example.provider, `${example.id} build provider mismatch`);
  assert.equal(path.resolve(build.json.outDir), buildDir, `${example.id} build output mismatch`);
  const requiredBuildFiles = example.target === 'javascript'
    ? [
        'index.cjs',
        'pulse-build.json',
        'pulse-javascript-application-plan.json',
        'pulse-javascript-source-package.json',
        'entities-catalog.json',
        'entities-inspection.json'
      ]
    : ['canonical-handler.cjs', 'canonical-program.json', 'pulse-build.json'];
  if (example.events) requiredBuildFiles.push('event-catalog.json', 'event-inspection.json');
  for (const required of requiredBuildFiles) assert.ok(fs.existsSync(path.join(buildDir, required)), `${example.id} build is missing ${required}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(buildDir, 'pulse-build.json'), 'utf8'));
  assert.equal(manifest.provider, example.provider, `${example.id} pulse-build provider mismatch`);
  assert.equal(manifest.configuredTarget, example.target || 'native', `${example.id} pulse-build target mismatch`);
  if (example.target === 'javascript') {
    assert.equal(manifest.buildMode, 'javascript-source-package', `${example.id} must emit a JavaScript source package`);
    assert.equal(manifest.providerTarget.javascriptRuntime, true, `${example.id} must retain the selected JavaScript runtime`);
    assert.equal(manifest.providerTarget.nativeWasm, false, `${example.id} JavaScript build must not claim Native Wasm`);
    assert.equal(manifest.automaticFallback, false, `${example.id} must not enable target fallback`);
  }
  if (example.events) {
    assert.equal(manifest.events.targetSupport.status, 'eligible', `${example.id} build must retain event target eligibility`);
    assert.deepEqual(manifest.events.files, { catalog: 'event-catalog.json', inspection: 'event-inspection.json' });
  }
  const guestWasmBytes = inspectGuestWasm(path.join(buildDir, 'canonical-native.wasm'), example.id);
  assert.equal(guestWasmBytes, example.guestWasmBytes, `${example.id} documented application guest Wasm size changed`);
  if (example.linkedGuestInputBytes) {
    const report = JSON.parse(fs.readFileSync(path.join(buildDir, 'guest-link-report.json'), 'utf8'));
    assert.equal(report.inputs.primary.bytes, example.applicationInputBytes, `${example.id} primary guest-link input changed`);
    assert.equal(report.inputs.guest.bytes, example.linkedGuestInputBytes, `${example.id} linked guest input changed`);
    assert.equal(report.finalArtifact.bytes, example.guestWasmBytes, `${example.id} linked output size changed`);
  }
  let wasmBytes = 0;
  if (example.provider === 'fastly') {
    wasmBytes = inspectWasm(path.join(buildDir, 'bin', 'main.wasm'), example.id);
    assert.equal(wasmBytes, example.providerWasmBytes, `${example.id} documented provider Wasm size changed`);
    assert.equal(build.json.manifest.providerTarget.compiledWasmPresent, true, `${example.id} did not report compiled Wasm`);
    assert.equal(build.json.manifest.providerTarget.target, 'fastly-compute-native');
    assert.equal(build.json.manifest.providerTarget.javascriptRuntime, false);
    assert.equal(build.json.manifest.providerTarget.wasm.magic, '0061736d01000000');
    assert.ok(fs.existsSync(path.join(buildDir, 'fastly.toml')), `${example.id} Fastly build is missing fastly.toml`);
    assert.ok(fs.existsSync(path.join(buildDir, 'fastly-build.json')), `${example.id} Fastly build is missing fastly-build.json`);
  } else {
    assert.equal(fs.existsSync(path.join(buildDir, 'bin', 'main.wasm')), false, `${example.id} Node build must not claim a Fastly provider target`);
  }
  if ((example.schemas || []).length > 0) {
    assert.ok(fs.existsSync(path.join(buildDir, 'schema-json-registry.json')), `${example.id} schema build is missing the registry`);
    assert.ok(fs.existsSync(path.join(buildDir, 'schema-json-codecs.cjs')), `${example.id} schema build is missing generated codecs`);
  }
  const optimized = verifyOptimizedNativeBuild(example, projectDir, outputs);
  assertSecretsRedacted(outputs, secretValues(project), example.id);
  const summary = Object.freeze({
    id: example.id,
    provider: example.provider,
    tests: project.tests.length,
    capabilities: inspect.json.compiler.capabilities.length,
    schemas: inspect.json.project.schemas.count,
    guestWasmBytes,
    optimizedGuestWasmBytes: optimized.guestWasmBytes,
    wasmBytes,
    optimizedWasmBytes: optimized.providerWasmBytes
  });
  for (const target of [
    buildDir,
    path.join(projectDir, OPTIMIZED_BUILD_DIR),
    guestCacheDir
  ]) {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    assert.equal(fs.existsSync(target), false, `${example.id} documentation check did not clean ${path.basename(target)}`);
    cleanupPaths.delete(target);
  }
  return summary;
}

function verifyEveryExampleWorkflow(syncResult) {
  return examples.map((example) => verifyExampleWorkflow(example, syncResult));
}

function verifyInitWorkflow() {
  const tempRoot = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-doc-init-'));
  const projectRoot = path.join(tempRoot, 'hello-pulse');
  try {
    const initialized = runJson(['init', projectRoot, '--json'], tempRoot);
    assert.equal(initialized.status, 'initialized');
    assert.equal(runJson(['doctor', '--json'], projectRoot).status, 'passed');
    assert.equal(runJson(['inspect', '--json'], projectRoot).status, 'ok');
    assert.equal(runJson(['test', '--json'], projectRoot).status, 'passed');
    assert.equal(runJson(['build', '--json'], projectRoot).status, 'built');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

function waitForReady(child, stderrText) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => finish(new Error(`timed out waiting for documented pulse dev readiness; stderr=${stderrText()}`)), 20000);
    function finish(error, value) {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      error ? reject(error) : resolve(value);
    }
    function onData(chunk) {
      buffer += chunk;
      for (;;) {
        const index = buffer.indexOf('\n');
        if (index < 0) return;
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let value;
        try { value = JSON.parse(line); }
        catch (_) { finish(new Error(`pulse dev emitted non-JSON output: ${line}`)); return; }
        if (value.event === 'ready') { finish(undefined, value); return; }
      }
    }
    function onError(error) { finish(error); }
    function onExit(code, signal) { finish(new Error(`pulse dev exited ${code} (${signal || 'no signal'}) before readiness; stderr=${stderrText()}`)); }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

function httpRequest(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.setTimeout(10000, () => request.destroy(new Error('documented dev request timed out')));
    request.once('error', reject);
  });
}

function waitForClose(child, stderrText) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      child.exitCode === 0 ? resolve() : reject(new Error(`pulse dev exited ${child.exitCode}; stderr=${stderrText()}`));
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`documented pulse dev did not exit after one request; stderr=${stderrText()}`));
    }, 15000);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`pulse dev exited ${code} (${signal || 'no signal'}); stderr=${stderrText()}`));
    });
  });
}

async function verifyDocumentedDevWorkflow() {
  const projectRoot = path.join(repoRoot, 'examples', '01-hello-json');
  const child = spawn(process.execPath, [pulseCli, 'dev', '--host', '127.0.0.1', '--port', '0', '--no-watch', '--once', '--json'], {
    cwd: projectRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const stderrText = () => stderr;
  try {
    const ready = await waitForReady(child, stderrText);
    assert.equal(ready.provider, 'node');
    assert.equal(ready.once, true);
    assert.equal(ready.watch, false);
    const response = await httpRequest(`${ready.url}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true });
    await waitForClose(child, stderrText);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

function verifySourceContracts() {
  console.log('docs - verify canonical example formatting');
  assertExampleFormatting();
  console.log('docs - verify source-backed Markdown');
  const syncResult = synchronizeDocSnippets({ write: false });
  assert.ok(syncResult.blockCount >= 24, `expected at least 24 source-derived documentation blocks, found ${syncResult.blockCount}`);
  const covered = new Set(syncResult.references.map((entry) => entry.source.match(/^examples\/([^/]+)\//)?.[1]).filter(Boolean));
  assert.deepEqual([...covered].sort(), examples.map((entry) => entry.id).sort(), 'every canonical example must supply exact source-derived documentation');
  return syncResult;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (options.list) { console.log(examples.map((entry) => entry.id).join('\n')); return; }
  try {
    if (options.example) {
      const syncResult = verifySourceContracts();
      const example = examples.find((entry) => entry.id === options.example);
      const summary = verifyExampleWorkflow(example, syncResult);
      if (summary.provider === 'fastly') assert.ok(summary.wasmBytes > 1024 && summary.wasmBytes < 1024 * 1024, `${summary.id} must produce compact native provider Wasm`);
      console.log(`ok - docs example ${summary.id}: provider=${summary.provider} tests=${summary.tests} capabilities=${summary.capabilities}${summary.schemas ? ` schemas=${summary.schemas}` : ''}${summary.wasmBytes ? ` wasm=${summary.wasmBytes}` : ''}`);
      return;
    }

    if (options.section === 'contracts') {
      const syncResult = verifySourceContracts();
      console.log('docs - verify CLI reference and flags');
      assertDocumentedCommands();
      const runBindings = parseRunBindings();
      console.log(`docs - execute ${runBindings.length} documented command/result bindings`);
      verifyRunBindings(runBindings);
      console.log(`ok - executable documentation contract binds ${syncResult.blockCount} source block(s) and verifies ${runBindings.length} documented result(s)`);
      return;
    }

    if (options.section === 'init-dev') {
      console.log('docs - execute clean init workflow');
      verifyInitWorkflow();
      console.log('docs - execute live dev workflow');
      await verifyDocumentedDevWorkflow();
      console.log('ok - executable documentation init and live dev workflows passed');
      return;
    }

    const syncResult = verifySourceContracts();
    console.log('docs - verify CLI reference and flags');
    assertDocumentedCommands();
    const runBindings = parseRunBindings();
    console.log(`docs - execute ${runBindings.length} documented command/result bindings`);
    verifyRunBindings(runBindings);
    console.log('docs - execute clean init workflow');
    verifyInitWorkflow();
    console.log('docs - execute live dev workflow');
    await verifyDocumentedDevWorkflow();
    console.log('docs - execute every canonical example workflow');
    const summaries = verifyEveryExampleWorkflow(syncResult);
    const fastly = summaries.filter((entry) => entry.provider === 'fastly');
    assert.equal(fastly.length, 2, 'expected two documented Fastly examples');
    assert.ok(fastly.every((entry) => entry.wasmBytes > 1024 && entry.wasmBytes < 1024 * 1024), 'every Fastly example must produce compact native provider Wasm');
    for (const entry of summaries) console.log(`ok - docs example ${entry.id}: provider=${entry.provider} tests=${entry.tests} capabilities=${entry.capabilities}${entry.schemas ? ` schemas=${entry.schemas}` : ''}${entry.wasmBytes ? ` wasm=${entry.wasmBytes}` : ''}`);
    console.log(`ok - executable documentation binds ${syncResult.blockCount} source block(s), verifies ${runBindings.length} documented result(s), runs ${summaries.length} canonical projects through doctor/inspect/test/build, and executes init plus a live dev request`);
  } finally {
    for (const target of cleanupPaths) fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
