# Fastly documentation delivery templates

These files describe the reviewed delivery layer for the generated Pulse documentation site. They are not activated automatically and do not provide an automated Fastly service activation mechanism.

The production flow is:

```text
Git tag
→ documentation-deploy.yml
→ immutable exact-version objects
→ npm release verification
→ root/latest promotion
→ Fastly VCL private origin
```

## Service setup

1. Create one Fastly Object Storage bucket in the selected region.
2. Create a bucket-limited, read/write key for the protected GitHub `documentation-production` environment.
3. Create a separate bucket-limited, read-only key for the VCL origin.
4. Configure a Fastly backend whose hostname and host override match the regional `*.object.fastlystorage.app` endpoint.
5. Install the routing, signing, response, and error snippets from this directory in a human-reviewed service version.
6. Replace all uppercase placeholders through the service configuration. Never commit credentials.
7. Activate the service manually, then run the public verification command documented in `docs/maintainers/documentation-deployment.md`.

Fastly Object Storage uses path-style addressing. Backend requests therefore take the form:

```text
/<bucket>/pulse/<generated object>
```

The default path-based route retains `/pulse` in the public URL. The public base path and the Object Storage prefix are independent: `examples/host-routing.vcl` can map a dedicated documentation host at `/` to the same `pulse` storage prefix. Before activating that form, rebuild the generated site with the release-owned public base path set to `/`; no object-prefix migration is required.

## Operational boundaries

- Only `GET` and `HEAD` reach Object Storage.
- Exact-version objects are cached as immutable.
- Version-specific deployment receipts are cached as immutable alongside the exact-version tree.
- Root, `latest`, and version-selection manifests use a short cache policy.
- The deployer never issues delete operations.
- Mutable payloads are uploaded before `latest/index.html` and root `index.html`, which are the final publication points.
- GitHub Actions deploys objects; it does not create buckets, rotate keys, edit VCL, or activate a Fastly service.
- The checked-in VCL is statically validated by the publication control plane. A release owner must still compile and activate it in the target Fastly service.

Every production change requires a human release/infrastructure owner to review the generated deployment evidence and activate the service version.
