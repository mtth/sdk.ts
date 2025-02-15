/** Event-loop health checks and metrics. */

import {instrumentsFor, MetricsFor, Telemetry} from '@mtth/stl-telemetry';
import {running} from '@mtth/stl-utils/environment';
import {Duration} from 'luxon';
import {setTimeout} from 'timers/promises';

import {packageInfo} from '../common.js';
import {HealthCheck, HealthCheckObservation} from './common.js';

export function eventLoopHealthChecks(args: {
  readonly telemetry: Telemetry;
  readonly pollInterval?: Duration;
}): ReadonlyArray<HealthCheck> {
  const telemetry = args.telemetry.via(packageInfo);
  const metrics = telemetry.metrics(instruments)[0];
  return [
    EventLoopDelayHealthCheck.create({
      telemetry,
      metrics,
      pollIntervalMs: args.pollInterval?.toMillis() ?? DEFAULT_POLL_INTERVAL_MS,
    }),
  ];
}

const instruments = instrumentsFor({
  delay: {
    name: 'mtth.health.event_loop.delay',
    kind: 'histogram',
    unit: 'ms',
    labels: {},
  },
});

type Metrics = MetricsFor<typeof instruments>;

const DEFAULT_POLL_INTERVAL_MS = 350;
const SMOOTHING_FACTOR = 0.95;
const WARN_THRESHOLD_MS = 250;
const FAIL_THRESHOLD_MS = 500;

export class EventLoopDelayHealthCheck implements HealthCheck {
  readonly component = 'event-loop';
  readonly measurement = 'delay';

  private delay = 0;
  private stopped = false;
  private constructor(
    private readonly telemetry: Telemetry,
    private readonly metrics: Metrics
  ) {}

  static create(args: {
    readonly telemetry: Telemetry;
    readonly metrics: Metrics;
    readonly pollIntervalMs: number;
  }): EventLoopDelayHealthCheck {
    const {telemetry: tel} = args;
    const check = new EventLoopDelayHealthCheck(tel, args.metrics);
    check.run(args.pollIntervalMs).catch((err) => {
      tel.logger.error({err}, 'Event loop delay health check errored.');
    });
    return check;
  }

  private async run(ms: number): Promise<void> {
    const {metrics, telemetry} = this;
    const {logger} = telemetry;
    while (!this.stopped) {
      const expected = Date.now() + ms;
      await setTimeout(ms, undefined, {ref: false});
      const delay = Date.now() - expected;
      this.delay =
        this.delay * SMOOTHING_FACTOR + (1 - SMOOTHING_FACTOR) * delay;
      logger.trace(
        {data: {delay}},
        'Observed event loop instant delay. [instant=%sms, smoothed=%sms]',
        delay,
        this.delay
      );
      metrics.delay.record(this.delay);
    }
    logger.debug('Event loop delay health check stopped.');
  }

  stop(): void {
    const {logger} = this.telemetry;
    logger.debug('Stopping event loop delay health check...');
    this.stopped = true;
  }

  observe(): HealthCheckObservation {
    const {delay} = this;
    return {
      status:
        delay > FAIL_THRESHOLD_MS && !running.inTest()
          ? 'fail'
          : delay > WARN_THRESHOLD_MS
            ? 'warn'
            : 'pass',
      value: delay,
      unit: 'ms',
    };
  }
}
