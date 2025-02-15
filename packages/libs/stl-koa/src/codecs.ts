import {errorFactories, statusErrors} from '@mtth/stl-errors';
import Koa, {Context as KoaContext} from 'koa';
import koaCompress from 'koa-compress';
import rawBody from 'raw-body';
import stream from 'stream';
import zlib from 'zlib';

const [errors, codes] = errorFactories({
  definitions: {
    decodingInterrupted: (cause: unknown) => ({
      message: 'Request errored during decoding',
      cause,
    }),
    decodingFailed: (cause: unknown) => ({
      message: 'Request decoding failed',
      cause,
    }),
    unsupportedEncoding: (encoding: string) => ({
      message: `Unsupported request encoding: ${encoding}`,
      tags: {encoding},
    }),
  },
});

export const errorCodes = codes;

/** Default threshold over which to compress requests. */
export const COMPRESSION_THRESHOLD = 2 ** 16; // 64 kiB

const IDENTITY_ENCODING = 'identity';

/** Returns compression options suitable for JSON data. */
export function brotliJsonOptions(quality = 4): zlib.BrotliOptions {
  return {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
    },
  };
}

/**
 * Returns the request's body's contents decompressed and decoded. See also
 * `decompressedRequestBody` for a function which only decompresses.
 */
export function decodedRequestBody(
  ctx: KoaContext,
  opts?: {
    readonly maxLength?: number;
  }
): Promise<string> {
  const decompressed = decompressedRequestBody(ctx);
  return rawBody(decompressed, {length: opts?.maxLength, encoding: 'utf8'});
}

/**
 * Returns a decoded binary stream from the request's body. The following
 * encodings are supported: `identity`, `br`, `gzip`.
 */
export function decompressedRequestBody(ctx: KoaContext): stream.Readable {
  const enc = ctx.headers['content-encoding'] ?? IDENTITY_ENCODING;
  switch (enc) {
    case IDENTITY_ENCODING:
      return ctx.req;
    case 'br':
      return pipingDecoder(ctx.req, zlib.createBrotliDecompress());
    case 'gzip':
      return pipingDecoder(ctx.req, zlib.createGunzip());
    default:
      throw statusErrors.invalidArgument(errors.unsupportedEncoding(enc));
  }
}

function pipingDecoder(
  req: stream.Readable,
  decoder: stream.Duplex
): stream.Readable {
  const ret = new stream.PassThrough();
  return req
    .on('error', onRequestError)
    .pipe(decoder)
    .on('error', onDecoderError)
    .pipe(ret);

  function onRequestError(cause: unknown): void {
    decoder.removeListener('error', onDecoderError);
    const err = statusErrors.cancelled(errors.decodingInterrupted(cause));
    decoder.unpipe(ret);
    decoder.destroy();
    ret.emit('error', err);
  }

  function onDecoderError(cause: unknown): void {
    req.removeListener('error', onRequestError);
    const err = statusErrors.invalidArgument(errors.decodingFailed(cause));
    req.destroy(err);
    ret.emit('error', err);
  }
}

/**
 * Returns a middleware for encoding and optionally compressing response bodies.
 */
export function encodeResponseBody(opts?: {
  readonly threshold?: number;
}): Koa.Middleware {
  return koaCompress({
    defaultEncoding: '*',
    br: brotliJsonOptions(),
    threshold: opts?.threshold ?? COMPRESSION_THRESHOLD,
  });
}
