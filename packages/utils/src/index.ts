export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${String(value)}`);
}

export function normalizeIndianPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  const nationalNumber = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  return `+91${nationalNumber}`;
}
