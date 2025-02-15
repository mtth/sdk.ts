import __inlinable from '../src/index.js';

describe('inlinable', () => {
  test('scalar value', () => {
    const foo = __inlinable(() => 3);
    expect(foo).toEqual(3);
  });
});
