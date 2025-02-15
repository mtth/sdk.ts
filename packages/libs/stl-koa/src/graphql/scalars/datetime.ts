import * as stl from '@opvious/stl';
import * as gql from 'graphql';
import {DateTime, Zone} from 'luxon';

import {standardScalar} from './common.js';

export interface DateTimeScalarOptions {
  readonly name?: string;

  /**
   * Optional zone override. This is only used when parsing dates without an
   * explicit zone.
   */
  readonly zone?: string | Zone;
}

/** ISO 8601 DateTime scalar. */
export function dateTimeScalar(
  opts?: DateTimeScalarOptions
): gql.GraphQLScalarType<DateTime, string> {
  const {name, zone} = opts ?? {};
  const scalarName = name ?? 'DateTime';

  return standardScalar({
    name: scalarName,
    description: 'ISO 8601 datetime',
    encode(arg: unknown): string {
      stl.assert(
        DateTime.isDateTime(arg) && arg.isValid,
        'Not a valid datetime',
        arg
      );
      return arg.toISO();
    },
    decode(arg: unknown): DateTime {
      stl.assertType('string', arg);
      return DateTime.fromISO(arg, {setZone: true, zone});
    },
  });
}
