import {
  assert,
  assertType,
  ErrorCode,
  errorCode,
  errorFactories,
  findErrorCode,
  isStandardError,
} from '@mtth/stl-errors';
import {
  boolSetting,
  floatSetting,
  intSetting,
  SettingDefaultsFor,
  SettingFor,
} from '@mtth/stl-settings';
import {
  CustomLogValues,
  instrumentsFor,
  Logger,
  Telemetry,
} from '@mtth/stl-telemetry';
import {ProcessEnv} from '@mtth/stl-utils/environment';
import {TypedEmitter} from '@mtth/stl-utils/events';
import {ifPresent} from '@mtth/stl-utils/functions';
import {MarkPresent} from '@mtth/stl-utils/objects';
import * as otel from '@opentelemetry/api';
import events from 'events';
import {Duration} from 'luxon';
import pRetry, {Options as PRetryOptions} from 'p-retry';

import {packageInfo} from './common.js';
import {
  activeDeadline,
  Deadline,
  deadlines,
  deadlinesErrorCodes,
  instrumentedRace,
  Race,
  RaceState,
  TimeoutLike,
} from './deadlines/index.js';
import {durationSetting} from './time.js';

export const resilienceErrorCodes = deadlinesErrorCodes;

const [internalErrors, internalCodes] = errorFactories({
  prefix: 'ERR_INTERNAL_',
  definitions: {
    // Error code used to work around pRetry's requirement that errors be
    // `instanceof Error`. Unfortunately it's not always the case, see
    // https://234.fyi/58Qgj79n for example.
    coercedAttemptError: (cause: unknown) => ({
      message: 'A resilient attempt was rejected with a non-error instance',
      cause,
      stackFrom: false,
    }),
  },
});

const DEFAULT_RETRY_COUNT = 0;
const DEFAULT_BACKOFF_FACTOR = 2;
const defaultInitialBackoff = Duration.fromMillis(100);
const defaultAsymptoticBackoff = Duration.fromObject({seconds: 15});

// p-retry's option type is needlessly complicated.
type RetryOptions = Exclude<PRetryOptions, number[]>;

/**
 * Runs the provided function within the provided deadline and/or abort signals.
 * Retries are also supported.
 *
 * The function is guaranteed to be called before any timeouts or aborts occur.
 * This means that it will run at least until its first async "break-point",
 * even if the deadline has already passed or one of the signals is already
 * aborted.
 */
export function resilient<V>(
  spanName: string,
  fn: ResilientAttempter<V>
): Resilient<V>;
export function resilient<V>(
  spanName: string,
  opts: Resilience | undefined,
  fn: ResilientAttempter<V>
): Resilient<V>;
export function resilient<V>(
  spanName: string,
  arg1: Resilience | ResilientAttempter<V> | undefined,
  arg2?: ResilientAttempter<V>
): Resilient<V> {
  const opts = (typeof arg1 == 'function' ? undefined : arg1) ?? {};
  const fn = arg2 ?? arg1;
  assertType('function', fn);

  const dd = deadlines.create(opts?.timeout ?? Infinity);
  const attemptTimeout = opts?.attemptTimeout ?? Infinity;
  const retryCount = Math.max(opts?.retryCount ?? DEFAULT_RETRY_COUNT, 0);
  let retry: RetryOptions | undefined;
  if (retryCount) {
    retry = {
      retries: retryCount,
      factor: opts?.backoffFactor ?? DEFAULT_BACKOFF_FACTOR,
      minTimeout:
        ifPresent(opts?.initialBackoff, (v) => +Duration.fromDurationLike(v)) ??
        +defaultInitialBackoff,
      maxTimeout:
        ifPresent(
          opts?.asymptoticBackoff,
          (v) => +Duration.fromDurationLike(v)
        ) ?? +defaultAsymptoticBackoff,
      randomize: !opts?.deterministic,
    };
  }
  return new RealResilient(spanName, fn, dd, attemptTimeout, retry) as any;
}

export type ResilientAttempter<V> = (ra: ResilientAttempt) => Promise<V>;

export interface ResilientAttempt {
  /** The attempt's deadline. */
  readonly deadline: Deadline;

  /** Attempt sequence number, starting from 1. */
  readonly seqno: number;

  /** A decorated logger. */
  readonly logger: Logger;

  /** The span backing the attempt. */
  readonly span: otel.Span;

  /** The underlying race's state. */
  readonly state: RaceState;
}

export interface Resilience {
  /**
   * Overall timeout. Note that a currently running promise will not be
   * automatically aborted when the timeout is hit. It can however use the
   * provided `ResilientAttempt`'s deadline property to do so.
   */
  readonly timeout?: TimeoutLike;

  /**
   * Maximum number of retries. Setting this to 0 or a negative value will
   * disable retrying. The default is 0.
   */
  readonly retryCount?: number;

  /**
   * Maximum duration for each attempt. Retries that take longer will fail
   * with a deadline exceeded error (and may be retried).
   */
  readonly attemptTimeout?: Duration | number;

