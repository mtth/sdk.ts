import {camelCase, sentenceCase} from 'change-case';
import {DeepWritable} from 'ts-essentials';

import {errorMessage} from './common.js';
import {
  CoercedError,
  errorCode,
  errorCodes,
  errors,
  isStandardError,
} from './factories.js';
import {ErrorCode} from './types.js';

// https://grpc.github.io/grpc/core/md_doc_statuscodes.html
// https://cloud.yandex.com/en/docs/api-design-guide/concepts/errors
const statuses = {
  // Private (internal) statuses. Their corresponding status errors do not
  // expose any information about their contents when serialized to failures.

  /** Status representing other errors. */
  UNKNOWN: {grpc: 2, http: 500},

  /**
   * Generic internal failure status. This status is used by default for
   * standard errors which do not have one set explicitly. In general you
   * shouldn't need to set it except when masking an existing status.
   */
  INTERNAL: {grpc: 13, http: 500},

  // Public statuses

  // 5XX

  /**
   * The operation is not implemented or is not supported/enabled in this
   * service.
   */
  UNIMPLEMENTED: {grpc: 12, http: 501},

  /** The service is currently unavailable. */
  UNAVAILABLE: {grpc: 14, http: 503},

  /** The deadline expired before the operation could complete. */
  DEADLINE_EXCEEDED: {grpc: 4, http: 504},

  /**
   * The operation was aborted, typically due to a concurrency issue such as a
   * sequencer check failure or transaction abort.
   */
  ABORTED: {grpc: 10, http: 504},

  // 4XX

  /** The client specified an invalid argument. */
  INVALID_ARGUMENT: {grpc: 3, http: 400},

  /**
   * The request does not have valid authentication credentials for the
   * operation.
   */
  UNAUTHENTICATED: {grpc: 16, http: 401},

  /** The caller does not have permission to execute the specified operation. */
  PERMISSION_DENIED: {grpc: 7, http: 403},

  /** Some requested entity (e.g., file or directory) was not found. */
  NOT_FOUND: {grpc: 5, http: 404},

  /**
   * The entity that a client attempted to create (e.g., file or directory)
   * already exists.
   */
  ALREADY_EXISTS: {grpc: 6, http: 409},

  /**
   * The operation was rejected because the system is not in a state required
   * for the operation's execution.
   */
  FAILED_PRECONDITION: {grpc: 9, http: 422},

  /** Some resource has been exhausted. */
  RESOURCE_EXHAUSTED: {grpc: 8, http: 429},

  /** The operation was cancelled, typically by the caller. */
  CANCELLED: {grpc: 1, http: 499},

  // TODO: Add data loss status?
} as const satisfies {
  readonly [name: string]: {readonly [P in StatusProtocol]: number};
};

export type StatusProtocol = 'grpc' | 'http';

export type ErrorStatus = keyof typeof statuses;

/**
 * Non-error status, useful for example when including an ok case within
 * aggregations or metrics.
 */
export const OK_STATUS = 'OK';

export type OkStatus = typeof OK_STATUS;

function findContents(arg: Error): Error {
  let err: Error = arg;
  while (isStatusError(err)) {
    err = err.contents;
  }
  return err;
}

export function isErrorStatus(arg: string): arg is ErrorStatus {
  return !!(statuses as any)[arg];
}

/** A wrapping error which decorates another with a status. */
export interface StatusError<E extends Error = Error> extends Error {
  /** The error status. */
  readonly status: ErrorStatus;

  /** The underlying error, to which the status is added. */
  readonly contents: E;

  /**
   * Protocol code overrides. This can be useful when the generic status is not
   * as granular as the underlying protocol's error codes.
   */
  readonly protocolCodes: StatusProtocolCodes;
}

export type StatusProtocolCodes = {readonly [P in StatusProtocol]?: number};

export interface StatusErrorOptions {
  readonly protocolCodes?: StatusProtocolCodes;
}

