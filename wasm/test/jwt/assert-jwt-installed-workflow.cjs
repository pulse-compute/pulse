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
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-jwt-installed-'));
assert.ok(!temporary.startsWith(root + path.sep), 'installed consumer must be outside the checkout');
const consumer = path.join(temporary, 'consumer');
const pack = path.join(temporary, 'packages');
const reportParent = path.join(root, 'wasm/.test-results');
fs.mkdirSync(reportParent, { recursive: true });
const reportDir = fs.mkdtempSync(path.join(reportParent, 'jwt-installed-'));
const reportFile = installedAcceptanceReport(path.join(reportDir, 'jwt-installed-acceptance.json'));
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
const report = { version: 'pulse.jwt-installed-acceptance.v1', status: 'running',
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  workingDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })),
  acceptanceScriptSha256: hash(fs.readFileSync(__filename)),
  node: process.version, fixture: 'jwt-installed-workflow', lifecycleScripts: false,
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

const { fixture } = require('./installed-fixture.cjs');

async function main() {
  try {
    saveReport();
    console.log('jwt-installed - pack and install exact candidates outside checkout');
    const packed = packRelease({repoRoot:root,outDir:pack});
    fs.mkdirSync(path.join(consumer,'src'),{recursive:true});
    fs.mkdirSync(path.join(consumer,'.pulse')); fs.mkdirSync(path.join(consumer,'tests'));
    const version = packed.manifest.packages.find(p=>p.name==='@pulse-compute/jwt').version;
    fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'jwt-installed-fixture',private:true,type:'module',
      dependencies:Object.fromEntries(['pulse','jwt','crypto','s3','cli','provider-node','provider-fastly'].map(name=>['@pulse-compute/'+name,version]))}));
    const registry = createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(p=>path.join(pack,p.tarball))));
    await new Promise((resolve,reject)=>{registry.server.once('error',reject);registry.server.listen(0,'127.0.0.1',resolve);});
    try {
      fs.writeFileSync(path.join(consumer,'.npmrc'),`registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
      await run('npm',['install','--ignore-scripts','--no-audit','--no-fund'],{timeout:180000});
      assert.equal(registry.requests.missing,0); assert.equal(registry.requests.rejected,0); report.registry=registry.requests;
    } finally { await new Promise(resolve=>registry.server.close(resolve)); }
    report.installed=verifyInstalled(packed.manifest);
    const cli=path.join(consumer,'node_modules/@pulse-compute/cli/bin/pulse.js');
    const pulse=async args=>JSON.parse((await run(process.execPath,[cli,...args,'--json'])).stdout);
    const config={pulse:{entry:'src/index.ts',tests:'tests/pulse.harness.ts',defaultProfile:'node-javascript',strict:false}};
    const s3={endpoint:'https://objects.example.invalid',bucket:'jwt-fixture',region:'us-east-1',accessKeyIdSecret:'ACCESS',secretAccessKeySecret:'SECRET'};
    for(const profile of profiles) {
      const [host,target]=profile.split('-');
      const bindings={...(host==='fastly'?{secretStore:'app_secrets'}:{}),s3:{objects:{...s3,...(host==='fastly'?{backend:'objects'}:{})}}};
      config[profile]={host,target,outDir:'dist-'+profile,dev:{networkFetch:false},[host]:{bindings}};
    }
    const write=(source,algorithms,rows=[])=>{
      config.pulse.crypto=algorithms;
      fs.writeFileSync(path.join(consumer,'src/index.ts'),source);
      fs.writeFileSync(path.join(consumer,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
      fs.writeFileSync(path.join(consumer,'tests/pulse.harness.ts'),'export default '+JSON.stringify(rows));
    };
    const fixtures=['HS256','ES256','RS256'].map(fixture);
    for(const f of fixtures) sensitive.push(...Object.values(f.secrets),...f.pairs.map(p=>f.algorithm==='HS256'?p.secret:JSON.parse(p.secret).d));
    report.fixtures=Object.fromEntries(['installed-fixture.cjs','installed-cleanup.mjs'].map(file=>[file,hash(fs.readFileSync(path.join(__dirname,file)))]));
    // Exercise provider integration from installed exports, with no checkout paths.
    fs.copyFileSync(path.join(__dirname,'installed-cleanup.mjs'),path.join(consumer,'cleanup.mjs'));
    fs.writeFileSync(path.join(consumer,'cleanup-fixtures.json'),JSON.stringify(fixtures.map(f=>({algorithm:f.algorithm,options:f.options(1),secret:f.secrets.NEW_KEY,publicKey:f.pairs[1].public}))));
    report.cleanup=JSON.parse((await run(process.execPath,['cleanup.mjs'])).stdout);
    assert.equal(report.cleanup.status,'passed');
    report.composition=[];
    const es=fixtures[1], rs=fixtures[2];
    const signOnly=f=>f.source.split('\n').filter(line=>line.startsWith('import ')||line.startsWith('const app')||line.startsWith("app.get('/sign-new'")||line.startsWith('export default')).join('\n');
    const variants=[
      ['signature + SHA-256',signOnly(es)+"\nimport {crypto} from '@pulse-compute/crypto'; app.get('/digest',async ctx=>{const result=await crypto.digestText(ctx,'bounded');return ctx.json(result);});",['ES256','SHA-256']],
      ['signature + HMAC',signOnly(es)+"\napp.get('/hmac',async ctx=>{const token=await jwt.sign(ctx,{sub:'worker'},{algorithm:'HS256',key:{type:'secret',binding:'HMAC_KEY'},expiresInSeconds:60});return ctx.text(token);});",['ES256','HMAC-SHA256']],
      ['signature + S3',signOnly(es)+"\nimport {s3} from '@pulse-compute/s3'; app.get('/object',async ctx=>{const result=await s3.getText(ctx,'objects','key');return ctx.json(result);});",['ES256','SHA-256','HMAC-SHA256']],
      ['ES256 + RS256 signing',signOnly(es)+"\n"+signOnly(rs).split('\n').filter(line=>line.startsWith('app.')).join('\n').replace('/sign-new','/sign-rs'),['ES256','RS256']],
      ['ES256 + RS256 verification',es.source+"\n"+rs.source.split('\n').filter(line=>line.startsWith("app.get('/overlap'")).join('\n').replace('/overlap','/rsa'),['ES256','RS256']]
    ];
    for(const [name,source,algorithms] of variants) {
      write(source,algorithms);
      for(const profile of profiles) {
        console.log(`jwt-installed - inventory: ${name}, ${profile}`);
        const s3Restriction=profile==='fastly-javascript'&&name.endsWith('S3');
        const expectedFailure=s3Restriction||profile.endsWith('native')&&(name.includes('SHA-256')||name.includes('HMAC')||name.includes('S3'))
          ||profile==='fastly-native'&&name.endsWith('verification');
        const result=await run(process.execPath,[cli,'build','--profile',profile,'--json'],{allowFailure:true});
        const diagnostics=result.stdout+result.stderr;
        assert.equal(result.code!==0,expectedFailure,`${name}: ${profile}: ${clean(diagnostics)}`);
        if(expectedFailure) assert.match(diagnostics,s3Restriction?/fastly-javascript-s3-raw-headers-unavailable/:name.endsWith('verification')?/PULSE_FASTLY_NATIVE_JWT_CRYPTO_REALIZATION_INVALID/:/forbidden start|fixed-memory|MVP/);
        else assert.equal(JSON.parse(result.stdout).status,'built');
        report.composition.push({name,profile,status:expectedFailure?'ineligible':'built',
          diagnosticCodes:expectedFailure?[...new Set(diagnostics.match(/PULSE[A-Z0-9_]+/g)||[])]:[]});saveReport();
      }
    }
    report.cells=[];
    for(const f of fixtures) {
      write(f.source,f.crypto,f.rows);
      for(const profile of profiles) {
        console.log(`jwt-installed - ${f.algorithm} ${profile}: doctor/inspect/test/build/dev`);
        assert.equal((await pulse(['doctor','--profile',profile])).status,'passed');
        assert.equal((await pulse(['inspect','--profile',profile])).status,'ok');
        const tests=await pulse(['test','--profile',profile]);
        assert.equal(tests.status,'passed',JSON.stringify(tests.cases.filter(c=>c.status!=='passed')));
        assert.equal(tests.summary.passed,f.rows.length);
        const built=await pulse(['build','--profile',profile]); assert.equal(built.status,'built');
        const out=path.join(consumer,'dist-'+profile), manifest=readJson(path.join(out,'pulse-build.json'));
        const cell={algorithm:f.algorithm,profile,cases:tests.summary,buildMode:manifest.buildMode};
        if(profile.endsWith('native')) {
          const wasm=fs.readFileSync(path.join(out,profile.startsWith('node')?'canonical-native.wasm':'bin/main.wasm'));
          cell.wasmSha256=hash(wasm);
          for(const c of tests.cases.filter(c=>c.executionEvidence)) assert.equal(c.executionEvidence.wasmSha256,cell.wasmSha256);
          assert.ok(tests.cases.some(c=>c.executionEvidence),'Native cases must record exact Wasm evidence');
        }
        for(const file of fs.readdirSync(out,{recursive:true})) {
          const p=path.join(out,file); if(!fs.statSync(p).isFile()) continue;
          const bytes=fs.readFileSync(p);
          for(const key of f.pairs) assert.equal(bytes.includes(Buffer.from(f.algorithm==='HS256'?key.secret:JSON.parse(key.secret).d)),false,'private signing material in build');
        }
        let sent=false, response;
        // Dev credentials exist only for this local process, after the build
        // scan, and are removed before the next build/inspection.
        config[profile].dev.secrets=f.secrets;write(f.source,f.crypto,f.rows);
        await run(process.execPath,[cli,'dev','--profile',profile,'--port','0','--no-watch','--once','--json'],{timeout:60000,onOutput(stdout){
          for(const line of stdout.split('\n')) {
            let event;try{event=JSON.parse(line);}catch{continue;}
            if(sent||event.event!=='ready')continue; sent=true;
            response=fetch(event.url+'/sign-new',{
              signal:AbortSignal.timeout(10000)})
              .then(async r=>({status:r.status,text:await r.text()})).catch(()=>({status:0}));
          }
        }});
        assert.ok(sent);const issued=await response;assert.equal(issued.status,200);assert.ok(f.validate(issued.text),'independent verification of dev-issued signature');
        delete config[profile].dev.secrets;write(f.source,f.crypto,f.rows);
        cell.devExit=0;report.cells.push(cell);saveReport();
      }
    }
    assert.deepEqual(verifyInstalled(packed.manifest),report.installed);report.installed.unchanged=true;
    report.status='passed';console.log('ok - installed JWT workflows, rotation, cleanup and explicit composition restrictions');
  } catch(error) {report.status='failed';report.error=clean(error.stack||String(error));throw error;}
  finally {saveReport();fs.rmSync(temporary,{recursive:true,force:true});console.log(`acceptance report - ${reportFile}`);}
}
main().catch(error=>{console.error(clean(error.stack||String(error)));process.exitCode=1;});
