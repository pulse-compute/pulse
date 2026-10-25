'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const native = require('../resource-accounting/ra03/native/build.cjs');
const {root} = native;
const platform = require(path.join(root, 'packages/provider-fastly/src/build/native-platform-capabilities'));
const composer = require(path.join(root, 'packages/provider-fastly/src/build/lifecycle-hooks'));
const authority = require(path.join(root, 'packages/provider-fastly/src/build/response-authority'));
const {compileCanonicalProject} = require(path.join(root, 'wasm/packages/compiler/src/canonical-project-compiler'));
const {buildCanonicalNativePlan} = require(path.join(root, 'wasm/packages/compiler/src/canonical-native-plan'));

// The config slot supplies the existing string result shape, not a new author API.
// Only this exact private fixture is substituted. Production admission is untouched.
const authored = `export default async function handler(ctx) {
  const probe = await ctx.config.get('PROBE');
  const value = await ctx.fetch('https://origin.example/value').text();
  return ctx.text(probe + ':' + value);
}\n`;
function generate(output) {
  fs.mkdirSync(output, {recursive: true});
  const file = path.join(output, 'handler.ts');
  fs.writeFileSync(file, authored);
  const compiled = compileCanonicalProject(file, {rootDir: output, workspaceRoot: output, target: 'native'});
  const plan = buildCanonicalNativePlan(compiled);
  assert.deepEqual(plan.effects.map(e => e.kind), ['config.get', 'fetch']);
  assert.equal(plan.effects[0].resource.value, 'PROBE');
  assert.equal(plan.effects[1].resource.value, 'https://origin.example/value');
  assert(plan.effects.every(e => !e.grouped && e.result.mode === 'bind'));
  fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  return platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan, {
    cwd: root, canonicalBuild: true, requirePlatformCapability: false, maxDurationMs: 1000,
    bindings: {configStore: 'proof', backends: {'https://origin.example': 'origin'}}
  }).source;
}
const diagnostic = `
export function proof_authority():i32 { return __pulse_response_authority; }
export function proof_tickets(index:i32):i32 { return unchecked(__pulse_invocation_tickets[index]); }
export function proof_closed():i32 { return __pulse_invocation_closed ? 1 : 0; }
export function proof_error():void { __pulse_fastly_jwt_send_error(); }
export function proof_timeout():void { __request_send_timeout(); }
`;
function control(source) {
  return composer.compose(authority.instrument(source), authority.hooks(), {requestBudget: true}).source + diagnostic;
}
function contributions() {
  const owner = 'proof.nonterminal';
  return [
    ...authority.hooks(),
    {point: 'request.acquired', owner, order: 10, body: '  nl_init();'},
    {point: 'effect.settle', owner, order: 10, body: '  return nl_settle(index, ticket, result);'},
    {point: 'effect.deliver', owner, order: 10,
      before: '  if (index == 0) { nl_delivering = true; nl_event(5, result, 0); }',
      after: '  if (index == 0) { nl_delivering = false; nl_accepted = accepted; nl_business = accepted == 1 && nl_outcome == 1; nl_event(7, accepted, nl_outcome); }'},
    {point: 'effect.result', owner, order: 10, body: '  return nl_result(effectIndex, handle);'},
    {point: 'invocation.end', owner, order: 10, body: '  nl_event(8, __pulse_response_authority, 0);'},
    {point: 'invocation.close', owner, order: 10,
      body: '  nl_event(9, unchecked(__pulse_invocation_tickets[0]), __pulse_invocation_closed ? 1 : 0);'},
    {point: 'invocation.closed', owner, order: 10, body: '  nl_finish();'}
  ];
}
function instrument(original, {enabled = true, reverse = false, mutation} = {}) {
  if (!enabled) return original;
  let source = authority.instrument(original);
  function once(before, after) {
    assert.equal(source.split(before).length - 1, 1, 'private fixture anchor: ' + before);
    source = source.replace(before, after);
  }
  once('if (kind == 2) __pulse_fastly_config_begin(effectIndex, payloadValue)',
    'if (kind == 2) nl_begin(effectIndex)');
  once('const response = __pulse_fastly_wait_ready(effectIndex)', 'const response = nl_complete(effectIndex)');
  let hooks = contributions();
  if (mutation === 'no-settle-guard') hooks = hooks.filter(h => h.point !== 'effect.settle');
  if (mutation === 'no-result-guard') hooks = hooks.filter(h => h.point !== 'effect.result');
  if (mutation === 'no-cleanup') hooks = hooks.filter(h => h.point !== 'invocation.closed');
  if (mutation === 'success-only') hooks = hooks.map(h => h.point === 'effect.settle'
    ? {...h, body: '  return index != 0 || (nl_outcome == 1 && nl_settle(index, ticket, result));'} : h);
  if (mutation === 'early-cleanup') hooks = hooks.map(h => h.point === 'invocation.closed'
    ? {...h, point: 'invocation.end', order: 20, owner: 'proof.early-cleanup'} : h);
  if (reverse) hooks.reverse();
  source = composer.compose(source, hooks, {requestBudget: true}).source;
  // Reuse the existing fixed-bank accounting kernel unchanged except visibility.
  return source + '\n' + native.source(1, 1).replaceAll('export function', 'function')
    + '\n' + fs.readFileSync(path.join(__dirname, 'service.as.ts'), 'utf8') + diagnostic;
}
module.exports = {root, authored, generate, control, instrument, compile: native.compile, asc: native.asc};
