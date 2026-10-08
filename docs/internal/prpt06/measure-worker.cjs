'use strict';
// Run one installed CLI command in a fresh process. Only project mode may load
// the static config parser and TypeScript. Native compilation, providers, network
// and subprocesses remain forbidden; this worker never builds or executes tests.
const fs = require('node:fs'), Module = require('node:module');
const [receipt, cli, mode, ...args] = process.argv.slice(2), start = process.hrtime.bigint(), load = Module._load, blocked = [];
Module._load = function (id, ...rest) {
    const configParser = mode === 'project' && id === '@pulse-compute/wasm-compiler/project-config-compiler';
    const forbidden = (!configParser && /@pulse-compute\/(?:wasm-compiler|provider-)|project-execution|child_process|^(?:node:)?(?:http|https|net|tls|dns)$/.test(id))
        || (mode !== 'project' && /project-config\.js|typescript/.test(id));
    if (forbidden) {
        blocked.push(id);
        throw Error('REPORT_QUALIFICATION_FORBIDDEN_IMPORT');
    }
    return load.call(this, id, ...rest);
};
globalThis.fetch = () => { blocked.push('fetch'); throw Error('REPORT_QUALIFICATION_FORBIDDEN_NETWORK'); };
process.on('exit', code => fs.writeFileSync(receipt, JSON.stringify({ exitCode: code, elapsedMs: Number(process.hrtime.bigint() - start) / 1e6, peakRssKiB: process.resourceUsage().maxRSS, finalRssBytes: process.memoryUsage().rss, blocked }) + '\n'));
process.argv = [process.execPath, cli, ...args];
require(cli);
