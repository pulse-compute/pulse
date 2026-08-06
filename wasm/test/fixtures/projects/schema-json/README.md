# Canonical JSON schema project fixture

This fixture proves the public project path:

```text
canonical .pulse/config.ts plus pulse.schema registry
→ TypeScript schema lowering
→ linked canonical handler schema references
→ shared Node/Fastly codecs
→ schema-backed request decode, fetch decode, and response encode
```

Schema IDs are explicit and exact. No arbitrary TypeScript type discovery occurs.
