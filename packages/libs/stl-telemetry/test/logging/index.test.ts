import {errors} from '@mtth/stl-errors';
import {typedEmitter} from '@mtth/stl-utils/events';
import * as otel from '@opentelemetry/api';
import {TraceState} from '@opentelemetry/core';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import {default as pino_} from 'pino';

import * as sut from '../../src/logging/index.js';

const pino = pino_.default ?? pino_;

const provider = new NodeTracerProvider();
provider.register();

const emitter = typedEmitter<sut.LoggingListeners>();

test('compatible with pino', () => {
  const logger: sut.Logger = pino({level: 'silent'});
  logger.info('OK');
});

function withProvider(
  fn: (log: sut.LoggerProvider) => void
): ReadonlyArray<sut.LogRecord>;
function withProvider(
  arg0: string | Omit<sut.LoggerOptions, 'destination'>,
  fn: (log: sut.LoggerProvider) => void
): ReadonlyArray<sut.LogRecord>;
function withProvider(arg0: any, arg1?: any): ReadonlyArray<sut.LogRecord> {
  const fn = typeof arg0 == 'function' ? arg0 : arg1;
  const spec = typeof arg0 == 'string' ? arg0 : 'trace';
  const opts = typeof arg0 == 'object' ? arg0 : {};
  const into: sut.LogRecord[] = [];
  const thresholder = sut.logThresholder(spec);
  const provider = sut.LoggerProvider.create({
    thresholder,
    emitter,
    options: {
      ...opts,
      destination: {
        write(msg) {
          into.push(JSON.parse(msg));
        },
      },
    },
  });
  fn(provider);
  return into;
}

describe('logger provider', () => {
  test('values type', () => {
    withProvider((p) => {
      const log = p.logger({name: 't1'});
      log.info('ok');
      log.info({}, 'ok');
      log.info({$b: 1}, 'ok');
      log.info({err: new Error('Boom')}, 'ok');

      const data: sut.LogData = {one: 1};
      data.two = 'two';
      log.info({data}, 'ok');

      // @ts-expect-error invalid standard key
      log.warn({data: 123}, 'm2');

      // @ts-expect-error reserved key
      log.info({foo: 5}, 'm2');
      const b = {metrics: 1};
      // @ts-expect-error reserved key
      log.info({...b, data: {}}, 'm2');
    });
  });

  describe('logs', () => {
    const ll = process.env.LL;

    afterEach(() => {
      if (ll === undefined) {
        delete process.env.LL;
      } else {
        process.env.LL = ll;
      }
    });

    test('explicit level', () => {
      const arr = withProvider('debug', (p) => {
        const log = p.logger({name: 't2'});
        log.warn({data: {one: 1}}, 'At warn');
        log.info('At info');
        log.error({err: new Error('Boom')}, 'At error');
        log.debug('At debug');
        log.trace('At trace');
        log.fatal({$custom: 'cc'}, 'At fatal');
      });
      expect(arr).toMatchObject([
        {level: 40, msg: 'At warn', data: {one: 1}},
        {level: 30, msg: 'At info'},
        {
          level: 50,
          msg: 'At error',
          err: {message: 'Boom', stack: expect.any(String)},
        },
        {level: 20, msg: 'At debug'},
        {level: 60, msg: 'At fatal', $custom: 'cc'},
      ]);
    });
  });

  test('child', () => {
    const arr = withProvider((p) => {
      const log = p.logger({name: 't3'});
      log.info('m1');
      const clog = log.child({$v1: 'v'});
      clog.info({$v1: 'w'}, 'm2');
      clog.info('m3');
      log.info('m4');
    });
    expect(arr).toMatchObject([
      {msg: 'm1'},
      {msg: 'm2', $v1: 'w'},
      {msg: 'm3', $v1: 'v'},
      {msg: 'm4'},
    ]);
  });

  test('library', () => {
    const arr = withProvider((p) => {
      const log1 = p.logger({name: 'tt1'});
      log1.info('One');
      const clog = log1.child({$foo: 1});
      clog.info('Two');
      const log2 = p.logger({name: 'tt2', version: '0.1.1'});
      log2.warn('Three');
    });
    expect(arr).toMatchObject([
      {msg: 'One', res: {'otel.library.name': 'tt1'}},
      {msg: 'Two', $foo: 1, res: {'otel.library.name': 'tt1'}},
      {
        msg: 'Three',
        res: {'otel.library.name': 'tt2', 'otel.library.version': '0.1.1'},
      },
    ]);
  });

  test('library level overrides', () => {
    const lvl = 'debug,foo=trace,ba*=warn,bar=error';
    const arr = withProvider(lvl, (p) => {
      const log = p.logger({name: 't4'});
      log.info('m1');
      log.trace('ignored');
      const fooLog = p.logger({name: 'foo'});
      fooLog.trace('m2');
      const barLog = p.logger({name: 'bar'});
      barLog.warn('ignored');
      barLog.error('m3');
      const barExtLog = p.logger({name: 'bar-ext'});
      barExtLog.warn('m4');
      barExtLog.info('ignored');
    });
    expect(arr).toMatchObject([
      {msg: 'm1'},
      {msg: 'm2'},
      {msg: 'm3'},
      {msg: 'm4'},
    ]);
  });

  test('context level overrides', () => {
    const ctx: otel.SpanContext = {
      traceId: '11223344556677889900aabbccddeeff',
      spanId: '1234567890abcdef',
      traceFlags: 0,
      traceState: sut.settingLogLevel(new TraceState(), 'debug'),
    };
    const arr = withProvider('info', (p) => {
      const log = p.logger({name: 't5'});
      log.info('m1');
      log.debug('ignored');
      const clog = log.child({ctx});
      clog.debug('m2');
      clog.trace('ignored');
      log.debug('ignored');
      clog.info('m3');
      log.debug({ctx}, 'm4');
      log.info('m5');
    });
    expect(arr).toMatchObject([
      {msg: 'm1'},
      {msg: 'm2', ctx: {t: ctx.traceId, s: ctx.spanId}},
      {msg: 'm3', ctx: {t: ctx.traceId, s: ctx.spanId}},
      {msg: 'm4', ctx: {t: ctx.traceId, s: ctx.spanId}},
      {msg: 'm5'},
    ]);
  });

  test('data serializers', () => {
    const opts: sut.LoggerOptions = {
      dataSerializers: {
        foo: (v) => v.length,
        bar: (n) => n + 1,
      },
    };
    const arr = withProvider(opts, (p) => {
      const log = p.logger({name: 't7'});
      log.info({data: {foo: 'abc', other: 10}}, 'm1');
      log.info({data: {foo: 'a', bar: 3}}, 'm2');
      log.info('m3');
    });
    expect(arr).toMatchObject([
      {msg: 'm1', data: {foo: 3, other: 10}},
      {msg: 'm2', data: {foo: 1, bar: 4}},
      {msg: 'm3'},
    ]);
  });

  test('error serializers', () => {
    const opts: sut.LoggerOptions = {
      errorSerializers: [
        (err) => ((err as any).message === 'Boom' ? {boom: '!'} : undefined),
      ],
    };
    const arr = withProvider(opts, (p) => {
      const log = p.logger({name: 't8'});
      const boom = new Error('Boom');
      log.info({err: boom}, 'm1');
      log.info({err: errors.internal({message: 'hey', cause: boom})}, 'm2');
      log.info({err: new Error('Bang')}, 'm3');
    });
    expect(arr).toMatchObject([
      {msg: 'm1', err: {boom: '!'}},
      {msg: 'm2', err: {message: 'hey', cause: {boom: '!'}}},
      {msg: 'm3', err: {message: 'Bang'}},
    ]);
  });

  test('is level enabled', () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = undefined;
    try {
      withProvider('warn', (p) => {
        const log = p.logger({name: 't7'});
        expect(log.isLevelEnabled('warn')).toEqual(true);
        expect(log.isLevelEnabled('error')).toEqual(true);
        expect(log.isLevelEnabled('info')).toEqual(false);
      });
    } finally {
      process.env.NODE_ENV = env;
    }
  });

  describe('active context', () => {
    const tracer = otel.trace.getTracer('test');

    test('absent', () => {
      const arr = withProvider((p) => {
        const log = p.logger({name: 't8'});
        log.info('m1');
      });
      expect(arr[0]?.ctx).toBeUndefined();
    });

    test('inferred', () => {
      let sctx: any;
      const arr = withProvider((p) => {
        const log = p.logger({name: 't9'});
        tracer.startActiveSpan('foo', (sp) => {
          sctx = sp.spanContext();
          log.info('m1');
          const clog = log.child({$v: 'v'});
          clog.info({data: {one: 1}}, 'm2');
          clog.info('m3');
        });
      });
      const ctx = contextValue(sctx);
      expect(arr).toMatchObject([
        {msg: 'm1', ctx},
        {msg: 'm2', ctx, data: {one: 1}, $v: 'v'},
        {msg: 'm3', ctx},
      ]);
    });

    test('set on child', () => {
      let sctx1, sctx2: any;
      const arr = withProvider((p) => {
        const log = p.logger({name: 't10'});
        tracer.startActiveSpan('foo', (sp1) => {
          sctx1 = sp1.spanContext();
          const sp2 = tracer.startSpan('bar');
          sctx2 = sp2.spanContext();
          log.info('m1');
          const clog = log.child({ctx: sctx2});
          clog.info({ctx: undefined}, 'm2');
          clog.info({data: {one: 1}}, 'm3');
        });
      });
      expect(arr).toMatchObject([
        {msg: 'm1', ctx: contextValue(sctx1)},
        {msg: 'm2', ctx: contextValue(sctx2)},
        {msg: 'm3', data: {one: 1}, ctx: contextValue(sctx2)},
      ]);
    });
  });
});

