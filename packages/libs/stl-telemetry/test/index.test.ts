import {typedEmitter} from '@mtth/stl-utils/events';
import * as otel from '@opentelemetry/api';
import {setTimeout} from 'timers/promises';

import * as sut from '../src/index.js';
import {LoggerProvider, logThresholder} from '../src/logging/index.js';
import {MetricLoader} from '../src/metrics.js';

class TestTelemetry extends sut.InstrumentableTelemetry {
  constructor() {
    const emitter = typedEmitter<sut.TelemetryListeners>();
    super(
      emitter,
      new MetricLoader(emitter, otel.metrics.getMeterProvider()),
      LoggerProvider.create({thresholder: logThresholder(), emitter}),
      otel.trace.getTracerProvider(),
      {name: 'test'}
    );
  }

  protected override clone(): TestTelemetry {
    return this;
  }

  logging(): TestTelemetry {
    return this;
  }
}

test('testing telemetry', () => {
  // Not a great test...
  const tel = new TestTelemetry();
  expect(tel.logger).toBeDefined();
  expect(tel.withActiveSpan({name: 't'}, () => 3)).toEqual(3);
  expect(tel.metrics({})).toBeDefined();
});

test('noop telemetry', async () => {
  const tel = sut.noopTelemetry();
  expect(tel.logger).toBeDefined();
  expect(tel.withActiveSpan({name: 't'}, () => 3)).toEqual(3);
  expect(tel.metrics({})).toBeDefined();
  expect(tel.via({name: 'test'})).toBe(tel);
});

describe('recording telemetry', () => {
  const tel = sut.RecordingTelemetry.forTesting({name: 'test'}, 'trace');

  beforeEach(() => {
    tel.reset();
  });

  test('metrics', () => {
    expect(tel.metrics({})).toBeDefined();
  });

  test('logs', () => {
    tel.logger.info('hey');
    tel.logger.debug('ho');
    const ltel = tel.via({name: 'tt'});
    ltel.logger.info('hi');
    expect(tel.logRecords).toMatchObject([
      {msg: 'hey'},
      {msg: 'ho'},
      {msg: 'hi', res: {'otel.library.name': 'tt'}},
    ]);
    tel.reset();
    expect(tel.logRecords).toHaveLength(0);
  });

  test('traces', () => {
    tel.withActiveSpan({name: 's1'}, (span) => {
      expect(span.spanContext()).toBeDefined();
      expect(span.isRecording()).toEqual(true);
    });
    tel.withActiveSpan({name: 's2'}, () => {});
    expect(tel.spanRecords).toMatchObject([{name: 's1'}, {name: 's2'}]);
    tel.reset();
    expect(tel.spanRecords).toHaveLength(0);
  });

  test('waits', async () => {
    tel.withActiveSpan(
      {name: 's', skipOkStatus: true},
      (sp1) =>
        new Promise<void>((ok) => {
          sp1.setAttribute('a', 1);
          sp1.addEvent('foo');
          setTimeout(100).then(() => {
            sp1.updateName('S');
            sp1.setAttributes({a: 'A', b: 'B'});
            sp1.addEvent('bar', {bb: 22});
            sp1.recordException({message: 'boom'});
            sp1.setStatus({code: otel.SpanStatusCode.ERROR});
            ok();
          });
        })
    );
    tel.withActiveSpan({name: 't'}, (sp2) => {
      sp2.setStatus({code: otel.SpanStatusCode.OK});
    });
    expect(tel.spanRecords).toMatchObject([
      {name: 's', attributes: {a: 1}, events: [{name: 'foo'}]},
      {name: 't', status: {code: otel.SpanStatusCode.OK}},
    ]);
    await tel.waitForPendingSpans();
    expect(tel.spanRecords).toMatchObject([
      {
        name: 'S',
        attributes: {a: 'A', b: 'B'},
        events: [{name: 'foo'}, {name: 'bar', attributes: {bb: 22}}],
        exceptions: [{message: 'boom'}],
        status: {code: otel.SpanStatusCode.ERROR},
      },
      {name: 't', status: {code: otel.SpanStatusCode.OK}},
    ]);
  });
});
