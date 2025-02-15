import * as otel from '@opentelemetry/api';
import {Level} from 'pino';

import {LevelNumber, levelNumber} from './common.js';

export function contextLogValues(ctx: otel.SpanContext): unknown {
  return ctx && otel.trace.isSpanContextValid(ctx)
    ? {t: ctx.traceId, s: ctx.spanId}
    : undefined;
}

// Key used to store log level within the trace state.
const LOG_LEVEL_TRACE_STATE_KEY = 'opv.ll';

/**
 * Returns the currently (or from the input context) active log leven number, if
 * any. This function requires trace context propagation to be enabled.
 */
export function activeLevelNumber(
  ctx: otel.SpanContext
): LevelNumber | undefined {
  const val = ctx.traceState?.get(LOG_LEVEL_TRACE_STATE_KEY);
  return val == null ? undefined : +val;
}

/**
 * Returns a new trace state with the operation verbosity set to the given
 * value. Note that spans may be missing a state initially. In this case, you
 * can call this method as follows:
 *
 *  ```ts
 *  import core from '@opentelemetry/core';
 *
 *  // ...
 *
 *  const ctx = span.spanContext();
 *  ctx.traceState = settingOperationVerbosity(
 *    ctx.traceState ?? new core.TraceState(),
 *    OperationVerbosity.DEBUG
 *  );
 *  ```
 */
export function settingLogLevel(
  state: otel.TraceState,
  lvl: Level
): otel.TraceState {
  return state.set(LOG_LEVEL_TRACE_STATE_KEY, '' + levelNumber(lvl));
}
