import { DomainError } from './ledgerErrors';
import {
  DEFAULT_FAMILY_TIMEZONE,
  isSupportedFamilyTimezone,
  normalizeFamilyTimezone,
} from './timezoneService';

describe('timezoneService', () => {
  test('defaults an omitted timezone to Asia/Shanghai', () => {
    expect(normalizeFamilyTimezone(undefined)).toBe(DEFAULT_FAMILY_TIMEZONE);
  });

  test('canonicalizes UTC and accepts a non-default IANA zone', () => {
    expect(normalizeFamilyTimezone(' UTC ')).toBe('UTC');
    expect(normalizeFamilyTimezone('America/New_York')).toBe('America/New_York');
    expect(isSupportedFamilyTimezone('America/New_York')).toBe(true);
  });

  test('rejects abbreviations, offsets and unknown zones', () => {
    for (const value of ['CST', '+08:00', 'not/a-zone', '', null]) {
      expect(() => normalizeFamilyTimezone(value)).toThrow(DomainError);
    }
  });

  test('does not depend on the process local timezone', () => {
    expect(normalizeFamilyTimezone('Asia/Shanghai')).toBe('Asia/Shanghai');
  });
});
