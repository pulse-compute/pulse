// Isolated offline fixtures only. No credentials or live service authority.
import { defineConfig } from '@pulse-compute/pulse'
export default defineConfig((_scope) => ({
  "pulse": {
    "entry": "src/index.ts",
    "tests": "tests/pulse.harness.ts",
    "defaultProfile": "local",
    "strict": false,
    "crypto": [
      "SHA-256",
      "HMAC-SHA256"
    ]
  },
  "local": {
    "host": "node",
    "target": "native",
    "outDir": "dist/local",
    "dev": {
      "networkFetch": false,
      "secrets": {
        "TEST_ACCESS_ID": "TEST_FIXTURE_ACCESS_ID",
        "TEST_SECRET": "TEST_FIXTURE_SECRET_NOT_A_REAL_CREDENTIAL"
      },
      "kv": {
        "authority": {}
      },
      "fetches": {
        "PUT https://storage-objects.invalid/test-probe/test/candidate.json": {
          "status": 200,
          "headers": {
            "etag": "\"test-fixture\""
          },
          "body": ""
        },
        "HEAD https://storage-objects.invalid/test-probe/test/candidate.json": {
          "status": 200,
          "headers": {
            "content-length": "8",
            "content-type": "text/plain; charset=utf-8",
            "etag": "\"test-fixture\""
          },
          "body": ""
        },
        "GET https://storage-objects.invalid/test-probe/test/candidate.json": {
          "status": 200,
          "headers": {
            "content-length": "8",
            "content-type": "text/plain; charset=utf-8",
            "etag": "\"test-fixture\""
          },
          "body": "storage!"
        }
      }
    },
    "node": {
      "bindings": {
        "s3": {
          "objects": {
            "endpoint": "https://storage-objects.invalid",
            "bucket": "test-probe",
            "region": "test-region",
            "accessKeyIdSecret": "TEST_ACCESS_ID",
            "secretAccessKeySecret": "TEST_SECRET",
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
    "dev": {
      "networkFetch": false,
      "secrets": {
        "TEST_ACCESS_ID": "TEST_FIXTURE_ACCESS_ID",
        "TEST_SECRET": "TEST_FIXTURE_SECRET_NOT_A_REAL_CREDENTIAL"
      },
      "kv": {
        "authority": {}
      },
      "fetches": {
        "PUT https://storage-objects.invalid/test-probe/test/candidate.json": {
          "status": 200,
          "headers": {
            "etag": "\"test-fixture\""
          },
          "body": ""
        },
        "HEAD https://storage-objects.invalid/test-probe/test/candidate.json": {
          "status": 200,
          "headers": {
            "content-length": "8",
            "content-type": "text/plain; charset=utf-8",
            "etag": "\"test-fixture\""
          },
          "body": ""
        },
        "GET https://storage-objects.invalid/test-probe/test/candidate.json": {
          "status": 200,
          "headers": {
            "content-length": "8",
            "content-type": "text/plain; charset=utf-8",
            "etag": "\"test-fixture\""
          },
          "body": "storage!"
        }
      }
    },
    "node": {
      "bindings": {
        "s3": {
          "objects": {
            "endpoint": "https://storage-objects.invalid",
            "bucket": "test-probe",
            "region": "test-region",
            "accessKeyIdSecret": "TEST_ACCESS_ID",
            "secretAccessKeySecret": "TEST_SECRET",
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
    "dev": {
      "networkFetch": false,
      "secrets": {
        "TEST_ACCESS_ID": "TEST_FIXTURE_ACCESS_ID",
        "TEST_SECRET": "TEST_FIXTURE_SECRET_NOT_A_REAL_CREDENTIAL"
      },
      "kv": {
        "authority": {}
      },
      "fetches": {
        "PUT https://storage-objects.invalid/test-probe/test/candidate.json": {
          "status": 200,
          "headers": {
            "etag": "\"test-fixture\""
          },
          "body": ""
        },
        "HEAD https://storage-objects.invalid/test-probe/test/candidate.json": {
          "status": 200,
          "headers": {
            "content-length": "8",
            "content-type": "text/plain; charset=utf-8",
            "etag": "\"test-fixture\""
          },
          "body": ""
        },
        "GET https://storage-objects.invalid/test-probe/test/candidate.json": {
          "status": 200,
          "headers": {
            "content-length": "8",
            "content-type": "text/plain; charset=utf-8",
            "etag": "\"test-fixture\""
          },
          "body": "storage!"
        }
      }
    },
    "fastly": {
      "bindings": {
        "s3": {
          "objects": {
            "endpoint": "https://storage-objects.invalid",
            "bucket": "test-probe",
            "region": "test-region",
            "accessKeyIdSecret": "TEST_ACCESS_ID",
            "secretAccessKeySecret": "TEST_SECRET",
            "maxTextBytes": 4096,
            "backend": "storage_objects"
          }
        },
        "kv": {
          "authority": "storage_state"
        },
        "secretStore": "storage_secrets",
        "dynamicBackends": false
      }
    }
  }
}))
