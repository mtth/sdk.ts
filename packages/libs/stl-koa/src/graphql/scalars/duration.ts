import * as stl from '@opvious/stl';
import * as gql from 'graphql';
import {Duration} from 'luxon';

import {standardScalar} from './common.js';

export interface DurationScalarOptions {
  readonly name?: string;
}

/** Millisecond precision duration scalar. */
export function durationScalar(
  opts?: DurationScalarOptions
): gql.GraphQLScalarType<Duration, number> {
  const scalarName = opts?.name ?? 'Duration';

  return standardScalar({
    name: scalarName,
    description: 'Millisecond precision duration',
    encode(arg: unknown): number {
      stl.assert(Duration.isDuration(arg), 'Not a duration: %j', arg);
      return +arg;
    },
    decode(arg: unknown): Duration {
      stl.assertType('number', arg);
      return Duration.fromMillis(arg);
    },
  });
}
