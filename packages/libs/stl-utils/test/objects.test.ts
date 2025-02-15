import {errorCodes as codes, fail} from '@mtth/stl-errors';

import * as sut from '../src/objects.js';

describe('freezable', () => {
  test('allows getting and setting before freeze', () => {
    const obj = {one: 1};
    const [fobj] = sut.freezable(obj);
    fobj.one = 2;
    expect(fobj.one).toBe(2);
  });

  test('allows simple gets after freeze', () => {
    const obj = {one: 1};
    const [fobj, freeze] = sut.freezable(obj);
    freeze();
    expect(fobj.one).toBe(1);
  });

  test('rejects getters after freeze', () => {
    const obj = {
      get one() {
        return 1;
      },
    };
    const [fobj, freeze] = sut.freezable(obj);
    freeze();
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      fobj.one;
      fail();
    } catch (err) {
      expect(err.code).toBe(codes.Illegal);
    }
  });

  test('rejects setters after freeze', () => {
    const obj = {set one(_val) {}};
    const [fobj, freeze] = sut.freezable(obj);
    freeze();
    try {
      fobj.one = 2;
      fail();
    } catch (err) {
      expect(err.code).toBe(codes.Illegal);
    }
  });

  test('rejects setting after freeze', () => {
    const obj = {one: 1};
    const [fobj, freeze] = sut.freezable(obj);
    freeze();
    try {
      fobj.one = 2;
      fail();
    } catch (err) {
      expect(err.code).toBe(codes.Illegal);
    }
  });

  test('deletes before freeze', () => {
    const obj: {one?: number} = {one: 1};
    const [fobj] = sut.freezable(obj);
    delete fobj.one;
    expect(fobj).toEqual({});
  });

  test('rejects deleting after freeze', () => {
    const obj: {one?: number} = {one: 1};
    const [fobj, freeze] = sut.freezable(obj);
    freeze();
    try {
      delete fobj.one;
      fail();
    } catch (err) {
      expect(err.code).toBe(codes.Illegal);
    }
  });

  test('rejects defining property before freeze', () => {
    const obj: {one?: number} = {};
    const [fobj, freeze] = sut.freezable(obj);
    freeze();
    try {
      Object.defineProperty(fobj, 'one', {value: 1});
      fail();
    } catch (err) {
      expect(err.code).toBe(codes.Illegal);
    }
  });

  test('allows allowlisted get after freeze', () => {
    const obj = {plusOne: (n: number) => n + 1};
    const [fobj, freeze] = sut.freezable(obj, {allowList: ['plusOne']});
    freeze();
    expect(fobj.plusOne(2)).toBe(3);
  });

  test('rejects allowlisted set after freeze', () => {
    const obj = {two: 2};
    const [fobj, freeze] = sut.freezable(obj, {allowList: ['two']});
    freeze();
    try {
      fobj.two = 3;
      fail();
    } catch (err) {
      expect(err.code).toBe(codes.Illegal);
    }
  });

  test('calls onFreeze', () => {
    const obj = {two: 2};
    const onFreeze = vi.fn();
    const [_fobj, freeze] = sut.freezable(obj, {allowList: ['two'], onFreeze});
    freeze();
    freeze();
    expect(onFreeze).toBeCalledTimes(1);
    expect(onFreeze.mock.calls[0]![0]).toBe(obj);
  });

  test('freezes arrays', () => {
    const arr = [1, 2, 3];
    const [farr, freeze] = sut.freezable(arr);
    freeze();
    expect(farr[0]).toBe(1);
    try {
      farr[1] = 4;
      fail();
    } catch (err) {
      expect(err.code).toBe(codes.Illegal);
    }
  });
});

describe('kind among', () => {
  type D = sut.KindAmong<{
    fooN: {readonly n: number};
    barV: {readonly v: string};
  }>;

  test('creation', () => {
    const _d1: D = {kind: 'fooN', n: 123};
    // @ts-expect-error v not on foo
    const _d2: D = {kind: 'fooN', v: 'abc'};
    // @ts-expect-error wrong n type
    const _d3: D = {kind: 'fooN', n: 'abc'};
  });

  test('assert kind', async () => {
    const a: any = {kind: 'fooN', n: 123};
    const d = a as D;
    sut.assertKind(d, 'fooN');
    const _n = d.n;
    // @ts-expect-error wrong n type
    const _v = d.v;
  });

  test('walk', () => {
    const ns: number[] = [];
    let bars = 0;
    const visit = sut.walkWith<D>({
      onFooN(b): void {
        ns.push(b.n);
      },
      onBarV(): void {
        bars++;
      },
    });
    visit({kind: 'fooN', n: 1});
    visit({kind: 'barV', v: 'a'});
    visit({kind: 'fooN', n: 10});
    expect(ns).toEqual([1, 10]);
    expect(bars).toEqual(1);
  });
});

