import {
  assert,
  check,
  ErrorCode,
  errorFactories,
  errorMessage,
  isStandardError,
  StandardErrorForCode,
  StatusError,
  statusErrors,
} from '@mtth/stl-errors';
import {Logger, recordErrorOnSpan, Telemetry} from '@mtth/stl-telemetry';
import {TypedEmitter} from '@mtth/stl-utils/events';
import * as otel from '@opentelemetry/api';
import events from 'events';
import {DateTime, Duration} from 'luxon';
import {setImmediate} from 'timers/promises';

import {packageInfo} from '../../common.js';
import {firstAborted} from '../signals.js';
import {
  activeImpatience,
  codes as commonCodes,
  Deadline,
  DeadlineExceededError,
  deadlines,
  isInDistantFuture,
  TimeoutLike,
  withActiveImpatience,
} from './common.js';

export const [errors, codes] = errorFactories({
  definitions: {
    abandoned: 'The underlying race was lost',
    aborted: (cause?: unknown) => ({message: 'A signal was aborted', cause}),
  },
});

export type AbortedError = StatusError<
  StandardErrorForCode<typeof codes.Aborted>
>;

/** Custom event emitter useful to tracker late arriving values and errors. */
export interface Race<V> extends TypedEmitter<RaceEvents<V>> {
  /** Returns the race's _mutable_ state. */
  readonly state: RaceState;

  /**
   * Starts the race, returning the raced promise's result if it completes
   * before the deadline, otherwise a deadline exceeded rejection.
   */
  run(): Promise<V>;
}

export interface RaceEvents<V> {
  /** Emitted when the raced promise was rejected after the race was lost. */
  lateError: (err: unknown, delay: Duration) => void;

  /** Emitted when the raced promise resolved after the race was lost. */
  lateValue: (val: V, delay: Duration) => void;
}

export interface RaceState {
  /**
   * The race's current status. This field is exposed as `readonly` since it
   * should not be mutated by clients but will change as the race progresses.
   */
  readonly status: RaceStatus;

  /**
   * Error populated when the race has been lost. Similar to `status`, this
   * field is `readonly` since it should not be set by clients but may change as
   * the race progresses.
   */
  readonly lossError: RaceLossError | undefined;

  /**
   * Registers a callback to run when the race is lost. If the race is already
   * lost, it will be triggered on the next tick. If the race is not lost yet
   * and is lost later on, these callbacks will be triggered just before the
   * outer promise is rejected.
   */
  onLoss(cb: (err: RaceLossError) => void): void;

  /** Throws an abandoned error synchronously if the race was lost. */
  throwIfLost(): void;

  /**
   * Returns true if the deadline's rejection was used in the race, false if the
   * promise was, `undefined` if the race is still running.
   */
  isLost(): boolean | undefined;

  /**
   * Returns true if the raced promise's result or rejection was used, false if
   * the deadline was used, `undefined` if the race is still running.
   */
  isWon(): boolean | undefined;
}

export type RaceLossError = DeadlineExceededError | AbortedError;

export const raceLossErrorCodes: ReadonlySet<ErrorCode> = new Set([
  commonCodes.DeadlineExceeded,
  codes.Aborted,
]);

export type RaceStatus =
  | 'pending'
  | 'running'
  | 'won'
  | 'aborted'
  | 'overtaken';

/**
 * Returns a promise which completes either when the input promise does or, if
 * the promise exceeds the deadline, with a deadline exceeded error. If the
 * deadline is already exceeded, this method always rejects even if the input
 * promise is already resolved. This function also guarantees that an input
 * function will always be called, even when the deadline has already passed.
 */
