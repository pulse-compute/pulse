import { Router } from '@pulse-compute/runtime'

const app = new Router()

export function health(ctx, next) {
  ctx.response.header.set('x-reference-route', 'health')
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
        'x-reference-route': 'getUser'
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
        'x-reference-continuation': 'renderUser'
      }
    })
  }
  const decoded = user.json('app.UserResponse')
  return ctx.result.json('app.UserResponse', decoded, {
    status: 200,
    headers: {
      'content-type': user.header('content-type'),
      'x-reference-continuation': 'renderUser'
    }
  })
}

export function getDashboard(ctx, next) {
  const id = ctx.param('id')
  return ctx.resolve({
    user: ctx.fetch('users', {
      method: 'GET',
      path: '/users/' + id,
      headers: {
        accept: 'application/json'
      }
    }),
    posts: ctx.fetch('users', {
      method: 'GET',
      path: '/users/' + id + '/posts',
      headers: {
        accept: 'application/json'
      }
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
        'x-reference-continuation': 'renderDashboard'
      }
    })
  }

  return ctx.result.jsonText(200, '{"user":' + user.jsonText() + ',"posts":' + posts.jsonText() + ',"postCount":"' + count.header('x-count') + '"}', {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-reference-continuation': 'renderDashboard'
    }
  })
}


export function previewUser(ctx, next) {
  const body = ctx.req.json()

  if (!body.ok()) {
    return ctx.result.jsonText(400, body.errorText(), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-reference-route': 'previewUser'
      }
    })
  }

  const id = body.getString('id')
  const name = body.getString('name')
  const active = body.getBool('active')

  if (active) {
    return ctx.result.jsonText(200, '{"id":"' + id + '","name":"' + name + '","active":true,"source":"request-body"}', {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-reference-route': 'previewUser'
      }
    })
  }

  return ctx.result.jsonText(200, '{"id":"' + id + '","name":"' + name + '","active":false,"source":"request-body"}', {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-reference-route': 'previewUser'
    }
  })
}


export function previewUserWithSchema(ctx, next) {
  const body = ctx.req.json('app.CreateUserRequest')

  if (!body.ok()) {
    return ctx.result.jsonText(400, body.errorText(), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-reference-route': 'previewUserWithSchema'
      }
    })
  }

  const id = body.getString('id')
  const name = body.getString('name')
  const active = body.getBool('active')

  if (active) {
    return ctx.result.jsonText(200, '{"id":"' + id + '","name":"' + name + '","active":true,"source":"schema-decode"}', {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-reference-route': 'previewUserWithSchema'
      }
    })
  }

  return ctx.result.jsonText(200, '{"id":"' + id + '","name":"' + name + '","active":false,"source":"schema-decode"}', {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-reference-route': 'previewUserWithSchema'
    }
  })
}


export function previewUserSchemaResponse(ctx, next) {
  const body = ctx.req.json('app.CreateUserRequest')

  if (!body.ok()) {
    return ctx.result.jsonText(400, body.errorText(), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-reference-route': 'previewUserSchemaResponse'
      }
    })
  }

  return ctx.result.json('app.CreateUserResponse', body, {
    status: 201,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-reference-route': 'previewUserSchemaResponse'
    }
  })
}


export function createUser(ctx, next) {
  const input = ctx.req.json('app.CreateUserRequest')

  if (!input.ok()) {
    return ctx.result.jsonText(400, input.errorText(), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-reference-route': 'createUser'
      }
    })
  }

  return ctx.resolve(
    ctx.fetch('users', {
      method: 'POST',
      path: '/users',
      headers: {
        accept: 'application/json'
      },
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
        'x-reference-continuation': 'renderCreatedUser'
      }
    })
  }
  return ctx.result.jsonText(201, created.text(), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-reference-continuation': 'renderCreatedUser'
    }
  })
}

app
  .get('/health', health)
  .get('/users/:id', getUser)
  .post('/users/preview', previewUser)
  .post('/users/schema-preview', previewUserWithSchema)
  .post('/users/schema-response', previewUserSchemaResponse)
  .post('/users', createUser)
  .get('/dashboard/:id', getDashboard)

export { app }
