import type { PulseComputationContext, PulseReadonly } from '@pulse-compute/pulse'
import type { ReadInput, ReadOutput, RecordSummary } from './schemas.js'
import { utf8Width, escapedWidth, projectedWidth, digits } from './scalars.js'

export function computeRead(
  ctx: PulseComputationContext,
  input: PulseReadonly<ReadInput>,
): ReadOutput {
__READ_PRELUDE__
  const text = ctx.resources.map('context.text')
  const begin = text.readU32LE(64 + row * 12)
  const size = text.readU32LE(68 + row * 12)
  const totalUnits = text.readU32LE(72 + row * 12)
  const offset = (input.offset ?? 0) as number
  let at = 0
  let units = 0
  // At most 24 KiB admitted UTF-8, preserving original UTF-16 offsets.
  for (let block = 0; block < 24 && units < offset && at < size; block++) {
    for (let i = 0; i < 1024 && units < offset && at < size; i++) {
      const width = utf8Width(text.readU8(begin + at))
      at += width
      units += width === 4 ? 2 : 1
    }
  }
  if (offset < 0 || offset % 1 !== 0 || offset > totalUnits || units !== offset) {
    return {...empty, status: 'invalid-input', error: {
      code: 'invalid-offset',
      message: 'Use a UTF-16 content boundary, normally the preceding nextOffset.',
    }}
  }
  const start = at
  let escaped = 0
  let stopped = false
  let projected = 0
  let end = start
  let endUnits = units
  const offsetDigits = offset < 10 ? 1 : offset < 100 ? 2
    : offset < 1000 ? 3 : offset < 10000 ? 4 : 5
  for (let block = 0; block < 12 && at < size && !stopped; block++) {
    for (let i = 0; i < 1024 && at < size && !stopped; i++) {
      const first = text.readU8(begin + at)
      const width = utf8Width(first)
      const cost = escapedWidth(first, width)
      if (at + width - start > 12288 || escaped + cost > 16384) stopped = true
      else {
        at += width
        escaped += cost
        units += width === 4 ? 2 : 1
        projected += projectedWidth(first, width)
        const nextDigits = digits(units)
        const envelope = at < size ? pageBase + 4 * (nextDigits - 1) : terminalBase
        if (envelope + 2 * (offsetDigits - 1) + projected <= 24576) {
          end = at
          endUnits = units
        }
      }
    }
  }
  if ((end === start && start < size)
    || (start === size && terminalBase + 2 * (offsetDigits - 1) > 24576)) {
    return {...empty, status: 'response-too-large', error: {
      code: 'response-too-large',
      message: 'Reply exceeds the byte budget. Retrieve individual corpus IDs with pulse.read.',
    }}
  }
__READ_SUMMARY__
  const record = {
    ...selected, content: text.readUtf8(begin + start, end - start), offset,
    totalBytes: size, truncated: end < size,
  }
  if (end < size) {
    return {...empty, record: {...record, nextOffset: endUnits},
      truncated: true, nextOffset: endUnits}
  }
  return {...empty, record, truncated: false}
}