const isStatusErrorMarker = '@mtth/stl-errors:isStatusError+v1' as const;

class RealStatusError<E extends Error> extends Error implements StatusError<E> {
  readonly [isStatusErrorMarker]!: true;
  override readonly name = 'StatusError';
  constructor(
    readonly status: ErrorStatus,
    readonly contents: E,
    readonly protocolCodes: StatusProtocolCodes,
    stackFrom: any
  ) {
    super(statusErrorMessage(status, contents));
    Object.defineProperty(this, isStatusErrorMarker, {value: true});
    if (typeof Error.captureStackTrace == 'function') {
      Error.captureStackTrace(this, stackFrom);
    }
  }
}

function statusErrorMessage(status: ErrorStatus, err?: Error): string {
  let ret = `${sentenceCase(status)} error`;
  if (isInternalProblem(status) || !err) {
    return ret;
  }
  const cause = findContents(err);
  const code = errorCode(cause);
  if (code && code !== errorCodes.Coerced) {
    ret += ` [${code}]`;
  }
  const msg = errorMessage(cause);
  if (msg) {
    if (msg.startsWith(ret)) {
      // Avoid repeating the prefix.
      return msg;
    }
    ret += `: ${msg}`;
  }
  return ret;
}

/**
 * Returns true iff the status corresponds to an internal issue (500 code). This
 * should be used to avoid surfacing internal error details to clients.
 */
export function isInternalProblem(status: ErrorStatus): boolean {
  return statuses[status].http === 500;
}

/**
 * Returns true iff the status corresponds to a server-side issue. This is all
 * statuses corresponding to 5XX codes, except UNIMPLEMENTED (technically 501).
 */
export function isServerProblem(status: ErrorStatus): boolean {
  const code = statuses[status].http;
  return code === 500 || code > 501; // UNIMPLEMENTED is not a server problem.
}

export function statusError<E>(
  status: ErrorStatus,
  err: E,
  opts?: StatusErrorOptions
): StatusError<E extends Error ? E : CoercedError> {
  const contents: any = err instanceof Error ? err : errors.coerced(err);
  return new RealStatusError(
    status,
    contents,
    opts?.protocolCodes ?? {},
    statusError
  );
}

export type StatusErrorFactory = <E extends Error>(
  err: E,
  opts?: StatusErrorOptions
) => StatusError<E>;

export type StatusErrorFactories = {
  readonly [K in Exclude<
    ErrorStatus,
    'UNKNOWN'
  > as ConstantToCamelCase<K>]: StatusErrorFactory;
};

/** Type-level case-change from `CONSTANT_CASE` to `camelCase`. */
type ConstantToCamelCase<S extends string> = S extends `${infer T}_${infer U}`
  ? `${Lowercase<T>}${Capitalize<ConstantToCamelCase<U>>}`
  : Lowercase<S>;

export const statusErrors: StatusErrorFactories = ((): any => {
  const obj = Object.create(null);
  for (const key of Object.keys(statuses)) {
    const status = key as ErrorStatus;
    if (status === 'UNKNOWN') {
      continue;
    }

    function newError(err: Error, opts?: StatusErrorOptions): StatusError {
      const codes = opts?.protocolCodes ?? {};
      return new RealStatusError(status, err, codes, newError);
    }

    obj[camelCase(status)] = newError;
  }
  return obj;
})();

export function isStatusError(err: unknown): err is StatusError {
  return err && (err as any)[isStatusErrorMarker];
}

const statusesByGrpcCode: ReadonlyMap<number, ErrorStatus> = new Map(
  Object.entries(statuses).map(([k, v]) => [v.grpc, k as ErrorStatus])
);

/**
 * Returns the default numeric gRPC code for a given status. See `protocolCodes`
 * for transmitting more granular values.
 */
export function statusToGrpcCode(status: ErrorStatus): number {
  return statuses[status].grpc;
}

