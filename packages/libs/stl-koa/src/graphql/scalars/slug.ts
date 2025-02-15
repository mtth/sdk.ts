import * as stl from '@opvious/stl';
import * as gql from 'graphql';

import {standardScalar} from './common.js';

export interface SlugScalarOptions {
  readonly maxLength?: number;
  readonly name?: string;
  readonly allowPrivate?: boolean;
}

const DEFAULT_SCALAR_NAME = 'Slug';

/** URL-friendly string. By default private slugs are not allowed. */
export function slugScalar(
  opts?: SlugScalarOptions
): gql.GraphQLScalarType<stl.Slug, string> {
  const {allowPrivate, maxLength} = opts ?? {};

  return standardScalar({
    name: opts?.name ?? DEFAULT_SCALAR_NAME,
    description: 'URL-friendly string',
    encode(arg: unknown): string {
      stl.assert(
        typeof arg == 'string' &&
          stl.isSlug(arg, maxLength) &&
          (allowPrivate || !arg.startsWith('.')),
        'Invalid input: %s',
        arg
      );
      return arg;
    },
    decode(arg: unknown): stl.Slug {
      stl.assert(typeof arg == 'string', 'Non-string value', arg);
      return stl.newSlug(arg, maxLength);
    },
  });
}
