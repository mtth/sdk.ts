import * as otel from '@opentelemetry/api';
import {EventProducer, typedEmitter} from '@mtth/stl-utils/events';

import {LibInfo} from './common.js';
import {
  Logger,
  LoggerOptions,
  LoggerProvider,
  LoggingListeners,
  LogRecord,
  logThresholder,
  noopLogger,
  recordingDestination,
} from './logging/index.js';
import {
  Instruments,
  MetricLoader,
  MetricsFor,
  MetricsListeners,
  NoopMeterProvider,
  OnMetricCollection,
} from './metrics.js';
import {
  BindActiveSpan,
  RecordingTracer,
  SpanRecord,
  startInactiveSpan,
  StartInactiveSpanParams,
  TracingListeners,
  withActiveSpan,
  WithActiveSpanParams,
} from './tracing/index.js';

export interface Telemetry {
  readonly logger: Logger;

  /** Starts a new span that is not activated on the current context. */
  startInactiveSpan(params: StartInactiveSpanParams): otel.Span;

  /**
   * Creates a new active span wrapping the execution of the input function.
   * Both promise and non-promise return values are supported.
   */
  withActiveSpan<V>(
    params: WithActiveSpanParams,
    fn: (span: otel.Span, bind: BindActiveSpan) => V
  ): V;

  /**
   * Returns type-safe metrics corresponding to the input instruments. Metrics
   * will be cached for later calls (names across differing instruments must be
   * unique).
   */
  metrics<I extends Instruments>(
    instrs: I
  ): [MetricsFor<I>, OnMetricCollection];

  /** Returns a telemetry instance scoped to the input library. */
  via(lib: LibInfo): Telemetry;
}

export abstract class InstrumentableTelemetry implements Telemetry {
  #logger: Logger | undefined;
  #tracer: otel.Tracer | undefined;
  protected constructor(
    protected readonly emitter: EventProducer<TelemetryListeners>,
    protected readonly metricLoader: MetricLoader,
    protected readonly loggerProvider: LoggerProvider,
    protected readonly tracerProvider: otel.TracerProvider,
    protected readonly lib: LibInfo
  ) {}

  protected abstract clone(lib: LibInfo): Telemetry;

  get logger(): Logger {
    if (!this.#logger) {
      this.#logger = this.loggerProvider.logger(this.lib);
    }
    return this.#logger;
  }

  private get tracer(): otel.Tracer {
    if (!this.#tracer) {
      const {lib, tracerProvider} = this;
      this.#tracer = tracerProvider.getTracer(lib.name, lib?.version);
    }
    return this.#tracer;
  }

  startInactiveSpan(params: StartInactiveSpanParams): otel.Span {
    return startInactiveSpan(this.tracer, this.emitter, params);
  }

  withActiveSpan<V>(
    params: WithActiveSpanParams,
    fn: (span: otel.Span, bind: BindActiveSpan) => V
  ): V {
    return withActiveSpan(this.tracer, this.emitter, params, fn);
  }

  metrics<I extends Instruments>(
    instrs: I
  ): [MetricsFor<I>, OnMetricCollection] {
    return this.metricLoader.load(this.lib, instrs);
  }

  via(lib: LibInfo): Telemetry {
    return lib === this.lib ? this : this.clone(lib);
  }

  async shutdown(): Promise<void> {
    this.emitter.emit('shutdown');
    this.loggerProvider.flush();
  }
}

export interface TelemetryListeners
  extends LoggingListeners,
    MetricsListeners,
    TracingListeners {
  /** Emitted when telemetry `.shutdown()` is called. */
  shutdown: () => void;
}

/** Returns a telemetry instance which discards all data. */
export function noopTelemetry(): Telemetry {
  return new NoopTelemetry();
}

class NoopTelemetry implements Telemetry {
  readonly logger = noopLogger();
  private readonly emitter = typedEmitter<TelemetryListeners>();
  private readonly tracer = noopTracer();
  private readonly metricLoader: MetricLoader;
  constructor() {
    this.metricLoader = new MetricLoader(this.emitter, new NoopMeterProvider());
  }

