import {errorFactories, ErrorTagsFor, StandardError} from '@mtth/stl-errors';

import {HealthCheckReport, HealthCheckReports} from './common.js';

export * from './common.js';
export {eventLoopHealthChecks} from './event-loop.js';

const [errors, codes] = errorFactories({
  definitions: {
    unhealthy: (
      failures: ReadonlyArray<HealthCheckReport>,
      warnings: ReadonlyArray<HealthCheckReport>
    ) => ({
      message: `${failures.length} health check(s) failed`,
      tags: {failures, warnings},
    }),
  },
});

export const healthErrorCodes = codes;

export type UnhealthyError = StandardError<
  ErrorTagsFor<typeof codes.Unhealthy>
>;

/**
 * Returns an unhealth error. Any warning and failure reports will be added as
 * tags.
 */
export function unhealthyError(reports?: HealthCheckReports): UnhealthyError {
  return errors.unhealthy(reports?.fail ?? [], reports?.warn ?? []);
}
