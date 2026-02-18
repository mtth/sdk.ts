# @mtth/stl-utils

Infrastructure-friendly utilities: typed event emitters, bindable server
lifecycles, pretty printers, environment helpers, and more.

## Quickstart

```sh
pnpm add @mtth/stl-utils
```

```ts
import {typedEmitter} from '@mtth/stl-utils/events';
import {PrettyFormatter} from '@mtth/stl-utils/objects';

interface WorkerEvents {
  ready(): void;
  failed(err: unknown): void;
}

const events = typedEmitter<WorkerEvents>();
events.on('ready', () => console.log('ready for traffic'));
events.emit('ready');

const pretty = PrettyFormatter.create();
console.log(pretty.format({token: Buffer.alloc(256)}));
```

## Highlights

- Type-safe emitters via `typedEmitter`, `withEmitter`, and `withTypedEmitter`
  keep Node-style event code honest without third-party wrappers.
- `Bindable`, `Host`, and `serverHost` standardize how long-running services
  bind, emit lifecycle events, and react to signals.
- Formatting helpers (PrettyFormatter, relative indexable views, truncation)
  keep structured logs readable even with large payloads or buffers.
- A grab bag of ergonomic primitives (environment inspection, strings,
  collections, opaque nominal types) removes incidental plumbing from
  higher-level packages.
