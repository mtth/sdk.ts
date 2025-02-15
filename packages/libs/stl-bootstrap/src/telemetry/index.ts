import {assert} from '@mtth/stl-errors';
import {
  InstrumentableTelemetry,
  LibInfo,
  LoggerOptions,
  LoggerProvider,
  logThresholder,
  MetricLoader,
  TelemetryListeners,
} from '@mtth/stl-telemetry';
import {EventProducer, typedEmitter} from '@mtth/stl-utils/events';
import {ifPresent} from '@mtth/stl-utils/functions';
import * as otel from '@opentelemetry/api';
import contextAsyncHooks from '@opentelemetry/context-async-hooks';
import core from '@opentelemetry/core';
import exporterMetricsOtlpHttp from '@opentelemetry/exporter-metrics-otlp-http';
import exporterTraceOtlpHttp from '@opentelemetry/exporter-trace-otlp-http';
import resources from '@opentelemetry/resources';
import sdkMetrics from '@opentelemetry/sdk-metrics';
import sdkTraceBase from '@opentelemetry/sdk-trace-base';
import sdkTraceNode from '@opentelemetry/sdk-trace-node';

import {packageInfo} from '../common.js';
import {appMatchesService, appResourceAttrs} from './common.js';
import {forwardTelemetryMetrics} from './metrics.js';

export {
  PrometheusMetricsReader,
  prometheusMetricsSerializer,
} from './metrics.js';

/**
 * Environment variables pointing to the OTel collector.
 * https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/exporter.md
 */
const EXPORTER_EVAR = 'OTEL_EXPORTER_OTLP_ENDPOINT';
const METRICS_EXPORTER_EVAR = 'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT';
const TRACES_EXPORTER_EVAR = 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT';

/**
 * This function returns true iff one of the metrics-related OTel collector
 * endpoint evars is set.
 */
export function isOtelMetricsExporterAvailable(): boolean {
  return !!(process.env[EXPORTER_EVAR] || process.env[METRICS_EXPORTER_EVAR]);
}

/**
 * This function returns true iff one of the tracing-related OTel collector
 * endpoint evars is set.
 */
export function isOtelTracesExporterAvailable(): boolean {
  return !!(process.env[EXPORTER_EVAR] || process.env[TRACES_EXPORTER_EVAR]);
}

/**
 * Enables context propagation process-wide, allowing active operations
 * tracking. This operation is idempotent.
 */
export function enableContextPropagation(): void {
  if (global.__contextPropagationEnabled) {
    return;
  }

  // The implementation here mimics what registering a `NodeTracerProvider`
  // does. Isolating these steps allows us to support context propagation while
  // having multiple providers (with potentially different resource attributes,
  // each within an `AppTelemetry`).
  const manager = new contextAsyncHooks.AsyncLocalStorageContextManager();
  manager.enable();
  otel.context.setGlobalContextManager(manager);
  const propagator = new core.CompositePropagator({
    propagators: [
      new core.W3CBaggagePropagator(),
      new core.W3CTraceContextPropagator(),
    ],
  });
  otel.propagation.setGlobalPropagator(propagator);

  global.__contextPropagationEnabled = true;
}

export class AppTelemetry extends InstrumentableTelemetry {
  private constructor(
    readonly app: LibInfo,
    emitter: EventProducer<TelemetryListeners>,
    metricLoader: MetricLoader,
    loggerProvider: LoggerProvider,
    tracerProvider: otel.TracerProvider,
    lib: LibInfo,
    private readonly meterProvider: sdkMetrics.MeterProvider,
    private readonly spanExporter: sdkTraceBase.SpanExporter | undefined
  ) {
    super(emitter, metricLoader, loggerProvider, tracerProvider, lib);
  }

