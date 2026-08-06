#![no_std]

const FNV_OFFSET_BASIS: u32 = 0x811c_9dc5;
const FNV_PRIME: u32 = 0x0100_0193;
const INVALID_RANGE: u32 = 0x8000_0000;
const VALID_RESULT_MASK: u32 = 0x7fff_ffff;
const MAX_INPUT_LENGTH: u32 = 4096;
const DOMAIN_LENGTH: usize = 4;
static GUEST_LAYOUT_MARKER: [u8; 16] = *b"PLS2RU-A2-MARKER";

#[unsafe(no_mangle)]
pub extern "C" fn pulse_guest_layout_marker_pointer() -> u32 {
    GUEST_LAYOUT_MARKER.as_ptr() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn pulse_guest_span_checksum(pointer: u32, length: u32) -> u32 {
    if length > MAX_INPUT_LENGTH {
        return INVALID_RANGE;
    }

    let memory_bytes = core::arch::wasm32::memory_size::<0>() * 65536;
    let start = pointer as usize;
    let size = length as usize;
    let Some(end) = start.checked_add(size) else {
        return INVALID_RANGE;
    };
    if end > memory_bytes {
        return INVALID_RANGE;
    }
    let mut hash = FNV_OFFSET_BASIS;
    let mut domain_index = 0usize;
    while domain_index < DOMAIN_LENGTH {
        let byte = unsafe {
            core::ptr::read_volatile(GUEST_LAYOUT_MARKER.as_ptr().add(domain_index))
        };
        hash ^= byte as u32;
        hash = hash.wrapping_mul(FNV_PRIME);
        domain_index += 1;
    }
    if length == 0 {
        return hash & VALID_RESULT_MASK;
    }

    let mut index = 0usize;
    while index < size {
        let byte = unsafe { core::ptr::read((start + index) as *const u8) };
        hash ^= byte as u32;
        hash = hash.wrapping_mul(FNV_PRIME);
        index += 1;
    }
    hash & VALID_RESULT_MASK
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}
