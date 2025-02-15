import * as stl from '@opvious/stl';
import {isGraphqlError, originalError} from '@opvious/stl-graphql';
import * as gql from 'graphql';

import {packageInfo} from '../common.js';

/**
 * Returns the HTTP status best summarizing the various errors in the result, if
 * any.
 */
export function inferHttpCode(params: InferHttpCodeParams): number {
  const {result, pureGraphqlStatus} = params;
  const tel = params.telemetry.via(packageInfo);
  const {logger: log} = tel;

  const errs = result.errors;
  if (!errs?.length) {
    return 200;
  }
  const codes = new Set<number>();
  for (const err of errs) {
    let ext: unknown;
    if (isGraphqlError(err)) {
      ext = err.extensions.status;
    }
    let status: stl.ErrorStatus;
    if (typeof ext == 'string' && stl.isErrorStatus(ext)) {
      status = ext;
    } else {
      const cause = originalError(err);
      if (!cause && pureGraphqlStatus) {
        status = pureGraphqlStatus;
      } else {
        const fl = stl.deriveFailure(cause ?? err);
        status = fl.status;
      }
    }
    const code = stl.statusToHttpCode(status);
    log.trace({data: {err, code}}, 'Inferred HTTP code.');
    codes.add(code);
  }
  const max = Math.max(...codes);
  return codes.size === 1 ? max : 100 * Math.floor(max / 100);
}

export interface InferHttpCodeParams {
  readonly result: gql.ExecutionResult;

  /** Status to use for pure GraphQL errors. */
  readonly pureGraphqlStatus?: stl.ErrorStatus;

  readonly telemetry: stl.Telemetry;
}

/** Serialize a GraphQL suitably for logging. */
export function serializeGraphqlError(
  err: unknown,
  next: stl.NextErrorSerializer
): stl.SerializedError | undefined {
  if (!isGraphqlError(err)) {
    return undefined;
  }
  const cause = err.originalError;
  return {
    type: err.name,
    message: err.message,
    extensions: err.extensions,
    // Vanilla GraphQL errors will just have a (not useful) copy of the stack.
    stack: err.stack === cause?.stack ? undefined : err.stack,
    cause: cause ? next(cause) : undefined,
  };
}
