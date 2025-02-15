import * as stl from '@opvious/stl';
import * as gql from 'graphql';

import {standardScalar} from './common.js';

export interface UuidScalarOptions {
  readonly name?: string;
}

const DEFAULT_SCALAR_NAME = 'Uuid';

/** UUID. */
export function uuidScalar(
  opts?: UuidScalarOptions
): gql.GraphQLScalarType<stl.Uuid, string> {
  const scalarName = opts?.name ?? DEFAULT_SCALAR_NAME;

  return standardScalar({
    name: scalarName,
    description: 'URL-friendly uuid',
    encode(arg: unknown): string {
      stl.assert(typeof arg == 'string' && stl.isUuid(arg), 'Bad UUID', arg);
      return arg;
    },
    decode(arg: unknown): stl.Uuid {
      stl.assertType('string', arg);
      return stl.newUuid(arg);
    },
  });
}
