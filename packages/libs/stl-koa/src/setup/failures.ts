import * as stl from '@opvious/stl';
import Koa from 'koa';
import {AsyncOrSync} from 'ts-essentials';

/** Failure propagator, typically useful for setting response headers. */
export interface FailurePropagator<T extends stl.ErrorTags = stl.ErrorTags> {
  readonly code: stl.TaggedErrorCode<T>;
  readonly propagate: (fl: stl.Failure, ctx: Koa.Context, tags: T) => void;
}

/**
 * Failure annotator, useful for example to add remediation actions. Annotators
 * should return an empty string when no annotation applies.
 */
export type FailureAnnotator = (
  err: stl.StatusError<stl.StandardError>
) => AsyncOrSync<string>;

/** Creates an error tag propagator for the given code and hook. */
export function failurePropagator<T extends stl.ErrorTags>(
  code: stl.TaggedErrorCode<T>,
  fn: (fl: stl.Failure, ctx: Koa.Context, tags: T) => void
): FailurePropagator<T> {
  return {code, propagate: fn};
}
