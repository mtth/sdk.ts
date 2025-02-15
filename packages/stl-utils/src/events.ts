import {assert} from '@mtth/stl-errors';
import events from 'events';
import {AsyncOrSync} from 'ts-essentials';

/**
 * Asynchronously sets up an emitter, returning it. If an error occurs during
 * setup, it will be emitted on the emitter. Note that the setup will always run
 * after the emitter is returned.
 */
export function withEmitter<E extends events.EventEmitter>(
  ee: E,
  fn: (ee: E) => AsyncOrSync<void>
): E {
  process.nextTick(() => {
    Promise.resolve(ee)
      .then(fn)
      .catch((err) => (ee as any).emit('error', err));
  });
  return ee;
}

// The typed event API below is inspired by the tiny-typed-emitter package, with
// the following difference: `TypedEmitter` is an interface rather than a class.
// This tends to work better for building libraries around it as the class makes
// it harder to get the exact type (we get one that `extends` it, which loses
// the specific listener parameter type).

/** Generic event lister. */
export type EventListener = (...args: any) => void;

export type EventListenersFor<O> = {
  readonly [E in keyof O]: EventListener;
};

type EventName = string | symbol;

export interface EventListeners {
  readonly [E: EventName]: EventListener;
}

type EventNamesFor<O extends EventListenersFor<O>> =
  | (keyof O & EventName)
  | 'error';

type InternalEventNames =
  | typeof events.errorMonitor
  | 'newListener'
  | 'removeListener';

type EventListenerFor<
  O extends EventListenersFor<O>,
  E extends EventNamesFor<O> | InternalEventNames,
> = E extends keyof O
  ? O[E]
  : E extends 'error' | typeof events.errorMonitor
    ? (err: unknown) => void
    : E extends 'newListener' | 'removeListener'
      ? (name: EventName, fn: EventListener) => void
      : never;

export interface EventProducer<O extends EventListenersFor<O>> {
  emit<E extends EventNamesFor<O>>(
    eventName: E,
    ...args: Parameters<EventListenerFor<O, E>>
  ): boolean;
  // This second (fake) signature is needed to prevent unlawful casts between
  // producers. Without it TypeScript will allow casting an
  // `EventProducer<Listeners1>` to `EventProducer<Listeners2>` even when the
  // two listeners are not related. This doesn't cover partial related casts yet
  // however.
  emit(eventName: EventNamesFor<O>, arg: never): boolean;
}

export interface EventConsumer<O extends EventListenersFor<O>> {
  addListener<E extends EventNamesFor<O> | InternalEventNames>(
    event: E,
    listener: EventListenerFor<O, E>
  ): this;
  prependListener<E extends EventNamesFor<O> | InternalEventNames>(
    event: E,
    listener: EventListenerFor<O, E>
  ): this;
  prependOnceListener<E extends EventNamesFor<O> | InternalEventNames>(
    event: E,
    listener: EventListenerFor<O, E>
  ): this;
  removeListener<E extends EventNamesFor<O> | InternalEventNames>(
    event: E,
    listener: EventListenerFor<O, E>
  ): this;
  removeAllListeners(event?: EventNamesFor<O> | InternalEventNames): this;
  once<E extends EventNamesFor<O> | InternalEventNames>(
    eventName: E,
    listener: EventListenerFor<O, E>
  ): this;
  on<E extends EventNamesFor<O> | InternalEventNames>(
    eventName: E,
    listener: EventListenerFor<O, E>
  ): this;
  off<E extends EventNamesFor<O> | InternalEventNames>(
    eventName: E,
    listener: EventListenerFor<O, E>
  ): this;
  listenerCount(type: EventNamesFor<O>): number;
  listeners<E extends EventNamesFor<O> | InternalEventNames>(
    type: E
  ): Function[];
  rawListeners<E extends EventNamesFor<O> | InternalEventNames>(
    type: E
  ): Function[];
  getMaxListeners(): number;
  setMaxListeners(n: number): this;
}

/**
 * An event emitter with configurable specific type for event names and
 * listeners. Note that an error listener is implicitly added (with `unknown`
 * error type).
 *
 * The simplest way to use it is with a vanilla underlying event emitter:
 *
 *  ```
 *  interface MyListeners {
 *    foo: (n: number) => void;
 *  }
 *
 *  const ee = typedEmitter<MyListeners>();
 *  ```
 */
export interface TypedEmitter<O extends EventListenersFor<O>>
  extends EventProducer<O>,
    EventConsumer<O> {
  eventNames(): EventName[];
}

// This convoluted approach allows us to not widen the typed emitter's methods
// due to `EventEmitter`'s permissive declarations.
export const TypedEmitter: new <
  O extends EventListenersFor<O>,
>() => TypedEmitter<O> = events.EventEmitter;

// Not exported by events?
export interface EventEmitterOptions {
  readonly captureRejections?: boolean;
}

