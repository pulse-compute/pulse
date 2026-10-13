// Fastly ABI v1. Signatures match the pinned FWD9-01/03 ABI and Viceroy 0.21.1.
// All pointers refer to wasm32 linear memory; handles are opaque, including 0.
#[link(wasm_import_module = "fastly_abi")]
extern "C" { #[link_name = "init"] pub fn init(version: i64) -> i32; }
#[link(wasm_import_module = "wasi_snapshot_preview1")]
extern "C" { pub fn clock_time_get(id: i32, precision: i64, out: *mut i64) -> i32; }
#[link(wasm_import_module = "fastly_http_req")]
extern "C" {
    pub fn body_downstream_get(req: *mut i32, body: *mut i32) -> i32;
    pub fn method_get(h: i32, p: *mut u8, n: i32, out: *mut i32) -> i32;
    pub fn uri_get(h: i32, p: *mut u8, n: i32, out: *mut i32) -> i32;
    #[link_name = "new"] pub fn req_new(out: *mut i32) -> i32;
    #[link_name = "close"] pub fn req_close(h: i32) -> i32;
    pub fn method_set(h: i32, p: *const u8, n: i32) -> i32;
    pub fn uri_set(h: i32, p: *const u8, n: i32) -> i32;
    pub fn header_insert(h: i32, p: *const u8, n: i32, v: *const u8, size: i32) -> i32;
    #[link_name = "header_values_get"]
    pub fn req_values(h: i32, p: *const u8, n: i32, v: *mut u8, size: i32, cursor: i32, end: *mut i64, written: *mut i32) -> i32;
    pub fn send_async_streaming(h: i32, body: i32, p: *const u8, n: i32, out: *mut i32) -> i32;
    pub fn pending_req_poll_v2(h: i32, detail: *mut i32, done: *mut i32, resp: *mut i32, body: *mut i32) -> i32;
}
#[link(wasm_import_module = "fastly_http_resp")]
extern "C" {
    #[link_name = "new"] pub fn resp_new(out: *mut i32) -> i32;
    #[link_name = "close"] pub fn resp_close(h: i32) -> i32;
    pub fn status_get(h: i32, out: *mut u16) -> i32;
    pub fn status_set(h: i32, status: i32) -> i32;
    pub fn header_append(h: i32, p: *const u8, n: i32, v: *const u8, size: i32) -> i32;
    pub fn header_names_get(h: i32, p: *mut u8, n: i32, cursor: i32, end: *mut i64, written: *mut i32) -> i32;
    #[link_name = "header_values_get"]
    pub fn resp_values(h: i32, p: *const u8, n: i32, v: *mut u8, size: i32, cursor: i32, end: *mut i64, written: *mut i32) -> i32;
    pub fn send_downstream(h: i32, body: i32, streaming: i32) -> i32;
}
#[link(wasm_import_module = "fastly_http_body")]
extern "C" {
    #[link_name = "new"] pub fn body_new(out: *mut i32) -> i32;
    #[link_name = "close"] pub fn body_close(h: i32) -> i32;
    pub fn abandon(h: i32) -> i32;
    pub fn read(h: i32, p: *mut u8, n: i32, out: *mut i32) -> i32;
    pub fn write(h: i32, p: *const u8, n: i32, end: i32, out: *mut i32) -> i32;
}
#[link(wasm_import_module = "fastly_async_io")]
extern "C" {
    pub fn is_ready(h: i32, out: *mut i32) -> i32;
    pub fn select(handles: *const i32, n: i32, timeout: i32, out: *mut i32) -> i32;
}
