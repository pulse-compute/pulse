'use strict';
const fs = require('node:fs');
const path = require('node:path');

function write(root, name, content) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function setup(root, variant = 'full', localPackage = false) {
  let source = fs.readFileSync(path.join(__dirname, '../fixtures/projects/report-analytics/index.ts'), 'utf8');
  // Keep line/offset coordinates when isolating the existing error+event failure.
  const omit = (start, end) => {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    if (from < 0 || to < 0) throw new Error('Fixture boundary missing');
    source = source.slice(0, from) + source.slice(from, to).replace(/[^\n]/g, ' ') + source.slice(to);
  };
  if (variant === 'http') omit("app.on('analytics.tick'", 'export default app;');
  else if (variant === 'event') omit("app.get('/error'", "app.on('analytics.tick'");
  else if (variant !== 'full') throw new Error('Unknown fixture variant');
  if (localPackage) {
    source = source.replace("'@fixture/analytics'", "'./analytics'");
    write(root, 'src/analytics.ts', fs.readFileSync(path.join(__dirname, '../fixtures/projects/report-analytics/package.ts')));
  }
  write(root, 'src/index.ts', source);
  write(root, 'node_modules/@fixture/analytics/index.ts', fs.readFileSync(path.join(__dirname, '../fixtures/projects/report-analytics/package.ts')));
  write(root, 'node_modules/@fixture/analytics/package.json', JSON.stringify({
    name: '@fixture/analytics', version: '1.0.0', type: 'module', exports: { '.': './index.ts' }
  }));
  write(root, '.pulse/config.ts', `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig(scope => ({
  pulse: { entry: 'src/index.ts', strict: false, defaultProfile: 'native' },
  native: { host: 'node', target: 'native', outDir: 'dist',
    root: scope.config('ROOT'), scoped: scope.config('SCOPED'),
    region: scope.config('REGION'), other: scope.config('OTHER'),
    packageValue: scope.config('PACKAGE'), recovery: scope.config('RECOVERY'),
    eventValue: scope.config('EVENT'), helperToken: scope.secret('HELPER_TOKEN') }
}));`);
}
module.exports = { setup };
