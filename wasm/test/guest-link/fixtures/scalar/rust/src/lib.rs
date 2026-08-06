#![no_std]

#[unsafe(no_mangle)]
pub extern "C" fn pulse_guest_scalar_mix(left: u32, right: u32) -> u32 {
    left.rotate_left(5) ^ right.wrapping_mul(0x9e37_79b9) ^ 0x5055_4c53
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}
