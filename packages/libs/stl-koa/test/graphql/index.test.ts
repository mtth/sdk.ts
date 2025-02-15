import * as stl from '@opvious/stl';
import {enableContextPropagation} from '@opvious/stl-bootstrap';
import events from 'events';
import http from 'http';
import Koa from 'koa';
import fetch from 'node-fetch';
import request from 'supertest';

import * as sut from '../../src/graphql/index.js';
import {exposeHealth} from '../../src/health.js';
import {setup} from '../../src/setup/index.js';

enableContextPropagation();

const telemetry = stl.RecordingTelemetry.forTesting();

const [errors] = stl.errorFactories({definitions: {duplicateBook: {}}});

const typeDefs = `
type Book {
  title: String!
  author: String
  never: Int!
}

type Query {
  book(title: String!): Book
}

type Mutation {
  addBook(title: String!, author: String): Book!
  deleteBook(title: String!): Boolean!
  clearBooks: Boolean!
}
`;

function createResolvers(): any {
  const books = new Map<string, string>();
  return {
    Query: {
      book(_parent, args) {
        const {title} = args;
        return books.has(title) ? {title, author: books.get(title)} : undefined;
      },
    },
    Mutation: {
      addBook(_parent, args) {
        const {title, author} = args;
        if (books.has(title)) {
          throw stl.statusErrors.alreadyExists(
            errors.duplicateBook({
              message: 'Title exists already',
              tags: {title},
              cause: stl.errors.internal({message: 'boom'}),
            })
          );
        }
        books.set(title, author);
        return {title, author};
      },
      deleteBook(_parent, args) {
        if (!args.title) {
          throw new Error('Empty title');
        }
        throw stl.errors.internal({message: 'Unsupported'});
      },
      clearBooks() {
        books.clear();
        return true;
      },
    },
  };
}

const checkUnimplementedPlugin: sut.YogaPlugin = {
  async onExecute(params): Promise<void> {
    const ctx: any = params.args.contextValue;
    if (ctx.todo) {
      sut.abortYogaCall(stl.unimplemented(), params.setResultAndStopExecution);
      return;
    }
  },
};

