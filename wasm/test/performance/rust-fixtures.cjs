'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
function prepareRust(directory, fixture, plan) {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['Cargo.toml', 'Cargo.lock', 'lib.rs']) fs.copyFileSync(path.join(__dirname, 'rust', name), path.join(directory, name));
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
  const hash = [...plan.planHash].map(c => c.charCodeAt(0));
  let application, schemas = '', continuation = 0;
  if (fixture.id === 'minimal-request') {
    // Static UTF-16 literal avoids allocating a Rust string for this fixed key.
    application = `unsafe fn run() -> i32 { let value = value_object(); value_object_set(value, value_string([111u16,107].as_ptr(), 2), value_boolean(1)); RESULT = response_json(value, value_undefined()); 0 }`;
  } else if (fixture.id === 'multi-route') {
    application = `unsafe fn run() -> i32 {
      RESULT = if matches("GET", "/api/health") { response_json(object(&[("ok", value_boolean(1))]), value_undefined()) }
      else if matches("GET", "/api/users/:id") { response_json(object(&[("id", router_param(request_path(), string("/api/users/:id"), string("id")))]), value_undefined()) }
      else if matches("POST", "/api/users") { response_json(object(&[("created", value_boolean(1))]), status(201.0)) }
      else if matches("GET", "/*") { response_text(string("missing"), status(404.0)) }
      else { response_text(string("Not Found"), status(404.0)) }; 0 }`;
  } else if (fixture.id === 'schema-effect') {
    assert.equal(plan.effects.length, 1); assert.equal(plan.effects[0].kind, 'fetch');
    assert.equal(plan.continuations.length, 1); continuation = plan.continuations[0].stateIndex;
    application = `unsafe fn run() -> i32 {
      INPUT = request_json(string("bench.Input"));
      let payload = object(&[("responseMode", string("structured")), ("projection", string("json")), ("url", string("https://origin.example.test/value")), ("init", value_undefined())]);
      effect_begin(0, payload); PENDING = true; 1
    }
    unsafe fn finish() -> i32 {
      RESULT = response_json(object(&[("name", value_property(INPUT, string("name"))), ("score", value_property(ORIGIN, string("score")))]), object(&[("schema", string("bench.Output"))])); 0
    }`;
    schemas = '#[derive(Serialize, Deserialize)] struct Input { name: String }\n#[derive(Serialize, Deserialize)] struct Origin { score: f64 }\n#[derive(Serialize, Deserialize)] struct Output { name: String, score: f64 }\n';
    assert.deepEqual(plan.schemas.ids, ['bench.Input', 'bench.Origin', 'bench.Output']);
    schemas += 'fn codec(index: i32, text: &str) -> String { match index { 0 => roundtrip::<Input>(text), 1 => roundtrip::<Origin>(text), 2 => roundtrip::<Output>(text), _ => panic!("schema index") } }';
  } else {
    assert.equal(fixture.id, 'large-router-compile');
    application = `unsafe fn run() -> i32 {\n` + Array.from({ length: 64 }, (_, i) => `if matches("POST", "/items/${i}") { let input = request_json(string("bench.Input${i % 16}")); RESULT = response_json(object(&[("value", value_property(input, string("value"))), ("route", value_number(${i}.0))]), object(&[("schema", string("bench.Output${i % 16}"))])); return 0; }`).join('\n') + '\nRESULT = response_text(string("Not Found"), status(404.0)); 0 }';
    schemas = Array.from({ length: 16 }, (_, i) => `#[derive(Serialize, Deserialize)] struct Input${i} { value: String }\n#[derive(Serialize, Deserialize)] struct Output${i} { value: String, route: f64 }`).join('\n');
    assert.equal(plan.schemas.ids.length, 32);
    schemas += '\nfn codec(index: i32, text: &str) -> String { match index {\n' + plan.schemas.ids.map((id, i) => { assert(/^bench\.(Input|Output)\d+$/.test(id)); return `${i} => roundtrip::<${id.slice(6)}>(text),`; }).join('\n') + '\n_ => panic!("schema index") } }';
  }
  if (fixture.id !== 'schema-effect') application += '\nunsafe fn finish() -> i32 { ERROR = 2; -2 }\n';
  fs.writeFileSync(path.join(directory, 'plan.rs'), `const PLAN_HASH: [u16; 64] = [${hash}];\nconst CONTINUATION: i32 = ${continuation};\n`);
  // All handler literals are fixed fixture data. Embed UTF-16 once, rather
  // than charging Rust a fresh allocation for every constant key or route.
  application = application.replace(/"([^"\\]*)"/g, (_match, value) => '&[' + [...value].map(c => c.charCodeAt(0) + 'u16').join(',') + ']');
  fs.writeFileSync(path.join(directory, 'application.rs'), application + '\n');
  fs.writeFileSync(path.join(directory, 'schemas.rs'), schemas + '\n');
}
module.exports = { prepareRust };
