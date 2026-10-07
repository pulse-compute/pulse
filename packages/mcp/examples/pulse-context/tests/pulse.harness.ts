import { contextCorpus } from '../context-corpus.ts'

const meta = { pulseVersion: contextCorpus.pulseVersion, corpusSchemaVersion: contextCorpus.schemaVersion,
  corpusHash: contextCorpus.corpusHash, snapshotStatus: contextCorpus.status,
  applicationVersion: 'pulse.context-application.v1', requestedVersion: contextCorpus.pulseVersion, maxReplyBytes: 24576 }

export default { cases: [
  { name: 'unknown-record', request: { method: 'POST', path: '/', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'pulse.read', params: { version: contextCorpus.pulseVersion, id: 'missing' } }) },
    expect: { status: 200, json: { jsonrpc: '2.0', id: 1, result: { meta, status: 'unknown-id', truncated: false,
      error: { code: 'unknown-id', message: 'No bundled record has that exact ID.' } } } } },
  { name: 'schema-admission', request: { method: 'POST', path: '/', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'pulse.search', params: { version: contextCorpus.pulseVersion, query: 42 } }) },
    expect: { status: 200, json: { jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'Invalid params' } } } },
] }