export function simpleRace<V>(dd: Deadline, racer: SimpleRacer<V>): Race<V>;
export function simpleRace<V>(
  dd: Deadline,
  sigs: ReadonlyArray<AbortSignal>,
  racer: SimpleRacer<V>
): Race<V>;
export function simpleRace<V>(
  dd: Deadline,
  arg1: ReadonlyArray<AbortSignal> | SimpleRacer<V>,
  arg2?: SimpleRacer<V>
): Race<V> {
  let sigs: ReadonlySet<AbortSignal>;
  let racer: SimpleRacer<V>;
  if (Array.isArray(arg1)) {
    sigs = new Set(arg1);
    racer = check.isPresent(arg2);
  } else {
    sigs = new Set();
    racer = arg1 as any;
  }
  return new SimpleRace(racer, dd, sigs) as any;
}

export type SimpleRacer<V> = (rs: RaceState) => Promise<V>;

class RealRaceState implements RaceState {
  status: RaceStatus = 'pending';
  lossError: RaceLossError | undefined;
  callbacks: ((err: RaceLossError) => void)[] = [];
  constructor(private readonly name?: string) {}

  onLoss(cb: (err: RaceLossError) => void): void {
    const err = this.lossError;
    if (err) {
      process.nextTick(cb, err);
      return;
    }
    this.callbacks.push(cb);
  }

  throwIfLost(): void {
    if (!this.lossError) {
      return;
    }
    throw errors.abandoned();
  }

  isLost(): boolean | undefined {
    switch (this.status) {
      case 'aborted':
      case 'overtaken':
        return true;
      case 'won':
        return false;
      default:
        return undefined;
    }
  }

  isWon(): boolean | undefined {
    switch (this.status) {
      case 'won':
        return true;
      case 'aborted':
      case 'overtaken':
        return false;
      default:
        return undefined;
    }
  }

  lose(err: RaceLossError): void {
    this.status = isStandardError(err, codes.Aborted) ? 'aborted' : 'overtaken';
    this.lossError = err;
    for (const cb of this.callbacks) {
      cb(err);
    }
    this.callbacks.length = 0;
  }
}

class SimpleRace<V> extends events.EventEmitter {
  readonly state = new RealRaceState();
  constructor(
    private readonly racer: SimpleRacer<V>,
    private readonly deadline: Deadline,
    private readonly signals: ReadonlySet<AbortSignal>
  ) {
    super();
  }

  async run(): Promise<V> {
    const {deadline: dd, racer, signals: sigs, state: s} = this;
    assert(s.status === 'pending', 'Race rerun detected');
    s.status = 'running';

    if (!sigs.size && isInDistantFuture(dd.cutoff ?? Infinity)) {
      try {
        return await racer(s);
      } finally {
        s.status = 'won';
      }
    }

    return new Promise((ok, fail) => {
      let endedAt: DateTime | undefined;

      const cleanupDeadline = dd.onExceeded((err) => {
        assert(!endedAt, 'Exceeded but had already ended');
        endedAt = DateTime.now();
        cleanupSignals();
        s.lose(err);
        fail(err);
      });

      function onAborted(cause?: unknown): void {
        assert(!endedAt, 'Aborted but had already ended');
        endedAt = DateTime.now();
        cleanupSignals();
        cleanupDeadline();
        const err = statusErrors.aborted(errors.aborted(cause));
        s.lose(err);
        fail(err);
      }

      function cleanupSignals(): void {
        for (const sig of sigs) {
          sig.removeEventListener('abort', onAborted);
        }
      }

      if (!dd.exceededError()) {
        for (const sig of sigs) {
          if (sig.aborted) {
            process.nextTick(onAborted);
            break;
          }
          sig.addEventListener('abort', onAborted);
        }
      }

      racer(s)
        .finally(() => {
          cleanupDeadline();
          cleanupSignals();
        })
        .then((val) => {
          if (endedAt) {
            if (this.listenerCount('lateValue')) {
              this.emit('lateValue', val, endedAt.diffNow().negate());
            }
            return;
          }
          s.status = 'won';
          ok(val);
        })
        .catch((err) => {
          if (endedAt) {
            if (
              this.listenerCount('lateError') &&
              !isStandardError(err, codes.Abandoned)
            ) {
              this.emit('lateError', err, endedAt.diffNow().negate());
            }
            return;
          }
          s.status = 'won';
          fail(err);
        });
    });
  }
}

