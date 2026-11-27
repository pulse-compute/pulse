const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{promisify}=require('node:util');
const repo=process.cwd(),root='/tmp/rc-h04-live/consumer',pack='/tmp/rc-h04-live/terminal-ci/bundle/packages';
const {catalogFromTarballs,createReadOnlyRegistry}=require(repo+'/wasm/test/release/read-only-npm-registry.cjs');
const {verifyClosure}=require(repo+'/wasm/test/release/assert-request-deadline-packages.cjs');
(async()=>{fs.mkdirSync(root);const tarballs=fs.readdirSync(pack).filter(f=>f.endsWith('.tgz')).map(f=>path.join(pack,f));const reg=createReadOnlyRegistry(catalogFromTarballs(tarballs));await new Promise(r=>reg.server.listen(0,'127.0.0.1',r));try{
fs.writeFileSync(root+'/package.json',JSON.stringify({name:'rc-h04-live-consumer',private:true}));fs.writeFileSync(root+'/.npmrc',`registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${reg.server.address().port}/\nreplace-registry-host=never\n`);
await promisify(cp.execFile)('npm',['install','--ignore-scripts','--no-audit','--no-fund',...tarballs],{cwd:root,env:{...process.env,NODE_PATH:'',NODE_OPTIONS:''},timeout:300000,maxBuffer:4e6});const manifest=JSON.parse(fs.readFileSync(pack+'/pulse-release-manifest.json'));verifyClosure(root,pack,manifest);console.log('Installed and verified '+manifest.packages.length+' exact candidate packages');
}finally{await new Promise(r=>reg.server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
