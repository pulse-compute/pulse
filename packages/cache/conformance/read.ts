import {cache} from '@pulse-compute/cache';
export default async function handler(ctx){const r=await cache.getText(ctx,'example',{maxBytes:1024});return ctx.json(r)}
