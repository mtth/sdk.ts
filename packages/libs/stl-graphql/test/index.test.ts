import * as gql from 'graphql';
import {createSchema, createYoga, YogaServerInstance} from 'graphql-yoga';

import * as sut from '../src/index.js';

describe('original error', () => {
  test('present', () => {
    const cause = new Error('boom');
    const err = new gql.GraphQLError(
      'hi',
      undefined,
      undefined,
      undefined,
      undefined,
      cause
    );
    expect(sut.originalError(err)).toBe(cause);
  });

  test('absent', () => {
    const err = new gql.GraphQLError('hey');
    expect(sut.originalError(err)).toBeUndefined();
  });
});

describe('is field requested', () => {
  function newServer(handlers: any): YogaServerInstance<any, any> {
    return createYoga({
      schema: createSchema({
        typeDefs: `
          scalar Cursor

          type Connection {
            pageInfo: PageInfo
            edges: [Edge!]!
            totalCount: Int
          }

          type PageInfo {
            startCursor: Cursor
            endCursor: Cursor
          }

          type Edge {
            cursor: Cursor
            node: Foo
          }

          type Foo implements Node {
            id: ID
            intField: Int
            boolField: Boolean
            details: FooDetails
          }

          type FooDetails {
            boolField: Boolean
            stringField: String
          }

          interface Node {
            id: ID
          }

          type Bar implements Node {
            id: ID
            intField: Int
            boolField: Boolean
            otherField: String
          }

          type Query {
            connection: Connection
            node: Node
          }
        `,
        resolvers: {
          Foo: {
            details: (_src, _args, _ctx, info) => {
              handlers.onFooDetails?.(info);
              return {};
            },
          },
          Node: {
            __resolveType() {
              return 'Bar';
            },
          },
          Query: {
            connection: (_src, _args, _ctx, info) => {
              handlers.onConnection?.(info);
              return {edges: [{node: {}}]};
            },
            node: (_src, _args, _ctx, info) => {
              handlers.onNode?.(info);
              return {};
            },
          },
        },
      }),
    });
  }

  function request(doc: string): Request {
    return new Request('https://ignored/graphql', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: Buffer.from(JSON.stringify({query: doc})),
    });
  }

  test('simple top-level', async () => {
    let info: any;
    const server = newServer({
      onConnection(info_) {
        info = info_;
      },
    });
    await server.fetch(request('{ connection { pageInfo { startCursor }}}'));
    expect(sut.isFieldRequested(info, ['pageInfo'])).toBe(true);
    expect(sut.isFieldRequested(info, ['pageInfo', 'startCursor'])).toBe(true);
    expect(sut.isFieldRequested(info, ['pageInfo', 'endCursor'])).toBe(false);
    expect(sut.isFieldRequested(info, ['edges'])).toBe(false);
    expect(sut.isFieldRequested(info, ['missing'])).toBe(false);
  });

  test('top-level alias', async () => {
    let info: any;
    const server = newServer({
      onConnection(info_) {
        info = info_;
      },
    });
    await server.fetch(
      request('{ conn: connection { info: pageInfo { endCursor }}}')
    );
    expect(sut.isFieldRequested(info, ['pageInfo'])).toBe(true);
    expect(sut.isFieldRequested(info, ['pageInfo', 'endCursor'])).toBe(true);
    expect(sut.isFieldRequested(info, ['pageInfo', 'startCursor'])).toBe(false);
    expect(sut.isFieldRequested(info, ['edges'])).toBe(false);
  });

  test('top-level fragment', async () => {
    let info: any;
    const server = newServer({
      onConnection(info_) {
        info = info_;
      },
    });
    await server.fetch(
      request(
        `
        { conn: connection { ...countAndEnd }}

        fragment countAndEnd on Connection {
          pageInfo {
            endCursor
          }
          totalCount
        }
      `
      )
    );
    expect(sut.isFieldRequested(info, ['totalCount'])).toBe(true);
    expect(sut.isFieldRequested(info, ['pageInfo'])).toBe(true);
    expect(sut.isFieldRequested(info, ['pageInfo', 'endCursor'])).toBe(true);
    expect(sut.isFieldRequested(info, ['pageInfo', 'startCursor'])).toBe(false);
    expect(sut.isFieldRequested(info, ['edges'])).toBe(false);
  });

  test('simple nested', async () => {
    let info: any;
    const server = newServer({
      onFooDetails(info_) {
        info = info_;
      },
    });
    await server.fetch(
      request('{ connection { edges { node { details { boolField }}}}}')
    );
    expect(sut.isFieldRequested(info, ['boolField'])).toBe(true);
    expect(sut.isFieldRequested(info, ['stringField'])).toBe(false);
  });

  test('prefix inline fragment', async () => {
    let info: any;
    const server = newServer({
      onFooDetails(info_) {
        info = info_;
      },
    });
    await server.fetch(
      request(
        `
        {
          connection {
            edges { node { ... on Foo { details { stringField }}}}
          }
        }
      `
      )
    );
    expect(sut.isFieldRequested(info, ['stringField'])).toBe(true);
    expect(sut.isFieldRequested(info, ['boolField'])).toBe(false);
  });

  test('interface', async () => {
    let info: any;
    const server = newServer({
      onNode(info_) {
        info = info_;
      },
    });
    await server.fetch(
      request(
        `
        {
          node {
            id
            ... on Foo {
              intField
            }
            ... on Bar {
              boolField
              otherField
            }
          }
        }
      `
      )
    );
    expect(sut.isFieldRequested(info, ['id'])).toBe(true);
    expect(
      sut.isFieldRequested(info, [{name: 'intField', typeName: 'Foo'}])
    ).toBe(true);
    expect(
      sut.isFieldRequested(info, [{name: 'intField', typeName: 'Bar'}])
    ).toBe(false);
    expect(
      sut.isFieldRequested(info, [{name: 'boolField', typeName: 'Foo'}])
    ).toBe(false);
    expect(
      sut.isFieldRequested(info, [{name: 'boolField', typeName: 'Bar'}])
    ).toBe(true);
    expect(sut.isFieldRequested(info, ['boolField'])).toBe(true);
    expect(
      sut.isFieldRequested(info, [{name: 'otherField', typeName: 'Bar'}])
    ).toBe(true);
    expect(sut.isFieldRequested(info, ['otherField'])).toBe(true);
  });
});
