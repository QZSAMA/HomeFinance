import { DomainError } from './ledgerErrors';
import { PeriodWindow, resolvePeriodWindow } from './periodWindowService';

const expectDomainCode = (run: () => unknown, code: string) => {
  try {
    run();
    throw new Error(`Expected ${code} to be thrown`);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
};

describe('periodWindowService', () => {
  test('resolves a Shanghai month to a UTC half-open window', () => {
    const window = resolvePeriodWindow({
      timezone: 'Asia/Shanghai',
      kind: 'MONTHLY',
      referenceInstant: new Date('2026-09-15T00:00:00Z'),
    });

    expect(window).toMatchObject<Partial<PeriodWindow>>({
      timezone: 'Asia/Shanghai',
      startLocal: '2026-09-01',
      endLocalExclusive: '2026-10-01',
    });
    expect(window.startUtc.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(window.endUtc.toISOString()).toBe('2026-09-30T16:00:00.000Z');
  });

  test('resolves quarter, year and leap-year boundaries in the local calendar', () => {
    const quarter = resolvePeriodWindow({
      timezone: 'Asia/Shanghai',
      kind: 'QUARTERLY',
      referenceInstant: new Date('2024-02-29T12:00:00Z'),
    });
    expect(quarter.startLocal).toBe('2024-01-01');
    expect(quarter.endLocalExclusive).toBe('2024-04-01');

    const year = resolvePeriodWindow({
      timezone: 'Asia/Shanghai',
      kind: 'YEARLY',
      referenceInstant: new Date('2024-12-31T12:00:00Z'),
    });
    expect(year.startLocal).toBe('2024-01-01');
    expect(year.endLocalExclusive).toBe('2025-01-01');

    const leapMonth = resolvePeriodWindow({
      timezone: 'Asia/Shanghai',
      kind: 'MONTHLY',
      referenceInstant: new Date('2024-02-15T00:00:00Z'),
    });
    expect(leapMonth.endLocalExclusive).toBe('2024-03-01');
    expect(leapMonth.endUtc.toISOString()).toBe('2024-02-29T16:00:00.000Z');
  });

  test.each([
    ['America/New_York', '2026-03-08', '2026-03-09', 23],
    ['America/New_York', '2026-11-01', '2026-11-02', 25],
  ])('handles DST without assuming 24 hours (%s)', (timezone, localStart, localEndExclusive, hours) => {
    const window = resolvePeriodWindow({
      timezone,
      kind: 'CUSTOM',
      localStart,
      localEndExclusive,
    });
    expect((window.endUtc.getTime() - window.startUtc.getTime()) / 3_600_000).toBe(hours);
  });

  test('rejects invalid dates and non-positive custom windows', () => {
    expectDomainCode(
      () => resolvePeriodWindow({
        timezone: 'Asia/Shanghai',
        kind: 'CUSTOM',
        localStart: '2026-02-30',
        localEndExclusive: '2026-03-01',
      }),
      'INVALID_PERIOD_WINDOW',
    );

    expectDomainCode(
      () => resolvePeriodWindow({
        timezone: 'Asia/Shanghai',
        kind: 'CUSTOM',
        localStart: '2026-08-31',
        localEndExclusive: '2026-08-31',
      }),
      'INVALID_PERIOD_WINDOW',
    );

    const window = resolvePeriodWindow({
      timezone: 'Asia/Shanghai',
      kind: 'CUSTOM',
      localStart: '2026-08-01',
      localEndExclusive: '2026-08-31',
    });
    expect(window.endLocalExclusive).toBe('2026-08-31');
  });

  test('rejects missing custom boundaries, invalid timezones and invalid reference instants', () => {
    expectDomainCode(
      () => resolvePeriodWindow({ timezone: 'Asia/Shanghai', kind: 'CUSTOM', localStart: '2026-08-01' }),
      'INVALID_PERIOD_WINDOW',
    );
    expectDomainCode(
      () => resolvePeriodWindow({ timezone: 'CST', kind: 'MONTHLY', referenceInstant: new Date() }),
      'INVALID_TIMEZONE',
    );
    expectDomainCode(
      () => resolvePeriodWindow({ timezone: 'Asia/Shanghai', kind: 'MONTHLY', referenceInstant: new Date('invalid') }),
      'INVALID_PERIOD_WINDOW',
    );
  });
});
