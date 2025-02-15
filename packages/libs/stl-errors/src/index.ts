import {findError} from './cause.js';
import {errorMessage, format} from './common.js';
import {errorCode, errorCodes, errors, isStandardError} from './factories.js';
import {
  ErrorStatus,
  ErrorStatuses,
  Failure,
  failure,
  isStatusError,
  StatusError,
  statusError,
  statusErrors,
} from './status.js';
import {
  ErrorCode,
  ErrorOptions,
  ErrorTags,
  StandardError,
  TaggedErrorCode,
} from './types.js';

export {
  CauseExtractor,
  collectErrorCodes,
  errorCauseExtractor,
  ErrorCodeCollection,
  ErrorMatch,
  findError,
  findErrorCode,
  findErrorWithCode,
  setCauseExtractors,
  statusErrorCauseExtractor,
} from './cause.js';
export {errorMessage} from './common.js';
export {
  CoercedError,
  errors as defaultErrors,
  errorCode,
  errorCodes,
  ErrorCodesFor,
  errorFactories,
  ErrorFactoriesFor,
  ErrorFactoriesParams,
  ErrorFactory,
  isStandardError,
  mergeErrorCodes,
  newError,
  OK_CODE,
} from './factories.js';
export {
  ErrorStatus,
  ErrorStatuses,
  Failure,
  failure,
  isErrorStatus,
  isInternalProblem,
  isServerProblem,
  isStatusError,
  OK_STATUS,
  OkStatus,
  rethrowWithStatus,
  StatusError,
  statusError,
  StatusErrorFactories,
  StatusErrorFactory,
  StatusErrorOptions,
  statusErrors,
  statusFromGrpcCode,
  statusFromHttpCode,
  StatusMapping,
  StatusProtocol,
  statusProtocolCode,
  StatusProtocolCodes,
  statusToGrpcCode,
  statusToHttpCode,
} from './status.js';
export {
  DeepErrorCodes,
  ErrorCode,
  ErrorCodes,
  ErrorOptions,
  ErrorPrefix,
  ErrorTags,
  ErrorTagsFor,
  HasErrorTags,
  StandardError,
  StandardErrorForCode,
  TaggedErrorCode,
} from './types.js';

// Assertions

/** Asserts the input predicate, throwing `ERR_ILLEGAL` if not. */
export function assert(
  pred: unknown,
  fmt: string,
  ...args: any[]
): asserts pred {
  if (pred) {
    return;
  }
  throw errors.illegal({
    message: 'Assertion failed: ' + format(fmt, ...args),
    stackFrom: assert,
  });
}

/** Asserts that an error matches a predicate. */
export function assertCause(pred: unknown, err: unknown): asserts pred {
  if (pred) {
    return;
  }
  throw errors.illegal({
    message: 'Cause assertion failed: ' + errorMessage(err),
    cause: err,
    stackFrom: assertCause,
  });
}

/** Asserts that an error has a given error code. */
export function assertErrorCode<T extends ErrorTags>(
  code: TaggedErrorCode<T>,
  err: unknown
): asserts err is StandardError<T>;
export function assertErrorCode(
  code: ErrorCode | ReadonlySet<ErrorCode>,
  err: unknown
): asserts err is StandardError;
export function assertErrorCode(
  code: ErrorCode | ReadonlySet<ErrorCode>,
  err: unknown
): asserts err is StandardError {
  if (isStandardError(err, code)) {
    return;
  }
  throw errors.illegal({
    message: 'Error code assertion failed: ' + errorMessage(err),
    cause: err,
    tags: {want: code, got: errorCode(err)},
    stackFrom: assertErrorCode,
  });
}

/** Asserts that the argument's `typeof` matches the given name. */
export function assertType<N extends keyof TypeNames>(
  name: N,
  arg: unknown
): asserts arg is TypeNames[N] {
  assert(typeof arg == name, 'Expected type %s but got %j', name, arg);
}

interface TypeNames {
  bigint: bigint;
  boolean: boolean;
  function: Function;
  number: number;
  object: {} | null;
  string: string;
  symbol: symbol;
  undefined: undefined;
}

// Checks

/** Throws `ERR_ILLEGAL` when predicates are not met. */
export type StrictChecker<R> = (arg: unknown) => R;

/** Extends `StrictChecker` with a convenience method to skip missing values. */
export interface Checker<R> extends StrictChecker<R> {
  /**
   * Transforms `null` and `undefined` values into `undefined` rather than
   * throwing.
   */
  readonly orAbsent: StrictChecker<R | undefined>;
}

export function newChecker<R>(
  expected: string,
  pred: (arg: unknown) => unknown
): Checker<R> {
  check.orAbsent = orAbsent;
  return check as any;

  function check(arg: unknown, caller?: any): any {
    if (caller && (arg === null || arg === undefined)) {
      return undefined;
    }
    assert(pred(arg), 'Expected %s but got %j', expected, arg);
    return arg;
  }

  function orAbsent(arg: unknown): any {
    return check(arg, orAbsent);
  }
}

