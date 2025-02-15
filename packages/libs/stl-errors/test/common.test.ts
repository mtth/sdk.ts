import * as sut from '../src/common.js';

describe('error message', () => {
  test.each([
    ['foo', 'foo'],
    [new Error('bar'), 'bar'],
    [{message: 'hi'}, 'hi'],
    [123, undefined],
  ])('%j => %s', (arg, want) => {
    expect(sut.errorMessage(arg)).toEqual(want);
  });
});

describe('format', () => {
  test.each<[[string, ...any], string]>([
    [['hi'], 'hi'],
    [['hi', 11], 'hi 11'],
    [['hi %s there', 'you'], 'hi you there'],
    [['number %d ok', 12, 'tt'], 'number 12 ok tt'],
    [['%j %s', 'yes', '11'], '"yes" 11'],
    [['%%s %s', 1], '%s 1'],
  ])('%j => %s', (arg, want) => {
    expect(sut.format(...arg)).toEqual(want);
  });
});
