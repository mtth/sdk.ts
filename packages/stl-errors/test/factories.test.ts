import * as sut from '../src/factories.js';

describe('error factory', () => {
  test('string values', () => {
    const [errors, codes] = sut.errorFactories({
      definitions: {one: '#1', two: '#2'},
      prefix: 'ERR_NUM_',
    });
    const err1 = errors.one();
    expect(err1.name).toEqual('NumError');
    expect(err1.code).toEqual('ERR_NUM_ONE');
    const err2 = errors.two();
    expect(err2.code).toEqual('ERR_NUM_TWO');
    expect(codes.One).toBe('ERR_NUM_ONE');
    expect(codes.Two).toBe('ERR_NUM_TWO');
    expect(codes).toEqual(new Set(['ERR_NUM_ONE', 'ERR_NUM_TWO']));
  });

  test('mixed values', () => {
    const [errors, codes] = sut.errorFactories({
      prefix: 'ERR_MIX_',
      definitions: {
        one: '#1',
        two: (val: number) => ({tags: {val}}),
      },
      name: 'MixingError',
    });
    const err1 = errors.one();
    expect(err1.name).toBe('MixingError');
    expect(err1.code).toEqual('ERR_MIX_ONE');
    const err2 = errors.two(2);
    expect(err2.code).toEqual('ERR_MIX_TWO');
    expect(codes.One).toBe('ERR_MIX_ONE');
    expect(codes.Two).toBe('ERR_MIX_TWO');
    expect(codes).toEqual(new Set(['ERR_MIX_ONE', 'ERR_MIX_TWO']));
  });
});

const [errors, codes] = sut.errorFactories({
  prefix: 'ERR_HELLO_',
  definitions: {fooOne: {}, bar2: {message: 'BAR2'}, other: 'XX'},
});

function fooOneError(stackFrom?: any): Error {
  return errors.fooOne({stackFrom});
}

function longTraceError() {
  return fooOneError();
}

function shortTraceError() {
  return fooOneError(shortTraceError);
}

describe('standard error', () => {
  test('error name', () => {
    expect(errors.bar2().name).toEqual('HelloError');
  });

  test('error code', () => {
    expect(errors.bar2().code).toEqual('ERR_HELLO_BAR2');
    expect(errors.fooOne().code).toEqual('ERR_HELLO_FOO_ONE');
    expect(errors.other().code).toEqual('ERR_HELLO_OTHER');
  });

  test('stack disabled', () => {
    const errWith = errors.bar2({tags: {BBARR: 1234}});
    const errWithout = errors.bar2({stackFrom: false});
    expect(errWithout.stack).not.toContain(' at ');
    expect(errWith.stack).toContain(' at ');
  });

  test('stack shortened', () => {
    const longErr = longTraceError();
    expect(longErr.stack).toContain('fooOne');
    const shortErr = shortTraceError();
    expect(shortErr.stack).not.toContain('fooOne');
  });

  test('to string', () => {
    const err = errors.fooOne({tags: {one: 1}});
    const child = errors.bar2({message: 'Hi', cause: err});
    expect(child.toString()).toEqual('HelloError: Hi');
  });

  test('to JSON', () => {
    const err = errors.fooOne({
      tags: {one: 1},
      cause: errors.bar2({message: 'Hi', tags: {two: 2}}),
    });
    expect(clone(err)).toEqual({
      code: codes.FooOne,
      tags: {one: 1},
    });
    expect(clone(errors.fooOne({message: 'Hello'}))).toEqual({
      code: 'ERR_HELLO_FOO_ONE',
      message: 'Hello',
    });

    function clone(arg: unknown): unknown {
      return JSON.parse(JSON.stringify(arg));
    }
  });
});