export const check = {
  isString: newChecker<string>('a string', (a) => typeof a == 'string'),

  isNumber: newChecker<number>(
    'a number',
    (a) => typeof a == 'number' && !isNaN(a)
  ),

  isNumeric: newChecker<number>('a number', (a) => {
    let n: number | undefined;
    switch (typeof a) {
      case 'number':
        n = a;
        break;
      case 'string':
        n = +a;
        break;
    }
    return n != null && !isNaN(n);
  }),

  isInteger: newChecker<number>(
    'an integer',
    (a) => typeof a == 'number' && a === (a | 0)
  ),

  isNonNegativeInteger: newChecker<number>(
    'an integer',
    (a) => typeof a == 'number' && a === (a | 0) && a >= 0
  ),

  isBoolean: newChecker<boolean>('a boolean', (a) => typeof a == 'boolean'),

  isObject: newChecker<object>('an object', (a) => a && typeof a === 'object'),

  isRecord: newChecker<{[key: string]: unknown}>(
    'a record',
    (a) => a && typeof a === 'object' && !Array.isArray(a)
  ),

  isArray: newChecker<unknown[]>('an array', (a) => Array.isArray(a)),

  isBuffer: newChecker<Buffer>('a buffer', (a) => Buffer.isBuffer(a)),

  /** Asserts that the input is not null or undefined and returns it. */
  isPresent<V>(arg: V): Exclude<V, null | undefined> {
    assert(arg != null, 'Absent value');
    return arg as any;
  },
} as const;

// Failures

/**
 * Extracts the first status error from an error's causal chain. The optional
 * statuses argument can be used to automatically promote certain error codes to
 * have a given status. If no match was found, an `UNKNOWN` status error is
 * returned instead.
 */
export function extractStatusError(
  root: unknown,
  statuses?: ErrorStatuses
): StatusError {
  const match = findError(root, (e) => {
    if (isStatusError(e)) {
      return e.status;
    }
    const code = errorCode(e);
    return code == null ? undefined : statuses?.[code];
  });
  if (!match) {
    return statusError('UNKNOWN', root);
  }
  const {error: err, value: status} = match;
  return isStatusError(err) ? err : statusError(status, errors.coerced(err));
}

/**
 * Walks an error's causal chain to find the first status error and returns its
 * status. If no match is found, returns `UNKNOWN`.
 */
export function deriveStatus(root: unknown): ErrorStatus {
  return extractStatusError(root).status;
}

/**
 * Derives the best failure from an error. See `extractStatusError` for
 * information on how the failure's underlying status error is extracted. If not
 * status error was present, the root is used.
 */
export function deriveFailure(
  root: unknown,
  opts?: {
    /**
     * Mapping from error code to status use to automatically wrap errors
     * matching one of the codes with the corresponding status.
     */
    readonly statuses?: ErrorStatuses;
    /**
     * List of functions used to compute the returned failure's annotations. The
     * input error is the one the failure wil be generated from.
     */
    readonly annotators?: ReadonlyArray<(err: StatusError) => string>;
  }
): Failure {
  const err = extractStatusError(root, opts?.statuses);
  return failure(err, {annotations: opts?.annotators?.map((fn) => fn(err))});
}

// Conveniences

/** Returns `ERR_INTERNAL` with `UNIMPLEMENTED` status. */
export function unimplemented(...args: any[]): Error {
  return statusErrors.unimplemented(
    errors.internal({
      message: 'Unimplemented',
      tags: {arguments: args},
      stackFrom: unimplemented,
    })
  );
}

/** Returns an `ERR_ILLEGAL` error with `value` tag set to the input. */
export function absurd(val: never): Error {
  return errors.illegal({
    message: format('Absurd value: %j', val),
    tags: {value: val},
    stackFrom: absurd,
  });
}

/** Returns an `ERR_ILLEGAL` error with `value` tag set to the input. */
export function unexpected(val: unknown): Error {
  return errors.illegal({
    message: format('Unexpected value: %j', val),
    tags: {value: val},
    stackFrom: unexpected,
  });
}

/**
 * Returns the `value` tag of an `ERR_ILLEGAL` error. This is typically useful
 * to inspect errors produced by `unexpected` in tests.
 */
export function illegalErrorValue(err: unknown): unknown | undefined {
  assert(isStandardError(err, errorCodes.Illegal), 'Unexpected error: %j', err);
  return err.tags.value;
}

/** Returns an `ERR_ILLEGAL` error. */
export function unreachable(): Error {
  return errors.illegal({message: 'Unexpected call', stackFrom: unreachable});
}

/** Throws `ERR_ILLEGAL`. */
export function fail(opts?: ErrorOptions): never {
  throw errors.illegal({stackFrom: fail, ...opts});
}

/**
 * Validates the input predicate, similar to `assert` but throwing `ERR_INVALID`
 * with `INVALID_ARGUMENT` status on failure.
 */
export function validate(
  pred: unknown,
  fmt: string,
  ...args: any[]
): asserts pred;
export function validate(
  pred: unknown,
  opts: Omit<ErrorOptions, 'message' | 'stackFrom'>,
  fmt: string,
  ...args: any[]
): asserts pred;
export function validate(
  pred: unknown,
  arg1: string | Omit<ErrorOptions, 'message' | 'stackFrom'>,
  ...args: any[]
): asserts pred {
  if (pred) {
    return;
  }
  let fmt: string | undefined;
  let opts: ErrorOptions;
  if (typeof arg1 == 'string') {
    opts = {};
    fmt = arg1;
  } else {
    opts = arg1;
    fmt = args.shift();
  }
  const err = errors.invalid({
    ...opts,
    message: fmt == null ? undefined : format(fmt, ...args),
    stackFrom: validate,
  });
  throw statusErrors.invalidArgument(err);
}

// Other

/**
 * Similar to `assertCause` but does not wrap errors which do not match the
 * predicate. Non-error instances are still coerced.
 */
export function rethrowUnless(pred: unknown, err: unknown): asserts pred {
  if (pred) {
    return;
  }
  throw err instanceof Error ? err : errors.coerced(err);
}
