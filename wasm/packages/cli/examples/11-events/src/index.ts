import { Pulse } from '@pulse-compute/pulse'

type DeviceReading = Readonly<{
  deviceId: string
  temperatureC: number
}>

const app = new Pulse({ auto: true })

app.get('/health', async (ctx) => ctx.text('ok'))

app.on<DeviceReading>('device.reading', { schema: 'events.DeviceReading' }, async (ctx) => {
  const reading = ctx.event.payload
  ctx.log.info('device reading accepted')
  await ctx.emit('device.reading.accepted', {
    schema: 'events.DeviceReadingAccepted',
    payload: { deviceId: reading.deviceId, accepted: true },
  })
})

app.on('system.tick', { schema: null }, async (ctx) => {
  ctx.log.info('system tick accepted')
  await ctx.emit('system.heartbeat', { schema: null })
})

export default app

