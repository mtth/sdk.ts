import {assert, defaultErrors, unexpected} from '@mtth/stl-errors';
import fastDeepEqual from 'fast-deep-equal/es6/index.js';
import {ValueOf} from 'ts-essentials';
import {default as untruncate_} from 'untruncate-json';

import {ifPresent} from './functions.js';
import {upperCaseFirst} from './strings.js';

const untruncate = untruncate_.default ?? untruncate_;

/** Convenience empty record type. */
export type Empty = Record<string, never>;

/** Checks whether two objects are deeply equal. */
export function isDeepEqual(arg1: unknown, arg2: unknown): boolean {
  return fastDeepEqual(arg1, arg2);
}

/** Wraps an object, adding a freeze method. */
export function freezable<O extends object>(
  val: O,
  opts?: FreezableOptions<O>
): [O, Freezer] {
  const allow = ifPresent(opts?.allowList, (a) => new Set(a));
  const cb = ifPresent(opts?.onFreeze, (fn) => () => {
    fn(val);
  });
  const [handler, freezer] = freezing(allow, cb);
  const proxy = new Proxy(val, handler);
  return [proxy as any, freezer];
}

export interface FreezableOptions<O> {
  readonly allowList?: ReadonlyArray<Exclude<keyof O, number>>;
  readonly onFreeze?: (obj: O) => void; // Called at most once.
}

export type Freezer = () => void;

type Prop = string | symbol;

const defaultFreezeAllowList: ReadonlySet<Prop> = new Set([
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toString',
  'valueOf',
  Symbol.toPrimitive,
  Symbol.toStringTag,
]);

function freezing<O extends object>(
  allow: ReadonlySet<Prop> | undefined,
  cb: (() => void) | undefined
): [ProxyHandler<O>, Freezer] {
  let frozen = false;
  function freeze(): void {
    if (!frozen) {
      frozen = true;
      cb?.();
    }
  }

  const handler = {
    get(obj: O, prop: Prop, rcv: any): any {
      const desc = Object.getOwnPropertyDescriptor(obj, prop);
      if (desc && !desc.get && typeof desc?.value != 'function') {
        return desc?.value;
      }
      if (frozen && !defaultFreezeAllowList.has(prop) && !allow?.has(prop)) {
        throw frozenObjectError('get', prop);
      }
      return Reflect.get(obj, prop, rcv);
    },
    set(obj: O, prop: Prop, val: any, rcv: any): any {
      if (frozen) {
        throw frozenObjectError('set', prop);
      }
      return Reflect.set(obj, prop, val, rcv);
    },
    deleteProperty(obj: O, prop: Prop): any {
      if (frozen) {
        throw frozenObjectError('del', prop);
      }
      return Reflect.deleteProperty(obj, prop);
    },
    defineProperty(obj: O, prop: Prop, attrs: any): any {
      if (frozen) {
        throw frozenObjectError('def', prop);
      }
      return Reflect.defineProperty(obj, prop, attrs);
    },
  };

  return [handler, freeze];
}

function frozenObjectError(meth: string, prop: Prop): Error {
  return defaultErrors.illegal({
    message: 'Object is frozen',
    tags: {meth, prop: prop.toString()},
  });
}

// ADTs

export type TrimUndefined<T extends unknown[]> = T extends []
  ? []
  : T extends [infer H, ...infer R]
    ? TrimUndefined<R> extends []
      ? H extends undefined
        ? []
        : [H]
      : T
    : never;

/** ADT visitor type. */
export type Visit<O, V = void, C = undefined> = (
  o: O,
  ...rest: TrimUndefined<[C]>
) => V;

function visitorMethod(key: string): string {
  return 'on' + upperCaseFirst(key);
}

/**
 * Generates a discriminated union type.
 *
 * Sample usage:
 *
 *  ```
 *  type D = KindAmong<{
 *    fooN: {readonly n: number};
 *    barV: {readonly v: string};
 *  }>;
 *  const d: D = {kind: 'fooN', n: 123};
 *  ```
 */
export type KindAmong<O> = ValueOf<BranchValues<O>>;

