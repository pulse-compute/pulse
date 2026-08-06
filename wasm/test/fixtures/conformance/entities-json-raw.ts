import { JSON } from "json-as";

export function has_raw_field(source: string, key: string): i32 {
  const envelope = JSON.parse<Map<string, JSON.Raw>>(source);
  return envelope.has(key) ? 1 : 0;
}

export function raw_field(source: string, key: string): string {
  const envelope = JSON.parse<Map<string, JSON.Raw>>(source);
  return envelope.has(key) ? envelope.get(key).data : "<absent>";
}

export function raw_field_serialized(source: string, key: string): string {
  const envelope = JSON.parse<Map<string, JSON.Raw>>(source);
  if (!envelope.has(key)) return "<absent>";
  return JSON.stringify<JSON.Raw>(envelope.get(key));
}

function rawEquals(source: string, key: string, expected: string): bool {
  const envelope = JSON.parse<Map<string, JSON.Raw>>(source);
  return envelope.has(key) && envelope.get(key).data == expected;
}

function rawSerializesUnquoted(source: string, key: string): bool {
  const envelope = JSON.parse<Map<string, JSON.Raw>>(source);
  if (!envelope.has(key)) return false;
  const raw = envelope.get(key);
  return JSON.stringify<JSON.Raw>(raw) == raw.data;
}

export function raw_shape_matrix(): i32 {
  if (!rawEquals('{"params":{"name":"Ada","nested":{"n":1}}}', "params", '{"name":"Ada","nested":{"n":1}}')) return 0;
  if (!rawEquals('{"params":[1,{"ok":true},null]}', "params", '[1,{"ok":true},null]')) return 0;
  if (!rawEquals('{"params":true}', "params", "true")) return 0;
  if (!rawEquals('{"params":null}', "params", "null")) return 0;
  if (!rawEquals('{"id":"req\\u002d1"}', "id", '"req\\u002d1"')) return 0;
  if (!rawEquals('{"id":-9007199254740991}', "id", "-9007199254740991")) return 0;
  if (!rawEquals('{"id":null}', "id", "null")) return 0;
  const absent = JSON.parse<Map<string, JSON.Raw>>('{"method":"notify"}');
  return absent.has("params") || absent.has("id") ? 0 : 1;
}

export function raw_serialization_matrix(): i32 {
  if (!rawSerializesUnquoted('{"params":{"emoji":"🚀"}}', "params")) return 0;
  if (!rawSerializesUnquoted('{"params":[1,2,3]}', "params")) return 0;
  if (!rawSerializesUnquoted('{"params":false}', "params")) return 0;
  return rawSerializesUnquoted('{"params":null}', "params") ? 1 : 0;
}

export function duplicate_method_behavior(): i32 {
  const envelope = JSON.parse<Map<string, JSON.Raw>>('{"method":"first","method":"second"}');
  if (!envelope.has("method")) return 0;
  const value = envelope.get("method").data;
  if (value == '"first"') return 1;
  if (value == '"second"') return 2;
  return 0;
}

export function malformed_nested(): i32 {
  JSON.parse<Map<string, JSON.Raw>>('{"params":{"a":[1,2}}');
  return 0;
}
