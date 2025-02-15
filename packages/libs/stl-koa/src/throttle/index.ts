import {assertCause,statusErrors, unimplemented} from '@mtth/stl-errors';
import {instrumentsFor, MetricsFor,Telemetry} from '@mtth/stl-telemetry';
import {ifPresent} from '@mtth/stl-utils/functions';
import {DateTime} from 'luxon';
import {
  IRateLimiterOptions,
  RateLimiterAbstract,
  RateLimiterMemory,
  RateLimiterRes,
} from 'rate-limiter-flexible';

import {packageInfo} from '../common.js';
import {failurePropagator} from '../setup/index.js';
import errorCodes, {errors} from './index.errors.js';
import {ThrottleRate} from './rate.js';

export {
  ThrottlePointSource,
  ThrottleRate,
  throttleRate,
  throttleRateSetting,
} from './rate.js';

const instruments = instrumentsFor({
  throttleChecks: {
    name: 'mtth.throttle.checks',
    kind: 'counter',
    unit: '{check}',
    labels: {throttlerId: 'throttler.id', decision: 'decision'},
  },
});

type Metrics = MetricsFor<typeof instruments>;

export type ThrottlingKey = string | false;

/** Rate limiting utility, optionally supporting burst quota */
export interface Throttle {
  consume(key: ThrottlingKey, opts?: ThrottlingOptions): Promise<void>;
  ensure(key: ThrottlingKey, opts?: ThrottlingOptions): Promise<void>;
  penalize(
    key: ThrottlingKey,
    opts?: Pick<ThrottlingOptions, 'points'>
  ): Promise<void>;
}

export interface ThrottlingOptions {
  readonly points?: number;
  /** Alternate remediation (beside waiting), for example signing up */
  readonly remediation?: string;
}

export function createThrottle(args: {
  /** Short unique identifier, used for telemetry */
  readonly id: string;
  /** Human readable explanation, used in error messages */
  readonly reason: string;
  /** Throttle configuration */
  readonly rate: ThrottleRate;
  /** Telemetry instance */
  readonly telemetry: Telemetry;
  /** Distributed state */
  readonly redisClient?: any; // TODO
}): Throttle {
  const {rate, id, reason, redisClient} = args;
  if (!rate.steady.points) {
    return new InactiveThrottle();
  }

  const tel = args.telemetry.via(packageInfo);
  const [metrics] = tel.metrics(instruments);

  let newLimiter: (opts: IRateLimiterOptions) => RateLimiterAbstract;
  if (redisClient) {
    throw unimplemented();
  } else {
    newLimiter = (opts) => new RateLimiterMemory(opts);
  }
  const limiter = newLimiter({
    points: rate.steady.points,
    duration: rate.steady.seconds,
    keyPrefix: `ttt:${id}`,
  });
  const burstLimiter = ifPresent(rate.burst, (r) =>
    newLimiter({
      points: r.points,
      duration: r.seconds,
      keyPrefix: `ttt:b-${id}`,
    })
  );
  return new ActiveThrottle(tel, metrics, limiter, burstLimiter, id, reason);
}

class InactiveThrottle implements Throttle {
  async consume(): Promise<void> {}
  async ensure(): Promise<void> {}
  async penalize(): Promise<void> {}
}

class ActiveThrottle implements Throttle {
  constructor(
    private readonly telemetry: Telemetry,
    private readonly metrics: Metrics,
    private readonly limiter: RateLimiterAbstract,
    private readonly burstLimiter: RateLimiterAbstract | undefined,
    private readonly id: string,
    private readonly reason: string
  ) {}

  private record(decision: 'block' | 'allow'): void {
    this.metrics.throttleChecks.add(1, {throttlerId: this.id, decision});
  }

  private error(ms: number, remed?: string): Error {
    this.record('block');
    const err = errors.throttled(DateTime.now().plus(ms), this.reason, remed);
    return statusErrors.resourceExhausted(err);
  }

  private eligible(key: ThrottlingKey): key is string {
    return key !== false;
  }

  async consume(key: ThrottlingKey, opts?: ThrottlingOptions): Promise<void> {
    if (!this.eligible(key)) {
      return;
    }
    try {
      await this.limiter.consume(key, opts?.points);
    } catch (cause) {
      assertCause(cause instanceof RateLimiterRes, cause);
      if (!this.burstLimiter) {
        throw this.error(cause.msBeforeNext, opts?.remediation);
      }
      try {
        await this.burstLimiter.consume(key, opts?.points);
      } catch (burstCause) {
        assertCause(burstCause instanceof RateLimiterRes, cause);
        const ms = Math.min(cause.msBeforeNext, burstCause.msBeforeNext);
        throw this.error(ms, opts?.remediation);
      }
    }
    this.record('allow');
  }

  async ensure(key: ThrottlingKey, opts?: ThrottlingOptions): Promise<void> {
    if (!this.eligible(key)) {
      return;
    }
    const res = await this.limiter.get(key);
    const points = opts?.points ?? 1;
    if (res && res.remainingPoints < points) {
      throw this.error(res.msBeforeNext, opts?.remediation);
    }
    this.record('allow');
  }

  async penalize(key: ThrottlingKey, opts?: ThrottlingOptions): Promise<void> {
    if (!this.eligible(key)) {
      return;
    }
    await this.limiter.penalty(key, opts?.points);
  }
}

/** Propagator which adds a `retry-after` header to responses */
export const throttleFailurePropagator = failurePropagator(
  errorCodes.Throttled,
  (_fl, ctx, tags) => {
    ifPresent(tags.retryAfter.toHTTP(), (s) => ctx.set('retry-after', s));
  }
);
