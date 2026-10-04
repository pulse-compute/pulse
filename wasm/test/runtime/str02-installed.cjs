#!/usr/bin/env node
'use strict';
const { installedAcceptanceReport } = require('../support/installed-acceptance-report.cjs');

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');

const root = path.resolve(__dirname, '../../..');
const target = process.argv.includes('--native') ? 'native' : 'javascript';
const selectedProfile = 'node-' + target;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-str02-installed-'));
assert.ok(!temporary.startsWith(root + path.sep), 'installed consumer must be outside the checkout');
const consumer = path.join(temporary, 'consumer');
const pack = path.join(temporary, 'packages');
const reportParent = path.join(root, 'wasm/.test-results');
fs.mkdirSync(reportParent, { recursive: true });
const reportDir = fs.mkdtempSync(path.join(reportParent, 'str02-installed-'));
const reportFile = installedAcceptanceReport(path.join(reportDir, 'str02-installed-acceptance.json'));
const profiles = ['node-javascript', 'node-native', 'fastly-javascript', 'fastly-native'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sensitive = [];
const clean = text => sensitive.reduce((value, secret) => value.replaceAll(secret, '<redacted>'),
  text.replaceAll(temporary, '<acceptance>').replaceAll(root, '<checkout>')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<token>'));
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_audit: 'false', npm_config_fund: 'false',
  npm_config_cache: path.join(temporary, 'npm-cache'), npm_config_fetch_retries: '0' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE', 'npm_config_registry', 'NPM_CONFIG_REGISTRY']) delete env[key];
const report = { version: 'pulse.str02-installed-acceptance.v1', status: 'running',
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  workingDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })),
  acceptanceScriptSha256: hash(fs.readFileSync(__filename)),
  node: process.version, fixture: 'str02-installed-workflow', target, lifecycleScripts: false,
  providerRealityValidated: false, results: [] };

function saveReport() {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportFile + '.tmp', JSON.stringify(report, null, 2) + '\n');
  fs.renameSync(reportFile + '.tmp', reportFile);
}

function run(command, args, { timeout = 120000, onOutput, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', failure;
    const stop = error => {
      failure ||= error;
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
    };
    const timer = setTimeout(() => stop(new Error(`command timed out after ${timeout}ms`)), timeout);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length + stderr.length > 8 * 1024 * 1024) stop(new Error('command output exceeded 8 MiB'));
      if (onOutput) { try { onOutput(stdout); } catch (error) { stop(error); } }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (stdout.length + stderr.length > 8 * 1024 * 1024) stop(new Error('command output exceeded 8 MiB'));
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const record = { command: path.basename(command), args: args.map(clean), code, signal, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
      report.results.push(record); saveReport();
      let diagnostic;
      try { const value=JSON.parse(stdout);diagnostic=JSON.stringify({error:value.error,checks:value.checks?.filter(c=>c.status==='failed'),cases:value.cases?.filter(c=>c.status==='failed'),diagnostics:value.diagnostics}); }
      catch { diagnostic=(stdout+stderr).slice(-6000); }
      if (failure || (!allowFailure && code !== 0) || signal) reject(new Error(`${failure?.message || 'command failed'}: ${JSON.stringify(record)} ${clean(diagnostic)}`));
      else resolve({ stdout, stderr, code });
    });
  });
}