  /**
   * First _non-zero_ duration between retries. Default is 1 second. Note that
   * the first retry is always emitted immediately after the first failure, this
   * timeout is therefore used between the second failure and the second retry.
   */
  readonly initialBackoff?: Duration | number;

  /**
   * Steady state (and maximum) duration between retries. Default is 15 seconds.
   */
  readonly asymptoticBackoff?: Duration | number;

  /**
   * Multiplicative factor applied to backoffs. See https://234.fyi/0hQJpL9M.
   * The default is 2.
   */
  readonly backoffFactor?: number;

  /** Do not randomize delays. */
  readonly deterministic?: boolean;
}

export interface Resilient<V> extends TypedEmitter<ResilientEvents<V>> {
  /**
   * Sets the resilient retry predicate. Subsequent calls of this method will
   * overwrite previous ones. By default only attempt deadline exceeded errors
   * are retried.
   */
  retrying(fn: FailurePredicate): this;

  /**
   * Convenience method to set the retry predicate to retry on the input error
   * codes. Only the first error code (as returned by `findErrorCode` is
   * checked.
   */
  retryingCodes(code: ErrorCode | ReadonlySet<ErrorCode>): this;

  /** Runs the underlying target. Should not be called more than once. */
  run(args: ResilientRunArgs): Promise<V>;
}

/**
 * Events emitted by `Resilient` instances. Note that the event listeners must
 * be added before the call to `run` for these to be emitted for performance
 * reasons.
 */
export interface ResilientEvents<V> {
  /**
   * When a retry attempt is scheduled. The seqno corresponds to the attempt
   * that failed. For example the first failure will have seqno 1.
   */
  retry: (err: unknown, seqno: number) => void;

  /**
   * When an attempt succeeded after the attempt's deadline (and was therefore
   * discarded).
   */
  lateAttemptValue: (val: V, seqno: number, delay: Duration) => void;

  /** When an attempt failed after the attempt's deadline. */
  lateAttemptError: (err: unknown, seqno: number, delay: Duration) => void;
}

export interface ResilientRunArgs {
  readonly telemetry: Telemetry;

  /** Parent attempt logger, defaults to the telemetry's. */
  readonly logger?: Logger;

  /**
   * Signals to abort the run. The resilient run will throw an aborted error
   * when the first of these signals is aborted. Note that the attempter might
   * continue to run in the background unless it detects that the attempt has
   * been abandoned.
   */
  readonly signals?: ReadonlyArray<AbortSignal>;

  /** Context to use instead of the currently active one. */
  readonly context?: otel.Context;

  /** Options for the underlying span. */
  readonly spanOptions?: otel.SpanOptions;

  /** Don't add any currently active deadline or signals to the created race. */
  readonly escapeContext?: boolean;
}

/**
 * Handler called each time the attempter fails. `seqno` represents the
 * 1-indexed number of the attempt that threw the error (so the first failure
 * will have a `seqno` of 1. Returning `true` means the error should be retried.
 */
export type FailurePredicate = (err: unknown, seqno: number) => boolean;

/** Name of the span used as parent for retriable resilient runs. */
const RETRYING_SPAN_NAME = 'resilience retryable';

const instruments = instrumentsFor({
  resilientRetries: {
    name: 'mtth.resilience.retries',
    kind: 'counter',
    unit: '{retries}',
    labels: {errorCode: 'error.code', spanName: 'span.name'},
  },
});

class RealResilient<V> extends events.EventEmitter {
  private attempt = 0;
  private predicate: FailurePredicate | undefined;
  private attemptRace: Race<V> | undefined;
  constructor(
    private readonly spanName: string,
    private readonly attempter: ResilientAttempter<V>,
    private readonly passiveDeadline: Deadline, // Not including any active one.
    private readonly attemptTimeout: Duration | number,
    private readonly retry: RetryOptions | undefined
  ) {
    super();
  }

  retrying(pred: FailurePredicate): this {
    this.predicate = pred;
    return this;
  }

  retryingCodes(code: ErrorCode | ReadonlySet<ErrorCode>): this {
    return this.retrying((err) => {
      const got = findErrorCode(err);
      return (
        got != null && (typeof code == 'string' ? code === got : code.has(got))
      );
    });
  }

  private async runAttempt(
    lval: ResilientLogValue,
    runDeadline: Deadline,
    args: MarkPresent<ResilientRunArgs, 'logger'>
  ): Promise<V> {
    const attemptDeadline = deadlines.first(
      runDeadline,
      deadlines.create(this.attemptTimeout)
    );
    const attempt = ++this.attempt;
    const lvals: CustomLogValues = {[RESILIENT_LOG_KEY]: {...lval, attempt}};
    const race = instrumentedRace(
      {
        ...args,
        spanName: this.spanName,
        timeout: attemptDeadline,
        telemetry: args.telemetry,
        logger: args.logger.child(lvals),
      },
      (rs, span, log) =>
        this.attempter({
          deadline: attemptDeadline,
          seqno: attempt,
          state: rs,
          span,
          logger: log,
        })
    );
    if (this.listenerCount('lateAttemptValue')) {
      race.on('lateValue', (val, delay) => {
        this.emit('lateAttemptValue', val, attempt, delay);
      });
    }
    if (this.listenerCount('lateAttemptError')) {
      race.on('lateError', (err, delay) => {
        this.emit('lateAttemptError', err, attempt, delay);
      });
    }
    assert(!this.attemptRace, 'Attempt race already initialized');
    this.attemptRace = race;
    return race.run();
  }

