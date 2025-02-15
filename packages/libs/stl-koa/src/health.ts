import Router from '@koa/router';
import * as stl from '@opvious/stl';
import Koa from 'koa';
import compose from 'koa-compose';

import {packageInfo, StandardEndpoints} from './common.js';

/** Media type to use for health status responses returned as JSON. */
export const HEALTH_MEDIA_TYPE = 'application/health+json';

/** Header key used to hold the overall status. */
export const HEALTH_STATUS_HEADER = 'opvious-health-status';

/** Header key used to propagate health failures. */
export const HEALTH_FAILURES_HEADER = 'opvious-health-failures';

/** Header key used to propagate health warnings. */
export const HEALTH_WARNINGS_HEADER = 'opvious-health-warnings';

/**
 * Returns a Koa middleware which includes two components:
 *
 * + A router which responds on `StandardEndpoints.HEALTH` with a format
 *   compatible with the RFC at https://inadarei.github.io/rfc-healthcheck/.
 * + A middleware which decorates responses with headers exposing any health
 *   warnings and failures.
 */
export function exposeHealth(args: {
  readonly telemetry: stl.Telemetry;

  /** Checks to observe. */
  readonly checks: ReadonlyArray<stl.HealthCheck>;

  /** Package info used as metadata in the health endpoint response. */
  readonly packageInfo?: stl.LibInfo;
}): Koa.Middleware {
  const telemetry = args.telemetry.via(packageInfo);
  const reporter = stl.HealthReporter.create({
    telemetry,
    checks: args.checks ?? [],
    metadata: {
      serviceId: args.packageInfo?.name,
      releaseId: args.packageInfo?.version,
    },
  });
  const router = createRouter({telemetry, reporter});
  return compose([
    router.allowedMethods(),
    router.routes(),
    async (ctx, next): Promise<void> => {
      const report = reporter.report();
      ctx.set(HEALTH_STATUS_HEADER, report.status);
      if (report.status === 'pass') {
        await next();
        return;
      }

      const {warn: warnings, fail: failures} = stl.groupHealthChecks(report);
      telemetry.logger.debug(
        {data: {failures, warnings}},
        'Attaching %s health failures(s) and %s health warnings(s).',
        failures.length,
        warnings.length
      );
      stl.ifPresent(headerValue(failures), (s) =>
        ctx.set(HEALTH_FAILURES_HEADER, s)
      );
      stl.ifPresent(headerValue(warnings), (s) =>
        ctx.set(HEALTH_WARNINGS_HEADER, s)
      );
      await next();
    },
  ]);
}

function headerValue(
  reports: ReadonlyArray<stl.HealthCheckReport>
): string | undefined {
  if (!reports.length) {
    return undefined;
  }
  const keys = new Set(reports.map((r) => stl.healthCheckKey(r)));
  return [...keys].sort().join(' ');
}

function createRouter(args: {
  readonly telemetry: stl.Telemetry;
  readonly reporter: stl.HealthReporter;
}): Router<any, any> {
  const {reporter, telemetry: tel} = args;
  return new Router().get(StandardEndpoints.HEALTH, (ctx) => {
    ctx.type = HEALTH_MEDIA_TYPE;
    const report = reporter.report();
    tel.logger.debug(
      {data: {report}},
      'Generated health report. [status=%s]',
      report.status
    );
    ctx.status = healthStatusHttpCode(report.status);
    ctx.body = report;
  });
}

/** Converts a status to its corresponding HTTP code. */
export function healthStatusHttpCode(status: stl.HealthStatus): number {
  switch (status) {
    case 'pass':
      return 200;
    case 'warn':
      return 207;
    case 'fail':
      return 503;
    default:
      throw stl.absurd(status);
  }
}
