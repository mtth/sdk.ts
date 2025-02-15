# Standard utilities

```sh
$ pnpm i @mtth/stl
```

## Features

+ Errors
  + Standardized error codes
  + Extensible custom errors
  + Causal chain utilities
+ Logging
  + Inferred contextual metadata, including tracing information
  + Structured metadata
  + Compatible with `pino`
+ Settings
  + Convenient with Node and browser environments (WebPack, ...)
  + Validation for missing and invalid settings with informative errors
  + Tight types inferred with minimal boilerplate
  + Easy to test

## Quickstart

### Errors

Good error handling is a prerequisite for good logging. To help with this,
`stl` provides a simple `StandardError` interface which exposes powerful
building blocks:

+ Namespaced error codes;
+ Causal chains;
+ Optional structured data.

Standard errors are best created via `errorFactories` which provides type-safe
error creation functions along with their codes:

```typescript
import {errorFactories} from '@mtth/stl';

const [errors, codes] = errorFactories({
  prefix: 'ERR_EXAMPLE_', // Error namespace.
  suffixes: [
    'INVALID_FOO',
    'MISSING_BAR',
  ] as const,
});

// Error with code `ERR_MYNS_INVALID_FOO`.
const err1 = errors.invalidFoo();

// Error with code `ERR_MYNS_MISSING_BAR` and custom message.
const err2 = errors.missingBar('A simple message');

// Another error with code `ERR_MYNS_INVALID_FOO`, additional structured data,
// and a causal exception.
const err3 = errors.invalidFoo({
  message: 'Another message',
  tags: {value1: 'one', anotherValue: 88},
  cause: err2,
});

// Set of error codes for clients to handle errors in a type-safe manners.
export const exampleErrorCodes = codes;
```

### Logging

Pino-compatible API with additional bindings type-safety.

```typescript
import {logger} from '@mtth/stl';

const log = logger({
  level: 'debug',
});

log.info({data: {one: 1}}, 'Something normal happened.');
log.warn({err: new Error()}, 'An error happened.');
```

### Settings

```typescript
import {
  intSetting,
  invalidSource,
  settingsProvider,
  stringSetting,
} from '@mtth/stl';

const settings = settingsProvider((env) => ({
  port: intSetting(env.PORT ?? 8080), // Integer value
  auth: { // Hierarchical settings
    clientID: stringSetting(env.CLIENT_ID ?? 'my-client'), // String value
    clientSecret: stringSetting({
      source: env.CLIENT_SECRET ?? invalidSource, // Required string value
      sensitive: true, // Redact field from parsed sources
    }),
  },
  tag: stringSetting(env.TAG), // Optional string value
}));

const val = settings(); // Parsed values
```

Importantly, `val`'s type will automatically be inferred as:

```typescript
{
  readonly port: number;
  readonly auth: {
    readonly clientID: string;
    readonly clientSecret: string;
  }
  readonly tag: string | undefined;
}
```

If `CLIENT_SECRET` wasn't defined in the environment, the config provider will
throw an informative exception. To test different setting values without needing
mocks, pass in a custom environment when calling the config provider.

```typescript
const val = settings({
  CLIENT_ID: 'test-id',
  CLIENT_SECRET: 'test-secret',
});
```

#### Defining a custom setting

We provide a convenience factory builder for types which do not need any
non-standard creation arguments.

```typescript
import {simpleSettingFactory} from '@mtth/stl';

// A setting which will have values inferred as `Date`s.
const dateSetting = simpleSettingFactory((s): Date => new Date(s));
```

If additional arguments are desired, it's always possible--just more verbose--to
use the underlying setting factory directly. For example, here's one way to
implement an enum setting:

```typescript
import {newSetting, Setting, SettingParams, SettingSource} from '@mtth/stl';

/** Enum setting creation parameters. */
export interface EnumSettingParams<E extends string, S>
  extends SettingParams<S> {
  /** Allowed enum values. */
  readonly symbols: ReadonlyArray<E>;
}

/** Creates a new enum setting. */
export function enumSetting<E extends string, S extends SettingSource>(
  params: EnumSettingParams<E, S>
): Setting<S, E> {
  return newSetting(params, (s): any => {
    if (!~params.symbols.indexOf(s as any)) {
      throw new Error('Invalid enum value');
    }
    return s;
  });
}
```

#### Recommended project structure

In production code, we recommend using modular configuration types. Performing
post-processing on setting values is easy with a `settingsManager`:

```typescript
// src/config.ts
import {settingsManager} from '@mtth/stl';

// First the (private) underlying settings resource manager.
const withSettings = settingsManager((env) => ({/* ... */}));

// Then the (public) configuration types. These can be different from the raw
// settings for example discriminated unions are often handy. These are meant
// to be used everywhere in the application. Smaller, more specific, types will
// make testing easier and increase modularity.
export interface ModuleAConfig {/* ... */}
export interface ModuleBConfig {/* ... */}
export interface Config {
  readonly moduleA: ModuleAConfig;
  readonly moduleB: ModuleBConfig;
  // ...
}

// Now the (public, though not meant for use everywhere - see below)
// configuration factory. This function should only be imported in the
// application's entry point and this module's unit-tests. Other modules should
// accept already instantiated configuration types, making testing much easier
// and dependencies explicit.
export const config = withSettings((val) => {
  // Transform the setting values into the public configuration types...
  return {/* ... */};
});
```

```typescript
// test/config.test.ts
import * as sut from '../src/config';

// Within a test...
const env = {/* ... */}; // Test environment.
expect(config(env)).toEqual(/* ... */); // Expected config for the environment.
```
