import * as stl from '@opvious/stl';

import * as sut from '../../src/throttle/rate.js';

describe('setting', () => {
  test.each<[string, sut.ThrottleRate]>([
    ['2/1', {steady: {points: 2, seconds: 1}}],
    ['0/0', {steady: {points: 0, seconds: 0}}],
    [
      '1/10+5/100',
      {steady: {points: 1, seconds: 10}, burst: {points: 5, seconds: 100}},
    ],
  ])('%j', (src, want) => {
    const settings = stl.settingsProvider((env) =>
      sut.throttleRateSetting(env.RATE)
    );
    expect(settings({RATE: src})).toEqual(want);
  });
});
