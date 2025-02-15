import {assert, newChecker} from '@mtth/stl-errors';
import {
  newSetting,
  Setting,
  SettingOptions,
  SettingSource,
  simpleSettingFactory,
} from '@mtth/stl-settings';
import {DateTime, Duration} from 'luxon';

export const checkIsDateTime = newChecker<DateTime>('a DateTime', (a) =>
  DateTime.isDateTime(a)
);

export const checkIsDuration = newChecker<Duration>('a Duration', (a) =>
  Duration.isDuration(a)
);

/**
 * Parses a Luxon DateTime from a string. Various formats are accepted:
 *
 * + Numbers, parsed as milliseconds timestamps,
 * + ISO dates if no format is specified,
 * + Dates in the given format.
 */
export function parseDateTime(
  s: string,
  opts?: ParseDateTimeOptions
): DateTime {
  const fmt = opts?.format;
  let d: DateTime;
  const n = +s;
  if (!isNaN(n)) {
    d = DateTime.fromMillis(n);
  } else if (fmt) {
    d = DateTime.fromFormat(s, fmt);
  } else {
    d = DateTime.fromISO(s);
  }
  assert(d.isValid, 'Bad datetime');
  return d;
}

export interface ParseDateTimeOptions {
  /**
   * Override the default ISO-8601 format for non-numeric inputs. Refer to
   * https://moment.github.io/luxon/#/parsing?id=table-of-tokens for the list of
   * supported tokens.
   */
  readonly format?: string;
}

/** Setting parsing a Luxon datetime with `parseDateTime` */
export function dateTimeSetting<S extends SettingSource>(
  source: S,
  opts?: DateTimeSettingOptions
): Setting<S, DateTime> {
  return newSetting(source, opts, (s) => parseDateTime(s, opts));
}

export interface DateTimeSettingOptions
  extends SettingOptions,
    ParseDateTimeOptions {}

/**
 * Parses a Luxon duration. It can parse three types of inputs:
 *
 * + Numeric strings, interpreted as millisecond durations,
 * + ISO-8601 strings, parsed according to the spec,
 * + '<int> <unit>', where unit is one of the values accepted by Luxon. The
 *   trailing s may be omitted from the long forms. Note that there must be at
 *   least one space between the numeric and unit portions.
 */
export function parseDuration(s: string): Duration {
  let d: Duration;
  if (s.startsWith('P')) {
    d = Duration.fromISO(s);
  } else {
    const parts = s.split(' ').filter((s) => s);
    assert(
      parts[0] && parts.length <= 2 && /^[0-9]+$/.test(parts[0]),
      'Bad duration'
    );
    const num = parseInt(parts[0], 10);
    let unit = parts[1] ?? 'milliseconds';
    if (!unit.endsWith('s')) {
      unit += 's';
    }
    d = Duration.fromObject({[unit]: num});
  }
  assert(d.isValid, 'Bad duration');
  return d;
}

/** Setting parsing a Luxon duration via `parseDuration` */
export const durationSetting = simpleSettingFactory(parseDuration);
