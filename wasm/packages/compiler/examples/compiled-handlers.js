import { Router } from "./pulse-runtime/dist/index.js"

const app = new Router()
const realtime = new Router()

export function auth(ctx, next) {
  return next()
}

export function gateway(ctx, next) {
  return next()
}

export function onConnect(ctx, next) {
  return next()
}

export function onDisconnect(ctx, next) {
  return next()
}

export function bundleChannel(ctx) {
  return "realtime"
}

export function realtimeHandler(ctx, next) {
  const id = ctx.param("id")
  return ctx.result.text(200, "realtime:" + id)
}

export function computeHandler(ctx, next) {
  const id = ctx.param("id")
  return ctx.result.text(201, "compute:" + id)
}

export function passRoute(ctx, next) {
  return next()
}

export function fallthroughHandler(ctx, next) {
  const id = ctx.param("id")
  return ctx.result.text(202, "fall:" + id)
}

export function failRoute(ctx, next) {
  const err = ctx.error("FAIL", "boom", 500)
  return next(err)
}

export function handleError(err, ctx, next) {
  return ctx.result.text(500, "error:FAIL")
}

export function headerJsonHandler(ctx, next) {
  const first = ctx.request.header.first("X-Trace")
  const count = ctx.request.header.count("X-Trace")
  const second = ctx.request.header.at("X-Trace", 1)
  ctx.response.header.set("X-Mode", "compiled")
  ctx.response.header.append("Grip-Channel", "room")
  ctx.response.header.append("Grip-Channel", "room:" + second)
  ctx.response.header.set("X-Delete", "gone")
  ctx.response.header.delete("X-Delete")
  return ctx.result.jsonText(203, "{\"trace\":\"" + first + "\",\"second\":\"" + second + "\"}")
}

export function contextSyncHandler(ctx, next) {
  const id = ctx.param("id")
  const method = ctx.request.method()
  const path = ctx.request.path()
  const allowed = method === "GET" && path === "/context/abc"
  if (allowed) {
    ctx.response.header.set("X-Context", "pass31")
    return ctx.result.text(204, "context:" + id + ":" + method + ":" + path)
  }
  return ctx.result.text(405, "method:" + method + ":" + path)
}

app
  .use(auth)
  .mount("/realtime", realtime)
  .post("/compute/:id", computeHandler)
  .get("/fall/:id", passRoute)
  .get("/fall/:id", fallthroughHandler)
  .get("/fail", failRoute)
  .get("/headers", headerJsonHandler)
  .get("/context/:id", contextSyncHandler)
  .error(handleError)

realtime
  .use(gateway)
  .on("connect", onConnect)
  .on("disconnect", onDisconnect)
  .channel(bundleChannel)
  .get("/:id", realtimeHandler)
