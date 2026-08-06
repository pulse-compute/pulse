import { Router } from '../src/index.js'
import {
  createEventRecordingAdapter,
  executeEvent,
  type PulseEventRecordingAdapter,
  type PulseEventExecutionResult,
  type PulseEventFrame,
} from '../src/host.js'

const application = new Router()
const recordingAdapter: PulseEventRecordingAdapter = createEventRecordingAdapter({ maxQueueDepth: 4 })
const acceptedFrames: readonly PulseEventFrame[] = recordingAdapter.acceptedFrames()
const schemaFrame: PulseEventFrame<{ readonly enabled: boolean }> = {
  version: 'pulse.event-frame.v1',
  type: 'device.button',
  schemaId: 'events.DeviceButton',
  payload: { enabled: true },
}
const noPayloadFrame: PulseEventFrame = {
  version: 'pulse.event-frame.v1',
  type: 'system.tick',
  schemaId: null,
}

const schemaExecution: Promise<PulseEventExecutionResult> = executeEvent(application, schemaFrame)
const noPayloadExecution: Promise<PulseEventExecutionResult> = executeEvent(application, noPayloadFrame)

// @ts-expect-error no-payload frames must omit payload
const invalidNoPayload: PulseEventFrame = { version: 'pulse.event-frame.v1', type: 'invalid', schemaId: null, payload: {} }

void schemaExecution
void noPayloadExecution
void invalidNoPayload
void acceptedFrames
