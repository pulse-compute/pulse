'use strict';
// Local provider acceptance. All product builds use the exact installed CLI;
// only fixture construction and independent expectations use repository helpers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const fastly = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const { expectations } = require('./context-installed-oracle.cjs');
const resources = require('../runtime/binary-resource-closure-fixture.cjs');
const { hash } = resources;
const json = file => JSON.parse(fs.readFileSync(file));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const toolNames = ['pulse.diagnostic', 'pulse.example', 'pulse.read', 'pulse.search', 'pulse.start'];
const protocol = '2026-07-28';
function request(method, params = {}, id = 1) {
  return { method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'mcp-protocol-version': protocol, 'mcp-method': method, ...(params.name ? { 'mcp-name': params.name } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': protocol, 'io.modelcontextprotocol/clientCapabilities': {} } } }) };
}
function rss(pid) {
  try {
    const children = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    return [{ pid, bytes: Number(status.match(/^VmRSS:\s+(\d+)/m)[1]) * 1024 }, ...children.flatMap(rss)];
  } catch { return []; }
}
const observedRss = pid => { const samples = rss(pid); return samples.length ? samples : null; };
function inspectMemory(bytes) {
  // Standard Wasm memory section limits, not a runtime heap measurement.
  let at = 8;
  function uleb() { let result = 0, shift = 0, byte; do { byte = bytes[at++]; result += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return result; }
  while (at < bytes.length) {
    const section = bytes[at++], size = uleb(), end = at + size;
    if (section === 5) { assert.equal(uleb(), 1); const flags = uleb(), initial = uleb(), maximum = flags & 1 ? uleb() : null; return { initialBytes: initial * 65536, maximumBytes: maximum === null ? null : maximum * 65536 }; }
    at = end;
  }
  throw Error('Missing defined Wasm memory');
}
async function qualify({ consumer, temporary, root, run, env, output, verifyCopy }) {
  fs.mkdirSync(output, { recursive: true });
  const report = { schemaVersion: 'pulse.context-fastly-local.v1', status: 'running',
    providerReality: 'actual-local-fastly-cli-and-viceroy', deployed: false, injectedAbiExecution: false,
    limitations: ['Local acceptance only; not deployed service qualification.', 'RSS samples cover CLI/Viceroy processes, not guest allocations or peak live heap.',
      'Guest live allocation counts, retained-byte counters and peak committed pages are unavailable through this host HTTP surface.',
      'Each Viceroy request uses a fresh instance; repeated requests do not claim retained-instance execution.'], variants: [], cases: [] };
  const save = () => write(path.join(output, 'qualification.json'), report);
  let active;
  try {
    const launcher = fastly.inspectFastlyComputeLauncher({ launcherKind: 'fastly-cli', requireViceroy: true, env, timeoutMs: 5000 });
    assert.equal(launcher.kind, 'fastly-cli');
    report.tools = Object.fromEntries([['fastlyCli', launcher.fastlyCliInspection], ['viceroy', launcher.viceroyInspection]].map(([key, value]) => {
      assert(value?.version); return [key, { ...value, sha256: hash(fs.readFileSync(value.binary)) }];
    }));
    report.fixtureFiles = Object.fromEntries(['context-fastly-local.cjs', 'context-installed-oracle.cjs', 'context-installed-read-guard.cjs',
      'context-quality-harness.cjs', 'context-quality-cases.json', '../runtime/binary-resource-closure-fixture.cjs'].map(file => [file, hash(fs.readFileSync(path.join(__dirname, file)))]));
    const manifest = json(path.join(consumer, 'context-data/context-manifest.json'));
    const source = fs.readFileSync(path.join(consumer, 'context-corpus.ts'), 'utf8');
    const corpus = JSON.parse(source.slice(source.indexOf('export const contextCorpus = freeze(') + 'export const contextCorpus = freeze('.length, source.lastIndexOf(' as const);')));
    assert.equal(corpus.corpusHash, manifest.source.corpusHash);
    report.context = { manifestSha256: hash(fs.readFileSync(path.join(consumer, 'context-data/context-manifest.json'))), corpusHash: corpus.corpusHash, rows: corpus.records.length };
    for (const item of manifest.outputs) assert.equal(hash(fs.readFileSync(path.join(consumer, item.path))), item.sha256);
    const baselineInstalled = verifyCopy(consumer);
    const local = createRequire(path.join(consumer, 'package.json'));
    report.memoryPolicy = local('@pulse-compute/wasm-contracts/handler/canonical-native-runtime').CANONICAL_NATIVE_READ_LOOP_MEMORY;

    async function build(name, prepare) {
      console.log(`fastly-local - build ${name} with installed CLI`);
      const app = path.join(temporary, 'fastly-' + name), proof = path.join(app, '.qualification');
      fs.cpSync(path.join(consumer, 'application'), app, { recursive: true });
      fs.cpSync(path.join(consumer, 'node_modules'), path.join(app, 'node_modules'), { recursive: true, verbatimSymlinks: true });
      const installed = verifyCopy(app);
      execFileSync('git', ['init', '--quiet', app], { env });
      fs.mkdirSync(proof); fs.copyFileSync(path.join(__dirname, 'context-installed-read-guard.cjs'), path.join(proof, 'read-guard.cjs'));
      write(path.join(proof, 'settings.json'), { consumer: app });
      await prepare?.(app);
      const configFile = path.join(app, '.pulse/config.ts');
      const configSha256 = hash(fs.readFileSync(configFile));
      const scratch = path.join(app, '.native-temp'); fs.mkdirSync(scratch);
      const before = performance.now();
      await run(process.execPath, [path.join(app, 'node_modules/@pulse-compute/cli/bin/pulse.js'), 'build', '--profile', 'fastly-native', '--json'], {
        cwd: app, timeout: 180000, environment: { ...env, TMPDIR: scratch, NODE_COMPILE_CACHE: '', NODE_OPTIONS: `--require=${path.join(proof, 'read-guard.cjs')}` } });
      const dist = path.join(app, 'dist-fastly-native'), wasm = fs.readFileSync(path.join(dist, 'bin/main.wasm'));
      const built = json(path.join(dist, 'pulse-build.json'));
      assert.equal(built.status, 'built'); assert.equal(built.configuredTarget, 'native');
      const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
      assert(!imports.some(x => /env|pulse_host|js[_-]?compute/.test(x.module)), 'No JS runtime or injected host ABI');
      assert(!imports.some(x => /wasi/.test(x.module) && !['clock_time_get', 'fd_write'].includes(x.name)), 'No runtime filesystem/network fallback');
      const directory = path.join(output, name); fs.mkdirSync(path.join(directory, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(directory, 'bin/main.wasm'), wasm);
      fs.writeFileSync(path.join(directory, 'fastly.toml'), fastly.renderFastlyLocalConfig({ name: 'pulse-context-' + name }));
      const receipts = {};
      for (const file of ['pulse-build.json', 'fastly-build.json', 'fastly-native-manifest.json']) {
        const bytes = fs.readFileSync(path.join(dist, file)); fs.writeFileSync(path.join(directory, file), bytes); receipts[file] = hash(bytes);
      }
      assert.deepEqual(verifyCopy(app), installed);
      const item = { name, configSha256, moduleSha256: hash(wasm), moduleBytes: wasm.length, compileMs: performance.now() - before,
        receipts, imports, memory: { ...inspectMemory(wasm), runtimePeakBytes: null, liveAllocationCount: null, retainedBudgetBytes: null },
        servingDirectory: directory, sourceFreeServingDirectory: true, configuredBackends: 0, dynamicBackends: false,
        buildReadGuard: 'trusted-tooling content reads and CommonJS resolution restricted to installed consumer; not a hostile-code sandbox' };
      report.variants.push(item); save();
      return { item, directory, wasm, app };
    }
    async function serve(variant, callback) {
      const inventory = fs.readdirSync(variant.directory).sort();
      assert(!inventory.some(file => /\.(?:ts|js|cjs)$/.test(file)));
      active = await fastly.startFastlyComputeServe({ launcher, packageRoot: variant.directory, env, timeoutMs: 5000, startTimeoutMs: 120000, stopTimeoutMs: 5000 });
      assert.deepEqual(active.args.slice(0, 2), ['compute', 'serve']); assert(active.args.includes('--viceroy-path'));
      variant.item.launch = { command: active.child.spawnfile, args: active.args, rssBefore: observedRss(active.child.pid) };
      const latencies = [];
      async function exchange(label, req) {
        const started = performance.now();
        const response = await fastly.requestFastlyCompute(active, { ...req, timeoutMs: 10000 });
        const wallMs = performance.now() - started;
        assert(wallMs < 10000, 'Host round trip exceeded test ceiling'); assert(response.body.length <= 131072);
        report.cases.push({ variant: variant.item.name, label, status: response.status, bytes: response.body.length, sha256: hash(response.body), wallMs });
        latencies.push(wallMs); return response;
      }
      try { await callback(exchange); }
      finally {
        variant.item.launch.rssAfter = observedRss(active.child.pid);
        variant.item.requests = latencies.length;
        const sorted = [...latencies].sort((a,b) => a-b);
        variant.item.latencyMs = { first: latencies[0] ?? null, median: sorted[Math.floor(sorted.length/2)] ?? null, maximum: sorted.at(-1) ?? null };
        variant.item.logs = { stdout: hash(active.logs.stdout), stderr: hash(active.logs.stderr) };
        fs.writeFileSync(path.join(variant.directory, 'stdout.log'), active.logs.stdout); fs.writeFileSync(path.join(variant.directory, 'stderr.log'), active.logs.stderr);
        await active.stop();
        assert(active.child.exitCode !== null || active.child.signalCode !== null, 'CLI process must terminate');
        variant.item.cleanup = { status: 'passed', exitCode: active.child.exitCode, signal: active.child.signalCode,
          descendantProcessObservation: variant.item.launch.rssAfter === null ? 'unavailable' : 'sampled-before-stop' };
        active = null;
        assert.equal(hash(fs.readFileSync(path.join(variant.directory, 'bin/main.wasm'))), variant.item.moduleSha256);
        save();
      }
    }
    function decode(response) { assert.equal(response.status, 200, response.body.toString()); const reply = JSON.parse(response.body); assert(!reply.error, response.body.toString()); return reply.result; }
    async function tools(exchange, cases) {
      const listed = decode(await exchange('tools/list', request('tools/list'))); assert.deepEqual(listed.tools.map(t => t.name), toolNames);
      assert(decode(await exchange('server/discover', request('server/discover'))));
      for (const [i, c] of cases.entries()) {
        const value = decode(await exchange(`${c.tool}:${i}`, request('tools/call', { name: c.tool, arguments: c.input })));
        assert.equal(value.isError, false); assert(Buffer.byteLength(JSON.stringify(value)) <= 24576);
        assert.deepEqual(value.structuredContent, c.expected, JSON.stringify(c.input)); assert.deepEqual(JSON.parse(value.content[0].text), c.expected);
      }
    }
    const expectedDir = path.join(temporary, 'fastly-oracle'); fs.mkdirSync(expectedDir);
    const extraCases = [
      {tool:'start',input:{goal:'json-api',provider:'fastly',target:'native'}},
      {tool:'start',input:{goal:'unknown',provider:'node',target:'native'}},
      {tool:'read',input:{id:'missing/record'}}, {tool:'read',input:{id:'schema/registry',offset:-1}},
      {tool:'example',input:{id:'missing-example'}}, {tool:'diagnostic',input:{code:'PULSE_UNKNOWN'}},
      ...[{query:'a'.repeat(257)},{query:'schema',offset:513},{query:'schema',limit:6},{query:'schema',category:'unknown'}].map(input=>({tool:'search',input}))
    ];
    const cases = expectations(consumer, expectedDir, corpus, manifest, extraCases);
    report.expected = { cases: cases.length, sha256: hash(JSON.stringify(cases)), oracle: 'independent legacy handlers and lexical scan' };
    const actual = await build('shipped');
    await serve(actual, async exchange => {
      await tools(exchange, cases);
      const base = request('tools/list');
      const negatives = [
        ['wrong-path', { ...base, path: '/mcp/' }, 404], ['get', { method: 'GET', path: '/mcp' }, 405],
        ['origin', { ...base, headers: { ...base.headers, origin: 'https://untrusted.invalid' } }, 403],
        ['accept', { ...base, headers: { ...base.headers, accept: 'text/plain' } }, 406],
        ['content-type', { ...base, headers: { ...base.headers, 'content-type': 'text/plain' } }, 415],
        ['encoding', { ...base, headers: { ...base.headers, 'content-encoding': 'gzip' } }, 415],
        ['oversized', { ...base, body: ' '.repeat(32769) }, 413],
        ['malformed', { ...base, body: '{' }, 400], ['batch', { ...base, body: '[]' }, 400],
        ['protocol', { ...base, headers: { ...base.headers, 'mcp-protocol-version': 'invalid' } }, 400],
        ['method-header', { ...base, headers: { ...base.headers, 'mcp-method': 'other' } }, 400]
      ];
      for (const [label, req, status] of negatives) assert.equal((await exchange(label, req)).status, status, label);
      for (const [label, mutate] of [
        ['invalid-id', value => value.id = true], ['invalid-jsonrpc', value => value.jsonrpc = '1.0'],
        ['array-params', value => value.params = []], ['missing-meta', value => delete value.params._meta],
        ['invalid-capabilities', value => value.params._meta['io.modelcontextprotocol/clientCapabilities'] = []],
        ['unexpected-params', value => value.params.cursor = 'unknown']
      ]) {
        const value=JSON.parse(base.body); mutate(value);
        assert.equal((await exchange(label,{...base,body:JSON.stringify(value)})).status,400,label);
      }
      assert.equal((await exchange('excess-depth',{...base,body:'{"a":'.repeat(33)+'0'+'}'.repeat(33)})).status,400);
      assert.equal((await exchange('unknown-method',request('unknown'))).status,404);
      assert.equal((await exchange('notification',{...base,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})})).status,202);
      const mismatch=request('tools/call',{name:'pulse.search',arguments:{version:corpus.pulseVersion,query:'schema'}});
      assert.equal((await exchange('tool-header-mismatch',{...mismatch,headers:{...mismatch.headers,'mcp-name':'pulse.read'}})).status,400);
      const unknown = await exchange('unknown-tool', request('tools/call', { name: 'unknown', arguments: {} }));
      assert(JSON.parse(unknown.body).error || JSON.parse(unknown.body).result?.isError);
      const invalid = decode(await exchange('invalid-input-schema', request('tools/call', { name: 'pulse.search', arguments: { version: corpus.pulseVersion, query: 42 } })));
      assert.equal(invalid.isError, true); assert.equal(invalid.structuredContent, undefined);
      const repeat = cases.find(c => c.tool === 'pulse.search' && c.expected.status === 'ok' && c.expected.results.length);
      await tools(exchange, Array.from({ length: 32 }, () => repeat));
    });

    // Synthetic admitted growth is separately bound; it never replaces shipped bytes.
    const B = require('../../../scripts/pulse-context-build.cjs'), F = require('../../../scripts/pulse-context-format.cjs');
    const S = require('../../../scripts/pulse-context-start.cjs'), C = require('../../../scripts/pulse-context-corpus.cjs');
    const built = B.construct(root), grown = require('./context-quality-harness.cjs').growth(built);
    const encoded = F.encode(grown, built.config.limits);
    const resourceManifest = local('@pulse-compute/wasm-contracts/resources/embedded').createResourceManifest(F.FILES.map(name => ({ path: '/' + name, bytes: encoded.files[name] })), built.manifest.dimensions.budgets);
    const generated = S.generate(grown, built.config, encoded.files, resourceManifest, file => fs.readFileSync(path.join(root, file)));
    const growth = await build('growth', app => { for (const [file, bytes] of generated.outputs) fs.writeFileSync(path.join(app, file.slice(S.APP.length + 1)), bytes); });
    growth.item.synthetic = { rows: grown.records.length, corpusHash: grown.corpusHash, dimensions: F.validateFiles(encoded.files, grown, built.config.limits), resourceManifestSha256: hash(JSON.stringify(resourceManifest)) };
    const grownOracle = path.join(temporary, 'growth-oracle-input'); fs.cpSync(consumer, grownOracle, { recursive: true });
    fs.writeFileSync(path.join(grownOracle, 'context-corpus.ts'), C.render(grown));
    const grownProof = path.join(temporary, 'growth-oracle'); fs.mkdirSync(grownProof);
    const growthCases = expectations(grownOracle, grownProof, grown, manifest, extraCases);
    const search = require('./context-search-oracle.cjs').search;
    const query = 'growth0000 growth0001 growth0002 growth0003 growth0004 growth0005 growth0006 growth0007';
    for (const args of [{query,offset:0},{query,offset:55},{query,offset:59,limit:1},{query,offset:60},{query,offset:61},{query:'growth1199'},{query:'unknownterm'}]) {
      const input = {version:grown.pulseVersion,...args}; growthCases.push({tool:'pulse.search',input,expected:search(grown,{applicationVersion:manifest.compatibility.applicationVersion,encoder:manifest.algorithm},input)});
    }
    growth.item.expectedCases = growthCases.length; growth.item.expectedSha256 = hash(JSON.stringify(growthCases));
    await serve(growth, exchange => tools(exchange, growthCases));

    const deadline = await build('deadline', app => {
      const file = path.join(app, '.pulse/config.ts'), value = fs.readFileSync(file, 'utf8');
      assert(value.includes('fastly: { maxDurationMs: 5000')); fs.writeFileSync(file, value.replace('fastly: { maxDurationMs: 5000', 'fastly: { maxDurationMs: 1'));
    });
    deadline.item.configuredDeadlineMs = 1;
    await serve(deadline, async exchange => {
      for (let i=0;i<3;i++) {
        const response = await exchange('deadline-expired', request('tools/call', {name:'pulse.search',arguments:{version:corpus.pulseVersion,query:'schema'}}));
        assert([408,504].includes(response.status), response.body.toString());
        assert(!JSON.parse(response.body).result?.structuredContent);
        assert.equal((await exchange('admission-after-deadline', {...request('tools/list'),path:'/not-mcp'})).status,404);
      }
    });

    const data = resources.fixture();
    const generic = await build('resources', app => {
      resources.writeProject(app, data);
      const configFile = path.join(app,'.pulse/config.ts'), config = fs.readFileSync(configFile,'utf8');
      fs.writeFileSync(configFile, config.replace('"native":{"host":"node","target":"native","outDir":"dist-native"}', '"fastly-native":{"host":"fastly","target":"native","outDir":"dist-fastly-native","fastly":{"maxDurationMs":5000}}'));
      const first = path.join(app,'src/first.ts');
      const ascii=data.shared.findIndex(byte=>byte>=32&&byte<127), text=JSON.stringify(String.fromCharCode(data.shared[ascii]));
      fs.writeFileSync(first,fs.readFileSync(first,'utf8').replace("const data=ctx.resources.map('alias');", "const cells=ctx.workspace.numbers(4);const initial=cells[0];cells[0]=7;if(input.value===-2){cells[input.value]=1;}const data=ctx.resources.map('alias');if(input.value===-3)return {value:data.readU32LE(data.byteLength),length:data.byteLength,empty:0};")
        .replace('value:data.readU32LE(1)+',`value:initial+(data.readUtf8(${ascii},1)===${text}?0:1)+(empty.readUtf8(0,0)===''?0:1)+data.readU32LE(1)+`));
      fs.writeFileSync(path.join(app,'src/heavy.ts'),"export function heavy(ctx,input){let text='x'+input.value;for(let i=0;i<21;i++){text=text+text;}return {value:text.length};}");
      const sourceFile=path.join(app,'src/index.ts'); let source=fs.readFileSync(sourceFile,'utf8');
      const pair="{inputSchema:'proof.Input',outputSchema:'proof.Input'}";
      // Twelve heavy calls + one single-call branch + three resource calls = 16.
      const many=Array.from({length:12},(_,i)=>`const r${i}=ctx.call(heavy,{value:${i}},${pair});`).join('');
      source="import {heavy} from './heavy';"+source.replace('handler(ctx){',`handler(ctx){const mode=ctx.req.header('mode')??'';if(mode==='allocation'){${many}return ctx.json(r11,{schema:'proof.Input'});}if(mode==='single'){const r=ctx.call(heavy,{value:2},${pair});return ctx.json(r,{schema:'proof.Input'});}`)
        .replace('ctx.call(first,{value:0}',"ctx.call(first,{value:mode==='bounds'?-2:mode==='resource-bounds'?-3:0}");
      fs.writeFileSync(sourceFile,source);
    });
    generic.item.physical = resources.physical(generic.wasm, data);
    assert.deepEqual(generic.item.physical.physicalCopies,{shared:1,distinct:1,unused:0});
    generic.item.resourceManifestSha256=hash(data.serialized);
    await serve(generic, async exchange => {
      for(let i=0;i<16;i++)assert.deepEqual(JSON.parse((await exchange('resource-success',{path:'/'})).body),data.expected);
      const single=await exchange('single-allocation',{path:'/',headers:{mode:'single'}});assert.equal(single.status,200);assert.equal(JSON.parse(single.body).value,4194304);
      for(const mode of ['bounds','resource-bounds','allocation']) {
        const failed=await exchange(mode,{path:'/',headers:{mode}});assert.equal(failed.status,500,failed.body.toString());
        assert.deepEqual(JSON.parse((await exchange('recovery-after-'+mode,{path:'/'})).body),data.expected);
      }
    });
    assert.deepEqual(verifyCopy(consumer),baselineInstalled);
    report.installedUnchanged = true; report.status = 'passed'; save(); return report;
  } catch(error) { report.status='failed';report.error={message:error.message,stack:error.stack,detail:error.detail};save();throw error; }
  finally { if(active)await active.stop(); }
}
module.exports={qualify};