describe('Yoga router', () => {
  let server: http.Server;
  let healthStatus: stl.HealthStatus;
  let app: Koa<any, any>;
  let executor: GraphqlExecutor;

  const checks: ReadonlyArray<stl.HealthCheck> = [
    {
      component: 'test',
      measurement: 'direct',
      observe: () => ({status: healthStatus}),
    },
  ];

  beforeAll(async () => {
    const router = sut.standardYogaRouter({
      schema: {typeDefs, resolvers: createResolvers()},
      serverConfig: {graphiql: false, plugins: [checkUnimplementedPlugin]},
      telemetry,
      healthChecks: checks,
      exposeGraphqlErrors: true,
    });

    app = new Koa()
      .use(setup({telemetry}))
      .use((ctx, next) => {
        ctx.state.todo = !!ctx.get('todo');
        return next();
      })
      .use(exposeHealth({checks, telemetry}))
      .use(router.allowedMethods())
      .use(router.routes());

    server = app.listen();
    await events.once(server, 'listening');
    executor = graphqlExecutor(stl.serverHost(server)!);
  });

  beforeEach(async () => {
    healthStatus = 'pass';
    await executor('mutation{clearBooks}');
  });

  afterAll(async () => {
    server.close();
  });

  test('handles typename requests', async () => {
    const ret = await executor('{__typename}');
    expect(ret).toEqual({
      data: {__typename: 'Query'},
    });
  });

  test('503s on health check failure', async () => {
    healthStatus = 'fail';
    const res = await executor('{__typename}');
    expect(res).toMatchObject({
      errors: [{extensions: {status: 'UNAVAILABLE'}}],
    });
  });

  test('handles OK query', async () => {
    const ret = await executor('query{book(title:"T"){title author}}');
    expect(ret).toEqual({data: {book: null}});
  });

  test('handles OK mutation', async () => {
    const ret = await executor('mutation{addBook(title:"T"){title author}}');
    expect(ret).toEqual({
      data: {addBook: {title: 'T', author: null}},
    });
  });

  test('propagates status errors', async () => {
    await executor('mutation{addBook(title:"T"){title}}');
    const res = await executor('mutation{addBook(title:"T"){title}}');
    expect(res.data).toBeNull();
    expect(res.errors).toHaveLength(1);
    const err = res.errors?.[0];
    expect(err).toMatchObject({
      message:
        'Already exists error [ERR_DUPLICATE_BOOK]: Title exists ' + 'already',
      extensions: {
        status: 'ALREADY_EXISTS',
        exception: {
          code: 'ERR_DUPLICATE_BOOK',
          tags: {title: 'T'},
        },
        // The cause must not be forwarded.
      },
      path: ['addBook'],
    });
  });

  test('handles internal errors', async () => {
    const res = await executor('mutation{deleteBook(title:"T")}');
    expect(res.data).toBeNull();
    expect(res.errors).toHaveLength(1);
    const err = res.errors?.[0];
    expect(err).toMatchObject({
      message: 'Unknown error',
      path: ['deleteBook'],
    });
  });

  test('handles other errors', async () => {
    const res = await executor('mutation DeleteBook{deleteBook(title:"")}');
    expect(res.data).toBeNull();
    expect(res.errors).toHaveLength(1);
    const err = res.errors?.[0];
    expect(err).toMatchObject({
      message: 'Unknown error',
      path: ['deleteBook'],
    });
  });

  test('handles GraphQL validation errors', async () => {
    const res = await executor('mutation{deleteBook(title:3)}');
    expect(res.data).toBeUndefined();
    expect(res.errors).toHaveLength(1);
    const err = res.errors?.[0];
    expect(err).toMatchObject({
      message: 'String cannot represent a non string value: 3',
      extensions: {
        status: 'INVALID_ARGUMENT',
      },
    });
  });

  test('handles GraphQL parse errors', async () => {
    const res = await executor('mutation{');
    expect(res.data).toBeUndefined();
    expect(res.errors).toHaveLength(1);
    const err = res.errors?.[0];
    expect(err).toMatchObject({
      message: expect.any(String),
    });
  });

  test('404s on other endpoints', async () => {
    await request(app.callback())
      .post('/foo')
      .set('content-type', 'application/json')
      .send('{"query":"{__typename}"}')
      .expect(404);
  });

  test('handles bad json input', async () => {
    const res = await request(app.callback())
      .post('/graphql')
      .set('content-type', 'application/json')
      .send('{"query":"}')
      .expect(200);
    expect(res.body).toEqual({
      errors: [
        {
          message: expect.any(String),
          extensions: {originalError: expect.anything()},
        },
      ],
    });
  });

  test('handles bad encoding header', async () => {
    const res = await request(app.callback())
      .post('/graphql')
      .set('content-type', 'application/json')
      .set('content-encoding', 'foo')
      .send('{}')
      .expect(200);
    expect(res.body).toMatchObject({
      errors: [
        {
          extensions: {
            status: 'INVALID_ARGUMENT',
            exception: {code: 'ERR_UNSUPPORTED_ENCODING'},
          },
        },
      ],
    });
  });

  test('handles gzipped errors', async () => {
    const res = await request(app.callback())
      .post('/graphql')
      .set('content-type', 'application/json')
      .set('content-encoding', 'gzip')
      .send('not valid gzip')
      .expect(200);
    expect(res.body).toMatchObject({
      errors: [
        {
          extensions: {
            status: 'INVALID_ARGUMENT',
            exception: {code: 'ERR_DECODING_FAILED'},
          },
        },
      ],
    });
  });

  test('handles unsupported content-type', async () => {
    await request(app.callback())
      .post('/graphql')
      .set('content-type', 'application/avro')
      .send('')
      .expect(415);
  });

  test('handles empty body', async () => {
    await request(app.callback()).post('/graphql').send().expect(415);
  });

  test('handles missing query', async () => {
    const res = await request(app.callback())
      .post('/graphql')
      .set('content-type', 'application/json')
      .send('{}')
      .expect(200);
    expect(res.body).toEqual({errors: [{message: expect.any(String)}]});
  });

  test('handles non-nullable field errors', async () => {
    const res = await executor('mutation{addBook(title:"T"){never}}');
    expect(res.data).toBeNull();
    expect(res.errors).toHaveLength(1);
    const err = res.errors?.[0];
    expect(err).toMatchObject({
      message: 'Unknown error',
      path: expect.anything(),
    });
  });

  test('aborts from plugin', async () => {
    const res = await request(app.callback())
      .post('/graphql')
      .set('content-type', 'application/json')
      .set('todo', '1')
      .send('{"query":"{__typename}"}')
      .expect(200);
    expect(res.body).toMatchObject({
      errors: [{extensions: {status: 'UNIMPLEMENTED'}}],
    });
  });
});

type GraphqlExecutor = (query: string) => Promise<any>;

function graphqlExecutor(host: stl.Host): GraphqlExecutor {
  return async (query: string): Promise<any> => {
    const res = await fetch(`http://${host}/graphql`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({query}),
    });
    return res.json();
  };
}
