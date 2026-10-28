'use strict';
// Investigation-only hook injection into the real JS executor. Exact anchors;
// production file bytes stay unchanged. No independent executor or scheduler.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict');
const file = path.resolve(__dirname, '../../../../../packages/runtime/src/internal/effect-adapter.js');
function bridge(enabled = true) {
  const original = fs.readFileSync(file, 'utf8');
  if (!enabled) return { api: require(file), original, source: original };
  let source = original;
  function replace(a, b) { assert.equal(source.split(a).length - 1, 1, 'one bridge anchor: ' + a); source = source.replace(a, b); }
  replace('      localEffects += 1;', `      try { options.resourceAccounting?.local(); }
      catch (error) { execution.invalidateAdmission(error); throw error; }
      localEffects += 1;`);
  replace('      totalEffects += 1;', `      totalEffects += 1;
      let accountingRoot;
      try { accountingRoot = options.resourceAccounting?.capture(descriptor); }
      catch (error) { execution.invalidateAdmission(error); throw error; }`);
  replace('const root = { started: false, claimed: false, release: undefined };', 'const root = { started: false, claimed: false, release: undefined, accounting: accountingRoot, admitted: false };');
  replace('        root.started = true;', `        if (options.resourceAccounting && !root.admitted) {
          options.resourceAccounting.admit([accountingRoot]); root.admitted = true;
        }
        root.started = true;`);
  replace('const operationExecution = Object.freeze({ ...externalExecution, signal: operationSignal.signal });', 'const operationExecution = Object.freeze({ ...externalExecution, signal: operationSignal.signal, accountingRoot });');
  replace('        } finally { operationSignal.dispose(); }', '        } finally { if (operationSignal.signal.aborted) options.resourceAccounting?.stop(); operationSignal.dispose(); if (root.admitted) options.resourceAccounting?.settle(accountingRoot); }');
  replace('          for (const entry of entries) entry.data.root.release();', '          // Release only after the shared pre-dispatch resource hook below.');
  replace('        } else entries = validateParallelRecord(record, execution, claimedParallelRootIds);', `        } else entries = validateParallelRecord(record, execution, claimedParallelRootIds);
        if (options.resourceAccounting) {
          for (const entry of entries) if (entry.data.root.started || entry.data.root.admitted) {
            throw Object.assign(new Error('Resource cohort contains already-started work'), { code: 'RA03_ADMISSION_BOUNDARY' });
          }
          for (const entry of entries) entry.data.root.claimed = true;
          options.resourceAccounting.admit(entries.map(entry => entry.data.root.accounting));
          for (const entry of entries) entry.data.root.admitted = true;
        }
        if (collection || options.resourceAccounting) for (const entry of entries) entry.data.root.release();`);
  replace("        if (record && Object.values(Object.getOwnPropertyDescriptors(record)).some(field => dataForEffect(field.value)?.kind?.startsWith('output.'))) execution.invalidateAdmission(error);", "        if (options.resourceAccounting || (record && Object.values(Object.getOwnPropertyDescriptors(record)).some(field => dataForEffect(field.value)?.kind?.startsWith('output.')))) execution.invalidateAdmission(error);");
  replace('    invalidateAdmission(error) {', '    invalidateAdmission(error) {\n      options.resourceAccounting?.stop();');
  replace('        ownedResponses.clear();', '        ownedResponses.clear();\n        options.resourceAccounting?.end();');
  const module = new Module(file, require.module); module.filename = file; module.paths = Module._nodeModulePaths(path.dirname(file)); module._compile(source, file);
  return { api: module.exports, original, source };
}
module.exports = { bridge, file };
