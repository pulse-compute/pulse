'use strict';
// Research fixes over the frozen UPLOAD-02 experiment; product owners stay unchanged.
const previous=require('../upload-02/native-overlay.cjs');
function replace(source,before,after){if(source.split(before).length!==2)throw Error('UPLOAD03 boundary drift: '+before);return source.replace(before,after);}
function patch(source){
  source=replace(source,
    "if (sent != 0) { __s3_close_req(req); __u2_abandon(body[0]); __s3_fail(index, 'transport'); return; }",
    "if (sent != 0) { __s3_close_req(req); __u2_abandon(body[0]); __s3_close_body(__pulse_fastly_request_body_handle); __s3_fail(index, 'transport'); return; }");
  source=replace(source,
    "__s3_close_resp(response[0]); return result;",
    "__s3_close_resp(response[0]); return __s3_remaining(index) == 0 ? __s3_failure(index, 'timeout') : result;");
  source=replace(source,
    "__pulse_fastly_ready_effect(index, __u2_early != 0 ? __u2_early : __s3_failure(index, __u2_problem));",
    "__pulse_fastly_ready_effect(index, __s3_remaining(index) == 0 ? __s3_failure(index, 'timeout') : (__u2_early != 0 ? __u2_early : __s3_failure(index, __u2_problem)));");
  return source;
}
function install(){
  const evidence=previous.install(),owner=require('../../../../packages/provider-fastly/src/build/s3-native.js'),upload02=owner.s3NativeSource;
  owner.s3NativeSource=(plan,bindings)=>{const source=patch(upload02(plan,bindings));evidence.experimentalContributionSha256=previous.sha(source);return source;};
  return evidence;
}
module.exports={install,sha:previous.sha,patch};
