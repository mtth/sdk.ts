import {
  assert,
  extractStatusError,
  Failure,
  failure,
  isInternalProblem,
  isStandardError,
  StandardError,
  statusFromHttpCode,
  statusToHttpCode,
} from '@mtth/stl-errors';
import {
  instrumentsFor,
  LogValues,
  recordErrorOnSpan,
  settingLogLevel,
  Telemetry,
} from '@mtth/stl-telemetry';
import {please} from '@mtth/stl-utils/strings';
import * as otel from '@opentelemetry/api';
import core from '@opentelemetry/core';
import http from 'http';
import Koa from 'koa';
import {DateTime} from 'luxon';
import net from 'net';
import stream from 'stream';

import {
  MimeTypes,
  OtelAttr,
  packageInfo,
  ROUTE_CONTEXT_KEY,
  StandardEndpoints,
} from '../common.js';
import {extractConnectingIp, setConnectingIp} from './connecting-ip.js';
import {FailureAnnotator, FailurePropagator} from './failures.js';
import {requestOptions} from './options.js';

export * from './connecting-ip.js';
export * from './failures.js';

const instruments = instrumentsFor({
  abortedRequests: {
    name: 'http.server.aborted_requests',
    kind: 'counter',
    unit: '{requests}',
    labels: {
      code: OtelAttr.STATUS_CODE,
      method: OtelAttr.METHOD,
      target: OtelAttr.TARGET,
    },
  },
  activeRequests: {
    name: 'http.server.active_requests',
    kind: 'upDownCounter',
    unit: '{requests}',
    labels: {
      method: OtelAttr.METHOD,
    },
  },
  requestDuration: {
    name: 'http.server.duration',
    kind: 'histogram',
    unit: 'ms',
    labels: {
      code: OtelAttr.STATUS_CODE,
      method: OtelAttr.METHOD,
      target: OtelAttr.TARGET,
    },
  },
});

// Response header containing the trace ID.
export const TRACE_HEADER = 'mtth-trace';

const DEFAULT_UNKNOWN_ERROR_REMEDIATION = 'try again later';

/**
 * Returns a new Koa middleware which sets up request handling. More
 * specifically, it performs the following actions:
 *
 * + Normalizes errors and sanitizes them before returning data to the client,
 * + Logs various lifecycle events,
 * + Wraps each request call in a new span.
 */
