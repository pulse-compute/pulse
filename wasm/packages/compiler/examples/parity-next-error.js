import { Router } from "./pulse-runtime/dist/index.js"

const app = new Router()

export function pass(ctx, next) { return next() }
export function second(ctx, next) { return "second" }

export function fail(ctx, next) { return next("boom") }
export function recover(err, ctx, next) { return next() }
export function after(ctx, next) { return "after" }

export function failRoute(ctx, next) { return next("a") }
export function rebubble(err, ctx, next) { return next("b") }
export function handleError(err, ctx, next) { return "error:" + err }

app
  .get("/x", pass)
  .get("/x", second)
  .use("/err", fail)
  .error(recover)
  .get("/err", after)
  .get("/bubble", failRoute)
  .error(rebubble)
  .error(handleError)
