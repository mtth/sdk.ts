import * as stl from '@opvious/stl';
import Koa from 'koa';
import request from 'supertest';

import * as sut from '../src/health.js';
import {setup} from '../src/setup/index.js';

const telemetry = stl.RecordingTelemetry.forTesting();

describe('health status HTTP code', () => {
  test.each<[stl.HealthStatus, number]>([
    ['pass', 200],
    ['warn', 207],
    ['fail', 503],
  ])('%s + %s => %s', (arg, want) => {
    expect(sut.healthStatusHttpCode(arg)).toEqual(want);
  });
});

describe('health router', () => {
  let app: Koa;
  let oneStatus, twoStatus: stl.HealthStatus;

  beforeEach(() => {
    app = new Koa()
      .use(setup({telemetry}))
      .use(
        sut.exposeHealth({
          packageInfo: {name: 'pp', version: '1.2.3'},
          telemetry,
          checks: [
            {
              component: 'one',
              measurement: 'fake',
              observe: () => ({status: oneStatus}),
            },
            {
              component: 'two',
              measurement: 'fake',
              observe: () => ({status: twoStatus}),
            },
          ],
        })
      )
      .use(async (ctx, next) => {
        if (ctx.path !== '/ok') {
          await next();
          return;
        }
        ctx.body = 'OK';
      });
    oneStatus = 'pass';
    twoStatus = 'pass';
  });

  describe('health route', () => {
    test('handles all pass', async () => {
      const res = await request(app.callback()).get('/.health').expect(200);
      expect(res.body).toEqual({
        status: 'pass',
        releaseId: expect.any(String),
        serviceId: expect.any(String),
        checks: {
          'one:fake': [{component: 'one', measurement: 'fake', status: 'pass'}],
          'two:fake': [{component: 'two', measurement: 'fake', status: 'pass'}],
        },
      });
    });

    test('handles single warning', async () => {
      oneStatus = 'warn';
      const res = await request(app.callback()).get('/.health').expect(207);
      expect(res.body).toMatchObject({
        status: 'warn',
        checks: {
          'one:fake': [{status: 'warn'}],
          'two:fake': [{status: 'pass'}],
        },
      });
    });

    test('handles failures', async () => {
      oneStatus = 'fail';
      twoStatus = 'fail';
      const res = await request(app.callback()).get('/.health').expect(503);
      expect(res.body).toMatchObject({
        status: 'fail',
        checks: {
          'one:fake': [{status: 'fail'}],
          'two:fake': [{status: 'fail'}],
        },
      });
    });
  });

  describe('health middleware', () => {
    test('handles all pass', async () => {
      const res = await request(app.callback()).get('/ok').expect(200);
      expect(res.headers[sut.HEALTH_STATUS_HEADER]).toEqual('pass');
      expect(res.headers[sut.HEALTH_WARNINGS_HEADER]).toBeUndefined();
    });

    test('handles warnings', async () => {
      oneStatus = 'warn';
      twoStatus = 'warn';
      const res = await request(app.callback()).get('/ok').expect(200);
      expect(res.headers[sut.HEALTH_STATUS_HEADER]).toEqual('warn');
      expect(res.headers[sut.HEALTH_WARNINGS_HEADER]).toEqual(
        'one:fake two:fake'
      );
    });

    test('handles failure', async () => {
      oneStatus = 'fail';
      twoStatus = 'warn';
      const res = await request(app.callback()).get('/ok').expect(200);
      expect(res.headers[sut.HEALTH_STATUS_HEADER]).toEqual('fail');
      expect(res.headers[sut.HEALTH_FAILURES_HEADER]).toEqual('one:fake');
      expect(res.headers[sut.HEALTH_WARNINGS_HEADER]).toEqual('two:fake');
    });
  });
});