/** Convenience type representing a single discriminating branch. */
export interface HasKind<K extends string = string> {
  readonly kind: K;
}

type BranchValues<O> = {
  [K in keyof O & string]: ValueOf<Branch<O, K>> & HasKind<K>;
};

/** Asserts that the object matches the given branch. */
export function assertKind<O extends HasKind, K extends O['kind']>(
  obj: O,
  kind: K
): asserts obj is O & HasKind<K> {
  assert(obj.kind === kind, 'Unexpected kind branch %s: %j', kind, obj);
}

/** `KindAmong` visitor. */
export type WalkerFor<O extends HasKind, V, C> = {
  readonly [K in O['kind'] as `on${Capitalize<K>}`]: (
    o: O & HasKind<K>,
    c: C
  ) => V;
};

/** Returns a visitor for `KindAmong` ADTs. */
export function walkWith<O extends HasKind, V = void, C = undefined>(
  walker: WalkerFor<O, V, C>
): Visit<O, V, C> {
  return visit;

  function visit(o: any, c?: any): any {
    return (walker as any)[visitorMethod(o.kind)](o, c);
  }
}

/**
 * Generates a "oneof" union type. This is similar to a discriminated union type
 * but the values remain nested within their separate fields.
 *
 * Sample usage:
 *
 *  ```
 *  type J = JustOne<{
 *    fooN: {readonly n: number};
 *    barV: {readonly v: string};
 *  }>;
 *  const j: J = {just: 'fooN', fooN: {n: 123}}; // Note the `fooN` key here.
 *  ```
 */
export type JustOne<O> = ValueOf<Branches<'just', O>>;

type Branches<K extends string, O> = {
  [B in keyof O]: Branch<O, B> & {readonly [N in K]: B};
};

type Branch<O, B1> = {
  readonly [B2 in keyof O as B2 extends B1 ? B2 : never]: O[B2];
};

/**
 * Convenience type filtering on a particular `just` value. This can be useful
 * to narrow `JustOne` types, for example:
 *
 *  ```
 *  type One = JustOne<{foo: Foo; bar: Bar; baz: Baz}>; // foo, bar, or baz.
 *  type Two = Exclude<One, HasJust<'foo'>>; // bar or baz.
 *  ```
 */
export interface HasJust<J extends string = string> {
  readonly just: J;
}

/** Convenience type representing the discriminating branch of `JustOne`. */
export type IsJust<J extends string = string, V = unknown> = HasJust<J> & {
  readonly [K in J]: V;
};

/** Extracts a branch from `JustOne`, narrowing the type appropriately. */
export function getJust<O extends HasJust, J extends O['just']>(
  obj: O,
  just: J
): (J extends keyof O ? O[J] : never) | undefined {
  return obj.just === just ? (obj as any)[just] : undefined;
}

/** Wraps the argument into a `JustOne` compatible value. */
export function just<J extends string, V>(
  j: J,
  val: V
): JustOne<{[K in J]: V}> {
  return {just: j, [j]: val} as any;
}

/** Asserts that the object matches the given branch. */
export function assertJust<O extends HasJust, J extends O['just']>(
  obj: O,
  just: J
): asserts obj is O & HasJust<J> {
  assert(obj.just === just, 'Unexpected just branch %s: %j', just, obj);
}

/** Checks that the object matches the branch and returns its value. */
export function checkJust<O extends HasJust, J extends O['just']>(
  obj: O,
  just: J
): J extends keyof O ? O[J] : never {
  assertJust(obj, just);
  return (obj as any)[just];
}

/** `JustOne` visitor. */
export type ExplorerFor<O extends HasJust, V, C> = {
  readonly [J in O['just'] as `on${Capitalize<J>}`]: (
    o: O extends IsJust<J, infer V> ? V : never,
    c: C,
    j: J
  ) => V;
};

/** Returns a visitor for `JustOne` ADTs. */
export function exploreWith<O extends HasJust, V = void, C = undefined>(
  explorer: ExplorerFor<O, V, C>
): Visit<O, V, C> {
  return visit;

  function visit(o: any, c?: any): any {
    const key = o.just;
    return (explorer as any)[visitorMethod(key)](o[key], c, key);
  }
}

