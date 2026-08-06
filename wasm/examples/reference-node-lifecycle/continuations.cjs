'use strict';

function referenceContinuations() {
  return {
    renderUser(ctx) {
      const user = ctx.resolved();
      if (!user.ok()) {
        return ctx.result.jsonText(user.status(), user.text(), {
          headers: {
            'content-type': user.header('content-type'),
            'x-reference-continuation': 'renderUser'
          }
        });
      }
      const decoded = user.json('app.UserResponse');
      if (!decoded.ok()) {
        return ctx.result.jsonText(502, decoded.errorText(), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'x-reference-continuation': 'renderUser'
          }
        });
      }
      return ctx.result.json('app.UserResponse', decoded, {
        status: 200,
        headers: {
          'content-type': user.header('content-type'),
          'x-reference-continuation': 'renderUser'
        }
      });
    },
    renderCreatedUser(ctx) {
    const created = ctx.resolved();
    if (!created.ok()) {
      return ctx.result.text(created.status(), created.text(), { headers: { 'content-type': created.header('content-type'), 'x-reference-continuation': 'renderCreatedUser' } });
    }
    return ctx.result.jsonText(201, created.text(), { headers: { 'content-type': 'application/json; charset=utf-8', 'x-reference-continuation': 'renderCreatedUser' } });
  },
  renderDashboard(ctx) {
      const user = ctx.resolved('user');
      const posts = ctx.resolved('posts');
      const count = ctx.resolved('count');
      if (!user.ok()) {
        return ctx.result.jsonText(user.status(), user.text(), {
          headers: {
            'content-type': user.header('content-type'),
            'x-reference-continuation': 'renderDashboard'
          }
        });
      }
      const body = JSON.stringify({
        user: JSON.parse(user.jsonText()),
        posts: JSON.parse(posts.jsonText()),
        postCount: count.header('x-count')
      });
      return ctx.result.jsonText(200, body, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-reference-continuation': 'renderDashboard'
        }
      });
    }
  };
}

module.exports = { referenceContinuations };
