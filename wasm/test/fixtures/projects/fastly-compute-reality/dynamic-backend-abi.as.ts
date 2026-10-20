// R06 standalone ABI experiment, not the Pulse provider implementation.
// Layout: Fastly Viceroy v0.21.1, dynamic_backend_config (27 wasm32 words).
const DYNAMIC: bool = true;
const CA: string = "";
@external("fastly_abi", "init") declare function init(version: i64): i32;
@external("fastly_http_req", "register_dynamic_backend") declare function register(name: usize, nameLen: i32, target: usize, targetLen: i32, mask: u32, config: usize): i32;
@external("fastly_http_req", "body_downstream_get") declare function downstream(req: usize, body: usize): i32;
@external("fastly_http_req", "header_value_get") declare function header(req: i32, name: usize, nameLen: i32, value: usize, max: i32, written: usize): i32;
@external("fastly_http_req", "new") declare function newReq(out: usize): i32;
@external("fastly_http_req", "method_set") declare function method(req: i32, value: usize, len: i32): i32;
@external("fastly_http_req", "uri_set") declare function uri(req: i32, value: usize, len: i32): i32;
@external("fastly_http_req", "header_insert") declare function insert(req: i32, name: usize, nameLen: i32, value: usize, valueLen: i32): i32;
@external("fastly_http_req", "send_async") declare function send(req: i32, body: i32, name: usize, len: i32, pending: usize): i32;
@external("fastly_http_req", "pending_req_wait") declare function wait(pending: i32, resp: usize, body: usize): i32;
@external("fastly_http_resp", "new") declare function newResp(out: usize): i32;
@external("fastly_http_resp", "send_downstream") declare function respond(resp: i32, body: i32, streaming: i32): i32;
@external("fastly_http_body", "new") declare function newBody(out: usize): i32;
@external("fastly_http_body", "read") declare function read(body: i32, bytes: usize, max: i32, written: usize): i32;
@external("fastly_http_body", "write") declare function write(body: i32, bytes: usize, len: i32, end: i32, written: usize): i32;
@external("fastly_http_body", "close") declare function closeBody(body: i32): i32;

export function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
const out = new Int32Array(4);
const scratch = new Uint8Array(4096);
let targets = new Array<string>();
let hosts = new Array<string>();
let tlsNames = new Array<string>();
let schemes = new Array<bool>();
let names = new Array<string>();
let attempts: i32 = 0;
let last: i32 = 0;

