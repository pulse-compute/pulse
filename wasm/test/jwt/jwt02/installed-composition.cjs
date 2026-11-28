'use strict';
// Copied into the isolated consumer. Product modules are supplied by its checked
// installed loader; only the Fastly ABI fixture is supplied by the supervisor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const now = 1700000000;
const targets = ['node-native', 'fastly-native'];

function signature(pair, algorithm, input) {
  return crypto.sign('sha256', Buffer.from(input), algorithm === 'ES256'
    ? { key: pair.privateKey, dsaEncoding: 'ieee-p1363' } : pair.privateKey).toString('base64url');
}
function verifyToken(token, pair, algorithm) {
  const [header, payload, tag] = token.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, algorithm);
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).sub, 'reader');
  assert(crypto.verify('sha256', Buffer.from(header + '.' + payload), algorithm === 'ES256'
    ? { key: pair.publicKey, dsaEncoding: 'ieee-p1363' } : pair.publicKey, Buffer.from(tag, 'base64url')));
}
// Independent SigV4 oracle: never calls a Pulse signer/provider to calculate the
// expectation. Like the existing S3 corpus it verifies the actual outbound bytes.
function verifyS3(request, secrets) {
  const headers = Object.fromEntries(request.headers);
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8}\/[^/]+\/s3\/aws4_request), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(headers.authorization);
  assert(match); assert.equal(match[1], secrets.ACCESS);
  const names = match[3].split(';'); assert.deepEqual(names, [...names].sort());
  const url = new URL(request.url);
  assert.equal(request.method, 'GET'); assert.equal(url.href, 'https://objects.example.invalid/jwt-fixture/key');
  assert.equal(headers.host, url.host); assert.equal(headers['x-amz-content-sha256'], hash(''));
  const canonical = ['GET', url.pathname, '', names.map(n => `${n}:${headers[n]}\n`).join(''), names.join(';'), hash('')].join('\n');
  const signing = ['AWS4-HMAC-SHA256', headers['x-amz-date'], match[2], hash(canonical)].join('\n');
  let key = Buffer.from('AWS4' + secrets.SECRET);
  for (const part of match[2].split('/')) key = crypto.createHmac('sha256', key).update(part).digest();
  assert.equal(match[4], crypto.createHmac('sha256', key).update(signing).digest('hex'));
}

