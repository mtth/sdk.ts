import Router from '@koa/router';
import sdkMetrics from '@opentelemetry/sdk-metrics';
import * as stl from '@opvious/stl';
import Koa from 'koa';
import compose from 'koa-compose';

import {packageInfo, StandardEndpoints} from './common.js';

/**
 * Returns a middleware which adds a metrics endpoint exposing all defined
 * metrics.
 */
export function exposeMetrics(args: {
  readonly telemetry: stl.Telemetry;
  readonly reader: sdkMetrics.MetricReader;
  readonly serializer: (rm: sdkMetrics.ResourceMetrics) => string;
}): Koa.Middleware {
  const router = createRouter(args);
  return compose([router.allowedMethods(), router.routes()]);
}

/** Returns a router which can export metrics. */
function createRouter(
  args: Parameters<typeof exposeMetrics>[0]
): Router<any, any> {
  const {reader, serializer} = args;
  const {logger: log} = args.telemetry.via(packageInfo);
  return new Router().get(StandardEndpoints.METRICS, async (ctx) => {
    const {resourceMetrics, errors} = await reader.collect();
    if (errors.length) {
      log.warn({data: {errors}}, 'Received errors while collecting metrics.');
    }
    ctx.type = 'text/plain';
    ctx.body = serializer(resourceMetrics);
    log.info(
      'Collected metrics. [count=%s]',
      resourceMetrics.scopeMetrics.length
    );
  });
}
