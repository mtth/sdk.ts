import {
  assert,
  check,
  errorFactories,
  ErrorTagsFor,
  StandardError,
  StatusError,
  statusErrors,
} from '@mtth/stl-errors';
import {noop} from '@mtth/stl-utils/functions';
import * as otel from '@opentelemetry/api';
import {DateTime, Duration} from 'luxon';

export const [errors, codes] = errorFactories({
  definitions: {
    deadlineExceeded: (args: DeadlineExceededErrorArgs) => {
      const ms = args.timeout?.valueOf();
      return {
        message: 'The deadline reached its cutoff' + (ms ? ` (${ms} ms)` : ''),
        tags: {cutoff: args.cutoff?.toISO(), timeoutMillis: ms},
        cause: args.cause,
      };
    },
  },
});

export interface DeadlineExceededErrorArgs {
  readonly cutoff?: DateTime;
  readonly timeout?: Duration;
  readonly cause?: unknown;
}

export type DeadlineExceededError = StatusError<
  StandardError<ErrorTagsFor<typeof codes.DeadlineExceeded>>
>;

/**
 * A date far enough in the future to be practically infinite. This is useful
 * since luxon doesn't support infinite durations.
 */
export const distantFuture = DateTime.fromObject({year: 3000});

/** Returns whether a timeout is practically finite. */
export function isInDistantFuture(arg: TimeoutLike): boolean {
  if (DateTime.isDateTime(arg) || arg instanceof Date) {
    const d = DateTime.isDateTime(arg) ? arg : DateTime.fromJSDate(arg);
    return +d.diff(distantFuture) >= 0;
  }
  if (typeof arg == 'number') {
    if (arg > +distantFuture) {
      return true;
    }
    return isInDistantFuture(DateTime.now().plus(arg));
  }
  if (Duration.isDuration(arg)) {
    return isInDistantFuture(DateTime.now().plus(arg));
  }
  return arg.cutoff ? isInDistantFuture(arg.cutoff) : true;
}

export type TimeoutLike = Deadline | DateTime | Date | Duration | number;

/** Deadline utilities. */
export const deadlines = {
  /** Creates a deadline. */
  create: (arg: TimeoutLike): Deadline => {
    if (arg instanceof FiniteDeadline) {
      return new FiniteDeadline(arg.cutoff, arg.originalTimeout);
    }
    if (DateTime.isDateTime(arg)) {
      return deadlineFor(arg);
    }
    if (arg instanceof Date) {
      return deadlineFor(DateTime.fromJSDate(arg));
    }
    if (typeof arg == 'number') {
      const millis = Math.max(+arg, 0);
      if (!isFinite(millis)) {
        return new InfiniteDeadline();
      }
      const dur = Duration.fromMillis(millis);
      return deadlineFor(DateTime.now().plus(dur), dur);
    }
    if (Duration.isDuration(arg)) {
      return deadlineFor(DateTime.now().plus(arg), arg);
    }
    return arg;
  },

  /** Creates a deadline which is never reached. */
  distant: (): Deadline => new InfiniteDeadline(),

  /**
   * Creates a deadline exceeded error with `DEADLINE_EXCEEDED` status. This can
   * be useful when translating similar errors from other frameworks (e.g.
   * gRPC).
   */
  exceededError: (args: DeadlineExceededErrorArgs): DeadlineExceededError =>
    statusErrors.deadlineExceeded(errors.deadlineExceeded(args)),

  /** Returns the first deadline to expire from the ones input. */
  first: (...dds: Deadline[]): Deadline => {
    let min = deadlines.distant();
    for (const dd of dds) {
      if (!min.cutoff || (dd.cutoff && dd.cutoff < min.cutoff)) {
        min = dd;
      }
    }
    return min;
  },
} as const;

export interface Deadline {
  /** The instant at which the deadline expires, if any. */
  readonly cutoff: DateTime | undefined;

  /**
   * Returns a promise which rejects when the deadline is reached. Note that
   * this will cause a refed timer to exist for the lifetime of the deadline
   * when used with finite deadlines.
   */
  exceeded(): Promise<void>;

  /** Returns an error if the deadline has expired, otherwise nothing. */
  exceededError(): DeadlineExceededError | undefined;

  /** Throws a deadline exceeded error if the deadline has expired. */
  throwIfExceeded(): void;

  /**
   * Returns true if the deadline has expired and all callbacks registered via
   * `onExceeded` have been triggered.
   */
  isExceeded(): boolean;

