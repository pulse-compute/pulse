// Package-owned AssemblyScript sidecar declaration for @pulse-compute/grip.
//
// These exports intentionally expose only the static ABI symbols declared by
// pulsewasm.manifest.cjs for this first-party lowerable package. Provider and
// runtime GRIP behavior remains outside this sidecar declaration.

export function pulse_grip_hold(modePtr: usize, modeLen: i32, optionsRef: i32): i32 {
  void modePtr;
  void modeLen;
  void optionsRef;
  return 0;
}

export function pulse_grip_channel(channelPtr: usize, channelLen: i32, optionsRef: i32): i32 {
  void channelPtr;
  void channelLen;
  void optionsRef;
  return 0;
}

export function pulse_grip_publish(channelPtr: usize, channelLen: i32, messagePtr: usize, messageLen: i32, optionsRef: i32): i32 {
  void channelPtr;
  void channelLen;
  void messagePtr;
  void messageLen;
  void optionsRef;
  return 0;
}
