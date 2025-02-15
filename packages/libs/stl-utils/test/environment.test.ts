import * as sut from '../src/environment.js';

test('patching environment', async () => {
  const base: sut.ProcessEnv = {one: 'abc'};
  const patch: sut.ProcessEnv = {one: 'AA', two: '22'};
  const ret = await sut.patchingEnv(patch, base, async () => {
    expect(base.two).toEqual('22');
    return base.one;
  });
  expect(ret).toEqual('AA');
  expect(base.two).toBeUndefined();
  expect(base.one).toEqual('abc');
});

describe('running', () => {
  test('in production', () => {
    expect(sut.running.inProduction()).toBeDefined();
  });

  test('in test', () => {
    expect(sut.running.inTest()).toBeDefined();
  });
});