  startInactiveSpan(params: StartInactiveSpanParams): otel.Span {
    return startInactiveSpan(this.tracer, this.emitter, params);
  }

  withActiveSpan<V>(
    params: WithActiveSpanParams,
    fn: (span: otel.Span, bind: BindActiveSpan) => V
  ): V {
    return withActiveSpan(this.tracer, this.emitter, params, fn);
  }

  metrics<I extends Instruments>(
    instrs: I
  ): [MetricsFor<I>, OnMetricCollection] {
    return this.metricLoader.load({name: 'noop'}, instrs);
  }

  via(): this {
    return this;
  }

  logging(): this {
    return this;
  }
}

function noopTracer(): otel.Tracer {
  const provider = new otel.ProxyTracerProvider();
  return provider.getTracer('noop');
}

/**
 * A telemetry instance which records logs and spans (not metrics
 * currently). This can be useful in tests.
 */
export class RecordingTelemetry implements Telemetry {
  #logger: Logger | undefined;
  private readonly emitter = typedEmitter<TelemetryListeners>();
  private readonly metricLoader: MetricLoader;
  private constructor(
    private readonly loggerProvider: LoggerProvider,
    private readonly lib: LibInfo,
    private readonly mutableLogRecords: LogRecord[],
    private readonly tracer: RecordingTracer
  ) {
    this.metricLoader = new MetricLoader(this.emitter, new NoopMeterProvider());
  }

  /**
   * Returns a new telemetry instance which both records and outputs logs and
   * spans. The first input spec can used to generate a first filter for log
   * messages (messages which do not meet it are neither recorded nor output). A
   * secondary filter derived from the environment is applied to decide which of
   * those messages to also output.
   */
  static forTesting(
    lib?: LibInfo,
    spec?: string,
    opts?: LoggerOptions
  ): RecordingTelemetry {
    const logRecords: LogRecord[] = [];
    lib = lib ?? {name: 'test'};
    return new RecordingTelemetry(
      LoggerProvider.create({
        thresholder: logThresholder(spec),
        emitter: typedEmitter(),
        options: {
          ...opts,
          destination: recordingDestination({
            into: logRecords,
            thresholder: logThresholder(),
            destination: opts?.destination,
          }),
        },
      }),
      lib,
      logRecords,
      RecordingTracer.create(lib)
    );
  }

  /** Clears all recorded data. */
  reset(): void {
    this.mutableLogRecords.length = 0;
    this.tracer.reset();
  }

  // Logging

  get logger(): Logger {
    if (!this.#logger) {
      this.#logger = this.loggerProvider.logger(this.lib);
    }
    return this.#logger;
  }

  /**
   * The recorded messages. Note that these log messages are not decorated (e.g.
   * with library or operation information). They contain the raw arguments
   * given to at the log call-site.
   */
  get logRecords(): ReadonlyArray<LogRecord> {
    return this.mutableLogRecords;
  }

  // Tracing

  startInactiveSpan(params: StartInactiveSpanParams): otel.Span {
    return startInactiveSpan(this.tracer, this.emitter, params);
  }

  withActiveSpan<V>(
    params: WithActiveSpanParams,
    fn: (span: otel.Span, bind: BindActiveSpan) => V
  ): V {
    return withActiveSpan(this.tracer, this.emitter, params, fn);
  }

  waitForPendingSpans(): Promise<void> {
    return this.tracer.waitForPendingSpans();
  }

  /** The recorded spans. Spans are added in the order they are created. */
  get spanRecords(): ReadonlyArray<SpanRecord> {
    return this.tracer.records;
  }

  // Metrics

  metrics<I extends Instruments>(
    instrs: I
  ): [MetricsFor<I>, OnMetricCollection] {
    return this.metricLoader.load(this.lib, instrs);
  }

  // Global

  via(lib: LibInfo): Telemetry {
    return new RecordingTelemetry(
      this.loggerProvider,
      lib,
      this.mutableLogRecords,
      this.tracer
    );
  }
}
