# TypeScript development toolkit

A collection of tools, libraries, and configurations useful for writing
TypeScript.


## Packages

* Configurations
  * [`@mtth/eslint-plugin`](packages/configs/eslint-plugin)
  * [`@mtth/prettier-typescript`](packages/configs/prettier-typescript)
  * [`@mtth/tsconfig`](packages/configs/tsconfig)

* Libraries
  * [`@mtth/stl-bootstrap`](packages/libs/stl-bootstrap)
  * [`@mtth/stl-errors`](packages/libs/stl-errors)
  * [`@mtth/stl-graphql`](packages/libs/stl-graphql)
  * [`@mtth/stl-koa`](packages/libs/stl-koa)
  * [`@mtth/stl-resilience`](packages/libs/stl-resilience)
  * [`@mtth/stl-settings`](packages/libs/stl-settings)
  * [`@mtth/stl-telemetry`](packages/libs/stl-telemetry)
  * [`@mtth/stl-utils`](packages/libs/stl-utils)

* Tools
  * [`@mtth/inlinable`](packages/tools/inlinable)


## Libraries dependency flow

```mermaid
flowchart TD
  stl-errors --> stl-bootstrap
  stl-telemetry --> stl-bootstrap
  stl-utils --> stl-bootstrap

  stl-errors --> stl-graphql
  stl-utils --> stl-graphql

  stl-errors --> stl-koa
  stl-resilience --> stl-koa
  stl-settings --> stl-koa
  stl-telemetry --> stl-koa
  stl-utils --> stl-koa

  stl-errors --> stl-resilience
  stl-settings --> stl-resilience
  stl-telemetry --> stl-resilience
  stl-utils --> stl-resilience

  stl-errors --> stl-settings
  stl-utils --> stl-settings

  stl-errors --> stl-telemetry
  stl-utils --> stl-telemetry

  stl-errors --> stl-utils
```
