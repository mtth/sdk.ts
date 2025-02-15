import {fail} from '@mtth/stl-errors';

import * as sut from '../src/functions.js';

describe('if present', () => {
  test('present', () => {
    expect(sut.ifPresent(1, (v) => v + 1)).toBe(2);
  });

  test('null', () => {
    expect(sut.ifPresent(null, () => 3)).toBe(undefined);
  });

  test('undefined', () => {
    expect(sut.ifPresent(undefined, (v) => v + 4)).toBe(undefined);
  });
});

describe('at most once', () => {
  test('forwards single call', () => {
    const errs: unknown[] = [];
    const fn = sut.atMostOnce(
      (err) => {
        errs.push(err);
      },
      () => {
        fail();
      }
    );
    expect(fn.callCount).toEqual(0);
    const boom = new Error('boom');
    fn(boom);
    expect(errs).toEqual([boom]);
    expect(fn.callCount).toEqual(1);
  });

  test('skips other calls', () => {
    const errs: unknown[] = [];
    const fn = sut.atMostOnce((err) => {
      errs.push(err);
    });
    const boom = new Error('boom');
    fn(boom);
    fn(boom);
    fn(new Error('bang'));
    expect(errs).toEqual([boom]);
    expect(fn.callCount).toEqual(3);
  });
});

describe('resolvable', () => {
  test('single ok', async () => {
    const [p, cb] = sut.resolvable<number>();
    cb(null, 12);
    expect(await p).toBe(12);
  });

  test('single error', async () => {
    const [p, cb] = sut.resolvable<number>();
    process.nextTick(() => {
      cb(new Error('boom'));
    });
    try {
      await p;
      fail();
    } catch (err) {
      expect(err.message).toEqual('boom');
    }
  });

  test('duplicates', async () => {
    const fn = vi.fn();
    const [p, cb] = sut.resolvable<string>(fn);
    process.nextTick(() => {
      cb(null, 'abc');
      cb(new Error('boom'));
      cb(null, 'cde');
    });
    expect(await p).toEqual('abc');
    expect(fn.mock.calls.length).toBe(2);
  });
});

test('as tag function', () => {
  const upper = sut.asTagFunction((s) => s.toUpperCase());
  expect(upper`foo`).toEqual('FOO');
});

test('collectable', async () => {
  const col = sut.collectable<sut.Effect>();
  let count = 0;
  col(sut.noop);
  col(sut.pass);
  col(() => {
    count++;
  });
  const cleanup = col(async () => {
    count += 10;
  });
  expect(col.collected.length).toEqual(4);
  await Promise.all(col.collected.map((f) => f()));
  expect(count).toEqual(11);

  cleanup();
  expect(col.collected.length).toEqual(3);
  cleanup();
  expect(col.collected.length).toEqual(3);

  await Promise.all(col.collected.map((f) => f()));
  expect(count).toEqual(12);
});

describe('sorting nulls', () => {
  test.each([
    [[null, 'a', 'c', null, 'b'], 'first', [null, null, 'a', 'b', 'c']],
    [['c', null, 'c'], 'last', ['c', 'c', null]],
  ] as const)('%j (%s) => %j', (arg, pos, want) => {
    const fn = sut.sortingNulls<string>(pos, (s1, s2) => s1.localeCompare(s2));
    expect([...arg].sort(fn)).toEqual(want);
  });
});

test('incrementing', async () => {
  const fn = sut.incrementing((ix) => 'v' + ix);
  expect(fn()).toEqual('v1');
  expect(fn()).toEqual('v2');
});

test('method call', () => {
  const obj = {one: () => 1, twice: (n: number) => 2 * n};
  expect(sut.methodCall(obj, 'one')).toEqual(1);
  expect(sut.methodCall(obj, 'twice', 4)).toEqual(8);
});
