import {absurd, assert, check} from '@mtth/stl-errors';
import {EventProducer} from '@mtth/stl-utils/events';
import {Collect, collectable, Effect} from '@mtth/stl-utils/functions';
import {isDeepEqual} from '@mtth/stl-utils/objects';
import * as otel from '@opentelemetry/api';

import {LibInfo} from './common.js';

export interface MetricsListeners {
  readonly metricCreation: (name: string) => void;
  readonly collectionError: (err: unknown) => void;
}

export class MetricLoader {
  private readonly metricEntries = new Map<string, MetricEntry>();
  private readonly callbackEntries: CallbackEntry[] = [];
  constructor(
    private readonly emitter: EventProducer<MetricsListeners>,
    private readonly provider: otel.MeterProvider
  ) {}

  /**
   * Returns type-safe metrics corresponding to the input instruments. Metrics
   * will be cached for later calls (names across differing instruments must be
   * unique). See `reset` to clear the loader.
   */
  load<O extends Instruments>(
    lib: LibInfo,
    instrs: O
  ): [MetricsFor<O>, OnMetricCollection] {
    const {callbackEntries, emitter, metricEntries, provider} = this;

    const meter = provider.getMeter(lib.name, lib.version);
    const metrics: any = {};
    const onCollection = collectable<Effect>();
    const newGauges: WrappedGauge[] = [];

    for (const [key, val] of Object.entries(instrs)) {
      const instr = val as AnyInstrument;
      let metric;
      const entry = metricEntries.get(instr.name);
      if (entry) {
        assert(
          isDeepEqual(instr, entry.instrument),
          'Inconsistent instrument for metric %s',
          instr.name
        );
        metric = entry.metric;
      } else {
        const {name, kind, labels, ...opts} = instr;
        const tx = new AttributeTranslator(Object.entries(labels));
        switch (kind) {
          case 'counter':
            metric = new WrappedCounter(meter.createCounter(name, opts), tx);
            break;
          case 'gauge': {
            metric = new WrappedGauge(
              meter.createObservableGauge(name, opts),
              tx
            );
            newGauges.push(metric);
            break;
          }
          case 'histogram':
            metric = new WrappedHistogram(
              meter.createHistogram(name, opts),
              tx
            );
            break;
          case 'upDownCounter':
            metric = new WrappedCounter(
              meter.createUpDownCounter(name, opts),
              tx
            );
            break;
          default:
            throw absurd(kind);
        }
        metricEntries.set(name, {instrument: instr, metric});
        emitter.emit('metricCreation', name);
      }
      metrics[key] = metric;
    }

    if (newGauges.length) {
      const entry: CallbackEntry = {
        meter,
        callback: async (res) => {
          try {
            await Promise.all(onCollection.collected.map((fn) => fn()));
          } catch (err) {
            emitter.emit('collectionError', err);
            return;
          }
          for (const gauge of newGauges) {
            gauge.collect(res);
          }
        },
        observables: newGauges.map((g) => g.observable),
      };
      callbackEntries.push(entry);
      meter.addBatchObservableCallback(entry.callback, entry.observables);
    }

    return [metrics, onCollection];
  }

  /**
   * Clears all metrics from the loader. Note that this will also delete all
   * collection callbacks.
   */
  reset(): void {
    const {callbackEntries, metricEntries} = this;
    let entry;
    while ((entry = callbackEntries.pop())) {
      const {callback, meter, observables} = entry;
      meter.removeBatchObservableCallback(callback, observables);
    }
    metricEntries.clear();
  }
}

interface MetricEntry {
  readonly instrument: AnyInstrument;
  readonly metric: any;
}

interface CallbackEntry {
  readonly meter: otel.Meter;
  readonly callback: otel.BatchObservableCallback;
  readonly observables: otel.Observable[];
}

