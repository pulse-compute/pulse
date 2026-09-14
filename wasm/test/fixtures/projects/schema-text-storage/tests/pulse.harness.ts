export default {
  "cases": [
    {
      "name": "ordinary",
      "request": {
        "method": "GET",
        "path": "/candidate"
      },
      "expect": {
        "status": 200,
        "json": {
          "title": "M2 candidate",
          "text": "{\n  \"title\": \"M2 candidate\",\n  \"resourceId\": \"resource-1\",\n  \"schemaVersion\": 1,\n  \"ignored\": \"retained in exact text\"\n}\n",
          "sha256": "6d1a4a2008fd192884f5e65fb999e102073c32fabc29939f7760ef7807f6bc84",
          "copiedSha256": "6d1a4a2008fd192884f5e65fb999e102073c32fabc29939f7760ef7807f6bc84"
        }
      },
      "secrets": {
        "DECODE_ACCESS_ID": "FIXTURE_ACCESS_ID",
        "DECODE_SECRET": "FIXTURE_SECRET_NOT_A_CREDENTIAL"
      },
      "fetches": {
        "GET https://decode-objects.invalid/schema-probe/candidate.json": {
          "status": 200,
          "headers": {
            "content-type": "text/plain"
          },
          "body": "{\n  \"title\": \"M2 candidate\",\n  \"resourceId\": \"resource-1\",\n  \"schemaVersion\": 1,\n  \"ignored\": \"retained in exact text\"\n}\n"
        },
        "PUT https://decode-objects.invalid/schema-probe/copy.json": {
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
        "method": "GET",
        "path": "/candidate"
      },
      "expect": {
        "status": 200,
        "json": {
          "title": "Quoted \"title\"\nwith backslash \\",
          "text": "{\n  \"title\": \"Quoted \\\"title\\\"\\nwith backslash \\\\\",\n  \"resourceId\": \"resource-1\",\n  \"schemaVersion\": 1,\n  \"ignored\": \"retained in exact text\"\n}\n",
          "sha256": "1c56fdc1a1fab6b4c2695bdd84422b5482a82ac0ff2659e8d8642415bd0167c9",
          "copiedSha256": "1c56fdc1a1fab6b4c2695bdd84422b5482a82ac0ff2659e8d8642415bd0167c9"
        }
      },
      "secrets": {
        "DECODE_ACCESS_ID": "FIXTURE_ACCESS_ID",
        "DECODE_SECRET": "FIXTURE_SECRET_NOT_A_CREDENTIAL"
      },
      "fetches": {
        "GET https://decode-objects.invalid/schema-probe/candidate.json": {
          "status": 200,
          "headers": {
            "content-type": "text/plain"
          },
          "body": "{\n  \"title\": \"Quoted \\\"title\\\"\\nwith backslash \\\\\",\n  \"resourceId\": \"resource-1\",\n  \"schemaVersion\": 1,\n  \"ignored\": \"retained in exact text\"\n}\n"
        },
        "PUT https://decode-objects.invalid/schema-probe/copy.json": {
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
        "method": "GET",
        "path": "/candidate"
      },
      "expect": {
        "status": 200,
        "json": {
          "title": "Catalog — café 🙂",
          "text": "{\n  \"title\": \"Catalog — café 🙂\",\n  \"resourceId\": \"resource-1\",\n  \"schemaVersion\": 1,\n  \"ignored\": \"retained in exact text\"\n}\n",
          "sha256": "cd14ffffc1cf1d53f41b3a4171460bb6e270e94e89a058992c45e42af72d4730",
          "copiedSha256": "cd14ffffc1cf1d53f41b3a4171460bb6e270e94e89a058992c45e42af72d4730"
        }
      },
      "secrets": {
        "DECODE_ACCESS_ID": "FIXTURE_ACCESS_ID",
        "DECODE_SECRET": "FIXTURE_SECRET_NOT_A_CREDENTIAL"
      },
      "fetches": {
        "GET https://decode-objects.invalid/schema-probe/candidate.json": {
          "status": 200,
          "headers": {
            "content-type": "text/plain"
          },
          "body": "{\n  \"title\": \"Catalog — café 🙂\",\n  \"resourceId\": \"resource-1\",\n  \"schemaVersion\": 1,\n  \"ignored\": \"retained in exact text\"\n}\n"
        },
        "PUT https://decode-objects.invalid/schema-probe/copy.json": {
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
