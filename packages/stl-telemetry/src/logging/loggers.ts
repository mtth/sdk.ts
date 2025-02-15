import * as otel from '@opentelemetry/api';
import {running} from '@mtth/stl-utils/environment';
import {EventProducer} from '@mtth/stl-utils/events';
import {ifPresent} from '@mtth/stl-utils/functions';
import {
  PrettyFormatter,
  PrettyFormatterOptions,
} from '@mtth/stl-utils/objects';
import {
  default as pinoLogger_,
  destination,
  DestinationStream,
  Level,
  Logger as PinoLogger,
  LoggerOptions as PinoLoggerOptions,
  SerializerFn,
} from 'pino';

import {isExplicitVersion, LibInfo} from '../common.js';
import {LevelNumber, levelNumber, LogThresholder} from './common.js';
import {activeLevelNumber, contextLogValues} from './context.js';
import {ErrorSerializer, errorSerializer} from './errors.js';

const pinoLogger = pinoLogger_.default ?? pinoLogger_;

// TODO: Benchmark this implementation, for ex compared to pino.

export interface LoggerOptions {
  /** Application name. */
  readonly name?: string;

  /** Output destination. Defaults to stdout. */
  readonly destination?: LogDestination;

  /** https://234.fyi/otel-resources */
  readonly resource?: otel.Attributes;

  /**
   * Base key values included in all log lines. Useful for example to include
   * the PID: `{pid: process.pid}`.
   */
  readonly base?: object;

  /**
   * Convenience method to register additional error serializers. The default
   * serializer knows how to handle standard errors as well as `StandardError`s.
   */
  readonly errorSerializers?: ReadonlyArray<ErrorSerializer>;

  /**
   * Custom serialization functions for data attributes. See also the
   * `dataFormatterOptions` option below.
   */
  readonly dataSerializers?: PinoLoggerOptions['serializers'];

  /**
   * Data formatting options, useful to truncate long values and format buffers
   * in a readable way. Setting to `false` will disable pretty-formatting.
   */
  readonly dataFormatterOptions?: PrettyFormatterOptions | false;

  /** Redaction options. */
  readonly redact?: PinoLoggerOptions['redact'];
}

export type LogDestination =
  | number // File descriptor
  | string // File path
  | DestinationStream;

export interface DataSerializers {
  readonly [key: string]: SerializerFn;
}

export interface Logger extends Handlers {
  /** Returns a new logger with the input values as global bindings. */
  child<V extends Loggable<V>>(vals: V): Logger;

  /** Checks whether a message of a given level would be emitted. */
  isLevelEnabled(lvl: Level): boolean;
}

type Handlers = {
  readonly [lvl in Level]: Handler;
};

interface Handler {
  <V extends Loggable<V>>(
    vals: V,
    msg: string,
    ...args: ReadonlyArray<any>
  ): void;
  (msg: string, ...args: ReadonlyArray<any>): void;
}

export interface StandardLogValues {
  /**
   * Generic structured data. This field should be used to store any values that
   * do not belong in the other types below.
   */
  data?: LogData;

  /** Error associated with the log message. */
  err?: unknown;

  /**
   * Active span context. This value falls back to the context of the span
   * active at the time the log is emitted. You should rarely need to set it
   * explicitly.
   */
  ctx?: otel.SpanContext;
}

export interface LogData {
  [key: string]: unknown;
}

type Loggable<V> = {
  readonly [K in keyof V]: K extends keyof StandardLogValues
    ? StandardLogValues[K]
    : K extends CustomKey
      ? unknown
      : never;
};

type CustomKey<S extends string = string> = `$${S}`;

export type CustomLogValues = {
  [K in CustomKey]?: unknown;
};

export type LogValues = StandardLogValues & CustomLogValues;

export interface LoggingListeners {
  readonly logMessage: (lvl: Level, lib: LibInfo) => void;
}

export class LoggerProvider {
  private constructor(
    private readonly pino: PinoLogger,
    private readonly emitter: EventProducer<LoggingListeners>,
    private readonly thresholder: LogThresholder,
    private readonly attrs: otel.Attributes
  ) {}

  static create(args: {
    readonly thresholder: LogThresholder;
    readonly emitter: EventProducer<LoggingListeners>;
    readonly options?: LoggerOptions;
  }): LoggerProvider {
    const {emitter, thresholder, options: opts} = args;
    const serializers: PinoLoggerOptions['serializers'] = {
      err: errorSerializer(opts?.errorSerializers ?? []),
    };
    ifPresent(
      dataSerializer(opts?.dataFormatterOptions, opts?.dataSerializers),
      (serializer) => {
        serializers.data = serializer;
      }
    );
    const pinoOpts: PinoLoggerOptions = {
      name: opts?.name,
      base: opts?.base,
      level: 'trace', // Min level, actual controlled separately below.
      redact: opts?.redact,
      serializers,
    };
    const dst = logDestination(opts?.destination);
    const log = pinoLogger(pinoOpts, dst);
    return new LoggerProvider(log, emitter, thresholder, opts?.resource ?? {});
  }