export function setup<S = any>(args: {
  /** Telemetry instance to report internal metrics. */
  readonly telemetry: Telemetry;
  /**
   * Custom route matcher to use in addition with the standard koa-router based
   * one. The returned route is useful for telemetry (for example as `target`
   * label in the server metrics). Note that the returned values must be
   * guaranteed to have low cardinality.
   *
   * The root path and `StandardEndpoint` values are always matched.
   */
  readonly routeMatchers?: ReadonlyArray<RouteMatcher<S>>;
  /**
   * Propagators called when a failure with a given error code was detected. All
   * propagator codes must be unique.
   */
  readonly failurePropagators?: ReadonlyArray<FailurePropagator<any>>;
  /**
   * Annotators used to add information to failure messages, for example to
   * include remediation actions.
   */
  readonly failureAnnotators?: ReadonlyArray<FailureAnnotator>;
  /**
   * Remediation used to annotate unknown failures. This is only used if the
   * error doesn't have an annotation from one of the `failureAnnotators`.
   */
  readonly unknownErrorRemediation?: string | false;
  /**
   * Client IP extractor. Each request's client IP will be available via
   * `activeConnectingIp`. By default this is read from the
   * `CONNECTING_IP_HEADER`.
   */
  readonly connectingIp?: (ctx: Koa.Context) => string | undefined;
}): Koa.Middleware<S> {
  const tel = args.telemetry.via(packageInfo);
  const {logger} = tel;
  const [metrics] = tel.metrics(instruments);

  const propagators = new Map<string, FailurePropagator>();
  for (const p of args.failurePropagators ?? []) {
    assert(!propagators.has(p.code), 'Duplicate propagator: %s', p.code);
    propagators.set(p.code, p);
  }

  const annotators = args.failureAnnotators ?? [];
  const connectingIp = args.connectingIp ?? extractConnectingIp;
  const unknownErrorRemediation =
    (args.unknownErrorRemediation ?? DEFAULT_UNKNOWN_ERROR_REMEDIATION) || '';
  const {routeMatchers: matchers} = args;
  const sockets = new WeakSet<net.Socket>();

  return async (ctx, next) => {
    const {method} = ctx;
    const startedAt = DateTime.now();
    let target = '';
    metrics.activeRequests.add(1, {method});

    const ac = new AbortController();
    const ropts = requestOptions(ctx.headers);
    return withServerSpan(tel, ac.signal, ctx, connectingIp, async (ra) => {
      const {span} = ra;
      const sctx = span.spanContext();
      if (otel.isSpanContextValid(sctx)) {
        setSpanRequestAttributes(span, ctx.req);
        ctx.set(TRACE_HEADER, sctx.traceId);
      }
      if (ropts.debug) {
        sctx.traceState = settingLogLevel(
          sctx.traceState ?? new core.TraceState(),
          'debug'
        );
      }

      let clog = logger.child({ctx: span.spanContext()});
      const sock = ctx.req.socket;
      if (!sockets.has(sock)) {
        sockets.add(sock);
        sock.removeAllListeners('error').on('error', (err) => {
          logger.warn({err}, 'Request socket errored.');
        });
      }

      const {req, res} = ctx;
      req.once('close', () => {
        if (req.complete) {
          span.addEvent('request closed');
          clog.debug('Request closed after completion.');
        } else {
          span.addEvent('request aborted');
          clog.info('Request aborted before completion.');
          req
            .unpipe()
            .resume()
            .once('end', () => {
              clog.info('Aborted request consumed.');
            });
          ac.abort();
        }
      });
      res.once('close', () => {
        metrics.activeRequests.add(-1, {method});
        const labels = {method, target, code: res.statusCode};
        if (res.writableFinished) {
          clog.debug('Response closed after completion.');
          metrics.requestDuration.record(-startedAt.diffNow(), labels);
        } else {
          clog.info('Response aborted before completion.');
          metrics.abortedRequests.add(1, labels);
          ac.abort();
        }
      });
      if (clog.isLevelEnabled('trace')) {
        req.once('end', () => {
          clog.trace('Request ended.');
        });
        res.once('finish', () => {
          clog.trace('Response finished.');
        });
      }

      clog.info(
        {data: {req: ctx.request}},
        'Handling Koa request... [method=%s, path=%j]',
        method,
        ctx.path
      );
      const logv: LogValues = Object.create(null);
      try {
        await next();
      } catch (err) {
        logv.err = err;
        recordErrorOnSpan(err, span);
      }

      // We delay this step until after the handler has run since we need
      // koa-router to have populated the context.
      target = inferTarget(ctx, matchers);
      if (target) {
        span.updateName(serverSpanName(ctx.method, target));
      }

      if (ra.state.isLost()) {
        clog.info(logv, 'Aborting abandoned Koa handler.');
        return;
      }

      let fl: Failure | undefined;
      if (logv.err) {
        const serr = extractStatusError(logv.err);
        ctx.set('mtth-error-status', serr.status);

        let cerr: StandardError | undefined;
        let annotations: ReadonlyArray<string> | undefined;
        if (isStandardError(serr.contents)) {
          cerr = serr.contents;
          if (!isInternalProblem(serr.status)) {
            ctx.set('mtth-error-code', cerr.code);
          }
          const vals = await Promise.all(annotators.map((a) => a(serr as any)));
          annotations = vals.filter((v) => v);
        }
        if (
          !annotations?.length &&
          serr.status === 'UNKNOWN' &&
          unknownErrorRemediation
        ) {
          annotations = [please(unknownErrorRemediation)];
        }

        fl = failure(serr, {annotations});
        if (cerr) {
          const propagator = propagators.get(cerr.code);
          propagator?.propagate(fl, ctx, cerr.tags);
        }

        if (
          ctx.accepts([MimeTypes.PLAIN_TEXT, MimeTypes.JSON]) === MimeTypes.JSON
        ) {
          ctx.body = fl;
        } else {
          ctx.body = fl.error.message;
        }
        ctx.status = statusToHttpCode(fl.status);
      }
      logv.data = {res: ctx.response};

      if (!ctx.respond || ctx.body instanceof stream.Readable) {
        clog.debug('Streaming Koa response...');
        const streamingSpan = tel.startInactiveSpan({
          name: RESPONSE_STREAMING_SPAN_NAME,
        });
        clog = clog.child({ctx: streamingSpan.spanContext()});
        res.once('close', () => {
          const status = res.statusCode;
          const ok = res.writableFinished && status < 500;
          const latencyMillis = -startedAt.diffNow();
          if (ok) {
            clog.info(
              logv,
              'Streamed Koa response for request. [status=%s, ms=%s]',
              status,
              latencyMillis
            );
          } else {
            clog.error(
              logv,
              'Failed to stream response for request. [status=%s, ms=%s, finished=%s]',
              status,
              latencyMillis,
              res.writableFinished
            );
          }
          setSpanResponseAttributes(streamingSpan, res);
          streamingSpan.setStatus({
            code: ok ? otel.SpanStatusCode.OK : otel.SpanStatusCode.ERROR,
          });
          streamingSpan.end();
        });
        return;
      }

      setSpanResponseAttributes(span, res);
      const status = statusFromHttpCode(ctx.status);
      const latencyMillis = -startedAt.diffNow();
      if (ctx.status < 500) {
        clog.info(
          logv,
          'Handled request. [status=%s, ms=%s]',
          status,
          latencyMillis
        );
        span.setStatus({code: otel.SpanStatusCode.OK});
      } else {
        // If no failure exists, the error had already converted to a response
        // and presumably logged there at error level with full details.
        clog[fl ? 'error' : 'info'](
          logv,
          'Failed to handle request. [status=%s, ms=%s]',
          status,
          latencyMillis
        );
        span.setStatus({
          message: fl?.error.message,
          code: otel.SpanStatusCode.ERROR,
        });
      }
    });
  };
}

