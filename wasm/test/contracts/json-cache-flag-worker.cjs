// Run the production option in a fresh process for each JSON_CACHE setting.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const [variant, directory, receipt] = process.argv.slice(2);
const elideJsonCacheArena = variant === 'patched';
const { resolveProject } = require('../../packages/cli/src/project-config');
const { buildProject } = require('../../packages/cli/src/project-execution');
const outDir = path.join(directory, 'artifact');
const project = resolveProject({ cwd: directory, outDir });
const built = buildProject(project, { outDir, elideJsonCacheArena });
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'canonical-native-manifest.json')));
assert.equal(manifest.jsonAs.elideDisabledCacheArena, elideJsonCacheArena);
const report = require('../../packages/cli/src/internal/report/capsule').parseCapsule(fs.readFileSync(path.join(outDir, 'pulse-report-inventory.json')));
assert.equal(report.provenance.recipe.elideJsonCacheArena, elideJsonCacheArena);
assert.equal(report.build.compilers[0].flags.some(f => f.value === 'schema-cache-arena-transform.cjs'), elideJsonCacheArena);
fs.writeFileSync(receipt, JSON.stringify({ outDir, artifactSha256: built.manifest.portable.wasm.sha256 }));
