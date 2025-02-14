# ESLint plugin

Shared linting configuration.

## Quickstart

First, install ESLint and this plugin:

```sh
$ npm i -D eslint @mtth/eslint-plugin
```

Then reference this plugin in `.eslint.config.mjs`:

```javascript
import configs from '@mtth/eslint-plugin';

export default config;
```

## Configurations

+ `typescript`, defaults for a TypeScript project. The corresponding parser is
  included in the plugin.
