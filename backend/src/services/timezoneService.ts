import { DomainError } from './ledgerErrors';

export const DEFAULT_FAMILY_TIMEZONE = 'Asia/Shanghai';

const invalidTimezone = (): never => {
  throw new DomainError('INVALID_TIMEZONE', 'Invalid IANA timezone.', 400);
};

export const normalizeFamilyTimezone = (value: unknown): string => {
  if (value === undefined) return DEFAULT_FAMILY_TIMEZONE;
  if (typeof value !== 'string') return invalidTimezone();

  const candidate = value.trim();
  if (candidate === 'UTC') return 'UTC';
  if (!candidate.includes('/')) return invalidTimezone();

  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: candidate })
      .resolvedOptions()
      .timeZone;
    return resolved || invalidTimezone();
  } catch {
    return invalidTimezone();
  }
};

export const isSupportedFamilyTimezone = (value: unknown): boolean => {
  try {
    normalizeFamilyTimezone(value);
    return true;
  } catch {
    return false;
  }
};
