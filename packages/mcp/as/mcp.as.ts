// MCP owns wire admission and framing. Entities owns the selected operation and codecs.
@external("pulse_host", "package_http_version") declare function mcp_host_version(): i32
@external("pulse_host", "request_method") declare function mcp_host_method(): i32
@external("pulse_host", "request_path") declare function mcp_host_path(): i32
@external("pulse_host", "request_headers") declare function mcp_host_headers(): i32
let mcp_headers: JSON.Value = JSON.Value.from<JSON.Arr>(new JSON.Arr())
let mcp_id: string = ''
let mcp_legacy: bool = false
let mcp_no_output: bool = false
let mcp_http_status: i32 = 200
let mcp_http_body: string = ''
let mcp_allow: bool = false
function mcp_value(value: JSON.Value, key: string): JSON.Value { return __pulse_entities_property(value, key) }
function mcp_string(value: JSON.Value): string {
  return value.type == JSON.Types.String ? JSON.parse<string>(JSON.stringify<JSON.Value>(value)) : ''
}
function mcp_object(value: JSON.Value): bool { return value.type == JSON.Types.Object }
function mcp_has(value: JSON.Value, key: string): bool { return mcp_object(value) && value.get<JSON.Obj>().has(key) }
function mcp_header(name: string): string | null {
  const pairs = mcp_headers.get<JSON.Arr>(); let found: string | null = null
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs.at(i).get<JSON.Arr>()
    if (mcp_string(pair.at(0)).toLowerCase() == name) found = found === null ? mcp_string(pair.at(1)) : found! + ', ' + mcp_string(pair.at(1))
  }
  return found
}
function mcp_response_handle(): i32 {
  const response = entity_host_object(), headers = entity_host_object()
  entity_host_set(response, __pulse_package_string('status'), entity_host_number(mcp_http_status))
  entity_host_set(response, __pulse_package_string('body'), __pulse_package_string(mcp_http_body))
  entity_host_set(headers, __pulse_package_string('cache-control'), __pulse_package_string('no-store'))
  if (mcp_http_body.length) entity_host_set(headers, __pulse_package_string('content-type'), __pulse_package_string('application/json'))
  if (mcp_allow) entity_host_set(headers, __pulse_package_string('allow'), __pulse_package_string('POST'))
  entity_host_set(response, __pulse_package_string('headers'), headers)
  return entity_host_response(response)
}
function mcp_send(status: i32, body: string = ''): i32 {
  mcp_http_status = status; mcp_http_body = body
  __pulse_package_result = mcp_response_handle(); return 0
}
function mcp_error(status: i32, code: i32, message: string, data: string = ''): i32 {
  return mcp_send(status, '{"jsonrpc":"2.0"' + (mcp_id.length ? ',"id":' + mcp_id : '') + ',"error":{"code":' + code.toString() + ',"message":' + JSON.stringify<string>(message) + (data.length ? ',"data":' + data : '') + '}}')
}
function mcp_header_error(): i32 { return mcp_error(400, -32020, 'Missing, malformed or mismatched MCP headers', '{"supported":["2026-07-28"]}') }
function mcp_result(result: string): i32 {
  if (!mcp_legacy) result = '{"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":' + MCP_INFO + '}' + (result.length > 2 ? ',' + result.substring(1) : '}')
  const body = '{"jsonrpc":"2.0","id":' + mcp_id + ',"result":' + result + '}'
  if (__pulse_entities_utf8_bytes(body) > MCP_RESPONSE_BYTES) return mcp_error(500, -32603, 'Response body limit exceeded')
  return mcp_send(200, body)
}
function mcp_ascii(value: string): bool {
  if (!value.length) return false
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 0x21 || value.charCodeAt(i) > 0x7e) return false
  return true
}
function mcp_name(value: string | null): string | null {
  if (value === null) return null
  const text = value!
  if (text.startsWith('=?base64?') && text.endsWith('?=')) {
    const input = text.substring(9, text.length - 2), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    if (input.length % 4 != 0) return null
    const bytes = new Uint8Array(input.length / 4 * 3); let length = 0
    for (let i = 0; i < input.length; i += 4) {
      const a = alphabet.indexOf(input.charAt(i)), b = alphabet.indexOf(input.charAt(i + 1))
      const c = alphabet.indexOf(input.charAt(i + 2)), d = alphabet.indexOf(input.charAt(i + 3))
      if (a < 0 || b < 0) return null
      bytes[length++] = <u8>((a << 2) | (b >> 4))
      if (input.charAt(i + 2) == '=') {
        if (input.charAt(i + 3) != '=' || i + 4 != input.length || (b & 15) != 0) return null
      } else {
        if (c < 0) return null
        bytes[length++] = <u8>((b << 4) | (c >> 2))
        if (input.charAt(i + 3) == '=') { if (i + 4 != input.length || (c & 3) != 0) return null }
        else { if (d < 0) return null; bytes[length++] = <u8>((c << 6) | d) }
      }
    }
    const decoded = String.UTF8.decodeUnsafe(bytes.dataStart, length, false)
    const check = Uint8Array.wrap(String.UTF8.encode(decoded))
    if (check.length != length) return null
    for (let i = 0; i < length; i++) if (check[i] != bytes[i]) return null
    return decoded.startsWith('\ufeff') ? decoded.substring(1) : decoded
  }
  if (text.trim() != text) return null
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c != 9 && (c < 32 || c > 126)) return null }
  return text
}
function mcp_accept(header: string | null, type: string): bool {
  if (header === null) return false
  const ranges = header!.toLowerCase().split(',')
  for (let i = 0; i < ranges.length; i++) {
    const parts = ranges[i].split(';'); if (parts[0].trim() != type) continue
    let quality = 0, valid = true
    for (let j = 1; j < parts.length; j++) {
      const part = parts[j].trim(); if (!part.startsWith('q=')) continue
      if (++quality > 1) { valid = false; break }
      const q = part.substring(2)
      if (!q.length || (q.charAt(0) != '0' && q.charAt(0) != '1') || q.length > 5 || (q.length > 1 && q.charAt(1) != '.')) { valid = false; break }
      for (let k = 2; k < q.length; k++) if (q.charCodeAt(k) < 48 || q.charCodeAt(k) > 57 || (q.charAt(0) == '1' && q.charAt(k) != '0')) valid = false
      if (!(parseFloat(q) > 0)) valid = false
    }
    if (valid) return true
  }
  return false
}
function mcp_media(value: string | null): bool {
  if (value === null) return false
  const parts = value!.toLowerCase().trimEnd().split(';')
  if (parts[0].trimEnd() != 'application/json' || parts.length > 2) return false
  if (parts.length == 1) return true
  const charset = parts[1].trim().split('=')
  return charset.length == 2 && charset[0].trim() == 'charset' && (charset[1].trim() == 'utf-8' || charset[1].trim() == '"utf-8"')
}
function mcp_keys(value: JSON.Value, allowed: string[]): bool {
  if (!mcp_object(value)) return false
  const keys = value.get<JSON.Obj>().keys()
  for (let i = 0; i < keys.length; i++) if (!allowed.includes(keys[i])) return false
  return true
}
function mcp_depth(text: string): bool {
  let depth = 0, quoted = false, escaped = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (quoted) { if (escaped) escaped = false; else if (c == 92) escaped = true; else if (c == 34) quoted = false }
    else if (c == 34) quoted = true
    else if (c == 123 || c == 91) { if (++depth > MCP_DEPTH) return false }
    else if (c == 125 || c == 93) depth--
  }
  return true
}
function mcp_client(value: JSON.Value, bounded: bool): bool {
  if (!mcp_object(value)) return false
  const name = mcp_value(value, 'name'), version = mcp_value(value, 'version')
  if (name.type != JSON.Types.String || version.type != JSON.Types.String) return false
  return !bounded || (mcp_string(name).length > 0 && __pulse_entities_utf8_bytes(mcp_string(name)) <= 128 && mcp_string(version).length > 0 && __pulse_entities_utf8_bytes(mcp_string(version)) <= 128)
}
function __pulse_transport_start(): i32 {
  if (mcp_host_version() != 1) { __pulse_package_error = 5; return -1 }
  mcp_headers = JSON.parse<JSON.Value>(changetype<string>(entity_host_json(mcp_host_headers())))
  if (mcp_header('origin') !== null) return mcp_send(403)
  if (JSON.parse<string>(changetype<string>(entity_host_json(mcp_host_path()))) != MCP_PATH) return mcp_send(404)
  if (JSON.parse<string>(changetype<string>(entity_host_json(mcp_host_method()))) != 'POST') { mcp_allow = true; return mcp_send(405) }
  if (!mcp_media(mcp_header('content-type'))) return mcp_send(415)
  if (!mcp_accept(mcp_header('accept'), 'application/json') || !mcp_accept(mcp_header('accept'), 'text/event-stream')) return mcp_send(406)
  const encoding = mcp_header('content-encoding')
  if (encoding !== null && encoding!.toLowerCase() != 'identity') return mcp_send(415)
  const length = mcp_header('content-length')
  if (length !== null) {
    const value = length!
    if (!value.length) return mcp_error(400, -32600, 'Invalid content length')
    for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 48 || value.charCodeAt(i) > 57) return mcp_error(400, -32600, 'Invalid content length')
    const number = parseFloat(value)
    if (!isFinite(number) || number > 9007199254740991) return mcp_error(400, -32600, 'Invalid content length')
    if (number > MCP_REQUEST_BYTES) return mcp_error(413, -32600, 'Request body limit exceeded')
  }
  const text = JSON.parse<string>(changetype<string>(entity_host_json(entity_host_request())))
  if (__pulse_entities_utf8_bytes(text) > MCP_REQUEST_BYTES) return mcp_error(413, -32600, 'Request body limit exceeded')
  if (!mcp_depth(text)) return mcp_error(400, -32600, 'Request nesting limit exceeded')
  __pulse_entities_scan_error = 0
  const end = __pulse_entities_scan_value(text, __pulse_entities_ws(text, 0), 0)
  if (end < 0 || __pulse_entities_ws(text, end) != text.length) return mcp_error(400, -32700, 'Parse error')
  const message = JSON.parse<JSON.Value>(text)
  if (!mcp_object(message)) return mcp_error(400, -32600, 'Invalid request')
  const id = mcp_value(message, 'id')
  if (id.type == JSON.Types.String || (__pulse_entities_is_number(id) && isFinite(__pulse_entities_number(id)) && Math.floor(__pulse_entities_number(id)) == __pulse_entities_number(id) && Math.abs(__pulse_entities_number(id)) <= 9007199254740991)) mcp_id = JSON.stringify<JSON.Value>(id)
  const method = mcp_string(mcp_value(message, 'method'))
  let params = mcp_value(message, 'params')
  if (mcp_string(mcp_value(message, 'jsonrpc')) != '2.0' || !method.length || mcp_has(message, 'result') || mcp_has(message, 'error') || (mcp_has(message, 'id') && !mcp_id.length) || (mcp_has(message, 'params') && !mcp_object(params))) return mcp_error(400, -32600, 'Invalid request')
  if (!mcp_has(message, 'id')) return mcp_send(202)
  const versionHeader = mcp_header('mcp-protocol-version'), methodHeader = mcp_header('mcp-method'), nameHeader = mcp_header('mcp-name')
  const meta = mcp_value(params, '_meta')
  let modernMeta = false
  if (mcp_object(meta)) {
    const keys = meta.get<JSON.Obj>().keys()
    for (let i = 0; i < keys.length; i++) if (keys[i].startsWith('io.modelcontextprotocol/')) modernMeta = true
  }
  mcp_legacy = MCP_LEGACY && methodHeader === null && nameHeader === null && !modernMeta && (versionHeader == '2025-06-18' || (method == 'initialize' && versionHeader === null))
  if (mcp_legacy) {
    if (!mcp_has(message, 'params')) params = JSON.parse<JSON.Value>('{}')
    if (mcp_has(params, '_meta') && !mcp_object(meta)) return mcp_error(400, -32602, 'Invalid request metadata')
  } else {
    if (versionHeader === null || methodHeader === null || methodHeader! != method || !mcp_ascii(methodHeader!) || !mcp_ascii(versionHeader!)) return mcp_header_error()
    const version = mcp_value(meta, 'io.modelcontextprotocol/protocolVersion')
    if (!mcp_object(meta) || version.type != JSON.Types.String || !mcp_object(mcp_value(meta, 'io.modelcontextprotocol/clientCapabilities'))) return mcp_error(400, -32602, 'Invalid request metadata')
    if (mcp_has(meta, 'io.modelcontextprotocol/clientInfo') && !mcp_client(mcp_value(meta, 'io.modelcontextprotocol/clientInfo'), false)) return mcp_error(400, -32602, 'Invalid client information')
    if (versionHeader! != mcp_string(version)) return mcp_header_error()
    if (versionHeader! != '2026-07-28') return mcp_error(400, -32022, 'Unsupported protocol version', '{"supported":["2026-07-28"],"requested":' + JSON.stringify<string>(versionHeader!) + '}')
    const field = method == 'resources/read' ? 'uri' : method == 'tools/call' || method == 'prompts/get' ? 'name' : ''
    if (field.length && (mcp_value(params, field).type != JSON.Types.String || mcp_name(nameHeader) != mcp_string(mcp_value(params, field)))) return mcp_header_error()
  }
  if (mcp_legacy && method == 'initialize') {
    const version = mcp_value(params, 'protocolVersion')
    if (!mcp_keys(params, ['_meta','protocolVersion','capabilities','clientInfo']) || version.type != JSON.Types.String || !mcp_object(mcp_value(params, 'capabilities')) || !mcp_client(mcp_value(params, 'clientInfo'), true)) return mcp_error(400, -32602, 'Invalid initialization params')
    if (mcp_string(version) != '2025-06-18') return mcp_error(400, -32022, 'Unsupported protocol version', '{"supported":["2025-06-18"],"requested":' + JSON.stringify<JSON.Value>(version) + '}')
    return mcp_result('{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},"serverInfo":' + MCP_INFO + '}')
  }
  if ((mcp_legacy && method == 'ping') || (!mcp_legacy && method == 'server/discover') || method == 'tools/list') {
    if (!mcp_keys(params, ['_meta'])) return mcp_error(400, -32602, 'Invalid params')
    if (method == 'ping') return mcp_result('{}')
    if (method == 'server/discover') return mcp_result('{"supportedVersions":["2026-07-28"],"capabilities":{"tools":{"listChanged":false}},"ttlMs":0,"cacheScope":"private"}')
    return mcp_result('{"tools":' + MCP_TOOLS + (mcp_legacy ? '}' : ',"ttlMs":0,"cacheScope":"private"}'))
  }
  if (method != 'tools/call') return mcp_error(404, -32601, 'Method not found')
  const name = mcp_value(params, 'name'), args = mcp_value(params, 'arguments')
  if (!mcp_keys(params, ['_meta','name','arguments']) || name.type != JSON.Types.String || (mcp_has(params, 'arguments') && !mcp_object(args))) return mcp_error(400, -32602, 'Invalid params')
  const selected = mcp_tool_index(mcp_string(name))
  if (selected < 0) return mcp_error(400, -32602, 'Unknown tool')
  mcp_no_output = mcp_tool_no_output(selected)
  // Local, package-owned envelope selection. No provider request or HTTP dispatch.
  const envelope = '{"jsonrpc":"2.0","id":1,"method":' + JSON.stringify<JSON.Value>(name) + ',"params":' + (mcp_has(params, 'arguments') ? JSON.stringify<JSON.Value>(args) : '{}') + '}'
  pulse_entities_set_request(changetype<i32>(envelope))
  return __pulse_package_finish(pulse_entities_start())
}
function __pulse_transport_response(): i32 {
  const response = JSON.parse<JSON.Value>(__pulse_entities_response)
  if (mcp_has(response, 'error')) {
    const code = __pulse_entities_number(mcp_value(mcp_value(response, 'error'), 'code'))
    const message = code == -32602 ? 'Tool input validation failed' : 'Tool execution or output validation failed'
    mcp_result('{"isError":true,"content":[{"type":"text","text":' + JSON.stringify<string>(message) + '}]}')
  } else {
    const encoded = JSON.stringify<JSON.Value>(mcp_value(response, 'result'))
    const result = '{"isError":false,"content":[{"type":"text","text":' + JSON.stringify<string>(encoded) + '}]' + (mcp_no_output ? '}' : ',"structuredContent":' + encoded + '}')
    if (__pulse_entities_utf8_bytes(mcp_legacy ? result : '{"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":' + MCP_INFO + '},' + result.substring(1)) > 24576) mcp_error(500, -32603, 'Response body limit exceeded')
    else mcp_result(result)
  }
  return __pulse_package_result
}

export function pulse_package_http_failure(kind: i32): i32 {
  const status = kind == 1 ? 408 : kind == 2 ? 413 : 400
  const code = kind == 3 ? -32700 : -32600
  const message = kind == 1 ? 'Request interrupted' : kind == 2 ? 'Request body limit exceeded' : 'Invalid request body'
  const body = '{"jsonrpc":"2.0"' + (mcp_id.length ? ',"id":' + mcp_id : '') + ',"error":{"code":' + code.toString() + ',"message":' + JSON.stringify<string>(message) + '}}'
  return changetype<i32>('{"status":' + status.toString() + ',"headers":{"cache-control":"no-store","content-type":"application/json"},"body":' + JSON.stringify<string>(body) + '}')
}