describe('just one', () => {
  type J = sut.JustOne<{
    fooN: {readonly n: number};
    barV: {readonly v: string};
  }>;

  type JU = sut.JustOne<{
    num: number;
    und?: undefined;
  }>;

  function justFoo(): J {
    return {just: 'fooN', fooN: {n: 12}};
  }

  test('types', () => {
    const _d1: J = {just: 'fooN', fooN: {n: 123}};
    // @ts-expect-error v not on foo
    const _d2: J = {just: 'fooN', barV: {v: 'abc'}};

    const _d3: JU = {just: 'num', num: 2};
    // @ts-expect-error missing num
    const _d4: JU = {just: 'num'};
    const _d5: JU = {just: 'und'};
    const _d6: JU = {just: 'und', und: undefined};
  });

  test('get just', () => {
    expect(sut.getJust(justFoo(), 'barV')).toBeUndefined();
    expect(sut.getJust(justFoo(), 'fooN')).toEqual({n: 12});
    // @ts-expect-error bazX not in just
    sut.getJust(justFoo(), 'bazX');
  });

  test('is just', () => {
    function narrowed(d: Exclude<J, sut.IsJust<'fooN'>>): string | undefined {
      return d.barV?.v;
    }

    expect(narrowed({just: 'barV', barV: {v: 'ab'}})).toBe('ab');
    // @ts-expect-error foo is not allowed here
    narrowed(justFoo());
  });

  test('just', () => {
    expect(sut.just('foo', 1)).toEqual({just: 'foo', foo: 1});
  });

  test('assert just', async () => {
    const j = justFoo();
    sut.assertJust(j, 'fooN');
    const _f = j.fooN;
    // @ts-expect-error wrong n type
    const _b = j.barV;
  });

  test('check just', async () => {
    const j = justFoo();
    const o = sut.checkJust(j, 'fooN');
    expect(o).toEqual({n: 12});
  });

  test('explore', () => {
    const visit = sut.exploreWith<J, number, number>({
      onFooN(b, c, j): number {
        expect(j).toEqual('fooN');
        return b.n + c;
      },
      onBarV(b, c, j): number {
        expect(j).toEqual('barV');
        return b.v.length + c;
      },
    });
    expect(visit(sut.just('fooN', {n: 1}), 10)).toEqual(11);
    expect(visit(sut.just('barV', {v: 'abc'}), 20)).toEqual(23);
  });
});

describe('contained', () => {
  test.each([
    ['foo', 64, 3],
    [true, 64, 4],
    [{abc: 'd'}, 64, 11],
  ])('keeps %s', (data, to, size) => {
    expect(sut.contained(data, {maxLength: to})).toStrictEqual({size, data});
  });

  test.each([
    ['a very long string which exceeds the limit we set in this test', 50],
    [
      [
        'a first element',
        'a second element which does not fit',
        'a third which also does not fit',
        'and another which does not fit either',
      ],
      64,
    ],
  ])('truncates %s', (data, to) => {
    const got = sut.contained(data, {maxLength: to});
    expect(got.loss).toBeGreaterThan(0);
    expect(got.size).toBeGreaterThan(to);
  });
});

test('strip undefined values', async () => {
  const arg = {
    o: 1,
    n: null,
    u: undefined,
    arr: [{one: undefined}],
    m: new Map([
      ['a', undefined],
      ['b', {one: 1, two: undefined}],
    ]),
  };
  sut.stripUndefinedValues(arg);
  expect(arg).toEqual({
    o: 1,
    n: null,
    arr: [{}],
    m: new Map([['b', {one: 1}]]),
  });
});

describe('map values', () => {
  test.each([
    [{}, () => void fail(), {}],
    [{one: 1, two: 2}, (v) => v * 2, {one: 2, two: 4}],
  ])('%j', (obj: any, fn, want) => {
    expect(sut.mapValues(obj, fn)).toEqual(want);
  });
});

describe('pretty formatter', () => {
  const formatter = sut.PrettyFormatter.create({
    stringThreshold: 6,
    arrayThreshold: 4,
    binaryArrayThreshold: 2,
  });

  test.each([
    [{}, {}],
    ['abcdef', 'abcdef'],
    ['abcdefg', 'abc... <1 omitted> ...efg'],
    [
      {
        b1: Buffer.from([1, 2]),
        b2: new Int8Array([1, 2, 3]),
        a: ['a', 'b', 'c', 'd', 'e', 'f'],
      },
      {
        b1: '0x0102',
        b2: '0x01... <1 omitted> ...03',
        a: ['a', 'b', '... <2 omitted> ...', 'e', 'f'],
      },
    ],
    [new Date(1710003330023), '202... <18 omitted> ...23Z'],
  ])('%j -> %j', async (arg, want) => {
    expect(formatter.format(arg)).toEqual(want);
  });
});