/** The first matcher returning a string (even empty) will be used. */
export type RouteMatcher<S = any> = (
  ctx: Koa.ParameterizedContext<S>
) => string | undefined;

/**
 * Paths ending in `/` are treated as prefixes. For example `/_next/` will match
 * all paths starting with `/_next/` (and be mapped to `/_next/...`) while
 * `/api/graphql` will only match that route. Paths are checked in order, the
 * first match will be used.
 */
export function staticRouteMatcher(paths: ReadonlyArray<string>): RouteMatcher {
  return (ctx) => {
    const cand = ctx.path;
    for (const p of paths) {
      if (p.endsWith('/')) {
        if (cand.startsWith(p)) {
          return p + '...';
        }
      } else {
        if (cand === p) {
          return p;
        }
      }
    }
    return undefined;
  };
}

const wellKnownPaths = new Set(['/', ...Object.values(StandardEndpoints)]);

function inferTarget(
  ctx: Koa.ParameterizedContext,
  matchers: ReadonlyArray<RouteMatcher> | undefined
): string {
  if (wellKnownPaths.has(ctx.path)) {
    return ctx.path;
  }
  let ret = ctx[ROUTE_CONTEXT_KEY];
  if (ret == null && matchers) {
    for (const matcher of matchers) {
      ret = matcher(ctx);
      if (ret != null) {
        break;
      }
    }
  }
  return ret ?? '';
}

const SPAN_NAME_PREFIX = 'Koa';

const RESPONSE_STREAMING_SPAN_NAME = 'Koa stream response';

function serverSpanName(meth: string, route?: string): string {
  return route
    ? `${SPAN_NAME_PREFIX} ${meth} ${route}`
    : `${SPAN_NAME_PREFIX} ${meth}`;
}

const spanOptions: otel.SpanOptions = {kind: otel.SpanKind.SERVER};

function setSpanRequestAttributes(
  span: otel.Span,
  req: http.IncomingMessage
): void {
  span.setAttributes({
    [OtelAttr.METHOD]: req.method,
    [OtelAttr.REQUEST_CONTENT_ENCODING]: req.headers['content-encoding'],
    [OtelAttr.REQUEST_CONTENT_TYPE]: req.headers['content-type'],
    [OtelAttr.REQUEST_LENGTH]: req.headers['content-length'],
    [OtelAttr.URL]: req.url,
  });
}

function setSpanResponseAttributes(
  span: otel.Span,
  res: http.ServerResponse
): void {
  span.setAttributes({
    [OtelAttr.RESPONSE_CONTENT_ENCODING]: res.getHeader('content-encoding'),
    [OtelAttr.RESPONSE_CONTENT_TYPE]: res.getHeader('content-type'),
    [OtelAttr.STATUS_CODE]: res.statusCode,
  });
}

/**
 * Runs a handler with a new server span. The span inherits any context
 * extracted from the input headers. Note that the span needs to be ended
 * manually by the caller.
 */
function withServerSpan(
  telemetry: Telemetry,
  signal: AbortSignal,
  ctx: Koa.Context,
  connectingIp: (ctx: Koa.Context) => string | undefined,
  fn: (ra: ResilientAttempt) => Promise<void>
): Promise<void> {
  return resilient(serverSpanName(ctx.method), fn).run({
    telemetry,
    signals: [signal],
    context: setConnectingIp(
      otel.propagation.extract(otel.context.active(), ctx.headers),
      connectingIp(ctx)
    ),
    spanOptions,
  });
}
