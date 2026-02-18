import {assert} from '@mtth/stl-errors';
import {Temporal} from 'temporal-polyfill';

/**
 * Parses a Temporal duration. It can parse three types of inputs:
 *
 * + Numeric strings, interpreted as millisecond durations,
 * + ISO-8601 strings, parsed according to the spec,
 * + '<int> <unit>', where unit is one of the values accepted by Luxon. The
 *   trailing s may be omitted from the long forms. Note that there must be at
 *   least one space between the numeric and unit portions.
 */
export function parseDuration(s: string): Temporal.Duration {
  let d: Temporal.Duration;
  if (s.startsWith('P')) {
    try {
      d = Temporal.Duration.from(s);
    } catch {
      assert(false, 'Bad duration');
    }
  } else {
    const parts = s.split(' ').filter((p) => p);
    assert(
      parts[0] && parts.length <= 2 && /^[0-9]+$/.test(parts[0]),
      'Bad duration'
    );
    const num = parseInt(parts[0], 10);
    let unit = parts[1] ?? 'milliseconds';
    if (!unit.endsWith('s')) {
      unit += 's';
    }
    assert(unit !== 'quarters', 'Bad duration');
    try {
      d = Temporal.Duration.from({[unit]: num});
    } catch {
      assert(false, 'Bad duration');
    }
  }
  return d;
}
