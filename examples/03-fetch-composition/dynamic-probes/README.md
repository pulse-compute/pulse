# Dynamic endpoint probes

A bounded endpoint list becomes an ordered array of probe results through
`ctx.effects({ max: 32 })` and one explicit `await ctx.parallel(effects)`.
The request and result schemas are declared in `src/schemas.ts`.

From the parent fetch-composition example, with the candidate packages installed:

```sh
pulse test dynamic-probes --profile node-native
pulse test dynamic-probes --profile node-javascript
pulse test dynamic-probes --profile fastly-native
pulse test dynamic-probes --profile fastly-javascript
```

The harness uses fixtures and does not contact external endpoints. Native tests
execute the compiled artifact. In a real deployment, configure the provider's
outbound transport and keep endpoint inputs bounded and appropriate for the
application's authority. Fastly profiles here map both example origins to the
existing single `origin` backend; configure that backend before deployment.
Collections do not add runtime selection among multiple Fastly Native backends.

```ts
const input = await ctx.req.json<ProbeInput>('probe.Input')
const effects = ctx.effects<ProbeResult>({ max: 32 })
for (const endpoint of input.endpoints) {
  effects.add(ctx.fetch(endpoint).json<ProbeResult>('probe.Result'))
}
const results = await ctx.parallel(effects)
return ctx.json({ results }, { schema: 'probe.Output' })
```

An empty list returns no results. Completion order does not change result order.
An individual failure fails the group after settlement. Capacity, cumulative
effect limits and request cancellation remain enforced. This example supplies
the generic fan-out building block; it does not deploy a tick/uptime service.

The harness also checks schema failure through the composed middleware and error
handler. Native test profiles execute the compiled Wasm artifact.
