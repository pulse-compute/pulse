'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const installed = process.argv.includes('--installed');
const root = installed ? fs.realpathSync(process.cwd()) : path.resolve(__dirname, '../../..');
function load(name, file) {
  let directory;
  if (installed) {
    directory = path.dirname(require.resolve('@pulse-compute/' + name));
    while (!fs.existsSync(path.join(directory, 'package.json'))) directory = path.dirname(directory);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))).name, '@pulse-compute/' + name);
    assert(fs.realpathSync(directory).startsWith(root + path.sep), 'installed implementation stays inside consumer');
  } else directory = path.join(root, name.startsWith('wasm-') ? 'wasm/packages/' + name.slice(5) : 'packages/' + name);
  return require(path.join(directory, 'src', file));
}
const {compileCanonicalProject} = load('wasm-compiler', 'canonical-project-compiler');
const {buildCanonicalNativePlan} = load('wasm-compiler', 'canonical-native-plan');
const generator = load('provider-fastly', 'build/native-platform-capabilities');
const {executeFastlyNativePlatformCapabilities: execute} = load('provider-fastly', 'testing/native-platform-capabilities-host');
const url = 'https://origin.example/body', bound = 1024;
const sources = {
  fetch: `export default async function handler(ctx){const body=await ctx.fetch('${url}').text();return ctx.text(body)}`,
  request: 'export default async function handler(ctx){const body=await ctx.req.text();return ctx.text(body)}',
  cached: 'export default async function handler(ctx){const a=await ctx.req.text();const b=await ctx.req.text();return ctx.text(a+b)}',
  json: `export default async function handler(ctx){const body=await ctx.fetch('${url}').json();return ctx.json(body)}`,
  unused: 'export default function handler(ctx){return ctx.text("ok")}'
};
function compile(source, maxBytes = bound, duration = 1000) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-decoded-reader-'));
  try {
  const file = path.join(directory, 'index.ts'); fs.writeFileSync(file, source);
  const plan = buildCanonicalNativePlan(compileCanonicalProject(file, {rootDir: directory, workspaceRoot: root, schemas: {maxBytes}, strict: false}));
  return generator.compileFastlyNativePlatformCapabilitiesPlan(plan, {
    cwd: root, emitWat: false, requirePlatformCapability: false, maxDurationMs: duration,
    bindings: {backends: {'https://origin.example': 'origin'}}
  });
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
}
function main() {
  const fetch = compile(sources.fetch), request = compile(sources.request), json = compile(sources.json), cached = compile(sources.cached);
  const cases = [];
  const check = (name, fn) => {try {fn(); cases.push(name);} catch (e) {e.message = name + ': ' + e.message; throw e;}};
  function run(compiled, body, chunkBytes = 1, extra = {}) {
    return execute(compiled, {request: {method: 'POST', body, chunkBytes}, fixtures: {[url]: {body, chunkBytes,
      headers: {'content-type': 'application/json'}}}, traceBodyIo: true, ...extra});
  }
  const reads = result => result.trace.filter(x => x.module === 'fastly_http_body' && x.name === 'read');
  function failure(invoke, stage) {
    let detail;
    assert.throws(invoke, e => {
      detail = e.detail;
      return e.code === 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED' && detail.errorStage === stage;
    });
    return detail;
  }
  function assertStorage(result, length) {
    const rows = reads(result); assert(rows.length > 0);
    let offset = 0; const base = rows[0].pointer;
    for (const row of rows) {
      assert.equal(row.pointer, base + offset, 'all fragments write into the same input backing');
      assert.equal(row.capacity, Math.min(65536, bound + 1 - offset));
      offset += row.bytes;
    }
    assert.equal(offset, length);
    assert(result.instance.exports.memory.buffer.byteLength < 4 * 1024 * 1024, 'one-byte reads cannot allocate a new 64 KiB buffer each time');
  }
  check('empty-short-exact-bound-and-fragmentation', () => {
    for (const length of [0, 1, 31, bound]) for (const chunk of [1, 7, 65536]) {
      const text = 'x'.repeat(length), result = run(fetch, text, chunk);
      assert.equal(result.response.status, 200); assert.equal(result.response.body, text); assertStorage(result, length);
      assert.equal(reads(result).at(-1).bytes, 0, 'exact bound still probes EOF');
    }
  });
  check('one-result-slot-reused-through-eof', () => {
    const slots = new Set();
    const result = run(fetch, 'a'.repeat(bound), 1, {afterHostcall(c) {if (c.module === 'fastly_http_body' && c.name === 'read') slots.add(c.args[3]);}});
    assert.equal(result.response.status, 200); assert.equal(slots.size, 1);
  });
  check('cached-request-alias-does-not-read-again', () => {
    const result = run(cached, 'retained', 1);
    assert.equal(result.response.body, 'retainedretained');
    assert.equal(reads(result).length, 9);
    assertStorage(result, 8);
  });
  check('overflow-consumes-only-one-sentinel-byte', () => {
    for (const compiled of [fetch, request]) {
      const invoke = () => run(compiled, 'x'.repeat(bound + 100), 65536);
      const result = compiled === request ? invoke() : failure(invoke, 21);
      if (compiled === request) assert.equal(result.response.status, 413);
      assert.equal(reads(result).reduce((n, x) => n + x.bytes, 0), bound + 1);
    }
  });
  check('utf8-scalars-cross-read-boundaries-and-nul-is-preserved', () => {
    const text = 'a\0é雪😀z';
    for (const compiled of [fetch, request]) for (const chunk of [1, 2, 3]) {
      const result = run(compiled, text, chunk);
      assert.equal(result.response.status, 200); assert.equal(result.response.body, text);
    }
  });
  check('request-validator-excludes-unused-capacity', () => {
    for (const body of [Buffer.from([0xe2]), Buffer.from([0xf0, 0x9f]), Buffer.from([0xc0, 0x80]), Buffer.from([0xed, 0xa0, 0x80])]) {
      assert.equal(run(request, body).response.status, 400);
    }
  });
  check('json-decoding-retains-one-complete-utf8-input', () => {
    const value = {text: '雪😀', n: 7};
    const result = run(json, JSON.stringify(value));
    assert.equal(result.response.status, 200); assert.deepEqual(JSON.parse(result.response.body), value);
  });
  check('invalid-count-and-host-error-stop-before-another-read', () => {
    for (const fault of ['negative', 'oversized', 'status']) {
      let calls = 0;
      failure(() => run(fetch, 'bounded', 1, {afterHostcall(c) {
        if (c.module !== 'fastly_http_body' || c.name !== 'read') return;
        calls++; if (fault === 'status') return 1;
        c.writeU32(c.args[3], fault === 'negative' ? 0xffffffff : c.args[2] + 1);
      }}), 20);
      assert.equal(calls, 1);
    }
  });
  check('original-request-deadline-remains-between-reads', () => {
    let calls = 0;
    const result = run(fetch, 'bounded', 1, {afterHostcall(c) {
      if (c.module === 'fastly_http_body' && c.name === 'read') {calls++; c.advance(1001);}
    }});
    assert.equal(result.response.status, 504); assert.equal(calls, 1);
  });
  check('unused-reader-emits-no-body-read-import', () => {
    const unused = compile(sources.unused);
    assert(!unused.inspection.imports.some(x => x.module === 'fastly_http_body' && x.name === 'read'));
  });
  const report = {status: 'passed', mode: installed ? 'installed' : 'workspace', cases,
    bound, readerBackingBytes: 3 * bound + 5, wholeOperationAccounting: false,
    artifacts: Object.fromEntries(Object.entries({fetch, request, json}).map(([name, compiled]) => [name,
      {bytes: compiled.wasm.length, sha256: createHash('sha256').update(compiled.wasm).digest('hex')}]))};
  console.log(JSON.stringify(report)); return report;
}
module.exports = {main};
if (require.main === module) main();
