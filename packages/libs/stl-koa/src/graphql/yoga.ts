import {
  AfterValidateHook,
  handleStreamOrSingleExecutionResult,
  OnExecuteDoneHookResult,
  OnExecuteHookResult,
  Plugin,
  useMaskedErrors,
} from '@envelop/core';
import Router from '@koa/router';
import * as otel from '@opentelemetry/api';
import * as stl from '@opvious/stl';
import {errorResult, standardizeGraphqlError} from '@opvious/stl-graphql';
import events from 'events';
import * as gql from 'graphql';
import {
  createSchema,
  createYoga,
  Plugin as YogaPlugin,
  YogaLogger,
  YogaServerInstance as YogaNodeServer,
  YogaServerOptions as YogaNodeConfig,
} from 'graphql-yoga';

export {Plugin as YogaPlugin} from 'graphql-yoga';

import {decompressedRequestBody, encodeResponseBody} from '../codecs.js';
import {packageInfo, StandardEndpoints} from '../common.js';
import {HEALTH_FAILURES_HEADER, HEALTH_STATUS_HEADER} from '../health.js';
import {inferHttpCode} from './common.js';

// Internal errors used only for logging (so we are not exporting them)
const [errors] = stl.errorFactories({
  definitions: {
    handlerErrored: (rawErr: unknown, attrErr?: unknown) => ({
      message: 'Handler errored when processing GraphQL request',
      tags: {attrErr, rawErr},
      cause: attrErr ?? rawErr,
    }),
    responseHasErrors: (
      errs: ReadonlyArray<gql.GraphQLError>,
      code?: number
    ) => ({
      message: `Response has ${errs.length} error(s)`,
      tags: {code, messages: errs.map((e) => e.message)},
      cause: errs,
      stackFrom: false,
    }),
  },
  prefix: 'ERR_GRAPHQL_SERVER_',
});

const SPAN_NAME = 'Yoga';

/**
 * Returns a router which handles GraphQL requests. Note that this router does
 * its own (optimized) body parsing and as such expects the body _not_ to be
 * decoded beforehand. It currently supports the following compression schemes,
 * specified via the `content-encoding` header: `br`, `gzip`, `identity`
 * (assumed if absent).
 */
// https://www.graphql-yoga.com/docs/integrations/integration-with-koa
export function standardYogaRouter<S extends YogaContext>(args: {
  readonly schema: gql.GraphQLSchema | Parameters<typeof createSchema>[0];

  /** Yoga server configuration. */
  readonly serverConfig?: StandardYogaServerConfig<S>;

  /** Telemetry. */
  readonly telemetry: stl.Telemetry;

  /** HTTP path under which to run the API. Defaults to `/graphql`. */
  readonly endpoint?: string;

  /**
   * Health checks to abort the request on if any fail. Adding at least one
   * check requires the `HEALTH_STATUS_HEADER` to be set to guarantee that the
   * they have already been run. For performance reasons we only check the
   * `HEALTH_FAILURES_HEADER` for matching keys (i.e. not by running the health
   * checks). Both headers are typically set by `exposeHealth`'s middleware.
   */
  readonly healthChecks?: ReadonlyArray<stl.HealthCheck>;

  /**
   * Mapping from error code to statuses, to wrap errors returned by the
   * server. This can be useful for example to add an invalid argument status
   * to invalid scalar errors.
   */
  readonly statuses?: Record<stl.ErrorCode, stl.ErrorStatus>;

  /** Size above which responses will be compressed. */
  readonly compressionThreshold?: number;

  /**
   * Exposes "pure" GraphQL errors (which do not have an original error) by:
   *
   * + keeping their original message;
   * + setting a 400 HTTP status code.
   *
   * This is useful to surface query validation errors for example. When using
   * schema stitching this is best enabled only on the gateway to avoid exposing
   * errors from internal executor calls or incorrectly setting their status.
   */
  readonly exposeGraphqlErrors?: boolean;
}): Router<S> {
  const {schema: schemaArg, serverConfig, statuses} = args;
  const endpoint = args.endpoint ?? StandardEndpoints.GRAPHQL;
  const tel = args.telemetry.via(packageInfo);
  const checkKeys = new Set(args.healthChecks?.map(stl.healthCheckKey));

  const server = standardYogaServer<S>({
    telemetry: tel,
    config: {
      schema:
        schemaArg instanceof gql.GraphQLSchema
          ? schemaArg
          : createSchema(schemaArg),
      ...serverConfig,
    },
    exposeGraphqlErrors: !!args.exposeGraphqlErrors,
    statuses,
  });

  const mw: Router.Middleware = async (ctx) => {
    if (checkKeys.size) {
      stl.assert(ctx.response.get(HEALTH_STATUS_HEADER), 'Missing health');
      const healthFailures = ctx.response.get(HEALTH_FAILURES_HEADER);
      if (healthFailures) {
        for (const key of healthFailures.split(' ')) {
          if (checkKeys.has(key)) {
            const err = stl.statusErrors.unavailable(stl.unhealthyError());
            ctx.body = errorResult([err]);
            return;
          }
        }
      }
    }

    const koaState = ctx.state;

    const spanParams = {name: SPAN_NAME, skipOkStatus: true};
    let res, rawErr;
    try {
      res = await tel.withActiveSpan(spanParams, async (span) => {
        initializeYogaCallAttrs(koaState, span);
        const body = decompressedRequestBody(ctx).on(
          events.errorMonitor,
          (err) => void setYogaCallAttr(ctx.state, ERROR_ATTR, err)
        );
        const {req, headers, method} = ctx;
        return await server.handleNodeRequest(
          {req, headers, method, body},
          koaState
        );
      });
    } catch (err) {
      rawErr = err;
    }
    const attrErr = getYogaCallAttr(koaState, ERROR_ATTR);
    const cause = attrErr ?? rawErr;
    if (cause) {
      const err = errors.handlerErrored(rawErr, attrErr);
      const status = stl.deriveStatus(cause);
      tel.logger[stl.isServerProblem(status) ? 'error' : 'info'](
        {err, data: {status, res}},
        'Yoga server errored with status %s.',
        status
      );
      res = {headers: [], body: errorResult([cause])};
    }
    stl.assert(res, 'Missing response');

    // We always return status 200 for responses in GraphQL format. This allows
    // the use of the standard JSON error schema for external error responses
    // (e.g. authentication issues or rate limiting).
    for (const [key, value] of res.headers) {
      ctx.append(key, value);
    }
    if (res.status === 415) {
      ctx.status = res.status;
    } else {
      ctx.body = res.body;
    }
  };

  const router = new Router().post(
    endpoint,
    encodeResponseBody({threshold: args.compressionThreshold}),
    mw
  );
  if (serverConfig?.graphiql) {
    router.get(endpoint, mw);
  }
  return router;
}