  run(args: ResilientRunArgs): Promise<V> {
    assert(this.attempt === 0, 'Resilient rerun detected');

    // Use unscoped logger as parent so that the message logged from _within_ an
    // attempt (from the calling library) use the original library.
    const log = args.logger ?? args.telemetry.logger;
    const tel = args.telemetry.via(packageInfo);

    const dd = args.escapeContext
      ? this.passiveDeadline
      : deadlines.first(this.passiveDeadline, activeDeadline());
    const lval: ResilientLogValue = {
      maxRetries: this.retry?.retries ?? undefined,
      timeoutMillis: dd.cutoff?.diffNow().toMillis(),
    };

    const updated: MarkPresent<ResilientRunArgs, 'logger'> = {
      ...args,
      logger: log,
      telemetry: tel,
    };
    if (!this.retry) {
      return this.runAttempt(lval, dd, updated);
    }

    const pred = this.predicate;
    const [metrics] = tel.metrics(instruments);
    return instrumentedRace(
      {...updated, spanName: RETRYING_SPAN_NAME, timeout: dd},
      (rs) =>
        pRetry(
          () =>
            rs.lossError
              ? Promise.reject(rs.lossError)
              : this.runAttempt(lval, dd, updated).catch(coerceAttemptError),
          {
            ...this.retry,
            onFailedAttempt: (cause) => {
              const err = originalAttemptError(cause);
              if (rs.isLost() || !cause.retriesLeft) {
                throw err;
              }
              const attempt = this.attempt;
              if (pred && !pred(err, attempt)) {
                throw err;
              }
              this.attemptRace = undefined;
              tel.logger.debug(
                {[RESILIENT_LOG_KEY]: {...lval, attempt}, err},
                'Retrying failed attempt.'
              );
              metrics.resilientRetries.add(1, {
                errorCode: errorCode(cause) ?? '',
                spanName: this.spanName,
              });
              this.emit('retry', err, attempt);
            },
          }
        ).catch(uncoerceAttemptError)
    ).run();
  }
}

const RESILIENT_LOG_KEY = '$resilient';

interface ResilientLogValue {
  readonly maxRetries: number | undefined;
  readonly timeoutMillis: number | undefined;
}

function originalAttemptError(err: unknown): unknown {
  return isStandardError(err, internalCodes.CoercedAttemptError)
    ? err.cause
    : err;
}

function coerceAttemptError(err: unknown): never {
  throw err instanceof Error ? err : internalErrors.coercedAttemptError(err);
}

function uncoerceAttemptError(err: unknown): never {
  throw originalAttemptError(err);
}

/**
 * Returns a setting to configure resilience options. The defaults are the same
 * as those for `resilient`. The following evars are used, each mapping to the
 * similarly named option:
 *
 *  + `TIMEOUT`
 *  + `RETRY_COUNT`
 *  + `ATTEMPT_TIMEOUT`
 *  + `INITIAL_BACKOFF`
 *  + `ASYMPTOTIC_BACKOFF`
 *  + `BACKOFF_FACTOR`
 *  + `DETERMINISTIC`
 *
 * These will be optionally prefixed if requested in the options.
 */
export function resilienceSetting(
  env: ProcessEnv,
  opts?: ResilienceSettingOptions
): SettingFor<Resilience> {
  const prefix = opts?.prefix ?? '';
  const d = opts?.defaults ?? {};

  return {
    timeout: durationSetting(getSource('TIMEOUT') ?? d.timeout),
    retryCount: intSetting(getSource('RETRY_COUNT') ?? d.retryCount),
    initialBackoff: durationSetting(
      getSource('INITIAL_BACKOFF') ?? d.initialBackoff
    ),
    asymptoticBackoff: durationSetting(
      getSource('ASYMPTOTIC_BACKOFF') ?? d.asymptoticBackoff
    ),
    attemptTimeout: durationSetting(
      getSource('ATTEMPT_TIMEOUT') ?? d.attemptTimeout
    ),
    backoffFactor: floatSetting(getSource('BACKOFF_FACTOR') ?? d.backoffFactor),
    deterministic: boolSetting(getSource('DETERMINISTIC') ?? d.deterministic),
  };

  function getSource(evar: string): string | undefined {
    return env[prefix + evar];
  }
}

export interface ResilienceSettingOptions {
  /** Evar name prefix, defaults to the empty string. */
  readonly prefix?: string;

  /** Setting specific default values to override the global ones. */
  readonly defaults?: SettingDefaultsFor<Resilience>;
}
