'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { executeFastlyNativePlatformCapabilities: execute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const url = 'https://origin.example/upload';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const binary = size => Buffer.from(Array.from({ length: size }, (_, i) => i % 256));
const config = { maxDurationMs: 2000, bodyForwarding: { requestMaxBytes: 1048576, responseMaxBytes: 1048576 }, bindings: { backends: { 'https://origin.example': 'origin' } } };
const source = `import {Pulse} from '@pulse-compute/pulse';const app=new Pulse({auto:true});app.post('/',async ctx=>{return ctx.fetch('${url}',{method:'POST',body:ctx.req.body(),timeoutMs:1500,headers:{'content-type':'application/octet-stream'}})});export default app;`;
function qualifyAbi(wasm, { requestCap = 1048576, responseCap = 1048576, deadline = 1500, requestDeadline = 2000 } = {}) {
    const cases = [];
    const run = (request = {}, fixture = {}, options = {}) => execute({ wasm }, { request: { method: 'POST', path: '/', ...request }, fixtures: { [url]: { echoBody: true, ...fixture } }, allowAbortedResponse: true, traceBodyIo: true, ...options });
    const check = (name, fn) => { try {
        fn();
        cases.push(name);
    }
    catch (error) {
        throw new Error(`${name}: ${error.message}`, { cause: error });
    } };
    const reads = r => r.trace.filter(x => x.name === 'read');
    const writes = r => r.trace.filter(x => x.name === 'write');
    const sends = r => r.trace.filter(x => x.name === 'send_downstream');
    const failed = (r, status) => { assert.equal(r.response.status, status); assert.equal(sends(r).length, 1); };
    const aborted = r => { assert.equal(r.response.aborted, true); assert.equal(sends(r).length, 1); assert.ok(r.trace.some(x => x.name === 'abandon' && x.handle === r.response.bodyHandle)); };
    const clean = r => {
        assert.equal(r.transportResources.outboundRequests, 0);
        assert.deepEqual(r.forwardingResources, { bodies: 0, responses: 0 });
        // Unresolved pending work has no cancel ABI. Every allocated guest-owned
        // body must nevertheless close or abandon exactly once (error response
        // bodies transfer in non-streaming send_downstream).
        for (const entry of r.trace.filter(x => x.module === 'fastly_http_body' && x.name === 'new')) {
            const transferred = sends(r).some(x => x.bodyHandle === entry.handle && x.streaming === 0);
            if (!transferred)
                assert.equal(r.trace.slice(r.trace.indexOf(entry) + 1).filter(x => (x.name === 'close' || x.name === 'abandon') && x.module === 'fastly_http_body' && x.handle === entry.handle).length, 1, `body ${entry.handle} terminal owner`);
        }
        assert.ok(r.trace.filter(x => x.name === 'select').every(x => x.timeout > 0 && x.timeout <= deadline));
    };
    const originalExpired = (invoke, committed = false) => {
        if (committed) {
            const r = invoke();
            assert.equal(r.response.aborted,true); assert.equal(sends(r).length,1);
            assert(r.forwardingResources.bodies > 0, 'expired disposal retains physical claims until teardown');
            return;
        }
        assert.throws(invoke,error => error.code === 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED'
            && !error.detail.trace.some(x=>x.name==='send_downstream'));
    };
    let guestMemoryBytes;
    for (const size of [...new Set([0, 1, 1024, 65536, 1048576, Math.min(requestCap, responseCap) - 1, Math.min(requestCap, responseCap)].filter(n => n <= Math.min(requestCap, responseCap)))])
        check(`binary-${size}`, () => {
            const input = binary(size), r = run({ body: input }, {}, { bodyWriteChunkBytes: 997 });
            assert.deepEqual(r.response.bodyBytes, input);
            assert.deepEqual(r.outboundRequests[0].bodyBytes, input);
            assert.equal(r.response.aborted, false);
            clean(r);
            const allocated = r.instance.exports.memory.buffer.byteLength;
            guestMemoryBytes ??= allocated;
            assert.equal(allocated, guestMemoryBytes);
            assert.ok(reads(r).every(x => x.capacity <= 16384));
            assert.ok(writes(r).every(x => x.capacity <= 16384));
            assert.equal(new Set(reads(r).map(x => x.pointer)).size, 1, 'both directions reuse one payload scratch');
            let retained = 0;
            for (const event of r.trace) {
                if (event.name === 'read') {
                    assert.equal(retained, 0, 'no next read before the previous write completes');
                    retained = event.bytes;
                }
                if (event.name === 'write')
                    retained -= event.bytes;
                assert.ok(retained >= 0 && retained <= 16384);
            }
            assert.equal(retained, 0);
            const ptr = reads(r)[0].pointer;
            assert.ok(writes(r).every(x => x.pointer >= ptr && x.pointer + x.capacity <= ptr + 16384));
        });
    for (const length of ['', '-1', '+1', '1.0', ' 1', '1 ', '1,1', '1\0'])
        check(`request-invalid-length-${JSON.stringify(length)}`, () => {
            const r = run({ body: binary(1), headers: { 'content-length': length } });
            failed(r, 400);
            assert.equal(reads(r).length, 0);
            assert.equal(r.outboundRequests.length, 0);
            clean(r);
        });
    check('request-duplicate-length', () => { const r = run({ headers: [['Content-Length', '1'], ['content-length', '1']] }); failed(r, 400); assert.equal(reads(r).length, 0); });
    for (const n of [requestCap + 1, '9'.repeat(100)])
        check(`request-declared-denial-${String(n).length}`, () => { const r = run({ headers: { 'content-length': String(n) }, body: binary(1) }); failed(r, 413); assert.equal(reads(r).length, 0); assert.equal(r.outboundRequests.length, 0); clean(r); });
    for (const [length, size] of [[2, 1], [0, 1], [1, 2]])
        check(`request-length-mismatch-${length}-${size}`, () => { const r = run({ headers: { 'content-length': String(length) }, body: binary(size) }); failed(r, 400); assert.equal(r.outboundRequests[0].aborted, true); clean(r); });
    check('request-actual-cap-plus-one', () => { const r = run({ body: binary(requestCap + 1) }); failed(r, 413); assert.ok(r.outboundRequests[0].bodyBytes.length <= requestCap); assert.equal(r.outboundRequests[0].aborted, true); clean(r); });
    check('request-credentials-not-copied', () => { const r = run({ headers: { authorization: 'secret', cookie: 'secret', host: 'private', connection: 'x-private', 'x-private': 'secret' } }); assert.deepEqual(r.outboundRequests[0].headers, [['content-type', 'application/octet-stream']]); });
    check('early-origin-denial-without-read', () => { const r = run({ body: binary(9), readyDelayMs: 4000 }, { earlyResponse: true, status: 413, echoBody: false, body: 'denied' }); failed(r, 413); assert.equal(r.response.body, 'denied'); assert.equal(reads(r).filter(x => x.handle === 2).length, 0); assert.equal(r.outboundRequests[0].aborted, true); clean(r); });
    check('early-origin-during-upload-backpressure', () => { const r = run({ body: binary(31) }, { earlyResponse: true, delayMs: 5, status: 409, echoBody: false, body: 'stop' }, { bodyWriteChunkBytes: 1, uploadWriteDelayMs: 10 }); failed(r, 409); assert.equal(r.outboundRequests[0].bodyBytes.length, 1); clean(r); });
    for (const [name, req, fixture, opts, committed] of [
        ['source', { body: binary(1), readyDelayMs: 4000 }, {}, {}, false],
        ['upload-writer', { body: binary(1) }, {}, { uploadReadyDelayMs: 4000 }, false],
        ['headers', {}, { neverHeaders: true }, {}, false],
        ['response-source', {}, { echoBody: false, body: binary(1), bodyDelayMs: 4000 }, {}, true],
        ['response-writer', { body: binary(2) }, {}, { bodyWriteChunkBytes: 1, downstreamWriteDelayMs: 4000 }, true]
    ])
        check(`deadline-${name}`, () => { if(deadline===requestDeadline){originalExpired(()=>run(req,fixture,opts),committed);return;} const r = run(req, fixture, opts); if (committed)
            aborted(r);
        else
            failed(r, 504); assert.equal(r.monotonicMs, deadline); clean(r); if (name === 'upload-writer')
            assert.equal(reads(r).length, 0); });
    check('slow-source-and-sink', () => { const r = run({ body: binary(31), chunkBytes: 7, chunkDelayMs: 1 }, { chunkBytes: 3, chunkDelayMs: 1 }, { bodyWriteChunkBytes: 2, uploadWriteDelayMs: 1, downstreamWriteDelayMs: 1 }); assert.deepEqual(r.response.bodyBytes, binary(31)); assert.ok(r.monotonicMs > 20); clean(r); });
    // Expire after a successful EOF read, before either streaming close. No
    // second response or successful handoff may escape the final deadline check.
    for (const phase of ['upload', 'response'])
        check(`deadline-at-${phase}-eof`, () => {
            let upload;
            const invoke = () => run({ body: binary(1) }, {}, { afterHostcall: c => {
                    if (c.name === 'send_async_streaming')
                        upload = c.args[1];
                    if (c.name === 'read' && c.readU32(c.args[3]) === 0 && ((phase === 'upload') === (c.args[0] === 2)))
                        c.advance(deadline);
                } });
            if(deadline===requestDeadline){originalExpired(invoke,phase==='response');return;}
            const r=invoke();
            if (phase === 'upload') {
                failed(r, 504);
                assert.ok(r.trace.some(x => x.name === 'abandon' && x.handle === upload));
            }
            else
                aborted(r);
            clean(r);
        });
    check('late-headers-discarded-on-timeout', () => {
        let delayed = false;
        const invoke = () => run({}, { body: 'late', echoBody: false }, { afterHostcall: c => {
                if (c.name === 'pending_req_poll_v2' && c.readU32(c.args[2]) === 1 && !delayed) {
                    delayed = true;
                    c.advance(deadline);
                }
            } });
        if(deadline===requestDeadline){originalExpired(invoke);return;}
        const r=invoke();
        failed(r, 504);
        assert.equal(r.transportResources.pendingRequests, 0);
        assert.equal(reads(r).filter(x => x.handle !== 2).length, 0);
        assert.ok(r.trace.some(x => x.module === 'fastly_http_resp' && x.name === 'close'));
        clean(r);
    });
    check('late-result-in-cleanup-discarded', () => { const invoke = () => run({}, { body: 'late', echoBody: false, delayMs: deadline - 1 }, { hostcallDelayMs: { 'fastly_http_body.close': 1 } }); if(deadline===requestDeadline){originalExpired(invoke);return;} const r=invoke(); failed(r, 504); assert.equal(r.transportResources.pendingRequests, 0); assert.equal(reads(r).filter(x => x.handle !== 2).length, 0); clean(r); });
    check('successful-close-is-the-handoff-boundary', () => {
        let sink;
        const r = run({ body: binary(7) }, {}, { afterHostcall: c => {
                if (c.name === 'send_downstream')
                    sink = c.args[1];
                if (c.module === 'fastly_http_body' && c.name === 'close' && c.args[0] === sink)
                    c.advance(deadline + 1);
            } });
        assert.deepEqual(r.response.bodyBytes, binary(7));
        assert.equal(r.response.aborted, false);
        assert.equal(sends(r).length, 1);
        clean(r);
    });
    // Accounting's approved original-clock rule denies even protected host
    // work after the clock becomes untrustworthy. Claims remain for teardown;
    // a synthetic 504 must not be created with replenished/unknown time.
    for (const fault of ['status', 'negative', 'regression']) for (const transient of [false,true])
        check(`clock-${fault}-${transient ? 'transient' : 'persistent'}-during-pump`, () => {
            let armed = false, tick = 0, faultObserved = false;
            const afterFault = [];
            assert.throws(() => run({ body: binary(1) }, {}, {
                afterHostcall: c => { if (faultObserved) afterFault.push(c.module + ':' + c.name); if (c.name === 'read') armed = true; },
                monotonicClock: () => {
                    if (!armed || (faultObserved && transient)) return { nanoseconds: BigInt(++tick) * 1000000n };
                    faultObserved = true;
                    return fault === 'status' ? { status: 1 } : { nanoseconds: fault === 'negative' ? BigInt.asUintN(64, -1n) : 0n };
                }
            }), error => error.code === 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED'
                && !error.detail.trace.some(x => x.name === 'send_downstream'));
            assert(faultObserved);
            assert(afterFault.every(x => x === 'wasi_snapshot_preview1:clock_time_get'), 'no acquisition, disposal or delivery after clock failure');
        });
    for (const phase of ['request', 'response-names', 'response-values'])
        for (const fault of ['count', 'cursor'])
            check(`${phase}-invalid-header-${fault}`, () => {
                let changed = false;
                const r = run({ headers: { 'content-length': '0' } }, { headers: { 'x-origin': 'opaque' } }, { afterHostcall: c => {
                        const names = phase === 'response-names';
                        if (!changed && c.module === (phase === 'request' ? 'fastly_http_req' : 'fastly_http_resp') && c.name === (names ? 'header_names_get' : 'header_values_get')) {
                            if (fault === 'count')
                                c.writeU32(c.args[names ? 5 : 7], 0xffffffff);
                            else
                                c.writeU64(c.args[names ? 4 : 6], 1n);
                            changed = true;
                        }
                    } });
                assert.ok(changed);
                failed(r, phase === 'request' ? 400 : 502);
                clean(r);
            });
    for (const fault of ['sendStatus', 'transportStatus'])
        check(`origin-${fault}`, () => { failed(run({}, { [fault]: 1 }), 502); });
    for (const direction of ['request', 'response'])
        check(`${direction}-read-failure`, () => { const r = direction === 'request' ? run({ bodyReadStatus: 1 }) : run({}, { bodyReadStatus: 1 }); if (direction === 'request')
            failed(r, 400);
        else
            aborted(r); clean(r); });
    for (const direction of ['upload', 'downstream'])
        check(`${direction}-write-failure`, () => { const r = run({ body: binary(3) }, {}, { [direction === 'upload' ? 'outboundBodyWriteStatus' : 'downstreamBodyWriteStatus']: 1 }); if (direction === 'upload')
            failed(r, 502);
        else
            aborted(r); clean(r); });
    for (const direction of ['upload', 'downstream'])
        for (const count of [0, 1000, 0xffffffff])
            check(`${direction}-invalid-write-count-${count}`, () => {
                let corrupted = false;
                const r = run({ body: binary(3) }, {}, { afterHostcall: c => {
                        if (c.name === 'write' && !corrupted && ((direction === 'downstream') === c.trace.some(x => x.name === 'send_downstream' && x.streaming === 1))) {
                            c.writeU32(c.args[4], count);
                            corrupted = true;
                        }
                    } });
                assert.ok(corrupted);
                if (direction === 'upload')
                    failed(r, 502);
                else
                    aborted(r);
                clean(r);
            });
    for (const output of [2, 0xffffffff])
        check(`invalid-ready-${output}`, () => { let corrupted = false; const r = run({}, {}, { afterHostcall: c => { if (c.name === 'is_ready' && !corrupted) {
                c.writeU32(c.args[1], output);
                corrupted = true;
            } } }); failed(r, 502); clean(r); });
    for (const fault of [{ selected: 7 }, { status: 1 }])
        check(`invalid-select-${JSON.stringify(fault)}`, () => { const r = run({ readyDelayMs: 1 }, {}, { asyncSelectFault: () => fault }); failed(r, 502); clean(r); });
    for (const direction of ['request', 'response'])
        check(`${direction}-invalid-read-count`, () => { let corrupt = false; const r = run({ body: binary(1) }, {}, { afterHostcall: c => { if (c.name === 'read' && !corrupt && ((direction === 'request') === (c.args[0] === 2))) {
                c.writeU32(c.args[3], c.args[2] + 1);
                corrupt = true;
            } } }); if (direction === 'request')
            failed(r, 502);
        else
            aborted(r); clean(r); });
    check('partial-one-byte-writes', () => { const r = run({ body: binary(31) }, {}, { bodyWriteChunkBytes: 1 }); assert.deepEqual(r.response.bodyBytes, binary(31)); clean(r); });
    check('writer-fails-including-error-response', () => { assert.throws(() => run({ body: binary(1) }, {}, { bodyWriteChunkBytes: 0 }), error => error.code === 'PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED' && !error.detail.trace.some(x => x.name === 'send_downstream')); });
    for (const kind of ['request', 'body', 'response', 'pending'])
        check(`zero-${kind}-handle`, () => { const r = run({ body: binary(1) }, {}, { handleStarts: { [kind]: 0 } }); assert.deepEqual(r.response.bodyBytes, binary(1)); clean(r); });
    for (const headers of [{ 'content-length': String(responseCap + 1) }, { 'content-length': '-1' }, [['content-length', '0'], ['content-length', '0']], { 'x-large': 'x'.repeat(16384) }, Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['x-' + i, 'a'])), { 'connection': 'x-private,', 'x-private': 'hidden' }, { 'x-bad': 'a\rb' }])
        check(`response-header-denial-${cases.length}`, () => { const r = run({}, { headers }); failed(r, 502); assert.equal(reads(r).filter(x => x.handle !== 2).length, 0); clean(r); });
    check('response-header-framing-and-repeated-values', () => { const headers = [['connection', 'X-Private,\tX-Other'], ['x-private', 'hidden'], ['X-Other', 'hidden'], ['keep-alive', 'x'], ['transfer-encoding', 'chunked'], ['trailer', 'x'], ['te', 'trailers'], ['upgrade', 'x'], ['proxy-authenticate', 'x'], ['content-length', '7'], ['content-encoding', 'gzip'], ['set-cookie', 'a=1'], ['set-cookie', 'b=2']]; const r = run({}, { body: binary(7), echoBody: false, headers }); assert.deepEqual(r.response.headers, [['content-encoding', 'gzip'], ['set-cookie', 'a=1'], ['set-cookie', 'b=2']]); assert.deepEqual(r.response.bodyBytes, binary(7)); clean(r); });
    for (const size of [responseCap - 1, responseCap, responseCap + 1])
        check(`response-actual-${size}`, () => { const r = run({}, { body: binary(size), echoBody: false }); if (size > responseCap) {
            aborted(r);
            assert.ok(r.response.bodyBytes.length <= responseCap);
        }
        else {
            assert.deepEqual(r.response.bodyBytes, binary(size));
            assert.equal(r.response.aborted, false);
        } clean(r); });
    for (const [length, size] of [[2, 1], [1, 2]])
        check(`response-length-mismatch-${length}-${size}`, () => { const r = run({}, { headers: { 'content-length': String(length) }, body: binary(size), echoBody: false }); aborted(r); clean(r); });
    for (const status of [204, 205, 304])
        for (const size of [0, 1])
            check(`bodyless-${status}-${size}`, () => { const r = run({}, { status, body: binary(size), echoBody: false, headers: status === 304 ? { 'content-length': '999999999' } : {} }); assert.equal(r.response.status, status); assert.equal(r.response.bodyBytes.length, 0); if (size)
                aborted(r);
            else
                assert.equal(r.response.aborted, false); clean(r); });
    for (const status of [204, 205])
        check(`bodyless-invalid-framing-${status}`, () => { failed(run({}, { status, headers: { 'content-length': '1' } }), 502); });
    // A disconnect terminates the invocation; guest cleanup cannot run after a
    // host trap. Assert the fence, then a fresh invocation with the same module.
    check('disconnect-and-fresh-invocations', () => {
        const controller = new AbortController();
        let calls = 0;
        assert.throws(() => run({ body: binary(31) }, {}, { signal: controller.signal, afterHostcall: c => { calls++; if (c.name === 'write')
                controller.abort(new Error('fixture disconnect')); } }), /fixture disconnect/);
        const stopped = calls;
        assert.ok(stopped > 0);
        for (let i = 0; i < 20; i++) {
            const r = run({ body: binary(i) });
            assert.deepEqual(r.response.bodyBytes, binary(i));
            assert.equal(r.outboundRequests.length, 1);
            clean(r);
        }
        assert.equal(calls, stopped);
    });
    return { status: 'passed', kind: 'injected-ABI', wasmSha256: hash(wasm), cases, guestMemoryBytes, payloadScratchBytes: 16384, metadataScratchBytes: 16384 + 1024 + 128, hostQueueBound: 'not measured', deadlineMs: deadline };
}
module.exports = { qualifyAbi, config, source, url, binary, hash };
