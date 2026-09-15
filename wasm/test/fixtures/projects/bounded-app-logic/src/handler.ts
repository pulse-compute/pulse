import type { PulseContext } from '@pulse-compute/runtime';
import type { Input } from './schemas';

export default async function handler(ctx: PulseContext) {
  const original = await ctx.req.text();
  const input = ctx.decodeJson<Input>(original, 'app.Input');
  let titleSource = input.title;
  if (ctx.req.header('x-mode') === 'wrong-type') titleSource = 7 as unknown as string;
  const title = titleSource.trim();
  if (title.length === 0 || title.length > 160 || input.items.length > 64 || input.grants.length > 8 || input.receipts.length > 64) return ctx.text('invalid', { status: 400 });
  let selected: { id: string; version: number }[] = [];
  let visits = 0;
  for (let i = 0; i < 64 && i < input.items.length; i++) {
    const item = input.items[i];
    visits += 1;
    if (item.id === 'stop') break;
    if (item.id === 'skip') continue;
    selected = [...selected, { id: item.id.trim(), version: item.version + 1 }];
  }
  let member = false;
  let valid = true;
  for (let g = 0; g < 8 && g < input.grants.length; g += 1) {
    const grant = input.grants[g];
    if (grant.members.length > 8) valid = false;
    if (grant.target !== input.target) continue;
    for (let m = 0; m < 8 && m < grant.members.length; ++m) {
      if (grant.members[m] === 'actor') { member = true; break; }
    }
  }
  if (!valid) return ctx.text('invalid', { status: 400 });
  let replay = '';
  for (let r = 0; r < 64 && r < input.receipts.length; r++) {
    const receipt = input.receipts[r];
    if (receipt.command === input.command) { replay = receipt.result; break; }
  }
  const stored = await ctx.fetch('https://objects.invalid/candidate', { method: 'POST', body: original }).text();
  return ctx.json({ title, selected, visits, member, replay }, { schema: 'app.Output' });
}
