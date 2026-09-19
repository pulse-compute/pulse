#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LOWERABLE_LIBRARY_MANIFEST_KIND,
  LOWERABLE_LIBRARY_MANIFEST_VERSION
} = require('../../packages/contracts/src/library/manifest.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

function includesAll(source, values, label) {
  for (const value of values) {
    assert.equal(source.includes(value), true, `${label} is missing ${value}`);
  }
}

const express = read('docs/guides/migrating-from-express.md');
includesAll(express, [
  'not an Express-compatible runtime or a drop-in replacement',
  '`new Pulse({ auto: true })`',
  '`ctx.req.header(\'name\')`',
  '`ctx.param(\'id\')`',
  '`ctx.state.get()` / `ctx.state.set()`',
  '`return next()` permanently finishes this middleware',
  '`put`, `patch`, `delete`, `mount`, and `error`',
  'does not support `options`, `trace`, `connect`',
  '`pulse dev` / `pulse build` plus a provider',
  'Express middleware packages cannot be mounted directly',
  'Pulse never changes targets or falls back automatically'
], 'Express migration guide');
assert.doesNotMatch(express, /drop-in replacement for Express/i);

const runtimeTypes = read('packages/runtime/src/index.d.ts');
const routerDeclaration = /export declare class Router \{([\s\S]*?)\n\}/.exec(runtimeTypes);
assert.ok(routerDeclaration, 'runtime declarations must expose Router');
for (const method of ['use', 'get', 'head', 'post', 'put', 'patch', 'delete', 'mount', 'error']) {
  assert.match(routerDeclaration[1], new RegExp(`\\n  ${method}\\(`), `runtime declarations must retain Router.${method}`);
}
for (const unsupported of ['options', 'trace', 'connect']) {
  assert.doesNotMatch(routerDeclaration[1], new RegExp(`\\n  ${unsupported}\\(`), `runtime declarations must not expose Router.${unsupported}`);
}
assert.match(runtimeTypes, /export type RouterNext = \(error\?: unknown\) => never;/);

const schemas = read('docs/guides/json-schemas.md');
includesAll(schemas, [
  'The compiler does not execute the registry module',
  'an object root with required or question-mark optional property signatures',
  'Encoding omits absent optional properties; decoding leaves them absent.',
  'A present `undefined` value is rejected rather',
  '## Add semantic response cases',
  "response(201, 'app.User')",
  "await ctx.req.json<T>('app.Input')",
  "await ctx.fetch(url).json<T>('app.Output')",
  "ctx.fetch(url, { json: value, schema: 'app.Input' })",
  "ctx.json(value, { schema: 'app.Output' })",
  "return ctx.json(user, 'user.created')",
  '`pulse.strict` defaults to `true`',
  '`schemas.contentTypePolicy`',
  '`schemas.maxBytes`',
  'unknown fields of declared objects are removed recursively',
  '`ScalarRecord` preserves valid dynamic keys',
  '## Bounded scalar records',
  'These fixed limits apply independently to every record on encode and decode',
  'Decoding rejects duplicate record keys after JSON unescaping',
  'generic JSON when an ID is missing from the registry'
], 'JSON schema guide');

const schemaTypes = read('packages/pulse/src/schema.d.ts');
includesAll(schemaTypes, [
  'export type ScalarRecord = Readonly<Record<string, string | number | boolean | null>>;',
  'export declare function schema<Type>()',
  'export declare function response<',
  'export declare function defineSchemaRegistry<'
], 'schema authoring declarations');

const bodies = read('docs/concepts/bodies.md');
includesAll(bodies, [
  '## Ownership transitions',
  '| Incoming request text/JSON | Request host owns body bytes',
  '| Opaque fetch or package response | Provider owns the body handle',
  'Provider retains ownership through terminal pass-through',
  'Request-owned values and caches end with that request',
  'cannot be converted into a structured body',
  'deeply immutable value'
], 'body ownership concept');

const lowerer = read('docs/contributing/package-lowerer-contract.md');
const ownerPaths = [
  'packages/assets/pulse.package.json',
  'packages/assets/pulsewasm.manifest.cjs',
  'packages/assets/pulsewasm.compiler.cjs',
  'wasm/packages/contracts/src/assets/contracts.js',
  'packages/grip/pulse.package.json',
  'packages/grip/pulsewasm.manifest.cjs',
  'packages/grip/pulsewasm.compiler.cjs',
  'wasm/packages/contracts/src/grip/contracts.js',
  'wasm/packages/contracts/src/library/manifest.js',
  'wasm/packages/library-kit/src/compiler/handler-library-contracts.js',
  'wasm/packages/compiler/src/project/package-reachability.js',
  'wasm/packages/compiler/src/spine/package-operation-seam.js',
  'wasm/packages/compiler/src/canonical-project-compiler.js',
  'release/pulse-release-manifest.json'
];
includesAll(lowerer, [
  '## Application promise versus internal protocol',
  '## Canonical owner map',
  '## Contract pipeline',
  LOWERABLE_LIBRARY_MANIFEST_VERSION,
  LOWERABLE_LIBRARY_MANIFEST_KIND,
  'first-party'
], 'package lowerer reference');
for (const relative of ownerPaths) {
  assert.equal(fs.existsSync(path.join(repoRoot, relative)), true, `lowerer owner path does not exist: ${relative}`);
  assert.equal(lowerer.includes(`\`${relative}\``), true, `lowerer reference does not cite ${relative}`);
}

for (const relative of [
  'packages/assets/pulsewasm.manifest.cjs',
  'packages/grip/pulsewasm.manifest.cjs'
]) {
  const manifest = require(path.join(repoRoot, relative));
  assert.equal(manifest.version, LOWERABLE_LIBRARY_MANIFEST_VERSION);
  assert.equal(manifest.kind, LOWERABLE_LIBRARY_MANIFEST_KIND);
  assert.equal(manifest.compiler.version, 'pulsewasm.lowerable-compiler-builder.v1');
  assert.equal(manifest.compiler.trust, 'first-party');
}

const lowererTutorial = read('docs/contributing/adding-first-party-lowerer.md');
assert.match(lowererTutorial, /reachable module graph selects participating package contracts/);
assert.match(lowererTutorial, /not entry-source substring discovery/);
assert.doesNotMatch(lowererTutorial, /selects those whose import subpath appears in the entry source/);

console.log('ok - Express migration, schema boundaries, body ownership, and package-lowering owners match current repository contracts');
