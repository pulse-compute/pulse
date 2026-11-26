'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root='/tmp/rc-h05',accepted=path.resolve(process.argv[2]),repo=process.cwd();
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const q=read(accepted+'/qualification.json'),seal=read(accepted+'/release-seal.json');
const binding=read(root+'/evidence/provider-binding.json');
assert.equal(q.status,'passed');assert.deepEqual(q.candidate,binding.candidate);
assert.equal(q.base,'dbad9e9b553d87999ae35a68c2f94335c99b3acc');
assert.equal(q.head,'77ea6e193a2b5e7d4c749fdc3c988cf34a5a63c7');
require(repo+'/scripts/release-pr-qualification.cjs').assertSeal(seal,q);
assert.equal(hash(accepted+'/release-seal.json'),q.sealSha256);
assert.equal(hash(accepted+'/source-checks.json'),q.sourceChecksSha256);
assert.equal(hash(accepted+'/publication/pulse-publication-manifest.json'),q.bundleManifestSha256);
const verified=require(repo+'/scripts/release-publication.cjs').verifyPublicationBundle({repoRoot:repo,bundleDir:accepted+'/publication'});
const manifest=read(accepted+'/publication/pulse-publication-manifest.json');
assert.equal(manifest.packages.length,binding.packages.length);
for(const p of manifest.packages){
 const expected=binding.packages.find(x=>x.name===p.name);assert(expected);assert.equal(p.version,expected.version);assert.equal(p.sha256,expected.sha256);assert.equal(hash(accepted+'/publication/'+p.tarball),expected.sha256);
}
const result={schemaVersion:'pulse.rc-h05-seal-binding.v1',status:'passed',candidate:q.candidate,qualification:q,acceptedManifestSha256:q.bundleManifestSha256,packagesCompared:manifest.packages.length,allPackageHashesMatchLocalProof:true,sealStatus:seal.status,cleanup:seal.cleanup,externalFastly:seal.externalFastly,featureAcceptance:seal.featureAcceptance,providerBindingReview:'pending-human-release-review'};
fs.writeFileSync(root+'/evidence/seal-binding.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,packagesCompared:result.packagesCompared,candidate:result.candidate}));
