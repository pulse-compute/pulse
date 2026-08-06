# PulseConfig Contract v1

## Purpose

`defineConfig` is the compile-time membrane for PulseWasm. It may describe build/runtime configuration and select a predeclared profile. It may not participate in route semantics.

## Core rule

```text
defineConfig may describe the build/runtime boundary.
defineConfig may not create, hide, mutate, select, or branch route semantics.
```

## Allowed shape

```ts
export default defineConfig((env) => ({
  entry: './src/routes.ts',
  rootRouter: 'app',
  target: 'wasm',
  profile: env('PULSE_PROFILE', 'local'),
  env: env.define(['PULSE_PROFILE']),
  profiles: {
    local: { /* runtime config */ },
    edge: { /* runtime config */ }
  }
}))
```

Also allowed:

```ts
const config = defineConfig({
  entry: './src/routes.ts',
  rootRouter: 'app',
  profiles: {
    local: {}
  }
})
```

## Allowed expressions

Inside `defineConfig` v1:

- string, number, boolean, null, undefined literals
- object literals
- array literals
- `env('NAME')`
- `env('NAME', 'fallback')`
- `env.number('NAME')`
- `env.number('NAME', 10)`
- `env.boolean('NAME')`
- `env.boolean('NAME', false)`
- `env.define([...])` or `env.define({ ... })`

## Rejected expressions

- object or array spread
- computed keys
- shorthand properties
- methods/getters/setters
- imported config fragments
- local variables inside the config factory
- arbitrary function calls
- async config factories
- functions as profile values
- conditional expressions
- binary expressions
- dynamic env names

## Profile selection

Profile selection order:

1. CLI `--profile`
2. `PULSE_PROFILE` from `--env PULSE_PROFILE=value`
3. resolved `config.profile`
4. `local` profile if present
5. first declared profile

`profile: env('PULSE_PROFILE', 'local')` is allowed. Other env variables may not select the active profile.

## Env boundary

`env()` may resolve scalar values inside config. It may not define route/compiler semantics.

Hard failures:

```ts
entry: env('ENTRY_FILE')
rootRouter: env('ROOT_ROUTER')
profiles: {
  edge: { routes: env('ROUTE_SET') }
}
```

## Secret policy

Secret-like env values are redacted from `resolved-config.json`.

Secret-like means either:

- the env name contains `SECRET`, `PASSWORD`, `TOKEN`, `CREDENTIAL`, `PRIVATE_KEY`, `API_KEY`, or `ACCESS_KEY`; or
- the config path contains secret-bearing keys such as `credentials`, `secret`, `token`, or `password`.

Literal fallbacks for secret-like env lookups are rejected because they would place secret material in source.

## Artifact

The resolver emits:

```text
resolved-config.json
```

This artifact includes:

- selected profile
- profile source
- entry/root router/target when statically declared
- active profile config
- full sanitized config
- env references
- redacted secret references

## Final rule

`resolved-config.json` is config truth. Route truth still comes later from `route-plan.json`.
