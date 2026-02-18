# @mtth/stl-telemetry

Structured logging, metrics, and tracing primitives with first-class TypeScript
support and OpenTelemetry integration.

## Quickstart

```sh
pnpm add @mtth/stl-telemetry
```

```ts
import {RecordingTelemetry, instrumentsFor} from '@mtth/stl-telemetry';

const telemetry = RecordingTelemetry.forTesting({name: 'payments-service'});

const [metrics] = telemetry.metrics(
  instrumentsFor({
    requests: {
      name: 'payments.requests',
      kind: 'counter',
      unit: '{requests}',
      labels: {result: 'result'},
    },
  })
);

telemetry.logger.info('service ready');
metrics.requests.add(1, {result: 'ok'});

telemetry.withActiveSpan({name: 'charge-card'}, (span) => {
  span.addEvent('calling gateway');
  // ...do the work...
  span.end();
});
```

## Highlights

- A single `Telemetry` interface powers loggers, spans, and metrics; `.via()`
  automatically scopes library metadata.
- Type-safe metrics with `instrumentsFor()` generate strongly typed
  recorders and guard against typo-prone label names.
- Logger providers support dynamic thresholding, structured values, and
  recording destinations for tests.
- Helpers like `withActiveSpan`, `recordErrorOnSpan`, and `settingLogLevel`
  keep OpenTelemetry plumbing consistent across services and libraries.
