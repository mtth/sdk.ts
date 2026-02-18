import type {Temporal} from 'temporal-polyfill';

import * as sut from '../src/datetimes.js';

const units = [
  'years',
  'months',
  'weeks',
  'days',
  'hours',
  'minutes',
  'seconds',
  'milliseconds',
  'microseconds',
  'nanoseconds',
] as const;

type Unit = (typeof units)[number];

function expectParts(
  d: Temporal.Duration,
  expected: Partial<Record<Unit, number>>
): void {
  for (const unit of units) {
    expect(d[unit]).toEqual(expected[unit] ?? 0);
  }
}

describe('parse duration', () => {
  test.each([
    ['123', {milliseconds: 123}],
    ['2 seconds', {seconds: 2}],
    ['5 minutes', {minutes: 5}],
    ['1 hours', {hours: 1}],
    ['1 millisecond', {milliseconds: 1}],
    ['1 day', {days: 1}],
    ['1 week', {weeks: 1}],
    ['3 months', {months: 3}],
    ['2 years', {years: 2}],
    ['P1DT2H', {days: 1, hours: 2}],
  ])('%s is valid', (arg, expected) => {
    expectParts(sut.parseDuration(arg), expected);
  });

  test.each([
    'abc',
    '1second',
    '4 days and a half',
    '0.5 minutes',
    '1 quarter',
    '2 quarters',
  ])('%s is invalid', (arg) => {
    expect(() => sut.parseDuration(arg)).toThrow(/Bad duration/);
  });
});
