export default {
  "cases": [
    {
      "name": "conditional KV consumer",
      "request": {
        "method": "POST",
        "path": "/conditional-kv"
      },
      "expect": {
        "status": 200,
        "json": {
          "created": "stored",
          "duplicate": "conflict",
          "read": "found",
          "updated": "stored",
          "stale": "conflict",
          "value": "updated",
          "generationChanged": true
        }
      }
    },
    {
      "name": "S3 consumer",
      "request": {
        "method": "POST",
        "path": "/objects"
      },
      "expect": {
        "status": 200,
        "json": {
          "written": {
            "status": "stored",
            "byteLength": 8,
            "sha256": "67d5c746b15f6160ec6d75889393306905547c0df113b2cda54521981eac4f5e",
            "etag": "\"test-fixture\""
          },
          "metadata": {
            "status": "found",
            "byteLength": 8,
            "etag": "\"test-fixture\"",
            "contentType": "text/plain; charset=utf-8"
          },
          "object": {
            "status": "found",
            "byteLength": 8,
            "etag": "\"test-fixture\"",
            "contentType": "text/plain; charset=utf-8",
            "text": "storage!",
            "sha256": "67d5c746b15f6160ec6d75889393306905547c0df113b2cda54521981eac4f5e"
          }
        }
      },
      "secrets": {
        "TEST_ACCESS_ID": "TEST_FIXTURE_ACCESS_ID",
        "TEST_SECRET": "TEST_FIXTURE_SECRET_NOT_A_REAL_CREDENTIAL"
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
    {
      "name": "invalid key fails before dispatch",
      "request": {
        "method": "POST",
        "path": "/invalid-object-key"
      },
      "expect": {
        "status": 200,
        "json": {
          "status": "not-stored",
          "reason": "invalid-key"
        }
      }
    }
  ]
}
