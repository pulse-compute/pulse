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

module.exports = { nativeStdioSource };
