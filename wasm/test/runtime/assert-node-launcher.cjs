'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-node01-local-'));
try {
  const manifest = require('../../../release/pulse-release-manifest.json');
  fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), {recursive:true});
  for (const entry of manifest.packages) fs.symlinkSync(path.join(root, entry.dir), path.join(cwd, 'node_modules',entry.name),'dir');
  fs.symlinkSync(path.dirname(require.resolve('typescript/package.json')),path.join(cwd,'node_modules/typescript'),'dir');
  fs.writeFileSync(path.join(cwd,'package.json'), JSON.stringify({private:true,dependencies:Object.fromEntries(['pulse','provider-node','cli'].map(name=>['@pulse-compute/'+name,manifest.releaseVersion]))}));
  fs.copyFileSync(path.join(__dirname,'node01-fixture.cjs'),path.join(cwd,'fixture.cjs'));
  const result=spawnSync(process.execPath,['fixture.cjs'],{cwd,stdio:'inherit',timeout:120000});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error('NODE-01 fixture failed: '+result.status);
} finally { fs.rmSync(cwd,{recursive:true,force:true}); }
