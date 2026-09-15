import { defineConfig } from '@pulse-compute/pulse'
export default defineConfig((_scope) => ({
  "pulse": {
    "entry": "src/index.ts",
    "schema": "src/schemas.ts",
    "tests": "tests/pulse.harness.ts",
    "defaultProfile": "local",
    "strict": true
  },
  "local": {
    "host": "node",
    "target": "native",
    "outDir": "dist/local",
    "schemas": {
      "maxBytes": 16384
    },
    "dev": {
      "networkFetch": false,
      "fetches": {
        "https://objects.invalid/candidate": {
          "status": 200,
          "body": "stored"
        }
      }
    }
  },
  "javascript": {
    "host": "node",
    "target": "javascript",
    "outDir": "dist/javascript",
    "schemas": {
      "maxBytes": 16384
    },
    "dev": {
      "networkFetch": false,
      "fetches": {
        "https://objects.invalid/candidate": {
          "status": 200,
          "body": "stored"
        }
      }
    }
  },
  "fastly": {
    "host": "fastly",
    "target": "native",
    "outDir": "dist/fastly",
    "schemas": {
      "maxBytes": 16384
    },
    "dev": {
      "networkFetch": false,
      "fetches": {
        "https://objects.invalid/candidate": {
          "status": 200,
          "body": "stored"
        }
      }
    },
    "fastly": {
      "bindings": {
        "dynamicBackends": false,
        "backends": {
          "https://objects.invalid": "objects"
        }
      }
    }
  }
}))
