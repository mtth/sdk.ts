# @mtth/stl-koa

Koa glue code with telemetry, throttling, request metrics, and graceful binding
helpers tailored for backend services.

## Quickstart

```sh
pnpm add koa @koa/router @mtth/stl-koa
```

```ts
import Koa from 'koa';
import Router from '@koa/router';
import {AppTelemetry} from '@mtth/stl-bootstrap';
import {AppBindable, setup} from '@mtth/stl-koa';

const telemetry = AppTelemetry.create({name: 'example-api'});

const app = new Koa();
app.use(setup({telemetry}));

const router = new Router();
router.get('/healthz', (ctx) => {
  ctx.body = {status: 'ok'};
});
app.use(router.routes());

const bindable = AppBindable.create({app, telemetry});
bindable.start(); // binds to $APP_PORT or 8080
```

The `setup` middleware automatically records HTTP metrics, propagates trace ids,
and normalizes error responses. `AppBindable` wires the server into the
`Bindable` lifecycle so SIGTERM triggers a graceful shutdown.

## Highlights

- `setup()` applies a full stack of instrumentation: structured logging,
  request metrics (`http.server.*`), tracing, error sanitization, and client IP
  extraction in a single middleware.
- `AppBindable` binds any Koa app to an HTTP server with telemetry-aware log
  messages, default port discovery, and automatic signal handlers.
- Rate-limiting + throttling helpers build on `rate-limiter-flexible` with
  typed errors and OTEL metrics.
- Streaming helpers, health utilities, and codec helpers (brotli JSON, raw body
  decoding) cover the boring but necessary HTTP plumbing so routes stay clean.
