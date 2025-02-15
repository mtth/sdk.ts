import * as otel from '@opentelemetry/api';
import {typedEmitter} from '@mtth/stl-utils/events';

import {LibInfo} from '../src/common.js';
import * as sut from '../src/metrics.js';

const meter = otel.createNoopMeter();
const provider = new sut.NoopMeterProvider(meter);
const emitter = typedEmitter<sut.MetricsListeners>();

const lib: LibInfo = {name: 'test'};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('metrics loader', () => {
  const loader = new sut.MetricLoader(emitter, provider);

  afterEach(() => {
    loader.reset();
  });

  test('creates counters', () => {
    const counter = meter.createCounter('c0');
    const countSpy = vi.spyOn(counter, 'add');

    const udCounter = meter.createUpDownCounter('c1');
    const udCountSpy = vi.spyOn(udCounter, 'add');

    const createCounterSpy = vi
      .spyOn(meter, 'createCounter')
      .mockReturnValue(counter);
    const createUdCounterSpy = vi
      .spyOn(meter, 'createUpDownCounter')
      .mockReturnValue(udCounter);

    const instruments = sut.instrumentsFor({
      requestCount: {
        kind: 'counter',
        name: 'request.count',
        labels: {
          code: 'http.code',
        },
      },
      queueSize: {
        kind: 'upDownCounter',
        name: 'queue.size',
        labels: {},
      },
    });

    const [metrics] = loader.load(lib, instruments);
    expect(createCounterSpy).toHaveBeenCalledTimes(1);
    expect(createUdCounterSpy).toHaveBeenCalledTimes(1);

    metrics.requestCount.add(1, {code: 123});
    metrics.queueSize.add(5);
    metrics.requestCount.add(2, {code: 456});

    expect(countSpy).toHaveBeenCalledTimes(2);
    expect(countSpy).toHaveBeenNthCalledWith(1, 1, {'http.code': 123});
    expect(countSpy).toHaveBeenNthCalledWith(2, 2, {'http.code': 456});
    expect(udCountSpy).toHaveBeenCalledTimes(1);
    expect(udCountSpy).toHaveBeenCalledWith(5, {});
  });

  test('creates a histogram', () => {
    const metric = meter.createHistogram('h1');
    const createSpy = vi
      .spyOn(meter, 'createHistogram')
      .mockReturnValue(metric);
    const recordSpy = vi.spyOn(metric, 'record');

    const [metrics] = loader.load(lib, {
      requestLatency: {
        name: 'request.count',
        kind: 'histogram',
        labels: {
          code: 'http.code',
        },
      },
    });
    expect(createSpy).toHaveBeenCalledTimes(1);

    metrics.requestLatency.record(500, {code: 200});
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(500, {'http.code': 200});
  });

  test('creates a gauge', () => {
    const metric = meter.createObservableGauge('h1');
    const createSpy = vi
      .spyOn(meter, 'createObservableGauge')
      .mockReturnValue(metric);

    const [metrics, onCollection] = loader.load(lib, {
      queueSize: {
        name: 'queue.size',
        kind: 'gauge',
        labels: {},
      },
    });
    expect(createSpy).toHaveBeenCalledTimes(1);

    onCollection(() => {
      metrics.queueSize.observe(500);
    });
  });

  test('reuses metrics', () => {
    const metric = meter.createObservableGauge('h1');
    const createSpy = vi
      .spyOn(meter, 'createObservableGauge')
      .mockReturnValue(metric);

    const instruments = sut.instrumentsFor({
      queueSize: {
        name: 'queue.size',
        kind: 'gauge',
        labels: {},
      },
    });

    const [metrics1] = loader.load(lib, instruments);
    const [metrics2] = loader.load(lib, instruments);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(metrics1.queueSize).toBe(metrics2.queueSize);

    loader.reset();
    loader.load(lib, instruments);
    expect(createSpy).toHaveBeenCalledTimes(2);
  });
});
