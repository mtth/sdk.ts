import * as stl from '@opvious/stl';
import {errorResult} from '@opvious/stl-graphql';
import * as gql from 'graphql';

import * as sut from '../../src/graphql/common.js';

const telemetry = stl.RecordingTelemetry.forTesting();

describe('infer http status', () => {
  test('no errors', () => {
    const code = sut.inferHttpCode({result: {}, telemetry});
    expect(code).toBe(200);
  });

  test.each([
    ['boom', new Error('boom'), 500],
    ['invalid', stl.statusErrors.invalidArgument(new Error()), 400],
    ['resources', stl.statusErrors.resourceExhausted(new Error()), 429],
    [
      'nested',
      stl.errors.internal({
        cause: stl.statusErrors.deadlineExceeded(new Error()),
      }),
      504,
    ],
  ])('single error %s', (_desc, err, want) => {
    const code = sut.inferHttpCode({result: errorResult([err]), telemetry});
    expect(code).toBe(want);
  });

  test.each([
    [
      'boom and status',
      [new Error('boom'), stl.statusErrors.invalidArgument(new Error())],
      500,
    ],
    [
      '4xx',
      [
        stl.statusErrors.invalidArgument(new Error()),
        stl.statusErrors.cancelled(new Error()),
        stl.errors.internal({
          cause: stl.statusErrors.alreadyExists(new Error()),
        }),
      ],
      400,
    ],
    [
      '5xx',
      [
        stl.statusErrors.resourceExhausted(new Error()),
        stl.statusErrors.unavailable(new Error()),
      ],
      500,
    ],
    [
      'identical',
      [
        stl.statusErrors.unauthenticated(new Error()),
        stl.errors.internal({
          cause: stl.statusErrors.unauthenticated(new Error()),
        }),
        stl.statusErrors.unauthenticated(new Error()),
        stl.statusErrors.unauthenticated(new Error()),
      ],
      401,
    ],
  ])('multiple errors %s', (_desc, errs, want) => {
    const code = sut.inferHttpCode({result: errorResult(errs), telemetry});
    expect(code).toBe(want);
  });

  test.each([
    [
      'with cause',
      new gql.GraphQLError('bang', {originalError: new Error('boom')}),
      'INVALID_ARGUMENT',
      500,
    ],
    ['without cause', new gql.GraphQLError('bang'), 'INVALID_ARGUMENT', 400],
    ['other error', new Error('bang'), 'UNKNOWN', 500],
  ])('graphql error status %s', (_desc, err, status, want) => {
    expect(
      sut.inferHttpCode({
        result: errorResult([err]),
        pureGraphqlStatus: status as any,
        telemetry,
      })
    ).toBe(want);
  });
});

describe('serialize GraphQL error', () => {
  function next(err: any): any {
    return err;
  }

  test('other error', () => {
    expect(sut.serializeGraphqlError(new Error('boom'), next)).toBeUndefined();
  });

  test('matching error', () => {
    const err = new gql.GraphQLError('boom');
    expect(sut.serializeGraphqlError(err, next)).toMatchObject({
      type: 'GraphQLError',
      message: 'boom',
      stack: expect.any(String),
    });
  });
});