/**
 * A limited depth version of `DeepWritable`. This is useful since in many cases
 * we want to keep the immutability of nested values and only allow modifying
 * the outer object's keys and collections. The optional second argument can be
 * used to allowlist fields for nested modification.
 */
export type Modifiable<O, K extends keyof O = never> = {
  -readonly [P in keyof O]: O[P] extends ReadonlyMap<infer K, infer V>
    ? Map<K, V>
    : O[P] extends ReadonlySet<infer V>
      ? Set<V>
      : O[P] extends ReadonlyArray<infer V>
        ? V[]
        : P extends K
          ? Modifiable<O[P]>
          : O[P];
};

/**
 * Marks properties in a type as present (required and non-nullable). The
 * `readonly`-ness of properties is preserved.
 */
export type MarkPresent<O extends object, F extends keyof O = keyof O> = Omit<
  O,
  F
> & {
  // We don't add readonly here because it would cause writable properties to
  // become readonly. The default behavior works as expected: readonly
  // properties remain readonly.
  [K in F]-?: NonNullable<O[K]>;
};

const CONTAINED_HEADER_SIZE = 49; // Upper bound.

// Log lines get truncated when they are go beyond 16kiB. We use this constant
// to avoid logging data which would cause us to exceed that limit. It is lower
// to account for other elements of the log line (message, metadata, ...).
const DEFAULT_CONTAINED_SIZE = 12_288;

/**
 * Fits data within a given length, potentially truncating it. This function is
 * relatively expensive and shouldn't be called on critical paths (i.e. prefer
 * guarding it with log-level enabled checks).
 */
export function contained(
  data: unknown,
  opts?: {
    readonly maxLength?: number;
  }
): Contained {
  const to = opts?.maxLength ?? DEFAULT_CONTAINED_SIZE;
  assert(
    to > CONTAINED_HEADER_SIZE,
    'Contained length too small: %d <= %d',
    to,
    CONTAINED_HEADER_SIZE
  );
  const maxSize = to - CONTAINED_HEADER_SIZE;
  if (typeof data == 'string') {
    const size = data.length;
    return size <= maxSize
      ? {size, data}
      : {size, loss: 1 - maxSize / size, data: data.slice(0, maxSize)};
  }
  const full = JSON.stringify(data);
  const size = full?.length ?? 0;
  if (size <= maxSize) {
    return {size, data};
  }
  const kept = untruncate(full.slice(0, maxSize));
  return {size, loss: 1 - kept.length / size, data: JSON.parse(kept)};
}

export interface Contained {
  /** Stringified size of the contained data. */
  readonly size: number;
  /** Approximate loss, absent if lossless. */
  readonly loss?: number;
  /** Potentially truncated data, fit to container. */
  readonly data: unknown;
}

/**
 * Mutates the input in-place, deleting all (potentially nested) keys pointing
 * to `undefined` values. Note that `null` values are kept. Arrays and maps are
 * traversed.
 */
export function stripUndefinedValues(arg: unknown): void {
  if (typeof arg != 'object' || !arg) {
    return;
  }
  if (Array.isArray(arg)) {
    for (const elem of arg) {
      stripUndefinedValues(elem);
    }
    return;
  }
  if (arg instanceof Map) {
    for (const [key, val] of arg) {
      if (val === undefined) {
        arg.delete(key);
      } else {
        stripUndefinedValues(val);
      }
    }
    return;
  }
  const obj: any = arg;
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) {
      delete obj[key];
    } else {
      stripUndefinedValues(val);
    }
  }
}

/** Type-safe mapping over an object's values */
export function mapValues<K extends string | number | symbol, V, W>(
  obj: {readonly [P in K]: V},
  fn: (val: V, key: K) => W
): {readonly [P in K]: W} {
  const entries = Object.entries<V>(obj).map((e) => [
    e[0],
    fn(e[1], e[0] as K),
  ]);
  return Object.fromEntries(entries);
}

