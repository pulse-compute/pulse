type LookupInput = Readonly<{
  id: string;
  name: string;
  active: boolean;
  profile: Readonly<{ region: string }>;
  values: readonly string[];
}>;

export async function lookupCustomer(_ctx: unknown, input: LookupInput) {
  const label = `${input.profile.region}:${input.name}`;
  const active = input.active === true;
  if (active) {
    return {
      id: input.id,
      label,
      active,
      region: input.profile.region,
    };
  }
  return {
    id: input.id,
    label,
    active: false,
    region: input.profile.region,
  };
}

export function recursiveOperation(ctx: unknown, input: LookupInput) {
  return recursiveOperation(ctx, input);
}

export function crossOperationA(ctx: unknown, input: LookupInput) {
  return crossOperationB(ctx, input);
}

export function crossOperationB(_ctx: unknown, input: LookupInput) {
  return input;
}

export function callbackOperation(_ctx: unknown, input: LookupInput) {
  return input.values.map((value) => ({ value }));
}

function consume(_value: unknown) {}

export function escapeOperation(_ctx: unknown, input: LookupInput) {
  consume(input);
  return { id: input.id };
}

export function unsupportedResult(_ctx: unknown, _input: LookupInput) {
  return;
}

export function valueForCompletion(_ctx: unknown, input: LookupInput) {
  return { id: input.id };
}

export function unresolvedReference(_ctx: unknown, _input: LookupInput) {
  return { value: missingValue };
}

export function mutateInput(_ctx: unknown, input: LookupInput) {
  input.name = 'changed';
  return input;
}

export function badSignature(input: LookupInput) {
  return input;
}
