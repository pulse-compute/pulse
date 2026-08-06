'use strict';

const { RESULT_KINDS } = require('./wasm-host-abi.js');

const STREAMING_PASSTHROUGH_VERSION = 'pulsewasm.streaming-passthrough.v1';
const STREAM_RESULT_ABI_VERSION = 'pulsewasm.stream-result-abi.v1';
const RESPONSE_PASSTHROUGH_POLICY_VERSION = 'pulsewasm.response-passthrough-policy.v1';
const STREAMING_PHASE = '12D';
const STREAMING_SMOKE_VERSION = 'pulsewasm.streaming-passthrough-smoke.v1';

const STREAM_RESULT_ABI_EXPORTS = Object.freeze([
  'pulse_result_from_response(ctxRef, responseRef) -> void',
  'pulse_result_stream(ctxRef, statusCode, streamRef) -> void',
  'pulse_result_stream_ref() -> HostStreamRef',
  'pulse_result_response_ref() -> HostResponseRef'
]);

const RESPONSE_HEADER_MERGE_RULES = Object.freeze([
  'Preserve backend/platform response headers by default.',
  'Apply response header delete operations first by ASCII case-insensitive name.',
  'Apply response header set operations as overrides by ASCII case-insensitive name.',
  'Apply response header append operations as ordered additions.',
  'Preserve repeated headers such as Grip-Channel.'
]);

function streamResultAbiFields(options = {}) {
  return {
    sourceWasmHostAbiVersion: options.sourceWasmHostAbiVersion,
    policy: {
      phase: STREAMING_PHASE,
      status: 'locked-contract-and-local-proof',
      resultBinaryReserved: true,
      resultStreamImplemented: true,
      wasmOwnsBytes: false,
      hostOwnsStream: true
    },
    resultKinds: RESULT_KINDS,
    refs: {
      HostResponseRef: 'opaque i32/usize owned by host; valid for active request/result lifetime only',
      HostStreamRef: 'opaque i32/usize owned by host; valid for active request/result lifetime only'
    },
    exports: STREAM_RESULT_ABI_EXPORTS.slice(),
    hostResultShape: {
      kind: 'stream',
      status: 'backend response status or explicit stream status',
      headers: 'ordered repeated headers after pass-through merge',
      bodyStream: 'host-owned stream / platform response body handle',
      body: 'undefined; bytes are not copied through Wasm'
    }
  };
}

function responsePassthroughPolicyFields() {
  return {
    policy: {
      phase: STREAMING_PHASE,
      hostOwnsStream: true,
      headerMergeIsOrdered: true,
      platformBindings: false,
      assetSemantics: false
    },
    headerMergeRules: RESPONSE_HEADER_MERGE_RULES.slice(),
    streamOwnership: {
      owner: 'host',
      wasmRepresentation: 'opaque ref only',
      hostCopiesBytesIntoWasm: false,
      resultExtraction: 'host maps ref back to host stream/response and copies no body bytes',
      lifetime: 'active request/result lifetime'
    },
    failureAndCancellation: {
      beforeResponseStarts: 'normal Pulse error/result path',
      afterResponseStarts: 'host/platform transport policy',
      clientDisconnect: 'host cancels stream if platform supports cancellation',
      contextExpiresBeforeStreamStarts: '504 PULSEWASM_CONTEXT_TIMEOUT',
      contextExpiresAfterStreamStarts: 'host/platform policy'
    }
  };
}

module.exports = {
  STREAMING_PASSTHROUGH_VERSION,
  STREAM_RESULT_ABI_VERSION,
  RESPONSE_PASSTHROUGH_POLICY_VERSION,
  STREAMING_PHASE,
  STREAMING_SMOKE_VERSION,
  STREAM_RESULT_ABI_EXPORTS,
  RESPONSE_HEADER_MERGE_RULES,
  streamResultAbiFields,
  responsePassthroughPolicyFields
};
