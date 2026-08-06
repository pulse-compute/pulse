#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, parseJson } = require('./helpers.cjs');
const {
  DIAGNOSTIC_CATALOG,
  DIAGNOSTICS_REFERENCE,
  describeDiagnostic,
  diagnosticAnchor,
  httpStatusForDiagnostic
} = require('../../packages/cli/src/diagnostics.js');
const { errorSummary } = require('../../packages/cli/src/project-execution.js');
const { resolveFastlyCliBinary, resolveViceroyBinary } = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function parseFailure(result, expectedStatus) {
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  const value = JSON.parse(result.stderr);
  assert.equal(value.status, 'error');
  assert.ok(value.error);
  return value.error;
}

function assertShape(value, code, category) {
  assert.equal(value.code, code);
  assert.equal(value.title, DIAGNOSTIC_CATALOG[code].title);
  assert.equal(value.summary, DIAGNOSTIC_CATALOG[code].summary);
  assert.equal(value.category, category);
  assert.ok(Array.isArray(value.remediation) && value.remediation.length > 0, `${code} needs remediation`);
  assert.equal(value.stability, 'preview-stable');
  assert.equal(value.scope, 'public');
  assert.equal(value.docs, `${DIAGNOSTICS_REFERENCE}#${diagnosticAnchor(code)}`);
}

function writeProject(root, source, profile, harness) {
  fs.mkdirSync(path.join(root, '.pulse'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  if (harness) fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), source);
  if (harness) fs.writeFileSync(path.join(root, 'tests', 'pulse.harness.ts'), harness);
  fs.writeFileSync(path.join(root, '.pulse', 'config.ts'), `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', ${harness ? "tests: 'tests/pulse.harness.ts', " : ''}defaultProfile: 'local', strict: true },
  local: ${profile},
}));
`);
}

