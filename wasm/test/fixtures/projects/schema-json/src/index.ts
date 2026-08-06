import type { PulseContext, PulseResult } from '@pulse-compute/runtime';
import type { CreateUserInput, OriginUser, UserResponse } from './schemas';

export default function handler(ctx: PulseContext): PulseResult {
  const first = ctx.req.json<CreateUserInput>('app.CreateUserInput');
  const second = ctx.req.json<CreateUserInput>('app.CreateUserInput');

  if (ctx.req.path === '/bad-response') {
    return ctx.json({
      id: 'not-a-number',
      name: first.name,
      score: 0,
      active: first.active,
      sameReference: first === second
    }, { schema: 'app.UserResponse' });
  }

  const origin = ctx.fetch('https://api.example.test/users/7', {
    headers: { accept: 'application/json' }
  }).json<OriginUser>('app.OriginUser');

  const response: UserResponse = {
    id: origin.id,
    name: first.name,
    score: origin.score,
    active: first.active,
    sameReference: first === second
  };
  return ctx.json(response, {
    status: 201,
    headers: { 'x-pulse-schema': 'app.UserResponse' },
    schema: 'app.UserResponse'
  });
}