  /**
   * Adds a callback to run when the deadline expires. The returned function
   * should be used to remove the callback. If the deadline has already expired
   * the callback will be called on the next process tick.
   */
  onExceeded(cb: (err: DeadlineExceededError) => void): DeadlineCleanup;

  /** Returns a signal which aborts when the deadline is reached. */
  signal(): AbortSignal;

  /**
   * Returns the number of milliseconds until the deadline expires. This value
   * may be negative.
   */
  valueOf(): number;
}

export type DeadlineCleanup = () => void;

class FiniteDeadline implements Deadline {
  private controller: AbortController | undefined;
  private promise: Promise<void> | undefined;
  private live = true;
  private pendingTimeouts = new Set<NodeJS.Timeout>();
  constructor(
    readonly cutoff: DateTime,
    readonly originalTimeout?: Duration
  ) {
    assert(cutoff.isValid, 'Invalid cutoff: %s', cutoff.invalidReason);
  }

  valueOf(): number {
    return +this.cutoff - +DateTime.now();
  }

  exceededError(force?: boolean): DeadlineExceededError | undefined {
    const rem = +this;
    if (rem > 0 && !force) {
      return undefined;
    }
    this.live = false;
    return deadlines.exceededError({
      cutoff: this.cutoff,
      timeout: this.originalTimeout,
    });
  }

  isExceeded(): boolean {
    if (!this.live) {
      return true;
    }
    if (this.pendingTimeouts.size || +this > 0) {
      return false;
    }
    this.live = false;
    return true;
  }

  onExceeded(cb: (err: DeadlineExceededError) => void): DeadlineCleanup {
    const err = this.exceededError();
    if (err) {
      process.nextTick(cb, err);
      return noop;
    }
    const timeout = setTimeout(() => {
      this.pendingTimeouts.delete(timeout);
      cb(check.isPresent(this.exceededError(true)));
    }, +this);
    this.pendingTimeouts.add(timeout);
    return () => {
      clearTimeout(timeout);
    };
  }

  throwIfExceeded(): void {
    const err = this.exceededError();
    if (err) {
      throw err;
    }
  }

  exceeded(): Promise<void> {
    if (!this.promise) {
      this.promise = new Promise((_ok, fail) => {
        this.onExceeded(fail);
      });
    }
    return this.promise;
  }

  signal(): AbortSignal {
    if (!this.controller) {
      const ac = new AbortController();
      this.controller = ac;
      this.exceeded().catch((err) => {
        ac.abort(err);
      });
    }
    return this.controller.signal;
  }

  clear(): void {
    for (const timeout of this.pendingTimeouts) {
      clearTimeout(timeout);
      this.pendingTimeouts.delete(timeout);
    }
    this.controller = undefined;
    this.promise = undefined;
  }
}

class InfiniteDeadline implements Deadline {
  readonly cutoff = undefined;
  private readonly controller = new AbortController();
  private readonly promise = new Promise<void>(noop);

  valueOf(): number {
    return Infinity;
  }

  onExceeded(): DeadlineCleanup {
    return noop;
  }

  throwIfExceeded(): void {}

  exceeded(): Promise<void> {
    return this.promise;
  }

  isExceeded(): boolean {
    return false;
  }

  exceededError(): undefined {
    return undefined;
  }

  signal(): AbortSignal {
    return this.controller.signal;
  }
}

function deadlineFor(cutoff: DateTime, dur?: Duration): Deadline {
  return isInDistantFuture(cutoff)
    ? new InfiniteDeadline()
    : new FiniteDeadline(cutoff, dur);
}

export interface Impatience {
  readonly deadline: Deadline;
  readonly signals: ReadonlySet<AbortSignal>;
}

export async function withActiveImpatience<V>(
  arg: {
    readonly timeout: TimeoutLike;
    readonly context?: otel.Context;
    readonly signals?: ReadonlySet<AbortSignal>;
  },
  fn: (dd: Deadline) => Promise<V>
): Promise<V> {
  const ctx = arg.context ?? otel.context.active();
  const dd = deadlines.create(arg.timeout);
  const imp: Impatience = {deadline: dd, signals: arg.signals ?? new Set()};
  const childCtx = ctx.setValue(IMPATIENCE_CONTEXT_KEY, imp);
  try {
    return await otel.context.with(childCtx, fn, undefined, dd);
  } finally {
    if (dd instanceof FiniteDeadline) {
      dd.clear();
    }
  }
}

const IMPATIENCE_CONTEXT_KEY = Symbol.for('@mtth/stl:impatience');

export function activeImpatience(
  ctx: otel.Context = otel.context.active()
): Impatience | undefined {
  return ctx.getValue(IMPATIENCE_CONTEXT_KEY) as any;
}
