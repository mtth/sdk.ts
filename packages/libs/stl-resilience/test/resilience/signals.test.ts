import * as sut from '../../src/resilience/signals.js';

describe('first aborted', () => {
  test('returns nothing on empty array', () => {
    expect(sut.firstAborted([])).toBeUndefined();
  });

  test('returns same signal on single element array', () => {
    const ac = new AbortController();
    expect(sut.firstAborted([ac.signal])).toBe(ac.signal);
  });

  test('tracks first abort with multiple signals', () => {
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const sig = sut.firstAborted([ac1.signal, ac2.signal]);
    ac2.abort();
    expect(sig?.aborted).toEqual(true);
    expect(ac1.signal.aborted).toEqual(false);
  });
});
