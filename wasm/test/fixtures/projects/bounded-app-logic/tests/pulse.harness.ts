export default {
  "cases": [
    {
      "name": "collections",
      "request": {
        "method": "POST",
        "path": "/",
        "headers": {
          "content-type": "application/json"
        },
        "body": "{\n  \"title\": \" Catalog 🙂 \",\n  \"target\": \"resource\",\n  \"command\": \"original\",\n  \"items\": [\n    {\n      \"id\": \" first \",\n      \"version\": 3\n    },\n    {\n      \"id\": \"skip\",\n      \"version\": 1\n    }\n  ],\n  \"grants\": [\n    {\n      \"target\": \"other\",\n      \"members\": [\n        \"actor\"\n      ]\n    },\n    {\n      \"target\": \"resource\",\n      \"members\": [\n        \"other\",\n        \"actor\"\n      ]\n    }\n  ],\n  \"receipts\": [\n    {\n      \"command\": \"newer\",\n      \"result\": \"current\"\n    },\n    {\n      \"command\": \"original\",\n      \"result\": \"retained\"\n    }\n  ]\n}\n"
      },
      "expect": {
        "status": 200,
        "json": {
          "title": "Catalog 🙂",
          "selected": [
            {
              "id": "first",
              "version": 4
            }
          ],
          "visits": 2,
          "member": true,
          "replay": "retained"
        }
      },
      "fetches": {
        "https://objects.invalid/candidate": {
          "status": 200,
          "body": "stored"
        }
      }
    },
    {
      "name": "unicode-trim",
      "request": {
        "method": "POST",
        "path": "/",
        "headers": {
          "content-type": "application/json"
        },
        "body": "{\n  \"title\": \" ﻿Catalog 🙂　\",\n  \"target\": \"resource\",\n  \"command\": \"original\",\n  \"items\": [\n    {\n      \"id\": \" first \",\n      \"version\": 3\n    },\n    {\n      \"id\": \"skip\",\n      \"version\": 1\n    }\n  ],\n  \"grants\": [\n    {\n      \"target\": \"other\",\n      \"members\": [\n        \"actor\"\n      ]\n    },\n    {\n      \"target\": \"resource\",\n      \"members\": [\n        \"other\",\n        \"actor\"\n      ]\n    }\n  ],\n  \"receipts\": [\n    {\n      \"command\": \"newer\",\n      \"result\": \"current\"\n    },\n    {\n      \"command\": \"original\",\n      \"result\": \"retained\"\n    }\n  ]\n}\n"
      },
      "expect": {
        "status": 200,
        "json": {
          "title": "Catalog 🙂",
          "selected": [
            {
              "id": "first",
              "version": 4
            }
          ],
          "visits": 2,
          "member": true,
          "replay": "retained"
        }
      },
      "fetches": {
        "https://objects.invalid/candidate": {
          "status": 200,
          "body": "stored"
        }
      }
    },
    {
      "name": "oversized-collection",
      "request": {
        "method": "POST",
        "path": "/",
        "headers": {
          "content-type": "application/json"
        },
        "body": "{\"title\": \" Catalog \\ud83d\\ude42 \", \"target\": \"resource\", \"command\": \"original\", \"items\": [{\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}, {\"id\": \"x\", \"version\": 1}], \"grants\": [{\"target\": \"other\", \"members\": [\"actor\"]}, {\"target\": \"resource\", \"members\": [\"other\", \"actor\"]}], \"receipts\": [{\"command\": \"newer\", \"result\": \"current\"}, {\"command\": \"original\", \"result\": \"retained\"}]}"
      },
      "expect": {
        "status": 400,
        "text": "invalid"
      },
      "fetches": {
        "https://objects.invalid/candidate": {
          "status": 200,
          "body": "stored"
        }
      }
    }
  ]
}