function verifyInstalled(manifest) {
  const digests = [], packages = [];
  for (const name of fs.readdirSync(path.join(consumer, 'node_modules/@pulse-compute')).sort()) {
    const id = '@pulse-compute/' + name;
    const entry = manifest.packages.find(item => item.name === id);
    assert.ok(entry, `unexpected installed Pulse package ${id}`);
    const packageRoot = path.join(consumer, 'node_modules', id);
    assert.ok(fs.realpathSync(packageRoot).startsWith(consumer + path.sep), `workspace link: ${id}`);
    assert.equal(readJson(path.join(packageRoot, 'package.json')).version, entry.version);
    const tarball = path.join(pack, entry.tarball);
    assert.equal(hash(fs.readFileSync(tarball)), entry.sha256);
    for (const [file, bytes] of readTarEntries(tarball)) {
      if (!file.startsWith('package/') || file.endsWith('/')) continue;
      let installed = path.join(packageRoot, file.slice(8));
      if (!fs.existsSync(installed) && path.basename(installed) === '.gitignore') installed = path.join(path.dirname(installed), '.npmignore');
      assert.deepEqual(fs.readFileSync(installed), bytes, `${id}/${file} differs from candidate`);
      digests.push([id + '/' + file.slice(8), hash(bytes)]);
    }
    packages.push({ name: id, version: entry.version, sha256: entry.sha256 });
  }
  for (const name of ['jwt', 'crypto', 's3', 'pulse', 'cli', 'provider-node', 'provider-fastly']) assert.ok(packages.some(entry => entry.name === '@pulse-compute/' + name));
  return { packages, files: digests.length, sha256: hash(JSON.stringify(digests.sort())) };
}

