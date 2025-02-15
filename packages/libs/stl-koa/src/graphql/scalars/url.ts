import * as stl from '@opvious/stl';
import * as gql from 'graphql';
import {URL} from 'url';

import {standardScalar} from './common.js';

export interface UrlScalarOptions {
  readonly name?: string;
}

const DEFAULT_SCALAR_NAME = 'Url';

/** URL scalar. */
export function urlScalar(
  opts?: UrlScalarOptions
): gql.GraphQLScalarType<URL, string> {
  const scalarName = opts?.name ?? DEFAULT_SCALAR_NAME;

  return standardScalar({
    name: scalarName,
    description: 'URL-friendly url',
    encode(arg: unknown): string {
      return '' + arg;
    },
    decode(arg: unknown): URL {
      stl.assert(typeof arg == 'string', 'Non-string value');
      return new URL(arg);
    },
  });
}
