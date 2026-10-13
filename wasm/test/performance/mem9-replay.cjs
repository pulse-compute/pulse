'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {validate}=require('./mem9.cjs');
const pin=require('../../../docs/internal/mem9-01/evidence.json');
const hash=b=>createHash('sha256').update(b).digest('hex');
function replay(directory){
  const root=fs.realpathSync(directory);
  const file=relative=>{
    assert(typeof relative==='string'&&!path.isAbsolute(relative)&&!relative.split(/[\\/]/).includes('..'));
    const p=fs.realpathSync(path.join(root,relative));assert(p.startsWith(root+path.sep)&&fs.statSync(p).isFile());return p;
  };
  const raw=fs.readFileSync(file('manifest.json'));assert.equal(hash(raw),pin.manifestSha256,'Manifest drift');
  const m=JSON.parse(raw);assert.equal(m.schemaVersion,'pulse.mem9-01-bundle.v1');assert.deepEqual(m.source,pin.source);
  assert.equal(m.files.length,pin.files);assert.equal(new Set(m.files.map(f=>f.file)).size,m.files.length);
  for(const f of m.files){const b=fs.readFileSync(file(f.file));assert.equal(b.length,f.bytes);assert.equal(hash(b),f.sha256,'Artifact drift: '+f.file);}
  const reportFile=file(pin.report),b=fs.readFileSync(reportFile);assert.equal(hash(b),pin.reportSha256);
  const r=JSON.parse(b);assert.deepEqual(r.source,pin.source);r.directory=path.dirname(reportFile);validate(r);
  return r;
}
if(require.main===module){try{assert.equal(process.argv.length,3,'Usage: mem9-replay.cjs /extracted/bundle');const r=replay(process.argv[2]);console.log('ok - MEM9-01 frozen bundle: '+pin.files+' files; '+r.workers.reduce((n,w)=>n+w.rows.length,0)+' cases; source/artifact/response/ownership evidence verified');}catch(e){console.error(e);process.exitCode=1;}}
module.exports={replay};
