#![no_std]
// PERF9-01A: handwritten bounded Rust reference, not a Pulse runtime backend.
// The algorithm follows the FWD9 host-handoff contract; no generated AS is used.
mod abi;
use abi::*;
use core::cmp::min;
include!("fixture.rs"); // Written from contract.json in an isolated build copy.

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { core::arch::wasm32::unreachable() }
type Outcome<T> = Result<T, i32>;
fn ok(status: i32, error: i32) -> Outcome<()> { if status == 0 { Ok(()) } else { Err(error) } }
fn token(b: u8) -> bool { b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b) }
fn hop(n: &[u8]) -> bool {
    [b"connection".as_slice(), b"keep-alive", b"proxy-connection", b"transfer-encoding",
     b"te", b"trailer", b"upgrade", b"content-length", b"host", b"proxy-authenticate",
     b"proxy-authorization"].iter().any(|v| n.eq_ignore_ascii_case(v))
}
fn length(value: &[u8], cap: i32) -> Outcome<i32> {
    if value.is_empty() { return Err(502); }
    let mut n = 0;
    for &b in value { if !b.is_ascii_digit() { return Err(502); } n = min(cap + 1, n * 10 + (b - b'0') as i32); }
    Ok(n)
}
#[derive(Clone, Copy)]
struct Pair { name: usize, name_len: usize, value: usize, value_len: usize }
const EMPTY: Pair = Pair { name: 0, name_len: 0, value: 0, value_len: 0 };
struct Forward {
    source: i32, request: i32, upload: i32, pending: i32, response: i32,
    body: i32, output: i32, sink: i32, committed: bool,
    last_clock: i64, total_start: i64, fetch_start: i64,
    payload: [u8; 16384], metadata: [u8; 16384], pairs: [Pair; 64], pair_count: usize,
}
impl Forward {
    fn new() -> Self { Self { source: -1, request: -1, upload: -1, pending: -1, response: -1,
        body: -1, output: -1, sink: -1, committed: false, last_clock: -1, total_start: 0, fetch_start: 0,
        payload: [0; 16384], metadata: [0; 16384], pairs: [EMPTY; 64], pair_count: 0 } }
    unsafe fn clock(&mut self) -> Outcome<i64> {
        let mut now = -1; ok(clock_time_get(1, 1, &mut now), 504)?;
        if now < 0 || now < self.last_clock { return Err(504); }
        self.last_clock = now; Ok(now)
    }
    unsafe fn remaining(&mut self) -> Outcome<i32> {
        let now = self.clock()?;
        let ns = min(TOTAL_MS * 1_000_000 - (now - self.total_start), FETCH_MS * 1_000_000 - (now - self.fetch_start));
        if ns <= 0 { return Err(504); }
        Ok(((ns + 999_999) / 1_000_000) as i32)
    }
    unsafe fn cleanup(&mut self) {
        for h in [&mut self.source, &mut self.body] { if *h >= 0 { body_close(*h); *h = -1; } }
        for h in [&mut self.upload, &mut self.sink] { if *h >= 0 { abandon(*h); *h = -1; } }
        if self.request >= 0 { req_close(self.request); self.request = -1; }
        for h in [&mut self.response, &mut self.output] { if *h >= 0 { resp_close(*h); *h = -1; } }
        if self.pending >= 0 {
            let (mut detail, mut done, mut response, mut body) = ([0; 4], 0, -1, -1);
            if pending_req_poll_v2(self.pending, detail.as_mut_ptr(), &mut done, &mut response, &mut body) == 0 && done == 1 {
                resp_close(response); body_close(body);
            }
            // No cancellation ABI; unresolved work is invocation-owned.
            self.pending = -1;
        }
    }
    unsafe fn error(&mut self, status: i32) {
        self.cleanup();
        if self.committed { return; }
        let text: &[u8] = match status { 400 => b"Bad Request", 413 => b"Payload Too Large", 504 => b"Gateway Timeout", 404 => b"Not Found", _ => b"Bad Gateway" };
        let (mut response, mut body) = (-1, -1);
        if resp_new(&mut response) != 0 { return; }
        if status_set(response, status) != 0 || body_new(&mut body) != 0 { resp_close(response); return; }
        let name = b"content-type"; let value = b"text/plain; charset=utf-8";
        if status == 404 && header_append(response, name.as_ptr(), name.len() as i32, value.as_ptr(), value.len() as i32) != 0 { resp_close(response); body_close(body); return; }
        let mut offset = 0;
        while offset < text.len() {
            let mut written = -1;
            if write(body, text.as_ptr().add(offset), (text.len() - offset) as i32, 0, &mut written) != 0 || written <= 0 || written as usize > text.len() - offset {
                resp_close(response); body_close(body); return;
            }
            offset += written as usize;
        }
        self.committed = true;
        send_downstream(response, body, 0);
    }
    unsafe fn declared(&mut self, downstream: i32) -> Outcome<i32> {
        let (mut end, mut count) = (-1, 0);
        ok(req_values(downstream, b"content-length".as_ptr(), 14, self.metadata.as_mut_ptr(), 16384, 0, &mut end, &mut count), 400)?;
        if !(0..=16384).contains(&count) || (count > 0 && end != -1) { return Err(400); }
        if count == 0 { return Ok(-1); }
        if self.metadata[count as usize - 1] != 0 { return Err(400); }
        let n = length(&self.metadata[..count as usize - 1], REQUEST_CAP).map_err(|_| 400)?;
        if n > REQUEST_CAP { return Err(413); } Ok(n)
    }
    unsafe fn poll(&mut self) -> Outcome<bool> {
        if self.pending < 0 { return Ok(self.response >= 0); }
        self.remaining()?;
        let (mut detail, mut done, mut response, mut body) = ([0; 4], 0, -1, -1);
        let status = pending_req_poll_v2(self.pending, detail.as_mut_ptr(), &mut done, &mut response, &mut body);
        if status != 0 { self.pending = -1; return Err(502); }
        match done {
            0 => (),
            1 => { self.response = response; self.body = body; self.pending = -1; },
            _ => return Err(502),
        }
        self.remaining()?; Ok(done == 1)
    }
    // A false result means early headers arrived during upload, not EOF.
    unsafe fn wait(&mut self, handle: i32, upload: bool) -> Outcome<bool> {
        loop {
            self.remaining()?;
            if upload && self.poll()? { return Ok(false); }
            let mut ready = -1; ok(is_ready(handle, &mut ready), 502)?;
            if ready == 1 { self.remaining()?; return Ok(true); }
            if ready != 0 { return Err(502); }
            let handles = if upload && self.pending >= 0 { [self.pending, handle] } else { [handle, -1] };
            let count = if handles[1] >= 0 { 2 } else { 1 };
            let remaining = self.remaining()?; let mut selected = -1;
            ok(select(handles.as_ptr(), count, remaining, &mut selected), 502)?;
            if selected == -1 { return Err(504); }
            if selected < 0 || selected >= count { return Err(502); }
        }
    }
    unsafe fn pump(&mut self, source: i32, sink: i32, cap: i32, declared: i32, upload: bool) -> Outcome<bool> {
        let mut total = 0;
        loop {
            if !self.wait(sink, upload)? || !self.wait(source, upload)? { return Ok(false); }
            let size = min(16384, cap - total + 1); let mut count = -1;
            ok(read(source, self.payload.as_mut_ptr(), size, &mut count), if upload { 400 } else { 502 })?;
            self.remaining()?;
            if count < 0 || count > size { return Err(502); }
            if count == 0 {
                if declared >= 0 && total != declared { return Err(if upload { 400 } else { 502 }); }
                return Ok(true);
            }
            total += count;
            if total > cap { return Err(if upload { 413 } else { 502 }); }
            if declared >= 0 && total > declared { return Err(if upload { 400 } else { 502 }); }
            let mut offset = 0;
            while offset < count {
                if !self.wait(sink, upload)? { return Ok(false); }
                let mut written = -1;
                ok(write(sink, self.payload.as_ptr().add(offset as usize), count - offset, 0, &mut written), 502)?;
                self.remaining()?;
                if written <= 0 || written > count - offset { return Err(502); }
                offset += written;
            }
        }
    }
    unsafe fn headers(&mut self) -> Outcome<(i32, i32)> {
        let mut status = 0; ok(status_get(self.response, &mut status), 502)?;
        if !(200..=599).contains(&status) { return Err(502); }
        let (mut end, mut count) = (-1, -1);
        ok(header_names_get(self.response, self.metadata.as_mut_ptr(), 16384, 0, &mut end, &mut count), 502)?;
        if !(0..=16384).contains(&count) || (count > 0 && end != -1) { return Err(502); }
        let (mut used, mut start, mut total, mut names, mut declared) = (count as usize, 0, 0, 0, -1);
        for i in 0..count as usize {
            let b = self.metadata[i];
            if b != 0 { if !token(b) { return Err(502); } continue; }
            let name = start; let n = i - start; start = i + 1; names += 1;
            if n == 0 || names > 64 || used >= 16384 { return Err(502); }
            end = -1; let mut size = -1;
            ok(resp_values(self.response, self.metadata.as_ptr().add(name), n as i32, self.metadata.as_mut_ptr().add(used), (16384 - used) as i32, 0, &mut end, &mut size), 502)?;
            if size <= 0 || size as usize > 16384 - used || end != -1 { return Err(502); }
            let mut value_start = 0;
            for j in 0..size as usize {
                let b = self.metadata[used + j];
                if b != 0 { if (b < 32 && b != 9) || b == 127 { return Err(502); } continue; }
                let value = used + value_start; let len = j - value_start; value_start = j + 1;
                total += n + len + 4;
                if self.pair_count >= 64 || total > 16384 { return Err(502); }
                self.pairs[self.pair_count] = Pair { name, name_len: n, value, value_len: len }; self.pair_count += 1;
                if self.metadata[name..name+n].eq_ignore_ascii_case(b"content-length") {
                    if declared != -1 { return Err(502); }
                    declared = length(&self.metadata[value..value+len], RESPONSE_CAP)?;
                    if status != 304 && declared > RESPONSE_CAP { return Err(502); }
                }
            }
            if value_start != size as usize { return Err(502); } used += size as usize;
        }
        if start != count as usize || ((status == 204 || status == 205) && declared > 0) { return Err(502); }
        self.remaining()?; Ok((status as i32, declared))
    }
    fn nominated(&self, name: &[u8]) -> Outcome<bool> {
        let mut found = false;
        for p in &self.pairs[..self.pair_count] {
            if !self.metadata[p.name..p.name+p.name_len].eq_ignore_ascii_case(b"connection") { continue; }
            let value = &self.metadata[p.value..p.value+p.value_len]; let mut i = 0;
            while i < value.len() {
                while i < value.len() && (value[i] == b' ' || value[i] == b'\t') { i += 1; }
                let start = i;
                while i < value.len() && token(value[i]) { i += 1; }
                if i == start { return Err(502); }
                found |= name.eq_ignore_ascii_case(&value[start..i]);
                while i < value.len() && (value[i] == b' ' || value[i] == b'\t') { i += 1; }
                if i < value.len() { if value[i] != b',' || i + 1 == value.len() { return Err(502); } i += 1; }
            }
        }
        Ok(found)
    }
    unsafe fn run(&mut self) -> Outcome<()> {
        self.total_start = self.clock()?;
        ok(init(1), 502)?;
        let mut downstream = -1; ok(body_downstream_get(&mut downstream, &mut self.source), 502)?;
        // Consume the same method/URI ABI fields as Pulse's single-route shell.
        let mut count = -1;
        ok(method_get(downstream, self.metadata.as_mut_ptr(), 16384, &mut count), 502)?;
        if count != 4 || &self.metadata[..4] != b"POST" { return Err(404); }
        count = -1;
        ok(uri_get(downstream, self.metadata.as_mut_ptr(), 16384, &mut count), 502)?;
        if count <= 0 || count > 16384 { return Err(502); }
        // The pinned workload is POST /, optionally query or an absolute URI.
        let uri = &self.metadata[..count as usize];
        let path = if let Some(scheme) = uri.windows(3).position(|s| s == b"://") {
            let tail = &uri[scheme+3..]; tail.iter().position(|&b| b == b'/').map(|i| &tail[i..]).unwrap_or(b"/")
        } else { uri };
        let end = path.iter().position(|&b| b == b'?' || b == b'#').unwrap_or(path.len());
        if &path[..end] != b"/" { return Err(404); }
        self.fetch_start = self.clock()?; self.remaining()?;
        let declared = self.declared(downstream)?;
        ok(req_new(&mut self.request), 502)?; ok(body_new(&mut self.upload), 502)?;
        ok(method_set(self.request, b"POST".as_ptr(), 4), 502)?;
        ok(uri_set(self.request, URL.as_ptr(), URL.len() as i32), 502)?;
        ok(header_insert(self.request, b"content-type".as_ptr(), 12, b"application/octet-stream".as_ptr(), 24), 400)?;
        self.remaining()?;
        ok(send_async_streaming(self.request, self.upload, BACKEND.as_ptr(), BACKEND.len() as i32, &mut self.pending), 502)?;
        self.request = -1; self.remaining()?;
        let eof = self.pump(self.source, self.upload, REQUEST_CAP, declared, true)?;
        body_close(self.source); self.source = -1;
        if eof { self.remaining()?; let upload = self.upload; self.upload = -1; ok(body_close(upload), 502)?; }
        else { abandon(self.upload); self.upload = -1; }
        while self.response < 0 { if self.poll()? { break; } self.wait(self.pending, false)?; }
        self.remaining()?;
        let (status, declared) = self.headers()?;
        ok(resp_new(&mut self.output), 502)?; ok(status_set(self.output, status), 502)?; ok(body_new(&mut self.sink), 502)?;
        for p in &self.pairs[..self.pair_count] {
            let name = &self.metadata[p.name..p.name+p.name_len];
            let nominated = self.nominated(name)?;
            if hop(name) || nominated { continue; }
            ok(header_append(self.output, name.as_ptr(), p.name_len as i32, self.metadata.as_ptr().add(p.value), p.value_len as i32), 502)?;
        }
        resp_close(self.response); self.response = -1; self.remaining()?;
        self.committed = true; let output = self.output; self.output = -1;
        if send_downstream(output, self.sink, 1) != 0 { resp_close(output); return Err(502); }
        let bodyless = status == 204 || status == 205 || status == 304;
        let eof = self.pump(self.body, self.sink, if bodyless { 0 } else { RESPONSE_CAP }, if bodyless { 0 } else { declared }, false)?;
        body_close(self.body); self.body = -1;
        if eof { self.remaining()?; let sink = self.sink; self.sink = -1; ok(body_close(sink), 502)?; }
        // Success relinquishes the handle; do not assert receipt or wait for drain.
        Ok(())
    }
}
#[no_mangle]
pub unsafe extern "C" fn _start() {
    let mut forward = Forward::new();
    if let Err(status) = forward.run() { forward.error(status); }
    forward.cleanup();
}
// The shared injected host asks for Pulse's diagnostic accessor. Rust propagates
// failures as wire status/abort or a Wasm trap, all independently asserted by
// the oracle; it has no Pulse runtime error code. Not used by Fastly/Viceroy.
#[no_mangle]
pub extern "C" fn pulse_fastly_last_error() -> i32 { 0 }
