import { JSON } from 'json-as'

@json
class __Pulse_CompatibilityUser {
  id: string = ''
  attempts: i32 = 0
  score: f64 = 0.0
  active: bool = false
  tags: Array<string> = []
}

export function roundtrip(input: string): string {
  const value = JSON.parse<__Pulse_CompatibilityUser>(input)
  return JSON.stringify<__Pulse_CompatibilityUser>(value)
}

export function valid_roundtrip(): i32 {
  const text = '{"id":"u1","attempts":2,"score":1.5,"active":true,"tags":["one"]}'
  return roundtrip(text) == text ? 1 : 0
}

export function unknown_field(): i32 {
  JSON.parse<__Pulse_CompatibilityUser>(
    '{"id":"u1","attempts":2,"score":1.5,"active":true,"tags":[],"extra":"drop"}',
  )
  return 1
}

export function missing_required_defaults(): i32 {
  const value = JSON.parse<__Pulse_CompatibilityUser>(
    '{"attempts":2,"score":1.5,"active":true,"tags":[]}',
  )
  return value.id == '' ? 1 : 0
}

export function non_finite_extension(): i32 {
  const value = JSON.parse<__Pulse_CompatibilityUser>(
    '{"id":"u1","attempts":2,"score":NaN,"active":true,"tags":[]}',
  )
  return isNaN(value.score) ? 1 : 0
}

export function non_finite_encode_extension(): i32 {
  const value = new __Pulse_CompatibilityUser()
  value.id = 'u1'
  value.score = NaN
  return JSON.stringify<__Pulse_CompatibilityUser>(value).includes(':NaN') ? 1 : 0
}
