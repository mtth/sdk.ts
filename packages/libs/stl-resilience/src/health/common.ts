/**
 * Health-check related types and generic utilities, inspired by and compliant
 * with https://inadarei.github.io/rfc-healthcheck/.
 */

import {instrumentsFor, MetricsFor, Telemetry} from '@mtth/stl-telemetry';
import {Modifiable} from '@mtth/stl-utils/objects';

import {packageInfo} from '../common.js';

/** Component health check. */
export interface HealthCheck {
  /** Checked component name. */
  readonly component: string;

  /** Name of the observationing measurements. */
  readonly measurement: string;

  /** Runs the check and returns current measurement observation. */
  observe(): HealthCheckObservation;
}

export interface HealthCheckObservation {
  readonly status: HealthStatus;
  readonly value?: number;
  readonly unit?: string;
}

export type HealthStatus = 'pass' | 'warn' | 'fail';

/** Combines health statuses. */
export function mergeHealthStatuses(
  s1: HealthStatus,
  s2: HealthStatus
): HealthStatus {
  return s1 === 'fail' || s2 === 'fail'
    ? 'fail'
    : s1 === 'warn' || s2 === 'warn'
      ? 'warn'
      : 'pass';
}

/** Returns the check's unique key. */
export function healthCheckKey(check: Omit<HealthCheck, 'observe'>): string {
  return `${check.component}:${check.measurement}`;
}

export interface HealthReport {
  readonly status: HealthStatus;
  readonly checks: {readonly [key: string]: ReadonlyArray<HealthCheckReport>};
  readonly releaseId?: string;
  readonly serviceId?: string;
}

export type HealthCheckReports = Record<
  HealthStatus,
  ReadonlyArray<HealthCheckReport>
>;

export interface HealthCheckReport {
  readonly component: string;
  readonly measurement: string;
  readonly status: HealthStatus;
  readonly observedValue?: number;
  readonly observedUnit?: string;
}

export function groupHealthChecks(report: HealthReport): HealthCheckReports {
  const reports: Modifiable<HealthCheckReports> = {
    pass: [],
    fail: [],
    warn: [],
  };
  for (const checks of Object.values(report.checks)) {
    for (const check of checks) {
      reports[check.status].push(check);
    }
  }
  return reports;
}

/**
 * Serializes a check and its observation into an RFC-compliant representation.
 */
function healthCheckReport(
  check: HealthCheck,
  obs: HealthCheckObservation
): HealthCheckReport {
  return {
    component: check.component,
    measurement: check.measurement,
    status: obs.status,
    observedValue: obs.value,
    observedUnit: obs.unit,
  };
}

const instruments = instrumentsFor({
  checksReported: {
    name: 'mtth.health.checks.reported',
    kind: 'counter',
    unit: '{checks}',
    labels: {status: 'health.status', key: 'check.key'},
  },
  reportsGenerated: {
    name: 'mtth.health.reports.generated',
    kind: 'counter',
    unit: '{reports}',
    labels: {status: 'health.status'},
  },
});

type Metrics = MetricsFor<typeof instruments>;

export type HealthReportMetadata = Omit<HealthReport, 'status' | 'checks'>;

/** Health check runner. */
export class HealthReporter {
  private constructor(
    private readonly checks: ReadonlyArray<HealthCheck>,
    private readonly metrics: Metrics,
    private readonly metadata: HealthReportMetadata
  ) {}

  static create(args: {
    readonly checks: ReadonlyArray<HealthCheck>;
    readonly telemetry: Telemetry;
    readonly metadata?: HealthReportMetadata;
  }): HealthReporter {
    const tel = args.telemetry.via(packageInfo);
    const metrics = tel.metrics(instruments)[0];
    return new HealthReporter(args.checks, metrics, args.metadata ?? {});
  }

  report(): HealthReport {
    const {checks, metrics, metadata} = this;

    let status: HealthStatus = 'pass';
    const checkResponses: {[key: string]: HealthCheckReport[]} = {};
    for (const check of checks) {
      const obs = check.observe();
      status = mergeHealthStatuses(status, obs.status);
      const key = healthCheckKey(check);
      let responses = checkResponses[key];
      if (!responses) {
        responses = checkResponses[key] = [];
      }
      metrics.checksReported.add(1, {status: obs.status, key});
      responses.push(healthCheckReport(check, obs));
    }

    metrics.reportsGenerated.add(1, {status});
    return {...metadata, status, checks: checkResponses};
  }
}