async function qualify({ root, output, load, execution, resolveProject, driver, executeCanonicalNativeModule, executeFastlyNativePlatformCapabilities }) {
  const { inspectWasmFile } = load('@pulse-compute/wasm-guest-link');
  const { instantiateCanonicalNativeModule } = load('@pulse-compute/wasm-host-runtime/runtime/canonical-native-host');
  const receipt = [];
  const pairs = { RS256: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), ES256: crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }) };
  const definitions = ['ES256', 'RS256'].flatMap(algorithm => ['sha256', 'hmac', 's3'].map(kind => ({ kind, algorithm })))
    .concat(['baseline', 'mac', 'schema', 'combined'].map(kind => ({ kind, algorithm: 'RS256' })));
  for (const { kind, algorithm } of definitions) {
    const id = algorithm + '-' + kind, pair = pairs[algorithm];
    console.log(`jwt02-installed - ${id}`);
    const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'fixture' };
    const schema = kind === 'schema' || kind === 'combined';
    const mac = kind === 'mac' || kind === 'combined';
    const signs = ['sha256', 'hmac', 's3'].includes(kind);
    const secrets = { INGRESS_KEY: crypto.randomBytes(32).toString('hex'), SIGNING_KEY: JSON.stringify(pair.privateKey.export({ format: 'jwk' })), ACCESS: crypto.randomBytes(16).toString('hex'), SECRET: crypto.randomBytes(32).toString('hex') };
    const signingInput = Buffer.from(JSON.stringify({ alg: algorithm, kid: 'fixture' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: 'reader', iat: now - 5, exp: now + 600 })).toString('base64url');
    const bearer = 'Bearer ' + signingInput + '.' + signature(pair, algorithm, signingInput);
    try {
    const auth = { algorithms: [algorithm], key: { type: 'jwks', keys: [jwk] }, requiredClaims: ['sub', 'iat', 'exp'] };
    let body = `const identity=await jwt.verify(ctx,jwt.bearer(ctx.req),${JSON.stringify(auth)});`;
    if (mac) body += "const proof=await crypto.verifyMacText(ctx,ctx.req.url,ctx.req.header('x-proof')||'',{algorithm:'HS256',key:{type:'secret',binding:'INGRESS_KEY'}});if(proof.status!=='valid')return ctx.text('proof denied',{status:403});";
    if (schema) body += "const time=ctx.decodeJson<{issued:number}>(ctx.req.header('x-schema')||'{\"issued\":1}','proof.Time');";
    if (kind === 'sha256') body += "const text=await ctx.req.text();const result=await crypto.digestText(ctx,text);";
    if (kind === 'hmac') body += "const result=await jwt.sign(ctx,{sub:'reader'},{algorithm:'HS256',key:{type:'secret',binding:'INGRESS_KEY'},expiresInSeconds:60});";
    if (kind === 's3') body += "const result=await s3.getText(ctx,'objects','key');";
    if (signs) body += `const token=await jwt.sign(ctx,{sub:'reader'},{algorithm:'${algorithm}',key:{type:'secret',binding:'SIGNING_KEY'},kid:'fixture',expiresInSeconds:60});return ctx.json({sub:identity.claims.sub,result,token});`;
    else body += schema ? "return ctx.text(''+time.issued);" : "return ctx.text(identity.claims.sub);";
    fs.writeFileSync(path.join(root, 'app.ts'), `import {Pulse} from '@pulse-compute/pulse';import {jwt} from '@pulse-compute/jwt';import {crypto} from '@pulse-compute/crypto';import {s3} from '@pulse-compute/s3';const app=new Pulse({auto:true});app.${kind === 'sha256' ? 'post' : 'get'}('/',async ctx=>{${body}});app.error(async(error,ctx,next)=>ctx.text('denied',{status:401}));export default app;`);
    fs.rmSync(path.join(root, 'schemas.ts'), { force: true });
    if (schema) fs.writeFileSync(path.join(root, 'schemas.ts'), "import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';export default defineSchemaRegistry({schemas:{'proof.Time':schema<{issued:number}>()}});");
    const algorithms = [algorithm, ...(mac ? ['HS256'] : []), ...(['sha256', 's3'].includes(kind) ? ['SHA-256'] : []), ...(['hmac', 's3'].includes(kind) ? ['HMAC-SHA256'] : [])];
    const config = { pulse: { entry: 'app.ts', defaultProfile: 'node-native', strict: false, crypto: algorithms, ...(schema ? { schema: 'schemas.ts' } : {}) } };
    for (const target of targets) {
      const host = target.split('-')[0];
      const s3 = { endpoint: 'https://objects.example.invalid', bucket: 'jwt-fixture', region: 'us-east-1', accessKeyIdSecret: 'ACCESS', secretAccessKeySecret: 'SECRET', ...(host === 'fastly' ? { backend: 'objects' } : {}) };
      config[target] = { host, target: 'native', outDir: `out/${id}/${target}`, [host]: { bindings: { ...(host === 'fastly' ? { secretStore: 'fixture_secrets' } : {}), ...(kind === 's3' ? { s3: { objects: s3 } } : {}) } } };
    }
    fs.writeFileSync(path.join(root, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
    const sourceDirectory = path.join(output, 'jwt02', id); fs.mkdirSync(sourceDirectory, { recursive: true });
    for (const file of ['app.ts', '.pulse/config.ts', ...(schema ? ['schemas.ts'] : [])]) fs.copyFileSync(path.join(root, file), path.join(sourceDirectory, path.basename(file)));
    for (const target of targets) {
      const project = resolveProject({ cwd: root, profile: target });
      assert.equal(execution.inspectProject(project).provider.selectedTargetDescriptor.automaticFallback, false);
      const native = target === 'node-native' ? execution.compileNativeProjectInMemory(project).native : null;
      const built = execution.buildProject(project); assert.equal(built.status, 'built');
      const artifactFile = path.join(built.outDir, target === 'node-native' ? 'canonical-native.wasm' : 'bin/main.wasm');
      const wasm = fs.readFileSync(artifactFile), directory = path.join(output, 'jwt02', id, target);
      fs.mkdirSync(directory, { recursive: true });
      if (native) assert.deepEqual(native.wasm, wasm, 'normal build and in-memory execution use identical bytes');
      // Every final provider-consumed artifact is inspected, not its pre-link input.
      const audit = inspectWasmFile(artifactFile, { workDirectory: directory, label: 'final' });
      assert.equal(audit.hasStart, false); assert.equal(audit.instructions.memoryGrow, 0);
      assert.deepEqual(audit.memoryTypes, [{ minimumPages: 32, maximumPages: 32, shared: false }]);
      const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(e => e.name);
      assert(exports.includes('__pulse_primary_layout_end'));
      const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
      if (!native) assert(imports.every(i => i.module === 'env' || i.module.startsWith('fastly_') || i.module === 'wasi_snapshot_preview1'));
      if (kind === 'combined') {
        execution.buildProject(project); assert.deepEqual(fs.readFileSync(artifactFile), wasm, 'deterministic repeated ordinary build');
      }
      fs.copyFileSync(artifactFile, path.join(directory, 'final.wasm'));
      fs.copyFileSync(path.join(built.outDir, 'pulse-build.json'), path.join(directory, 'pulse-build.json'));
      const privateValues = [...Object.values(secrets), pair.privateKey.export({ format: 'jwk' }).d, bearer];
      for (const value of privateValues) assert(!wasm.includes(Buffer.from(value)), 'private material in Wasm');
      const cases = [], url = 'https://generic.test/';
      const headers = [['authorization', bearer], ['x-proof', crypto.createHmac('sha256', secrets.INGRESS_KEY).update(url).digest('hex')]];
      async function run(name, { invalidSignature = false, badMac = false, badSchema = false, missingSigningKey = false, cancel, originStatus = 200, text = 'bounded' } = {}) {
        const cancellation = new AbortController();
        if (cancel === 'before') cancellation.abort(new Error('fixture cancellation'));
        const selectedHeaders = headers.map(([k, v]) => [k, k === 'authorization' && invalidSignature ? bearer.slice(0, -12) + 'AAAAAAAAAAAA' : k === 'x-proof' && badMac ? '0'.repeat(64) : v]);
        if (badSchema) selectedHeaders.push(['x-schema', '{"issued":"bad"}']);
        const request = { method: kind === 'sha256' ? 'POST' : 'GET', path: '/', url, headers: selectedHeaders, body: kind === 'sha256' ? text : '' };
        const selectedSecrets = { ...secrets, ...(missingSigningKey ? { SIGNING_KEY: 'malformed' } : {}) };
        let sends = 0;
        const outbound = req => { verifyS3(req, secrets); sends++; if (cancel === 'after-send') cancellation.abort(new Error('fixture cancellation')); };
        const origin = { status: originStatus, headers: [['content-length', '7']], body: 'payload' };
        const invoke = () => native ? executeCanonicalNativeModule(native, driver.executionOptions(project.providerConfig, {
          request, secrets: selectedSecrets, strict: false, signal: cancellation.signal,
          captureJwtWallClock: () => ({ trusted: true, unixEpochSeconds: now }),
          fetchImplementation: async (input, init) => { const req = new Request(input, init); outbound({ method: req.method, url: req.url, headers: req.headers }); return { ...origin, body: new Response('payload').body }; }
        })) : executeFastlyNativePlatformCapabilities({ wasm }, {
          request, secrets: selectedSecrets, secretStore: 'fixture_secrets', allowHandledJwtError: true,
          clockUnixSeconds: now, signal: cancellation.signal, onOutboundRequest: outbound,
          fixtures: { 'GET https://objects.example.invalid/jwt-fixture/key': origin }
        });
        if (cancel) { await assert.rejects(async () => invoke(), /cancel/i); assert.equal(sends, cancel === 'after-send' ? 1 : 0); cases.push({ name, status: 'passed', cancelled: true, sends }); return; }
        const result = await invoke();
        const denied = invalidSignature || badSchema || missingSigningKey;
        assert.equal(result.response.status, denied ? 401 : badMac ? 403 : 200, `${id}/${target}/${name}: ${result.response.body}`);
        if (denied || badMac) assert.equal(result.response.body, badMac && !denied ? 'proof denied' : 'denied');
        else if (!signs) assert.equal(result.response.body, schema ? '1' : 'reader');
        else {
          const response = JSON.parse(result.response.body); assert.equal(response.sub, 'reader'); verifyToken(response.token, pair, algorithm);
          if (kind === 'sha256') assert.deepEqual(response.result, { status: 'ok', sha256: hash(text), byteLength: Buffer.byteLength(text) }, `${id}/${target}/${name}`);
          if (kind === 'hmac') { const [h, p, s] = response.result.split('.'); assert.equal(JSON.parse(Buffer.from(h, 'base64url')).alg, 'HS256'); assert.equal(s, crypto.createHmac('sha256', secrets.INGRESS_KEY).update(h + '.' + p).digest('base64url')); }
          if (kind === 's3') assert.deepEqual(response.result, originStatus === 200 ? { status: 'found', byteLength: 7, text: 'payload', sha256: hash('payload') } : { status: 'failed', reason: 'not-authorized', httpStatus: 403 });
        }
        assert.equal(sends, kind === 's3' && !invalidSignature ? 1 : 0);
        if (native) assert.equal(result.wasmSha256, hash(wasm));
        else {
          const e = result.instance.exports;
          assert.equal(e.memory.buffer.byteLength, 2097152);
          assert(new Uint8Array(e.memory.buffer, 524288, 16640).every(byte => byte === 0), 'signature staging frame cleared');
          assert(e.__pulse_primary_layout_end() <= 524288);
          assert.equal(result.trace.filter(e => e.module === 'fastly_http_resp' && e.name === 'send_downstream').length, 1);
        }
        for (const value of privateValues) assert(!JSON.stringify(result.trace).includes(value), 'private material in default trace');
        cases.push({ name, status: 'passed', httpStatus: result.response.status, sends });
      }
      await run('valid'); await run('invalid-signature', { invalidSignature: true });
      if (mac) await run('invalid-mac', { badMac: true });
      if (schema) await run('invalid-schema', { badSchema: true });
      if (signs) await run('invalid-signing-key', { missingSigningKey: true });
      await run('cancel-before', { cancel: 'before' });
      if (kind === 's3') { await run('origin-rejected', { originStatus: 403 }); await run('cancel-after-send', { cancel: 'after-send' }); }
      if (kind === 'sha256') for (const text of ['', 'abc', '\ufeffé😀\u0000\r\n', 'a'.repeat(4096)]) await run('digest-vector-' + Buffer.byteLength(text), { text });
      await run('healthy-after-failure');
      // Installed bridge evidence on the same composed artifact. These private
      // buffers must clear on both success and injected failure, without growth.
      let cleanup;
      if (native && signs) {
        const controller = instantiateCanonicalNativeModule(native, driver.executionOptions(project.providerConfig, { strict: false }));
        try {
          const e = controller.exports, nativeCrypto = load('@pulse-compute/crypto/pulsewasm-native');
          const bridge = nativeCrypto.bindNativeDigestMac(e);
          assert.deepEqual(Buffer.from(bridge.sha256(Buffer.alloc(2097152, 0x79))), crypto.createHash('sha256').update(Buffer.alloc(2097152, 0x79)).digest());
          const clear = () => assert(new Uint8Array(e.memory.buffer, e.pulse_crypto_bytes_frame_v1(), 73760).every(b => b === 0));
          clear();
          const broken = nativeCrypto.bindNativeDigestMac({ ...e, pulse_crypto_digest_update_v2() { throw Error('injected digest failure'); } });
          assert.throws(() => broken.sha256(Buffer.from('private fixture')), /injected/); clear();
          assert.throws(() => broken.sha256(Buffer.from('retry')), /unavailable/);
          assert.equal(e.memory.buffer.byteLength, 2097152); cleanup = 'owned-frame-zero-success-and-failure';
        } finally { controller.close(); }
      }
      receipt.push({ id, target, status: 'passed', wasmSha256: hash(wasm), bytes: wasm.length,
        audit: { hasStart: audit.hasStart, memoryTypes: audit.memoryTypes, instructions: audit.instructions, imports, exports },
        ...(native ? { layout: native.manifest.finalWasmAudit.layout, runtime: native.manifest.linkedRuntime } : {}),
        deterministicRebuild: kind === 'combined', cleanup, cases });
      fs.writeFileSync(path.join(directory, 'case.json'), JSON.stringify(receipt[receipt.length - 1], null, 2) + '\n');
    }
    } catch (error) {
      let message = error.stack || String(error);
      for (const value of [...Object.values(secrets), pair.privateKey.export({ format: 'jwk' }).d, bearer, bearer.slice(7)]) message = message.replaceAll(value, '<redacted>');
      message = message.replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{40,}/g, '<token>');
      throw new Error(message);
    }
  }
  assert.equal(receipt.length, 20);
  return receipt;
}
module.exports = { qualify };