test('noop logger', () => {
  const log = sut.noopLogger();
  log.fatal('oh');
  log.error('foo');
  log.warn({}, 'no');
  log.info('foo');
  log.debug({}, 'bar');
  log.child({}).trace('foo');
  expect(log.isLevelEnabled('error')).toBe(false);
});

test('recording destination', () => {
  const into: sut.LogRecord[] = [];
  const log = sut.LoggerProvider.create({
    thresholder: sut.logThresholder('trace'),
    emitter,
    options: {
      destination: sut.recordingDestination({
        into,
        thresholder: sut.logThresholder('silent'),
      }),
    },
  }).logger({name: 'test'});

  log.info({data: {one: 1}}, 'ok');
  log.error('foo', 3);
  const clog = log.child({$res: {res1: 'r1'}});
  clog.warn({data: {w: 'yes'}}, 'no');
  log.debug({}, 'bar');
  clog.trace('foo', 1, 2);
  const err = new Error('boom');
  log.fatal({err}, 'stop');
  expect(log.isLevelEnabled('trace')).toBe(true);
  expect(into).toMatchObject([
    {level: 30, data: {one: 1}, msg: 'ok'},
    {level: 50, msg: 'foo'},
    {level: 40, data: {w: 'yes'}, $res: {res1: 'r1'}, msg: 'no'},
    {level: 20, msg: 'bar'},
    {level: 10, $res: {res1: 'r1'}, msg: 'foo'},
    {level: 60, err: {message: 'boom'}, msg: 'stop'},
  ]);
});

function contextValue(sctx: otel.SpanContext): unknown {
  return {t: sctx.traceId, s: sctx.spanId};
}