export type KoaState = any;
type YogaContext = Record<string, any>;
type YogaServer<S extends YogaContext> = YogaNodeServer<S, KoaState>;
type YogaServerConfig<S extends YogaContext> = YogaNodeConfig<S, KoaState>;

// Unique key used to store request-specific attributes.
const ATTRS_STATE_KEY = packageInfo.name + ':yogaState';

interface YogaCallAttrs {
  readonly span: otel.Span;
  [key: string | symbol]: unknown;
}

export function initializeYogaCallAttrs(ks: KoaState, span: otel.Span): void {
  ks[ATTRS_STATE_KEY] = {span};
}

function yogaCallAttrs(ks: KoaState): YogaCallAttrs {
  const state = ks[ATTRS_STATE_KEY];
  stl.assert(state, 'Invalid Koa state %j', state);
  return state;
}

/** Returns `undefined` if the Yoga call state has not been initialized. */
export function tryGetYogaCallAttr(
  ks: KoaState,
  key: string | symbol
): unknown {
  return ks[ATTRS_STATE_KEY]?.[key];
}

/** Throws if Yoga call state has not been initialized. */
export function getYogaCallAttr(ks: KoaState, key: string | symbol): unknown {
  return yogaCallAttrs(ks)[key];
}

export function setYogaCallAttr(
  ks: KoaState,
  key: string | symbol,
  val: unknown
): void {
  const state = yogaCallAttrs(ks);
  state[key] = val;
}

/**
 * Utility for aborting a Yoga call, typically from a plugin's `onExecute` hook.
 *
 *    const {args, setResultAndStopExecution} = params;
 *    // ...
 *    abortCall(
 *      stl.statusErrors.unauthenticated(err),
 *      args.contextValue,
 *      setResultAndStopExecution
 *    );
 */
export function abortYogaCall(
  err: unknown,
  fn: (res: gql.ExecutionResult) => void
): void {
  fn(errorResult([err]));
}

// State key used to store an eventual error instance for the request.
const ERROR_ATTR = Symbol.for('@opvious/stl-koa:yogaError+v1');

export type StandardYogaServerConfig<S extends YogaContext> = Omit<
  YogaServerConfig<S>,
  'schema' | 'cors' | 'logging' | 'maskedErrors'
>;

