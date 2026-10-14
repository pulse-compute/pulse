'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { normalizeSchemaRegistry } = require('../../packages/contracts/src/schema-json/registry');
const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const { createConditionalKvAuthority } = require('../../../packages/provider-fastly/src/testing/conditional-kv-host');
const { encodeConditionalKvValue } = require('../../../packages/runtime/src/host');
const root = path.resolve(__dirname, '../../..');

function main() {
  const source = { file: 'safe-structured-logging.ts', line: 1, column: 1 };
  const registry = normalizeSchemaRegistry({ source, schemas: [{ id: 'proof.Observation', typeName: 'Observation', source,
    root: { kind: 'object', fields: ['considered', 'invalidAcks'].map(name => ({ name, required: true, value: { kind: 'i32' } })) }
  }] });
  const metrics = { considered: 1, invalidAcks: 0 };
  const privateValue = { id: 'private-worker', nested: [{ id: 'private-nested',
    'private"field': 'private"value', 'private\\field': 'private\\value', '1': null, true: false }] };
  const secret = 'private-store-secret';
  const escapedMetrics = { ['prefix\"id']: 1, valid: true };
  let cases = 0;
  for (const operation of ['read', 'write']) {
    const compiled = compileCanonicalSource(`export default async function handler(ctx) {
      const command = await ctx.req.json();
      const result = ${operation === 'read'
        ? "await ctx.kv('catalog').getVersioned('private-key')"
        : "await ctx.kv('catalog').insertIfAbsent('private-key', command.value)"};
      const token = await ctx.secret.get('TOKEN');
      ctx.log.info(ctx.encodeJson({considered:1, invalidAcks:0}, 'proof.Observation'));
      ctx.log.info(${JSON.stringify(JSON.stringify(escapedMetrics))});
      ctx.log.info('payload: ' + ${operation === 'read' ? 'result' : 'command.value'});
      ctx.log.info('secret: prefix-' + token + '-suffix');
      ctx.log.info('key: private-key');
      const short = await ctx.secret.get('SHORT');
      ctx.log.info('wrapped: a' + short + 'b');
      return ctx.json({considered:1, invalidAcks:0});
    }`, { fileName: source.file, schemaBundle: buildCanonicalSchemaBundle(registry), strict: false });
    const native = platform.compileFastlyNativePlatformCapabilitiesPlan(buildCanonicalNativePlan(compiled), {
      cwd: root, canonicalBuild: true, bindings: { kv: { catalog: 'catalog' }, secretStore: 'secrets' }
    });
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(native.wasm));
    assert.ok(imports.some(entry => entry.module === 'wasi_snapshot_preview1' && entry.name === 'fd_write'));
    assert.ok(!imports.some(entry => entry.module === 'fastly_log'));
    const run = (failure = {}) => {
      const authority = createConditionalKvAuthority();
      authority.stores.set('catalog', new Map());
      if (operation === 'read') authority.seed('catalog', 'private-key', encodeConditionalKvValue(privateValue), 99n);
      let writes = 0;
      const result = execute(native, {
        request: { method: 'POST', body: JSON.stringify({ value: privateValue }) },
        conditionalKv: { authority }, secretStore: 'secrets', secrets: { TOKEN: secret, SHORT: 'id' },
        logEndpointFailure: false, ...failure,
        onLogWrite(message) {
          // Assert on actual guest emission, before the host's independent secret
          // masking. Assertions retain only booleans if a confidentiality check fails.
          const index = writes++;
          if (failure.logWriteMaxBytes !== undefined) { assert.ok(Buffer.byteLength(message) <= failure.logWriteMaxBytes); return; }
          if (index === 0) assert.deepEqual(JSON.parse(message.slice('[pulse:info] '.length)), metrics, operation);
          else if (index === 1) assert.deepEqual(JSON.parse(message.slice('[pulse:info] '.length)), escapedMetrics);
          else if (index === 2) {
            for (const value of ['id', 'nested', 'private"field', 'private\\field', '1', 'true']) {
              assert.equal(message.includes(JSON.stringify(value)), false, 'whole KV field token must be redacted');
            }
            for (const value of ['private-worker', 'private-nested', 'private"value', 'private\\value']) {
              assert.equal(message.includes(value), false, 'raw KV value must be redacted');
              assert.equal(message.includes(JSON.stringify(value).slice(1, -1)), false, 'encoded KV value must be redacted');
            }
            assert.equal(message.includes('fastly-kv-v1:'), false, 'generation must be redacted');
            assert.ok(message.includes('<redacted>'));
          } else if (index === 3) {
            assert.equal(message.includes(secret), false, 'guest must redact Secret Store plaintext');
            assert.equal(message, '[pulse:info] secret: prefix-<redacted>-suffix\n');
          } else if (index === 4) assert.equal(message, '[pulse:info] key: <redacted>\n');
          else assert.equal(message, '[pulse:info] wrapped: a<redacted>b\n',
            'a real short secret remains substring-redacted even when also registered as a field');
        }
      });
      assert.equal(result.response.status, 200);
      assert.deepEqual(JSON.parse(result.response.body), metrics);
      assert.equal(result.kvEvidence.bodyFixtures.size, 0);
      assert.equal(writes, failure.logWriteFailure ? 0 : 6);
      assert.equal(result.trace.filter(entry => entry.name === 'fd_write').length, 6, 'exactly one bounded attempt per statement');
      assert.equal(result.trace.some(entry => entry.module === 'fastly_log'), false, 'stdio never opens named endpoints');
      cases++;
    };
    run();
    // Named endpoint failures cannot disable stdio. Sink errors and short or
    // zero writes must not block the response or cause retries.
    run({ logEndpointFailure: true });
    run({ logWriteFailure: true });
    run({ logWriteMaxBytes: 0 });
    run({ logWriteMaxBytes: 7 });
  }
  const levelSource = compileCanonicalSource(`export default function handler(ctx) {
    ctx.log.error('error'); ctx.log.warn('warn'); ctx.log.info('café 😀'); ctx.log.debug('debug');
    return ctx.text('ok');
  }`, { fileName: 'stdio-levels.ts', strict: false });
  for (const reporting of ['debug', 'off']) {
    const levels = platform.compileFastlyNativePlatformCapabilitiesPlan(buildCanonicalNativePlan(levelSource, { reporting }), {
      cwd: root, canonicalBuild: true, requirePlatformCapability: false
    });
    const levelResult = execute(levels);
    assert.deepEqual(levelResult.logs.map(entry => entry.message), reporting === 'off' ? [] :
      ['[pulse:error] error\n', '[pulse:warn] warn\n', '[pulse:info] café 😀\n', '[pulse:debug] debug\n']);
    assert.equal(levels.inspection.imports.some(entry => entry.name === 'fd_write'), reporting !== 'off');
  }
  // The retained package-source adapter has its own logger and import audit.
  // Keep it covered even though ordinary Entities projects use the canonical path.
  const adapterSource = `
    export function pulse_entities_set_request(pointer: i32): i32 { return 1; }
    export function pulse_entities_start(): i32 {
      const message = 'adapter café 😀';
      pulse_entities_host_log(1, changetype<i32>(message), message.length);
      return 1;
    }
    export function pulse_entities_resume(): i32 { return 1; }
    export function pulse_entities_set_effect_result(index: i32, ok: i32, pointer: i32): i32 { return 1; }
    function pulse_entities_run_suspended(): i32 { return 2; }
    function pulse_entities_run_complete(): i32 { return 1; }
    function pulse_entities_response_ptr(): i32 { return changetype<i32>('ok'); }
    function pulse_entities_response_status(): i32 { return 200; }
    export function pulse_fastly_last_error(): i32 { return pulse_fastly_entities_last_error(); }
  `;
  const adapter = require('../../../packages/provider-fastly/src/build/entities-native.js').compileFastlyEntitiesNative({
    version: 'pulse.entities-native-source.v1', kind: 'package-generated-source',
    policy: { javascriptRuntime: false, javascriptHandlerImports: false, automaticFallback: false, requestBodyReads: 1 },
    imports: [], summary: { effects: 0 }, planHash: 'stdio-adapter-fixture', source: adapterSource,
    sourceSha256: require('node:crypto').createHash('sha256').update(adapterSource).digest('hex')
  }, { cwd: root });
  assert.ok(adapter.imports.some(entry => entry.module === 'wasi_snapshot_preview1' && entry.name === 'fd_write'));
  assert.ok(!adapter.imports.some(entry => entry.module === 'fastly_log'));
  for (const failure of [{}, { logWriteFailure: true }, { logWriteMaxBytes: 0 }, { logWriteMaxBytes: 7 }]) {
    const result = execute(adapter, failure);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.body, 'ok');
    assert.equal(result.trace.filter(entry => entry.name === 'fd_write').length, 1);
    if (Object.keys(failure).length === 0) assert.equal(result.logs[0].message, '[pulse:entities:1] adapter café 😀\n');
  }
  console.log(`ok - Fastly safe structured logging: ${cases} structured-log ABI cases, severity/off/UTF-8 controls and 4 retained-adapter cases`);
}
module.exports = { main };
if (require.main === module) main();