  /**
   * Returns a telemetry instance for an application. This function also
   * automatically enables context propagation. A process `SIGTERM` handler is
   * added to shut collection down.
   *
   * This function should only be called in application code, and never in
   * libraries. Instead use `StandardTelemetry.forTesting` in tests and
   * `noopTelemetry` otherwise.
   */
  static create(app: LibInfo, opts?: AppTelemetryOptions): AppTelemetry {
    enableContextPropagation();

    const resAttrs = appResourceAttrs(app);
    const isMain = appMatchesService(app, resAttrs);
    const res = new resources.Resource({...resAttrs, ...opts?.attrs});
    const ee = typedEmitter<TelemetryListeners>();
    ifPresent(opts?.onShutdown, (fn) => void ee.on('shutdown', fn));

    // Logging
    const loggerProvider = LoggerProvider.create({
      thresholder: logThresholder(),
      emitter: ee,
      options: {
        ...opts?.loggerOptions,
        base: {pid: process.pid, ...opts?.loggerOptions?.base},
        name: app.name,
        resource: resAttrs,
      },
    });
    const logger = loggerProvider.logger(packageInfo);

    // TODO: Logs exporter

    // Metrics
    const meterProvider = new sdkMetrics.MeterProvider({resource: res});
    for (const reader of opts?.metricsReaders ?? []) {
      meterProvider.addMetricReader(reader);
    }
    const hasMetricsExporter = isOtelMetricsExporterAvailable();
    const exportMetrics = opts?.exportMetrics ?? (isMain && hasMetricsExporter);
    if (exportMetrics) {
      assert(hasMetricsExporter, 'Missing metrics exporter');
      const exporter = new exporterMetricsOtlpHttp.OTLPMetricExporter();
      meterProvider.addMetricReader(
        new sdkMetrics.PeriodicExportingMetricReader({exporter})
      );
    }

    // Tracing
    const tracerProvider = new sdkTraceNode.NodeTracerProvider({resource: res});
    const hasTracesExporter = isOtelTracesExporterAvailable();
    const exportTraces = opts?.exportTraces ?? (isMain && hasTracesExporter);
    let spanExporter;
    if (exportTraces) {
      assert(hasTracesExporter, 'Missing traces exporter');
      spanExporter = new exporterTraceOtlpHttp.OTLPTraceExporter();
      tracerProvider.addSpanProcessor(
        new sdkTraceBase.BatchSpanProcessor(spanExporter)
      );
      logger.trace('Started trace exporter.');
    } else {
      tracerProvider.addSpanProcessor(new sdkTraceBase.NoopSpanProcessor());
    }
    if (opts?.registerTraceProvider) {
      // We add explicit nulls here to prevent registration from overriding the
      // values set by `enableContextPropagation`.
      tracerProvider.register({contextManager: null, propagator: null});
    }

    const tel = new AppTelemetry(
      app,
      ee,
      new MetricLoader(ee, meterProvider),
      loggerProvider,
      tracerProvider,
      app,
      meterProvider,
      spanExporter
    );
    forwardTelemetryMetrics(tel, ee);

    logger.trace(
      'Initialized telemetry. [export_metrics=%s, export_traces=%s]',
      exportMetrics,
      exportTraces,
      opts?.metricsReaders?.length ?? 0
    );
    return tel;
  }

  override clone(lib: LibInfo): AppTelemetry {
    return new AppTelemetry(
      this.app,
      this.emitter,
      this.metricLoader,
      this.loggerProvider,
      this.tracerProvider,
      lib,
      this.meterProvider,
      this.spanExporter
    );
  }

  override async shutdown(): Promise<void> {
    const logger = this.loggerProvider.logger(packageInfo);
    logger.trace('Shutting down telemetry...');
    await Promise.all([
      this.meterProvider.shutdown(),
      this.spanExporter?.shutdown(),
    ]);
    this.metricLoader.reset();
    await super.shutdown();
  }
}

export interface AppTelemetryOptions {
  /**
   * Additional logging options. The name is set to the app's and resources are
   * inferred from the standard OTel evars.
   */
  readonly loggerOptions?: Omit<LoggerOptions, 'name' | 'resource'>;

  /**
   * Additional resource attributes added to the ones inferred from the standard
   * Otel evar.
   */
  readonly attrs?: otel.Attributes;

  /** Additional metric readers (see also `exportMetrics`). */
  readonly metricsReaders?: ReadonlyArray<sdkMetrics.MetricReader>;

  /**
   * Whether metrics should be exported. Defaults to `true` if the OTel metrics
   * exporter is available (see `isOtelMetricsExporterAvailable`) and the OTel
   * service name matches the application. Can't be true if the exporter is not
   * available.
   */
  readonly exportMetrics?: boolean;

  /**
   * Whether traces should be exported. Defaults to `true` if the OTel traces
   * exporter is available (see `isOtelTracesExporterAvailable`) and the OTel
   * service name matches the application. Can't be true if the exporter is not
   * available.
   */
  readonly exportTraces?: boolean;

  /**
   * Also register the tracer provider globally. This allows it to be accessed
   * via `otel.trace.getTracerProvider`. This option is not recommended when
   * multiple telemetry instances may be present.
   */
  readonly registerTraceProvider?: boolean;

  /** Optional shutdown hook. */
  readonly onShutdown?: () => void;
}

/** Deprecated alias. Please use `AppTelemetry.create` directly. */
export const appTelemetry = AppTelemetry.create;
