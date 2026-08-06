export interface JwtOwnDataProperty {
  readonly present: boolean;
  readonly valid: boolean;
  readonly value?: unknown;
}

export function isJwtOrdinaryObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function jwtOwnDataProperty(
  value: object,
  name: string,
): JwtOwnDataProperty {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor) return Object.freeze({ present: false, valid: true });
    if (
      !descriptor.enumerable
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      return Object.freeze({ present: true, valid: false });
    }
    return Object.freeze({
      present: true,
      valid: true,
      value: descriptor.value,
    });
  } catch {
    return Object.freeze({ present: true, valid: false });
  }
}

export function jwtDataEntries(
  value: object,
): readonly (readonly [string, unknown])[] | undefined {
  try {
    const entries: (readonly [string, unknown])[] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return undefined;
      const property = jwtOwnDataProperty(value, key);
      if (!property.present || !property.valid) return undefined;
      entries.push(Object.freeze([key, property.value] as const));
    }
    return Object.freeze(entries);
  } catch {
    return undefined;
  }
}

export function jwtDataRecord(
  value: unknown,
): ReadonlyMap<string, unknown> | undefined {
  if (!isJwtOrdinaryObject(value)) return undefined;
  const entries = jwtDataEntries(value);
  return entries ? new Map(entries) : undefined;
}

export function jwtDenseArrayValues(
  value: unknown,
): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)) {
        return undefined;
      }
    }
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const property = jwtOwnDataProperty(value, String(index));
      if (!property.present || !property.valid) return undefined;
      output.push(property.value);
    }
    return Object.freeze(output);
  } catch {
    return undefined;
  }
}

export function defineJwtDataProperty(
  target: object,
  name: string,
  value: unknown,
): void {
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
