import {constantCase, pascalCase} from 'change-case';
import {Writable} from 'ts-essentials';

import {errorMessage} from './common.js';
import {
  DeepErrorCodes,
  ErrorCode,
  ErrorOptions,
  ErrorPrefix,
  ErrorTags,
  HasErrorTags,
  StandardError,
  StandardErrorForCode,
  TaggedErrorCode,
} from './types.js';

const standardErrorMarker = '@mtth/stl-errors:StandardError+v1' as const;

/** Returns whether the argument is a standard error. */
export function isStandardError<T extends ErrorTags>(
  arg: unknown,
  code: TaggedErrorCode<T>
): arg is StandardError<T>;
export function isStandardError(
  arg: unknown,
  code?: ErrorCode | ReadonlySet<ErrorCode>
): arg is StandardError;
export function isStandardError(
  arg: unknown,
  code?: ErrorCode | ReadonlySet<ErrorCode>
): arg is StandardError {
  const err = arg as any;
  if (!err?.[standardErrorMarker]) {
    return false;
  }
  if (!code) {
    return true;
  }
  return typeof code == 'string' ? code === err.code : code.has(err.code);
}

/** Standard success code to use as counterpart to error codes. */
export const OK_CODE = 'OK';

/**
 * Returns an error's code if it is a standard error and `undefined` otherwise.
 */
export function errorCode(err: unknown): ErrorCode | undefined {
  return isStandardError(err) ? err.code : undefined;
}

/**
 * Constructs a new standard error directly from options. In general prefer
 * using error factories. This can be useful when recreating errors from another
 * system (for example to translate remote gRPC errors into local standard
 * ones). This function will throw if `code` is not a valid error code.
 */
export function newError<T extends ErrorTags>(
  name: string,
  code: ErrorCode | string,
  opts: ErrorOptions & HasErrorTags<T>
): StandardError<T>;
export function newError(
  name: string,
  code: ErrorCode | string,
  opts?: ErrorOptions
): StandardError;
export function newError(
  name: string,
  code: string,
  opts?: ErrorOptions
): StandardError {
  return new RealStandardError(name, code, opts);
}

/** Base class for standard errors. */
class RealStandardError extends Error implements StandardError {
  readonly [standardErrorMarker]!: true;
  readonly code: ErrorCode;
  readonly tags: ErrorTags;
  readonly cause?: unknown | ReadonlyArray<unknown>;
  constructor(name: string, code: string, opts?: ErrorOptions) {
    assertUndefined(codeValidationError(code));

    const msg = opts?.message;
    const limit = Error.stackTraceLimit;
    if (opts?.stackFrom === false) {
      Error.stackTraceLimit = 0;
    }
    try {
      super(msg);
    } finally {
      Error.stackTraceLimit = limit;
    }
    if (
      typeof Error.captureStackTrace == 'function' &&
      typeof opts?.stackFrom == 'function'
    ) {
      Error.captureStackTrace(this, opts?.stackFrom);
    }

    Object.defineProperty(this, standardErrorMarker, {value: true});
    if (name) {
      // Non-enumerable name.
      Object.defineProperty(this, 'name', {value: name});
    }
    this.code = code as ErrorCode; // Validated above.
    this.tags = opts?.tags ?? {};

    let cause: unknown | ReadonlyArray<unknown> | undefined;
    if (opts && Array.isArray(opts.cause)) {
      const errs = opts.cause.filter((e) => e) as Error[];
      cause = errs.length <= 1 ? errs[0] : errs;
    } else {
      cause = opts?.cause;
    }
    if (cause) {
      this.cause = cause;
    }
  }

  toJSON(): unknown {
    return {
      code: this.code,
      message: this.message ? this.message : undefined,
      tags: Object.keys(this.tags).length ? this.tags : undefined,
    };
  }
}

const CODE_PREFIX = 'ERR_';

function codeValidationError(s: string): Error | undefined {
  if (!s.startsWith(CODE_PREFIX)) {
    return new Error('Invalid error code prefix');
  }
  if (s === CODE_PREFIX) {
    return new Error('Empty error code suffix');
  }
  return suffixValidationError(s.substring(CODE_PREFIX.length));
}

const partPattern = /^[A-Z][A-Z0-9]*$/;

const PART_SEPARATOR = '_';

function suffixValidationError(s: string): Error | undefined {
  const parts = s.split(PART_SEPARATOR);
  if (!parts.length) {
    return new Error('Empty error code suffix');
  }
  for (const part of parts) {
    if (!partPattern.test(part)) {
      return new Error('Invalid error code suffix: ' + s);
    }
  }
  return undefined;
}

function assertUndefined(err: Error | undefined): void {
  if (err) {
    throw err;
  }
}

