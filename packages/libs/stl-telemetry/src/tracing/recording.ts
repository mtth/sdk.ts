import {assert} from '@mtth/stl-errors';
import {firstElement} from '@mtth/stl-utils/collections';
import {resolvable} from '@mtth/stl-utils/functions';
import * as otel from '@opentelemetry/api';

import {LibInfo} from '../common.js';

/** A tracer which automatically adds attributes to created spans. */
export class RecordingTracer implements otel.Tracer {
  private constructor(
    readonly records: SpanRecord[],
    private readonly pending: Set<RecordingSpan>
  ) {}

  static create(_lib: LibInfo): RecordingTracer {
    return new RecordingTracer([], new Set());
  }

  via(_lib: LibInfo): RecordingTracer {
    return new RecordingTracer(this.records, this.pending);
  }

  private recordingSpan(name: string, opts?: otel.SpanOptions): otel.Span {
    const span = new RecordingSpan(name);
    if (opts?.attributes) {
      span.setAttributes(opts.attributes);
    }
    this.records.push(span);
    this.pending.add(span);
    span.ended.finally(() => {
      this.pending.delete(span);
    });
    return span;
  }

  async waitForPendingSpans(): Promise<void> {
    let span: RecordingSpan | undefined;
    while ((span = firstElement(this.pending))) {
      await span.ended;
    }
  }

  reset(): void {
    this.pending.clear();
    this.records.length = 0;
  }

  startSpan(
    name: string,
    opts?: otel.SpanOptions,
    _ctx?: otel.Context
  ): otel.Span {
    return this.recordingSpan(name, opts);
  }

  startActiveSpan<F extends (span: otel.Span) => unknown>(
    name: string,
    fn: F
  ): ReturnType<F>;
  startActiveSpan<F extends (span: otel.Span) => unknown>(
    name: string,
    opts: otel.SpanOptions,
    fn: F
  ): ReturnType<F>;
  startActiveSpan<F extends (span: otel.Span) => unknown>(
    name: string,
    opts: otel.SpanOptions,
    ctx: otel.Context,
    fn: F
  ): ReturnType<F>;
  startActiveSpan<F extends (span: otel.Span) => unknown>(
    name: string,
    arg1: otel.SpanOptions | F,
    arg2?: otel.Context | F,
    arg3?: F
  ): ReturnType<F> {
    const opts: otel.SpanOptions = typeof arg1 == 'function' ? {} : arg1;
    const ctx: otel.Context =
      typeof arg2 == 'function' || !arg2 ? otel.context.active() : arg2;
    const fn =
      typeof arg1 == 'function'
        ? arg1
        : typeof arg2 == 'function'
          ? arg2
          : arg3;
    assert(fn, 'Missing function');
    const span = this.recordingSpan(name, opts);
    return otel.context.with(ctx, () => fn(span)) as any;
  }
}

export class RecordingSpan implements otel.Span, SpanRecord {
  readonly exceptions: otel.Exception[] = [];
  readonly attributes: otel.Attributes = {};
  readonly events: SpanEventRecord[] = [];
  readonly links: otel.Link[] = [];
  status: otel.SpanStatus | undefined;
  readonly ended: Promise<void>;
  private readonly onEnd: () => void;
  private readonly context = randomSpanContext();
  constructor(public name: string) {
    const [ended, onEnd] = resolvable<void>();
    this.ended = ended;
    this.onEnd = (): void => onEnd(undefined);
  }

  spanContext(): otel.SpanContext {
    return this.context;
  }

  setAttribute(key: string, value: otel.SpanAttributeValue): this {
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attrs: otel.SpanAttributes): this {
    Object.assign(this.attributes, attrs);
    return this;
  }

  addEvent(name: string, arg?: otel.SpanAttributes | otel.TimeInput): this {
    const attrs =
      typeof arg == 'object' && !Array.isArray(arg) && !(arg instanceof Date)
        ? arg
        : {};
    this.events.push({name, attributes: attrs});
    return this;
  }

  setStatus(status: otel.SpanStatus): this {
    this.status = status;
    return this;
  }

  updateName(name: string): this {
    this.name = name;
    return this;
  }

  end(): void {
    this.onEnd();
  }

  isRecording(): boolean {
    return true;
  }

  recordException(exc: otel.Exception): void {
    this.exceptions.push(exc);
  }

  addLink(link: otel.Link): this {
    this.links.push(link);
    return this;
  }

  addLinks(links: otel.Link[]): this {
    this.links.push(...links);
    return this;
  }
}

export interface SpanRecord {
  readonly name: string;
  readonly status: Readonly<otel.SpanStatus> | undefined;
  readonly exceptions: ReadonlyArray<otel.Exception>;
  readonly attributes: Readonly<otel.Attributes>;
  readonly events: ReadonlyArray<SpanEventRecord>;
}

export interface SpanEventRecord {
  readonly name: string;
  readonly attributes: Readonly<otel.Attributes>;
}

function randomSpanContext(): otel.SpanContext {
  return {
    traceId: randomHexString(32),
    spanId: randomHexString(16),
    traceFlags: 0,
  };
}

function randomHexString(length: number): string {
  const arr = Array.from({length}, () =>
    ((Math.random() * 16) | 0).toString(16)
  );
  return arr.join('');
}
