import * as otel from '@opentelemetry/api';
import {assert, errorMessage} from '@mtth/stl-errors';
import {EventProducer} from '@mtth/stl-utils/events';
import {isIntensive} from '@mtth/stl-utils/intensive';
import {AsyncOrSync} from 'ts-essentials';

/**
 * Convenience function to record errors on a span. Non-error inputs are coerced
 * to string. Note that this function does not alter the status of the span.
 */
export function recordErrorOnSpan(err: unknown, span: otel.Span): void {
  if (err instanceof Error || typeof err == 'string') {
    span.recordException(err);
    return;
  }
  span.recordException(errorMessage(err) ?? '' + err);
}

export interface TracingListeners {
  readonly spanStart: (name: string) => void;
  readonly activeSpanEnd: (name: string, millis: number) => void;
}

export function startInactiveSpan(
  tracer: otel.Tracer,
  emitter: EventProducer<TracingListeners>,
  params: StartInactiveSpanParams
): otel.Span {
  const {name, options, context} = params;
  const ctx = context ?? otel.context.active();
  emitter.emit('spanStart', name);
  return tracer.startSpan(params.name, options ?? {}, ctx);
}

export interface StartInactiveSpanParams {
  /** The name of the span. */
  readonly name: string;

  /** Span creation options. */
  readonly options?: otel.SpanOptions;

  /** Parent context, defaults to the currently active one. */
  readonly context?: otel.Context;
}

// Lateness over which a breath span event will be recorded. This number is
// computed so that the late threshold with the standard breath interval (200ms)
// match the event-loop warn health status (250ms).
const BREATH_LATENESS_THRESHOLD = 0.25;

/**
 * Creates a new active span wrapping the execution of the input function. Both
 * promise and non-promise return values are supported. `Intensive` instances
 * are also handled appropriately.
 */
export function withActiveSpan<V>(
  tracer: otel.Tracer,
  emitter: EventProducer<TracingListeners>,
  params: WithActiveSpanParams,
  fn: (span: otel.Span, bind: BindActiveSpan) => V
): V {
  const {name, options, context, skipOkStatus, dynamicIntensiveSpanContext} =
    params;
  const opts = options ?? {};
  const ctx = context ?? otel.context.active();

  const startTs = Date.now();
  emitter.emit('spanStart', name);
  const emitEnd = (): void => {
    emitter.emit('activeSpanEnd', name, Date.now() - startTs);
  };

  return tracer.startActiveSpan(name, opts, ctx, (span) => {
    const sctx = otel.context.active();
    let pending = 1;
    let errored = false;
    let target: any;
    try {
      target = fn(span, bindingContext);
    } catch (err) {
      completePending(err);
      throw err;
    }
    if (!span.isRecording()) {
      return target;
    }
    if (!isPromise(target)) {
      return settingUpEvents(target);
    }
    return target
      .then((ret) => settingUpEvents(ret))
      .catch((err) => {
        completePending(err);
        throw err;
      });

    function completePending(err?: unknown): void {
      if (err) {
        recordErrorOnSpan(err, span);
        errored = true;
      }
      if (--pending > 0) {
        return;
      }
      if (errored) {
        span.setStatus({
          code: otel.SpanStatusCode.ERROR,
          // Use message from last completion, if any.
          message: err ? errorMessage(err) : undefined,
        });
      } else if (!skipOkStatus) {
        span.setStatus({code: otel.SpanStatusCode.OK});
      }
      emitEnd();
      span.end();
    }

    function bindingContext(arg1: any, arg2?: any): any {
      assert(pending++ > 0, 'Late binding');
      const self = arg2 == null ? undefined : arg1;
      const gen = arg2 ?? arg1;
      return {
        [Symbol.asyncIterator]: () => {
          const it = gen.call(self)[Symbol.asyncIterator]();
          const next = otel.context.bind(sctx, () => it.next());
          return {
            next: async () => {
              try {
                const res = await next();
                if (res.done) {
                  completePending();
                }
                return res;
              } catch (err) {
                completePending(err);
                throw err;
              }
            },
          };
        },
      };
    }

    function settingUpEvents(ret: any): any {
      if (!isIntensive(ret)) {
        completePending();
        return ret;
      }

      let maxIntervalMs = 0;
      let breaths = 0;
      let lateBreaths = 0;

      if (!dynamicIntensiveSpanContext) {
        ret.on(
          'run',
          (wrap) =>
            void wrap((iter) => ({
              [Symbol.iterator]: () => {
                const it = iter[Symbol.iterator]();
                return {next: otel.context.bind(sctx, () => it.next())};
              },
            }))
        );
      }

      return ret
        .on('start', () => {
          span.addEvent('intensive start');
        })
        .on('breath', (lateness, interval) => {
          if (lateness > BREATH_LATENESS_THRESHOLD) {
            span.addEvent('intensive late breath', {
              'breath.interval': interval,
              'breath.lateness': lateness,
            });
            lateBreaths++;
          }
          maxIntervalMs = Math.max(maxIntervalMs, interval);
          breaths++;
        })
        .on('end', (stats, err) => {
          const {yieldCount: yields, runtime} = stats;
          span.addEvent('intensive end', {
            'breaths.count': breaths,
            'breaths.density': yields > 0 ? breaths / yields : undefined,
            'breaths.interval.avg': runtime / (breaths + 1),
            'breaths.interval.max': breaths > 0 ? maxIntervalMs : runtime,
            'breaths.late.count': lateBreaths,
            'breaths.late.density':
              breaths > 0 ? lateBreaths / breaths : undefined,
            'yields.count': yields,
            'yields.interval.avg': runtime / (yields + 1),
          });
          completePending(err);
        });
    }
  });
}

export interface WithActiveSpanParams extends StartInactiveSpanParams {
  /** Do not set the span's status to OK on successful completion. */
  readonly skipOkStatus?: boolean;

  /**
   * When wrapping an `Intensive` instance, use the span context active at the
   * time its `run` or `runAsync` method is called. By default the span created
   * here is used instead. Enabling this option may improve performance but will
   * break parent-child relationships between intensive spans.
   */
  readonly dynamicIntensiveSpanContext?: boolean;
}

/**
 * Binds the current context to the async generator. The span will end once all
 * its bound generators are done. It is illegal to bind additional generators
 * after the span has ended.
 */
export interface BindActiveSpan {
  <V>(gen: () => AsyncIterable<V>): AsyncIterable<V>;
  <T, V>(self: T, gen: (this: T) => AsyncIterable<V>): AsyncIterable<V>;
}

function isPromise<V>(arg: AsyncOrSync<V>): arg is Promise<V> {
  return typeof (arg as any)?.then == 'function';
}
