export default {
  "cases": [
    {
      "name": "ordinary",
      "request": {
        "method": "POST",
        "path": "/candidate",
        "headers": {
          "content-type": "application/json"
        },
        "body": "{\"title\": \"M2 candidate\"}"
      },
      "expect": {
        "status": 200,
        "json": {
          "text": "{\"schemaVersion\":1,\"resourceId\":\"resource-1\",\"title\":\"M2 candidate\"}",
          "byteLength": 68,
          "sha256": "f9d32470012b3c273f62829f11353a29876bee4cd8ebda241019ef2583d179e1"
        }
      },
      "secrets": {
        "ENCODE_ACCESS_ID": "FIXTURE_ACCESS_ID",
        "ENCODE_SECRET": "FIXTURE_SECRET_NOT_A_CREDENTIAL"
      },
      "fetches": {
        "PUT https://schema-objects.invalid/schema-probe/candidate.json": {
          "status": 200,
          "headers": {
            "etag": "\"fixture\""
          },
          "body": ""
        }
      }
    },
    {
      "name": "escaped",
      "request": {
        "method": "POST",
        "path": "/candidate",
        "headers": {
          "content-type": "application/json"
        },
        "body": "{\"title\": \"Quoted \\\"title\\\"\\nwith backslash \\\\\"}"
      },
      "expect": {
        "status": 200,
        "json": {
          "text": "{\"schemaVersion\":1,\"resourceId\":\"resource-1\",\"title\":\"Quoted \\\"title\\\"\\nwith backslash \\\\\"}",
          "byteLength": 91,
          "sha256": "fd04ef4e3978efda2a1c05c63856fb6942fd003f1b8d9a21caa8fe4ede4a298b"
        }
      },
      "secrets": {
        "ENCODE_ACCESS_ID": "FIXTURE_ACCESS_ID",
        "ENCODE_SECRET": "FIXTURE_SECRET_NOT_A_CREDENTIAL"
      },
      "fetches": {
        "PUT https://schema-objects.invalid/schema-probe/candidate.json": {
          "status": 200,
          "headers": {
            "etag": "\"fixture\""
          },
          "body": ""
        }
      }
    },
    {
      "name": "unicode",
      "request": {
        "method": "POST",
        "path": "/candidate",
        "headers": {
          "content-type": "application/json"
        },
        "body": "{\"title\": \"Catalog — café 🙂\"}"
      },
      "expect": {
        "status": 200,
        "json": {
          "text": "{\"schemaVersion\":1,\"resourceId\":\"resource-1\",\"title\":\"Catalog — café 🙂\"}",
          "byteLength": 78,
          "sha256": "a79e026e3e4dc96f349180ef0951f20905d2c3ddc2687b35819316c861af043d"
        }
      },
      "secrets": {
        "ENCODE_ACCESS_ID": "FIXTURE_ACCESS_ID",
        "ENCODE_SECRET": "FIXTURE_SECRET_NOT_A_CREDENTIAL"
      },
      "fetches": {
        "PUT https://schema-objects.invalid/schema-probe/candidate.json": {
          "status": 200,
          "headers": {
            "etag": "\"fixture\""
          },
          "body": ""
        }
      }
    }
  ]
}
