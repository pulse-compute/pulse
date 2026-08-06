import { jwtError } from '../errors.js';
import {
  isJwtOrdinaryObject,
  jwtOwnDataProperty,
} from './data.js';

export interface JwtCapturedWallClock {
  readonly unixEpochSeconds: number;
  readonly trusted: boolean;
}

export type JwtWallClockCapture =
  () => JwtCapturedWallClock | PromiseLike<JwtCapturedWallClock>;

const MAX_DATE_SECONDS = 8_640_000_000_000;

export async function captureJwtCurrentDate(
  capture: JwtWallClockCapture | undefined,
): Promise<Date> {
  if (typeof capture !== 'function') throw jwtError('PULSE_JWT_CLOCK_UNAVAILABLE');
  let clock: JwtCapturedWallClock;
  try {
    clock = await capture();
  } catch {
    throw jwtError('PULSE_JWT_CLOCK_UNAVAILABLE');
  }
  if (!isJwtOrdinaryObject(clock)) throw jwtError('PULSE_JWT_CLOCK_INVALID');
  const trusted = jwtOwnDataProperty(clock, 'trusted');
  const instant = jwtOwnDataProperty(clock, 'unixEpochSeconds');
  if (!trusted.valid || !instant.valid) throw jwtError('PULSE_JWT_CLOCK_INVALID');
  if (!trusted.present || trusted.value !== true) throw jwtError('PULSE_JWT_CLOCK_UNAVAILABLE');
  const seconds = instant.present ? instant.value : undefined;
  if (
    typeof seconds !== 'number'
    || !Number.isFinite(seconds)
    || seconds < 0
    || seconds > MAX_DATE_SECONDS
  ) {
    throw jwtError('PULSE_JWT_CLOCK_INVALID');
  }
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) throw jwtError('PULSE_JWT_CLOCK_INVALID');
  return date;
}
