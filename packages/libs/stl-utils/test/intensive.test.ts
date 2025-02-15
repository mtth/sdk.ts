import {fail} from '@mtth/stl-errors';

import * as sut from '../src/intensive.js';

describe('intensive', () => {
  test('run sync', () => {
    let val = 0;
    const incr = () => void val++;
    const op = sut.intensive(function* () {
      for (let ix = 0; ix < 10; ix++) {
        incr();
        yield;
      }
    });
    expect(val).toEqual(0);
    op.runSync();
    expect(val).toEqual(10);
  });

  test('run', async () => {
    let val = 0;
    const incr = () => void val++;
    const op = sut
      .intensive(function* () {
        for (let ix = 0; ix < 3; ix++) {
          incr();
          yield;
        }
      })
      .on('end', (stats) => {
        expect(stats.yieldCount).toEqual(3);
      });
    expect(val).toEqual(0);
    await op.run();
    expect(val).toEqual(3);
  });

  test('map', () => {
    let val = 0;
    const incr = () => void val++;
    const op1 = sut.intensive(function* () {
      for (let ix = 0; ix < 10; ix++) {
        incr();
        yield;
      }
      return 50;
    });
    const op2 = sut.intensive(function* (embed) {
      const v = yield* embed(op1);
      return 2 * v;
    });
    expect(val).toEqual(0);
    expect(op2.runSync()).toEqual(100);
  });

  test('flatmap', async () => {
    let val = 0;
    const incr = () => void val++;
    const op1 = sut.intensive(function* () {
      for (let ix = 0; ix < 10; ix++) {
        incr();
        yield;
      }
      return 50;
    });
    const op2 = sut.intensive(function* (embed) {
      const val = yield* embed(op1);
      return 3 * val;
    });
    expect(val).toEqual(0);
    expect(op2.runSync()).toEqual(150);
  });

  test('handles error on async', async () => {
    const op = sut
      .intensive(function* () {
        for (let ix = 0; ix < 5; ix++) {
          if (ix === 2) {
            throw new Error('boom');
          }
          yield;
        }
      })
      .on('end', (stats) => {
        expect(stats.yieldCount).toEqual(2);
      });
    try {
      await op.run();
      fail();
    } catch (err) {
      expect(err).toMatchObject({message: 'boom'});
    }
  });

  test('emits breath events', async () => {
    let breaths = 0;
    const op = sut
      .intensive(function* () {
        for (let ix = 0; ix < 200_000; ix++) {
          yield;
        }
        return 10;
      })
      .on('breath', () => void breaths++);
    await op.run(1);
    expect(breaths).toBeGreaterThan(1);
  });

  test('is intensive', async () => {
    expect(sut.isIntensive(1)).toBe(false);
    // eslint-disable-next-line require-yield
    const op = sut.intensive(function* () {
      return 10;
    });
    expect(sut.isIntensive(op)).toBe(true);
  });

  test('intensive with custom context', async () => {
    let val = 0;
    const obj = {incr: () => void val++};
    const op = sut.intensive(obj, function* () {
      for (let ix = 0; ix < 3; ix++) {
        this.incr();
        yield;
      }
    });
    expect(val).toEqual(0);
    op.runSync();
    expect(val).toEqual(3);
  });
});