  logger(lib: LibInfo): Logger {
    const {emitter, thresholder, attrs} = this;
    const pino = this.pino.child({res: {...attrs, ...libResourceAttrs(lib)}});
    return new RealLogger(pino, emitter, lib, thresholder(lib.name));
  }

  flush(): void {
    this.pino.flush();
  }
}

const LIB_NAME_KEY = 'otel.library.name';
const LIB_VERSION_KEY = 'otel.library.version';

function libResourceAttrs(info: LibInfo): otel.Attributes {
  const res: otel.Attributes = {[LIB_NAME_KEY]: info.name};
  if (isExplicitVersion(info.version)) {
    res[LIB_VERSION_KEY] = info.version;
  }
  return res;
}

/** Immutable. */
class RealLogger implements Logger {
  constructor(
    private readonly pino: PinoLogger,
    private readonly emitter: EventProducer<LoggingListeners>,
    private readonly lib: LibInfo,
    private readonly minLevelNumber: number,
    private readonly spanContext?: otel.SpanContext
  ) {}

  child<V extends Loggable<V>>(vals: any): Logger {
    const {pino, emitter: ee, lib, minLevelNumber: num, spanContext} = this;
    const {ctx, ...rest} = vals;
    return new RealLogger(pino.child(rest), ee, lib, num, ctx ?? spanContext);
  }

  private context(): otel.SpanContext | undefined {
    return this.spanContext ?? otel.trace.getActiveSpan()?.spanContext();
  }

  private shouldLogAt(lvl: Level, ctx: otel.SpanContext | undefined): boolean {
    const {minLevelNumber: minLno} = this;
    const opLno = ifPresent(ctx ?? this.context(), activeLevelNumber);
    return levelNumber(lvl) >= (opLno ? Math.min(opLno, minLno) : minLno);
  }

  isLevelEnabled(lvl: Level): boolean {
    return this.shouldLogAt(lvl, this.context());
  }

  private logAt(lvl: Level, arg0: any, ...args: any[]): void {
    const hasVals = typeof arg0 == 'object';
    const ctx = (hasVals && arg0.ctx) || this.context();
    if (!this.shouldLogAt(lvl, ctx)) {
      return;
    }
    this.emitter.emit('logMessage', lvl, this.lib);
    const obj = hasVals ? {...arg0} : {};
    if (ctx) {
      obj.ctx = contextLogValues(ctx);
    }
    if (hasVals) {
      this.pino[lvl](obj, ...args);
    } else {
      this.pino[lvl](obj, arg0, ...args);
    }
  }

  trace(arg0: any, ...args: any[]): void {
    this.logAt('trace', arg0, ...args);
  }
  debug(arg0: any, ...args: any[]): void {
    this.logAt('debug', arg0, ...args);
  }
  info(arg0: any, ...args: any[]): void {
    this.logAt('info', arg0, ...args);
  }
  warn(arg0: any, ...args: any[]): void {
    this.logAt('warn', arg0, ...args);
  }
  error(arg0: any, ...args: any[]): void {
    this.logAt('error', arg0, ...args);
  }
  fatal(arg0: any, ...args: any[]): void {
    this.logAt('fatal', arg0, ...args);
  }
}

const DEFAULT_FD = 1;

function logDestination(dst: LogDestination | undefined): DestinationStream {
  if (typeof dst == 'object') {
    return dst;
  }
  return destination({
    fd: typeof dst != 'string' ? (dst ?? DEFAULT_FD) : undefined,
    dest: typeof dst == 'string' ? dst : undefined,
    sync: running.inTest(),
  });
}

function dataSerializer(
  opts: PrettyFormatterOptions | undefined | false,
  obj: DataSerializers | undefined
): SerializerFn | undefined {
  if (opts === false && obj == null) {
    return undefined;
  }
  const entries = Object.entries(obj ?? {});
  const formatter = opts === false ? undefined : PrettyFormatter.create(opts);
  return (data: any): any => {
    for (const [key, fn] of entries) {
      const val = data[key];
      if (val !== undefined) {
        data[key] = fn(val);
      }
    }
    return formatter ? formatter.format(data) : data;
  };
}

// Other loggers

/**
 * Returns a new logger instance which ignores all log statements and always
 * returns false for `isLevelEnabled` calls. This can be useful as default
 * value, particularly when implementing libraries.
 */
export function noopLogger(): Logger {
  return new NoopLogger();
}

class NoopLogger implements Logger {
  child<V extends Loggable<V>>(): Logger {
    return this;
  }

  isLevelEnabled(): boolean {
    return false;
  }

  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  fatal(): void {}
}

export function recordingDestination(args: {
  readonly into: LogRecord[];
  readonly thresholder: LogThresholder;
  readonly destination?: LoggerOptions['destination'];
}): DestinationStream {
  const {into, thresholder} = args;
  const dst = logDestination(args.destination);
  return {
    write(msg): void {
      const rec: LogRecord = JSON.parse(msg);
      into.push(rec);
      if (rec.level >= thresholder(rec.res?.[LIB_NAME_KEY])) {
        dst.write(msg);
      }
    },
  };
}

export interface LogRecord {
  readonly level: LevelNumber;
  readonly msg: string;
  readonly time: number;
  readonly [key: string]: any;
}