/**
 * Runs a candidate function, racing it against the input timeout and/or
 * signals. If the deadline has already passed, the returned promise will be
 * rejected after the next tick, similar to `simpleRace`.
 *
 * The passed in deadline is activated (set on the context, see also
 * `activeDeadline`) for the duration of the handler and should not be used once
 * the handler returns. All listeners on it will be cleared at that time.
 *
 * Each run is wrapped in a span which ends with the candidate and is annotated
 * with any errors, including any deadline exceeded error. If the current
 * context already has an active deadline, the first of the two will be used.
 */
export function instrumentedRace<V>(
  params: InstrumentedRaceParams,
  racer: (rs: RaceState, span: otel.Span, log: Logger) => Promise<V>
): Race<V> {
  const {spanName, spanOptions, timeout} = params;

  const log = params.logger ?? params.telemetry.logger;
  const tel = params.telemetry.via(packageInfo);
  const ctx = params.context ?? otel.context.active();

  const sigs = new Set(params.signals);
  let dd = deadlines.create(timeout);
  if (!params.escapeContext) {
    const imp = activeImpatience(ctx);
    if (imp) {
      dd = deadlines.first(dd, imp.deadline);
      for (const sig of imp.signals) {
        sigs.add(sig);
      }
    }
  }

  const span = tel.startInactiveSpan({
    name: spanName,
    options: {
      ...spanOptions,
      attributes: {
        ...spanOptions?.attributes,
        'mtth.race.deadline_timeout_ms': dd.cutoff?.diffNow().toMillis(),
        'mtth.race.signal_count': sigs.size || undefined,
      },
    },
    context: ctx,
  });
  const lvals = {
    ctx: span.spanContext(),
    $race: {
      spanName,
      timeoutMillis: dd.cutoff?.diffNow().toMillis(),
      signalCount: sigs.size || undefined,
    },
  };
  return InstrumentedRace.create({
    internalLogger: tel.logger.child(lvals),
    externalLogger: log.child(lvals),
    racer,
    deadline: dd,
    span,
    context: otel.trace.setSpan(ctx, span),
    signals: sigs,
  });
}

export interface InstrumentedRaceParams {
  /** Name of the associated span. */
  readonly spanName: string;

  /** Active telemetry. */
  readonly telemetry: Telemetry;

  /** Maximum runtime. */
  readonly timeout: TimeoutLike;

  /** Logger used as parent for resilient attempts. */
  readonly logger?: Logger;

  /** Abort signals. */
  readonly signals?: ReadonlyArray<AbortSignal>;

  /** Parent context for the new span. */
  readonly context?: otel.Context;

  /** Span creation options. */
  readonly spanOptions?: otel.SpanOptions;

  /** Don't add any currently active deadline or signals to the created race. */
  readonly escapeContext?: boolean;
}

class InstrumentedRace<V> extends SimpleRace<V> {
  private readonly startedAt = DateTime.now();
  private constructor(
    racer: SimpleRacer<V>,
    deadline: Deadline,
    signals: ReadonlySet<AbortSignal>,
    private readonly span: otel.Span,
    private readonly logger: Logger
  ) {
    super(racer, deadline, signals);
  }

