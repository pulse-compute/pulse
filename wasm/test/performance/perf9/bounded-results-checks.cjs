'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {loadEvidence,render}=require('./bounded-results.cjs');
assert.equal(process.argv.length,3,'Usage: bounded-results-checks.cjs /extracted/evidence');
const source=path.resolve(process.argv[2]),read=fs.readFileSync;
const evidence=loadEvidence(source),text=render(evidence);
assert(text.includes('**4320**') && text.includes('**unavailable**'));
assert(text.includes('35013') && text.includes('42040'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'perf9-02-replay-checks-'));
try {
  fs.cpSync(source,temp,{recursive:true});
  const manifest=path.join(temp,'manifest.json'),raw=fs.readFileSync(manifest);
  fs.writeFileSync(manifest,Buffer.concat([raw,Buffer.from(' ')]));
  assert.throws(()=>loadEvidence(temp),/manifest hash/);fs.writeFileSync(manifest,raw);
  const relative=evidence.manifest.files.find(f=>f.originalPath===evidence.report.artifacts.rust.file).archivePath;
  const artifact=path.join(temp,relative),bytes=fs.readFileSync(artifact);
  fs.unlinkSync(artifact);
  assert.throws(()=>loadEvidence(temp)); // Must not fall back to the still-present original attempt.
  const altered=Buffer.from(bytes);altered[0]^=255;fs.writeFileSync(artifact,altered);
  assert.throws(()=>loadEvidence(temp),/Archived hash/);
  fs.writeFileSync(artifact,bytes);
  assert.deepEqual(loadEvidence(temp).report,evidence.report);
  assert.equal(fs.readFileSync,read,'Scoped evidence reader must be restored');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
console.log('ok - PERF9-02 replay rejects changed manifests, missing artifacts and altered artifacts; relocation and reader restoration passed');
