import { Router } from "./pulse-runtime/dist/index.js"

const app = new Router()

export function getUser(ctx, next) {
  const id = ctx.param("id")
  return ctx.resolve(
    ctx.fetch("usersApi", {
      method: "GET",
      path: "/v1/users/" + id,
      headers: {
        accept: "application/json"
      }
    }),
    renderUser
  )
}

export function renderUser(ctx) {
  const user = ctx.resolved()
  if (!user.ok()) {
    return ctx.result.text(user.status(), user.text())
  }
  return ctx.result.text(200, user.text())
}

export function getDashboard(ctx, next) {
  const id = ctx.param("id")
  return ctx.resolve({
    user: ctx.fetch("usersApi", {
      method: "GET",
      path: "/v1/users/" + id,
      headers: {
        accept: "application/json"
      }
    }),
    posts: ctx.fetch("postsApi", {
      method: "HEAD",
      path: "/v1/users/" + id + "/posts"
    })
  }, renderDashboard)
}

export function renderDashboard(ctx) {
  const user = ctx.resolved("user")
  const posts = ctx.resolved("posts")
  return ctx.result.text(200, user.text() + posts.header("x-count"))
}

app
  .get("/users/:id", getUser)
  .get("/dashboard/:id", getDashboard)
