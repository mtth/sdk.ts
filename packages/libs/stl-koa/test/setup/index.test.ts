import * as stl from '@opvious/stl';
import {enableContextPropagation} from '@opvious/stl-bootstrap';
import Koa from 'koa';
import request from 'supertest';

import * as sut from '../../src/setup/index.js';

enableContextPropagation();

const telemetry = stl.RecordingTelemetry.forTesting(
  {name: 'test'},
  'silent,test=info'
);

const [errors, codes] = stl.errorFactories({
  prefix: 'ERR_TEST_KOA_',
  definitions: {
    one: {},
    two: (count: number) => ({tags: {count}}),
    three: 'Wow',
  },
});

describe('setup', () => {
  let app: Koa;

  beforeEach(() => {
    app = new Koa().use(
      sut.setup({
        telemetry,
        routeMatchers: [sut.staticRouteMatcher(['/foo', '/bar/'])],
        failurePropagators: [
          sut.failurePropagator(codes.Two, (_fl, ctx, tags) => {
            ctx.set('x-count', tags.count.toFixed());
          }),
        ],
        failureAnnotators: [
          (err) => (err.contents.code === codes.Three ? 'Please say hi' : ''),
        ],
      })
    );
    telemetry.reset();
  });

  test('lets OK requests through', async () => {
    app.use((ctx) => {
      ctx.status = 204;
    });
    await request(app.callback()).get('/foo').expect(204);
  });

  test('formats non-standard errors', async () => {
    app.use(async () => {
      throw new Error('boom');
    });
    const data = await request(app.callback()).get('/bar/baz').expect(500);
    expect(data.text).toEqual('Unknown error. Please try again later.');
  });

  test('forwards status from wrapped tagged errors', async () => {
    app.use(async () => {
      throw stl.statusErrors.permissionDenied(
        stl.errors.internal({message: 'Not this time'})
      );
    });
    const data = await request(app.callback()).get('/').expect(403);
    expect(data.headers).toMatchObject({
      'opvious-error-code': 'ERR_INTERNAL',
      'opvious-error-status': 'PERMISSION_DENIED',
    });
    expect(data.text).toEqual(
      'Permission denied error [ERR_INTERNAL]: Not this time'
    );
  });

  test('forwards code from wrapped custom errors', async () => {
    app.use(async () => {
      throw stl.statusErrors.notFound(errors.one({tags: {yes: '11'}}));
    });
    const data = await request(app.callback())
      .get('/')
      .accept('application/json')
      .expect(404);
    expect(data.headers).toMatchObject({
      'opvious-error-code': 'ERR_TEST_KOA_ONE',
      'opvious-error-status': 'NOT_FOUND',
    });
    expect(data.body).toEqual({
      status: 'NOT_FOUND',
      error: {
        code: 'ERR_TEST_KOA_ONE',
        message: 'Not found error [ERR_TEST_KOA_ONE]',
        tags: {yes: '11'},
      },
    });
  });

  test('forwards information from nested status errors', async () => {
    app.use(async () => {
      const cause = stl.statusErrors.failedPrecondition(new Error('Boom'));
      throw stl.errors.internal({message: 'Foo', cause});
    });
    const data = await request(app.callback())
      .get('/')
      .set('accept', 'text/*')
      .expect(422);
    expect(data.headers).toMatchObject({
      'content-type': 'text/plain; charset=utf-8',
      'opvious-error-status': 'FAILED_PRECONDITION',
    });
    expect(data.text).toEqual('Failed precondition error: Boom');
  });

  test('includes tags in tagged errors', async () => {
    app.use(async () => {
      throw stl.statusErrors.invalidArgument(
        stl.errors.internal({message: 'Boom', tags: {limit: -1}})
      );
    });
    const data = await request(app.callback())
      .get('/')
      .accept('application/json')
      .expect(400);
    expect(data.body).toEqual({
      status: 'INVALID_ARGUMENT',
      error: {
        code: 'ERR_INTERNAL',
        message: 'Invalid argument error [ERR_INTERNAL]: Boom',
        tags: {limit: -1},
      },
    });
  });

  test('propagates error tags', async () => {
    app.use(async () => {
      throw stl.statusErrors.invalidArgument(errors.two(123));
    });
    const data = await request(app.callback()).get('/').expect(400);
    expect(data.headers['x-count']).toEqual('123');
  });

  test('annotates failures', async () => {
    app.use(async () => {
      throw stl.statusErrors.resourceExhausted(errors.three());
    });
    const data = await request(app.callback())
      .get('/')
      .accept('application/json')
      .expect(429);
    expect(data.body).toMatchObject({
      error: {message: expect.stringContaining('Wow. Please say hi')},
    });
  });

  test('supports custom verbosity', async () => {
    const clog = telemetry.logger.child({$test: true});
    app.use(async (ctx) => {
      clog.info('hey');
      clog.debug('ho');
      ctx.status = 201;
    });
    await request(app.callback()).get('/').expect(201);
    await request(app.callback())
      .get('/')
      .set('opvious-control', 'debug')
      .expect(201);
    await request(app.callback()).get('/').expect(201);
    expect(telemetry.logRecords.filter((r) => r.$test)).toMatchObject([
      {msg: 'hey'},
      {msg: 'hey'},
      {msg: 'ho'},
      {msg: 'hey'},
    ]);
  });

  describe('connecting ip', () => {
    test('missing', async () => {
      app.use(async (ctx) => {
        expect(sut.getConnectingIp()).toBeUndefined();
        ctx.status = 204;
      });
      await request(app.callback()).get('/').expect(204);
      expect.assertions(1);
    });

    test('in header', async () => {
      const ip = '1.2.3.4';
      app.use(async (ctx) => {
        expect(sut.getConnectingIp()).toEqual(ip);
        ctx.status = 204;
      });
      await request(app.callback())
        .get('/')
        .set(sut.CONNECTING_IP_HEADER, ip)
        .expect(204);
      expect.assertions(1);
    });
  });

  test.todo('abort signal gets triggered');
});
