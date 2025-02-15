import * as sut from '../src/strings.js';

describe('parse boolean', () => {
  test.each([
    ['true', true],
    ['y', true],
    ['no', false],
    ['false', false],
  ])('%s => %s', (arg, want) => {
    expect(sut.parseBoolean(arg)).toEqual(want);
  });

  test('invalid', () => {
    try {
      sut.parseBoolean('ok');
    } catch (err) {
      expect(err).toMatchObject({code: 'ERR_INVALID'});
    }
    expect.assertions(1);
  });
});

describe('comma-separated', () => {
  test.each([
    ['a,c,1  ', ['a', 'c', '1']],
    [',,,', []],
    ['a, b,c , d ,a', ['a', 'b', 'c', 'd', 'a']],
    ['', []],
  ])('handles %j', (arg, want) => {
    expect(sut.commaSeparated(arg)).toEqual(want);
  });
});

describe('glob predicate', () => {
  test.each([
    ['*', 'foo', true],
    ['*', '@op/bar', true],
    ['mn', 'mn', true],
    ['mn', 'mne', false],
    ['mn*', 'mne', true],
    ['mn*', 'amne', false],
    ['*mn*', 'amne', true],
    ['*f', '.f', true],
    ['*/mne', '@op/mne', true],
  ])('%s -> %s', (glob, arg, want) => {
    expect(sut.globPredicate(glob)(arg)).toBe(want);
  });
});

describe('glob mapper', () => {
  test('default only', () => {
    const gm = sut.GlobMapper.forSpec('info');
    expect(gm.map('foo')).toEqual('info');
  });

  test('override', () => {
    const gm = sut.GlobMapper.forSpec('2,b*=3', (s) => +s);
    expect(gm.map('abc')).toEqual(2);
    expect(gm.map('bee')).toEqual(3);
  });
});

describe('please', () => {
  test.each([
    [['read'], 'Please read.'],
    [['read', '', 'write', undefined], 'Please read or write.'],
  ])('%j', (args, want) => {
    expect(sut.please(...args)).toEqual(want);
  });
});
