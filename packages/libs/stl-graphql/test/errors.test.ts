import {
  errorCauseExtractor,
  errorCodes,
  defaultErrors,
  findErrorWithCode,
  setCauseExtractors,
  statusErrors,
} from '@mtth/stl-errors';
import * as gql from 'graphql';

import * as sut from '../src/errors.js';

describe('standardize GrqphQL errors', () => {
  test.each([
    [
      'built-in error',
      new Error('boom'),
      new gql.GraphQLError('Unknown error'),
    ],
    [
      'status error',
      statusErrors.notFound(
        defaultErrors.internal({
          message: 'bang',
          tags: {one: 1},
        })
      ),
      new gql.GraphQLError('Not found error [ERR_INTERNAL]: bang', {
        extensions: {
          status: 'NOT_FOUND',
          exception: {code: 'ERR_INTERNAL', tags: {one: 1}} as any,
        },
      }),
    ],
    [
      'GraphQL error',
      new gql.GraphQLError('cause!', {path: ['abc', 'def']}),
      new gql.GraphQLError('Unknown error', {path: ['abc', 'def']}),
    ],
  ])('handles %s', (_desc, err, want) => {
    const got = sut.standardizeGraphqlError(err);
    expect(got.message).toEqual(want.message);
    expect(got.extensions).toEqual(want.extensions);
    expect(got.path).toEqual(want.path);
  });

  test('maps status', () => {
    const err = defaultErrors.internal({
      message: 'bang',
      cause: defaultErrors.illegal({tags: {key: 'yes'}}),
    });
    const got = sut.standardizeGraphqlError(err, {
      statuses: {[errorCodes.Illegal]: 'RESOURCE_EXHAUSTED'},
    });
    expect(got.extensions).toEqual({
      status: 'RESOURCE_EXHAUSTED',
      exception: {code: 'ERR_ILLEGAL', tags: {key: 'yes'}},
    });
  });
});

test('error result', () => {
  const got = sut.errorResult(['oops']);
  expect(got).toEqual({errors: [new gql.GraphQLError('Unknown error')]});
});

describe('cause extractor', () => {
  let extractors;

  beforeAll(() => {
    extractors = setCauseExtractors([
      errorCauseExtractor,
      sut.graphqlErrorCauseExtractor,
    ]);
  });

  afterAll(() => {
    setCauseExtractors(extractors);
  });

  test('finds original errors', async () => {
    const cause = defaultErrors.illegal();
    const err = defaultErrors.internal({
      cause: sut.standardizeGraphqlError(cause),
    });
    const match = findErrorWithCode(err, errorCodes.Illegal);
    expect(match?.error).toBe(cause);
  });
});
