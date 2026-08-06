import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface DeviceReading {
  deviceId: string
  temperatureC: number
}

export interface DeviceReadingAccepted {
  deviceId: string
  accepted: boolean
}

export default defineSchemaRegistry({
  schemas: {
    'events.DeviceReading': schema<DeviceReading>(),
    'events.DeviceReadingAccepted': schema<DeviceReadingAccepted>(),
  },
})

