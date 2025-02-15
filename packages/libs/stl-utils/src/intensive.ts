import {assert} from '@mtth/stl-errors';
import {setImmediate} from 'timers/promises';

import {EventConsumer, TypedEmitter} from './events.js';
import {collectable, Endo} from './functions.js';

/**
 * A computationally expensive operation. This interface provides a generic way
 * to run either aggressively (fully synchronously, with minimal overhead) or
 * politely (releasing the event loop regularly).
 *
 * Instances are constructed from a generator function via `intensive`. Each
 * `yield` statement in the generator is an opportunity for the run to
 * "breathe", i.e. yield to the event loop. Note that not all yields will
 * necessarily trigger a breath so the overhead is lower than a naive
 * implementation.
 *
 * Operations may only be run once, whether directly (via `run` and `runSync`)
 * or indirectly (by embedding it).
 */
export interface Intensive<V = void>
  extends EventConsumer<IntensiveListeners<V>> {
  readonly [isIntensiveMarker]: true;

  /**
   * Runs the operation, attempting to "breathe" every `ms` milliseconds
   * (defaulting to 200ms). Each "breath" yields back to the event loop.
   */
  run(ms?: number): Promise<V>;

  /**
   * Runs an intensive operation synchronously. Be aware that this will hold the
   * event loop for the entire duration of the operation.
   */
  runSync(): V;
}

/**
 * Transforms an `Intensive` operation into an iterable which yields suitably.
 * This allows combining operations via `yield*`. For example:
 *
 *    const mapped = intensive(function* (embed) {
 *      const val = yield* embed(intensiveDependency);
 *      return fn(val); // Transform the value.
 *    });
 *
 * `breath` events will be emitted on both the outer and inner operations. The
 * outer operation will always yield just before and just after the embedded
 * (inner) operation runs to allow clearing any delays.
 */
export type EmbedIntensive = <V>(op: Intensive<V>) => IntensiveIterable<V>;

export interface IntensiveIterable<V> {
  [Symbol.iterator](): Iterator<void, V>;
}

export interface IntensiveListeners<V> {
  /** Emitted when the operation starts running. */
  start(): void;

  /**
   * Emitted each time the operation yields to the event loop (just before).
   * `interval` is the time since the previous breath or start in milliseconds.
   * `lateness` is defined as `interval / breathInterval - 1` and can be used to
   * detect whether an operation doesn't yield often enough.
   */
  breath(lateness: number, interval: number): void;

  /**
   * Emitted when the operation ends, successfully or not. `yieldCount`
   */
  end(stats: IntensiveStats, err?: unknown): void;

  /**
   * Emitted when the outermost operation starts running. This event is not
   * emitted on embedded operations. The function argument can be used to wrap
   * the operation's execution.
   */
  run(wrap: (endo: Endo<IntensiveIterable<V>>) => void): void;
}

export interface IntensiveStats {
  /** Total time taken to run in milliseconds. */
  readonly runtime: number;

  /** Number of times the operation provided opportunities for breathing. */
  readonly yieldCount: number;
}

/**
 * Constructs a new intensive operation. The operation is only started once its
 * `run`, `runAsync` method is called directly or via being embedded within
 * another operation.
 *
 * For this to be most effective, the input generator should yield often enough
 * for breaths to be timed appropriately. ~10ms between each yield is a good
 * target, anything above 50ms will likely lead to delays.
 */
export function intensive<V>(
  gen: (embed: EmbedIntensive) => Iterator<void, V>
): Intensive<V>;
export function intensive<V, S>(
  self: S,
  gen: (this: S, embed: EmbedIntensive) => Iterator<void, V>
): Intensive<V>;
export function intensive(arg1: any, arg2?: any): Intensive {
  return new RealIntensive(
    arg2 == null ? undefined : arg1,
    arg2 ?? arg1
  ) as any;
}

const isIntensiveMarker = '@mtth/stl-utils:isIntensive+v1' as const;

/** Checks whether the input is an intensive instance. */
export function isIntensive<V = unknown>(arg: unknown): arg is Intensive<V> {
  return !!(arg as any)?.[isIntensiveMarker];
}

const DEFAULT_BREATH_INTERVAL_MILLIS = 200;

class RealIntensive<V>
  extends TypedEmitter<IntensiveListeners<V>>
  implements Intensive<V>
{
  readonly [isIntensiveMarker]!: true;
  private started = false;
  private root = false;
  constructor(
    private readonly context: unknown,
    private readonly generator: (embed: EmbedIntensive) => Iterator<void, V>
  ) {
    super();
    Object.defineProperty(this, isIntensiveMarker, {value: true});
  }

  *[Symbol.iterator](): Iterator<void, V> {
    assert(!this.started, 'Intensive operation already started');
    this.started = true;
    if (!this.root) {
      // This will be hit when embedded. We yield before starting to clear any
      // excessive delays before emitting breaths on the embedded operations.
      yield;
    }
    this.emit('start');

    const iter = this.generator.call(this.context, <W>(op: Intensive<W>) => {
      assert(isIntensive(op), 'Invalid embed argument');

      const rop = op as RealIntensive<W>;
      return rop
        .once('start', () => void this.on('breath', forwardBreath))
        .once('end', () => void this.removeListener('breath', forwardBreath));

      function forwardBreath(lateness: number, interval: number): void {
        rop.emit('breath', lateness, interval);
      }
    });

    const start = Date.now();
    let yieldCount = 0;
    let err: unknown;
    let res: any;
    try {
      while (!(res = iter.next()).done) {
        yieldCount++;
        yield;
      }
    } catch (cause) {
      assert(cause != null, 'Null intensive error');
      err = cause;
    }
    this.emit('end', {runtime: Date.now() - start, yieldCount}, err);
    if (err != null) {
      throw err;
    }
    if (!this.root) {
      // Similarly, we allow a breath right after embedded operations to surface
      // any excessive tail delays.
      yield;
    }
    return res.value;
  }

  async run(ms?: number): Promise<V> {
    ms = ms ?? DEFAULT_BREATH_INTERVAL_MILLIS;
    const it = this.rootIterator();
    let last = Date.now();
    let res;
    while (!(res = it.next()).done) {
      const now = Date.now();
      const interval = now - last;
      if (interval > ms) {
        this.emit('breath', interval / ms - 1, interval);
        await setImmediate();
        last = Date.now();
      }
    }
    return res.value;
  }

  runSync(): V {
    const it = this.rootIterator();
    let res;
    // eslint-disable-next-line no-empty
    while (!(res = it.next()).done) {}
    return res.value;
  }

  private rootIterator(): Iterator<void, V> {
    this.root = true;
    let iter: IntensiveIterable<V> = this;
    if (this.listenerCount('run')) {
      const collect = collectable<Endo<IntensiveIterable<V>>>();
      this.emit('run', collect);
      for (const wrap of collect.collected) {
        iter = wrap(iter);
      }
    }
    return iter[Symbol.iterator]();
  }
}