function bytes(value: string): ArrayBuffer { return String.UTF8.encode(value, false); }
function get(req: i32, name: string): string {
  const key = bytes(name);
  if (header(req, changetype<usize>(key), key.byteLength, scratch.dataStart, scratch.length, out.dataStart) != 0) return "";
  return String.UTF8.decode(scratch.buffer.slice(0, out[0]));
}
function direct(name: string, target: string, host: string, tls: bool, tlsName: string, scenario: string): i32 {
  const n = bytes(name), t = bytes(target), h = bytes(host);
  const c = bytes(scenario == "mismatched-tls" ? "wrong.invalid" : tlsName), s = bytes(tlsName), ca = bytes(CA);
  const config = new Uint32Array(27);
  config[0] = <u32>changetype<usize>(h); config[1] = h.byteLength;
  config[2] = 1000; config[3] = 1000; config[4] = 1000;
  let mask: u32 = 2 | 4 | 8 | 16;
  if (tls) {
    mask |= 32 | 256 | 2048;
    config[7] = <u32>changetype<usize>(c); config[8] = c.byteLength;
    config[13] = <u32>changetype<usize>(s); config[14] = s.byteLength;
    if (CA.length > 0) { mask |= 512; config[9] = <u32>changetype<usize>(ca); config[10] = ca.byteLength; }
  }
  if (scenario == "reserved-mask") mask |= 1;
  return register(changetype<usize>(n), n.byteLength, changetype<usize>(t), t.byteLength, mask, config.dataStart);
}
function backend(target: string, host: string, tls: bool, tlsName: string, scenario: string): string {
  if (!DYNAMIC) return target == targets[0] ? "r06-static-0" : "r06-static-1";
  // Separate tuple fields avoid delimiter/hash collisions. Only successful
  // registrations enter this request-local, fixed-size experimental registry.
  for (let i = 0; i < targets.length; i++) {
    if (targets[i] == target && hosts[i] == host && schemes[i] == tls && tlsNames[i] == tlsName) { last = 0; return names[i]; }
  }
  if (attempts == 32) { last = 1001; return ""; }
  const name = "pulse-r06-" + attempts.toString(); attempts++;
  last = direct(name, target, host, tls, tlsName, scenario);
  if (last != 0) return "";
  targets.push(target); hosts.push(host); schemes.push(tls); tlsNames.push(tlsName); names.push(name);
  return name;
}
function reset(): void { targets = new Array<string>(); hosts = new Array<string>(); tlsNames = new Array<string>(); schemes = new Array<bool>(); names = new Array<string>(); attempts = 0; last = 0; }
export function probeBound(count: i32): i32 {
  reset();
  for (let i = 0; i < count; i++) { backend("origin-" + i.toString() + ".test:80", "origin.test", false, "", ""); if (last != 0) return last; }
  return 0;
}
export function probeFailures(count: i32): i32 {
  reset();
  for (let i = 0; i < count; i++) backend("origin.test:80", "origin.test", false, "", "");
  return last;
}
function reply(text: string): void {
  newResp(out.dataStart); const resp = out[0]; newBody(out.dataStart); const body = out[0], data = bytes(text);
  write(body, changetype<usize>(data), data.byteLength, 0, out.dataStart); respond(resp, body, 0);
}
function start(url: string, name: string): i32 {
  newReq(out.dataStart); const req = out[0]; newBody(out.dataStart); const body = out[0];
  const m = bytes("GET"), u = bytes(url), hn = bytes("host"), hv = bytes("ignored.invalid");
  method(req, changetype<usize>(m), m.byteLength); uri(req, changetype<usize>(u), u.byteLength);
  insert(req, changetype<usize>(hn), hn.byteLength, changetype<usize>(hv), hv.byteLength);
  const n = bytes(name); last = send(req, body, changetype<usize>(n), n.byteLength, out.dataStart); return out[0];
}
function bodyText(body: i32): string {
  let text = "";
  while (true) { if (read(body, scratch.dataStart, scratch.length, out.dataStart) != 0) { last = 1002; break; } if (out[0] == 0) break; text += String.UTF8.decode(scratch.buffer.slice(0, out[0])); }
  closeBody(body); return text;
}
export function _start(): void {
  init(1); reset(); downstream(out.dataStart, out.dataStart + 4); const req = out[0];
  const a = get(req, "x-r06-target-a"), b = get(req, "x-r06-target-b");
  const ha = get(req, "x-r06-host-a"), hb = get(req, "x-r06-host-b");
  const scenario = get(req, "x-r06-case"), tls = get(req, "x-r06-tls") == "1", tlsName = get(req, "x-r06-tls-name");
  // Seed only the static control's target selection; it makes no registration.
  if (!DYNAMIC) targets.push(a);
  const na = backend(a, ha, tls, tlsName, scenario);
  if (last != 0) { reply("register:" + last.toString()); return; }
  if (DYNAMIC && scenario == "duplicate") { reply("duplicate:" + direct(na, a, ha, tls, tlsName, "").toString()); return; }
  const nb = backend(b, hb, tls, tlsName, scenario);
  if (last != 0) { reply("register:" + last.toString()); return; }
  const scheme = tls ? "https://" : "http://";
  const pa = start(scheme + a + "/alpha", na); if (last != 0) { reply("send:" + last.toString()); return; }
  const pb = start(scheme + b + "/beta", nb); if (last != 0) { reply("send:" + last.toString()); return; }
  // Consume both handles, in reverse order, even when one transport fails.
  const sb = wait(pb, out.dataStart, out.dataStart + 4); const rb = sb == 0 ? bodyText(out[1]) : "";
  const sa = wait(pa, out.dataStart, out.dataStart + 4); const ra = sa == 0 ? bodyText(out[1]) : "";
  if (sa != 0 || sb != 0) { reply("wait:" + sa.toString() + ":" + sb.toString()); return; }
  reply(ra + "|" + rb);
}
