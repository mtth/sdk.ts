import * as sut from '../src/sentinel.js';

describe('is inlining', () => {
  test('is false outside', () => {
    expect(sut.isInlining()).toBe(false);
  });

  test('is true inside', async () => {
    await sut.inlining('./foo.ts', async () => {
      expect(sut.isInlining()).toBe(true);
    });
  });
});
