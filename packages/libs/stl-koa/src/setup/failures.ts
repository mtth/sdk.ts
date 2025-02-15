import {
  ErrorTags,
  Failure,
  StandardError,
  StatusError,
  TaggedErrorCode,
} from '@mtth/stl-errors';
import Koa from 'koa';
import {AsyncOrSync} from 'ts-essentials';

/** Failure propagator, typically useful for setting response headers. */
export interface FailurePropagator<T extends ErrorTags = ErrorTags> {
  readonly code: TaggedErrorCode<T>;
  readonly propagate: (fl: Failure, ctx: Koa.Context, tags: T) => void;
}

/**
 * Failure annotator, useful for example to add remediation actions. Annotators
 * should return an empty string when no annotation applies.
 */
export type FailureAnnotator = (
  err: StatusError<StandardError>
) => AsyncOrSync<string>;

/** Creates an error tag propagator for the given code and hook. */
export function failurePropagator<T extends ErrorTags>(
  code: TaggedErrorCode<T>,
  fn: (fl: Failure, ctx: Koa.Context, tags: T) => void
): FailurePropagator<T> {
  return {code, propagate: fn};
}