  static create<V>(args: {
    readonly racer: (rs: RaceState, span: otel.Span, log: Logger) => Promise<V>;
    readonly internalLogger: Logger;
    readonly externalLogger: Logger;
    readonly span: otel.Span;
    readonly deadline: Deadline;
    readonly context: otel.Context;
    readonly signals: ReadonlySet<AbortSignal>;
  }): Race<V> {
    const {
      deadline: dd,
      context,
      racer,
      span,
      externalLogger,
      internalLogger: log,
    } = args;
    const signals = new Set(args.signals);
    for (const sig of activeSignals()) {
      signals.add(sig);
    }
    return new InstrumentedRace(simpleRacer, dd, signals, span, log) as any;

    function simpleRacer(rs: RaceState): Promise<V> {
      const params = {signals, context, timeout: dd};
      return withActiveImpatience(params, async () => {
        log.trace('Starting race...');
        try {
          const ret = await racer(rs, span, externalLogger);
          if (!rs.isLost() && ret !== undefined) {
            span.setStatus({code: otel.SpanStatusCode.OK});
          }
          return ret;
        } catch (err) {
          recordErrorOnSpan(err, span);
          if (isStandardError(err, codes.Abandoned)) {
            log.trace({err}, 'Stopped abandoned race.');
          }
          throw err;
        } finally {
          if (rs.isLost()) {
            span.setStatus({code: otel.SpanStatusCode.ERROR});
          }
          span.end();
        }
      });
    }
  }

  override async run(): Promise<V> {
    try {
      return await super.run();
    } catch (err) {
      recordErrorOnSpan(err, this.span);
      if (this.state.isWon()) {
        this.span.setStatus({
          code: otel.SpanStatusCode.ERROR,
          message: errorMessage(err),
        });
      }
      throw err;
    } finally {
      const {logger} = this;
      const {status} = this.state;
      if (logger.isLevelEnabled('trace')) {
        logger.trace(
          'Race ended. [status=%s, latency=%sms]',
          status,
          -this.startedAt.diffNow()
        );
      }
    }
  }
}

/**
 * Extracts the currently active deadline from the context, or returns a passive
 * one if none is found.
 */
export function activeDeadline(
  ctx: otel.Context = otel.context.active()
): Deadline {
  return activeImpatience(ctx)?.deadline ?? deadlines.distant();
}

/** Extracts any currently active signals from the context. */
export function activeSignals(
  ctx: otel.Context = otel.context.active()
): ReadonlyArray<AbortSignal> {
  const imp = activeImpatience(ctx);
  return imp ? [...imp.signals] : [];
}

/**
 * Convenience method returning a signal tracking the first time an active
 * signal is aborted. If the receiving API accepts an array of signals, consider
 * using `activeSignals` instead.
 */
export function activeSignal(
  ctx: otel.Context = otel.context.active()
): AbortSignal | undefined {
  const imp = activeImpatience(ctx);
  return imp ? firstAborted(imp.signals) : undefined;
}

/**
 * Returns whether an enclosing race has been abandoned. This can happen if its
 * deadline was exceeded or one of its signals aborted.
 */
export function isAbandoned(
  ctx: otel.Context = otel.context.active()
): boolean {
  const imp = activeImpatience(ctx);
  if (!imp) {
    return false;
  }
  if (imp.deadline.isExceeded()) {
    return true;
  }
  for (const sig of imp.signals) {
    if (sig.aborted) {
      return true;
    }
  }
  return false;
}

/**
 * Throws if the currently active race's deadline has been exceeded or one of
 * its signals aborted. For most use-cases, prefer `rejectIfAbandoned`.
 */
export function throwIfAbandoned(
  ctx: otel.Context = otel.context.active()
): void {
  const imp = activeImpatience(ctx);
  if (!imp) {
    return;
  }
  if (imp.deadline.isExceeded()) {
    throw errors.abandoned();
  }
  for (const sig of imp.signals) {
    if (sig.aborted) {
      throw errors.abandoned();
    }
  }
}

/**
 * Yields to the event loop (calling `setImmediate`) then rejects the promise if
 * the currently active race's deadline has been exceeded or one of its signals
 * aborted. See `throwIfAbandoned` for the synchronous equivalent.
 */
export async function rejectIfAbandoned(
  ctx: otel.Context = otel.context.active()
): Promise<void> {
  await setImmediate();
  throwIfAbandoned(ctx);
}
