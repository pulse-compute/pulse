import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { probe } from './ops-probe.mjs';
const require = createRequire(import.meta.url);
const { exercise } = require('./ops/exercise.cjs');

// The driver is reviewed operator code, outside the candidate archives. There
// is no credential discovery, provider CLI discovery or implicit live mode.
const [flag, driverFile, reportFile] = process.argv.slice(2);
if (flag !== '--live-driver' || !driverFile || !reportFile || process.argv.length !== 5) {
  throw new Error('Usage: node ops-run.mjs --live-driver <reviewed-driver.mjs> <new-report.json>');
}
if (fs.existsSync(reportFile)) throw new Error('Refusing to overwrite an earlier operational report');
let driver, report;
function save(value) {
  fs.writeFileSync(reportFile + '.tmp', JSON.stringify(value, null, 2) + '\n', {mode:0o600});
  fs.renameSync(reportFile + '.tmp', reportFile);
}
try {
  const config = await (await import(pathToFileURL(path.resolve(driverFile)))).createExercise();
  driver = config.driver;
  if (driver.mode !== 'deployed') throw new Error('Live runner requires an explicitly deployed driver');
  report = await exercise({ ...config, probe: (connection, options) => {
    if (connection.loopback) throw new Error('Live loopback is forbidden');
    return probe(connection, options);
  }, save });
  if (report.status !== 'passed') process.exitCode = 1;
} catch {
  console.error('OPS01_RUN_FAILED: inspect protected operator logs.'); process.exitCode = 1;
} finally {
  let timer;
  try {
    await Promise.race([driver?.close?.(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Cleanup deadline')), 5000);
    })]);
  } catch {
    process.exitCode = 1;
    console.error('OPS01_CLEANUP_FAILED: inspect protected operator logs.');
    if (report) {
      report.status = report.deployedSmokeStatus = 'failed';
      report.findings.push({ owner: 'deployment-operator', disposition: 'investigate', code: 'OPS01_CLEANUP_FAILED' });
    }
  } finally { clearTimeout(timer); }
  if (report) {
    save(report);
    console.log(JSON.stringify({status:report.status,reportFile}));
  }
}
