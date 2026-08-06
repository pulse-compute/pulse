@external("pulse_guest_scalar", "pulse_guest_scalar_mix")
declare function pulseGuestScalarMix(left: u32, right: u32): u32

export function pulseScalarLinkControl(left: u32, right: u32): u32 {
  return pulseGuestScalarMix(left, right)
}
