import {settingsProvider} from '@mtth/stl-settings';
import {DateTime, Duration} from 'luxon';

import * as sut from '../src/time.js';

describe('check', () => {
  test('datetime', () => {
    const now = DateTime.now();
    expect(sut.checkIsDateTime(now)).toEqual(now);
    expect(() => {
      sut.checkIsDateTime(123);
    }).toThrow();
  });

  test('duration', () => {
    const dur = Duration.fromMillis(123);
    expect(sut.checkIsDuration(dur)).toEqual(dur);
    expect(() => {
      sut.checkIsDuration(123);
    }).toThrow();
  });
});

describe('datetime setting', () => {
  test.each([
    ['11/2/2023', 'M/d/yyyy', '2023-11-02T00:00:00.000'],
    ['2022-02-14T07:00:00-0800', undefined, '2022-02-14T15:00:00.000Z'],
    ['2022-02-14T09:00:00Z', undefined, '2022-02-14T09:00:00.000Z'],
    ['1644171708782', undefined, '2022-02-06T18:21:48.782Z'],
    ['1644171708982', 'yyyy', '2022-02-06T18:21:48.982Z'],
  ])('%s is valid for format %s', (src, fmt, dt) => {
    const settings = settingsProvider(() =>
      sut.dateTimeSetting(src, {format: fmt})
    );
    expect(settings()).toEqual(DateTime.fromISO(dt));
  });

  test.each([
    ['abc', undefined],
    ['11/2/2023', 'M-D-YYYY'],
    ['1234 43', 'YY-MM'],
  ])('%s is invalid for format %s', (src, fmt) => {
    const settings = settingsProvider(() =>
      sut.dateTimeSetting(src, {format: fmt})
    );
    expect(settings).toThrow(/Bad date/);
  });
});

describe('duration setting', () => {
  const settings = settingsProvider((env) => sut.durationSetting(env.d));

  test.each([
    ['123', 123],
    ['2 seconds', 2_000],
    ['5 minutes', 300_000],
    ['1 hours', 3_600_000],
    ['1 millisecond', 1],
    ['1 day', 86_400_000],
    ['1 week', 604_800_000],
    ['3 months', 3 * 30 * 86_400_000],
    ['P1DT2H', 86_400_000 + 2 * 3_600_000],
  ])('%s is valid', (d, ms) => {
    expect(settings({d})?.toMillis()).toEqual(ms);
  });

  test.each(['abc', '1second', '4 days and a half', '0.5 minutes'])(
    '%s is invalid',
    (d) => {
      expect(() => settings({d})).toThrow(/Bad duration/);
    }
  );
});
