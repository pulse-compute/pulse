// Test-only guest implementations. The host owns values, routes, effects and
// lifecycle exactly as it does for Pulse Native. This is not a Rust lowerer.
#![allow(dead_code)]
include!("plan.rs");
#[link(wasm_import_module = "pulse_host")]
extern "C" {
    fn value_object() -> i32;
    fn value_object_set(object: i32, key: i32, value: i32);
    fn value_property(object: i32, key: i32) -> i32;
    fn value_string(ptr: *const u16, length: i32) -> i32;
    fn value_boolean(value: i32) -> i32;
    fn value_number(value: f64) -> i32;
    fn value_undefined() -> i32;
    fn value_truthy(value: i32) -> i32;
    fn value_binary(op: i32, left: i32, right: i32) -> i32;
    fn request_method() -> i32;
    fn request_path() -> i32;
    fn request_json(schema: i32) -> i32;
    fn router_match(path: i32, pattern: i32) -> i32;
    fn router_param(path: i32, pattern: i32, name: i32) -> i32;
    fn response_json(value: i32, options: i32) -> i32;
    fn response_text(value: i32, options: i32) -> i32;
    fn effect_begin(index: i32, payload: i32);
}
// Static literals are embedded as UTF-16, matching the Pulse guest boundary.
unsafe fn string(value: &[u16]) -> i32 {
    value_string(value.as_ptr(), value.len() as i32)
}
unsafe fn object(fields: &[(&[u16], i32)]) -> i32 {
    let result = value_object();
    for (key, value) in fields { value_object_set(result, string(key), *value); }
    result
}
unsafe fn status(code: f64) -> i32 { object(&[(&[115,116,97,116,117,115], value_number(code))]) }
unsafe fn matches(method: &[u16], pattern: &[u16]) -> bool {
    value_truthy(value_binary(0, request_method(), string(method))) != 0
        && value_truthy(router_match(request_path(), string(pattern))) != 0
}
static mut STARTED: bool = false;
static mut RESULT: i32 = 0;
static mut ERROR: i32 = 0;
static mut PENDING: bool = false;
static mut READY: bool = false;
static mut INPUT: i32 = 0;
static mut ORIGIN: i32 = 0;
#[no_mangle] pub extern "C" fn pulse_abi_version() -> i32 { 2 }
#[no_mangle] pub extern "C" fn pulse_plan_hash_ptr() -> *const u16 { PLAN_HASH.as_ptr() }
#[no_mangle] pub extern "C" fn pulse_plan_hash_length() -> i32 { PLAN_HASH.len() as i32 }
#[no_mangle] pub unsafe extern "C" fn pulse_start() -> i32 {
    if STARTED { ERROR = 1; return -1; }
    STARTED = true; ERROR = 0;
    run()
}
#[no_mangle] pub unsafe extern "C" fn pulse_result_handle() -> i32 { RESULT }
#[no_mangle] pub unsafe extern "C" fn pulse_last_error_code() -> i32 { ERROR }
#[no_mangle] pub unsafe extern "C" fn pulse_pending_count() -> i32 { i32::from(PENDING) }
#[no_mangle] pub extern "C" fn pulse_program_counter() -> i32 { 1 }
#[no_mangle] pub unsafe extern "C" fn pulse_continuation_state() -> i32 { if PENDING { CONTINUATION } else { 0 } }
#[no_mangle] pub unsafe extern "C" fn pulse_resume() -> i32 {
    if !PENDING || !READY { ERROR = 2; return -2; }
    PENDING = false; READY = false; ERROR = 0;
    finish()
}
#[no_mangle] pub unsafe extern "C" fn pulse_set_effect_result(index:i32, handle:i32) -> i32 {
    if !PENDING || READY || index != 0 || handle <= 0 { ERROR = 3; return 0; }
    ORIGIN = handle; READY = true; 1
}
include!("application.rs");
#[cfg(feature = "schemas")]
mod codecs {
    use std::alloc::{alloc, dealloc, Layout};
    use serde::{Serialize, Deserialize};
    unsafe fn read(pointer: usize) -> String {
        let bytes = *((pointer - 4) as *const u32) as usize;
        assert_eq!(bytes % 2, 0);
        String::from_utf16(std::slice::from_raw_parts(pointer as *const u16, bytes / 2)).unwrap()
    }
    #[no_mangle] pub unsafe extern "C" fn __new(size: usize, _: i32) -> usize {
        let layout = Layout::from_size_align(size.checked_add(4).unwrap(), 4).unwrap();
        let start = alloc(layout); assert!(!start.is_null());
        *(start as *mut u32) = size as u32;
        start as usize + 4
    }
    #[no_mangle] pub extern "C" fn __pin(pointer: usize) -> usize { pointer }
    #[no_mangle] pub unsafe extern "C" fn __unpin(pointer: usize) {
        let size = *((pointer - 4) as *const u32) as usize;
        dealloc((pointer - 4) as *mut u8, Layout::from_size_align(size + 4, 4).unwrap());
    }
    #[no_mangle] pub extern "C" fn pulse_schema_string_id() -> i32 { 1 }
    unsafe fn write(text: &str) -> usize {
        let units: Vec<u16> = text.encode_utf16().collect();
        let pointer = __new(units.len() * 2, 1);
        std::ptr::copy_nonoverlapping(units.as_ptr(), pointer as *mut u16, units.len());
        pointer
    }
    fn roundtrip<T: for<'a> Deserialize<'a> + Serialize>(text: &str) -> String {
        serde_json::to_string(&serde_json::from_str::<T>(text).unwrap()).unwrap()
    }
    include!("schemas.rs");
    #[no_mangle] pub unsafe extern "C" fn pulse_schema_decode(index: i32, pointer: usize) -> usize { write(&codec(index, &read(pointer))) }
    #[no_mangle] pub unsafe extern "C" fn pulse_schema_encode(index: i32, pointer: usize) -> usize { write(&codec(index, &read(pointer))) }
}
