import {absurd, assert, check} from '@mtth/stl-errors';
import * as gql from 'graphql';

export * from './errors.js';

/**
 * Returns whether a (potentially deeply nested) field is requested by a GraphQL
 * query. This is typically used to avoid computing expensive fields unless the
 * user actually requested it. The field should be identified relative to the
 * info's current context.
 *
 * Sample usage:
 *
 *  ```typescript
 *  foobar(src, args, ctx, info) { // Resolver definition
 *    if (isFieldRequested(info, ['edges', 'cursor])) {
 *      // The field 'edges cursor' was requested...
 *    }
 *  }
 *  ```
 */
export function isFieldRequested(
  info: gql.GraphQLResolveInfo,
  idens: ReadonlyArray<string | FieldIdentifier>
): boolean {
  assert(idens.length, 'Empty identifiers');

  type Locator = FieldIdentifier & {readonly isPrefix: boolean};
  const locs: Locator[] = [];
  const path: gql.GraphQLResolveInfo['path'] | undefined = info.path;
  if (info.path && typeof path.key == 'string') {
    locs.push({name: path.key, typeName: path.typename, isPrefix: true});
  }
  for (const iden of idens) {
    locs.push({
      name: typeof iden == 'string' ? iden : iden.name,
      typeName: typeof iden == 'string' ? undefined : iden.typeName,
      isPrefix: false,
    });
  }
  return visit(info.fieldNodes, locs);

  function visit(
    nodes: ReadonlyArray<gql.SelectionNode>,
    locs: ReadonlyArray<Locator>
  ): boolean {
    const [loc, ...rest] = locs;
    if (loc === undefined) {
      return true;
    }
    for (const node of nodes) {
      switch (node.kind) {
        case gql.Kind.FIELD: {
          const name = loc.isPrefix
            ? (node.alias?.value ?? node.name.value)
            : node.name.value;
          if (name !== loc.name) {
            continue;
          }
          return visit(node?.selectionSet?.selections ?? [], rest);
        }
        case gql.Kind.FRAGMENT_SPREAD:
        case gql.Kind.INLINE_FRAGMENT: {
          const obj =
            node.kind === gql.Kind.FRAGMENT_SPREAD
              ? check.isPresent(info.fragments[node.name.value])
              : node;
          if (
            loc.typeName !== undefined &&
            obj.typeCondition?.name.value !== loc.typeName
          ) {
            continue;
          }
          const sels = obj.selectionSet.selections;
          if (visit(sels, [{...loc, typeName: undefined}, ...rest])) {
            return true;
          }
          break;
        }
        default:
          throw absurd(node);
      }
    }
    return false;
  }
}

export interface FieldIdentifier {
  readonly name: string;

  /**
   * The name of the type the field belongs to. This is needed when dealing with
   * fields containing union types.
   */
  readonly typeName?: string;
}

/**
 * Transforms GraphQL types, mapping a configurable subset of them to arbitrary
 * other types. Nested types are recursively renamed. This is useful for example
 * to combine raw GraphQL types and model types for use in server code.
 *
 * Sample usage:
 *
 *  ```typescript
 *  interface FooModel {
 *    foo: number
 *  }
 *
 *  interface BarModel {
 *    bar: string
 *    fooId: number
 *  }
 *
 *  interface Models {
 *    Bar: BarModel;
 *    Foo: FooModel;
 *  }
 *
 *  type ModelFor<V> = DeepRename<V, Models>;
 *  ```
 */
export type DeepRename<V, M> =
  V extends ReadonlyArray<infer E>
    ? ReadonlyArray<DeepRename<E, M>>
    : V extends NamedType<infer N>
      ? N extends keyof M
        ? M[N]
        : {readonly [K in keyof V]: DeepRename<V[K], M>}
      : V;

/** A GraphQL named type. */
export interface NamedType<N extends string = string> {
  readonly __typename?: N;
}
