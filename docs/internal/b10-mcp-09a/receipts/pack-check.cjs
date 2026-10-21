const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const sources = require(path.join(root, 'scripts/release-source-checks.cjs'));
const owner = require(path.join(root, 'scripts/release-context-freshness.cjs'));
const file = '/tmp/pulse-09a-validation/source-checks.json';
const checked = sources.check(root, file);
const packed = require(path.join(root, 'scripts/pack-release.cjs')).packRelease({ repoRoot: root,
  outDir: '/tmp/pulse-09a-validation/packages', sourceChecks: { file, sha256: owner.hash(fs.readFileSync(file)) } });
owner.validatePack(checked.contextFreshness, packed.manifest);
fs.writeFileSync('/tmp/pulse-09a-validation/pack-check.json', JSON.stringify({status:'passed',
  candidate: checked.candidate, sourceChecksSha256: owner.hash(fs.readFileSync(file)),
  manifestSha256: owner.hash(fs.readFileSync(path.join(packed.outDir, 'pulse-release-manifest.json'))),
  packageCount: packed.manifest.packageCount, contextFiles: packed.manifest.context.files.length,
  contextReconstruction: checked.contextFreshness.reconstruction, workingTree: require(path.join(root,'scripts/release-feature-acceptance.cjs')).candidateIdentity(root).workingTree },null,2)+'\n');