describe('is standard error', () => {
  test('handles other errors', () => {
    expect(sut.isStandardError(new Error('boom'))).toBe(false);
  });

  test('detects internal errors', () => {
    expect(sut.isStandardError(errors.fooOne())).toBe(true);
  });

  test('flags invalid codes', () => {
    const err: any = new Error('bar');
    err.code = 123;
    expect(sut.isStandardError(err)).toBe(false);
  });

  test('flags strings', () => {
    expect(sut.isStandardError('abc')).toBe(false);
  });
});

describe('undefined error code', () => {
  test.each([undefined, 1, new Error('bang')])('%s', (arg) => {
    expect(sut.errorCode(arg)).toBeUndefined();
  });
});

describe('standard errors', () => {
  test('coerced string', () => {
    const err = sut.errors.coerced('Foo');
    expect(err.message).toBe('Foo');
    expect(err.code).toBe(sut.errorCodes.Coerced);
  });

  test('coerced error', () => {
    const origin = new Error('bar');
    const err = sut.errors.coerced(origin);
    expect(err.cause).toBe(origin);
    expect(err.message).toBe('bar');
  });

  test('coerced standard error', () => {
    const err = sut.errors.illegal();
    expect(sut.errors.coerced(err)).toBe(err);
  });
});

describe('merge error codes', () => {
  const [_fooErrors, fooCodes] = sut.errorFactories({
    prefix: 'ERR_FOO_',
    definitions: {one: '1', alsoTwo: '2'},
  });
  const [_barErrors, barCodes] = sut.errorFactories({
    prefix: 'ERR_BAR_',
    definitions: {one: '01'},
  });
  const [_hiErrors, hiCodes] = sut.errorFactories({
    prefix: 'ERR_HI_',
    definitions: {two: '02'},
  });

  test('empty', () => {
    expect(sut.mergeErrorCodes({})).toEqual(new Set<string>());
  });

  test('flat', () => {
    const merged = sut.mergeErrorCodes({
      foo: fooCodes,
      bar: barCodes,
    });
    expect([...merged].sort()).toEqual([
      'ERR_BAR_ONE',
      'ERR_FOO_ALSO_TWO',
      'ERR_FOO_ONE',
    ]);
    expect(merged.foo).toBe(fooCodes);
    expect(merged.bar).toBe(barCodes);
  });

  test('nested', () => {
    const merged = sut.mergeErrorCodes({
      foo: fooCodes,
      nested: {
        bar: barCodes,
        hi: hiCodes,
      },
    });
    expect([...merged].sort()).toEqual([
      'ERR_BAR_ONE',
      'ERR_FOO_ALSO_TWO',
      'ERR_FOO_ONE',
      'ERR_HI_TWO',
    ]);
    expect([...merged.nested].sort()).toEqual(['ERR_BAR_ONE', 'ERR_HI_TWO']);
    expect(merged.foo).toBe(fooCodes);
    expect(merged.nested.bar).toBe(barCodes);
    expect(merged.nested.hi).toBe(hiCodes);
  });

  test('duplicate', () => {
    expect(() => {
      sut.mergeErrorCodes({
        foo: fooCodes,
        nested: {foo: fooCodes},
      });
    }).toThrow(/Duplicate error code/);
  });

  test('embedded', () => {
    const merged = sut.mergeErrorCodes({...fooCodes, bar: barCodes});
    expect(merged.One).toEqual('ERR_FOO_ONE');
    expect(merged.AlsoTwo).toEqual('ERR_FOO_ALSO_TWO');
    expect([...merged].sort()).toEqual([
      'ERR_BAR_ONE',
      'ERR_FOO_ALSO_TWO',
      'ERR_FOO_ONE',
    ]);
    expect(merged.bar).toBe(barCodes);
  });
});

test('no stack', async () => {
  const [errors] = sut.errorFactories({
    definitions: {
      withStack: {stackFrom: true},
      withoutStack: 'XX',
    },
    omitStack: true,
  });
  const errWith = errors.withStack();
  const errWithout = errors.withoutStack();
  expect(errWith.stack).toContain(' at ');
  expect(errWithout.stack).not.toContain(' at ');
});