export function statusFromGrpcCode(code: number): ErrorStatus | OkStatus {
  if (code === 0) {
    return OK_STATUS;
  }
  return statusesByGrpcCode.get(code) ?? 'UNKNOWN';
}

const statusesByHttpCode: ReadonlyMap<number, ErrorStatus> = new Map(
  Object.entries(statuses).map(([k, v]) => [v.http, k as ErrorStatus])
);

/**
 * Returns the default numeric HTTP code for a given status. See `protocolCodes`
 * for transmitting more granular values.
 */
export function statusToHttpCode(status: ErrorStatus): number {
  return statuses[status].http;
}

export function statusFromHttpCode(code: number): ErrorStatus | OkStatus {
  if (code < 400) {
    return OK_STATUS;
  }
  return statusesByHttpCode.get(code) ?? 'UNKNOWN';
}

/** Returns the best numeric error code for a given error and protocol. */
export function statusProtocolCode(
  protocol: StatusProtocol,
  err: StatusError
): number {
  return (
    err.protocolCodes[protocol] ??
    (protocol === 'grpc' ? statusToGrpcCode : statusToHttpCode)(err.status)
  );
}

export function inferErrorStatus(err: unknown): ErrorStatus {
  return isStatusError(err) ? err.status : 'UNKNOWN';
}

/** A failure is the public representation of an error. */
// WARNING: This should match the schema at `resources/schemas/failure.yaml`.
export interface Failure {
  /** Standard error status. */
  readonly status: ErrorStatus;

  /** The error that caused the failure. */
  readonly error: {
    /** Human-readable message about the error. */
    readonly message: string;

    /** Application-specific error code for programmatic handling. */
    readonly code?: string;

    /** Structured metadata. */
    readonly tags?: {readonly [key: string]: unknown};
  };
}

/** Generates a new failure from a status error. */
export function failure(
  err: StatusError,
  opts?: {
    /** Annotations to append to the failure's message */
    readonly annotations?: ReadonlyArray<string>;
  }
): Failure {
  let message = err.message.trimEnd();
  if (opts?.annotations) {
    for (const a of opts.annotations) {
      message = annotating(message, a.trim());
    }
  }

  const data: DeepWritable<Failure> = {status: err.status, error: {message}};
  if (isInternalProblem(err.status)) {
    return data;
  }
  const contents = findContents(err);
  if (!contents) {
    return data;
  }
  if (isStandardError(contents)) {
    data.error.code = contents.code;
    const tags = {...contents.tags};
    if (Object.keys(tags).length) {
      data.error.tags = tags;
    }
  }
  return data;
}

const punctuatedPattern = /[.!?]$/;

function annotating(msg: string, annotation: string): string {
  return annotation
    ? punctuatedPattern.test(msg)
      ? `${msg} ${annotation}`
      : `${msg}. ${annotation}`
    : msg;
}

/** Mapping from status to error code(s). */
export type StatusMapping = {
  readonly [S in ErrorStatus]?: ErrorCode | Iterable<ErrorCode>;
};

/**
 * Wraps and rethrows an (internal) error with the status specified in the input
 * mapping. If the error is not an internal one or doesn't match, this method
 * rethrows the original error. Note that this method does not walk the error's
 * causal chain to avoid swallowing downstream errors.
 */
export function rethrowWithStatus(err: unknown, mapping: StatusMapping): never {
  if (!isStandardError(err)) {
    throw err;
  }
  for (const [status, val] of Object.entries(mapping)) {
    if (!isErrorStatus(status)) {
      throw errors.illegal({message: 'Invalid status: ' + status});
    }
    const codes = typeof val == 'string' ? [val] : val;
    for (const code of codes) {
      if (code === err.code) {
        throw statusError(status, err);
      }
    }
  }
  throw err;
}

/** Map from error code to status. */
export interface ErrorStatuses {
  readonly [code: ErrorCode]: ErrorStatus;
}
