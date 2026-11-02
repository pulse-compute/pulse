function requiredImportsForPlan(plan, bindings) {
  const keys = new Set([
    'fastly_abi:init',
    'fastly_http_req:body_downstream_get',
    'fastly_http_req:method_get',
    'fastly_http_req:uri_get',
    'fastly_http_resp:new',
    'fastly_http_resp:status_set',
    'fastly_http_resp:send_downstream',
    'fastly_http_body:new',
    'fastly_http_body:write'
  ]);
  if (bindings && bindings.maxDurationMs !== undefined) { keys.add('wasi_snapshot_preview1:clock_time_get'); keys.add('fastly_async_io:select'); keys.add('fastly_http_req:header_value_get'); }
  const kinds = new Set((plan.effects || []).map((effect) => effect.kind));
  if (kinds.has('fetch') || kinds.has('grip.publish') || kinds.has('grip.broadcast')) {
    for (const key of [
      'fastly_http_req:new', 'fastly_http_req:method_set', 'fastly_http_req:uri_set',
      'fastly_http_req:header_append', 'fastly_http_req:send_async', 'fastly_http_req:pending_req_wait_v2'
    ]) keys.add(key);
  }
  if (bindings && dynamicBackends.active(bindings)) keys.add('fastly_http_req:register_dynamic_backend');
  if (plan.effects.some(effect=>effect.fetchTiming)) keys.add('fastly_async_io:is_ready');
  if (kinds.has('fetch')) for (const key of ['wasi_snapshot_preview1:clock_time_get', 'fastly_async_io:select', 'fastly_http_req:pending_req_poll_v2', 'fastly_http_resp:close', 'fastly_http_body:close']) keys.add(key);
  if (planRequiresFetchBodyRead(plan)) keys.add('fastly_http_body:read');
  if (kinds.has('config.get')) for (const key of ['fastly_config_store:open', 'fastly_config_store:get']) keys.add(key);
  const gripAuthenticationRequired = kinds.has('grip.broadcast')
    && (!bindings || Boolean(bindings.grip && bindings.grip.authentication));
  const jwtSecretRequired = (plan.effects || []).some((effect) => (
    ['jwt.verify', 'jwt.sign'].includes(effect.kind)
    && effect.resource
    && effect.resource.keyType === 'secret'
  ));
  if (kinds.has('secret.get') || jwtSecretRequired || gripAuthenticationRequired) {
    for (const key of ['fastly_secret_store:open', 'fastly_secret_store:get', 'fastly_secret_store:plaintext']) keys.add(key);
  }
  for (const kind of conditionalKv.KV_CONDITIONAL_KINDS) if (kinds.has(kind)) for (const key of conditionalKv.kvImports(kind)) keys.add(key);
  if (kinds.has('jwt.verify') || kinds.has('jwt.sign') || kinds.has('time.now')) keys.add('wasi_snapshot_preview1:clock_time_get');
  if (kinds.has('kv.get') || kinds.has('kv.put') || kinds.has('assets.lookup')) keys.add('fastly_kv_store:open');
  if (kinds.has('kv.get') || kinds.has('assets.lookup')) for (const key of ['fastly_kv_store:lookup', 'fastly_kv_store:lookup_wait_v2', 'fastly_http_body:read']) keys.add(key);
  if (kinds.has('kv.put')) for (const key of ['fastly_kv_store:insert', 'fastly_kv_store:insert_wait']) keys.add(key);
  if (kinds.has('grip.hold')) keys.add('fastly_http_resp:header_append');
  if (bindings?.maxDurationMs !== undefined || (plan.logging && plan.logging.enabledStatements > 0) || ['fetch', 'grip.publish', 'grip.broadcast', 's3.head', 's3.getText', 's3.putText', 's3.getBody'].some(kind => kinds.has(kind))) {
    if (bindings?.logEndpoint === undefined) keys.add('wasi_snapshot_preview1:fd_write');
    else { keys.add('fastly_log:endpoint_get'); keys.add('fastly_log:write'); }
  }
  if (kinds.has('s3.head') || kinds.has('s3.getText') || kinds.has('s3.putText') || kinds.has('s3.getBody')) for (const key of require('./s3-native.js').S3_IMPORTS) keys.add(key);
  if (require('./native-body-forwarding.js').enabled(plan)) {
    keys.delete('fastly_http_req:header_append'); keys.add('fastly_http_req:header_insert');
    keys.delete('fastly_http_req:send_async'); keys.delete('fastly_http_req:pending_req_wait_v2');
    for (const key of require('./native-body-forwarding.js').IMPORTS) keys.add(key);
    keys.add('fastly_http_body:read');
  }
  return Object.freeze([...keys].sort());
}
