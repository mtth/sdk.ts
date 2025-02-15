import {
  CauseExtractor,
  deriveFailure,
  ErrorCode,
  errorCode,
  errorCodes,
  defaultErrors,
  ErrorStatus,
  Failure,
  findError,
  isStandardError,
  statusError,
} from '@mtth/stl-errors';
import {ifPresent} from '@mtth/stl-utils/functions';
import {MarkPresent} from '@mtth/stl-utils/objects';
import * as gql from 'graphql';
import {Writable} from 'ts-essentials';

export function isGraphqlError(err: unknown): err is gql.GraphQLError {
  return !!(err instanceof Error && (err as any).extensions);
}

export const graphqlErrorCauseExtractor: CauseExtractor = (err) =>
  isGraphqlError(err) ? ifPresent(err.originalError, (e) => [e]) : undefined;

/**
 * Extracts the original source of a GraphQL error, walking through GraphQL
 * errors and coerced errors.
 */
export function originalError(err: gql.GraphQLError): unknown | undefined {
  let cause: unknown | undefined = err;
  while (cause) {
    if (isGraphqlError(cause)) {
      cause = cause.originalError ?? undefined;
    } else if (isStandardError(cause, errorCodes.Coerced)) {
      cause = cause.cause;
    } else {
      break;
    }
  }
  return cause;
}

/**
 * Normalizes an error into a standard GraphQL error. If the input is already a
 * GraphQL error, its GraphQL-specific fields (`positions`, ...) are copied
 * over.
 *
 * The input error is always available on the returned value's `originalError`
 * field (potentially coerced).
 */
export function standardizeGraphqlError(
  err: unknown,
  opts?: StandardizeGraphqlErrorOptions
): gql.GraphQLError {
  const gopts: MarkPresent<gql.GraphQLErrorOptions, 'extensions'> = {
    originalError: err instanceof Error ? err : defaultErrors.coerced(err),
    extensions: {},
  };

  let fl: Writable<Failure>;
  let msg: string | undefined;
  if (isGraphqlError(err)) {
    const cause = assigningStatus(originalError(err), opts?.statuses);
    fl = deriveFailure(cause);
    if (opts?.keepGraphqlMessages && (!cause || isGraphqlError(cause))) {
      // This is a pure GraphQL error, the message is public.
      msg = err.message;
    }
    gopts.path = err.path;
    gopts.nodes = err.nodes;
    gopts.positions = err.positions;
    gopts.source = err.source;
    Object.assign(gopts.extensions, err.extensions);
  } else {
    fl = deriveFailure(assigningStatus(err, opts?.statuses));
  }

  return graphqlErrorFromFailure(fl, {
    ...opts,
    graphqlOptions: gopts,
    message: msg,
  });
}

interface StandardizeGraphqlErrorOptions {
  /**
   * Extensions to add to the generated error if the cause doesn't have them
   * already.
   */
  readonly extensionDefaults?: StandardGraphqlExtensions;

  /**
   * Set this option to disable masking pure GraphQL errors. This can be useful
   * in gateway servers to allow useful validation error messages through.
   */
  readonly keepGraphqlMessages?: boolean;

  /**
   * Mapping from error code to statuses, to wrap errors returned by the
   * server. This can be useful for example to add an invalid argument status
   * to invalid scalar errors.
   */
  readonly statuses?: Record<ErrorCode, ErrorStatus>;
}

export interface StandardGraphqlExtensions {
  readonly status?: ErrorStatus;
  readonly exception?: {
    readonly code?: string;
    readonly tags?: {readonly [key: string]: unknown};
  };
}

/** Transforms a failure into a GraphQL Error instance. */
export function graphqlErrorFromFailure(
  fl: Failure,
  opts?: GraphqlErrorFromFailureOptions
): gql.GraphQLError {
  const defs = opts?.extensionDefaults ?? {};

  const exts: gql.GraphQLErrorExtensions = {
    ...opts?.graphqlOptions?.extensions,
  };
  const code = fl.error.code ?? defs.exception?.code;
  const tags = fl.error.tags ?? defs.exception?.tags;
  const exc: StandardGraphqlExtensions['exception'] | undefined =
    code || tags ? {code, tags} : undefined;

  const st = fl.status === 'UNKNOWN' ? (defs.status ?? 'UNKNOWN') : fl.status;
  const status = st === 'UNKNOWN' ? undefined : st;
  if (status || exc) {
    const stdExts: StandardGraphqlExtensions = {status, exception: exc};
    Object.assign(exts, stdExts);
  }

  return new gql.GraphQLError(opts?.message ?? fl.error.message, {
    ...opts?.graphqlOptions,
    extensions: exts,
  });
}

export interface GraphqlErrorFromFailureOptions
  extends StandardizeGraphqlErrorOptions {
  /** GraphQL error creation options. Extensions may be added. */
  readonly graphqlOptions?: gql.GraphQLErrorOptions;

  /** Failure message override. */
  readonly message?: string;
}

function assigningStatus(
  err: unknown,
  statuses?: Record<ErrorCode, ErrorStatus>
): unknown {
  if (!statuses) {
    return err;
  }
  const match = findError(err, (e) => {
    const code = errorCode(e);
    return code == null ? undefined : statuses[code];
  });
  if (!match) {
    return err;
  }
  return statusError(match.value, defaultErrors.coerced(match.error));
}

/** Wraps errors into an execution result. */
export function errorResult(errs: ReadonlyArray<unknown>): gql.ExecutionResult {
  return {errors: errs.map((e) => standardizeGraphqlError(e))};
}
