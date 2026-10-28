'use strict';
// Focused follow-up: consume a structured observation in authored control flow.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const p = require('./prototype.cjs');
const { create } = require('./fixture.cjs'), { execute } = require('./host.cjs');
const compiler = require(path.join(p.root, 'wasm/packages/compiler/src/canonical-project-compiler'));
const { buildCanonicalNativePlan } = require(path.join(p.root, 'wasm/packages/compiler/src/canonical-native-plan'));
const platform = require(path.join(p.root, 'packages/provider-fastly/src/build/native-platform-capabilities'));
const directory = fs.mkdtempSync(path.join(p.root, 'wasm/.test-results/hex-nonterminal-consume-'));
const output = path.resolve(process.argv[2] || '/tmp/hex-nonterminal-consume');
fs.mkdirSync(output, { recursive: true });
const receipt = { version: 'hex.nonterminal-consume.v0', status: 'running',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: p.root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: p.root, encoding: 'utf8' }).trim(),
  node: process.version, inputs: ['prototype.cjs', 'fixture.cjs', 'host.cjs', 'consume.cjs'].map(file =>
    ({ file, sha256: p.hash(fs.readFileSync(path.join(__dirname, file))) })), cases: [] };
try {
  const fixture = create(directory);
  const source = `import { downstream } from '${p.PACKAGE}';
export default async function handler(ctx) {
  const tls = await downstream.tls(ctx);
  if (tls.protocol.status === 'available') {
    return ctx.text(tls.protocol.value);
  }
  return ctx.text('not-present');
}
`;
  fixture.write(source);
  const compiled = compiler.compileCanonicalProject(fixture.file, {
    rootDir: directory, workspaceRoot: directory, target: 'native', packageTargetDescriptor: p.TARGET });
  const plan = buildCanonicalNativePlan(compiled);
  const native = p.withPrototype(() => platform.compileFastlyNativePlatformCapabilitiesPlan(plan, {
    cwd: p.root, canonicalBuild: true, requirePlatformCapability: false, bindings: {},
    realizationArtifacts: compiler.packageRealizationArtifactsForCompiled(compiled) }));
  for (const [suffix, data] of [['wasm', native.wasm], ['ts', source], ['as.ts', native.source],
    ['manifest.json', JSON.stringify(native.manifest, null, 2)]]) fs.writeFileSync(path.join(output, 'consume.' + suffix), data);
  receipt.artifact = { bytes: native.wasm.length, sha256: p.hash(native.wasm), sourceSha256: p.hash(source),
    generatedSourceSha256: p.hash(native.source), valueKinds: plan.effects.map(e => e.result.valueKind) };
  for (const [name, options, expected] of [['available', {}, 'TLSv1.3'], ['unavailable', { tlsUnavailable: true }, 'not-present']]) {
    const result = execute(native.wasm, options);
    assert.equal(result.thrown, null); assert.equal(result.error, 0); assert.equal(result.status, 200);
    assert.equal(result.body, expected); assert.equal(result.trace.filter(e => e.call === 'send').length, 1);
    receipt.cases.push({ name, status: 'passed', body: result.body });
  }
  receipt.status = 'passed';
} catch (error) { receipt.status = 'failed'; receipt.error = error.stack; process.exitCode = 1; }
finally {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
}
