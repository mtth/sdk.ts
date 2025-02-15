import {errorCodes as codes, fail} from '@mtth/stl-errors';

import * as sut from '../src/collections.js';

describe('filter absent', () => {
  test.each([
    [[], []],
    [[null, undefined, 1, null, undefined], [1]],
    [
      [1, 3, 2, undefined],
      [1, 3, 2],
    ],
  ])('%s', (arr, want) => {
    expect(sut.filterAbsent(arr)).toEqual(want);
  });
});

describe('range', () => {
  test.each([
    [5, undefined, [0, 1, 2, 3, 4]],
    [7, 4, [4, 5, 6]],
    [7, 7, []],
    [3, 17, []],
  ])('from %s to %s', (from, to, want) => {
    expect(sut.range(from, to)).toEqual(want);
  });
});

describe('at least N', () => {
  test('ok', () => {
    const a1 = sut.atLeastOne([1, 2]);
    const a2 = sut.atLeastTwo(a1);
    expect(a2).toEqual([1, 2]);
  });

  test('too short', () => {
    try {
      sut.atLeastTwo([1]);
      fail();
    } catch (err) {
      expect(err.code).toBe(codes.Illegal);
    }
  });
});

describe('only element', () => {
  test('ok', () => {
    expect(sut.onlyElement(['ab'])).toBe('ab');
  });

  test.each([[[]], [[1, 2]]])('throws for %s', (arr) => {
    try {
      sut.onlyElement(arr);
      fail();
    } catch (err) {
      expect(err).toMatchObject({code: codes.Illegal});
    }
  });
});

describe('consecutive pairs', () => {
  test.each([
    [[], 1, []],
    [[1], 2, [[1, 2]]],
    [
      [3, 2, 1],
      0,
      [
        [3, 2],
        [2, 1],
        [1, 0],
      ],
    ],
  ])('%j', (arr, last, want) => {
    expect([...sut.consecutiveElementPairs(arr, last)]).toEqual(want);
  });
});

describe('is sorted', () => {
  test.each([
    [[], undefined, true],
    [[2], undefined, true],
    [[2, 1], undefined, false],
    [[1, 1, 2, 4], undefined, true],
    [['a', 'b'], (s1, s2) => s1.localeCompare(s2), true],
    [['a', 'b', 'b'], (s1, s2) => s1.localeCompare(s2), true],
  ])('%j', (arr, comp, want) => {
    expect(sut.isSorted(arr, comp)).toEqual(want);
  });
});

describe('shuffle', () => {
  test('empty', () => {
    expect(sut.shuffled([])).toEqual([]);
  });

  test('singleton', () => {
    expect(sut.shuffled([33])).toEqual([33]);
  });

  test('elements', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const ret = sut.shuffled(arr);
    expect(ret).toHaveLength(4);
    expect(new Set([...ret]).size).toEqual(4);
  });
});

describe('multimap', () => {
  test('array get and set', () => {
    const mm = new sut.ArrayMultimap<string, number>();
    expect(mm.size).toEqual(0);
    mm.add('ones', 1);
    expect(mm.has('ones')).toBe(true);
    expect(mm.has('twos')).toBe(false);
    mm.add('twos', 2);
    mm.addAll('ones', [11, 1]);
    expect(mm.get('twos')).toEqual([2]);
    expect(mm.get('threes')).toEqual([]);
    expect(mm.size).toEqual(4);
    expect(mm.toMap()).toEqual(
      new Map([
        ['ones', [1, 11, 1]],
        ['twos', [2]],
      ])
    );
  });

  test('set get and set', () => {
    const mm = new sut.SetMultimap<string, number>();
    expect(mm.size).toEqual(0);
    mm.add('ones', 2);
    mm.add('ones', 2);
    expect(mm.has('ones')).toBe(true);
    expect(mm.has('twos')).toBe(false);
    expect(mm.get('ones')).toEqual(new Set([2]));
    expect(mm.size).toEqual(1);
  });

  test('iterate', () => {
    const mm = new sut.SetMultimap<number, string>();
    mm.add(1, 'foo');
    mm.add(2, 'bar');
    mm.add(1, 'bar');
    mm.add(1, 'bar');
    expect([...mm]).toEqual([
      [1, 'foo'],
      [1, 'bar'],
      [2, 'bar'],
    ]);
  });

  test('array clear', () => {
    const mm = new sut.ArrayMultimap<number, number>();
    mm.add(1, 10);
    expect(mm.has(1)).toBe(true);
    expect(mm.size).toEqual(1);
    mm.clear();
    expect(mm.has(1)).toBe(false);
    expect(mm.size).toEqual(0);
  });

  test('set delete', () => {
    const mm = new sut.SetMultimap<string, number>();
    mm.addAll('one', [1, 2]);
    mm.addAll('two', [22]);
    mm.delete('three');
    expect(mm.has('one')).toBe(true);
    expect(mm.size).toEqual(3);
    mm.delete('one');
    expect(mm.has('one')).toBe(false);
    expect(mm.size).toEqual(1);
  });
});

describe('multiset', () => {
  test('add', () => {
    const ms = new sut.Multiset<string>();
    expect(ms.size).toEqual(0);
    ms.add('one', 2);
    expect(ms.get('one')).toEqual(2);
    expect(ms.get('two')).toEqual(0);
    expect(ms.size).toEqual(2);
    ms.add('two');
    expect(ms.get('two')).toEqual(1);
    expect(ms.size).toEqual(3);
    ms.add('one', -3);
    expect(ms.size).toEqual(1);
    expect(ms.get('one')).toEqual(0);
    expect([...ms]).toEqual(['two']);
    expect(ms.size).toEqual(1);
  });

  test('add all', () => {
    const ms = new sut.Multiset<string>();
    expect(ms.size).toEqual(0);
    ms.addAll(['one', 'one', 'two']);
    expect(ms.get('one')).toEqual(2);
    expect(ms.size).toEqual(3);

    const ms2 = new sut.Multiset<string>();
    ms2.addAll(ms);
    ms2.addAll(ms);
    expect(ms2.size).toEqual(6);
    expect(ms2.get('one')).toEqual(4);
  });

  test('descending', () => {
    const ms = new sut.Multiset<number>();
    ms.add(10, 3);
    ms.add(20, 5);
    ms.add(20, -Infinity);
    ms.add(5, 4);
    expect(ms.descending()).toEqual([
      [5, 4],
      [10, 3],
    ]);
  });

  test('most common', () => {
    const ms = new sut.Multiset<number>();
    expect(ms.mostCommon()).toBeUndefined();
    ms.add(20, 1);
    ms.add(10, 3);
    ms.add(20, 5);
    ms.add(5, 4);
    ms.add(30, 6);
    expect(ms.mostCommon()).toEqual([20, 6]);
  });
});

test('iterable', async () => {
  const arr = [1, 2, 3];
  const got = [...sut.mapIterable(arr, (v) => v * 2)];
  expect(got).toEqual([2, 4, 6]);
});

test('async iterable', async () => {
  const arr = [1, 2, 3];
  expect(sut.isAsyncIterable(arr)).toEqual(false);
  const iter = sut.toAsyncIterable(arr);
  expect(sut.isAsyncIterable(iter)).toEqual(true);
  const got = await sut.fromAsyncIterable(
    sut.mapAsyncIterable(iter, (v) => v * 2)
  );
  expect(got).toEqual([2, 4, 6]);
});
