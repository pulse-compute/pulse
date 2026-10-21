// Fastly wasm32 SendErrorDetail, pinned to Viceroy v0.21.1 / compute-at-edge-abi:
// tag:u32 @0, mask:u32 @4, DNS rcode:u16 @8, DNS info:u16 @10,
// TLS alert:u8 @12, H2 frame:u8 @13, padding @14..15, H2 code:u32 @16.
// https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/wasm_abi/compute-at-edge-abi/typenames.witx
const __PULSE_SEND_ERROR_DETAIL_BYTES: i32 = 20
const __PULSE_SEND_ERROR_DETAIL_WORDS: i32 = __PULSE_SEND_ERROR_DETAIL_BYTES / 4
function __pulse_send_error_detail_reset(detail: usize): void {
  memory.fill(detail, 0, __PULSE_SEND_ERROR_DETAIL_BYTES)
  // Advertise storage for all known optional fields (bits 1..4); bit 0 is reserved.
  // Returned fields and mask are deliberately not exposed as public diagnostics.
  store<u32>(detail + 4, 0x1e)
}
