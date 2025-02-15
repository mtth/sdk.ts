import {fail} from '@mtth/stl-errors';
import {DateTime, Duration} from 'luxon';
import {setTimeout} from 'timers/promises';

import * as sut from '../../src/deadlines/common.js';

describe('in distant future', () => {
  test.each([
    [123, false],
    [10 ** 20, true],
    [Infinity, true],
    [new Date(), false],
    [Duration.fromMillis(100), false],
    [DateTime.now(), false],
    [DateTime.fromObject({year: 4000}), true],
    [sut.deadlines.create(100), false],
    [sut.deadlines.create(new Date(250)), false],
    [sut.deadlines.create(Infinity), true],
  ])('%s', (arg, want) => {
    expect(sut.isInDistantFuture(arg)).toBe(want);
  });
});

describe('deadlines', () => {
  test('is exceeded', () => {
    expect(sut.deadlines.distant().isExceeded()).toBe(false);
    expect(sut.deadlines.create(-1).isExceeded()).toBe(true);
  });

  test('distant', () => {
    const dd = sut.deadlines.distant();
    dd.onExceeded(boom);
    dd.throwIfExceeded();
    dd.exceeded().then(boom);
    expect(dd.exceededError()).toBeUndefined();
    expect(dd.signal().aborted).toBe(false);

    function boom() {
      throw new Error('boom');
    }
  });

  test('value of', () => {
    const dd = sut.deadlines.create(Infinity);
    expect(+dd).toEqual(Infinity);
    expect(+sut.deadlines.create(dd)).toEqual(Infinity);
    expect(+sut.deadlines.create(10_000) / 1_000).toBeCloseTo(10, 1);
  });

  test('on exceeded', async () => {
    const deadline = sut.deadlines.create(Duration.fromMillis(50));
    try {
      await new Promise((_ok, fail) => {
        deadline.onExceeded(fail);
      });
      fail();
    } catch (err) {
      expect(err).toMatchObject({
        status: 'DEADLINE_EXCEEDED',
        contents: {code: sut.codes.DeadlineExceeded},
      });
    }
  });

  test('on exceeded already expired', async () => {
    const deadline = sut.deadlines.create(-10);
    try {
      await new Promise((_ok, fail) => {
        deadline.onExceeded(fail);
      });
      fail();
    } catch (err) {
      expect(err).toMatchObject({
        status: 'DEADLINE_EXCEEDED',
        contents: {code: sut.codes.DeadlineExceeded},
      });
    }
  });

  test('on exceeded cleanup', async () => {
    const deadline = sut.deadlines.create(Duration.fromMillis(20));
    const cleanup = deadline.onExceeded(() => {
      fail();
    });
    cleanup();
  });

  test('asserts not exceeded', async () => {
    const timeout = Duration.fromMillis(100);
    const deadline = sut.deadlines.create(DateTime.now().plus(timeout));
    deadline.throwIfExceeded();
  });

  test('clone', () => {
    const d1 = sut.deadlines.create(123);
    const d2 = sut.deadlines.create(d1);
    expect(d1.cutoff).toEqual(d2.cutoff);
  });

  test('signal', async () => {
    const d = sut.deadlines.create(10);
    const sig = d.signal();
    expect(sig.aborted).toBe(false);
    await setTimeout(20);
    expect(sig.aborted).toBe(true);
  });
});

test('impatience', async () => {
  const timeout = 10_000;
  await sut.withActiveImpatience({timeout}, async (dd) => {
    expect(dd.cutoff).toBeDefined();
    dd.onExceeded(() => {
      fail();
    });
  });
  expect(sut.activeImpatience()).toBeUndefined();
});
