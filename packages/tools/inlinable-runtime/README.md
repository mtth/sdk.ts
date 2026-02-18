# @mtth/inlinable-runtime

Runtime support for [`@mtth/inlinable`](../inlinable). It provides the context
utilities that run both at build time (while the inliner executes your
functions) and at runtime (when the code falls back to dynamic evaluation).

## Quickstart

```sh
pnpm add -D @mtth/inlinable-runtime @mtth/inlinable
```

```ts
import inline from '@mtth/inlinable';
import {isInlining} from '@mtth/inlinable-runtime';

const metadata = inline((ctx) =>
  ctx.readJsonFile(ctx.enclosing(import.meta.url).resourcePath('package.json'))
);

if (!isInlining()) {
  // Executed at runtime when the expression has not been replaced yet.
  console.log('Metadata loaded dynamically:', metadata);
}
```

You can also opt into predefined transforms:

```ts
import inline from '@mtth/inlinable';

const compressed = inline('compress', (ctx) =>
  ctx.readTextFile(ctx.enclosing(import.meta.url).resourcePath('assets/banner.txt'))
);
```

## Highlights

- `InlinableContext` exposes helpers (`enclosing()`, `readTextFile()`,
  `readJsonFile()`) so inline functions can safely reference files relative to
  the calling module.
- `InlineTransform` and `inlineTransform(name)` describe how captured values are
  encoded (gzip+base64, obfuscation, etc.) before they are injected back into
  the bundle.
- `isInlining()` lets your code detect whether it currently runs inside the
  replacement pass, enabling assertions or alternate behavior when necessary.
- Utility helpers such as `enclosingRoot()` and `defaultRootFolders` make it
  easy to find the nearest package boundary or resource directory.