function main() {
  const unknown = parseFailure(run(['not-a-command', '--json'], repoRoot), 2);
  assertShape(unknown, 'PULSE_COMMAND_UNKNOWN', 'usage');
  const unknownHuman = run(['not-a-command'], repoRoot);
  assert.equal(unknownHuman.status, 2);
  assert.match(unknownHuman.stderr, /help:/);
  assert.ok(
    unknownHuman.stderr.includes(`docs: ${DIAGNOSTICS_REFERENCE}#${diagnosticAnchor('PULSE_COMMAND_UNKNOWN')}`),
    'human diagnostics must link the exact-version hosted diagnostic anchor'
  );

  const hello = path.join(repoRoot, 'examples', '01-hello-json');
  const unsafe = parseFailure(run(['build', hello, '--out', '..', '--json'], repoRoot), 2);
  assertShape(unsafe, 'PULSE_BUILD_OUT_UNSAFE', 'safety');

  const invalidSchemaCase = parseJson(run([
    'test', path.join(repoRoot, 'examples', '02-request-schema'), '--case', 'invalid-user', '--json'
  ], repoRoot));
  const schemaDecode = invalidSchemaCase.cases[0].expectedError;
  assertShape(schemaDecode, 'PULSE_SCHEMA_DECODE', 'request');
  assert.equal(httpStatusForDiagnostic(schemaDecode.code), 400);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-cli-diagnostics-'));
  try {
    const missingSchemaRoot = path.join(tmpRoot, 'missing-schema');
    writeProject(
      missingSchemaRoot,
      `import type { PulseContext, PulseResult } from '@pulse-compute/runtime';\nexport default async function handler(ctx: PulseContext): Promise<PulseResult> { const input = await ctx.req.json('app.Missing'); return ctx.json(input); }\n`,
      `{ host: 'node', target: 'native' }`
    );
    const missingSchema = parseFailure(run(['inspect', missingSchemaRoot, '--json'], repoRoot), 3);
    assertShape(missingSchema, 'PULSE_CANONICAL_COMPILE_FAILED', 'compile');
    const nestedMissing = missingSchema.diagnostics.find((entry) => entry.code === 'PULSE_CANONICAL_SCHEMA_MISSING');
    assert.ok(nestedMissing, 'missing schema diagnostic must remain visible');
    assertShape(nestedMissing, 'PULSE_CANONICAL_SCHEMA_MISSING', 'schema');

    const doctorRun = run(['doctor', missingSchemaRoot, '--json'], repoRoot);
    assert.equal(doctorRun.status, 1, doctorRun.stderr || doctorRun.stdout);
    const doctor = JSON.parse(doctorRun.stdout);
    const compileCheck = doctor.checks.find((entry) => entry.id === 'canonical-compile');
    assert.equal(compileCheck.status, 'failed');
    assertShape(compileCheck, 'PULSE_CANONICAL_COMPILE_FAILED', 'compile');
    const schemaCheck = doctor.checks.find((entry) => entry.id === 'schemas');
    assert.equal(schemaCheck.status, 'failed');
    assert.ok(schemaCheck.remediation.length > 0);

    const timeoutRoot = path.join(tmpRoot, 'fetch-timeout');
    writeProject(
      timeoutRoot,
      `import type { PulseContext, PulseResult } from '@pulse-compute/runtime';\nexport default async function handler(ctx: PulseContext): Promise<PulseResult> { const value = await ctx.fetch('https://slow.example.test/value', { timeoutMs: 5 }).json(); return ctx.json(value); }\n`,
      `{ host: 'node', target: 'native' }`,
      `export default { cases: [{ name: 'timeout', fetches: { 'https://slow.example.test/value': { delayMs: 25, value: { ok: true } } }, expect: { error: { name: 'FetchTimeoutError', code: 'PULSE_FETCH_TIMEOUT' } } }] };\n`
    );
    const timeout = parseJson(run(['test', timeoutRoot, '--json'], repoRoot));
    assert.equal(timeout.status, 'passed');
    assertShape(timeout.cases[0].expectedError, 'PULSE_FETCH_TIMEOUT', 'runtime');
    assert.equal(httpStatusForDiagnostic('PULSE_FETCH_TIMEOUT'), 504);

    const bindingRoot = path.join(tmpRoot, 'bad-fastly-binding');
    writeProject(
      bindingRoot,
      `import type { PulseContext, PulseResult } from '@pulse-compute/runtime';\nexport default async function handler(ctx: PulseContext): Promise<PulseResult> { const value = await ctx.fetch('https://api.example.test/data').json(); return ctx.json(value); }\n`,
      `{ host: 'fastly', target: 'native', fastly: { bindings: { dynamicBackends: false }, build: { name: 'bad-binding' } } }`
    );
    const binding = parseFailure(run(['inspect', bindingRoot, '--json'], repoRoot), 3);
    assertShape(binding, 'PULSE_FASTLY_BACKEND_REQUIRED', 'provider');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  let missingFastly;
  try { resolveFastlyCliBinary({ env: { PATH: '', PULSE_FASTLY_BIN: '' } }); }
  catch (error) { missingFastly = errorSummary(error); }
  assert.ok(missingFastly, 'missing Fastly CLI must fail closed');
  assertShape(missingFastly, 'PULSE_FASTLY_CLI_UNAVAILABLE', 'toolchain');
  assert.match(missingFastly.remediation.join(' '), /Homebrew|package manager|official release/i);

  let missingViceroy;
  try { resolveViceroyBinary({ env: { PATH: '', PULSE_VICEROY_BIN: '' } }); }
  catch (error) { missingViceroy = errorSummary(error); }
  assert.ok(missingViceroy, 'missing Viceroy must fail closed');
  assertShape(missingViceroy, 'PULSE_VICEROY_UNAVAILABLE', 'toolchain');
  assert.match(missingViceroy.remediation.join(' '), /Unset.*PULSE_VICEROY_BIN|executable Viceroy binary/i);

  const capability = errorSummary(Object.assign(new Error('Missing KV capability.'), { code: 'PULSE_PROVIDER_CAPABILITY_MISSING' }));
  assertShape(capability, 'PULSE_PROVIDER_CAPABILITY_MISSING', 'capability');
  assert.equal(httpStatusForDiagnostic(capability.code), 501);

  const diagnosticsDoc = fs.readFileSync(path.join(repoRoot, 'docs', 'reference', 'diagnostics.md'), 'utf8');
  assert.ok(Object.keys(DIAGNOSTIC_CATALOG).length > 0, 'the public diagnostic catalog must not be empty');
  for (const code of Object.keys(DIAGNOSTIC_CATALOG)) {
    assert.match(
      diagnosticsDoc,
      new RegExp(`^<a id="${diagnosticAnchor(code)}"></a>$`, 'm'),
      `diagnostics reference must expose a stable anchor for ${code}`
    );
    assert.match(
      diagnosticsDoc,
      new RegExp('^### `' + code + '` — ', 'm'),
      `diagnostics reference must document ${code}`
    );
  }
  assert.match(diagnosticsDoc, /fastly compute serve --file/);
  assert.match(diagnosticsDoc, /direct `viceroy serve`/i);
  assert.match(diagnosticsDoc, /inspected local Compute launcher/i);
  assert.match(diagnosticsDoc, /PULSE_VICEROY_UNAVAILABLE/);

  const fallback = describeDiagnostic('PULSE_FUTURE_UNCATALOGUED');
  assert.equal(fallback.docs, DIAGNOSTICS_REFERENCE, 'uncatalogued diagnostics must not emit nonexistent anchors');
  assert.equal(fallback.scope, 'fallback');
  assert.equal(fallback.stability, 'internal-or-forward-compatible');

  const stable = describeDiagnostic('PULSE_FETCH_TIMEOUT');
  assert.equal(stable.exitCode, 4);
  assert.equal(stable.httpStatus, 504);
  assert.match(describeDiagnostic('PULSE_NODE_VERSION_UNSUPPORTED').remediation.join(' '), /\^22\.14\.0 \|\| \^24\.0\.0/);
  assert.match(describeDiagnostic('PULSE_FETCH_IMPLEMENTATION_UNAVAILABLE').remediation.join(' '), /\^22\.14\.0 \|\| \^24\.0\.0/);

  console.log('ok - CLI diagnostics align stable codes, categories, exit/HTTP policy, remediation, docs, doctor checks, expected runtime errors, provider bindings, and explicit Fastly CLI/Viceroy launcher failures');
}

try { main(); } catch (error) { console.error(error && error.stack ? error.stack : error); process.exit(1); }
