# @mtth/stl-graphql

Small GraphQL helpers that make schema-driven code easier to reason about:
field selection checks, failure normalization, and type-mapping utilities.

## Quickstart

```sh
pnpm add @mtth/stl-graphql
```

```ts
import {isFieldRequested, DeepRename} from '@mtth/stl-graphql';

// Skip expensive work unless the field is actually queried.
export const resolvers = {
  Query: {
    orders: (_src, _args, _ctx, info) => {
      if (isFieldRequested(info, ['edges', 'cursor'])) {
        // compute cursors only when needed
      }
      return fetchOrders();
    },
  },
};

// Map GraphQL result types into domain models with DeepRename.
type Models = {
  Order: {id: string; totalCents: number};
};
type OrderModel = DeepRename<OrderQuery['orders'][number], Models>;
```

## Highlights

- `isFieldRequested(info, path)` inspects the selection set (including fragments
  and unions) so resolvers can short-circuit optional work.
- Type-level helpers such as `DeepRename` convert GraphQL generated types into
  domain models without writing repetitive mapping code.
- Shared error utilities align GraphQL errors with the standard
  `@mtth/stl-errors` format for consistent remediation payloads.
- Zero runtime dependencies beyond `graphql`, keeping bundle size and startup
  cost minimal.
