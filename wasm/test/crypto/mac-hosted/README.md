# MAC hosted closeout — 2026-11-27

All 18 hosted Fastly Native request-proof checks passed using the **unchanged**
39,889-byte Wasm retained by MAC-03's isolated installed-consumer qualification.
The runner used the real `app_secrets` binding and checked the existing synthetic
Bearer header on every request. No product, provider or harness fix was needed.

## Identity and evidence

| Identity | Value |
| --- | --- |
| Qualified source | `9829a509bf4914c685cf8c642a451647495c81bb` |
| Merged `latest` source | `c50da11c58c90557a801d94346e799f026349c6d` |
| Identical complete Git tree | `fab4fc47965dcabba471ca90cbd4a47a93d79bcf` |
| Installed receipt SHA-256 | `673a7431af53354e24d0fa6a60bcc8df34bbbf90f6f3c1b261e003d53145f38f` |
| Deployed Wasm SHA-256 | `a5bf015c81f7706a0db19a5b863fb19120bab16bd0b60dd21794575e7a1b3764` |
| Package SHA-256 | `bab8dd605403d4d8daa11b0e0dc1d61f4bd8926885efd45bd5405b3ac362867f` |

`source-binding.json` binds the original qualification to the merged source by
tree equality. `installed.json` and `acceptance.json` are original, unchanged
receipts; their local `hostedQualified: false` is historical and is supplemented
by `hosted-attempt1.json`, not rewritten. The original complete package closure,
fixture and build remain in `pulse-mac03-qualified-bundle.zip`.

The retained archive, `package.json` and `hosted-config.json` bind its Wasm and
Fastly SHA-512 files hash. The unmodified `mac03/hosted.cjs` checked active version,
domain and package identity before and after traffic. `identity-before.json` and
`identity-after.json` additionally check the real secret-store binding. Config
paths identify the original run; a replay needs fresh local paths and a new
service, configuration and receipt.

## Coverage

| Hosted cases | Expected result |
| --- | --- |
| Fresh Unicode/NUL proof; maximum 64 KiB NUL and multibyte text | `valid` |
| Changed message/key; first, middle and last tag bytes | `invalid-authenticator` |
| Uppercase, short, nonhex and missing tags; unpaired surrogate | `invalid-input` |
| ASCII and multibyte messages exceeding 65,536 UTF-8 bytes | `too-large` |
| Absent, 31-byte and 4,097-byte secrets | `invalid-key` |

Every request passed the exact bounded response-shape assertion and both
`authorizationPreserved` and `existingBearer` checks. The separate local
proof-contract task passed all seven evidence-tampering controls and all 18
response controls (`proof-contract.log`). Unsupported algorithms/realizations,
redaction, cancellation, primitive review and four-realization parity retain
their MAC-01/02/03 evidence; the hosted run does not replace those tests.

## Operations and cleanup

The owner supplied a temporary credential and explicitly authorized recreating
the other credentials for this proof. `control.py` created one dedicated Compute
service and one secret store, provisioned random keys, bound `app_secrets`,
uploaded the retained package and activated version 1. No existing service was
modified. `api-audit.jsonl` records methods, paths and statuses, never bodies or
credentials. The runner only inspected state and sent proof traffic.

`cleanup.json` is passing: the service was deactivated and deleted; Fastly's
retained service tombstone has a deletion timestamp and every version inactive.
The deleted secret store returns HTTP 404. Local generated proof-key material
was removed. The supplied management token was not revoked. Credential scans
found no raw/base64 proof keys or management token in terminal proof evidence.

Intermediate failures remain explicit:

- `package-build.log`: the CLI build command removed staged output before its
  check-only script. The original retained artifact was unchanged. Direct tar
  packaging avoided compilation and metadata annotation; the pinned CLI verified
  the files hash and Fastly confirmed the uploaded archive/files hashes.
- `readiness.json`: three initial HTTP 500 responses. Later requests succeeded
  without changing package, service version or bindings; propagation is a likely
  explanation, not a proven root cause. `readiness-after-propagation.json` and
  the complete hosted receipt retain the successful observations.
- `cleanup-attempt1.json`: resource deletion succeeded, but an assertion expected
  service GET to return 404. Fastly retains a deleted-service tombstone. The final
  controller explicitly verifies that tombstone and inactive versions, plus the
  store's 404. The verification retry issued no additional DELETE operations.
- `hosted-blocked.json`: the earlier run lacked hosted credentials/configuration.
  It remains historical; the later exact-artifact hosted receipt is passing.

## Reproduction and limits

`package-retained.py` archives only the original `build/fastly.toml` and
`build/bin/main.wasm`, checks the installed receipt's Wasm digest, and invokes
the pinned Fastly CLI only for version/files-hash inspection. Its output was
reproduced byte-for-byte against the deployed archive. CLI v16.1.0 linux-amd64:

- Archive: `https://github.com/fastly/cli/releases/download/v16.1.0/fastly_v16.1.0_linux-amd64.tar.gz`
- Archive SHA-256: `48e8b1dcf9fbe44c21fac06e32c3f9f670c1e9c611776199bfe61990e6dbe7ad`
- Binary SHA-256: `56bdd56d086d419ba335488fb3ed814050c75e2b16741c5676af2163bc40bbc1`

Follow [MAC-03](../mac-03.md#hosted-completion) for the unchanged hosted runner.
The captured controller requires separately authorized provisioning, a private
`--auth-dir` with a mode-0600 `api-token`, and fresh `--output`; it is an operational
record, not an automatically executed CI task. This environment required
`NODE_USE_ENV_PROXY=1` for Node's requests. Never put credentials in command
arguments, reports or this directory.

This is feature acceptance for one exact development artifact on Fastly Native.
It is not an npm publication, aggregate release seal, Fastly JavaScript hosted
qualification, replay/authentication protocol or performance qualification.
Recorded latency includes client/proxy/transport overhead and establishes
neither provider compute time nor constant-time cryptography. The existing
returned-path staging checks do not claim whole-heap or terminal-trap erasure.
