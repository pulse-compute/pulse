'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function replace(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('UPLOAD02 Native boundary drift: '+before.slice(0,70));
  return source.replace(before, after);
}
function transform(source) {
  // Only the emitted S3-owned contribution is specialized. The ordinary
  // package putText plan is a compiler scaffold, NOT upload API admission.
  source = replace(source, "result.digest = __pulse_s3_hex(__pulse_s3_sha(body));", "result.digest = 'UNSIGNED-PAYLOAD';");
  source = replace(source, "const names = (contentType.length", "const names = 'content-length;' + (contentType.length");
  source = replace(source, "const headers = (contentType.length", "const headers = 'content-length:' + __u2_length.toString() + '\\n' + (contentType.length");
  const start = source.indexOf('  if (put) {\n    const text =');
  const end = source.indexOf('  const storeName =', start);
  if (start < 0 || end < 0) throw new Error('UPLOAD02 Native body boundary drift');
  source = source.slice(0,start) + `  if (!put || __u2_claimed) { __s3_fail(index, 'ownership'); return; }
  __u2_claimed = true; __u2_length = __u2_length_header();
  if (__u2_length < 0 || __u2_length > 1048576) { __s3_fail(index, 'length'); return; }
  __s3_deadlines[index] = min(__s3_deadlines[index], __request_deadline);
` + source.slice(end);
  source = replace(source, "__s3_header(req, 'content-length', data.length.toString())", "__s3_header(req, 'content-length', __u2_length.toString())");
  const writeStart = source.indexOf('  let offset = 0; const written =');
  const writeEnd = source.indexOf('\n}\nfunction __s3_wait_ready', writeStart);
  if (writeStart < 0 || writeEnd < 0) throw new Error('UPLOAD02 Native dispatch boundary drift');
  source = source.slice(0,writeStart) + `  if (__s3_remaining(index) == 0) { __s3_close_req(req); __s3_close_body(body[0]); __s3_fail(index, 'timeout'); return; }
  __s3_dispatched[index] = true;
  const sent = __u2_send(req, body[0], backend.dataStart, backend.length, changetype<usize>(pending));
  if (sent != 0) { __s3_close_req(req); __u2_abandon(body[0]); __s3_fail(index, 'transport'); return; }
  __pulse_fastly_pending[index] = pending[0]; __pulse_fastly_pending_mode[index] = PULSE_FASTLY_PENDING_ASYNC;
  const eof = __u2_pump(index, body[0]);
  __s3_close_body(__pulse_fastly_request_body_handle);
  if (eof) {
    if (__s3_close_body(body[0]) == 0) return;
    __u2_problem = 'transport';
  } else __u2_abandon(body[0]);
  __pulse_fastly_pending[index] = 0; __pulse_fastly_pending_mode[index] = PULSE_FASTLY_PENDING_NONE;
  __pulse_fastly_ready_effect(index, __u2_early != 0 ? __u2_early : __s3_failure(index, __u2_problem));
` + source.slice(writeEnd);
  source = replace(source, 'const maximum = put && !rejected ? 0 : binding.max;', 'const maximum = put ? (rejected ? 16384 : 0) : binding.max;');
  source = replace(source, "      __s3_set(result, 'sha256', __pulse_fastly_string_value(__s3_digests[index]));", '      // No payload digest claim for unsigned uploads.');
  return source + '\n' + fs.readFileSync(__dirname+'/native-pump.as.ts','utf8');
}
function install() {
  const owner = require('../../../../packages/provider-fastly/src/build/s3-native.js');
  const original = owner.s3NativeSource;
  const evidence = {};
  owner.s3NativeSource = (plan, bindings) => {
    if (plan.effects.filter(x => x.kind === 's3.putText').length !== 1 || plan.effects.filter(x => x.kind.startsWith('s3.')).length !== 1 || plan.effects.some(x => x.grouped)) throw new Error('UPLOAD02 admits exactly one ungrouped upload scaffold');
    const before = original(plan, bindings), after = transform(before);
    evidence.originalContributionSha256 = sha(before); evidence.experimentalContributionSha256 = sha(after);
    return after;
  };
  owner.S3_IMPORTS = [...owner.S3_IMPORTS.filter(x => x !== 'fastly_http_req:send_async'), 'fastly_http_req:send_async_streaming', 'fastly_http_body:abandon', 'fastly_async_io:is_ready'];
  Object.defineProperty(evidence, 'originalSource', {value:original});
  return evidence;
}
module.exports = { transform, install, sha };
