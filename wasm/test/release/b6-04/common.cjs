'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding:'utf8', timeout:300000, maxBuffer:16*1024*1024, ...options});
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout;
}
function identity(cwd = root) {
  const git = args => run('git',args,{cwd}).trim();
  return {revision:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),workingTree:git(['status','--porcelain']),diffSha256:hash(run('git',['diff','HEAD'],{cwd}))};
}
function snapshot(directory) {
  const rows = [];
  function visit(dir) {
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const file=path.join(dir,entry.name);
      assert.ok(!entry.isSymbolicLink(),`unexpected symlink: ${file}`);
      if(entry.isDirectory()) visit(file); else rows.push([path.relative(directory,file),hash(fs.readFileSync(file))]);
    }
  }
  visit(directory);return rows;
}
module.exports={root,hash,json,write,run,identity,snapshot};
