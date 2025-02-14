import {errorCode, isStandardError} from './factories.js';
import {isStatusError} from './status.js';
import {ErrorCode, ErrorTags, StandardError, TaggedErrorCode} from './types.js';

export type CauseExtractor = (
  err: unknown
) => ReadonlyArray<unknown> | undefined;

export interface ErrorMatch<V, E = unknown> {
  readonly value: V;
  readonly error: E;
}

export class ErrorFinder {
  readonly extractors: CauseExtractor[];

  constructor(extractors: ReadonlyArray<CauseExtractor>) {
    this.extractors = [...extractors];
  }

  /** DFS on causes. */
  private *walk(err: unknown): Generator<unknown> {
    yield err;
    for (const fn of this.extractors) {
      const causes = fn(err);
      if (causes) {
        for (const cause of causes) {
          yield* this.walk(cause);
        }
        return;
      }
    }
  }

  find<V, E = unknown>(
    root: unknown,
    fn: (e: unknown) => V | undefined
  ): ErrorMatch<V, E> | undefined {
    if (!root) {
      return undefined;
    }
    const seen = new WeakSet<object>();
    for (const cause of this.walk(root)) {
      if (cause && typeof cause == 'object') {
        if (seen.has(cause)) {
          // Circular reference.
          continue;
        }
        seen.add(cause);
      }
      const val = fn(cause);
      if (val !== undefined) {
        return {value: val, error: cause as any};
      }
    }
    return undefined;
  }
}

export function errorCauseExtractor(
  err: unknown
): ReadonlyArray<unknown> | undefined {
  if (!isStandardError(err)) {
    return undefined;
  }
  const {cause} = err;
  return cause === undefined
    ? undefined
    : Array.isArray(cause)
      ? cause
      : [cause];
}

export function statusErrorCauseExtractor(
  err: unknown
): ReadonlyArray<unknown> | undefined {
  return isStatusError(err) ? [err.contents] : undefined;
}

let globalFinder = new ErrorFinder([
  errorCauseExtractor,
  statusErrorCauseExtractor,
]);

/**
 * Resets the list of global extractors used by `findError` and similar methods.
 * The default finder contains only the `libraryCauseExtractor`. This function
 * returns the previous extractors so that they can be restored.
 */
export function setCauseExtractors(
  newExtractors: ReadonlyArray<CauseExtractor>
): ReadonlyArray<CauseExtractor> {
  const oldExtractors = globalFinder.extractors;
  globalFinder = new ErrorFinder(newExtractors);
  return oldExtractors;
}

/** Finds an error using the current list of global extractors. */
export function findError<V, E = unknown>(
  root: unknown,
  fn: (err: unknown) => V | undefined
): ErrorMatch<V, E> | undefined {
  return globalFinder.find(root, fn);
}

/**
 * Returns the first code contained by this error. This is useful for example to
 * "see through" status errors.
 */
export function findErrorCode(root: unknown): ErrorCode | undefined {
  const match = findError(root, (err) =>
    isStandardError(err) ? err.code : undefined
  );
  return match?.value;
}

/**
 * Minimal interface to allow passing both sets and maps as error code arguments
 * in `findErrorWithCode` and efficiently implement the corresponding check.
 */
export interface ErrorCodeCollection {
  has(code: ErrorCode): boolean;
}

/** Convenience method to find a internal error by code. */
export function findErrorWithCode<T extends ErrorTags>(
  root: unknown,
  code: TaggedErrorCode<T>
): ErrorMatch<TaggedErrorCode<T>, StandardError<T>> | undefined;
export function findErrorWithCode<E = StandardError>(
  root: unknown,
  code: ErrorCode | ErrorCodeCollection
): ErrorMatch<ErrorCode, E> | undefined;
export function findErrorWithCode<E = StandardError>(
  root: unknown,
  code: ErrorCode | ErrorCodeCollection
): ErrorMatch<ErrorCode, E> | undefined {
  return findError(root, (err) => {
    const errCode = errorCode(err);
    if (errCode == null) {
      return undefined;
    }
    const ok = typeof code == 'string' ? errCode === code : code.has(errCode);
    return ok ? errCode : undefined;
  });
}

/**
 * Returns a set with all error codes explicitly found in an error's causal
 * chain. Note that unlike with `errorCode`, implicit `ERR_INTERNAL` codes are
 * not added here.
 */
export function collectErrorCodes(root: unknown): ReadonlySet<ErrorCode> {
  const codes = new Set<ErrorCode>();
  findError(root, (err) => {
    if (isStandardError(err)) {
      codes.add(err.code);
    }
  });
  return codes;
}
