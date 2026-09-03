import { DomainError } from './ledgerErrors';
import { normalizeFamilyTimezone } from './timezoneService';

export type PeriodKind = 'CUSTOM' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

type PlainDate = { year: number; month: number; day: number };
type PlainDateTime = PlainDate & { hour: number; minute: number; second: number };

export interface PeriodWindowInput {
  timezone: string;
  kind: PeriodKind;
  referenceInstant?: Date;
  localStart?: string;
  localEndExclusive?: string;
}

export interface PeriodWindow {
  timezone: string;
  startUtc: Date;
  endUtc: Date;
  startLocal: string;
  endLocalExclusive: string;
}

const invalidPeriod = (message = 'Invalid period window.'): never => {
  throw new DomainError('INVALID_PERIOD_WINDOW', message, 400);
};

const formatter = (timezone: string): Intl.DateTimeFormat => new Intl.DateTimeFormat('en-US', {
  timeZone: timezone,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const partsToPlainDateTime = (parts: Intl.DateTimeFormatPart[]): PlainDateTime => {
  const values = new Map(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  const hour = values.get('hour');
  const minute = values.get('minute');
  const second = values.get('second');
  if ([year, month, day, hour, minute, second].some((value) => value === undefined || !Number.isInteger(value))) {
    return invalidPeriod('Unable to resolve a local date-time.');
  }
  return { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, second: second! };
};

const parsePlainDate = (value: unknown): PlainDate => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return invalidPeriod('Date must use YYYY-MM-DD.');
  }
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return invalidPeriod('Date is outside the Gregorian calendar.');
  }
  return { year, month, day };
};

const isLeapYear = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const formatPlainDate = ({ year, month, day }: PlainDate): string => (
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

const comparePlainDate = (left: PlainDate, right: PlainDate): number => (
  left.year - right.year || left.month - right.month || left.day - right.day
);

const plainDateTimeAsUtc = ({ year, month, day, hour = 0, minute = 0, second = 0 }: PlainDate & Partial<Pick<PlainDateTime, 'hour' | 'minute' | 'second'>>): number => {
  const value = new Date(0);
  value.setUTCHours(hour, minute, second, 0);
  value.setUTCFullYear(year, month - 1, day);
  return value.getTime();
};

const localDateFromInstant = (instant: Date, dateFormatter: Intl.DateTimeFormat): PlainDate => {
  const parts = partsToPlainDateTime(dateFormatter.formatToParts(instant));
  return { year: parts.year, month: parts.month, day: parts.day };
};

const isSameLocalMidnight = (instant: number, localDate: PlainDate, dateFormatter: Intl.DateTimeFormat): boolean => {
  const observed = partsToPlainDateTime(dateFormatter.formatToParts(new Date(instant)));
  return observed.year === localDate.year
    && observed.month === localDate.month
    && observed.day === localDate.day
    && observed.hour === 0
    && observed.minute === 0
    && observed.second === 0;
};

const firstValidInstantAfterGap = (
  localDate: PlainDate,
  targetAsUtc: number,
  dateFormatter: Intl.DateTimeFormat,
): Date => {
  const minute = 60_000;
  const searchStart = Math.floor((targetAsUtc - 36 * 3_600_000) / minute) * minute;
  const searchEnd = targetAsUtc + 72 * 3_600_000;
  for (let candidate = searchStart; candidate <= searchEnd; candidate += minute) {
    const observed = partsToPlainDateTime(dateFormatter.formatToParts(new Date(candidate)));
    if (observed.year === localDate.year && observed.month === localDate.month && observed.day === localDate.day) {
      return new Date(candidate);
    }
  }
  return invalidPeriod('Local date does not exist in the selected timezone.');
};

const localMidnightToUtc = (localDate: PlainDate, timezone: string): Date => {
  const dateFormatter = formatter(timezone);
  const targetAsUtc = plainDateTimeAsUtc(localDate);
  const offsets = new Set<number>();

  // Sample both sides of the boundary so an ambiguous midnight can choose the earlier offset.
  for (let hours = -48; hours <= 48; hours += 1) {
    const candidate = targetAsUtc + hours * 3_600_000;
    const observed = partsToPlainDateTime(dateFormatter.formatToParts(new Date(candidate)));
    offsets.add(candidate - plainDateTimeAsUtc(observed));
  }

  const validMidnights = [...offsets]
    .map((offset) => targetAsUtc + offset)
    .filter((candidate) => isSameLocalMidnight(candidate, localDate, dateFormatter));
  if (validMidnights.length > 0) {
    return new Date(Math.min(...validMidnights));
  }

  return firstValidInstantAfterGap(localDate, targetAsUtc, dateFormatter);
};

const addMonths = (date: PlainDate, months: number): PlainDate => {
  const zeroBasedMonth = date.month - 1 + months;
  const year = date.year + Math.floor(zeroBasedMonth / 12);
  const month = ((zeroBasedMonth % 12) + 12) % 12 + 1;
  const day = Math.min(date.day, daysInMonth(year, month));
  return { year, month, day };
};

export const resolvePeriodWindow = (input: PeriodWindowInput): PeriodWindow => {
  const timezone = normalizeFamilyTimezone(input.timezone);
  const dateFormatter = formatter(timezone);
  let startLocal: PlainDate;
  let endLocalExclusive: PlainDate;

  switch (input.kind) {
    case 'CUSTOM':
      startLocal = parsePlainDate(input.localStart);
      endLocalExclusive = parsePlainDate(input.localEndExclusive);
      break;
    case 'MONTHLY': {
      const reference = input.referenceInstant ?? new Date();
      if (!(reference instanceof Date) || !Number.isFinite(reference.getTime())) return invalidPeriod('Reference instant is invalid.');
      const localReference = localDateFromInstant(reference, dateFormatter);
      startLocal = { ...localReference, day: 1 };
      endLocalExclusive = addMonths(startLocal, 1);
      break;
    }
    case 'QUARTERLY': {
      const reference = input.referenceInstant ?? new Date();
      if (!(reference instanceof Date) || !Number.isFinite(reference.getTime())) return invalidPeriod('Reference instant is invalid.');
      const localReference = localDateFromInstant(reference, dateFormatter);
      startLocal = {
        year: localReference.year,
        month: Math.floor((localReference.month - 1) / 3) * 3 + 1,
        day: 1,
      };
      endLocalExclusive = addMonths(startLocal, 3);
      break;
    }
    case 'YEARLY': {
      const reference = input.referenceInstant ?? new Date();
      if (!(reference instanceof Date) || !Number.isFinite(reference.getTime())) return invalidPeriod('Reference instant is invalid.');
      const localReference = localDateFromInstant(reference, dateFormatter);
      startLocal = { year: localReference.year, month: 1, day: 1 };
      endLocalExclusive = { year: localReference.year + 1, month: 1, day: 1 };
      break;
    }
    default:
      return invalidPeriod('Unknown period kind.');
  }

  if (comparePlainDate(endLocalExclusive, startLocal) <= 0) {
    return invalidPeriod();
  }

  return {
    timezone,
    startUtc: localMidnightToUtc(startLocal, timezone),
    endUtc: localMidnightToUtc(endLocalExclusive, timezone),
    startLocal: formatPlainDate(startLocal),
    endLocalExclusive: formatPlainDate(endLocalExclusive),
  };
};
