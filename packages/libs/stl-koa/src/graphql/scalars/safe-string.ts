import * as stl from '@opvious/stl';
import * as gql from 'graphql';

import {standardScalar} from './common.js';

export interface SafeStringScalarOptions {
  /** Scalar description. */
  readonly description?: string;

  /** Defaults to 128. */
  readonly maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 128;

/** String with optional safeguards. */
export function safeStringScalar(
  name: string,
  opts?: SafeStringScalarOptions
): gql.GraphQLScalarType<string, string> {
  const maxLength = opts?.maxLength ?? DEFAULT_MAX_LENGTH;

  return standardScalar({
    name,
    description: opts?.description,
    encode(arg: unknown): string {
      assertSafe(arg, maxLength);
      return arg;
    },
    decode(arg: unknown): string {
      assertSafe(arg, maxLength);
      return arg;
    },
  });
}

function assertSafe(arg: unknown, maxLength: number): asserts arg is string {
  stl.assertType('string', arg);
  stl.assert(
    arg.length <= maxLength,
    'String too long: %d > %d',
    arg.length,
    maxLength
  );
}