/** Returns a typed emitter backed by standard `events.EventEmitter`. */
export function typedEmitter<O extends EventListenersFor<O>>(
  opts?: EventEmitterOptions
): TypedEmitter<O> {
  return new events.EventEmitter(opts) as TypedEmitter<O>;
}

/**
 * Returns a typed event consumer. Any errors thrown during setup (synchronous
 * or not) will be emitted as `'error'` events on the next tick.
 */
export function withTypedEmitter<O extends EventListenersFor<O>>(
  fn: (ee: TypedEmitter<O>) => AsyncOrSync<void>
): EventConsumer<O> {
  return withEmitter(typedEmitter<O>(), fn);
}

/**
 * Iterates on emitted events of the given name until aborted. This is similar
 * to `events.on` but does not throw when aborted, the iterator simply returns.
 * Note that all listeners will be removed from the target when this iterator
 * returns.
 */
export async function* yieldEvents<
  O extends EventListenersFor<O>,
  E extends keyof O & string,
>(
  ee: TypedEmitter<O> | EventConsumer<O>,
  name: E,
  opts?: YieldEventsOptions<keyof O>
): AsyncIterable<Parameters<O[E]>> {
  let signal = opts?.signal;
  if (signal?.aborted) {
    return;
  }

  const consumer: any = ee;
  const until = opts?.until;
  if (until) {
    const ac = new AbortController();
    const stop: any = () => {
      ac.abort();
    };
    for (const n of Array.isArray(until) ? until : [until]) {
      consumer.on(n, stop);
    }
    if (signal) {
      signal.onabort?.(stop);
    }
    signal = ac.signal;
  }

  try {
    yield* events.on(consumer, name, {signal});
  } catch (err: any) {
    if (opts?.throwIfAborted || err.code !== 'ABORT_ERR') {
      throw err;
    }
  }
  // We don't need to remove any listeners since `events.on` will already have.
}

export interface YieldEventsOptions<E = string> {
  readonly until?: E | ReadonlyArray<E>;
  readonly signal?: AbortSignal;
  readonly throwIfAborted?: boolean;
}

/**
 * Streams multiple events until the function's provided argument is called. If
 * the consumer does not have an `error` mapper, one will be automatically be
 * added which will cause the returned iterable to throw.
 *
 * Note that this since is implemented as a generator function, all setup logic
 * will only run once the returned value is used (iterated on, typically). This
 * means in particular that error handling logic will not be set up until then.
 */
export async function* mapEvents<O extends EventListenersFor<O>, V>(
  ee: EventConsumer<O>,
  fn: (exit: () => void) => EventMappersFor<O, V>
): AsyncIterable<V> {
  const consumer: any = ee;
  const listeners = new Map<string, EventListener>();
  function exit(): void {
    for (const [name, listener] of listeners) {
      consumer.removeListener(name, listener);
    }
    listeners.clear();
  }

  const producer = new events.EventEmitter();
  for (const [name, mapper] of Object.entries<any>(fn(exit))) {
    const listener: EventListener = (...args) => {
      forward().catch((err) => {
        producer.emit('error', err);
      });

      async function forward(): Promise<void> {
        // We only await if the return value is a promise and forward the size
        // here instead of reading it directly in the loop below to provide a
        // more natural behavior when multiple events are emitted during a
        // single tick (without this the loop would be aborted on the first
        // yielded value instead of the one which called exit).
        let val = mapper(...args);
        if (typeof val?.then == 'function') {
          val = await val;
        }
        producer.emit('data', val, listeners.size);
      }
    };
    listeners.set(name, listener);
    consumer.on(name, listener);
  }
  assert(listeners.size, 'Empty event mappers');

  if (!listeners.has('error')) {
    const listener: EventListener = (err) => {
      producer.emit('error', err);
    };
    listeners.set('error', listener);
    consumer.on('error', listener);
  }

  try {
    for await (const [val, size] of events.on(producer, 'data')) {
      yield await val;
      if (!size) {
        return;
      }
    }
  } finally {
    exit();
  }
}

export type EventMappersFor<O extends EventListenersFor<O>, V> = {
  readonly [E in EventNamesFor<O>]?: (
    ...args: Parameters<EventListenerFor<O, E>>
  ) => AsyncOrSync<V>;
};

/** Waits for a single event. This is a typed version of `events.once`. */
export async function waitForEvent<
  O extends EventListenersFor<O>,
  E extends keyof O & string,
>(
  ee: TypedEmitter<O> | EventConsumer<O>,
  name: E,
  opts?: {
    readonly signal?: AbortSignal;
  }
): Promise<Parameters<O[E]>> {
  const sig = opts?.signal;
  sig?.throwIfAborted();
  const args: any = await events.once(ee, name, {signal: sig});
  return args;
}

/**
 * Casts a subtype of event emitter to the base type. This is useful when
 * dealing with union types which otherwise return an error saying "This
 * expression is not callable ... none of those signatures are compatible".
 */
export function asEmitter<E extends events.EventEmitter>(
  ee: E
): events.EventEmitter {
  return ee;
}
