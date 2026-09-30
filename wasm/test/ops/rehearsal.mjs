import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { probe } from './ops-probe.mjs';
const require = createRequire(import.meta.url);
const { fixture } = require('./authorization-fixture.cjs');
const { exercise } = require('./ops/exercise.cjs');
const [directory, output] = process.argv.slice(2);
const revision = name => ({root:path.join(directory,name),manifest:JSON.parse(fs.readFileSync(path.join(directory,name+'.json')))});
const baseline=revision('baseline-rehearsal'), candidate=revision('candidate');
const save = report => {
  fs.writeFileSync(output + '.tmp', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(output + '.tmp', output);
};
// The controlled directory is deliberately outside the hosts being restarted.
// Its bounded in-memory proposals survive host rollback, not a directory restart.
const service = {resources:[{id:'pulse',title:'Pulse',url:'https://pulsecompute.io'}], proposals:[]};
const origin = http.createServer(async(req,res)=> {
  let body=''; for await(const chunk of req){body+=chunk; if(body.length>65536){res.writeHead(413);res.end();return;}}
  const input=JSON.parse(body); let value;
  if(req.url==='/search') value={resources:service.resources};
  else if(req.url==='/retrieve') value={found:true,resource:service.resources[0]};
  else {service.proposals.push(input);value={accepted:true,proposalId:'ops-'+service.proposals.length};}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
});
await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
let active, backend, hello, auth;
async function stop(){ await auth?.close();auth=null; await backend?.close();backend=null;await hello?.close();hello=null; }
const driver={
  mode:'local-rehearsal',
  async activate({revision}){
    await stop();
    const req=createRequire(path.join(revision.root,'package.json'));
    const {createNodeLauncher}=req('@pulse-compute/provider-node/server');
    backend=createNodeLauncher({target:'javascript',buildDir:path.join(revision.root,'mcp'),port:0,networkFetch:true,
      config:{DIRECTORY_ORIGIN:'http://127.0.0.1:'+origin.address().port},maxDurationMs:3000});
    hello=createNodeLauncher({target:'native',buildDir:path.join(revision.root,'hello'),port:0,maxDurationMs:3000});
    const b=await backend.start();await hello.start();
    const {createDirectoryHandler}=req('./mcp-server.cjs');
    auth=await fixture({backendEndpoint:'http://127.0.0.1:'+b.address.port,
      adapter:options=>createDirectoryHandler({endpoint:options.tools.endpoint,backendBearerToken:options.tools.backendBearerToken,
        authorization:{...options.authorization,scopes:['mcp:access']}},path.join(revision.root,'mcp'))});
    active={revision,instanceId:'local-'+randomUUID()};
  },
  async inspect({nonce}){
    assert.equal(backend.status().state,'ready');assert.equal(hello.status().state,'ready');
    return {instanceId:active.instanceId,artifactSha256:active.revision.manifest.sha256,nonce};
  },
  async readActiveFile(name){
    if(name===null)return require('./ops/artifacts.cjs').inventory(active.revision.root).files.map(f=>f.path);
    return fs.readFileSync(path.join(active.revision.root,name));
  },
  async connection(){return {mcpUrl:auth.resource,helloUrl:'http://127.0.0.1:'+hello.status().address.port,
    readerToken:auth.issue({scope:'mcp:access directory:read'}),writerToken:auth.issue({scope:'mcp:access directory:read directory:propose'}),loopback:true};}
};
let report;
try {
  report=await exercise({baseline,candidate,driver,probe,timeoutMs:60000,save});
  assert.equal(report.status,'passed');assert.equal(report.deployed,false);
  assert.equal(service.proposals.length,3,'Exactly one authorized proposal per revision');
  assert.equal(new Set(report.stages.map(s=>s.instanceId)).size,3,'Each activation uses a fresh host generation');
  console.log('ok - exact installed Node JavaScript MCP and Native consumer upgrade/rollback rehearsal');
} catch (error) {
  if (report) report.status = 'failed';
  throw error;
} finally {
  try { await stop(); origin.closeAllConnections(); await new Promise(resolve=>origin.close(resolve)); }
  catch (error) { if (report) report.status = 'failed'; throw error; }
  finally { if (report) save(report); }
}
