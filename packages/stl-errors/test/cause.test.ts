import * as sut from '../src/cause.js';
import {errorFactories, errors as standardErrors} from '../src/factories.js';
import {statusErrors} from '../src/status.js';

const [errors, codes] = errorFactories({
  prefix: 'ERR_CUSTOM_',
  definitions: {foo: {message: 'ff'}, bar: {message: 'bb'}},
});

class OtherError extends Error {
  readonly original: Error | undefined;
  constructor(msg: string, original?: Error) {
    super(msg);
    this.original = original;
  }

  static originalError(err: unknown): ReadonlyArray<Error> | undefined {
    return err instanceof OtherError
      ? err.original
        ? [err.original]
        : []
      : undefined;
  }
}

describe('error finder', () => {
  test('custom extractor', () => {
    const finder = new sut.ErrorFinder([
      OtherError.originalError,
      sut.errorCauseExtractor,
    ]);
    const key = Symbol('test.key');
    const err1 = errors.foo({tags: {[key]: 404}});
    const err2 = new OtherError('Hey', err1);
    const err3 = errors.bar({cause: err2});
    expect(finder.find(err3, (e) => (e as any).tags?.[key])?.error).toBe(err1);
  });
});

describe('global finder', () => {
  test('find by code', () => {
    const err1 = errors.foo({tags: {one: 1}});
    const err2 = errors.bar({message: 'Hi', cause: err1});
    expect(sut.findErrorWithCode(err2, 'ERR_CUSTOM_BAR')?.error).toBe(err2);
    expect(sut.findErrorWithCode(err2, 'ERR_CUSTOM_FOO')?.value).toBe(
      codes.Foo
    );
    expect(sut.findErrorWithCode(err2, 'ERR_MISSING')).toBeUndefined();
  });

  test('find code', () => {
    const err = errors.foo({tags: {one: 1}});
    expect(sut.findErrorCode(err)).toEqual('ERR_CUSTOM_FOO');
    expect(sut.findErrorCode(new Error('boom'))).toBeUndefined();
    expect(sut.findErrorCode(statusErrors.aborted(err))).toEqual(
      'ERR_CUSTOM_FOO'
    );
  });
});

describe('error codes', () => {
  test('non-standard', () => {
    expect([...sut.collectErrorCodes(new Error('boom'))]).toEqual([]);
  });

  test('standard', () => {
    const err = errors.bar();
    expect([...sut.collectErrorCodes(err)]).toEqual(['ERR_CUSTOM_BAR']);
  });

  test('standard nested', () => {
    const cause = errors.bar();
    const err = standardErrors.internal({cause});
    expect([...sut.collectErrorCodes(err)]).toEqual([
      'ERR_INTERNAL',
      'ERR_CUSTOM_BAR',
    ]);
  });
});
