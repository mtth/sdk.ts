import {errorFactories} from '../src/factories.js';
import * as sut from '../src/status.js';

const [errors, codes] = errorFactories({
  prefix: 'ERR_CUSTOM_',
  definitions: {foo: {message: 'ff'}, bar: {message: 'bb'}},
});

describe('ok status', () => {
  test('from HTTP code', () => {
    expect(sut.statusFromHttpCode(201)).toEqual(sut.OK_STATUS);
  });

  test('from gRPC code', () => {
    expect(sut.statusFromGrpcCode(0)).toEqual(sut.OK_STATUS);
  });
});

describe('status error', () => {
  test('contents', () => {
    const err = new Error('boom');
    const statusErr = sut.statusErrors.alreadyExists(err);
    expect(statusErr.contents).toBe(err);
  });

  test.each([
    [sut.statusErrors.aborted, 504],
    [sut.statusErrors.alreadyExists, 409],
    [sut.statusErrors.cancelled, 499],
    [sut.statusErrors.deadlineExceeded, 504],
    [sut.statusErrors.failedPrecondition, 422],
    [sut.statusErrors.internal, 500],
    [sut.statusErrors.invalidArgument, 400],
    [sut.statusErrors.notFound, 404],
    [sut.statusErrors.permissionDenied, 403],
    [sut.statusErrors.resourceExhausted, 429],
    [sut.statusErrors.unauthenticated, 401],
    [sut.statusErrors.unavailable, 503],
    [sut.statusErrors.unimplemented, 501],
  ])('http code', (fn, code) => {
    const err = fn(new Error());
    expect(sut.statusToHttpCode(err.status)).toBe(code);
    if (code !== 504) {
      expect(sut.statusFromHttpCode(code)).toBe(err.status);
    }
  });

  test.each([
    [sut.statusErrors.aborted, 10],
    [sut.statusErrors.alreadyExists, 6],
    [sut.statusErrors.cancelled, 1],
    [sut.statusErrors.deadlineExceeded, 4],
    [sut.statusErrors.failedPrecondition, 9],
    [sut.statusErrors.internal, 13],
    [sut.statusErrors.invalidArgument, 3],
    [sut.statusErrors.notFound, 5],
    [sut.statusErrors.permissionDenied, 7],
    [sut.statusErrors.resourceExhausted, 8],
    [sut.statusErrors.unauthenticated, 16],
    [sut.statusErrors.unavailable, 14],
    [sut.statusErrors.unimplemented, 12],
  ])('grpc code', (fn, code) => {
    const err = fn(new Error());
    expect(sut.statusToGrpcCode(err.status)).toBe(code);
    expect(sut.statusFromGrpcCode(code)).toBe(err.status);
  });

  test.each([
    ['INTERNAL', true],
    ['CANCELLED', true],
    ['UNAVAILABLE_', false],
    ['NOTFOUND', false],
  ])('%s is error status: %s', (s, b) => {
    expect(sut.isErrorStatus(s)).toBe(b);
  });

  test('generic factory', () => {
    const cause = new Error('boom');
    const err = sut.statusError('DEADLINE_EXCEEDED', cause);
    expect(sut.isStatusError(err)).toBe(true);
    expect(err.status).toBe('DEADLINE_EXCEEDED');
  });
});

describe('rethrow with status', () => {
  test('match', () => {
    const err = errors.bar();
    expect(() => {
      sut.rethrowWithStatus(err, {
        INVALID_ARGUMENT: [codes.Bar],
      });
    }).toThrow(/Invalid argument/);
  });

  test('no match', () => {
    const err = errors.bar();
    expect(() => {
      sut.rethrowWithStatus(err, {
        INVALID_ARGUMENT: [codes.Foo],
        UNAUTHENTICATED: 'ERR_BLAH',
      });
    }).toThrow(err);
  });
});

describe('status protocol code', () => {
  const contents = new Error('boom');

  test('default', () => {
    const err = sut.statusErrors.aborted(contents);
    expect(sut.statusProtocolCode('grpc', err)).toEqual(10);
    expect(sut.statusProtocolCode('http', err)).toEqual(504);
  });

  test('override', () => {
    const err = sut.statusErrors.unauthenticated(contents, {
      protocolCodes: {http: 400},
    });
    expect(sut.statusProtocolCode('grpc', err)).toEqual(16);
    expect(sut.statusProtocolCode('http', err)).toEqual(400);
  });
});
