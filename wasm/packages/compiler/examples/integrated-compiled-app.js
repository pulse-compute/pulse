import { Router } from "./pulse-runtime/dist/index.js"

const app = new Router()

export function testExtension(ctx, next) { return next() }
export function createUser(ctx, next) { return next() }
export function testExtensionRoute(ctx, next) { return ctx.result.text(220, "extension") }
export function streamRoute(ctx, next) { return ctx.result.text(206, "stream") }
export function handleError(err, ctx, next) { return ctx.result.text(400, "schema-error") }

app
  .use(testExtension)
  .post("/users", createUser)
  .get("/extension", testExtensionRoute)
  .get("/stream", streamRoute)
  .error(handleError)
