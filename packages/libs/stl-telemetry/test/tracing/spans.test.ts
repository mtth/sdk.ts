import * as otel from '@opentelemetry/api';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import {typedEmitter} from '@mtth/stl-utils/events';
import {intensive} from '@mtth/stl-utils/intensive';
import crypto from 'crypto';
import {setImmediate} from 'timers/promises';

import * as sut from '../../src/tracing/spans.js';

const provider = new NodeTracerProvider();
provider.register();

class FakeSpan implements otel.Span {
  spanContext = vi.fn().mockReturnValue({traceId: crypto.randomUUID()});
  setAttribute = vi.fn();
  setAttributes = vi.fn();
  addEvent = vi.fn();
  setStatus = vi.fn();
  updateName = vi.fn();
  end = vi.fn();
  isRecording = vi.fn().mockReturnValue(true);
  recordException = vi.fn();
  addLink = vi.fn();
  addLinks = vi.fn();
}

class FakeTracer implements otel.Tracer {
  readonly spans: otel.Span[] = [];
  startActiveSpan(_name: string, _opts?: any, ctx?: any, fn?: any): any {
    const span = new FakeSpan();
    this.spans.push(span);
    const cctx = otel.trace.setSpan(ctx ?? otel.context.active(), span);
    return otel.context.with(cctx, fn, undefined, span);
  }
  startSpan = vi.fn();
}

const emitter = typedEmitter<sut.TracingListeners>();

describe('with active span', () => {
  test('ok value', () => {
    const tracer = new FakeTracer();
    const params: sut.WithActiveSpanParams = {name: 'foo'};
    const ret = sut.withActiveSpan(tracer, emitter, params, () => 'abc');
    expect(ret).toBe('abc');
    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0] as otel.Span;
    expect(span.setStatus).toBeCalledTimes(1);
    expect(span.setStatus).toBeCalledWith({code: otel.SpanStatusCode.OK});
    expect(span.end).toBeCalledTimes(1);
  });

  test('ok promise', async () => {
    const tracer = new FakeTracer();
    const params: sut.WithActiveSpanParams = {name: 'foo'};
    const ret = await sut.withActiveSpan(tracer, emitter, params, () =>
      Promise.resolve(22)
    );
    expect(ret).toBe(22);
    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0] as otel.Span;
    expect(span.setStatus).toBeCalledTimes(1);
    expect(span.setStatus).toBeCalledWith({code: otel.SpanStatusCode.OK});
    expect(span.end).toBeCalledTimes(1);
  });

  test('ok promise no status', async () => {
    const tracer = new FakeTracer();
    const params: sut.WithActiveSpanParams = {
      name: 'foo2',
      skipOkStatus: true,
    };
    const ret = await sut.withActiveSpan(tracer, emitter, params, () =>
      Promise.resolve(22)
    );
    expect(ret).toBe(22);
    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0] as otel.Span;
    expect(span.setStatus).not.toBeCalled();
    expect(span.end).toBeCalledTimes(1);
  });

  test('ok intensive', async () => {
    const tracer = new FakeTracer();
    const params: sut.WithActiveSpanParams = {name: 'foo'};
    const op = await sut.withActiveSpan(tracer, emitter, params, () =>
      intensive(function* () {
        yield;
        return 11;
      })
    );
    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0] as otel.Span;
    expect(span.setStatus).toBeCalledTimes(0);
    const ret = op.runSync();
    expect(ret).toBe(11);
    expect(span.setStatus).toBeCalledTimes(1);
    expect(span.setStatus).toBeCalledWith({code: otel.SpanStatusCode.OK});
    expect(span.end).toBeCalledTimes(1);
  });

  test('ok forwards intensive span', async () => {
    const tracer = new FakeTracer();
    const embeddedOp = intensive(function* () {
      yield;
      return 10;
    });
    let runtimeSpan: otel.Span | undefined;
    const rootOp = intensive(function* (embed) {
      yield;
      runtimeSpan = otel.trace.getActiveSpan();
      const val = yield* sut.withActiveSpan(
        tracer,
        emitter,
        {name: 'inner'},
        () => embed(embeddedOp)
      );
      return val + 100;
    });
    await setImmediate();
    const op = await sut.withActiveSpan(
      tracer,
      emitter,
      {name: 'outer'},
      () => rootOp
    );
    await setImmediate();
    expect(tracer.spans).toHaveLength(1);
    const ret = await op.run();
    expect(tracer.spans).toHaveLength(2);
    expect(ret).toBe(110);
    expect(runtimeSpan).toBe(tracer.spans[0]);
  });

  test('rejected promise', async () => {
    const tracer = new FakeTracer();
    const params: sut.WithActiveSpanParams = {name: 'foo3'};
    try {
      await sut.withActiveSpan(tracer, emitter, params, () =>
        Promise.reject(new Error('boom'))
      );
      throw new Error('fail');
    } catch (err) {
      expect(err.message).toBe('boom');
    }
    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0] as otel.Span;
    expect(span.setStatus).toBeCalledTimes(1);
    expect(span.setStatus).toBeCalledWith({
      code: otel.SpanStatusCode.ERROR,
      message: 'boom',
    });
    expect(span.end).toBeCalledTimes(1);
  });

  test('error', () => {
    const tracer = new FakeTracer();
    const params: sut.WithActiveSpanParams = {name: 'foo3'};
    try {
      sut.withActiveSpan(tracer, emitter, params, () => {
        throw new Error('bang');
      });
      throw new Error('fail');
    } catch (err) {
      expect(err.message).toBe('bang');
    }
    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0] as otel.Span;
    expect(span.setStatus).toBeCalledTimes(1);
    expect(span.setStatus).toBeCalledWith({
      code: otel.SpanStatusCode.ERROR,
      message: 'bang',
    });
    expect(span.end).toBeCalledTimes(1);
  });

  test('bind single async generator', async () => {
    const tracer = new FakeTracer();
    let runtimeSpan: otel.Span | undefined;
    const params: sut.WithActiveSpanParams = {name: 'foo'};
    const iter = await sut.withActiveSpan(
      tracer,
      emitter,
      params,
      (_span, bind) =>
        bind(async function* () {
          yield 1;
          await setImmediate();
          runtimeSpan = otel.trace.getActiveSpan();
          expect(runtimeSpan!.end).not.toBeCalled();
          yield 2;
        })
    );
    const vals: number[] = [];
    for await (const val of iter) {
      vals.push(val);
    }
    expect(vals).toEqual([1, 2]);
    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0] as otel.Span;
    expect(span.setStatus).toBeCalledTimes(1);
    expect(span.setStatus).toBeCalledWith({code: otel.SpanStatusCode.OK});
    expect(span.end).toBeCalledTimes(1);
    expect(runtimeSpan).toBe(tracer.spans[0]);
  });
});

describe('record error', () => {
  test('error', () => {
    const span = new FakeSpan();
    const err = new Error('boom');
    sut.recordErrorOnSpan(err, span);
    expect(span.recordException).toHaveBeenCalledWith(err);
  });

  test('string', () => {
    const span = new FakeSpan();
    const err = 'bang';
    sut.recordErrorOnSpan(err, span);
    expect(span.recordException).toHaveBeenCalledWith(err);
  });

  test('object', () => {
    const span = new FakeSpan();
    sut.recordErrorOnSpan({message: 'foo'}, span);
    expect(span.recordException).toHaveBeenCalledWith('foo');
  });

  test('other', () => {
    const span = new FakeSpan();
    sut.recordErrorOnSpan(1234, span);
    expect(span.recordException).toHaveBeenCalledWith('1234');
  });
});
