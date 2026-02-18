# @mtth/stl-resilience

Deadlines, retries, and health instrumentation that wrap any async operation
with observability-friendly guardrails.

## Quickstart

```sh
pnpm add @mtth/stl-resilience
```

```ts
import {resilient} from '@mtth/stl-resilience';
import {RecordingTelemetry} from '@mtth/stl-telemetry';

const telemetry = RecordingTelemetry.forTesting({name: 'orders-api'});

const fetchOrder = resilient('fetch order', {retryCount: 2}, async ({span, deadline, logger}) => {
  logger.debug('Calling upstream...');
  const res = await fetch('https://example.internal/orders', {signal: deadline.signal});
  if (!res.ok) {
    throw new Error('Upstream failed');
  }
  span.addEvent('upstream complete');
  return res.json();
});

const order = await fetchOrder.run({telemetry});
```

## Highlights

- Wrap any promise-returning function with deadlines, abort signals, retries, and
  OpenTelemetry spans via the `resilient()` helper.
- Listen for `retry`/`lateAttempt*` events to feed alerting systems or emit
  extra metrics when work keeps failing.
- Deadline and race helpers compose with AbortController, letting you enforce
  cascading timeouts across API layers.
- Built-in settings + telemetry integration expose knobs (log levels,
  backoff windows, retry codes) without duplicating boilerplate in every
  service.
