export interface OwnDataProperty {
  readonly present: boolean;
  readonly valid: boolean;
  readonly value?: unknown;
}

export function isOrdinaryObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function ownDataProperty(value: object, name: string): OwnDataProperty {
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
}

export function exactDataProperties(
  value: object,
  required: ReadonlySet<string>,
): boolean {
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string')
    || keys.length !== required.size
  ) {
    return false;
  }
  for (const name of required) {
    const property = ownDataProperty(value, name);
    if (!property.present || !property.valid) return false;
  }
  return true;
}

export function copyBytes(value: unknown): Uint8Array<ArrayBuffer> | undefined {
  if (!(value instanceof Uint8Array)) return undefined;
  const output = new Uint8Array(value.byteLength);
  Uint8Array.prototype.set.call(output, value);
  return output;
}
