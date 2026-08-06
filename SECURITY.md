# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through [GitHub's security advisory form](https://github.com/pulse-compute/pulse/security/advisories/new).

Do not open a public issue for vulnerabilities involving containment, capability bypass, path or package escape, secret exposure, generated artifact integrity, or release publication. Do not include real credentials, private endpoints, proprietary code, customer data, or unnecessary exploit detail.

Include the affected release and package, target provider, threat model, reproduction, expected boundary, observed result, and any temporary mitigation.

## Supported releases

The current Beta release listed in
`release/pulse-release-manifest.json` receives security fixes. Pre-public
development snapshots remain internal history and do not receive a separate
support window.

## Security boundary

WebAssembly is one layer of containment, not a complete security claim by itself. Pulse relies on explicit host capabilities, bounded inputs and outputs, provider isolation, package and path containment, and release verification. A report that crosses one of those boundaries is security relevant even when it does not execute native code.