/** Combines error codes into a single object. */
export function mergeErrorCodes<O>(obj: O): DeepErrorCodes<O> {
  const codes = new Set<string>();
  walk(obj, codes, [codes]);
  return codes as any;

  function walk(src: any, dst: any, sets: ReadonlyArray<Set<string>>): void {
    for (const [key, val] of Object.entries(src)) {
      if (typeof val == 'string' || val instanceof Set) {
        for (const v of typeof val == 'string' ? [val] : val.values()) {
          assertUnique(v);
          for (const s of sets) {
            s.add(v);
          }
        }
        dst[key] = val;
      } else {
        const nested = new Set<string>();
        walk(val, nested, [...sets, nested]);
        dst[key] = nested;
      }
    }
  }

  function assertUnique(code: string): void {
    if (codes.has(code)) {
      throw errors.illegal({message: 'Duplicate error code: ' + code});
    }
  }
}

function upperCaseFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * Generates an object containing error factory methods for each of the input
 * codes. This is particularly useful to concisely generate strongly-typed error
 * creation methods and tagged codes.
 */
export function errorFactories<P extends ErrorPrefix, O extends object>(
  params: ErrorFactoriesParams<P, O>
): [ErrorFactoriesFor<O>, ErrorCodesFor<O>] {
  const {definitions, omitStack} = params;
  const prefix = params.prefix ?? CODE_PREFIX;

  const codes = new Set<string>();
  const factories = Object.create(null);

  for (const [key, val] of Object.entries(definitions)) {
    const code: any = prefix + constantCase(key);
    assertUndefined(codeValidationError(code));
    const name = params.name ?? inferName(prefix);
    (codes as any)[upperCaseFirst(key)] = code;
    codes.add(code);

    function newError(...args: any[]): StandardError {
      const stackFrom = omitStack ? false : newError;
      let opts: Writable<ErrorOptions>;
      if (typeof val == 'function') {
        const ret = val(...args);
        if (isStandardError(ret)) {
          return ret;
        }
        opts = {stackFrom, ...ret};
      } else {
        opts =
          typeof val == 'string'
            ? {stackFrom, message: val}
            : {stackFrom, ...val};
        const arg = args[0];
        if (arg !== undefined) {
          Object.assign(opts, arg);
        }
      }
      return new RealStandardError(name, code, opts);
    }

    factories[key] = newError;
  }
  return [factories, codes] as any;
}

export interface ErrorFactoriesParams<P extends ErrorPrefix, O extends object> {
  readonly definitions: O;

  /** Custom prefix for all defined error codes. The default is `ERR_`. */
  readonly prefix?: P;

  /**
   * Custom error name. The default is inferred from the prefix if present. For
   * example `ERR_FOO_BAR_` would yield name `FooBarError`.
   */
  readonly name?: string;

  /** Omit stack for all defined errors. */
  readonly omitStack?: boolean;
}

export type ErrorFactoriesFor<O> = {
  readonly [K in keyof O]: O[K] extends (
    ...args: infer A
  ) => StandardError<infer T> | (ErrorOptions & HasErrorTags<infer T>)
    ? (...args: A) => StandardError<T>
    : O[K] extends (...args: infer A) => ErrorOptions
      ? (...args: A) => StandardError
      : O[K] extends string
        ? () => StandardError
        : O[K] extends ErrorOptions
          ? ErrorFactory
          : never;
};

export interface ErrorFactory {
  (opts?: ErrorOptions): StandardError;
  <T extends ErrorTags>(opts: ErrorOptions & HasErrorTags<T>): StandardError<T>;
}

export type ErrorCodesFor<O> = {
  readonly [K in keyof O & string as Capitalize<K>]: O[K] extends (
    ...args: any[]
  ) => StandardError<infer T> | (ErrorOptions & HasErrorTags<infer T>)
    ? TaggedErrorCode<T>
    : ErrorCode;
} & ReadonlySet<ErrorCode>;

const DEFAULT_NAME = 'StandardError';

function inferName(p: ErrorPrefix): string {
  const s = p.substring(CODE_PREFIX.length);
  return s ? pascalCase(s) + 'Error' : DEFAULT_NAME;
}

/** Standard error factories. */
export const [errors, errorCodes] = errorFactories({
  definitions: {
    /** Generic internal error. */
    internal: {message: 'Internal error'},

    /** Generic illegal state error, used for assertions in particular. */
    illegal: {message: 'Illegal state'},

    /** Generic invalid argument error. */
    invalid: {message: 'Invalid argument'},

    /**
     * Coerces non standard errors into one. The original value is available via
     * its `cause` and its message, if any, as top-level message. If the input
     * is already a standard error, it is returned unchanged.
     */
    coerced: (err: unknown) =>
      isStandardError(err)
        ? err
        : {message: errorMessage(err), cause: err, stackFrom: false},
  },
});

/** Convenience type for standard errors with code `ERR_COERCED`. */
export type CoercedError = StandardErrorForCode<typeof errorCodes.Coerced>;
