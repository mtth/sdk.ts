import exporterPrometheus from '@opentelemetry/exporter-prometheus';
import {
  Aggregation,
  AggregationTemporality,
  MetricReader,
  ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import {
  instrumentsFor,
  Telemetry,
  TelemetryListeners,
} from '@mtth/stl-telemetry';
import {EventConsumer} from '@mtth/stl-utils/events';

const instruments = instrumentsFor({
  collectionErrored: {
    name: 'mtth.metrics.collections.errored',
    kind: 'counter',
    unit: '{collections}',
    labels: {},
  },
  messageEmitted: {
    name: 'mtth.logging.messages.emitted',
    kind: 'counter',
    unit: '{messages}',
    labels: {level: 'log.level', libName: 'lib.name'},
  },
  spanStarted: {
    name: 'mtth.tracing.spans.started',
    kind: 'counter',
    unit: '{spans}',
    labels: {name: 'span.name'},
  },
});

export function forwardTelemetryMetrics(
  tel: Telemetry,
  ee: EventConsumer<TelemetryListeners>
): void {
  const [metrics] = tel.metrics(instruments);
  ee.on('logMessage', (lvl, lib) => {
    metrics.messageEmitted.add(1, {level: lvl, libName: lib.name});
  })
    .on('collectionError', (err) => {
      tel.logger.warn({err}, 'Metric collection errored.');
      metrics.collectionErrored.add(1);
    })
    .on('spanStart', (name) => {
      metrics.spanStarted.add(1, {name});
    });
}

export type MetricsSerializer = (rm: ResourceMetrics) => string;

export class PrometheusMetricsReader extends MetricReader {
  constructor() {
    super({
      aggregationSelector: () => Aggregation.Default(),
      aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE,
    });
  }

  override async onForceFlush(): Promise<void> {}

  override async onShutdown(): Promise<void> {}
}

export function prometheusMetricsSerializer(opts?: {
  /** Defaults to the empty string. */
  readonly prefix?: string;
  /** Defaults to `true`. */
  readonly appendTimestamp?: boolean;
}): MetricsSerializer {
  const serializer = new exporterPrometheus.PrometheusSerializer(
    opts?.prefix ?? '',
    opts?.appendTimestamp ?? true
  );
  return (rm) => serializer.serialize(rm);
}
