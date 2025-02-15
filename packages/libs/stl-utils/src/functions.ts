import {assert} from '@mtth/stl-errors';
import {AsyncOrSync} from 'ts-essentials';

/** Runs a function if the argument is not null or undefined. */
export function ifPresent<V, W>(
  val: V | null | undefined,
  fn: (v: Exclude<V, null | undefined>) => W
): W | undefined {
  return val === null || val === undefined ? undefined : fn(val as any);
}

/**
 * Wraps a function, returning a function which will call the handler at most
 * once. Subsequent calls are logged but do not trigger the handler.
 */
export function atMostOnce<V = unknown>(
  fn: (arg: V) => void,
  cb?: (arg: V, attempt: number) => void
): AtMostOnce<V> {
  wrap.callCount = 0;
  return wrap;

  function wrap(arg: V): void {
    const count = wrap.callCount++;
    if (!count) {
      fn(arg);
      return;
    }
    cb?.(arg, count);
  }
}

export interface AtMostOnce<V> {
  (arg: V): void;
  readonly callCount: number;
}

/**
 * Creates a promise which can be resolved by calling the returned callback.
 * This is similar to "deferred" objects provided by other libraries. The
 * optional callback argument will be called just before the promise is
 * resolved (or rejected).
 */
export function resolvable<V = void>(
  cb?: ResolvableCallback<V>
): [Promise<V>, ResolvableCallback<V>] {
  let ok: any;
  let fail: any;
  const p = new Promise<any>((ok_, fail_) => {
    ok = ok_;
    fail = fail_;
  });

  let resolved = false;
  const resolve = (err: unknown, val: V | undefined): void => {
    if (resolved) {
      cb?.(err, val);
      return;
    }
    resolved = true;

    if (err) {
      fail(err);
      return;
    }
    ok(val);
  };

  return [p, resolve];
}

/** Function used to resolve a deferred returned by `resolvable`. */
export type ResolvableCallback<V> = (err?: unknown, val?: V) => void;

/** Placeholder sync function. */
export function noop(): void {}

/** Placeholder async function. */
export async function pass(): Promise<void> {}

/** Async side-effect convenience type. */
export type Effect = () => AsyncOrSync<void>;

/** Identity function. */
export function identity<V>(val: V): V {
  return val;
}

/** Endomorphism type. */
export type Endo<V> = (val: V) => V;

/**
 * Transforms a single-argument-string function, for example an opaque factory
 * method into a function suitable for use as a tag function in template
 * strings.
 */
export function asTagFunction<V>(
  fn: (val: string) => V
): (vals: ReadonlyArray<string>) => V {
  return (vals) => {
    const [val, ...rest] = vals;
    assert(val != null && rest.length === 0, 'Bad input: %j', vals);
    return fn(val);
  };
}

/** Common function callback interface. */
export interface Callback<V> {
  (err?: Error, val?: undefined): void;
  (err: null | undefined, val: V): void;
}

/**
 * Returns a consumer function which collects its arguments into an array,
 * accessible via the `collected` property. This is useful for example to
 * collect shutdown callbacks in a decentralized manner and easily run them
 * later on.
 */
export function collectable<V = unknown>(): Collectable<V> {
  const args: V[] = [];
  collect.collected = args;
  return collect;

  function collect(arg: V): Cleanup {
    args.push(arg);
    return () => {
      const ix = args.indexOf(arg);
      if (~ix) {
        args.splice(ix, 1);
      }
    };
  }
}

/** Recording consumer. */
export type Collectable<V> = Collect<V> & {
  readonly collected: V[];
};

/** Synchronous cleanup effect. */
export type Cleanup = () => void;

/**
 * Adds a argument to the collectable. The returned cleanup function can be
 * callled to remove the argument if it is still present.
 */
export type Collect<V> = (arg: V) => Cleanup;

/**
 * Returns a comparator which accepts nulls and sorts them according to the
 * first argument. Note that `Array.prototype.sort` always sorts `undefined`
 * last, even when a custom comparator is used; use `null`s if this is an issue.
 */
export function sortingNulls<V>(
  pos: 'first' | 'last',
  comp: (v1: V, v2: V) => number
): (v1: V | null | undefined, v2: V | null | undefined) => number {
  const first = pos === 'first';
  return (v1, v2) =>
    v1 == null
      ? v2 == null
        ? 0
        : first
          ? -1
          : 1
      : v2 == null
        ? first
          ? 1
          : -1
        : comp(v1, v2);
}

/**
 * Returns functions wrapping a counter as internal state. This is useful for
 * example in tests to generate unique values deterministically: The first
 * `seqno` argument is 1.
 *
 *    const freshEmail = incrementing((seqno) => `u${seqno}@test.mtth.io`);
 */
export function incrementing<V>(fn: (seqno: number) => V): () => V {
  let seqno = 1;
  return () => fn(seqno++);
}

/**
 * Calls a method on an object with the trailing inputs as arguments. This is
 * equivalent to `obj[name](...args)` but supports calling methods which are a
 * union of function types.
 */
export function methodCall<
  O,
  N extends keyof O,
  A extends unknown[],
  V,
  F extends (...args: A) => V,
>(
  obj: O,
  name: N,
  ...args: O[N] extends F
    ? A
    : O[N] extends (...args: any) => any
      ? Parameters<O[N]> // To get better error messages.
      : never
): V {
  return (obj[name] as any)(...args);
}
