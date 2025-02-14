# Standard errors

## Motivation

Good error handling is a prerequisite for good telemetry. To help with this,
`@mtth/stl-errors` provides a simple `StandardError` interface which exposes
powerful building blocks:

+ Namespaced error codes;
+ Causal chains;
+ Optional structured data.

## Quickstart

Standard errors are best created via `errorFactories` which provides type-safe
error creation functions along with their codes:

```typescript
import {errorFactories} from '@mtth/stl-errors';

const [errors, codes] = errorFactories({
  definitions: {
    invalidFoo: (foo: string) => ({
      message: `The input foo ${foo} was invalid`,
      tags: {foo},
    }),
    missingBar: 'The bar was missing',
  },
});

// Error with code `ERR_INVALID_FOO` (`codes.InvalidFoo`).
const err1 = errors.invalidFoo('fff');

// Error with code `ERR_MISSING_BAR` (`codes.MissingBar`).
const err2 = errors.missingBar();
```
