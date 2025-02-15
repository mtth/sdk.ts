import {errorFactories} from '@mtth/stl-errors';
import {noopTelemetry, Telemetry} from '@mtth/stl-telemetry';
import {ParameterizedContext} from 'koa';
import stream from 'stream';

import {packageInfo} from './common.js';

const [errors, codes] = errorFactories({
  definitions: {
    destroyed: 'Response stream was already destroyed',
    requestAborted: 'Request aborted before the data could be written',
    requestErrored: (cause: unknown) => ({
      message: 'Request errored when writing to it',
      cause,
    }),
  },
  prefix: 'ERR_STREAM_',
});

export const errorCodes = codes;

/**
 * Streams a request into a writable stream. Any errors on the request will be
 * forwarded to the sink. An error will also be raised if the request is
 * prematurely aborted.
 */
export function streamRequest(
  ctx: ParameterizedContext,
  writable: stream.Writable
): void {
  ctx.req
    .on('error', (cause) => {
      writable.emit('error', errors.requestErrored(cause));
    })
    .on('aborted', () => {
      writable.emit('error', errors.requestAborted());
    })
    // We don't use `stream.pipeline` to avoid destroying the request stream.
    // Destroying one causes Koa to output an error to stdout and abort the
    // response before we could handle termination ourselves.
    .pipe(writable);
}

/** Streams a response back to the client. */
export function streamResponse(
  ctx: ParameterizedContext,
  readable: stream.Readable,
  tel?: Telemetry
): void {
  if (readable.destroyed) {
    throw errors.destroyed();
  }
  const {logger: log} = tel?.via(packageInfo) ?? noopTelemetry();
  log.debug('Streaming response back to client...');
  // When the body is set to a stream, Koa automatically adds an error handler
  // which prints the error. We suppress it by restoring the original handlers.
  const fns = readable.listeners('error');
  ctx.body = readable;
  readable.removeAllListeners('error');
  for (const fn of fns) {
    readable.on('error', fn as any);
  }
  readable.on('error', (err) => {
    log.error({err}, 'Response stream errored.');
    ctx.res.destroy();
  });
}
