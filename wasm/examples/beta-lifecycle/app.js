import { Router } from '@pulse-compute/runtime'
import { assets } from '@pulse-compute/assets'

const app = new Router()

export function health(ctx, next) {
  ctx.response.header.set('x-beta-route', 'health')
  return ctx.result.text(200, 'ok')
}

export function getUser(ctx, next) {
  const id = ctx.param('id')
  return ctx.resolve(
    ctx.fetch('users', {
      method: 'GET',
      path: '/users/' + id,
      headers: {
        accept: 'application/json',
        'x-beta-route': 'getUser'
      }
    }),
    renderUser
  )
}

export function renderUser(ctx) {
  const user = ctx.resolved()
  if (!user.ok()) {
    return ctx.result.jsonText(user.status(), user.text(), {
      headers: {
        'content-type': user.header('content-type'),
        'x-beta-continuation': 'renderUser'
      }
    })
  }
  const decoded = user.json('app.UserResponse')
  return ctx.result.json('app.UserResponse', decoded, {
    status: 200,
    headers: {
      'content-type': user.header('content-type'),
      'x-beta-continuation': 'renderUser'
    }
  })
}

export function getDashboard(ctx, next) {
  const id = ctx.param('id')
  return ctx.resolve({
    user: ctx.fetch('users', {
      method: 'GET',
      path: '/users/' + id,
      headers: { accept: 'application/json' }
    }),
    posts: ctx.fetch('users', {
      method: 'GET',
      path: '/users/' + id + '/posts',
      headers: { accept: 'application/json' }
    }),
    count: ctx.fetch('users', {
      method: 'HEAD',
      path: '/users/' + id + '/posts'
    })
  }, renderDashboard)
}

export function renderDashboard(ctx) {
  const user = ctx.resolved('user')
  const posts = ctx.resolved('posts')
  const count = ctx.resolved('count')

  if (!user.ok()) {
    return ctx.result.jsonText(user.status(), user.text(), {
      headers: {
        'content-type': user.header('content-type'),
        'x-beta-continuation': 'renderDashboard'
      }
    })
  }

  return ctx.result.jsonText(200, '{"user":' + user.jsonText() + ',"posts":' + posts.jsonText() + ',"postCount":"' + count.header('x-count') + '"}', {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-beta-continuation': 'renderDashboard'
    }
  })
}

export function createUser(ctx, next) {
  const input = ctx.req.json('app.CreateUserRequest')

  if (!input.ok()) {
    return ctx.result.jsonText(400, input.errorText(), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-beta-route': 'createUser'
      }
    })
  }

  return ctx.resolve(
    ctx.fetch('users', {
      method: 'POST',
      path: '/users',
      headers: { accept: 'application/json' },
      json: ctx.schema.encode('upstream.CreateUserRequest', input)
    }),
    renderCreatedUser
  )
}

export function renderCreatedUser(ctx) {
  const created = ctx.resolved()
  if (!created.ok()) {
    return ctx.result.text(created.status(), created.text(), {
      headers: {
        'content-type': created.header('content-type'),
        'x-beta-continuation': 'renderCreatedUser'
      }
    })
  }
  return ctx.result.jsonText(201, created.text(), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-beta-continuation': 'renderCreatedUser'
    }
  })
}

export function serveApp(ctx, next) {
  const found = assets.lookup(ctx, 'public', '/app.js', {
    method: 'GET',
    cacheControl: 'public, max-age=60'
  })

  return assets.respond(found)
}

export function serveMetadata(ctx, next) {
  const found = assets.lookup(ctx, 'public', '/metadata.txt', {
    method: 'HEAD',
    passThroughOn404: true
  })

  return assets.respond(found)
}

app
  .get('/health', health)
  .get('/users/:id', getUser)
  .get('/dashboard/:id', getDashboard)
  .post('/users', createUser)
  .get('/app.js', serveApp)
  .head('/metadata.txt', serveMetadata)

export { app }
