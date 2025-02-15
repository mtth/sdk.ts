import {assert} from '@mtth/stl-errors';

/** Removes all null and undefined values from an array. */
export function filterAbsent<V>(
  arr: ReadonlyArray<V>
): ReadonlyArray<Exclude<V, null | undefined>> {
  return arr.filter((v) => v !== null && v !== undefined) as any;
}

// Arrays with type-level minimum lengths. We are not using ts-essentials'
// `Opaque` since we want 2 to extend 1 as well.

const atLeastOneSymbol = Symbol('at-least-one');

export type AtLeastOne<V> = ReadonlyArray<V> & {
  readonly [atLeastOneSymbol]: undefined;
};

function assertLengthAtLeast(arr: ReadonlyArray<unknown>, min: number): void {
  assert(arr.length >= min, 'Too few elements: %d < %d', arr.length, min);
}

export function atLeastOne<V>(arr: ReadonlyArray<V>): AtLeastOne<V> {
  assertLengthAtLeast(arr, 1);
  return arr as any;
}

const atLeastTwoSymbol = Symbol('at-least-two');

export type AtLeastTwo<V> = AtLeastOne<V> & {
  readonly [atLeastTwoSymbol]: undefined;
};

export function atLeastTwo<V>(arr: ReadonlyArray<V>): AtLeastTwo<V> {
  assertLengthAtLeast(arr, 2);
  return arr as any;
}

/** Returns a shuffled version of the input array. */
export function shuffled<V>(arr: ReadonlyArray<V>): ReadonlyArray<V> {
  const mut = [...arr];
  shuffle(mut);
  return mut;
}

