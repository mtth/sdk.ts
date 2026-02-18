# @mtth/stl-bootstrap

Opinionated wiring for spinning up telemetry in Node.js services. Create an
`AppTelemetry` once and get logs, metrics, traces, and context propagation that
obey the OpenTelemetry environment variables out of the box.

## Quickstart

```sh
pnpm add @mtth/stl-bootstrap
```

```ts
import {AppTelemetry, enableContextPropagation} from '@mtth/stl-bootstrap';
import {instrumentsFor} from '@mtth/stl-telemetry';

enableContextPropagation(); // idempotent, safe to call at startup

const telemetry = AppTelemetry.create({name: 'orders-api', version: '1.0.0'});

telemetry.logger.info('service bootstrap complete');
const [metrics] = telemetry.metrics(
  instrumentsFor({requests: {name: 'http.server.requests', kind: 'counter', unit: '{requests}', labels: {result: 'result'}}})
);

process.on('SIGTERM', async () => {
  telemetry.logger.info('Shutting down...');
  await telemetry.shutdown();
});
```

Setting `OTEL_EXPORTER_OTLP_ENDPOINT` (or the metrics/traces-specific
environment variables) automatically turns on the corresponding exporters.

## Highlights

- `AppTelemetry.create()` provisions logger providers, metric readers, and span
  processors with a single call, including graceful shutdown hooks.
- Built-in resource detection reads the standard OTel environment variables so
  metrics and traces share consistent service metadata.
- Context propagation (`AsyncLocalStorageContextManager`) is enabled for you,
  making spans flow automatically across async boundaries.
- Extra helpers such as `PrometheusMetricsReader` and
  `prometheusMetricsSerializer` make it trivial to expose on-node metrics.