export class NoopMeterProvider implements otel.MeterProvider {
  constructor(private readonly meter = otel.createNoopMeter()) {}
  getMeter(): otel.Meter {
    return this.meter;
  }
}

export interface Instruments {
  readonly [key: string]: AnyInstrument;
}

/** No-op function for easier client typing. */
export function instrumentsFor<O extends Instruments>(obj: O): O {
  return obj;
}

type AnyInstrument = Instrument<InstrumentKind, any>;

type InstrumentKind = 'counter' | 'gauge' | 'histogram' | 'upDownCounter';

interface Instrument<K extends InstrumentKind, L extends InstrumentLabels>
  extends otel.MetricOptions {
  readonly kind: K;
  readonly name: string;
  readonly labels: L;
}

export type MetricsFor<O extends Instruments> = {
  readonly [K in keyof O]: MetricFor<O[K]>;
};

type MetricFor<I extends AnyInstrument> =
  I extends Instrument<'counter' | 'upDownCounter', infer L>
    ? TypedCounter<AttributesFor<L>>
    : I extends Instrument<'histogram', infer L>
      ? TypedHistogram<AttributesFor<L>>
      : I extends Instrument<'gauge', infer L>
        ? TypedGauge<AttributesFor<L>>
        : never;

type AttributesFor<L extends InstrumentLabels> = {
  readonly [K in keyof L]: otel.AttributeValue;
};

interface InstrumentLabels {
  readonly [key: string]: string;
}

export type OnMetricCollection = Collect<Effect>;

class AttributeTranslator {
  constructor(private readonly tuples: ReadonlyArray<[string, string]>) {}

  translate(attrs: object | undefined): otel.MetricAttributes {
    const ret = Object.create(null);
    if (attrs == null) {
      return ret;
    }
    const obj = check.isRecord(attrs);
    for (const [oldKey, newKey] of this.tuples) {
      ret[newKey] = obj[oldKey];
    }
    return ret;
  }
}

type TypedCounter<A> = keyof A extends never
  ? BasicCounter
  : DecoratedCounter<A>;

interface BasicCounter {
  add(value: number): void;
}

interface DecoratedCounter<A> {
  add(value: number, attrs: A): void;
}

class WrappedCounter implements TypedCounter<object> {
  constructor(
    private readonly delegate: otel.Counter,
    private readonly translator: AttributeTranslator
  ) {}

  add(value: number, attrs?: object): void {
    this.delegate.add(value, this.translator.translate(attrs));
  }
}

type TypedHistogram<A> = keyof A extends never
  ? BasicHistogram
  : DecoratedHistogram<A>;

interface BasicHistogram {
  record(value: number): void;
}

interface DecoratedHistogram<A> {
  record(value: number, attrs: A): void;
}

class WrappedHistogram implements TypedHistogram<object> {
  constructor(
    private readonly delegate: otel.Histogram,
    private readonly translator: AttributeTranslator
  ) {}

  record(value: number, attrs?: object): void {
    this.delegate.record(value, this.translator.translate(attrs));
  }
}

type TypedGauge<A> = keyof A extends never ? BasicGauge : DecoratedGauge<A>;

interface BasicGauge {
  observe(value: number): void;
}

interface DecoratedGauge<A> {
  /**
   * The last observation will be used during each metric collection. Values are
   * cleared after a collection.
   */
  observe(value: number, attrs: A): void;
}

class WrappedGauge implements TypedGauge<object> {
  readonly values = new Map<string, number>();
  constructor(
    readonly observable: otel.ObservableGauge,
    private readonly translator: AttributeTranslator
  ) {}

  observe(value: number, attrs?: object): void {
    const key = JSON.stringify(this.translator.translate(attrs ?? {}));
    this.values.set(key, value);
  }

  collect(res: otel.BatchObservableResult): void {
    for (const [key, value] of this.values) {
      res.observe(this.observable, value, JSON.parse(key));
    }
    this.values.clear();
  }
}
