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
      assert.equal(writes, failure.logEndpointFailure || failure.logWriteFailure ? 0 : 6);
      cases++;
    };
    run();
    // Reserved/failed stdout is an independent best-effort sink issue. It must
    // not block the response and is not evidence for successful log emission.
    run({ logEndpointFailure: true });
    run({ logWriteFailure: true });
  }
  console.log(`ok - Fastly safe structured logging: ${cases} actual-Native injected ABI cases (nested KV read/write, guest secret redaction, separate sink failures)`);
}
module.exports = { main };
if (require.main === module) main();
