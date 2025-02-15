import * as sut from '../src/index.js';

test('assert', () => {
  sut.assert(true, 'ignored');
  expect(() => {
    sut.assert(false, 'boom');
  }).toThrowError(/boom/);
});

test('assert cause', () => {
  const err = new Error('boom');
  sut.assertCause(true, err);
  expect(() => {
    sut.assertCause(false, err);
  }).toThrowError(/boom/);
});

test('assert error code ', () => {
  sut.assertErrorCode(sut.errorCodes.Illegal, sut.defaultErrors.illegal());
  expect(() => {
    sut.assertErrorCode(
      sut.errorCodes.Internal,
      sut.defaultErrors.illegal({message: 'bar'})
    );
  }).toThrowError(/bar/);
});

test('validate', () => {
  sut.validate(true, 'Ignored');
  expect(() => {
    sut.validate(false, {}, 'Boom');
  }).toThrowError(/Invalid argument/);
});

test('fail', () => {
  try {
    sut.fail();
  } catch (err) {
    expect(sut.collectErrorCodes(err)).toContain('ERR_ILLEGAL');
  }
});

test('absurd', () => {
  expect(() => {
    throw sut.absurd(null as never);
  }).toThrowError(/Absurd/);
});

test('unexpected', () => {
  try {
    throw sut.unexpected(123);
  } catch (err) {
    expect(sut.collectErrorCodes(err)).toContain('ERR_ILLEGAL');
    expect(sut.illegalErrorValue(err)).toEqual(123);
  }
});

test('unimplemented', () => {
  try {
    throw sut.unimplemented();
  } catch (err) {
    expect(sut.deriveStatus(err)).toEqual('UNIMPLEMENTED');
    expect(sut.collectErrorCodes(err)).toContain('ERR_INTERNAL');
  }
});

describe('derive failure', () => {
  const [errors] = sut.errorFactories({
    prefix: 'ERR_',
    definitions: {foo: {}, bar: {}},
  });

  test('raw internal error', () => {
    expect(sut.deriveFailure(sut.defaultErrors.internal())).toEqual({
      status: 'UNKNOWN',
      error: {message: 'Unknown error'},
    });
  });

  test('raw custom failure', () => {
    const err = errors.bar({tags: {one: 1}});
    expect(sut.deriveFailure(err)).toEqual({
      status: 'UNKNOWN',
      error: {message: 'Unknown error'},
    });
  });

  test('status error without message', () => {
    const cause = errors.foo({tags: {one: 1}});
    const err = sut.statusErrors.invalidArgument(cause);
    expect(sut.deriveFailure(err)).toEqual({
      status: 'INVALID_ARGUMENT',
      error: {
        message: 'Invalid argument error [ERR_FOO]',
        code: 'ERR_FOO',
        tags: {one: 1},
      },
    });
  });

  test('nested status error with message', () => {
    const cause = errors.foo({message: 'Hello'});
    const err1 = sut.statusErrors.failedPrecondition(cause);
    const err2 = sut.defaultErrors.internal({message: 'Boom', cause: err1});
    expect(sut.deriveFailure(err2)).toEqual({
      status: 'FAILED_PRECONDITION',
      error: {
        code: 'ERR_FOO',
        message: 'Failed precondition error [ERR_FOO]: Hello',
      },
    });
  });

  test('other error', () => {
    const err = new Error('Boom');
    expect(sut.deriveFailure(err)).toEqual({
      status: 'UNKNOWN',
      error: {message: 'Unknown error'},
    });
  });

  test('internal error override', () => {
    const err0 = new Error('Boom');
    const err1 = sut.statusErrors.cancelled(err0);
    const err2 = sut.statusErrors.internal(err1);
    expect(sut.deriveFailure(err2)).toEqual({
      status: 'INTERNAL',
      error: {message: 'Internal error'},
    });
  });

  test('specific error override', () => {
    const err0 = errors.foo();
    const err1 = sut.statusErrors.internal(err0);
    const err2 = sut.statusErrors.cancelled(err1);
    expect(sut.deriveFailure(err2)).toEqual({
      status: 'CANCELLED',
      error: {
        code: 'ERR_FOO',
        message: 'Cancelled error [ERR_FOO]',
      },
    });
  });

  test('other error with invalid code', () => {
    const err: any = new Error('Boom');
    err.code = 'ABC';
    expect(sut.deriveFailure(err)).toEqual({
      status: 'UNKNOWN',
      error: {message: 'Unknown error'},
    });
  });

  test('annotated', () => {
    const err: any = new Error('Boom');
    expect(
      sut.deriveFailure(err, {
        annotators: [() => 'Hey.', () => '', () => 'Ho.'],
      })
    ).toEqual({
      status: 'UNKNOWN',
      error: {message: 'Unknown error. Hey. Ho.'},
    });
  });
});

describe('check', () => {
  test.each([
    ['abc', 'isString'],
    [20.5, 'isNumber'],
    [0, 'isNumber'],
    [-1, 'isNumber'],
    [22, 'isNumeric'],
    ['333', 'isNumeric'],
    [65, 'isInteger'],
    [-1, 'isInteger'],
    [-1, 'isInteger'],
    [1, 'isNonNegativeInteger'],
    [true, 'isBoolean'],
    [false, 'isBoolean'],
    [[], 'isArray'],
    [[null], 'isArray'],
    [Buffer.from([0]), 'isBuffer'],
    ['abc', 'isPresent'],
    [{}, 'isObject'],
    [{}, 'isRecord'],
    [{one: 1}, 'isObject'],
    [{one: 1, two: 'deux'}, 'isRecord'],
  ])('%s passes %s', (arg, meth) => {
    expect(sut.check[meth](arg)).toEqual(arg);
  });

  test.each([
    [undefined, 'isString'],
    [123, 'isString'],
    [null, 'isNumber'],
    [NaN, 'isNumber'],
    [NaN, 'isNumeric'],
    ['0b', 'isNumeric'],
    ['b0', 'isNumeric'],
    [20.5, 'isInteger'],
    [-1, 'isNonNegativeInteger'],
    [1, 'isBoolean'],
    [0, 'isBoolean'],
    [null, 'isArray'],
    [null, 'isRecord'],
    [[1], 'isRecord'],
    [[], 'isBuffer'],
    [null, 'isPresent'],
    [undefined, 'isPresent'],
    [null, 'isObject'],
  ])('%s fails %s', (arg, meth) => {
    try {
      sut.check[meth](arg);
      sut.fail();
    } catch (err) {
      expect(err).toMatchObject({code: sut.errorCodes.Illegal});
    }
  });

  test('or absent', () => {
    expect(sut.check.isInteger.orAbsent(null)).toBeUndefined();
    expect(sut.check.isInteger.orAbsent(123)).toEqual(123);
    try {
      sut.check.isInteger.orAbsent('abc');
      sut.fail();
    } catch (err) {
      expect(err).toMatchObject({code: sut.errorCodes.Illegal});
    }
  });
});

test('rethrow unless', () => {
  const err = new Error('boom');
  sut.rethrowUnless(true, err);
  expect(() => {
    sut.rethrowUnless(false, err);
  }).toThrowError(err);
});