function shuffle(arr: any[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Returns the only element in an iterable, throwing if the iterable has more or
 * fewer elemets.
 */
export function onlyElement<V>(iter: Iterable<V>): V {
  const it = iter[Symbol.iterator]();
  const res = it.next();
  assert(!res.done && it.next().done, 'Not a singleton: %j', iter);
  return res.value as V;
}

/** Returns the first element from an iterable, if any. */
export function firstElement<V>(iter: Iterable<V>): V | undefined {
  for (const elem of iter) {
    return elem;
  }
  return undefined;
}

/**
 * Returns all consecutive pairs of elements. The returned iterable as the same
 * number of elements as the input one.
 */
export function* consecutiveElementPairs<V>(
  iter: Iterable<V>,
  last?: V
): Iterable<[V, V]> {
  const it = iter[Symbol.iterator]();
  let res = it.next();
  if (res.done) {
    return;
  }
  let val1 = res.value;
  while (!(res = it.next()).done) {
    const val2 = res.value;
    yield [val1, val2];
    val1 = val2;
  }
  if (last != null) {
    yield [val1, last];
  }
}

/** Returns true if the array is sorted in ascending order */
export function isSorted<V>(
  arr: ReadonlyArray<V>,
  comp?: (v1: V, v2: V) => number
): boolean {
  for (const [v1, v2] of consecutiveElementPairs(arr)) {
    if (comp ? comp(v1, v2) > 0 : v1 > v2) {
      return false;
    }
  }
  return true;
}

/**
 * Creates a range from `from` inclusive (defaulting to 0) to `to` exclusive.
 */
export function range(to: number, from?: number): ReadonlyArray<number> {
  const start = from ?? 0;
  if (start >= to) {
    return [];
  }
  const ret = Array(to - start);
  for (let i = 0; i < ret.length; i++) {
    ret[i] = i + start;
  }
  return ret;
}

/** Base multimap class. */
abstract class Multimap<K, V, C extends Iterable<V>>
  implements Iterable<[K, V]>
{
  private _size = 0;
  protected readonly data = new Map<K, C>();

  protected abstract emptyValues(): C;

  protected abstract addValues(col: C, vals: Iterable<V>): void;

  protected abstract valueCount(col: C): number;

  get size(): number {
    return this._size;
  }

  add(key: K, val: V): void {
    this.addAll(key, [val]);
  }

  addAll(key: K, vals: Iterable<V>): void {
    let col = this.data.get(key);
    if (!col) {
      col = this.emptyValues();
      this.data.set(key, col);
    }
    const count = this.valueCount(col);
    this.addValues(col, vals);
    this._size += this.valueCount(col) - count;
  }

  has(key: K): boolean {
    return this.data.has(key);
  }

  get(key: K): Readonly<C> {
    return this.data.get(key) ?? this.emptyValues();
  }

  delete(key: K): void {
    const col = this.data.get(key);
    if (!col) {
      return;
    }
    const count = this.valueCount(col);
    this.data.delete(key);
    this._size -= count;
  }

  clear(): void {
    this.data.clear();
    this._size = 0;
  }

  toMap(): ReadonlyMap<K, Readonly<C>> {
    return this.data;
  }

  *[Symbol.iterator](): Iterator<[K, V]> {
    for (const [key, col] of this.data.entries()) {
      for (const val of col) {
        yield [key, val];
      }
    }
  }
}

/** Array-backed multimap. */
export class ArrayMultimap<K, V> extends Multimap<K, V, V[]> {
  protected override emptyValues(): V[] {
    return [];
  }

  protected override valueCount(col: V[]): number {
    return col.length;
  }

  protected override addValues(col: V[], vals: Iterable<V>): void {
    for (const val of vals) {
      col.push(val);
    }
  }
}

/** Set-backed multimap. */
export class SetMultimap<K, V> extends Multimap<K, V, Set<V>> {
  protected override emptyValues(): Set<V> {
    return new Set();
  }

  protected override valueCount(col: Set<V>): number {
    return col.size;
  }

  protected override addValues(col: Set<V>, vals: Iterable<V>): void {
    for (const val of vals) {
      col.add(val);
    }
  }
}

/**
 * Non-negative counter. Keys are iterated in the order in which they were last
 * added (i.e. reached a positive count).
 */
export class Multiset<K> implements Iterable<K> {
  private readonly data = new Map<K, number>();
  private _size = 0;

  /**
   * Updates a key's count, updating it by the given value. If the resulting
   * count is non-positive, the key will be removed.
   */
  add(key: K, count = 1): void {
    const prev = this.data.get(key) ?? 0;
    const next = Math.max(prev + count, 0);
    if (next > 0) {
      this.data.set(key, next);
    } else {
      this.data.delete(key);
    }
    this._size += next - prev;
  }

  /**
   * Adds each key in the input iterable. This method is optimized for the case
   * when the input is also a multiset.
   */
  addAll(keys: Iterable<K>): void {
    if (keys instanceof Multiset) {
      for (const [key, count] of keys.data) {
        this.add(key, count);
      }
    } else {
      for (const key of keys) {
        this.add(key);
      }
    }
  }

  /** Returns the count of occurrences of a given value, or 0 if not found. */
  get(key: K): number {
    return this.data.get(key) ?? 0;
  }

  /**
   * Returns the total of (non-distinct) elements in the multiset. Use
   * `.toMap().size` for the total number of distinct elements.
   */
  get size(): number {
    return this._size;
  }

  clear(): void {
    this.data.clear();
    this._size = 0;
  }

  /** Returns a map of counts. */
  toMap(): ReadonlyMap<K, number> {
    return this.data;
  }

  *[Symbol.iterator](): Iterator<K> {
    for (const [key, count] of this.data.entries()) {
      for (let ix = 0; ix < count; ix++) {
        yield key;
      }
    }
  }

  /** Returns an array of entries in descending count order. */
  descending(): [K, number][] {
    return [...this.data].sort((e1, e2) => e2[1] - e1[1]);
  }

  /**
   * Returns the entry with the highest count. If multiple entries have the
   * highest count, the one with the first latest creation will be returned.
   */
  mostCommon(): [K, number] | undefined {
    let key: K | undefined;
    let count = 0;
    for (const [k, c] of this.data) {
      if (c > count) {
        count = c;
        key = k;
      }
    }
    return key == null ? undefined : [key, count];
  }
}

/** Maps over an `Iterable`. */
export function* mapIterable<V, W>(
  iter: Iterable<V>,
  fn: (val: V, ix: number) => W
): Iterable<W> {
  let ix = 0;
  for (const val of iter) {
    yield fn(val, ix++);
  }
}

/** Maps over an `AsyncIterable`. */
export async function* mapAsyncIterable<V, W>(
  iter: AsyncIterable<V>,
  fn: (val: V, ix: number) => W
): AsyncIterable<W> {
  let ix = 0;
  for await (const val of iter) {
    yield fn(val, ix++);
  }
}

/** Checks whether the argument is an `AsyncIterable`. */
export function isAsyncIterable(arg: unknown): arg is AsyncIterable<unknown> {
  return !!arg && typeof arg == 'object' && Symbol.asyncIterator in arg;
}

/** Converts an `Iterable` to an `AsyncIterable`. */
export async function* toAsyncIterable<V>(arr: Iterable<V>): AsyncIterable<V> {
  yield* arr;
}

/** Converts an `AsyncIterable` to an array. */
export async function fromAsyncIterable<V>(
  iter: AsyncIterable<V>
): Promise<ReadonlyArray<V>> {
  const arr: V[] = [];
  for await (const item of iter) {
    arr.push(item);
  }
  return arr;
}