const DEFAULT_STRING_THRESHOLD = 2048;
const DEFAULT_BUFFER_THRESHOLD = 64;
const DEFAULT_ARRAY_THRESHOLD = 50;

export interface PrettyFormatterOptions {
  readonly stringThreshold?: number;
  readonly arrayThreshold?: number;
  readonly binaryArrayThreshold?: number;
}

/** Object pretty formatter */
export class PrettyFormatter {
  private constructor(
    private readonly stringPadding: number,
    private readonly arrayPadding: number,
    private readonly binaryArrayPadding: number
  ) {}

  static create(opts?: PrettyFormatterOptions): PrettyFormatter {
    return new PrettyFormatter(
      ((opts?.stringThreshold ?? DEFAULT_STRING_THRESHOLD) / 2) | 0,
      ((opts?.arrayThreshold ?? DEFAULT_ARRAY_THRESHOLD) / 2) | 0,
      ((opts?.binaryArrayThreshold ?? DEFAULT_BUFFER_THRESHOLD) / 2) | 0
    );
  }

  format(arg: unknown): unknown {
    switch (typeof arg) {
      case 'string':
        return this.formatString(arg);
      case 'number':
      case 'boolean':
      case 'undefined':
        return arg;
      case 'bigint':
      case 'symbol':
        return arg.toString();
      case 'function':
        return '<function>';
      case 'object':
        break;
      default:
        throw unexpected(arg);
    }
    if (arg === null) {
      return arg;
    }
    const obj = arg as any;
    if (ArrayBuffer.isView(obj)) {
      const arr = obj as any;
      if ('BYTES_PER_ELEMENT' in arr && arr.BYTES_PER_ELEMENT === 1) {
        return this.formatBuffer(
          Buffer.from(obj.buffer, obj.byteOffset, obj.byteLength)
        );
      }
      const len = arr.length;
      if (typeof len == 'number') {
        return this.formatRelativeIndexable(arr, arr.length);
      }
      return '<buffer>';
    }
    if (typeof obj.toJSON == 'function') {
      return this.format(obj.toJSON());
    }
    if (Symbol.iterator in obj) {
      const arr = Array.isArray(obj) ? obj : [...(obj as any)];
      return this.formatRelativeIndexable(arr, arr.length);
    }
    return Object.fromEntries(
      Object.entries(obj).map((t) => [t[0], this.format(t[1])])
    );
  }

  private formatString(str: string): string {
    const padding = this.stringPadding;
    const total = str.length;
    const omitted = total - padding * 2;
    if (omitted <= 0) {
      return str;
    }
    const prefix = str.slice(0, padding);
    const suffix = str.slice(total - padding, total);
    return prefix + ellipsis(omitted) + suffix;
  }

  private formatRelativeIndexable(
    arg: RelativeIndexable<unknown>,
    total: number
  ): ReadonlyArray<unknown> {
    const padding = this.arrayPadding;
    const omitted = total - padding * 2;
    if (omitted <= 0) {
      const copy = new Array(total);
      for (let i = 0; i < total; i++) {
        copy[i] = this.format(arg.at(i));
      }
      return copy;
    }
    const copy = new Array(2 * padding + 1);
    for (let i = 0; i < padding; i++) {
      copy[i] = this.format(arg.at(i));
    }
    copy[padding] = ellipsis(omitted);
    for (let i = 0; i < padding; i++) {
      copy[padding + 1 + i] = this.format(arg.at(total - padding + i));
    }
    return copy;
  }

  private formatBuffer(buf: Buffer): string {
    const padding = this.binaryArrayPadding;
    const total = buf.length;
    const omitted = total - 2 * padding;
    if (omitted <= 0) {
      return '0x' + buf.toString('hex');
    }
    const prefix = buf.subarray(0, padding).toString('hex');
    const suffix = buf.subarray(total - padding, total).toString('hex');
    return '0x' + prefix + ellipsis(omitted) + suffix;
  }
}

function ellipsis(omitted: number): string {
  return `... <${omitted} omitted> ...`;
}
