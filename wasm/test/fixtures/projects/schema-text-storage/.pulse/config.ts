import { defineConfig } from '@pulse-compute/pulse'
export default defineConfig((_scope) => ({
  "pulse": {
    "entry": "src/index.ts",
    "schema": "src/schemas.ts",
    "tests": "tests/pulse.harness.ts",
    "defaultProfile": "local",
    "strict": true,
    "crypto": [
      "SHA-256",
      "HMAC-SHA256"
    ]
  },
  "local": {
    "host": "node",
    "target": "native",
    "outDir": "dist/local",
    "schemas": {
      "contentTypePolicy": "require-json",
      "maxBytes": 4096
    },
    "dev": {
      "networkFetch": false,
      "secrets": {
        "DECODE_ACCESS_ID": "FIXTURE_ACCESS_ID",
        "DECODE_SECRET": "FIXTURE_SECRET_NOT_A_CREDENTIAL"
      },
      "fetches": {
        "PUT https://decode-objects.invalid/schema-probe/candidate.json": {
          "status": 200,
          "headers": {
            "etag": "\"fixture\""
          },
          "body": ""
        }
      }
    },
    "node": {
      "bindings": {
        "s3": {
          "objects": {
            "endpoint": "https://decode-objects.invalid",
            "bucket": "schema-probe",
            "region": "test-region",
            "accessKeyIdSecret": "DECODE_ACCESS_ID",
            "secretAccessKeySecret": "DECODE_SECRET",
            "maxTextBytes": 4096
          }
        }
      }
    }
  },
  "javascript": {
    "host": "node",
    "target": "javascript",
    "outDir": "dist/javascript",
    "schemas": {
      "contentTypePolicy": "require-json",
      "maxBytes": 4096
    },
    "dev": {
      "networkFetch": false,
      "secrets": {
        "DECODE_ACCESS_ID": "FIXTURE_ACCESS_ID",
        "DECODE_SECRET": "FIXTURE_SECRET_NOT_A_CREDENTIAL"
      },
      "fetches": {
        "PUT https://decode-objects.invalid/schema-probe/candidate.json": {
          "status": 200,
          "headers": {
            "etag": "\"fixture\""
          },
          "body": ""
        }
      }
    },
    "node": {
      "bindings": {
        "s3": {
          "objects": {
            "endpoint": "https://decode-objects.invalid",
            "bucket": "schema-probe",
            "region": "test-region",
            "accessKeyIdSecret": "DECODE_ACCESS_ID",
            "secretAccessKeySecret": "DECODE_SECRET",
            "maxTextBytes": 4096
          }
        }
      }
    }
  },
  "fastly": {
    "host": "fastly",
    "target": "native",
    "outDir": "dist/fastly",
    "schemas": {
      "contentTypePolicy": "require-json",
      "maxBytes": 4096
    },
    "dev": {
      "networkFetch": false,
      "secrets": {
        "DECODE_ACCESS_ID": "FIXTURE_ACCESS_ID",
        "DECODE_SECRET": "FIXTURE_SECRET_NOT_A_CREDENTIAL"
      },
      "fetches": {
        "PUT https://decode-objects.invalid/schema-probe/candidate.json": {
          "status": 200,
          "headers": {
            "etag": "\"fixture\""
          },
          "body": ""
        }
      }
    },
    "fastly": {
      "bindings": {
        "s3": {
          "objects": {
            "endpoint": "https://decode-objects.invalid",
            "bucket": "schema-probe",
            "region": "test-region",
            "accessKeyIdSecret": "DECODE_ACCESS_ID",
            "secretAccessKeySecret": "DECODE_SECRET",
            "maxTextBytes": 4096,
            "backend": "schema_objects"
          }
        },
        "secretStore": "schema_secrets",
        "dynamicBackends": false
      }
    }
  }
}))
