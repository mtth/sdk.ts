/** Error serialization utilities. */

import {
  errorCode,
  errorMessage,
  isStandardError,
  isStatusError,
} from '@mtth/stl-errors';
import {contained} from '@mtth/stl-utils/objects';
import {SerializerFn} from 'pino';
import * as std from 'pino-std-serializers';

// While the standard serializer does not include the raw error in the output,
// the standard interface requires it and it is tedious to add non-enumerable
// properties so we provide a trimmed down equivalent here.
export interface SerializedError {
  readonly name?: string;
  readonly message?: string;
  readonly stack?: string;
  readonly [key: string]: unknown;
}

/** Outermost serializer type. */
export type NextErrorSerializer = (err: unknown) => SerializedError;

/**
 * Convenience type allowing serializer extension. The serializer should return
 * `undefined` if it doesn't know how to handle the input error and should call
 * `next` on the error's cause, if any.
 */
export type ErrorSerializer = (
  err: unknown,
  next: NextErrorSerializer
) => SerializedError | undefined;

/**
 * Returns an `Error` serializer for Pino. The unique argument can be used to
 * serialize additional error types. The default handles standard `Error` and
 * `VError` instances.
 */
export function errorSerializer(
  fns?: ReadonlyArray<ErrorSerializer>
): SerializerFn {
  const serializers = [
    ...(fns ?? []),
    serializeStatusError,
    serializeStandardError,
  ];

  function serialize(err: unknown): SerializedError {
    for (const fn of serializers) {
      const ret = fn(err, serialize);
      if (ret !== undefined) {
        return ret;
      }
    }
    return std.err(err as Error);
  }

  return serialize;
}

/** A custom error serializer for standard error instances. */
function serializeStandardError(
  err: unknown,
  next: NextErrorSerializer
): SerializedError | undefined {
  // https://github.com/joyent/node-verror/blob/master/lib/verror.js
  if (!isStandardError(err)) {
    return undefined;
  }
  const {cause} = err;
  return {
    name: err.name,
    message: errorMessage(err),
    code: errorCode(err),
    stack: err.stack,
    tags: contained(err.tags),
    cause: cause
      ? Array.isArray(cause)
        ? cause.map(next)
        : next(cause)
      : undefined,
  };
}

function serializeStatusError(
  err: unknown,
  next: NextErrorSerializer
): SerializedError | undefined {
  // https://github.com/joyent/node-verror/blob/master/lib/verror.js
  if (!isStatusError(err)) {
    return undefined;
  }
  return {
    name: err.name,
    status: err.status,
    stack: err.stack,
    contents: next(err.contents),
  };
}