function standardYogaServer<S extends YogaContext>(args: {
  readonly telemetry: stl.Telemetry;
  readonly config: YogaServerConfig<S>;
  readonly exposeGraphqlErrors: boolean;
  readonly statuses?: Record<stl.ErrorCode, stl.ErrorStatus>;
}): YogaServer<S> {
  const {telemetry, config: cfg, exposeGraphqlErrors, statuses} = args;
  const keepGraphqlMessages = exposeGraphqlErrors ?? stl.running.inTest();
  const plugins: YogaPlugin[] = [
    useMaskedErrors({
      maskError: (err) =>
        standardizeGraphqlError(err, {keepGraphqlMessages, statuses}),
    }),
  ];
  if (cfg.plugins) {
    plugins.push(...cfg.plugins);
  }
  plugins.push(standardPlugin({telemetry, exposeGraphqlErrors}));
  stl.assert(
    !stl.running.inProduction() || !cfg.graphiql,
    'GraphIQL cannot be enabled in production'
  );
  return createYoga({
    ...cfg,
    context: async (ks: KoaState) => {
      try {
        return cfg.context ? await cfg.context(ks) : ks;
      } catch (err) {
        // We manually forward these errors to avoid them getting censored
        // before we are able to access them.
        setYogaCallAttr(ks, ERROR_ATTR, err);
        throw err;
      }
    },
    cors: false, // Needs to be set upstream (at Koa level) anyway.
    graphiql: !!cfg.graphiql,
    maskedErrors: false,
    plugins,
    logging: yogaLogger(telemetry.logger),
  });
}

function standardPlugin<S extends YogaContext>(args: {
  readonly telemetry: stl.Telemetry;
  readonly exposeGraphqlErrors: boolean;
}): Plugin<S> {
  const {telemetry, exposeGraphqlErrors} = args;
  const {logger: log} = telemetry;
  const keepGraphqlMessages = exposeGraphqlErrors ?? stl.running.inTest();
  return {
    onValidate(): AfterValidateHook<S> {
      return (p) => {
        const {span} = yogaCallAttrs(p.context);
        if (p.valid) {
          span.addEvent('validated');
          return;
        }
        const {result, setResult} = p;
        const errs = result.map((e) =>
          standardizeGraphqlError(e, {
            keepGraphqlMessages,
            extensionDefaults: {status: 'INVALID_ARGUMENT'},
          })
        );
        recordErrors(errs, span);
        log.info(
          {err: errors.responseHasErrors(errs)},
          'GraphQL request is invalid.'
        );
        setResult(errs);
      };
    },
    onExecute(o): OnExecuteHookResult<S> {
      const ctx = o.args.contextValue;
      const {span} = yogaCallAttrs(ctx);
      if (o.args.operationName) {
        span.setAttribute('graphql.operation', o.args.operationName);
      }
      span.addEvent('execute start');
      return {
        onExecuteDone(payload): OnExecuteDoneHookResult<S> | void {
          return handleStreamOrSingleExecutionResult(payload, (p) => {
            span.addEvent('execute end');
            const {result} = p;
            const code = inferHttpCode({
              result,
              pureGraphqlStatus: exposeGraphqlErrors
                ? 'INVALID_ARGUMENT'
                : undefined,
              telemetry,
            });
            let err: Error | undefined;
            if (result.errors?.length) {
              err = errors.responseHasErrors(result.errors, code);
              recordErrors(result.errors, span);
            }
            if (code < 500) {
              span.setStatus({code: otel.SpanStatusCode.OK});
              log.debug({err, data: {code}}, 'GraphQL execution completed.');
            } else {
              span.setStatus({
                code: otel.SpanStatusCode.ERROR,
                message: err?.message,
              });
              log.error({err, data: {code}}, 'GraphQL execution failed.');
            }
          });
        },
      };
    },
  };
}

function recordErrors(
  errs: ReadonlyArray<gql.GraphQLError>,
  span: otel.Span
): void {
  for (const err of errs) {
    span.recordException(err);
  }
}

/** Converts a standard logger into a Yoga compatible one. */
function yogaLogger(log: stl.Logger): YogaLogger {
  return {
    debug: (...args): void => {
      forwardLog(log, 'debug', ...args);
    },
    info: (...args): void => {
      forwardLog(log, 'info', ...args);
    },
    warn: (...args): void => {
      forwardLog(log, 'warn', ...args);
    },
    error: (...args): void => {
      forwardLog(log, 'error', ...args);
    },
  };
}

const LOG_PREFIX = 'yoga log';

function forwardLog(log: stl.Logger, lvl: stl.LogLevel, ...args: any[]): void {
  if (!log.isLevelEnabled(lvl)) {
    return;
  }
  const [msg, arg, ...rest] = args;
  if (
    typeof msg != 'string' ||
    (arg && typeof arg != 'object') ||
    rest.length
  ) {
    log[lvl]({data: {args: stl.contained(args)}}, LOG_PREFIX + '.');
    return;
  }
  log[lvl](
    {data: {arg: stl.contained(arg)}},
    LOG_PREFIX + ': ' + msg.trimStart()
  );
}
