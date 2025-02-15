import * as stl from '@opvious/stl';
import * as gql from 'graphql';

export const [errors, codes] = stl.errorFactories({
  definitions: {
    badRepresentation: (name: string, repr: unknown, cause?: unknown) => ({
      message: 'Unexpected internal scalar representation',
      tags: {name, repr},
      cause,
    }),
    incompatibleAst: (name: string, ast: gql.ValueNode, cause?: unknown) => ({
      message: 'Incompatible scalar literal in GraphQL AST',
      tags: {name, ast},
      cause,
    }),
    unparseableValue: (name: string, value: unknown, cause?: unknown) => ({
      message: 'Invalid scalar value',
      tags: {name, value},
      cause,
    }),
  },
  prefix: 'ERR_GRAPHQL_SCALARS_',
});

export const errorCodes = codes;

/**
 * Returns a custom scalar, decorating errors with the appropriate metadata and
 * status. For example parsing errors are exposed with `INVALID_ARGUMENT`
 * status.
 */
export function standardScalar<I, O>(
  params: StandardScalarParams<I, O>
): gql.GraphQLScalarType<I, O> {
  const {name} = params;
  return new gql.GraphQLScalarType({
    name,
    description: params.description,
    serialize(repr: unknown): O {
      try {
        return params.encode(repr);
      } catch (cause) {
        throw errors.badRepresentation(name, repr, cause);
      }
    },
    parseValue(value: unknown): I {
      try {
        return params.decode(value);
      } catch (cause) {
        const err = errors.unparseableValue(name, value, cause);
        throw stl.statusErrors.invalidArgument(err);
      }
    },
    parseLiteral(ast): I {
      let value;
      try {
        switch (ast.kind) {
          case gql.Kind.FLOAT:
            value = parseFloat(ast.value);
            stl.assert(!isNaN(value), 'Not a number: %j', ast);
            break;
          case gql.Kind.INT:
            value = parseInt(ast.value, 10);
            stl.assert(!isNaN(value), 'Not a number: %j', ast);
            break;
          case gql.Kind.STRING:
            value = ast.value;
            break;
          default:
            throw stl.errors.internal({
              message: 'Unsupported literal',
              tags: {name, ast},
            });
        }
      } catch (cause) {
        const err = errors.incompatibleAst(name, ast, cause);
        throw stl.statusErrors.invalidArgument(err);
      }
      return stl.check.isPresent(this.parseValue)(value);
    },
  });
}

export interface StandardScalarParams<I, O> {
  readonly name: string;
  readonly description?: string;
  readonly encode: (inner: unknown) => O;
  readonly decode: (outer: unknown) => I;
}

export const AVRO_NAMESPACE = 'opvious.stl.graphql.scalars';
