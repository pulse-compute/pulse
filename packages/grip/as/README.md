# @pulse-compute/grip PulseWasm sidecar

This directory contains the package-owned AssemblyScript sidecar symbols used by
supported package-root Native lowering. The older
`@pulse-compute/grip/pulsewasm` surface remains compatibility-only.

The GRIP package owns its manifest, compiler builder, and sidecar declaration.
Canonical TypeScript lowering now emits provider-neutral GRIP effects and the
Fastly provider realizes them. These AssemblyScript symbols remain the focused
compiled-sidecar boundary rather than a userland stream API.
