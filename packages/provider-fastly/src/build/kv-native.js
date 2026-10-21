'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { KV_CONDITIONAL_KINDS, KV_CONDITIONAL_LIMITS } = require('@pulse-compute/runtime/host');

const KV_IMPORTS = Object.freeze([
  'fastly_async_io:select', 'fastly_http_body:close', 'wasi_snapshot_preview1:clock_time_get',
  'fastly_kv_store:open'
]);
function kvImports(kind) {
  if (kind === 'kv.list') return [...KV_IMPORTS, 'fastly_kv_store:list', 'fastly_kv_store:list_wait', 'fastly_http_body:read'];
  if (kind === 'kv.delete') return [...KV_IMPORTS.filter(key => key !== 'fastly_http_body:close'), 'fastly_kv_store:delete', 'fastly_kv_store:delete_wait'];
  return [...KV_IMPORTS, ...(kind === 'kv.getVersioned'
    ? ['fastly_kv_store:lookup', 'fastly_kv_store:lookup_wait_v2', 'fastly_http_body:read']
    : ['fastly_kv_store:insert', 'fastly_kv_store:insert_wait', 'fastly_http_body:new', 'fastly_http_body:write'])];
}
function kvNativeSource(plan) {
  if (!plan.effects.some(effect => KV_CONDITIONAL_KINDS.includes(effect.kind))) return '';
  const limits = Object.entries(KV_CONDITIONAL_LIMITS).map(([key, value]) => `const __KV_${key}: i32 = ${value};`).join('\n');
  const kinds = new Set(plan.effects.map(effect => effect.kind));
  const selection = `const __KV_HAS_READ: bool = ${kinds.has('kv.getVersioned')};
const __KV_HAS_WRITE: bool = ${kinds.has('kv.insertIfAbsent') || kinds.has('kv.compareAndSwap')};
const __KV_HAS_LIST: bool = ${kinds.has('kv.list')};
const __KV_HAS_DELETE: bool = ${kinds.has('kv.delete')};`;
  return limits + '\n' + selection + '\n' + fs.readFileSync(path.join(__dirname, 'kv-native.as.ts'), 'utf8');
}
module.exports = { KV_CONDITIONAL_KINDS, KV_CONDITIONAL_LIMITS, KV_IMPORTS, kvImports, kvNativeSource };