async function main() {
  const http = require('node:http'), { once } = require('node:events');
  let firstByte;
  const origin = http.createServer((request, response) => {
    let bytes = 0; const digest = crypto.createHash('sha256');
    request.on('data', chunk => { bytes += chunk.length; digest.update(chunk); firstByte?.(); });
    request.on('end', () => response.end(JSON.stringify({ bytes, hash: digest.digest('hex') })));
  });
  try {
    saveReport();
    console.log('str02-installed - pack and install exact candidates');
    const packed = packRelease({ repoRoot: root, outDir: pack });
    const version = packed.manifest.packages.find(p => p.name === '@pulse-compute/pulse').version;
    fs.mkdirSync(consumer, { recursive: true });
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({name:'str02-consumer',private:true,type:'module',
      dependencies:Object.fromEntries(['pulse','cli','provider-node','provider-fastly'].map(name=>['@pulse-compute/'+name,version]))}));
    const registry = createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(p => path.join(pack, p.tarball))));
    await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
    try {
      fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
      await run('npm', ['install','--ignore-scripts','--no-audit','--no-fund'], {timeout:180000});
      assert.equal(registry.requests.missing, 0); assert.equal(registry.requests.rejected, 0);
    } finally { await new Promise(resolve => registry.server.close(resolve)); }
    report.installed = verifyInstalled(packed.manifest);
    origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
    const originUrl = `http://127.0.0.1:${origin.address().port}`;
    const source = `import {Pulse} from '@pulse-compute/pulse'; const app=new Pulse({auto:true});
app.get('/health',async ctx=>{return ctx.text('healthy')});
app.post('/forward',async ctx=>{return ctx.fetch('${originUrl}/collect',{method:'POST',body:ctx.req.body()})}); export default app;`;
    for (const name of ['src','.pulse','tests']) fs.mkdirSync(path.join(consumer,name));
    fs.writeFileSync(path.join(consumer,'src/index.ts'),source);
    const config = {pulse:{entry:'src/index.ts',tests:'tests/pulse.harness.ts',defaultProfile:selectedProfile,strict:false}};
    for (const profile of profiles) {
      const [host,target] = profile.split('-');
      config[profile] = {host,target,outDir:'dist-'+profile,
        ...(host==='node' ? {node:{maxDurationMs:30000,bodyForwarding:{maxBytes:67108864}}} : {fastly:{bindings:{backends:{[originUrl]:'origin'}}}}),
        dev:{networkFetch:true}};
    }
    fs.writeFileSync(path.join(consumer,'.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
    fs.writeFileSync(path.join(consumer,'tests/pulse.harness.ts'), 'export default '+JSON.stringify([
      {name:'health',request:{method:'GET',path:'/health'},expect:{status:200,text:'healthy'}},
      {name:'forward',request:{method:'POST',path:'/forward',body:'fixture'},fetches:{[originUrl+'/collect']:{status:200,text:'received'}},expect:{status:200,text:'received'}}
    ]));
    const cli = path.join(consumer,'node_modules/@pulse-compute/cli/bin/pulse.js');
    report.workflows = [];
    for (const command of ['doctor','inspect','test','build']) {
      console.log(`str02-installed - ${command}`);
      const value = JSON.parse((await run(process.execPath,[cli,command,'--profile',selectedProfile,'--json'])).stdout);
      if (command === 'doctor') {
        assert.ok(['passed','warning'].includes(value.status));
        assert.equal(value.summary.failed,0);
        report.doctorWarnings = value.checks.filter(check=>check.status==='warning').map(({id,message})=>({id,message}));
      } else assert.equal(value.status,command==='inspect'?'ok':command==='build'?'built':'passed');
      if (target === 'native' && command === 'test') report.nativeExecutions = value.cases.map(entry=>entry.executionEvidence);
      if (target === 'native' && command === 'build') {
        report.nativeWasmSha256 = hash(fs.readFileSync(value.files.nativeWasm));
        assert.equal(report.nativeWasmSha256,value.native.wasm.sha256);
        assert.ok(report.nativeExecutions.every(entry=>entry.mode==='native-wasm' && entry.automaticFallback===false && entry.wasmSha256===report.nativeWasmSha256));
      }
      report.workflows.push({command,status:value.status,...(value.summary?{summary:value.summary}:{})}); saveReport();
    }
    report.rejections = [];
    for (const profile of profiles.filter(p=>p.startsWith('fastly'))) {
      const result = await run(process.execPath,[cli,'build','--profile',profile,'--json'],{allowFailure:true});
      assert.notEqual(result.code,0,profile);
      assert.match(result.stdout+result.stderr,/fastly-incoming-body-forwarding-unavailable|PULSE_PROVIDER_CAPABILITY_UNSUPPORTED/);
      report.rejections.push(profile);
    }
    const invalidForms = [
      ["const body=ctx.req.body(); return ctx.fetch('http://localhost',{method:'POST',body})", 'PULSE_REQUEST_FORWARDING_FORM_UNSUPPORTED'],
      ["return ctx.fetch('http://localhost',{method:'POST',body:await ctx.req.body()})", 'PULSE_REQUEST_FORWARDING_FORM_UNSUPPORTED'],
      ["return ctx.parallel({one:ctx.fetch('http://localhost',{method:'POST',body:ctx.req.body()}),two:ctx.fetch('http://localhost',{method:'POST',body:ctx.req.body()})})", 'PULSE_REQUEST_FORWARDING_FORM_UNSUPPORTED'],
      ["await ctx.req.text(); return ctx.fetch('http://localhost',{method:'POST',body:ctx.req.body()})", 'PULSE_REQUEST_BODY_OWNERSHIP']
    ];
    for (const [replacement, code] of invalidForms) {
      fs.writeFileSync(path.join(consumer,'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse'; const app=new Pulse({auto:true}); app.post('/',async ctx=>{${replacement}}); export default app;`);
      const result=await run(process.execPath,[cli,'inspect','--profile',selectedProfile,'--json'],{allowFailure:true});
      assert.notEqual(result.code,0);assert.ok((result.stdout+result.stderr).includes(code));
    }
    // Separate routes may read or forward in JavaScript. Native currently
    // requires application-wide lazy admission, so it must fail explicitly.
    fs.writeFileSync(path.join(consumer,'src/index.ts'), source.replace('export default app;', "app.post('/read',async ctx=>{return ctx.text(await ctx.req.text())}); export default app;"));
    const mixed = await run(process.execPath,[cli,'build','--profile',selectedProfile,'--json'],{allowFailure:true});
    if (target === 'native') {
      assert.notEqual(mixed.code,0);
      const failure = JSON.parse(mixed.stdout.trim() || mixed.stderr.trim()).error;
      assert.equal(failure.code, 'PULSE_CANONICAL_NATIVE_PLAN_FAILED');
      const diagnostic = failure.diagnostics.find(item => item.code === 'PULSE_CANONICAL_NATIVE_EXPRESSION_UNSUPPORTED');
      assert.equal(diagnostic?.message, 'Native forwarding/transform applications cannot also project structured request bodies.');
      assert.equal(diagnostic.detail.automaticFallback, false);
    } else assert.equal(mixed.code,0,mixed.stdout+mixed.stderr);
    fs.writeFileSync(path.join(consumer,'src/index.ts'),source);
    delete config[selectedProfile].node.bodyForwarding;
    fs.writeFileSync(path.join(consumer,'.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
    const disabled = await run(process.execPath,[cli,'build','--profile',selectedProfile,'--json'],{allowFailure:true});
    assert.notEqual(disabled.code,0);assert.match(disabled.stdout+disabled.stderr,/node-incoming-body-forwarding-not-configured|PULSE_REQUEST_FORWARDING_UNAVAILABLE/);
    config[selectedProfile].node.bodyForwarding = {maxBytes:67108864};
    fs.writeFileSync(path.join(consumer,'.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
    let sent = false, requestResult;
    console.log('str02-installed - real dev HTTP forwarding, 64 MiB');
    await run(process.execPath,[cli,'dev','--profile',selectedProfile,'--port','0','--no-watch','--once','--json'],{timeout:60000,onOutput(stdout) {
      for(const line of stdout.split('\n')) {
        let event;try{event=JSON.parse(line);}catch{continue;}
        if (event.event === 'request' && target === 'native') report.devExecution = event.executionEvidence;
        if(sent||event.event!=='ready')continue;sent=true;
        requestResult=(async()=>{
          const result=new Promise((resolve,reject)=>{
            const request=http.request(event.url+'/forward',{method:'POST'},response=>{
              let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.once('end',()=>resolve({status:response.statusCode,text}));response.once('error',reject);
            });
            request.once('error',reject);request.setTimeout(10000,()=>request.destroy(new Error('installed upload timeout')));
            const body=Buffer.alloc(16384,173), digest=crypto.createHash('sha256');
            const pump=async()=>{
              const admitted=new Promise(resolve=>{firstByte=resolve;});
              request.write(body);digest.update(body);
              await admitted;report.firstByteBeforeEof=true;
              for(let n=1;n<4096;n++){digest.update(body);if(!request.write(body))await once(request,'drain');}
              request.end();report.expectedHash=digest.digest('hex');
            };
            pump().catch(error=>request.destroy(error));
          });
          return result;
        })();
        requestResult.catch(()=>{});
      }
    }});
    assert.ok(sent);const result=await requestResult;assert.equal(result.status,200,result.text);
    assert.deepEqual(JSON.parse(result.text),{bytes:67108864,hash:report.expectedHash});
    report.dev={status:'passed',bytes:67108864,firstByteBeforeEof:true};
    if (target === 'native') {
      assert.equal(report.devExecution?.mode,'native-wasm');
      assert.equal(report.devExecution.wasmSha256,report.nativeWasmSha256);
      assert.equal(report.devExecution.guestMemoryBytes,report.nativeExecutions[0].guestMemoryBytes);
    }
    assert.deepEqual(verifyInstalled(packed.manifest),report.installed);report.installed.unchanged=true;
    report.status='passed';console.log(`ok - installed STR-02 ${target} workflows and incremental HTTP forwarding`);
  } catch(error) { report.status='failed';report.error=clean(error.stack||String(error));throw error; }
  finally { saveReport();origin.closeAllConnections();await new Promise(resolve=>origin.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});console.log(`acceptance report - ${reportFile}`); }
}
main().catch(error=>{console.error(clean(error.stack||String(error)));process.exitCode=1;});
