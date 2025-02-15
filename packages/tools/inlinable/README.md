# Inlinable

## Quickstart

First, add the package as dev dependency:

```sh
npm install -D inlinable
```

Then use the default export in any JavaScript module to flag an expression as
candidate for inlining:

```typescript
import __inlinable from 'inlinable';

// Inline the contents of `resources/METADATA`
const metadata = __inlinable((ctx) => {
  const path = ctx.enclosing(import.meta.url).resourcePath('METADATA');
  return ctx.readTextFile(path);
});
```

Then run the command below to inline all candidates found in matching files:

```sh
$ inlinable replace lib/**/*.js
```

This works best when run automatically after TypeScript compilation within a
`package.json` script:

```javascript
  "scripts": {
    "build": "tsc -p src && inlinable replace"
    // ...
  }
```

## How does it work?

In the simple case, `inlinable replace` runs each inlinable function as if it
was an [IIFE][] and substitutes the original value with its JSONified return
value. Additionally, the `inlinable` import is removed. In the example above,
the final code will look like:

```typescript
const metadata = "...METADATA contents...";
```

It's also possible to run the code directly. `__inlinable` is guaranteed to
produce the same result as the inlined version when the inlined functions do not
rely on side-effects. This is typically useful for running tests.

[IIFE]: https://developer.mozilla.org/en-US/docs/Glossary/IIFE
