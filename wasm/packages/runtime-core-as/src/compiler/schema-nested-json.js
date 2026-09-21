'use strict';

// Input text has passed whole-document admission. Copy dynamic subtrees with
// explicit frames; each projected container owns its own children. json-as
// remains the parser/serializer, including its scalar and Unicode semantics.
function nestedJsonProjectionSource() {
  return `
class __PulseJsonProjectionFrame {
  index: i32 = 0
  keys: Array<string> = []
  constructor(public input: JSON.Value, public output: JSON.Value) {
    if (input.type == JSON.Types.Object) this.keys = input.get<JSON.Obj>().keys()
  }
}
function __pulse_json_copy_enter(value: JSON.Value, frames: Array<__PulseJsonProjectionFrame>): JSON.Value {
  if (value.type == JSON.Types.Null) return JSON.Value.empty()
  if (value.type == JSON.Types.String) return JSON.Value.from<string>(value.get<string>())
  if (value.type == JSON.Types.Bool) return JSON.Value.from<bool>(value.get<bool>())
  if (value.type == JSON.Types.F64) {
    if (!isFinite(value.get<f64>())) abort("Invalid JSON number", "pulse-schema-codecs", 0, 0)
    return JSON.Value.from<f64>(value.get<f64>())
  }
  const output = value.type == JSON.Types.Array ? JSON.Value.from<JSON.Arr>(new JSON.Arr()) : JSON.Value.from<JSON.Obj>(new JSON.Obj())
  frames.push(new __PulseJsonProjectionFrame(value, output))
  return output
}
function __pulse_json_copy(value: JSON.Value): JSON.Value {
  const frames = new Array<__PulseJsonProjectionFrame>()
  const output = __pulse_json_copy_enter(value, frames)
  while (frames.length > 0) {
    const frame = frames[frames.length - 1]
    const array = frame.input.type == JSON.Types.Array
    const count = array ? frame.input.get<JSON.Arr>().length : frame.keys.length
    if (frame.index == count) { frames.pop(); continue }
    const index = frame.index++
    const key = array ? '' : frame.keys[index]
    const child = array ? frame.input.get<JSON.Arr>().at(index) : frame.input.get<JSON.Obj>().get(key)!
    const copy = __pulse_json_copy_enter(child, frames)
    if (array) frame.output.get<JSON.Arr>().push<JSON.Value>(copy)
    else frame.output.get<JSON.Obj>().set<JSON.Value>(key, copy)
  }
  return output
}
`;
}

module.exports = { nestedJsonProjectionSource };
