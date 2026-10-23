'use strict';

// Opt-in diagnostic preload for the two report lifecycle tests only. It observes
// existing comparisons in memory; the product sources and acceptance rules stay
// unchanged. Output belongs outside project inputs and is written at process exit.
const path = require('node:path');
const target = path.basename(process.argv[1] || '');
if (['assert-report-retained-evidence.cjs', 'assert-report-handler-topology.cjs'].includes(target)) {
  const fs = require('node:fs'), crypto = require('node:crypto'), Module = require('node:module');
  const root = path.resolve(__dirname, '../../..');
  const output = process.env.HEX_REPORT_IDENTITY_TRACE;
  if (!output || !path.isAbsolute(output) || output === root || output.startsWith(root + path.sep)) {
    throw Error('HEX_REPORT_IDENTITY_TRACE must name an absolute output prefix outside the checkout');
  }
  const events = [], snapshots = new WeakMap(), loaded = [];
  let dropped = 0;
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const relative = file => file.startsWith(root + path.sep) ? path.relative(root, file) : file;
  function note(kind, data) {
    if (events.length === 2000) { dropped++; return; }
    events.push({ sequence: events.length, kind, ...data });
  }
  const trace = {
    snapshot(directory, snapshot) { snapshots.set(snapshot, relative(directory)); return snapshot; },
    difference(first, second, kind) {
      const a = new Map(first.records.map(row => [row.file, row]));
      const b = new Map(second.records.map(row => [row.file, row]));
      const file = [...new Set([...a.keys(), ...b.keys()])].find(file => kind === 'content'
        ? JSON.stringify(a.get(file)) !== JSON.stringify(b.get(file))
        : first.tokens.get(file) !== second.tokens.get(file));
      note('snapshot-' + kind, { root: snapshots.get(first) || snapshots.get(second) || null, file,
        before: a.get(file) || null, after: b.get(file) || null,
        beforeStamp: first.tokens.get(file) || null, afterStamp: second.tokens.get(file) || null });
    },
    record(kind, expected, actual) { note(kind, { expected, actual }); },
    lease(kind, file, token, read, parsed) {
      const row = { file: relative(file), expectedTokenHash: hash(token) };
      if (read) Object.assign(row, { readHash: read.sha256, readStamp: read.token,
        actualTokenHash: hash(String(parsed)), matches: parsed === token });
      // A second read is diagnostic only. The original read still decides the
      // original guard; a subsequent matching read never repairs a mismatch.
      if (read && parsed !== token) {
        try {
          const bytes = fs.readFileSync(file), stat = fs.statSync(file, { bigint: true });
          row.directHash = hash(bytes); row.directTokenHash = hash(String(JSON.parse(bytes).token));
          row.directStamp = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
        } catch (error) { row.directError = error.code || error.name; }
        row.stack = new Error().stack.split('\n').slice(2, 7).map(line => line.replaceAll(root + path.sep, ''));
      }
      note('lease-' + kind, row);
    }
  };
  globalThis.__hexReportIdentityTrace = trace;
  const hook = 'globalThis.__hexReportIdentityTrace';
  const edits = new Map([
    ['retained.js', [
      ["atomicWrite(project.root, relative, Buffer.from(JSON.stringify({ token })));", `atomicWrite(project.root, relative, Buffer.from(JSON.stringify({ token }))); ${hook}.lease('acquired', file, token);`],
      ["try { if (parseJson(readFile(project.root, relative, 4096).bytes).token === token)", `try { const read = readFile(project.root, relative, 4096), parsed = parseJson(read.bytes).token; ${hook}.lease('release', file, token, read, parsed); if (parsed === token)`],
      ["release.verify = () => ensure(parseJson(readFile(project.root, relative, 4096).bytes).token === token, 'REPORT_CONCURRENT_BUILD');", `release.verify = () => { const read = readFile(project.root, relative, 4096), parsed = parseJson(read.bytes).token; ${hook}.lease('verify', file, token, read, parsed); ensure(parsed === token, 'REPORT_CONCURRENT_BUILD'); };`],
      ["ensure(read.size === reference.bytes && read.sha256 === reference.sha256 && WebAssembly.validate(read.bytes), 'REPORT_ARTIFACT_HASH');", `if (read.size !== reference.bytes || read.sha256 !== reference.sha256 || !WebAssembly.validate(read.bytes)) ${hook}.record('artifact', reference, { bytes: read.size, sha256: read.sha256, valid: WebAssembly.validate(read.bytes) }); ensure(read.size === reference.bytes && read.sha256 === reference.sha256 && WebAssembly.validate(read.bytes), 'REPORT_ARTIFACT_HASH');`]
    ]],
    ['snapshot.js', [
      ['return { records, tokens };', `return ${hook}.snapshot(root, { records, tokens });`],
      ["if (canonicalJson(first.records) !== canonicalJson(second.records)) fail('REPORT_STALE_INPUTS');", `if (canonicalJson(first.records) !== canonicalJson(second.records)) { ${hook}.difference(first, second, 'content'); fail('REPORT_STALE_INPUTS'); }`],
      ["if (second.tokens.get(file) !== token) fail('REPORT_CONCURRENT_CHANGE');", `if (second.tokens.get(file) !== token) { ${hook}.difference(first, second, 'stamp'); fail('REPORT_CONCURRENT_CHANGE'); }`],
      ["if (!row || row.sha256 !== module.contentHash) fail('REPORT_STALE_INPUTS');", `if (!row || row.sha256 !== module.contentHash) { ${hook}.record('module', { file: module.path, sha256: module.contentHash }, row || null); fail('REPORT_STALE_INPUTS'); }`]
    ]],
    ['source-inputs.js', [
      ["ensure(read.size === row.bytes && read.sha256 === row.sha256, 'REPORT_STALE_INPUTS');", `if (read.size !== row.bytes || read.sha256 !== row.sha256) ${hook}.record('import', row, { bytes: read.size, sha256: read.sha256 }); ensure(read.size === row.bytes && read.sha256 === row.sha256, 'REPORT_STALE_INPUTS');`]
    ]]
  ]);
  const load = Module._extensions['.js'];
  Module._extensions['.js'] = function(module, file) {
    const name = path.basename(file), changes = edits.get(name);
    if (path.dirname(file) !== path.join(root, 'wasm/packages/cli/src/internal/report') || !changes) return load(module, file);
    let source = fs.readFileSync(file, 'utf8');
    loaded.push({ file: relative(file), sha256: hash(source) });
    for (const [from, to] of changes) {
      if (source.split(from).length !== 2) throw Error('Trace point changed or ambiguous: ' + name + ': ' + from);
      source = source.replace(from, to);
    }
    module._compile(source, file);
  };
  process.on('exit', code => {
    fs.writeFileSync(output + '.' + target + '.' + process.pid + '.json', JSON.stringify({
      diagnosticVersion: 1, target, node: process.version, code, loaded, dropped, events
    }, null, 2) + '\n');
  });
}
