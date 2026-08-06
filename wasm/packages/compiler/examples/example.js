import { Router } from "./pulse-runtime/dist/index.js"

const app = new Router()
const realtime = new Router()

export function auth(ctx, next) {}
export function gateway(ctx, next) {}
export function onConnect(ctx, next) {}
export function onDisconnect(ctx, next) {}
export function bundleChannel(ctx) {}
export function realtimeHandler(ctx, next) {}
export function computeHandler(ctx, next) {}

app
  .use(auth)
  .mount("/realtime", realtime)
  .post("/compute/:id", computeHandler)

realtime
  .use(gateway)
  .on("connect", onConnect)
  .on("disconnect", onDisconnect)
  .channel(bundleChannel)
  .get("/:id", realtimeHandler)