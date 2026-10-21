'use strict';

// Shared by both Native emitters. Fastly's named logging endpoint ABI rejects
// stdout/stderr; Compute stdio uses WASI fd_write with stdout descriptor 1.
const nativeStdioSource = String.raw`
@external("wasi_snapshot_preview1", "fd_write")
declare function __pulse_fastly_fd_write(fd: i32, iovs: usize, count: i32, written: usize): i32

function __pulse_fastly_write_stdout(bytes: ArrayBuffer): void {
  const iov = new StaticArray<usize>(2)
  unchecked(iov[0] = changetype<usize>(bytes))
  unchecked(iov[1] = bytes.byteLength)
  const written = new StaticArray<i32>(1)
  // One best-effort attempt: errors, zero progress, and short writes never
  // retry, spin, change the response, or disable subsequent log statements.
  __pulse_fastly_fd_write(1, changetype<usize>(iov), 1, changetype<usize>(written))
}
`;

function nativeLoggingSource(endpoint) {
  const { normalizeFastlyLogEndpoint, MAX_LOG_BYTES } = require('../toolchain/logging.js');
  const name = normalizeFastlyLogEndpoint(endpoint);
  if (name === undefined) return nativeStdioSource;
  return String.raw`
@external("fastly_log", "endpoint_get")
declare function __pulse_fastly_log_endpoint_get(name: usize, length: usize, handle: usize): i32
@external("fastly_log", "write")
declare function __pulse_fastly_log_write(handle: i32, message: usize, length: usize, written: usize): i32

// Retain the shared emitter entry point; destination is selected at build time.
function __pulse_fastly_write_stdout(bytes: ArrayBuffer): void {
  if (bytes.byteLength > ${MAX_LOG_BYTES}) return
  const name = String.UTF8.encode(${JSON.stringify(name)}, false)
  const handle = new StaticArray<i32>(1)
  unchecked(handle[0] = -1)
  if (__pulse_fastly_log_endpoint_get(changetype<usize>(name), name.byteLength, changetype<usize>(handle)) != 0) return
  if (unchecked(handle[0]) == -1) return
  const written = new StaticArray<usize>(1)
  // One best-effort write. No retry or fallback, including zero/short writes.
  __pulse_fastly_log_write(unchecked(handle[0]), changetype<usize>(bytes), bytes.byteLength, changetype<usize>(written))
}
`;
}

module.exports = { nativeStdioSource, nativeLoggingSource };
