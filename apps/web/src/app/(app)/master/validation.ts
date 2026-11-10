export class MasterInputError extends Error {}

export function textField(form: FormData, field: string, max: number, required = false): string {
  const raw = form.get(field);
  if (raw !== null && typeof raw !== 'string') throw new MasterInputError(`Invalid ${field}`);
  const value = (raw ?? '').trim();
  if (required && !value) throw new MasterInputError(`${field} is required`);
  if (value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new MasterInputError(`${field} must be ${max} characters or fewer and contain no control characters`);
  return value;
}

export function phoneField(form: FormData, field: 'hostelPhone' | 'contactPhone'): string {
  const value = textField(form, field, 10);
  if (value && !/^\d{10}$/.test(value)) throw new MasterInputError(`${field} must contain exactly 10 digits, without spaces or +91; leave blank to remove`);
  return value;
}

export function godownIdField(form: FormData): number {
  const value = textField(form, 'godownId', 16, true);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new MasterInputError('Choose a valid godown');
  return Number(value);
}
