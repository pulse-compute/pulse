'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { binary, hash } = require('./fastly-forwarding-qualification.cjs');
const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const PIN = { version: '0.21.1' };
// Version is portable across builds; this report also records the selected
// executable digest. The qualification record pins the reviewed Linux binary.
async function qualifyViceroy(wasmFile, dir) {
    const launcher = cli.inspectFastlyComputeLauncher({ viceroyBinary: process.env.PULSE_VICEROY_BIN, required: true });
    const engine = launcher.viceroyInspection;
    assert.ok(engine, 'The selected launcher must identify its Viceroy engine');
    assert.equal(engine.version, PIN.version, 'Review the ABI before qualifying another Viceroy version');
    let mode = 'echo', firstResolve, originFinished = false, originBytes = 0, originHeaders;
    const timers = new Set();
    const later = (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); };
    const origin = http.createServer((req, res) => {
        req.on('error', () => { });
        res.on('error', () => { });
        originHeaders = req.headers;
        const chunks = [];
        req.on('data', c => { originBytes += c.length; chunks.push(c); firstResolve?.(); });
        if (mode === 'early') {
            res.writeHead(413);
            res.end('denied');
            req.resume();
            return;
        }
        req.on('end', () => {
            if (mode === 'echo') {
                res.setHeader('x-origin', 'opaque');
                res.end(Buffer.concat(chunks));
            }
            else if (mode === 'overflow') {
                res.writeHead(200);
                res.flushHeaders();
                res.end(binary(1048577));
            }
            else if (mode === 'headers') {
                res.writeHead(200, { 'connection': 'x-private', 'x-private': 'hidden', 'content-encoding': 'gzip', 'set-cookie': ['a=1', 'b=2'] });
                res.end(binary(7));
            }
            else if (mode === 'prefix') {
                res.once('finish', () => { originFinished = true; });
                res.writeHead(200);
                res.write(binary(1024));
                firstResolve?.();
                later(() => res.end(binary(17)), 100);
            }
            else if (mode === 'slow') {
                res.writeHead(200);
                res.flushHeaders();
                later(() => res.end('late'), 1700);
            }
            else if (mode === 'mismatch') {
                res.writeHead(200, { 'content-length': '99' });
                res.end('short');
            }
            else if (mode.startsWith('bodyless-')) {
                res.writeHead(Number(mode.slice(9)));
                res.end();
            }
        });
    });
    origin.listen(0, '127.0.0.1');
    await once(origin, 'listening');
    let server;
    const cases = [];
    const check = async (name, fn) => { try {
        await fn();
        cases.push(name);
    }
    catch (error) {
        throw new Error(`${name}: ${error.message}`, { cause: error });
    } };
    try {
        const manifestFile = path.join(dir, 'fastly.toml');
        fs.writeFileSync(manifestFile, cli.renderFastlyLocalConfig({ name: 'fwd9-03-qualification', backends: { origin: { url: `http://127.0.0.1:${origin.address().port}`, useSni: false } } }));
        server = await cli.startFastlyComputeServe({ launcher, packageRoot: dir, wasmFile, manifestFile, startTimeoutMs: 15000, stopTimeoutMs: 3000 });
        const request = (body, { chunked = false, slowSink = false, headers = {} } = {}) => new Promise((resolve, reject) => {
            const req = http.request(server.baseUrl, { method: 'POST', headers: { ...(!chunked ? { 'content-length': body.length } : {}), ...headers } }, res => {
                const chunks = [];
                let done = false;
                const finish = aborted => { if (done)
                    return; done = true; resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks), aborted }); };
                res.on('data', c => { chunks.push(c); if (slowSink) {
                    res.pause();
                    later(() => res.resume(), 5);
                } });
                res.on('end', () => finish(false));
                res.on('aborted', () => finish(true));
                res.on('error', error => { if (!done)
                    reject(error); });
            });
            req.on('error', reject);
            req.setTimeout(5000, () => req.destroy(new Error('qualification request timed out')));
            if (chunked) {
                req.write(body);
                req.end();
            }
            else
                req.end(body);
        });
        const observations = [];
        for (const size of [0, 1024, 65536, 1048575, 1048576])
            await check(`wire-binary-${size}`, async () => {
                const input = binary(size), begin = performance.now(), result = await request(input, { slowSink: size === 1048576 });
                assert.equal(result.status, 200);
                assert.equal(result.aborted, false);
                assert.deepEqual(result.bytes, input);
                observations.push({ bytes: size, sha256: hash(result.bytes), wallMs: performance.now() - begin, slowSink: size === 1048576 });
            });
        await check('wire-declared-cap-plus-one', async () => { const previous = originBytes, r = await request(binary(1048577)); assert.equal(r.status, 413); assert.equal(originBytes, previous); });
        await check('wire-unknown-length', async () => { const input = binary(65536), r = await request(input, { chunked: true }); assert.equal(r.status, 200); assert.deepEqual(r.bytes, input); });
        await check('wire-unknown-length-overflow', async () => { const r = await request(binary(1048577), { chunked: true }); assert.equal(r.status, 413); });
        await check('wire-upload-prefix-before-eof', async () => {
            const first = new Promise(resolve => { firstResolve = resolve; });
            const result = new Promise((resolve, reject) => { const req = http.request(server.baseUrl, { method: 'POST' }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject); }); req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('upload prefix timeout'))); req.write(binary(1024)); first.then(() => later(() => req.end(binary(17)), 20)); });
            assert.deepEqual(await result, Buffer.concat([binary(1024), binary(17)]));
            firstResolve = undefined;
        });
        mode = 'early';
        await check('wire-early-response-before-input-eof', async () => {
            const status = await new Promise((resolve, reject) => { const req = http.request(server.baseUrl, { method: 'POST' }, res => { res.resume(); res.on('end', () => { resolve(res.statusCode); req.destroy(); }); }); req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('early response timeout'))); req.flushHeaders(); });
            assert.equal(status, 413);
        });
        mode = 'headers';
        await check('wire-raw-encoding-headers-and-request-privacy', async () => { const r = await request(Buffer.alloc(0), { headers: { authorization: 'not-forwarded', cookie: 'not-forwarded', 'x-incoming': 'not-forwarded' } }); assert.equal(r.status, 200); assert.deepEqual(r.bytes, binary(7)); assert.equal(r.headers['content-encoding'], 'gzip'); assert.deepEqual(r.headers['set-cookie'], ['a=1', 'b=2']); assert.equal(r.headers['x-private'], undefined); assert.equal(originHeaders.authorization, undefined); assert.equal(originHeaders.cookie, undefined); assert.equal(originHeaders['x-incoming'], undefined); });
        mode = 'prefix';
        await check('wire-response-prefix-before-origin-eof', async () => {
            originFinished = false;
            let prefixObserved = false;
            const r = await new Promise((resolve, reject) => { const req = http.request(server.baseUrl, { method: 'POST', headers: { 'content-length': 0 } }, res => { const chunks = []; res.once('data', () => { prefixObserved = !originFinished; }); res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject); }); req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('response prefix timeout'))); req.end(); });
            assert.deepEqual(r, Buffer.concat([binary(1024), binary(17)]));
            assert.ok(prefixObserved, 'prefix must arrive before origin EOF');
            firstResolve = undefined;
        });
        mode = 'overflow';
        await check('wire-response-cap-aborts-after-headers', async () => { const r = await request(Buffer.alloc(0)); assert.equal(r.status, 200); assert.equal(r.aborted, true); assert.ok(r.bytes.length <= 1048576); });
        mode = 'slow';
        await check('wire-deadline-after-response-headers', async () => { const r = await request(Buffer.alloc(0)); assert.equal(r.status, 200); assert.equal(r.aborted, true); });
        mode = 'mismatch';
        await check('wire-origin-truncated-content-length', async () => { const r = await request(Buffer.alloc(0)); assert.equal(r.status, 200); assert.equal(r.aborted, true); });
        for (const status of [204, 205, 304]) {
            mode = `bodyless-${status}`;
            await check(`wire-bodyless-${status}`, async () => { const r = await request(Buffer.alloc(0)); assert.equal(r.status, status); assert.equal(r.bytes.length, 0); assert.equal(r.aborted, false); });
        }
        mode = 'echo';
        await check('wire-disconnect-then-repeated-healthy-requests', async () => {
            let reachedOrigin = false;
            await new Promise(resolve => { const req = http.request(server.baseUrl, { method: 'POST' }); req.on('error', () => { }); req.on('close', resolve); firstResolve = () => { reachedOrigin = true; req.destroy(); }; req.write(binary(1024)); req.setTimeout(3000, () => req.destroy()); });
            assert.ok(reachedOrigin);
            firstResolve = undefined;
            for (let i = 0; i < 12; i++) {
                const input = binary(i * 31), r = await request(input);
                assert.equal(r.status, 200);
                assert.deepEqual(r.bytes, input);
            }
        });
        return { status: 'passed', kind: 'local-Viceroy', engine: engine.version, engineSha256: hash(fs.readFileSync(engine.binary)), launcher: launcher.kind, wasmSha256: hash(fs.readFileSync(wasmFile)), cases, observations, livePlatform: false, hostQueueBound: 'not measured', timingClaim: 'diagnostic sequential loopback samples; not a Rust comparison or performance acceptance' };
    }
    finally {
        for (const timer of timers)
            clearTimeout(timer);
        if (server)
            await server.stop();
        origin.closeAllConnections();
        await new Promise(resolve => origin.close(resolve));
    }
}
module.exports = { qualifyViceroy };
