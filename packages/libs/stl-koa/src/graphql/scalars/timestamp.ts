import * as stl from '@opvious/stl';
import * as gql from 'graphql';
import {DateTime, Zone} from 'luxon';

import {standardScalar} from './common.js';

export interface TimestampScalarOptions {
  readonly name?: string;

  /** Optional zone override. */
  readonly zone?: string | Zone;
}

/** Millisecond precision timestamp. */
export function timestampScalar(
  opts?: TimestampScalarOptions
): gql.GraphQLScalarType<DateTime, number> {
  const {name, zone} = opts ?? {};
  const scalarName = name ?? 'Timestamp';

  return standardScalar({
    name: scalarName,
    description: 'Millisecond-resolution timestamp',
    encode(arg: unknown): number {
      stl.assert(DateTime.isDateTime(arg), 'Not a datetime', arg);
      return arg.toMillis();
    },
    decode(arg: unknown): DateTime {
      stl.assert(typeof arg == 'number', 'Non-number value');
      return DateTime.fromMillis(arg, {zone});
    },
  });
}
