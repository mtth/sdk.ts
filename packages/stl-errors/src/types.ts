/**
 * Structured code string, useful for programmatic error handling. See also the
 * `TaggedErrorCode` variant which supports strongly-typed error retrieval.
 */
export type ErrorCode = `ERR_${string}`;

export type ErrorPrefix = 'ERR_' | `ERR_${string}_`;

/** An error with associated code and, optionally, cause and structured data. */
export interface StandardError<T extends ErrorTags = ErrorTags>
  extends Error,
    HasErrorTags<T> {
  /**
   * The error's code. This code should uniquely identify the type of failure
   * represented by the error.
   */
  readonly code: ErrorCode;

  /** The underlying cause(s) of the error, if any. */
  readonly cause?: unknown | ReadonlyArray<unknown>;
}

/** Convenience type generating an error type from its code. */
export type StandardErrorForCode<C extends ErrorCode> = StandardError<
  ErrorTagsFor<C>
>;

/** Error with attached structured metadata. */
export interface HasErrorTags<T extends ErrorTags> {
  /**
   * Metadata tied for the error. This is particularly useful for programmatic
   * handling of errors.
   */
  readonly tags: T;
}

/**
 * Generic structured metadata type. Errors constructed via `errorFactories`
 * will have a more specific type.
 */
export interface ErrorTags {
  readonly [key: string]: unknown;
  readonly [key: symbol]: unknown;
}

/**
 * Virtual (type-level) key used to store tag information. We don't use a symbol
 * to allow type-checking to work across compatible versions of this library.
 */
const errorCodeTag = '@mtth/stl-errors:errorCodeTag+v1';

/**
 * An error code with attached type information about the error's tags. This
 * information can be picked up during retrieval (e.g. `isStandardError`) to
 * make the type of matching error's tags as specific as possible.
 */
export type TaggedErrorCode<T extends ErrorTags> = ErrorCode & {
  readonly [errorCodeTag]: T;
};

export type ErrorTagsFor<C extends ErrorCode> =
  C extends TaggedErrorCode<infer T> ? T : ErrorTags;

/** Standard error creation options. */
export interface ErrorOptions {
  /** A human readable description of the error. */
  readonly message?: string;

  /** Structured data to attach to the error. */
  readonly tags?: ErrorTags;

  /**
   * Optional underlying error(s) which caused this one. If not an error or
   * array of errors, the cause will be normalized to one.
   */
  readonly cause?: unknown | ReadonlyArray<unknown>;

  /**
   * Advanced option to customize the error's stack trace. Passing in a function
   * will make it start at this frame. Passing in `false` will disable it
   * altogether. `true` (the default) will generate a standard stack trace. Note
   * that errors without a stack trace are ~90% cheaper to create (whether the
   * stack is accessed or not).
   */
  readonly stackFrom?: boolean | Function;
}

export type DeepErrorCodes<O> = {
  readonly [K in keyof O]: O[K] extends ErrorCode | ErrorCodes
    ? O[K]
    : DeepErrorCodes<O[K]>;
} & ReadonlySet<ErrorCode>;

export type ErrorCodes<S extends string = string> = {
  readonly [K in S]: ErrorCode;
} & ReadonlySet<string>;
